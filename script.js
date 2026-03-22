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
let isOfflineMode = false;

// Piece values and evaluator
const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

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

// Sound
const moveSound = new Audio('sounds/move.mp3');
const captureSound = new Audio('sounds/capture.mp3');
const checkSound = new Audio('sounds/check.mp3');
let soundEnabled = true;

function playSound(audio) {
  if (!soundEnabled) return;
  audio.currentTime = 0;
  audio.play();
}
function playMoveSound() { playSound(moveSound); }
function playCaptureSound() { playSound(captureSound); }
function playCheckSound() { playSound(checkSound); }

function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function showConfirm(message, callback) {
  const modal = document.getElementById('confirmModal');
  const msg = document.getElementById('confirmMessage');
  const yesBtn = document.getElementById('confirmYes');
  const noBtn = document.getElementById('confirmNo');
  msg.textContent = message;
  modal.classList.remove('hidden');
  yesBtn.onclick = () => { modal.classList.add('hidden'); callback(true); };
  noBtn.onclick = () => { modal.classList.add('hidden'); callback(false); };
}

function startTimer(seconds, timerdisplay, oncomplete) {
  let startTime, timer, ms = seconds * 1000;
  const display = document.getElementById(timerdisplay);
  const obj = {
    resume() {
      startTime = Date.now();
      timer = setInterval(this.step, 250);
    },
    pause() {
      ms = this.step();
      clearInterval(timer);
    },
    step() {
      const now = Math.max(0, ms - (Date.now() - startTime));
      const m = Math.floor(now / 60000);
      let s = Math.floor(now / 1000) % 60;
      s = (s < 10 ? '0' : '') + s;
      if (display) display.innerHTML = `${m}:${s}`;
      if (now === 0) {
        clearInterval(timer);
        this.resume = function () {};
        if (oncomplete) oncomplete();
      }
      return now;
    }
  };
  obj.resume();
  return obj;
}
function pauseTimer(color) { if (color === 'w' && whiteTimer) whiteTimer.pause(); if (color === 'b' && blackTimer) blackTimer.pause(); }
function resumeTimer(color) { if (color === 'w' && whiteTimer) whiteTimer.resume(); if (color === 'b' && blackTimer) blackTimer.resume(); }
function initTimers(minutes) {
  if (!whiteTimer) {
    whiteTimer = startTimer(minutes * 60, 'white-timer-value', () => {
      socket.emit('time_out', { loser: 'w', winner: 'b' });
      showToast('White ran out of time. Black wins!');
      setTimeout(() => location.reload(), 1000);
    });
    whiteTimer.pause();
  }
  if (!blackTimer) {
    blackTimer = startTimer(minutes * 60, 'black-timer-value', () => {
      socket.emit('time_out', { loser: 'b', winner: 'w' });
      showToast('Black ran out of time. White wins!');
      setTimeout(() => location.reload(), 1000);
    });
    blackTimer.pause();
  }
}

const isTouch = window.matchMedia('(pointer: coarse)').matches;
function onDragStart(source, piece) {
  if (isTouch) return false;
  if (isSpectator) return false;
  if (game.game_over()) return false;
  if (isOfflineMode && game.turn() !== 'w') return false;
  if (!isOfflineMode && game.turn() !== c_player) return false;
  if ((game.turn() === 'w' && piece.startsWith('b')) || (game.turn() === 'b' && piece.startsWith('w'))) return false;
}

let pendingPromotion = null;
function maybeAiAfterHumanMove() {
  if (!isOfflineMode || game.game_over()) return;
  if (game.turn() === 'b') {
    setTimeout(() => {
      const aiMove = ai.playVsAI(game, 4, 1800);
      if (!aiMove) return;
      game.move(aiMove);
      board.position(game.fen(), true);
      updateStatus();
      playMoveSound();
    }, 60);
  }
}

function onDrop(source, target) {
  const moves = game.moves({ square: source, verbose: true });
  const isPromo = moves.some(m => m.from === source && m.to === target && m.flags.includes('p'));
  if (isPromo) { pendingPromotion = { from: source, to: target }; promoModal.classList.add('show'); return 'snapback'; }

  const move = game.move({ from: source, to: target, promotion: 'q' });
  if (!move) return 'snapback';

  pauseTimer('w'); pauseTimer('b'); resumeTimer(game.turn());
  if (move.flags.includes('c')) playCaptureSound(); else playMoveSound();
  if (game.in_check()) playCheckSound();
  if (!isOfflineMode) socket.emit('sync_state', game.fen(), game.turn()); else maybeAiAfterHumanMove();
  updateStatus();
}

