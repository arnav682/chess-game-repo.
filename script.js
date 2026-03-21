// script.js

// Setup
const socket = io();
let game = new Chess();
let board = null;
let c_player = null;
let currenttimer = null;
let whiteTimer = null;
let blackTimer = null;
let matchId = null;
let isSpectator = false;

// UI refs
const nameInput = document.getElementById('player_name');
const setNameBtn = document.getElementById('set_name_btn');
const drawBtn = document.getElementById('offer_draw');
const takebackBtn = document.getElementById('request_takeback');
const stallBtn = document.getElementById('claim_stall');
const rematchBtn = document.getElementById('request_rematch');
const spectateIdInput = document.getElementById('spectate_id');
const spectateBtn = document.getElementById('spectate_btn');
const chatInput = document.getElementById('chat_input');
const chatSend = document.getElementById('chat_send');
const chatLog = document.getElementById('chat_log');
const promoModal = document.getElementById('promotion_modal');
const promoBtns = document.querySelectorAll('.promo-btn');

//Sounds 

const moveSound = new Audio('sounds/move.mp3');
const captureSound = new Audio('sounds/capture.mp3');
const checkSound = new Audio('sounds/check.mp3');


function playMoveSound() { moveSound.play(); }
function playCaptureSound() { captureSound.play(); }
function playCheckSound() { checkSound.play(); }



// Toast
function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// Modal helper
function showConfirm(message, callback) {
  const modal = document.getElementById("confirmModal");
  const msg = document.getElementById("confirmMessage");
  const yesBtn = document.getElementById("confirmYes");
  const noBtn = document.getElementById("confirmNo");

  msg.textContent = message;
  modal.classList.remove("hidden");

  yesBtn.onclick = () => {
    modal.classList.add("hidden");
    callback(true);
  };
  noBtn.onclick = () => {
    modal.classList.add("hidden");
    callback(false);
  };
}

onDrop
// Timers
function startTimer(seconds, timerdisplay, oncomplete) {
  let startTime, timer, obj, ms = seconds * 1000,
    display = document.getElementById(timerdisplay);
  obj = {};
  obj.resume = function () { startTime = Date.now(); timer = setInterval(obj.step, 250); };
  obj.pause = function () { ms = obj.step(); clearInterval(timer); };
  obj.step = function () {
    let now = Math.max(0, ms - (Date.now() - startTime)),
      m = Math.floor(now / 60000), s = Math.floor(now / 1000) % 60;
    s = (s < 10 ? '0' : '') + s;
    if (display) display.innerHTML = m + ':' + s;
    if (now === 0) { clearInterval(timer); obj.resume = function () { }; if (oncomplete) oncomplete(); }
    return now;
  };
  obj.resume();
  return obj;
}
function pauseTimer(color) { if (color === 'w' && whiteTimer) whiteTimer.pause(); if (color === 'b' && blackTimer) blackTimer.pause(); }
function resumeTimer(color) { if (color === 'w' && whiteTimer) whiteTimer.resume(); if (color === 'b' && blackTimer) blackTimer.resume(); }
function initTimers(minutes) {
  if (!whiteTimer) {
    whiteTimer = startTimer(Number(minutes) * 60, 'white-timer-value', () => {
      socket.emit('time_out', { loser: 'w', winner: 'b' });
      showToast('White ran out of time. Black wins!');
      setTimeout(() => location.reload(), 1000);
    });
    whiteTimer.pause();
  }
  if (!blackTimer) {
    blackTimer = startTimer(Number(minutes) * 60, 'black-timer-value', () => {
      socket.emit('time_out', { loser: 'b', winner: 'w' });
      showToast('Black ran out of time. White wins!');
      setTimeout(() => location.reload(), 1000);
    });
    blackTimer.pause();
  }
}

// Board
const isTouch = window.matchMedia('(pointer: coarse)').matches;
function onDragStart(source, piece) {
  if (isTouch) return false;
  if (isSpectator) return false;
  if (game.turn() !== c_player) return false;
  if (game.game_over()) return false;
  if ((game.turn() === 'w' && piece.startsWith('b')) || (game.turn() === 'b' && piece.startsWith('w'))) return false;
}
let pendingPromotion = null;
function onDrop(source, target) {
  // Handle promotion via modal
  const moves = game.moves({ square: source, verbose: true });
  const isPromo = moves.some(m => m.from === source && m.to === target && m.flags.includes('p'));
  if (isPromo) {
    pendingPromotion = { from: source, to: target };
    promoModal.classList.add('show');
    return 'snapback';
  }
  const move = game.move({ from: source, to: target, promotion: 'q' });
  if (move === null) return 'snapback';
  pauseTimer('w'); pauseTimer('b');
  resumeTimer(game.turn());

  // Play sounds
  if (move.flags.includes('c')) playCaptureSound();
  else playMoveSound();
  if (game.in_check()) playCheckSound();
  socket.emit('sync_state', game.fen(), game.turn());
  updateStatus();
}
function finalizePromotion(piece) {
  if (!pendingPromotion) return;
  const { from, to } = pendingPromotion;
  const mv = game.move({ from, to, promotion: piece });
  pendingPromotion = null;
  promoModal.classList.remove('show');
  if (!mv) { showToast('Illegal promotion'); return; }
  board.position(game.fen(), true); // animated
  pauseTimer('w'); pauseTimer('b'); resumeTimer(game.turn());
  socket.emit('sync_state', game.fen(), game.turn());
  updateStatus();
}
promoBtns.forEach(btn => btn.addEventListener('click', () => finalizePromotion(btn.dataset.piece)));

