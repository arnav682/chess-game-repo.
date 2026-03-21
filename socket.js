// socket.js

const express = require('express');
const path = require('path');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { spawn } = require('child_process');
const { Chess } = require('chess.js');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(express.static(__dirname));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Initialize Fairy Stockfish
let stockfish;
let buffer = '';
let pendingMove = null;

function initStockfish() {
  stockfish = spawn('fairy-stockfish.exe', [], { cwd: __dirname });
  stockfish.stdout.setEncoding('utf8');
  stockfish.stdout.on('data', (data) => {
    buffer += data;
    let lines = buffer.split('\n');
    buffer = lines.pop();
    lines.forEach(line => {
      if (line.includes('bestmove')) {
        const parts = line.split(' ');
        const move = parts[1];
        if (pendingMove) {
          pendingMove(move);
          pendingMove = null;
        }
      }
    });
  });
  stockfish.stdin.write('uci\n');
  stockfish.stdin.write('isready\n');
}

function getBestMove(fen) {
  return new Promise((resolve) => {
    pendingMove = resolve;
    stockfish.stdin.write(`position fen ${fen}\ngo movetime 2000\n`);
    // Fallback after 3 seconds
    setTimeout(() => {
      if (pendingMove) {
        pendingMove('e2e4'); // Default fallback move
        pendingMove = null;
      }
    }, 3000);
  });
}

// State
let totalplayers = 0;
let players = {};           // socket.id -> socket
let playerNames = {};       // socket.id -> name
let waiting = { '5': [], '10': [], '15': [] };
let matches = {};           // matchId -> matchObject
let timeControls = ['5', '10', '15'];

function firetotalplayers() {
  io.emit('total_players_count_change', totalplayers);
}

function makeMatchId(a, b, time) {
  return `m_${time}_${a}_${b}`;
}

function createMatch(id, a, b, time) {
  matches[id] = {
    id,
    time,
    players: { white: a, black: b },
    names: {
      white: playerNames[a] || a,
      black: b === 'ai' ? 'Fairy Stockfish' : (playerNames[b] || b)
    },
    spectators: new Set(),
    fen: 'start',
    turn: 'w',
    lastMoveTime: Date.now(),
    status: 'playing', // playing | draw | checkmate | timeout
    offer: { type: null, from: null }, // draw | takeback | rematch
    history: [], // store FENs for takeback
    game: new Chess() // Server-side chess instance
  };
  return matches[id];
}

function sendMatchStateTo(socket, match) {
  const opponentid = (socket.id === match.players.white) ? match.players.black : match.players.white;
  const opponentName = (socket.id === match.players.white) ? match.names.black : match.names.white;
  socket.emit('match_found', {
    matchId: match.id,
    opponentid,
    opponentName,
    color: (socket.id === match.players.white) ? 'white' : 'black',
    time: match.time
  });
  socket.emit('sync_state_from_server', match.fen, match.turn);
}