function finalizePromotion(piece) {
  if (!pendingPromotion) return;
  const { from, to } = pendingPromotion;
  const mv = game.move({ from, to, promotion: piece });
  pendingPromotion = null;
  promoModal.classList.remove('show');
  if (!mv) { showToast('Illegal promotion'); return; }
  board.position(game.fen(), true);
  pauseTimer('w'); pauseTimer('b'); resumeTimer(game.turn());
  if (!isOfflineMode) socket.emit('sync_state', game.fen(), game.turn()); else maybeAiAfterHumanMove();
  updateStatus();
}
promoBtns.forEach(btn => btn.addEventListener('click', () => finalizePromotion(btn.dataset.piece)));

function onSnapEnd() { board.position(game.fen(), true); }
function onChange() { if (game.game_over() && game.in_checkmate()) { const winner = game.turn() === 'b' ? 'White' : 'Black'; if (!isOfflineMode) socket.emit('game_over', winner); } }

const config = { draggable: !isTouch, position: 'start', onDragStart, onDrop, onChange, onSnapEnd };
board = Chessboard('board1', config);

function updateStatus() {
  let status = '';
  const moveColor = game.turn() === 'b' ? 'Black' : 'White';
  if (game.in_checkmate()) status = 'Game over, ' + moveColor + ' is in checkmate.';
  else if (game.in_draw()) status = 'Game over, drawn position';
  else { status = moveColor + ' to move'; if (game.in_check()) status += ', ' + moveColor + ' is in check'; }
  const statusEl = document.getElementById('status'); if (statusEl) statusEl.textContent = status;
}

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
  if (isOfflineMode && game.turn() !== 'w') return false;
  if (!isOfflineMode && game.turn() !== c_player) return false;

  const moves = game.moves({ square: from, verbose: true });
  const isPromo = moves.some(m => m.from === from && m.to === to && m.flags.includes('p'));
  if (isPromo) { pendingPromotion = { from, to }; promoModal.classList.add('show'); return true; }
  const move = game.move({ from, to, promotion: 'q' });
  if (!move) return false;

  board.position(game.fen(), true);
  pauseTimer('w'); pauseTimer('b'); resumeTimer(game.turn());
  if (move.flags.includes('c')) playCaptureSound(); else playMoveSound();
  if (game.in_check()) playCheckSound();
  if (!isOfflineMode) socket.emit('sync_state', game.fen(), game.turn()); else maybeAiAfterHumanMove();
  updateStatus();
  return true;
}

function enableLongPressSelect() {
  getSquareElements().forEach(el => {
    const sq = squareIdFromEl(el);
    if (!sq) return;
    el.addEventListener('touchstart', () => { pressTimer = setTimeout(() => { selectedSquare = sq; clearHighlights(); highlightLegalMoves(sq); }, 600); }, { passive: true });
    el.addEventListener('touchend', () => { clearTimeout(pressTimer); });
    el.addEventListener('click', () => {
      if (!selectedSquare) return;
      if (sq === selectedSquare) { selectedSquare = null; clearHighlights(); return; }
      const ok = attemptTapMove(selectedSquare, sq);
      selectedSquare = null;
      clearHighlights();
      if (!ok) showToast('Illegal move');
    }, { passive: true });
  });
}
function refreshTapBindings() { enableLongPressSelect(); }
refreshTapBindings();
const originalSetPosition = board.position.bind(board);
board.position = function (fen, animated) { originalSetPosition(fen, animated); refreshTapBindings(); };

function Handlebuttonclick(event) {
  const time = Number(event.target.getAttribute('data-time'));
  socket.emit('want_to_play', time);
  document.getElementById('main-element').style.display = 'none';
}

function setOfflineMode(active) {
  isOfflineMode = active;
  if (active) {
    c_player = 'w';
    isSpectator = false;
    game.reset(); board.clear(); board.start(); board.orientation('white');
    pauseTimer('w'); pauseTimer('b'); resumeTimer('w'); updateStatus();
    showToast('Offline AI mode activated (you play White).');
  } else {
    showToast('Online mode activated.');
  }
}