function onSnapEnd() { board.position(game.fen(), true); }
function onChange() {
  if (game.game_over() && game.in_checkmate()) {
    const winner = game.turn() === 'b' ? 'White' : 'Black';
    socket.emit('game_over', winner);
  }
}
const config = { draggable: !isTouch, position: 'start', onDragStart, onDrop, onChange, onSnapEnd };
board = Chessboard('board1', config);

// Status
function updateStatus() {
  let status = '';
  let moveColor = game.turn() === 'b' ? 'Black' : 'White';
  if (game.in_checkmate()) status = 'Game over, ' + moveColor + ' is in checkmate.';
  else if (game.in_draw()) status = 'Game over, drawn position';
  else { status = moveColor + ' to move'; if (game.in_check()) status += ', ' + moveColor + ' is in check'; }
  const statusEl = document.getElementById('status'); if (statusEl) statusEl.textContent = status;
}

// Mobile long-press + tap
let selectedSquare = null;
let pressTimer = null;
function getSquareElements() { return document.querySelectorAll('#board1 [data-square], #board1 .square-55d63'); }
function squareIdFromEl(el) {
  const ds = el.getAttribute('data-square'); if (ds) return ds;
  const cls = Array.from(el.classList).find(c => c.startsWith('square-') && c.length === 8);
  return cls ? cls.split('-')[1] : null;
}
function clearHighlights() { getSquareElements().forEach(el => el.classList.remove('highlight-source', 'highlight-target')); }
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
  if (isSpectator) return false;
  if (game.turn() !== c_player) return false;
  const moves = game.moves({ square: from, verbose: true });
  const isPromo = moves.some(m => m.from === from && m.to === to && m.flags.includes('p'));
  if (isPromo) {
    pendingPromotion = { from, to };
    promoModal.classList.add('show');
    return true;
  }
  const move = game.move({ from, to, promotion: 'q' });
  if (!move) return false;
  board.position(game.fen(), true);
  pauseTimer('w'); pauseTimer('b'); resumeTimer(game.turn());

  // Play sounds
  if (move.flags.includes('c')) playCaptureSound();
  else playMoveSound();
  if (game.in_check()) playCheckSound();

  socket.emit('sync_state', game.fen(), game.turn());
  updateStatus();
  return true;
}
function enableLongPressSelect() {
  getSquareElements().forEach(el => {
    const sq = squareIdFromEl(el);
    if (!sq) return;
    el.addEventListener('touchstart', () => {
      pressTimer = setTimeout(() => { selectedSquare = sq; clearHighlights(); highlightLegalMoves(sq); }, 600);
    }, { passive: true });
    el.addEventListener('touchend', () => { clearTimeout(pressTimer); });
    el.addEventListener('click', () => {
      if (!selectedSquare) return;
      if (sq === selectedSquare) { selectedSquare = null; clearHighlights(); return; }
      const ok = attemptTapMove(selectedSquare, sq);
      selectedSquare = null; clearHighlights();
      if (!ok) showToast('Illegal move');
    }, { passive: true });
  });
}
function refreshTapBindings() { enableLongPressSelect(); }
refreshTapBindings();
const originalSetPosition = board.position.bind(board);
board.position = function (fen, animated) { originalSetPosition(fen, animated); refreshTapBindings(); };

