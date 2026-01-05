// script.js

// Socket
const socket = io();

// Chess engine and board
let game = new Chess();
let board = null;

// UI refs
const $status = $('#status'); // optional if present elsewhere
const $fen = $('#fen');       // optional if present elsewhere
const $pgn = $('#pgn');       // optional if present elsewhere

// Player color and timers
let c_player = null;
let currenttimer = null;
let whiteTimer = null;
let blackTimer = null;

// Toast helper (mobile-friendly instead of alerts)
function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// Timers (unchanged logic, just replace alert with toast)
function startTimer(seconds, timerdisplay, oncomplete) {
  let startTime, timer, obj, ms = seconds * 1000,
    display = document.getElementById(timerdisplay);
  obj = {};
  obj.resume = function () {
    startTime = new Date().getTime();
    timer = setInterval(obj.step, 250);
  };
  obj.pause = function () {
    ms = obj.step();
    clearInterval(timer);
  };
  obj.step = function () {
    let now = Math.max(0, ms - (new Date().getTime() - startTime)),
      m = Math.floor(now / 60000), s = Math.floor(now / 1000) % 60;
    s = (s < 10 ? "0" : "") + s;
    if (display) display.innerHTML = m + ":" + s;
    if (now === 0) {
      clearInterval(timer);
      obj.resume = function () { };
      if (oncomplete) oncomplete();
    }
    return now;
  };
  obj.resume();
  return obj;
}

function pauseTimer(color) {
  if (color === 'w' && whiteTimer) whiteTimer.pause();
  if (color === 'b' && blackTimer) blackTimer.pause();
}
function resumeTimer(color) {
  if (color === 'w' && whiteTimer) whiteTimer.resume();
  if (color === 'b' && blackTimer) blackTimer.resume();
}
function initTimers(minutes) {
  if (!whiteTimer) {
    whiteTimer = startTimer(Number(minutes) * 60, "white-timer-value", function () {
      socket.emit("time_out", { loser: 'w', winner: 'b' });
      showToast("White ran out of time. Black wins!");
      setTimeout(() => window.location.reload(), 800);
    });
    whiteTimer.pause();
  }
  if (!blackTimer) {
    blackTimer = startTimer(Number(minutes) * 60, "black-timer-value", function () {
      socket.emit("time_out", { loser: 'b', winner: 'w' });
      showToast("Black ran out of time. White wins!");
      setTimeout(() => window.location.reload(), 800);
    });
    blackTimer.pause();
  }
}

// Detect touch for tap-to-move vs drag
const isTouch = window.matchMedia('(pointer: coarse)').matches;

// Board config: drag only on desktop
function onDragStart(source, piece) {
  if (isTouch) return false; // mobile uses tap-to-move
  if (game.turn() !== c_player) return false;
  if (game.game_over()) return false;
  if ((game.turn() === 'w' && piece.startsWith('b')) ||
      (game.turn() === 'b' && piece.startsWith('w'))) return false;
}
function onDrop(source, target) {
  const move = game.move({ from: source, to: target, promotion: 'q' });
  if (move === null) return 'snapback';
  pauseTimer('w'); pauseTimer('b');
  resumeTimer(game.turn());
  socket.emit("sync_state", game.fen(), game.turn());
  updateStatus();
}
function onSnapEnd() { board.position(game.fen()); }
function onChange() {
  if (game.game_over() && game.in_checkmate()) {
    const winner = game.turn() === 'b' ? 'White' : 'Black';
    socket.emit("game_over", winner);
  }
}

// Initialize board
const config = {
  draggable: !isTouch,
  position: 'start',
  onDragStart,
  onDrop,
  onChange,
  onSnapEnd
};
board = Chessboard('board1', config);

// Orientation helper (keep white at bottom on mobile for clarity)
function setBoardOrientation(color) {
  if (window.innerWidth < 640) {
    board.orientation('white');
  } else {
    board.orientation(color);
  }
}

// Status UI (optional; keep if you already have these elements)
function updateStatus() {
  let status = '';
  let moveColor = game.turn() === 'b' ? 'Black' : 'White';
  if (game.in_checkmate()) {
    status = 'Game over, ' + moveColor + ' is in checkmate.';
  } else if (game.in_draw()) {
    status = 'Game over, drawn position';
  } else {
    status = moveColor + ' to move';
    if (game.in_check()) status += ', ' + moveColor + ' is in check';
  }
  if ($status.length) $status.html(status);
  if ($fen.length) $fen.html(game.fen());
  if ($pgn.length) $pgn.html(game.pgn());
}

// Tap-to-move
let selectedSquare = null;

