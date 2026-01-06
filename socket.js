// socket.js

const express = require('express');
const path = require('path');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(express.static(__dirname));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

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
      black: playerNames[b] || b
    },
    spectators: new Set(),
    fen: 'start',
    turn: 'w',
    lastMoveTime: Date.now(),
    status: 'playing', // playing | draw | checkmate | timeout
    offer: { type: null, from: null }, // draw | takeback | rematch
    history: [], // store FENs for takeback
  };
  return matches[id];
}

function sendMatchStateTo(socket, match) {
  socket.emit('match_found', {
    matchId: match.id,
    opponentid: (socket.id === match.players.white) ? match.players.black : match.players.white,
    opponentName: (socket.id === match.players.white) ? match.names.black : match.names.white,
    color: (socket.id === match.players.white) ? 'white' : 'black',
    time: match.time
  });
  socket.emit('sync_state_from_server', match.fen, match.turn);
}

function setupRelays(match) {
  const { white, black } = match.players;
  const ws = players[white];
  const bs = players[black];
  if (!ws || !bs) return;

  // Move sync: relay FEN and turn, update server-side stall clock and history
  const syncHandler = (fromSock, toSock) => {
    fromSock.on('sync_state', ($fen, turn) => {
      if (!matches[match.id]) return;
      match.fen = $fen;
      match.turn = turn;
      match.lastMoveTime = Date.now();
      match.history.push($fen);
      toSock.emit('sync_state_from_server', $fen, turn);
      // Spectators get the update too
      match.spectators.forEach(sid => {
        const specSock = players[sid];
        if (specSock) specSock.emit('sync_state_from_server', $fen, turn);
      });
    });
  };
  syncHandler(ws, bs);
  syncHandler(bs, ws);

  // Game over
  const gameOverHandler = (fromSock, toSock) => {
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
  gameOverHandler(bs, ws);

  // Time out
  const timeOutHandler = (fromSock, toSock) => {
    fromSock.on('time_out', (payload) => {
      if (!matches[match.id]) return;
      match.status = 'timeout';
      toSock.emit('time_out_from_server', payload);
      toSock.emit('game_over_from_server', payload.winner);
      match.spectators.forEach(sid => {
        const specSock = players[sid];
        if (specSock) specSock.emit('time_out_from_server', payload);
      });
    });
  };
  timeOutHandler(ws, bs);
  timeOutHandler(bs, ws);

  // Draw offers
  const drawHandler = (fromSock, toSock) => {
    fromSock.on('draw_offer', () => {
      match.offer = { type: 'draw', from: fromSock.id };
      toSock.emit('draw_offer_from_server', { from: playerNames[fromSock.id] || fromSock.id });
    });
    fromSock.on('draw_response', (accepted) => {
      if (accepted) {
        match.status = 'draw';
        ws.emit('game_over_from_server', 'Draw');
        bs.emit('game_over_from_server', 'Draw');
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
  drawHandler(bs, ws);

  // Takeback
  const takebackHandler = (fromSock, toSock) => {
    fromSock.on('takeback_request', () => {
      match.offer = { type: 'takeback', from: fromSock.id };
      toSock.emit('takeback_offer_from_server', { from: playerNames[fromSock.id] || fromSock.id });
    });
    fromSock.on('takeback_response', (accepted) => {
      if (accepted && match.history.length >= 2) {
        // Roll back one move: use the previous FEN
        match.history.pop(); // current
        const prevFen = match.history.pop(); // previous
        match.fen = prevFen;
        match.lastMoveTime = Date.now();
        ws.emit('sync_state_from_server', prevFen, match.turn);
        bs.emit('sync_state_from_server', prevFen, match.turn);
        match.spectators.forEach(sid => {
          const specSock = players[sid];
          if (specSock) specSock.emit('sync_state_from_server', prevFen, match.turn);
        });
      } else {
        toSock.emit('takeback_declined');
      }
      match.offer = { type: null, from: null };
    });
  };
  takebackHandler(ws, bs);
  takebackHandler(bs, ws);

  // Rematch
  const rematchHandler = (fromSock, toSock) => {
    fromSock.on('rematch_request', () => {
      match.offer = { type: 'rematch', from: fromSock.id };
      toSock.emit('rematch_offer_from_server', { from: playerNames[fromSock.id] || fromSock.id });
    });
    fromSock.on('rematch_response', (accepted) => {
      if (accepted) {
        // Create a fresh match with same players/time
        const newId = makeMatchId(white, black, match.time);
        const newMatch = createMatch(newId, white, black, match.time);
        setupRelays(newMatch);
        sendMatchStateTo(ws, newMatch);
        sendMatchStateTo(bs, newMatch);
      } else {
        toSock.emit('rematch_declined');
      }
      match.offer = { type: null, from: null };
    });
  };
  rematchHandler(ws, bs);
  rematchHandler(bs, ws);

  // Chat
  const chatHandler = (fromSock, toSock) => {
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
    // Already part of match: push the latest state
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

  socket.on('spectate', (matchId) => addSpectator(socket, matchId));
  socket.on('reconnect_match', (matchId) => handleReconnect(socket, matchId));
  socket.on('claim_win_on_stall', (matchId) => handleStallClaim(socket, matchId));

  socket.on('disconnect', () => {
    // Clean waiting lists
    timeControls.forEach(t => {
      waiting[t] = waiting[t].filter(id => id !== socket.id);
    });
    // Inform matches if a player left
    Object.values(matches).forEach(match => {
      if (match.players.white === socket.id || match.players.black === socket.id) {
        const opponentId = (match.players.white === socket.id) ? match.players.black : match.players.white;
        const opponentSock = players[opponentId];
        if (opponentSock) {
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
});
// End of socket.js
