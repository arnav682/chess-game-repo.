var board1 = Chessboard('board1', 'start')
var board = null
var game = new Chess()
var $status = $('#status')
var $fen = $('#fen')
var $pgn = $('#pgn')
var c_player = null;
let currenttimer = null;


function startTimer(seconds, timerdisplay, oncomplete) {
  let startTime, timer, obj, ms = seconds * 1000,
    display = document.getElementById(timerdisplay);
  obj = {};
  obj.resume = function () {
    startTime = new Date().getTime();
    timer = setInterval(obj.step, 250); // adjust this number to affect granularity
    // lower numbers are more accurate, but more CPU-expensive
  };
  obj.pause = function () {
    ms = obj.step();
    clearInterval(timer);
  };
  obj.step = function () {
    let now = Math.max(0, ms - (new Date().getTime() - startTime)),
      m = Math.floor(now / 60000), s = Math.floor(now / 1000) % 60;
    s = (s < 10 ? "0" : "") + s;
    display.innerHTML = m + ":" + s;
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

function onDragStart(source, piece, position, orientation) {
  if (game.turn() != c_player) {
    return false;
  }




  // do not pick up pieces if the game is over
  if (game.game_over()) return false

  // only pick up pieces for the side to move
  if ((game.turn() === 'w' && piece.search(/^b/) !== -1) ||
    (game.turn() === 'b' && piece.search(/^w/) !== -1)) {
    return false
  }
}

function onDrop(source, target) {
  // see if the move is legal
  var move = game.move({
    from: source,
    to: target,
    promotion: 'q' // NOTE: always promote to a queen for example simplicity
  })

  // illegal move
  if (move === null) return 'snapback'

  socket.emit("sync_state", game.fen(), game.turn());
  if (timerinstances) {
    timerinstances.pause();

  }else{
   
    timerinstances = startTimer(Number(currenttimer) * 60, "timerdisplay", function () { alert("Done!"); });
  }

  updateStatus()
}

function onChange() {
  if (game.game_over()) {
    if (game.in_checkmate()) {
      const winner = game.turn() === 'b' ? 'White' : 'Black';
      socket.emit("game_over", winner);
    }
  }
}

// update the board position after the piece snap
// for castling, en passant, pawn promotion
function onSnapEnd() {
  board.position(game.fen())
}

function updateStatus() {
  var status = ''

  var moveColor = 'White'
  if (game.turn() === 'b') {
    moveColor = 'Black'
  }

  // checkmate?
  if (game.in_checkmate()) {
    status = 'Game over, ' + moveColor + ' is in checkmate.'
  }

  // draw?
  else if (game.in_draw()) {
    status = 'Game over, drawn position'
  }

  // game still on
  else {
    status = moveColor + ' to move'

    // check?
    if (game.in_check()) {
      status += ', ' + moveColor + ' is in check'
    }
  }

  $status.html(status)
  $fen.html(game.fen())
  $pgn.html(game.pgn())
}

var config = {
  draggable: true,
  position: 'start',
  onDragStart: onDragStart,
  onDrop: onDrop,
  onChange: onChange,
  onSnapEnd: onSnapEnd
}
board = Chessboard('board1', config)

updateStatus()


function Handlebuttonclick(event) {
  const time = Number(event.target.getAttribute("data-time"));
  socket.emit("want_to_play", time);
  $("#main-element").hide();
  $("#waiting_para_1").show();

}


let timerinstances = null;

document.addEventListener('DOMContentLoaded', function () {
  const buttons = document.getElementsByClassName("timer-button");
  for (let index = 0; index < buttons.length; index++) {
    const button = buttons[index];
    button.addEventListener('click', Handlebuttonclick);
  }
});

const socket = io("http://localhost:3000");
console.log(socket);


socket.on("I am connected", () => {
  alert("You are connected to the server");
});

socket.on("total_players_count_change", function (totalPlayersCount) {
  $("#total_players").text(" Total players : " + totalPlayersCount);
});

socket.on("match_found", function (data, color,time) {
  c_player = color[0];

  alert("Match found against opponent id : " + data.opponentid + " You are playing as " + color);
  $("#waiting_para_1").hide();
  $("#main-element").show();
  $("#button_parent").html("<p id ='youareplayingas' > You are playing as " + color + "</p>" + "<div id='timerdisplay'></div>");
  game.reset();
  board.clear();
  board.start();
  board.orientation(color);
  currenttimer = time;

  if (game.turn() === c_player) {
    timerinstances = startTimer(Number(time) * 60, "timerdisplay", function () { alert("Done!"); });
    

  }else{
    timerinstances = null;

  }
});

socket.on("sync_state_from_server", function ($fen, turn) {
  game.load($fen);
  game.setTurn(turn);
  board.position($fen);

    if (timerinstances) {
    timerinstances.resume();

  }else{
   
    timerinstances = startTimer(Number(currenttimer) * 60, "timerdisplay", function () { alert("Done!"); });
  }
});

socket.on("game_over_from_server", function (winner) {
  alert("Game over! " + winner + " wins!");
  window.location.reload();
});