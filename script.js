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

// Sounds
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
      const aiMove = ai.playVsAI(game, 5, 1800);
      if (!aiMove) return;
      game.move(aiMove);
      board.position(game.fen(), true);
      updateStatus();
      playMoveSound();
    }, 80);
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
function onChange() { if (game.game_over() && game.in_checkmate() && !isOfflineMode) { const winner = game.turn() === 'b' ? 'White' : 'Black'; socket.emit('game_over', winner); } }

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
function squareIdFromEl(el) { const ds = el.getAttribute('data-square'); if (ds) return ds; const cls = Array.from(el.classList).find(c => c.startsWith('square-') && c.length === 8); return cls ? cls.split('-')[1] : null; }
function clearHighlights() { getSquareElements().forEach(el => el.classList.remove('highlight-source', 'highlight-target')); }
function highlightLegalMoves(from) {
  const sourceEl = Array.from(getSquareElements()).find(el => squareIdFromEl(el) === from); if (sourceEl) sourceEl.classList.add('highlight-source');
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
      selectedSquare = null; clearHighlights();
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

document.addEventListener('DOMContentLoaded', function () {
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
  spectateBtn.addEventListener('click', () => { const id = spectateIdInput.value.trim(); if (!id) return showToast('Enter match ID to spectate'); socket.emit('spectate', id); });
  chatSend.addEventListener('click', () => { const text = chatInput.value.trim(); if (!text) return; socket.emit('chat_message', text); chatInput.value = ''; });
  const playAiBtnEl = document.getElementById('playAiBtn'); if (playAiBtnEl) playAiBtnEl.addEventListener('click', playAiBtn);
  const offlineToggle = document.getElementById('toggleOfflineAI'); if (offlineToggle) offlineToggle.addEventListener('click', () => setOfflineMode(!isOfflineMode));
  const soundToggle = document.getElementById('sound_toggle'); if (soundToggle) soundToggle.addEventListener('click', () => { soundEnabled = !soundEnabled; updateSoundButton(); });
});

function setOfflineMode(active) {
  isOfflineMode = active;
  if (active) {
    c_player = 'w'; isSpectator = false;
    game.reset(); board.clear(); board.start(); board.orientation('white');
    pauseTimer('w'); pauseTimer('b'); resumeTimer('w');
    updateStatus();
    showToast('Offline AI mode activated (you play White).');
  } else {
    showToast('Online mode activated.');
  }
}

function updateSoundButton() { const btn = document.getElementById('sound_toggle'); if (!btn) return; btn.textContent = soundEnabled ? '🔊 Sound: On' : '🔇 Sound: Off'; }

function playAIMove() {
  if (!isOfflineMode || game.game_over() || game.turn() !== 'b') return;
  const aiMove = ai.playVsAI(game, 5, 1800);
  if (!aiMove) return;
  game.move(aiMove);
  board.position(game.fen(), true);
  updateStatus();
  playMoveSound();
}

const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };
const PST = {
  p: [0,0,0,0,0,0,0,0,5,10,10,-20,-20,10,10,5,5,-5,-10,0,0,-10,-5,5,0,0,0,20,20,0,0,0,5,5,10,25,25,10,5,5,10,10,20,30,30,20,10,10,50,50,50,50,50,50,50,50,0,0,0,0,0,0,0,0],
  n: [-50,-40,-30,-30,-30,-30,-40,-50,-40,-20,0,0,0,0,-20,-40,-30,0,10,15,15,10,0,-30,-30,5,15,20,20,15,5,-30,-30,0,15,20,20,15,0,-30,-30,5,10,15,15,10,5,-30,-40,-20,0,5,5,0,-20,-50,-40,-30,-30,-30,-30,-40,-50],
  b: [-20,-10,-10,-10,-10,-10,-10,-20,-10,5,0,0,0,0,5,-10,-10,10,10,10,10,10,10,-10,-10,0,10,10,10,10,0,-10,-10,5,5,10,10,5,5,-10,-10,0,5,10,10,5,0,-10,-10,0,0,0,0,0,0,0,-10,-20,-10,-10,-10,-10,-10,-10,-20],
  r: [0,0,0,0,0,0,0,0,5,10,10,10,10,10,10,5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,0,0,0,5,5,0,0,0],
  q: [-20,-10,-10,-5,-5,-10,-10,-20,-10,0,0,0,0,0,0,-10,-10,0,5,5,5,5,0,-10,-5,0,5,5,5,5,0,-5,0,0,5,5,5,5,0,-5,-10,5,5,5,5,5,0,-10,-10,0,5,0,0,0,0,0,-10,-20,-10,-10,-5,-5,-10,-10,-20],
  k: [-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-20,-30,-30,-40,-40,-30,-30,-20,-10,-20,-20,-20,-20,-20,-20,-10,20,20,0,0,0,0,20,20,20,30,10,0,0,10,30,20]
};

