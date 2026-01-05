// app.js

// Socket
const socket = io();

// Chess engine and board
let game = new Chess();
let board = null;

// UI refs
const $status = $('#status');
const $fen = $('#fen');
const $pgn = $('#pgn');

// Player color and timers
let c_player = null;
let currenttimer = null;
let whiteTimer = null;
let blackTimer = null;

// Toast helper (mobile-friendly instead of alert)
function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// Timers
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

// Board config with drag disabled on touch devices, tap-to-move enabled for all
const isTouch = window.matchMedia('(pointer: coarse)').matches;

function onDragStart(source, piece) {
  // Desktop drag only; mobile uses tap-to-move
  if (isTouch) return false;
  if (game.turn() !== c_player) return false;
  if (game.game_over()) return false;
  if ((game.turn() === 'w' && piece.startsWith('b')) ||
      (game.turn() === 'b' && piece.startsWith('w'))) return false;
}

function onDrop(source, target) {
  // Desktop drop
  const move = game.move({ from: source, to: target, promotion: 'q' });
  if (move === null) return 'snapback';

  // Timers: pause both then resume side to move
  pauseTimer('w'); pauseTimer('b');
  resumeTimer(game.turn());

  socket.emit("sync_state", game.fen(), game.turn());
  updateStatus();
}

function onSnapEnd() {
  board.position(game.fen());
}

function onChange() {
  if (game.game_over()) {
    if (game.in_checkmate()) {
      const winner = game.turn() === 'b' ? 'White' : 'Black';
      socket.emit("game_over", winner);
    }
  }
}

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

  $status.html(status);
  $fen.html(game.fen());
  $pgn.html(game.pgn());
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
updateStatus();

// Tap-to-move implementation
let selectedSquare = null;

function getSquareElements() {
  // Chessboard.js squares commonly carry data-square attribute; fallback to class
  const dataEls = document.querySelectorAll('#board1 [data-square]');
  if (dataEls.length) return dataEls;
  return document.querySelectorAll('#board1 .square-55d63');
}

function squareIdFromEl(el) {
  const ds = el.getAttribute('data-square');
  if (ds) return ds;
  // Fallback: class "square-e4" on some versions
  const cls = Array.from(el.classList).find(c => c.startsWith('square-') && c.length === 8);
  if (cls) return cls.split('-')[1];
  return null;
}

function clearHighlights() {
  getSquareElements().forEach(el => {
    el.classList.remove('highlight-source');
    el.classList.remove('highlight-target');
    el.style.backgroundColor = ''; // in case background used
  });
}

function highlightLegalMoves(from) {
  // highlight source
  const sourceEl = Array.from(getSquareElements()).find(el => squareIdFromEl(el) === from);
  if (sourceEl) sourceEl.classList.add('highlight-source');

  const moves = game.moves({ square: from, verbose: true });
  moves.forEach(m => {
    const targetEl = Array.from(getSquareElements()).find(el => squareIdFromEl(el) === m.to);
    if (targetEl) targetEl.classList.add('highlight-target');
  });
}

function attemptTapMove(from, to) {
  const move = game.move({ from, to, promotion: 'q' });
  if (move === null) return false;

  board.position(game.fen());

  // Timers: pause both then resume side to move
  pauseTimer('w'); pauseTimer('b');
  resumeTimer(game.turn());

  socket.emit("sync_state", game.fen(), game.turn());
  updateStatus();
  return true;
}

function enableTapToMove() {
  // attach click/tap listeners to squares
  getSquareElements().forEach(el => {
    el.addEventListener('click', () => {
      const sq = squareIdFromEl(el);
      if (!sq) return;

      // Only allow tapping own pieces when it's your turn
      if (!selectedSquare) {
        // Optional: check piece belongs to current player
        // We can infer from game board, but chess.js doesn't expose per-square easily.
        // We allow selection; legality will be enforced at move attempt.
        selectedSquare = sq;
        clearHighlights();
        highlightLegalMoves(sq);
        return;
      }

      if (sq === selectedSquare) {
        // Deselect
        selectedSquare = null;
        clearHighlights();
        return;
      }

      const ok = attemptTapMove(selectedSquare, sq);
      selectedSquare = null;
      clearHighlights();
      if (!ok) {
        // Feedback
        showToast('Illegal move');
      }
    }, { passive: true });
  });
}

// Re-attach tap handlers whenever board updates
function refreshTapBindings() {
  enableTapToMove();
}
refreshTapBindings();

// Re-bind on window resize or after board.position changes
window.addEventListener('resize', () => {
  refreshTapBindings();
});

// Hook into board rendering cycles
const originalSetPosition = board.position.bind(board);
board.position = function (fen) {
  originalSetPosition(fen);
  refreshTapBindings();
};

// Controls: matchmaking
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

// Board orientation helper
function setBoardOrientation(color) {
  if (window.innerWidth < 640) {
    // Keep white at bottom for mobile clarity
    board.orientation('white');
  } else {
    board.orientation(color);
  }
}

// Socket events
socket.on("I am connected", () => {
  showToast("Connected to server");
});

socket.on("total_players_count_change", function (totalPlayersCount) {
  $("#total_players").text("Total players: " + totalPlayersCount);
});

socket.on("match_found", function (data, color, time) {
  c_player = color[0];

  showToast(`Match found vs ${data.opponentid}. You are ${color}.`);
  $("#waiting_para_1").hide();
  $("#main-element").show();

  // Reset board and game
  game.reset();
  board.clear();
  board.start();
  setBoardOrientation(color);

  currenttimer = time;
  initTimers(time);

  // Timers start with side to move
  pauseTimer('w'); pauseTimer('b');
  if (game.turn() === 'w') resumeTimer('w'); else resumeTimer('b');

  // UI hint
  document.getElementById("youareplayingas").textContent = "You are playing as " + color;

  // Rebind taps after board redraw
  refreshTapBindings();
});

socket.on("sync_state_from_server", function (fen /*, turn */) {
  // Load full state from server; fen encodes turn
  game.load(fen);
  board.position(fen);

  // Ensure timers exist
  if (!whiteTimer || !blackTimer) {
    initTimers(currenttimer || 5);
  }

  // Timer control based on game.turn()
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
// End of script.js