// Matchmaking buttons
function Handlebuttonclick(event) {
  const time = Number(event.target.getAttribute('data-time'));
  socket.emit('want_to_play', time);
  document.getElementById('main-element').style.display = 'none';
}
document.addEventListener('DOMContentLoaded', function () {
  // Existing timer button handlers
  const buttons = document.getElementsByClassName('timer-button');
  for (let i = 0; i < buttons.length; i++) {
    const b = buttons[i];
    if (b.getAttribute('data-time')) b.addEventListener('click', Handlebuttonclick);
  }

  // Add these inside DOMContentLoaded
  setNameBtn.addEventListener('click', () => {
    const n = nameInput.value.trim();
    if (!n) return showToast('Enter a name');
    socket.emit('set_name', n);
    showToast('Name set: ' + n);
  });

  drawBtn.addEventListener('click', () => socket.emit('draw_offer'));
  takebackBtn.addEventListener('click', () => socket.emit('takeback_request'));
  rematchBtn.addEventListener('click', () => socket.emit('rematch_request'));
  stallBtn.addEventListener('click', () => {
    if (!matchId) return;
    socket.emit('claim_win_on_stall', matchId);
  });

  spectateBtn.addEventListener('click', () => {
    const id = spectateIdInput.value.trim();
    if (!id) return showToast('Enter match ID to spectate');
    socket.emit('spectate', id);
  });

  chatSend.addEventListener('click', () => {
    const text = chatInput.value.trim();
    if (!text) return;
    socket.emit('chat_message', text);
    chatInput.value = '';
  });

  // Move playAiBtn listener here (from global scope)
  document.getElementById("playAiBtn").addEventListener("click", playAiBtn);

  // Sound toggle (remove duplicate later in file)
  document.getElementById("sound_toggle").addEventListener("click", () => {
    soundEnabled = !soundEnabled;
    updateSoundButton();
  });
});

// AI opponent (client-side only)
async function playAiBtn() {
  if (game.turn() !== 'b') return; // AI plays as Black

  const aiMove = ai.playVsAI(game, 5, 2000);
  if (aiMove) {
    game.move(aiMove);
    board.position(game.fen(), true);
    updateStatus();
    playMoveSound();
  }
}

// --- Sound Toggle ---
let soundEnabled = true;

function updateSoundButton() {
  const btn = document.getElementById("sound_toggle");
  if (!btn) return;
  btn.textContent = soundEnabled ? "🔊 Sound: On" : "🔇 Sound: Off";
}

document.getElementById("sound_toggle").addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  updateSoundButton();
});

// Wrapper to play sounds only if enabled
function playSound(audio) {
  if (soundEnabled) {
    audio.currentTime = 0; // reset to start
    audio.play();
  }
}

// Replace direct .play() calls with playSound()
function playMoveSound() { playSound(moveSound); }
function playCaptureSound() { playSound(captureSound); }
function playCheckSound() { playSound(checkSound); }

// Initialize button text when page loads
updateSoundButton();


// Sockets
socket.on('I am connected', () => showToast('Connected to server'));

socket.on('total_players_count_change', (count) => {
  document.getElementById('total_players').textContent = 'Total players connected: ' + count;
});

socket.on('match_found', (payload) => {
  isSpectator = false;
  matchId = payload.matchId;
  console.log("Match ID:", payload.matchId);
  c_player = payload.color === 'white' ? 'w' : 'b';
  document.getElementById('main-element').style.display = 'flex';
  document.getElementById('youareplayingas').textContent =
    `You are playing as ${payload.color} vs ${payload.opponentName}`;

  currenttimer = payload.time;
  initTimers(currenttimer);

  game.reset();
  board.clear();
  board.start();
  board.orientation(payload.color);

  pauseTimer('w'); pauseTimer('b');
  if (game.turn() === 'w') resumeTimer('w'); else resumeTimer('b');

  refreshTapBindings();
});

socket.on('sync_state_from_server', (fen, turn) => {
  game.load(fen);
  board.position(fen, true);
  pauseTimer('w'); pauseTimer('b'); resumeTimer(game.turn());
  updateStatus();
  refreshTapBindings();
});

socket.on('game_over_from_server', (winner) => {
  showToast(`Game over! ${winner} wins!`);
  setTimeout(() => location.reload(), 1500);
});

socket.on('time_out_from_server', (payload) => {
  if (payload && payload.winner) {
    showToast(`Time out: ${payload.winner} wins!`);
    setTimeout(() => location.reload(), 1500);
  }
});

socket.on("draw_offer_from_server", ({ from }) => {
  showConfirm(`${from} offered a draw. Accept?`, (accept) => {
    socket.emit("draw_response", accept);
  });
});

socket.on('draw_declined', () => showToast('Draw offer declined'));


socket.on("takeback_offer_from_server", ({ from }) => {
  showConfirm(`${from} requested a takeback. Accept?`, (accept) => {
    socket.emit("takeback_response", accept);
  });
});

socket.on('takeback_declined', () => showToast('Takeback declined'));

socket.on("rematch_offer_from_server", ({ from }) => {
  showConfirm(`${from} requested a rematch. Accept?`, (accept) => {
    socket.emit("rematch_response", accept);
  });
});

socket.on('rematch_declined', () => showToast('Rematch declined'));