function getSquareElements() {
  const dataEls = document.querySelectorAll('#board1 [data-square]');
  if (dataEls.length) return dataEls;
  return document.querySelectorAll('#board1 .square-55d63');
}

function squareIdFromEl(el) {
  const ds = el.getAttribute('data-square');
  if (ds) return ds;
  const cls = Array.from(el.classList).find(c => c.startsWith('square-') && c.length === 8);
  if (cls) return cls.split('-')[1];
  return null;
}

function clearHighlights() {
  getSquareElements().forEach(el => {
    el.classList.remove('highlight-source', 'highlight-target');
    el.style.backgroundColor = '';
  });
}

function highlightLegalMoves(from) {
  const sourceEl = Array.from(getSquareElements()).find(el => squareIdFromEl(el) === from);
  if (sourceEl) sourceEl.classList.add('highlight-source');
  const moves = game.moves({ square: from, verbose: true });
  moves.forEach(m => {
    const targetEl = Array.from(getSquareElements()).find(el => squareIdFromEl(el) === m.to);
    if (targetEl) targetEl.classList.add('highlight-target');
  });
}

function attemptTapMove(from, to) {
  // Only allow moving on your turn
  if (game.turn() !== c_player) {
    showToast('Wait for your turn');
    return false;
  }
  const move = game.move({ from, to, promotion: 'q' });
  if (move === null) return false;

  board.position(game.fen());
  pauseTimer('w'); pauseTimer('b');
  resumeTimer(game.turn());
  socket.emit("sync_state", game.fen(), game.turn());
  updateStatus();
  return true;
}

function enableTapToMove() {
  getSquareElements().forEach(el => {
    el.addEventListener('click', () => {
      const sq = squareIdFromEl(el);
      if (!sq) return;

      if (!selectedSquare) {
        selectedSquare = sq;
        clearHighlights();
        highlightLegalMoves(sq);
        return;
      }

      if (sq === selectedSquare) {
        selectedSquare = null;
        clearHighlights();
        return;
      }

      const ok = attemptTapMove(selectedSquare, sq);
      selectedSquare = null;
      clearHighlights();
      if (!ok) showToast('Illegal move');
    }, { passive: true });
  });
}

// Rebind taps after any board redraw
function refreshTapBindings() { enableTapToMove(); }
refreshTapBindings();

// Hook into board.position to refresh taps after moves
const originalSetPosition = board.position.bind(board);
board.position = function (fen) {
  originalSetPosition(fen);
  refreshTapBindings();
};

// Resize rebinding
window.addEventListener('resize', refreshTapBindings);

// Matchmaking controls
function Handlebuttonclick(event) {
  const time = Number(event.target.getAttribute("data-time"));
  socket.emit("want_to_play", time);
  $("#main-element").hide();
  $("#waiting_para_1").show();
}
document.addEventListener('DOMContentLoaded', function () {
  const buttons = document.getElementsByClassName("timer-button");
  for (let index = 0; index < buttons.length; index++) {
    buttons[index].addEventListener('click', Handlebuttonclick);
  }
});

// Socket events (using toasts instead of alert)
socket.on("I am connected", () => {
  showToast("Connected to server");
});

socket.on("total_players_count_change", function (totalPlayersCount) {
  $("#total_players").text("Total players connected: " + totalPlayersCount);
});

socket.on("match_found", function (data, color, time) {
  c_player = color[0];
  showToast(`Match found vs ${data.opponentid}. You are ${color}.`);
  $("#waiting_para_1").hide();
  $("#main-element").show();

  game.reset();
  board.clear();
  board.start();
  setBoardOrientation(color);

  currenttimer = time;
  initTimers(time);

  pauseTimer('w'); pauseTimer('b');
  if (game.turn() === 'w') resumeTimer('w'); else resumeTimer('b');

  document.getElementById("youareplayingas").textContent = "You are playing as " + color;

  refreshTapBindings();
});

socket.on("sync_state_from_server", function (fen) {
  game.load(fen);
  board.position(fen);

  if (!whiteTimer || !blackTimer) initTimers(currenttimer || 5);

  pauseTimer('w'); pauseTimer('b');
  resumeTimer(game.turn());

  updateStatus();
  refreshTapBindings();
});

socket.on("game_over_from_server", function (winner) {
  showToast(`Game over! ${winner} wins!`);
  setTimeout(() => window.location.reload(), 1000);
});

socket.on("time_out_from_server", function (payload) {
  if (payload && payload.winner) {
    showToast(`Time out: ${payload.winner} wins!`);
    setTimeout(() => window.location.reload(), 1000);
  }
});