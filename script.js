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

// UI refs (guarded)
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
const promoModal = document.getElementById('promotion_modal'); // may be null if not added to HTML
const promoBtns = document.querySelectorAll('.promo-btn'); // NodeList (may be empty)
const playAiBtn = document.getElementById('play_ai');
const statusEl = document.getElementById('status');
const waitingPara1 = document.getElementById('waiting_para_1'); // optional element

// Toast
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
  obj.resume = function () { startTime = Date.now(); timer = setInterval(obj.step, 250); };
  obj.pause = function () { ms = obj.step(); clearInterval(timer); };
  obj.step = function () {
    let now = Math.max(0, ms - (Date.now() - startTime)),
      m = Math.floor(now / 60000), s = Math.floor(now / 1000) % 60;
    s = (s < 10 ? '0' : '') + s;
    if (display) display.innerHTML = m + ':' + s;
    if (now === 0) { clearInterval(timer); obj.resume = function(){}; if (oncomplete) oncomplete(); }
    return now;
  };
  obj.resume();
  return obj;
}
function pauseTimer(color){ if(color==='w'&&whiteTimer)whiteTimer.pause(); if(color==='b'&&blackTimer)blackTimer.pause(); }
function resumeTimer(color){ if(color==='w'&&whiteTimer)whiteTimer.resume(); if(color==='b'&&blackTimer)blackTimer.resume(); }
function initTimers(minutes) {
  if (!whiteTimer) {
    whiteTimer = startTimer(Number(minutes)*60, 'white-timer-value', () => {
      socket.emit('time_out', { loser: 'w', winner: 'b' });
      showToast('White ran out of time. Black wins!');
      setTimeout(() => location.reload(), 1000);
    });
    whiteTimer.pause();
  }
  if (!blackTimer) {
    blackTimer = startTimer(Number(minutes)*60, 'black-timer-value', () => {
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
  if (!c_player) return false; // not assigned yet
  if (game.turn() !== c_player) return false;
  if (game.game_over()) return false;
  if ((game.turn() === 'w' && piece.startsWith('b')) || (game.turn() === 'b' && piece.startsWith('w'))) return false;
}
let pendingPromotion = null;
function onDrop(source, target) {
  // Handle promotion via modal (guarded)
  const moves = game.moves({ square: source, verbose: true });
  const isPromo = moves.some(m => m.from === source && m.to === target && m.flags.includes('p'));
  if (isPromo) {
    pendingPromotion = { from: source, to: target };
    if (promoModal) promoModal.classList.add('show');
    return 'snapback';
  }
  const move = game.move({ from: source, to: target, promotion: 'q' });
  if (move === null) return 'snapback';
  board.position(game.fen(), true); // animate
  pauseTimer('w'); pauseTimer('b');
  resumeTimer(game.turn());
  socket.emit('sync_state', game.fen(), game.turn());
  updateStatus();
}
function finalizePromotion(piece) {
  if (!pendingPromotion) return;
  const { from, to } = pendingPromotion;
  const mv = game.move({ from, to, promotion: piece });
  pendingPromotion = null;
  if (promoModal) promoModal.classList.remove('show');
  if (!mv) { showToast('Illegal promotion'); return; }
  board.position(game.fen(), true); // animated
  pauseTimer('w'); pauseTimer('b'); resumeTimer(game.turn());
  socket.emit('sync_state', game.fen(), game.turn());
  updateStatus();
}
if (promoBtns && promoBtns.length) {
  promoBtns.forEach(btn => btn.addEventListener('click', () => finalizePromotion(btn.dataset.piece)));
}

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
  if (statusEl) statusEl.textContent = status;
}

// Mobile long-press + tap
let selectedSquare = null;
let pressTimer = null;
function getSquareElements() { return document.querySelectorAll('#board1 [data-square], #board1 .square-55d63'); }
function squareIdFromEl(el) {
  if (!el) return null;
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
  if (!c_player) return false;
  if (game.turn() !== c_player) return false;
  const moves = game.moves({ square: from, verbose: true });
  const isPromo = moves.some(m => m.from === from && m.to === to && m.flags.includes('p'));
  if (isPromo) {
    pendingPromotion = { from, to };
    if (promoModal) promoModal.classList.add('show');
    return true;
  }
  const move = game.move({ from, to, promotion: 'q' });
  if (!move) return false;
  board.position(game.fen(), true);
  pauseTimer('w'); pauseTimer('b'); resumeTimer(game.turn());
  socket.emit('sync_state', game.fen(), game.turn());
  updateStatus();
  return true;
}
function enableLongPressSelect() {
  getSquareElements().forEach(el => {
    const sq = squareIdFromEl(el);
    if (!sq) return;
    el.addEventListener('touchstart', () => {
      pressTimer = setTimeout(() => { selectedSquare = sq; clearHighlights(); highlightLegalMoves(sq); }, 500);
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
  const mainEl = document.getElementById('main-element');
  if (mainEl) mainEl.style.display = 'none';
}
document.addEventListener('DOMContentLoaded', function () {
  const buttons = document.getElementsByClassName('timer-button');
  for (let i = 0; i < buttons.length; i++) {
    const b = buttons[i];
    if (b.getAttribute('data-time')) b.addEventListener('click', Handlebuttonclick);
  }
});

// Modal helper (guarded)
function showConfirm(message, callback) {
  const modal = document.getElementById("confirmModal");
  const msg = document.getElementById("confirmMessage");
  const yesBtn = document.getElementById("confirmYes");
  const noBtn = document.getElementById("confirmNo");
  if (!modal || !msg || !yesBtn || !noBtn) {
    // fallback to window.confirm if modal missing (keeps behavior working)
    const res = window.confirm(message);
    callback(Boolean(res));
    return;
  }

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

// Names
if (setNameBtn && nameInput) {
  setNameBtn.addEventListener('click', () => {
    const n = nameInput.value.trim();
    if (!n) return showToast('Enter a name');
    socket.emit('set_name', n);
    showToast('Name set: ' + n);
  });
}

// Offers (guarded)
if (drawBtn) drawBtn.addEventListener('click', () => socket.emit('draw_offer'));
if (takebackBtn) takebackBtn.addEventListener('click', () => socket.emit('takeback_request'));
if (rematchBtn) rematchBtn.addEventListener('click', () => socket.emit('rematch_request'));
if (stallBtn) stallBtn.addEventListener('click', () => {
  if (!matchId) return;
  socket.emit('claim_win_on_stall', matchId);
});

// Spectate
if (spectateBtn && spectateIdInput) {
  spectateBtn.addEventListener('click', () => {
    const id = spectateIdInput.value.trim();
    if (!id) return showToast('Enter match ID to spectate');
    socket.emit('spectate', id);
  });
}

// Chat
if (chatSend && chatInput) {
  chatSend.addEventListener('click', () => {
    const text = chatInput.value.trim();
    if (!text) return;
    socket.emit('chat_message', text);
    chatInput.value = '';
  });
}

// AI opponent (client-side only)
if (playAiBtn) {
  playAiBtn.addEventListener('click', () => {
    isSpectator = false;
    c_player = 'w';
    currenttimer = 5;
    initTimers(currenttimer);
    pauseTimer('w'); pauseTimer('b'); resumeTimer('w');
    const youAreEl = document.getElementById('youareplayingas');
    if (youAreEl) youAreEl.textContent = 'You are playing vs AI (White)';
    const mainEl = document.getElementById('main-element');
    if (mainEl) mainEl.style.display = 'flex';
    showToast('AI match started');

    // Simple AI: random legal move for black after your move
    function aiMove() {
      if (game.turn() !== 'b') return;
      const moves = game.moves({ verbose: true });
      if (!moves.length) return;
      const choice = moves[Math.floor(Math.random() * moves.length)];
      game.move({ from: choice.from, to: choice.to, promotion: 'q' });
      board.position(game.fen(), true);
      pauseTimer('w'); pauseTimer('b'); resumeTimer(game.turn());
      updateStatus();
    }

    // Hook after your move to play AI
    const originalEmit = socket.emit;
    socket.emit = function () {
      const event = arguments[0];
      if (event === 'sync_state') {
        setTimeout(aiMove, 500);
        return;
      }
      return originalEmit.apply(socket, arguments);
    };
  });
}

// Sockets
socket.on('I am connected', () => showToast('Connected to server'));

socket.on('total_players_count_change', (count) => {
  const el = document.getElementById('total_players');
  if (el) el.textContent = 'Total players connected: ' + count;
});

socket.on('match_found', (payload) => {
  isSpectator = false;
  matchId = payload.matchId;
  c_player = payload.color === 'white' ? 'w' : 'b';
  showToast(`Match found vs ${payload.opponentName}. You are ${payload.color}.`);
  const mainEl = document.getElementById('main-element');
  if (mainEl) mainEl.style.display = 'flex';
  const youAreEl = document.getElementById('youareplayingas');
  if (youAreEl) youAreEl.textContent =
    `You are playing as ${payload.color} vs ${payload.opponentName}`;

  currenttimer = payload.time;
  initTimers(currenttimer);

  game.reset();
  board.clear();
  board.start();
  board.orientation(payload.color);

  pauseTimer('w'); pauseTimer('b');
  if (game.turn() === 'w') resumeTimer('w'); else resumeTimer('b');

  if (waitingPara1) waitingPara1.style.display = 'none';
  refreshTapBindings();
  updateStatus();
});

socket.on('sync_state_from_server', (fen, turn) => {
  if (fen) game.load(fen);
  board.position(fen || game.fen(), true);
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

// Spectator: set board state and disable dragging
socket.on('spectate_joined', (info) => {
  isSpectator = true;
  matchId = info.matchId;
  const youAreEl = document.getElementById('youareplayingas');
  if (youAreEl) youAreEl.textContent =
    `Spectating ${info.white} vs ${info.black} (${info.time} mins)`;
  if (waitingPara1) waitingPara1.style.display = 'none';
  const mainEl = document.getElementById('main-element');
  if (mainEl) mainEl.style.display = 'flex';

  // Initialize board for spectator view (recreate if needed)
  const fen = info.fen || 'start';
  try {
    // If board exists, update; otherwise create a spectator board
    if (board && typeof board.position === 'function') {
      board.position(fen, true);
    } else {
      board = Chessboard('board1', { draggable: false, position: fen });
    }
  } catch (e) {
    // fallback: recreate board
    board = Chessboard('board1', { draggable: false, position: fen });
  }
  if (fen) game.load(fen);
  updateStatus();
  showToast('Joined as spectator');
});

socket.on('spectate_error', (msg) => showToast('Spectate error: ' + msg));

socket.on('chat_message_from_server', ({ from, text }) => {
  if (!chatLog) return;
  const p = document.createElement('p');
  p.textContent = `${from}: ${text}`;
  chatLog.appendChild(p);
  chatLog.scrollTop = chatLog.scrollHeight;
});
// end of script.js