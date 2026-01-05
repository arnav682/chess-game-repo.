var socket = io();
var board = null;
var game = new Chess();
var c_player = null;
var selectedSquare = null;

function joinGame() {
    const name = document.getElementById('username').value;
    const room = document.getElementById('roomid').value;
    if (name && room) {
        socket.emit("join", { name, room });
        document.getElementById('setup-screen').innerHTML = "<h2>Waiting for opponent...</h2>";
    }
}

socket.on("player_side", function(side) {
    c_player = side;
    document.getElementById('youareplayingas').innerText = "Playing as: " + (side === 'w' ? 'White' : 'Black');
});

socket.on("match_found", function(data) {
    document.getElementById('setup-screen').style.display = 'none';
    document.getElementById('main-element').style.display = 'flex';
    document.getElementById('opponent-name-display').innerText = data.opponentName;
    document.getElementById('room-display').innerText = data.room;
    initBoard();
});

function initBoard() {
    var config = {
        position: 'start',
        draggable: false, // Disables dragging for mobile tap-tap
        onSquareClick: onSquareClick,
        orientation: c_player === 'w' ? 'white' : 'black'
    };
    board = Chessboard('board1', config);
}

function onSquareClick(square) {
    if (game.turn() !== c_player) return;

    if (selectedSquare === null) {
        var piece = game.get(square);
        if (piece && piece.color === c_player) {
            selectedSquare = square;
            $(".square-" + square).css("background-color", "yellow");
        }
    } else {
        var move = game.move({ from: selectedSquare, to: square, promotion: 'q' });
        $(".square-" + selectedSquare).css("background-color", "");
        
        if (move) {
            board.position(game.fen());
            socket.emit("sync_state", { fen: game.fen(), turn: game.turn() });
        }
        selectedSquare = null;
    }
}

socket.on("sync_state_from_server", function(data) {
    game.load(data.fen);
    board.position(game.fen());
});