function updateSoundButton() {
  const btn = document.getElementById('sound_toggle');
  if (!btn) return;
  btn.textContent = soundEnabled ? '🔊 Sound: On' : '🔇 Sound: Off';
}

function playAIMove() {
  if (!isOfflineMode || game.game_over() || game.turn() !== 'b') return;
  const aiMove = ai.playVsAI(game, 4, 1800);
  if (!aiMove) return;
  game.move(aiMove);
  board.position(game.fen(), true);
  updateStatus();
  playMoveSound();
}

class Evaluator {
  evaluate(game) {
    const fen = game.fen();
    const pieces = fen.split(' ')[0].replace(/\d/g, '').replace(/\//g, '');
    let score = 0;
    for (const piece of pieces) {
      const value = PIECE_VALUES[piece.toLowerCase()] || 0;
      score += piece === piece.toUpperCase() ? value : -value;
    }
    return score;
  }
  getValue(piece) {
    if (!piece) return 0;
    return PIECE_VALUES[piece.toLowerCase()] || 0;
  }
}

class ChessAI {
  constructor() { this.evaluator = new Evaluator(); this.transpositionTable = new Map(); }

  playVsAI(game, maxDepth = 4, timeLimitMs = 1800) {
    const start = Date.now();
    let bestMove = null;
    let bestScore = -Infinity;
    const rootMoves = game.moves({ verbose: true });

    for (let depth = 1; depth <= maxDepth; depth++) {
      let localBest = null;
      let localScore = -Infinity;
      for (const move of rootMoves) {
        if (Date.now() - start >= timeLimitMs) break;
        game.move(move);
        const score = this.minimax(game, depth - 1, -Infinity, Infinity, false);
        game.undo();
        if (score > localScore) { localScore = score; localBest = move; }
      }
      if (localBest !== null) { bestMove = localBest; bestScore = localScore; }
      if (Date.now() - start >= timeLimitMs) break;
    }
    return bestMove;
  }

  minimax(game, depth, alpha, beta, maximizing) {
    const hash = game.fen();
    if (this.transpositionTable.has(hash)) return this.transpositionTable.get(hash);

    if (depth === 0 || game.game_over()) {
      const evalScore = this.quiescence(game, alpha, beta);
      this.transpositionTable.set(hash, evalScore);
      return evalScore;
    }

    const moves = this.orderMoves(game);
    if (maximizing) {
      let value = -Infinity;
      for (const move of moves) {
        game.move(move);
        const score = this.minimax(game, depth - 1, alpha, beta, false);
        game.undo();
        value = Math.max(value, score);
        alpha = Math.max(alpha, score);
        if (beta <= alpha) break;
      }
      this.transpositionTable.set(hash, value);
      return value;
    } else {
      let value = Infinity;
      for (const move of moves) {
        game.move(move);
        const score = this.minimax(game, depth - 1, alpha, beta, true);
        game.undo();
        value = Math.min(value, score);
        beta = Math.min(beta, score);
        if (beta <= alpha) break;
      }
      this.transpositionTable.set(hash, value);
      return value;
    }
  }

  quiescence(game, alpha, beta) {
    const standPat = this.evaluator.evaluate(game);
    if (standPat >= beta) return beta;
    alpha = Math.max(alpha, standPat);

    const captures = game.moves({ verbose: true }).filter(m => m.flags.includes('c'));
    for (const move of captures) {
      game.move(move);
      const score = -this.quiescence(game, -beta, -alpha);
      game.undo();
      if (score >= beta) return beta;
      alpha = Math.max(alpha, score);
    }
    return alpha;
  }

  orderMoves(game) {
    return game.moves({ verbose: true }).sort((a, b) => this.scoreMove(b) - this.scoreMove(a));
  }

