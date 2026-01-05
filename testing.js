var board1 = Chessboard('board1', 'start')
var board = null;
var game = new Chess();
var $status = $('#status');
var $fen = $('#fen');
var $pgn = $('#pgn');
var c_player = null;
let currenttimer = null;
let whiteTimer = null;
let blackTimer = null;

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
    if (now == 0) {
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
      alert("White ran out of time. Black wins!");
      window.location.reload();
    });
    whiteTimer.pause();
  }
  if (!blackTimer) {
    blackTimer = startTimer(Number(minutes) * 60, "black-timer-value", function () {
      socket.emit("time_out", { loser: 'b', winner: 'w' });
      alert("Black ran out of time. White wins!");
      window.location.reload();
    });
    blackTimer.pause();
  }
}

function onDragStart(source, piece, position, orientation) {
  if (game.turn() != c_player) return false;
  if (game.game_over()) return false;
  if ((game.turn() === 'w' && piece.search(/^b/) !== -1) ||
      (game.turn() === 'b' && piece.search(/^w/) !== -1)) {
    return false;
  }
}

function onDrop(source, target) {
  var move = game.move({
    from: source,
    to: target,
    promotion: 'q'
  });
  if (move === null) return 'snapback';

  // Pause both, then resume only the side to move
  if (whiteTimer) whiteTimer.pause();
  if (blackTimer) blackTimer.pause();
  if (game.turn() === 'w') {
    whiteTimer.resume();
  } else {
    blackTimer.resume();
  }

  socket.emit("sync_state", game.fen(), game.turn());
  updateStatus();
}

function onChange() {
  if (game.game_over()) {
    if (game.in_checkmate()) {
      const winner = game.turn() === 'b' ? 'White' : 'Black';
      socket.emit("game_over", winner);
    }
  }
}

function onSnapEnd() {
  board.position(game.fen());
}
function updateStatus() {
  var status = '';
  var moveColor = 'White';
  if (game.turn() === 'b') moveColor = 'Black';

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


var config = {
  draggable: true,
  position: 'start',
  onDragStart: onDragStart,
  onDrop: onDrop,
  onChange: onChange,
  onSnapEnd: onSnapEnd
};
board = Chessboard('board1', config);

updateStatus();

function Handlebuttonclick(event) {
  const time = Number(event.target.getAttribute("data-time"));
  socket.emit("want_to_play", time);
  $("#main-element").hide();
  $("#waiting_para_1").show();
}

document.addEventListener('DOMContentLoaded', function () {
  const buttons = document.getElementsByClassName("timer-button");
  for (let index = 0; index < buttons.length; index++) {
    const button = buttons[index];
    button.addEventListener('click', Handlebuttonclick);
  }
});

const socket = io();
console.log(socket);

socket.on("I am connected", () => {
  alert("You are connected to the server");
});

socket.on("total_players_count_change", function (totalPlayersCount) {
  $("#total_players").text(" Total players : " + totalPlayersCount);
});

socket.on("match_found", function (data, color, time) {
  c_player = color[0];

  alert("Match found against opponent id : " + data.opponentid + " You are playing as " + color);
  $("#waiting_para_1").hide();
  $("#main-element").show();
  // Set color text on right panel
  document.getElementById("youareplayingas").textContent = "You are playing as " + color;
  game.reset();
  board.clear();
  board.start();
  board.orientation(color);
  currenttimer = time;

  initTimers(time);

  // Always pause both, then resume only the side to move
  if (whiteTimer) whiteTimer.pause();
  if (blackTimer) blackTimer.pause();
  if (game.turn() === 'w') {
    whiteTimer.resume();
  } else {
    blackTimer.resume();
  }
});

socket.on("sync_state_from_server", function ($fen, turn) {
  game.load($fen);
  game.setTurn(turn);
  board.position($fen);

  if (!whiteTimer || !blackTimer) {
    initTimers(currenttimer || 5);
  }
  if (whiteTimer) whiteTimer.pause();
  if (blackTimer) blackTimer.pause();
  if (turn === 'w') {
    whiteTimer.resume();
  } else {
    blackTimer.resume();
  }
});

socket.on("game_over_from_server", function (winner) {
  alert("Game over! " + winner + " wins!");
  window.location.reload();
});

socket.on("time_out_from_server", function (payload) {
  if (payload && payload.winner) {
    alert("Time out: " + payload.winner + " wins!");
    window.location.reload();
  }
});