function setupRelays(match) {
  const { white, black } = match.players;
  const ws = players[white];
  const bs = black === 'ai' ? null : players[black]; // No socket for AI
  if (!ws || (black !== 'ai' && !bs)) return;

  // Move sync: relay FEN and turn, update server-side stall clock and history
  const syncHandler = async (fromSock, toSock) => {
    fromSock.on('sync_state', async ($fen, turn) => {
      if (!matches[match.id]) return;
      match.fen = $fen;
      match.turn = turn;
      match.lastMoveTime = Date.now();
      match.history.push($fen);
      match.game.load($fen); // Load current position

      if (toSock && toSock.id !== 'ai') {
        // Human to human
        toSock.emit('sync_state_from_server', $fen, turn);
        match.spectators.forEach(sid => {
          const specSock = players[sid];
          if (specSock) specSock.emit('sync_state_from_server', $fen, turn);
        });
      } else if (toSock && toSock.id === 'ai') {
        // Human moved, now AI's turn
        try {
          const aiMove = await getBestMove($fen);
          const moveResult = match.game.move(aiMove);
          if (moveResult) {
            match.fen = match.game.fen();
            match.turn = match.game.turn();
            match.history.push(match.fen);
            fromSock.emit('sync_state_from_server', match.fen, match.turn);
            match.spectators.forEach(sid => {
              const specSock = players[sid];
              if (specSock) specSock.emit('sync_state_from_server', match.fen, match.turn);
            });
          } else {
            console.error('Invalid AI move:', aiMove);
            // Fallback: end game or handle error
          }
        } catch (e) {
          console.error('AI error:', e);
        }
      }
    });
  };
  syncHandler(ws, bs || { id: 'ai' });
  if (bs) syncHandler(bs, ws);

  // Game over (only for human players)
  const gameOverHandler = (fromSock, toSock) => {
    if (!toSock || toSock.id === 'ai') return;
    fromSock.on('game_over', (winner) => {
      if (!matches[match.id]) return;
      match.status = 'checkmate';
      toSock.emit('game_over_from_server', winner);
      match.spectators.forEach(sid => {
        const specSock = players[sid];
        if (specSock) specSock.emit('game_over_from_server', winner);
      });
    });
  };
  gameOverHandler(ws, bs);
  if (bs) gameOverHandler(bs, ws);

  // Draw offers (only for human players)
  const drawHandler = (fromSock, toSock) => {
    if (!toSock || toSock.id === 'ai') return;
    fromSock.on('draw_offer', () => {
      match.offer = { type: 'draw', from: fromSock.id };
      toSock.emit('draw_offer_from_server', { from: playerNames[fromSock.id] || fromSock.id });
    });
    fromSock.on('draw_response', (accepted) => {
      if (accepted) {
        match.status = 'draw';
        ws.emit('game_over_from_server', 'Draw');
        if (bs) bs.emit('game_over_from_server', 'Draw');
        match.spectators.forEach(sid => {
          const specSock = players[sid];
          if (specSock) specSock.emit('game_over_from_server', 'Draw');
        });
      } else {
        toSock.emit('draw_declined');
      }
      match.offer = { type: null, from: null };
    });
  };
  drawHandler(ws, bs);
  if (bs) drawHandler(bs, ws);

  // Takeback (only for human players)
  const takebackHandler = (fromSock, toSock) => {
    if (!toSock || toSock.id === 'ai') return;
    fromSock.on('takeback_request', () => {
      match.offer = { type: 'takeback', from: fromSock.id };
      toSock.emit('takeback_offer_from_server', { from: playerNames[fromSock.id] || fromSock.id });
    });
    fromSock.on('takeback_response', (accepted) => {
      if (accepted && match.history.length >= 2) {
        match.history.pop();
        const prevFen = match.history.pop();
        match.fen = prevFen;
        match.lastMoveTime = Date.now();
        match.game.load(prevFen);
        ws.emit('sync_state_from_server', prevFen, match.game.turn());
        if (bs) bs.emit('sync_state_from_server', prevFen, match.game.turn());
        match.spectators.forEach(sid => {
          const specSock = players[sid];
          if (specSock) specSock.emit('sync_state_from_server', prevFen, match.game.turn());
        });
      } else {
        toSock.emit('takeback_declined');
      }
      match.offer = { type: null, from: null };
    });
  };
  takebackHandler(ws, bs);
  if (bs) takebackHandler(bs, ws);

  // Rematch (only for human players)
  const rematchHandler = (fromSock, toSock) => {
    if (!toSock || toSock.id === 'ai') return;
    fromSock.on('rematch_request', () => {
      match.offer = { type: 'rematch', from: fromSock.id };
      toSock.emit('rematch_offer_from_server', { from: playerNames[fromSock.id] || fromSock.id });
    });
    fromSock.on('rematch_response', (accepted) => {
      if (accepted) {
        const newId = makeMatchId(white, black, match.time);
        const newMatch = createMatch(newId, white, black, match.time);
        setupRelays(newMatch);
        sendMatchStateTo(ws, newMatch);
        if (bs) sendMatchStateTo(bs, newMatch);
      } else {
        toSock.emit('rematch_declined');
      }
      match.offer = { type: null, from: null };
    });
  };
  rematchHandler(ws, bs);
  if (bs) rematchHandler(bs, ws);

  // Chat (only for human players)
  const chatHandler = (fromSock, toSock) => {
    if (!toSock || toSock.id === 'ai') return;
    fromSock.on('chat_message', (text) => {
      const payload = { from: playerNames[fromSock.id] || fromSock.id, text };
      ws.emit('chat_message_from_server', payload);
      bs.emit('chat_message_from_server', payload);
      match.spectators.forEach(sid => {
        const specSock = players[sid];
        if (specSock) specSock.emit('chat_message_from_server', payload);
      });
    });
  };
  chatHandler(ws, bs);
  if (bs) chatHandler(bs, ws);
}