  scoreMove(move) {
    let s = 0;
    if (move.flags.includes('c')) s += 1000 + this.evaluator.getValue(move.captured);
    if (move.flags.includes('k')) s += 500;
    return s;
  }
}

const ai = new ChessAI();

function playAiBtn() {
  if (!isOfflineMode) { setOfflineMode(true); return; }
  playAIMove();
}

function registerEventListeners() {
  const buttons = document.getElementsByClassName('timer-button');
  for (let i = 0; i < buttons.length; i++) {
    const b = buttons[i];
    if (b.getAttribute('data-time')) b.addEventListener('click', Handlebuttonclick);
  }
  setNameBtn.addEventListener('click', () => {
    const n = nameInput.value.trim();
    if (!n) return showToast('Enter a name');
    socket.emit('set_name', n);
    showToast('Name set: ' + n);
  });
  drawBtn.addEventListener('click', () => socket.emit('draw_offer'));
  takebackBtn.addEventListener('click', () => socket.emit('takeback_request'));
  rematchBtn.addEventListener('click', () => socket.emit('rematch_request'));
  stallBtn.addEventListener('click', () => { if (!matchId) return; socket.emit('claim_win_on_stall', matchId); });
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
  const playAiBtnEl = document.getElementById('playAiBtn');
  if (playAiBtnEl) playAiBtnEl.addEventListener('click', playAiBtn);
  const offlineToggle = document.getElementById('toggleOfflineAI');
  if (offlineToggle) offlineToggle.addEventListener('click', () => setOfflineMode(!isOfflineMode));
  const soundToggle = document.getElementById('sound_toggle');
  if (soundToggle) soundToggle.addEventListener('click', () => { soundEnabled = !soundEnabled; updateSoundButton(); });
}

registerEventListeners();
updateSoundButton();

socket.on('I am connected', () => showToast('Connected to server'));
socket.on('total_players_count_change', count => { const t = document.getElementById('total_players'); if (t) t.textContent = 'Total players connected: ' + count; });
socket.on('match_found', payload => {
  isOfflineMode = false; isSpectator = false; matchId = payload.matchId;
  c_player = payload.color === 'white' ? 'w' : 'b';
  document.getElementById('main-element').style.display = 'flex';
  document.getElementById('youareplayingas').textContent = `You are playing as ${payload.color} vs ${payload.opponentName}`;
  currenttimer = payload.time; initTimers(currenttimer);
  game.reset(); board.clear(); board.start(); board.orientation(payload.color);
  pauseTimer('w'); pauseTimer('b'); if (game.turn() === 'w') resumeTimer('w'); else resumeTimer('b');
  refreshTapBindings();
});
socket.on('sync_state_from_server', (fen, turn) => {
  if (isOfflineMode) return;
  game.load(fen); board.position(fen, true); pauseTimer('w'); pauseTimer('b'); resumeTimer(game.turn()); updateStatus(); refreshTapBindings();
});
socket.on('game_over_from_server', winner => { showToast(`Game over! ${winner} wins!`); setTimeout(() => location.reload(), 1500); });
socket.on('time_out_from_server', payload => { if (payload && payload.winner) { showToast(`Time out: ${payload.winner} wins!`); setTimeout(() => location.reload(), 1500); } });
socket.on('draw_offer_from_server', ({ from }) => showConfirm(`${from} offered a draw. Accept?`, accept => socket.emit('draw_response', accept)));
socket.on('draw_declined', () => showToast('Draw offer declined'));
socket.on('takeback_offer_from_server', ({ from }) => showConfirm(`${from} requested a takeback. Accept?`, accept => socket.emit('takeback_response', accept)));
socket.on('takeback_declined', () => showToast('Takeback declined'));
socket.on('rematch_offer_from_server', ({ from }) => showConfirm(`${from} requested a rematch. Accept?`, accept => socket.emit('rematch_response', accept)));
socket.on('rematch_declined', () => showToast('Rematch declined'));
socket.on('opponent_disconnected', () => showToast('Opponent disconnected. You may wait or claim win on stall.'));
socket.on('stall_claim_rejected', ({ reason }) => showToast(`Stall claim rejected: ${reason}`));
socket.on('spectate_joined', info => { isSpectator = true; matchId = info.matchId; document.getElementById('youareplayingas').textContent = `Spectating ${info.white} vs ${info.black} (${info.time} mins)`; const w = document.getElementById('waiting_para_1'); if (w) w.style.display = 'none'; document.getElementById('main-element').style.display = 'flex'; showToast('Joined as spectator'); });
socket.on('spectate_error', msg => showToast('Spectate error: ' + msg));
socket.on('chat_message_from_server', ({ from, text }) => { const p = document.createElement('p'); p.textContent = `${from}: ${text}`; chatLog.appendChild(p); chatLog.scrollTop = chatLog.scrollHeight; });