socket.on('opponent_disconnected', ({ matchId }) => {
  showToast('Opponent disconnected. You may wait or claim win on stall.');
});

socket.on('stall_claim_rejected', ({ reason }) => showToast(`Stall claim rejected: ${reason}`));

socket.on('spectate_joined', (info) => {
  isSpectator = true;
  matchId = info.matchId;
  document.getElementById('youareplayingas').textContent =
    `Spectating ${info.white} vs ${info.black} (${info.time} mins)`;
  document.getElementById('waiting_para_1').style.display = 'none';
  document.getElementById('main-element').style.display = 'flex';
  showToast('Joined as spectator');
});

socket.on('spectate_error', (msg) => showToast('Spectate error: ' + msg));

socket.on('chat_message_from_server', ({ from, text }) => {
  const p = document.createElement('p');
  p.textContent = `${from}: ${text}`;
  chatLog.appendChild(p);
  chatLog.scrollTop = chatLog.scrollHeight;
});

// Simple piece values for evaluation (expand as needed)
const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

// Basic evaluator (port of your Evaluator)
class Evaluator {
  evaluate(board) {
    let score = 0;
    const fen = board.fen();
    // Simple material count (you can add positional bonuses)
    const pieces = fen.split(' ')[0].replace(/\d/g, '').replace(/\//g, '');
    for (const piece of pieces) {
      const value = PIECE_VALUES[piece.toLowerCase()] || 0;
      score += piece === piece.toUpperCase() ? value : -value; // White positive, Black negative
    }
    return score;
  }

  getValue(piece) {
    return PIECE_VALUES[piece.toLowerCase()] || 0;
  }
}

// ChessAI class (ported minimax) - Fixed for strict mode
class ChessAI {
  constructor() {
    this.evaluator = new Evaluator();
    this.transpositionTable = new Map();
  }

  playVsAI(game, maxDepth = 5, timeLimitMs = 2000) {
    const start = Date.now();
    let bestMove = null;
    let bestScore = -Infinity;

    const moves = game.moves({ verbose: true });
    for (const move of moves) {
      game.move(move);
      const score = this.minimax(game, maxDepth - 1, -Infinity, Infinity, false);
      game.undo();
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
      if (Date.now() - start > timeLimitMs) break;
    }
    return bestMove;
  }

  minimax(game, depth, alpha, beta, maximizingPlayer) {
    const hash = game.fen(); // Simple hash (use Zobrist for better performance)
    if (this.transpositionTable.has(hash)) return this.transpositionTable.get(hash);

    if (depth === 0 || game.game_over()) {
      const evaluation = this.quiescence(game, alpha, beta);
      this.transpositionTable.set(hash, evaluation);
      return evaluation;
    }

    const moves = this.orderMoves(game);
    if (maximizingPlayer) {
      let maxEval = -Infinity;
      for (const move of moves) {
        game.move(move);
        const evaluation = this.minimax(game, depth - 1, alpha, beta, false);
        game.undo();
        maxEval = Math.max(maxEval, evaluation);
        alpha = Math.max(alpha, evaluation);
        if (beta <= alpha) break;
      }
      this.transpositionTable.set(hash, maxEval);
      return maxEval;
    } else {
      let minEval = Infinity;
      for (const move of moves) {
        game.move(move);
        const evaluation = this.minimax(game, depth - 1, alpha, beta, true);
        game.undo();
        minEval = Math.min(minEval, evaluation);
        beta = Math.min(beta, evaluation);
        if (beta <= alpha) break;
      }
      this.transpositionTable.set(hash, minEval);
      return minEval;
    }
  }

  quiescence(game, alpha, beta) {
    const standPat = this.evaluator.evaluate(game);
    if (standPat >= beta) return beta;
    if (alpha < standPat) alpha = standPat;

    const captures = game.moves({ verbose: true }).filter(m => m.flags.includes('c'));
    for (const move of captures) {
      game.move(move);
      const score = -this.quiescence(game, -beta, -alpha);
      game.undo();
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  orderMoves(game) {
    return game.moves({ verbose: true }).sort((a, b) => this.scoreMove(b) - this.scoreMove(a));
  }

  scoreMove(move) {
    if (move.flags.includes('c')) return 1000 + this.evaluator.getValue(move.captured);
    if (game.in_check()) return 500; // Approximate check detection
    return 0;
  }
}

// Update playAiBtn to use the JS AI
const ai = new ChessAI();
async function playAiBtn() {
  if (game.turn() !== 'b') return; // AI plays as Black

  const aiMove = ai.playVsAI(game, 5, 2000);
  if (aiMove) {
    game.move(aiMove);
    board.position(game.fen(), true);
    updateStatus();
    playMoveSound();
  }
}