// Anti-stall claim: opponent may claim win if lastMoveTime exceeds threshold
function handleStallClaim(socket, matchId) {
  const match = matches[matchId];
  if (!match) return;
  const now = Date.now();
  const STALL_MS = 120000; // 2 minutes; adjust as desired
  if (now - match.lastMoveTime >= STALL_MS && match.status === 'playing') {
    const opponentSockId = (socket.id === match.players.white) ? match.players.black : match.players.white;
    const winnerColor = (socket.id === match.players.white) ? 'white' : 'black';
    const opponentSock = players[opponentSockId];
    match.status = 'timeout';
    socket.emit('game_over_from_server', winnerColor);
    if (opponentSock) opponentSock.emit('game_over_from_server', winnerColor);
    match.spectators.forEach(sid => {
      const specSock = players[sid];
      if (specSock) specSock.emit('game_over_from_server', winnerColor);
    });
  } else {
    socket.emit('stall_claim_rejected', { reason: 'Not enough time has passed' });
  }
}

// Spectator join
function addSpectator(socket, matchId) {
  const match = matches[matchId];
  if (!match) {
    socket.emit('spectate_error', 'Match not found');
    return;
  }
  match.spectators.add(socket.id);
  socket.emit('spectate_joined', {
    matchId,
    white: match.names.white,
    black: match.names.black,
    time: match.time
  });
  socket.emit('sync_state_from_server', match.fen, match.turn);
}

// Reconnect: reattach player to match by ID
function handleReconnect(socket, matchId) {
  const match = matches[matchId];
  if (!match) {
    socket.emit('reconnect_error', 'Match not found');
    return;
  }
  const pid = socket.id;
  if (pid === match.players.white || pid === match.players.black) {
    sendMatchStateTo(socket, match);
  } else {
    socket.emit('reconnect_error', 'You are not a player in this match');
  }
}

// Socket connections
io.on('connection', (socket) => {
  players[socket.id] = socket;
  totalplayers++;
  socket.emit('I am connected');
  firetotalplayers();

  socket.on('set_name', (name) => {
    playerNames[socket.id] = String(name).slice(0, 20);
  });

  socket.on('want_to_play', (time) => {
    const t = String(time);
    if (!timeControls.includes(t)) return;
    if (waiting[t].length > 0) {
      const opponentid = waiting[t].shift();
      const id = makeMatchId(socket.id, opponentid, t);
      const match = createMatch(id, socket.id, opponentid, t);
      setupRelays(match);
      sendMatchStateTo(players[socket.id], match);
      sendMatchStateTo(players[opponentid], match);
      console.log(`Match started: ${t} mins between ${socket.id} and ${opponentid}`);
    } else {
      if (!waiting[t].includes(socket.id)) waiting[t].push(socket.id);
    }
  });

  socket.on('want_to_play_ai', (time) => {
    const t = String(time);
    if (!timeControls.includes(t)) return;
    const id = makeMatchId(socket.id, 'ai', t);
    const match = createMatch(id, socket.id, 'ai', t);
    setupRelays(match);
    sendMatchStateTo(players[socket.id], match);
    console.log(`AI Match started: ${t} mins for ${socket.id} vs AI`);
  });

  socket.on('spectate', (matchId) => addSpectator(socket, matchId));
  socket.on('reconnect_match', (matchId) => handleReconnect(socket, matchId));
  socket.on('claim_win_on_stall', (matchId) => handleStallClaim(socket, matchId));

  socket.on('disconnect', () => {
    timeControls.forEach(t => {
      waiting[t] = waiting[t].filter(id => id !== socket.id);
    });
    Object.values(matches).forEach(match => {
      if (match.players.white === socket.id || match.players.black === socket.id) {
        const opponentId = (match.players.white === socket.id) ? match.players.black : match.players.white;
        const opponentSock = players[opponentId];
        if (opponentSock && opponentId !== 'ai') {
          opponentSock.emit('opponent_disconnected', { matchId: match.id });
        }
      }
      if (match.spectators.has(socket.id)) match.spectators.delete(socket.id);
    });
    delete players[socket.id];
    delete playerNames[socket.id];
    totalplayers--;
    firetotalplayers();
  });
});

const PORT = process.env.PORT || 10000;
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Server is listening on port ${PORT}`);
  initStockfish(); // Initialize Stockfish after server starts
});