class Evaluator {
  evaluate(game) {
    if (game.in_checkmate()) return game.turn() === 'w' ? -1000000 : 1000000;
    if (game.in_draw() || game.in_stalemate()) return 0;
    let score = 0;
    score += this.material(game);
    score += this.pieceSquare(game);
    score += this.mobility(game);
    score += this.kingSafety(game);
    score += this.pawnStructure(game);
    score += this.bishopPair(game);
    score += this.centerControl(game);
    score += (game.castling('w') ? 40 : -15) - (game.castling('b') ? 40 : -15);
    const phase = this.phase(game);
    return Math.round(score * (0.5 + 0.5 * phase));
  }
  material(game) { const fen = game.fen().split(' ')[0].replace(/\//g, ''); let v=0; for(const c of fen){ if(/[1-8]/.test(c))continue; const val=PIECE_VALUES[c.toLowerCase()]||0; v += c===c.toUpperCase()?val:-val;} return v; }
  pieceSquare(game){ const ranks = game.fen().split(' ')[0].split('/'); let v=0; for(let r=0;r<8;r++){ let f=0; for(const c of ranks[r]){ if(/[1-8]/.test(c)){ f += parseInt(c,10); continue;} const idx = r*8+f; const p=c.toLowerCase(); const pst=PST[p]; if(pst){ const off=c===c.toUpperCase()?idx:63-idx; v += c===c.toUpperCase()?pst[off]:-pst[off]; } f++; }} return v; }
  mobility(game){ const w=game.moves({verbose:true,color:'w'}).length; const b=game.moves({verbose:true,color:'b'}).length; return 10*(w-b); }
  kingSafety(game){ let v=0; v += game.castling('w') ? 40 : -15; v -= game.castling('b') ? 40 : -15; if(game.in_check()){ v += game.turn()==='b'?30:-30; } return v; }
  pawnStructure(game){ const fen=game.fen().split(' ')[0]; const ranks=fen.split('/'); const w={}; const b={}; for(let r=0;r<8;r++){ let f=0; for(const c of ranks[r]){ if(/[1-8]/.test(c)){ f += parseInt(c,10); continue;} if(c==='P') w[f]=(w[f]||0)+1; if(c==='p') b[f]=(b[f]||0)+1; f++; }} let v=0; for(const f in w){ if(w[f]>1) v-=12; if(!w[f-1]&&!w[Number(f)+1]) v-=20; } for(const f in b){ if(b[f]>1) v+=12; if(!b[f-1]&&!b[Number(f)+1]) v+=20; } return v; }
  bishopPair(game){ const fen=game.fen().split(' ')[0]; const w=(fen.match(/B/g)||[]).length; const b=(fen.match(/b/g)||[]).length; return (w>=2?40:0)-(b>=2?40:0); }
  centerControl(game){ const c=new Set(['d4','d5','e4','e5']); let v=0; game.moves({verbose:true}).forEach(m=>{ if(c.has(m.to)) v += m.color==='w'?8:-8; }); return v; }
  phase(game){ const fen=game.fen().split(' ')[0].replace(/\//g,''); let p=0; for(const c of fen){ if(/q/i.test(c)) p+=4; else if(/r/i.test(c)) p+=2; else if(/n|b/i.test(c)) p+=1; } return Math.min(1,p/16); }
}

class ChessAI {
  constructor(){ this.evaluator=new Evaluator(); this.tt=new Map(); this.history=[]; this.killer={}; this.pvMove=null; }
  key(game){ return game.fen().split(' ').slice(0,4).join(' '); }
  repetition(game){ const key=this.key(game); const c=this.history.filter(k=>k===key).length; return c>=2?-500:0; }
  moveScore(move,game){ let s=0; if(this.pvMove&&move.from===this.pvMove.from&&move.to===this.pvMove.to) s+=20000; if(move.flags.includes('c')) s+=10000+(PIECE_VALUES[move.captured.toLowerCase()]||0)-(PIECE_VALUES[move.piece.toLowerCase()]||0); if(move.flags.includes('k')) s+=600; const key=this.key(game); const killers=this.killer[key]||[]; if(killers.some(k=>k.from===move.from&&k.to===move.to)) s+=5000; return s; }
  orderMoves(game){ return game.moves({verbose:true}).sort((a,b)=>this.moveScore(b,game)-this.moveScore(a,game)); }
  quiescence(game,alpha,beta,depth=0){ if(depth>32) return this.evaluator.evaluate(game); let stand=this.evaluator.evaluate(game); if(stand>=beta) return beta; alpha=Math.max(alpha,stand); const caps=game.moves({verbose:true}).filter(m=>m.flags.includes('c')||m.flags.includes('k')); for(const m of this.orderMoves(game)){ if(!caps.some(c=>c.from===m.from&&c.to===m.to)) continue; game.move(m); const v=-this.quiescence(game,-beta,-alpha,depth+1); game.undo(); if(v>=beta) return beta; alpha=Math.max(alpha,v);} return alpha; }
  minimax(game,depth,alpha,beta,max,start,timeLimit){ if(Date.now()-start>timeLimit) return this.evaluator.evaluate(game); const key=this.key(game)+'|d'+depth; if(this.tt.has(key)) return this.tt.get(key); if(depth===0||game.game_over()){ const val=this.quiescence(game,alpha,beta); this.tt.set(key,val); return val; } let best=max?-Infinity:Infinity; const moves=this.orderMoves(game); for(const m of moves){ game.move(m); this.history.push(this.key(game)); const rep=this.repetition(game); let v=-this.minimax(game,depth-1,-beta,-alpha,!max,start,timeLimit); this.history.pop(); game.undo(); v += rep; if(max){ if(v>best){best=v;} alpha=Math.max(alpha,v);} else { if(v<best){best=v;} beta=Math.min(beta,v);} if(alpha>=beta){ const root=this.key(game); this.killer[root]=this.killer[root]||[]; this.killer[root].unshift(m); this.killer[root]=this.killer[root].slice(0,2); break;} } this.tt.set(key,best); return best; }
  playVsAI(game,maxDepth=5,timeLimit=1800){ const start=Date.now(); this.history=[this.key(game)]; let best=null; let bestVal=-Infinity; for(let depth=1;depth<=maxDepth;depth++){ let currentBest=null; let currentVal=-Infinity; const moves=this.orderMoves(game); for(const m of moves){ if(Date.now()-start>timeLimit) break; game.move(m); this.history.push(this.key(game)); const v=-this.minimax(game,depth-1,-Infinity,Infinity,false,start,timeLimit); this.history.pop(); game.undo(); if(v>currentVal){currentVal=v; currentBest=m;} } if(currentBest){ best=currentBest; bestVal=currentVal; this.pvMove=best; } if(Date.now()-start>timeLimit) break; } if(!best){ const moves=game.moves({verbose:true}); if(moves.length>0) best=moves[Math.floor(Math.random()*moves.length)]; } return best; }
}

const ai = new ChessAI();

function playAiBtn(){ if(!isOfflineMode){ setOfflineMode(true); return; } playAIMove(); }

// Socket events and the rest remains unchanged
socket.on('I am connected', () => showToast('Connected to server'));
socket.on('total_players_count_change', (count) => { const t = document.getElementById('total_players'); if (t) t.textContent = 'Total players connected: ' + count; });

socket.on('match_found', (payload) => {
  isOfflineMode = false;
  isSpectator = false;
  matchId = payload.matchId;
  c_player = payload.color === 'white' ? 'w' : 'b';
  document.getElementById('main-element').style.display = 'flex';
  document.getElementById('youareplayingas').textContent = `You are playing as ${payload.color} vs ${payload.opponentName}`;
  currenttimer = payload.time;
  initTimers(currenttimer);
  game.reset(); board.clear(); board.start(); board.orientation(payload.color);
  pauseTimer('w'); pauseTimer('b'); if (game.turn() === 'w') resumeTimer('w'); else resumeTimer('b');
  refreshTapBindings();
});

socket.on('sync_state_from_server', (fen, turn) => {
  if (isOfflineMode) return;
  game.load(fen);
  board.position(fen, true);
  pauseTimer('w'); pauseTimer('b'); resumeTimer(game.turn());
  updateStatus();
  refreshTapBindings();
});

socket.on('game_over_from_server', (winner) => { showToast(`Game over! ${winner} wins!`); setTimeout(() => location.reload(), 1500); });
socket.on('time_out_from_server', (payload) => { if (payload && payload.winner) { showToast(`Time out: ${payload.winner} wins!`); setTimeout(() => location.reload(), 1500); } });

socket.on('draw_offer_from_server', ({ from }) => { showConfirm(`${from} offered a draw. Accept?`, (accept) => socket.emit('draw_response', accept)); });
socket.on('draw_declined', () => showToast('Draw offer declined'));
socket.on('takeback_offer_from_server', ({ from }) => { showConfirm(`${from} requested a takeback. Accept?`, (accept) => socket.emit('takeback_response', accept)); });
socket.on('takeback_declined', () => showToast('Takeback declined'));
socket.on('rematch_offer_from_server', ({ from }) => { showConfirm(`${from} requested a rematch. Accept?`, (accept) => socket.emit('rematch_response', accept)); });
socket.on('rematch_declined', () => showToast('Rematch declined'));
socket.on('opponent_disconnected', ({ matchId }) => showToast('Opponent disconnected. You may wait or claim win on stall.'));
socket.on('stall_claim_rejected', ({ reason }) => showToast(`Stall claim rejected: ${reason}`));

socket.on('spectate_joined', (info) => {
  isSpectator = true;
  matchId = info.matchId;
  document.getElementById('youareplayingas').textContent = `Spectating ${info.white} vs ${info.black} (${info.time} mins)`;
  document.getElementById('waiting_para_1').style.display = 'none';
  document.getElementById('main-element').style.display = 'flex';
  showToast('Joined as spectator');
});

socket.on('spectate_error', (msg) => showToast('Spectate error: ' + msg));
socket.on('chat_message_from_server', ({ from, text }) => { const p = document.createElement('p'); p.textContent = `${from}: ${text}`; chatLog.appendChild(p); chatLog.scrollTop = chatLog.scrollHeight; });
