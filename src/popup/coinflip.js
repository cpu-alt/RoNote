/**
 * ==========================================================================
 *  PILE OU FACE
 * --------------------------------------------------------------------------
 *  L'onglet « pièce » du popup : on choisit Face ou Pile, on lance, et le
 *  hasard tranche un trade qu'on n'arrive pas à décider. Tirage par
 *  crypto.getRandomValues, pas Math.random : un vrai 50/50.
 *
 *  Un jeton façon poker (vert « R$ » côté Face, orange « T » côté Pile), en
 *  3D (deux faces et une tranche faite de disques empilés), lancé au-dessus
 *  d'une carte comme celle du Portefeuille. Le son est synthétisé sur place (Web Audio), sans
 *  fichier ; il se coupe d'un clic.
 *
 *  Les derniers tirages et le choix du son restent dans ce navigateur
 *  (localStorage) : un confort, rien d'important.
 * ==========================================================================
 */
import { t } from '../common/i18n.js';
import { ic } from '../common/icons.js';

const REDUCED = !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
const KEY = 'ronote.coin';
const SPIN_MS = REDUCED ? 700 : 2600;
const EDGE = 6;   // disques empilés pour l'épaisseur de la tranche (chacun est un calque GPU)

const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* navigation privée */ } };

/** Pile ou face, sans biais : un bit d'un octet tiré par le système. */
const toss = () => (crypto.getRandomValues(new Uint8Array(1))[0] & 1 ? 'heads' : 'tails');

/* ------------------------------- dessins -------------------------------- */

/**
 * Un jeton façon poker : disque coloré, huit encoches blanches sur le bord,
 * anneau clair et symbole au centre. Face : vert « R$ ». Pile : orange « T ».
 * Le même dessin sert à la grosse pièce, au sélecteur et à l'historique.
 */
const CHIPS = {
  heads: { fill: '#22b35e', deep: '#16803f', label: 'R$', size: 30 },
  tails: { fill: '#f07a24', deep: '#c05510', label: 'T', size: 40 }
};
function chipSvg(side, cls = '') {
  const c = CHIPS[side];
  const notches = Array.from({ length: 8 }, (_, i) =>
    `<rect x="-6.5" y="-48" width="13" height="12" rx="2" fill="#fff" transform="rotate(${i * 45 + 22.5})"/>`).join('');
  return `<svg class="cf-chipsvg ${cls}" viewBox="-50 -50 100 100" aria-hidden="true">
    <circle r="48" fill="${c.fill}" stroke="${c.deep}" stroke-width="2"/>${notches}
    <circle r="33" fill="${c.deep}"/>
    <circle r="30" fill="${c.fill}" stroke="#fff" stroke-width="3"/>
    <text y="${c.size * 0.36}" text-anchor="middle" font-size="${c.size}" font-weight="900" fill="#fff"
      font-family="system-ui,'Segoe UI',Arial,sans-serif">${c.label}</text>
  </svg>`;
}

function coinHtml() {
  const edge = Array.from({ length: EDGE }, (_, i) =>
    `<i class="cf-edge" style="transform:translateZ(${(i - (EDGE - 1) / 2) * 1.1}px)"></i>`).join('');
  return `<div class="cf-coin" id="cf-coin">${edge}
    <div class="cf-face cf-heads">${chipSvg('heads')}</div>
    <div class="cf-face cf-tails">${chipSvg('tails')}</div>
  </div>`;
}

/* --------------------------------- son ---------------------------------- */

let audio = null;
function tone(freq, at, dur, type = 'sine', gain = 0.12) {
  const ctx = audio;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, ctx.currentTime + at);
  g.gain.setValueAtTime(0.0001, ctx.currentTime + at);
  g.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + at + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + at + dur);
  o.connect(g).connect(ctx.destination);
  o.start(ctx.currentTime + at); o.stop(ctx.currentTime + at + dur + 0.02);
}
function playSpin(ms) {
  try {
    audio ||= new AudioContext();
    // Des « tic » de plus en plus espacés, comme une pièce qui ralentit.
    let at = 0, gap = 0.05;
    while (at < ms / 1000 - 0.25) { tone(1800 + Math.random() * 300, at, 0.025, 'sine', 0.025); at += gap; gap *= 1.09; }
  } catch { /* pas de son, tant pis */ }
}
function playLand(win) {
  try {
    audio ||= new AudioContext();
    tone(220, 0, 0.09, 'sine', 0.12);                           // le jeton se pose
    const notes = win ? [659, 988] : [494, 392];                // deux notes douces, montantes ou descendantes
    notes.forEach((f, i) => tone(f, 0.1 + i * 0.1, 0.28, 'sine', 0.07));
  } catch { /* idem */ }
}

/* -------------------------------- rendu --------------------------------- */

let angle = 0;        // rotation courante de la pièce, cumulée d'un lancer à l'autre
let busy = false;
let generation = 0;   // chaque rendu de l'onglet invalide les lancers encore en vol

/**
 * Dessine l'onglet dans `root`. Rien d'autre à appeler : les boutons se
 * branchent ici. Le popup ne redessine pas cet onglet en arrière-plan, pour
 * ne jamais couper un lancer en plein vol.
 */
export function renderCoin(root) {
  const st = read();
  const pick = st.pick === 'tails' ? 'tails' : 'heads';
  const last = Array.isArray(st.last) ? st.last.slice(0, 14) : [];
  angle = st.face === 'tails' ? 180 : 0;
  busy = false;
  generation++;

  root.innerHTML = `<section class="cf">
    <div class="cf-top">
      <div><div class="cf-label">${t('Pile ou face')}</div>
        <div class="cf-sub">${t('Tu hésites sur un trade ? Choisis ton côté, le hasard décide.')}</div></div>
      <button class="w-eye cf-mute${st.mute ? ' off' : ''}" id="cf-mute" title="${t(st.mute ? 'Activer le son' : 'Couper le son')}">${ic('volume')}</button>
    </div>
    <div class="cf-table">
      <div class="cf-glow" aria-hidden="true"></div>
      <div class="cf-toss" id="cf-toss">${coinHtml()}</div>
      <div class="cf-shadow" id="cf-shadow"></div>
      <div class="cf-confetti" id="cf-confetti" aria-hidden="true"></div>
    </div>
    <div class="cf-result" id="cf-result" aria-live="polite">${last.length ? '' : `<span class="cf-hint">${t('Choisis Face ou Pile, puis lance.')}</span>`}</div>
    <div class="cf-picks" role="radiogroup" aria-label="${t('Ton côté')}">
      <button class="cf-chip${pick === 'heads' ? ' on' : ''}" data-pick="heads" role="radio" aria-checked="${pick === 'heads'}">${chipSvg('heads')}${t('Face')}</button>
      <button class="cf-chip${pick === 'tails' ? ' on' : ''}" data-pick="tails" role="radio" aria-checked="${pick === 'tails'}">${chipSvg('tails')}${t('Pile')}</button>
    </div>
    <button class="cf-go" id="cf-go">${t('Lancer la pièce')}</button>
    <div class="cf-log" id="cf-log"></div>
  </section>`;

  const coin = root.querySelector('#cf-coin');
  coin.style.transform = `rotateX(${angle}deg)`;
  drawLog(root, last);
  if (st.lastResult) showResult(root, st.lastResult, st.lastPick, false);

  root.querySelectorAll('.cf-chip').forEach(b => b.addEventListener('click', () => {
    if (busy) return;
    const s = read(); s.pick = b.dataset.pick; write(s);
    root.querySelectorAll('.cf-chip').forEach(x => {
      const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on));
    });
  }));
  root.querySelector('#cf-mute').addEventListener('click', (e) => {
    const s = read(); s.mute = !s.mute; write(s);
    e.currentTarget.classList.toggle('off', s.mute);
    e.currentTarget.title = t(s.mute ? 'Activer le son' : 'Couper le son');
  });
  root.querySelector('#cf-go').addEventListener('click', () => flip(root));
}

/** Espace ou Entrée lance la pièce quand l'onglet est affiché. */
export function coinKey(root, e) {
  if ((e.key === ' ' || e.key === 'Enter') && !e.target.closest('button,input,select,a')) {
    e.preventDefault(); flip(root);
  }
}

function flip(root) {
  if (busy) return;
  const coin = root.querySelector('#cf-coin');
  const tossEl = root.querySelector('#cf-toss');
  const shadow = root.querySelector('#cf-shadow');
  if (!coin) return;
  busy = true;
  const run = generation;
  const st = read();
  const pick = st.pick === 'tails' ? 'tails' : 'heads';
  const result = toss();

  // Au moins cinq tours, puis juste ce qu'il faut pour finir sur la bonne face.
  const turns = REDUCED ? 2 : 6 + (crypto.getRandomValues(new Uint8Array(1))[0] % 3);
  const base = angle + turns * 360;
  const want = result === 'heads' ? 0 : 180;
  angle = base + ((want - (base % 360)) + 360) % 360;

  root.querySelector('#cf-result').innerHTML = `<span class="cf-hint">${t('La pièce tourne…')}</span>`;
  root.querySelector('#cf-go').disabled = true;
  root.querySelectorAll('.cf-chip').forEach(b => { b.disabled = true; });

  coin.style.transition = `transform ${SPIN_MS}ms cubic-bezier(.18,.62,.22,1)`;
  coin.style.transform = `rotateX(${angle}deg)`;
  if (!REDUCED) {
    tossEl.classList.remove('up'); shadow.classList.remove('up');
    void tossEl.offsetWidth;                    // relance l'animation même deux fois de suite
    tossEl.style.animationDuration = shadow.style.animationDuration = SPIN_MS + 'ms';
    tossEl.classList.add('up'); shadow.classList.add('up');
  }
  if (!st.mute) playSpin(SPIN_MS);

  setTimeout(() => {
    const win = result === pick;
    // Le tirage compte même si on a changé d'onglet entre-temps ; seul
    // l'affichage est abandonné, pour ne jamais écrire dans une autre vue.
    const s = read();
    s.face = result; s.lastResult = result; s.lastPick = pick;
    s.last = [result, ...(Array.isArray(s.last) ? s.last : [])].slice(0, 14);
    s.heads = (s.heads || 0) + (result === 'heads');
    s.tails = (s.tails || 0) + (result === 'tails');
    s.wins = (s.wins || 0) + win;
    s.flips = (s.flips || 0) + 1;
    write(s);
    if (run !== generation || !coin.isConnected) return;
    if (!s.mute) playLand(win);
    showResult(root, result, pick, true);
    drawLog(root, s.last);
    if (win && !REDUCED) confetti(root.querySelector('#cf-confetti'));
    const go = root.querySelector('#cf-go');
    go.disabled = false;
    go.textContent = t('Relancer');
    root.querySelectorAll('.cf-chip').forEach(b => { b.disabled = false; });
    busy = false;
  }, SPIN_MS + 30);
}

function showResult(root, result, pick, fresh) {
  const win = result === pick;
  const box = root.querySelector('#cf-result');
  if (!box) return;
  box.className = `cf-result ${win ? 'win' : 'loss'}${fresh ? ' pop' : ''}`;
  box.innerHTML = `<div class="cf-big">${t(result === 'heads' ? 'Face' : 'Pile')}</div>
    <span class="cf-verdict">${win
      ? `${ic('check-circle')}${t('Gagné : le destin dit accepte le trade.')}`
      : `${ic('x-circle')}${t('Perdu : le destin dit refuse le trade.')}`}</span>`;
}

function drawLog(root, last) {
  const st = read();
  const box = root.querySelector('#cf-log');
  if (!box) return;
  if (!last.length) { box.innerHTML = ''; return; }
  const mini = last.map((r, i) => `<i class="cf-mini${i === 0 ? ' new' : ''}" title="${t(r === 'heads' ? 'Face' : 'Pile')}">${chipSvg(r)}</i>`).join('');
  box.innerHTML = `<div class="cf-row">${mini}</div>
    <div class="cf-stats"><span>${t('Face')} <b>${st.heads || 0}</b></span><span>${t('Pile')} <b>${st.tails || 0}</b></span>
      <span>${t('Gagnés')} <b>${st.wins || 0}/${st.flips || 0}</b></span>
      <button class="cf-reset" id="cf-reset">${t('Effacer')}</button></div>`;
  box.querySelector('#cf-reset').addEventListener('click', () => {
    const s = read(); write({ pick: s.pick, mute: s.mute, face: s.face });
    drawLog(root, []);
    root.querySelector('#cf-result').innerHTML = `<span class="cf-hint">${t('Choisis Face ou Pile, puis lance.')}</span>`;
    root.querySelector('#cf-result').className = 'cf-result';
  });
}

function confetti(box) {
  if (!box) return;
  const colors = ['#22b35e', '#f07a24', '#4d9fff', '#e9eef8'];
  box.innerHTML = Array.from({ length: 26 }, () => {
    const x = (Math.random() * 2 - 1) * 170, y = -60 - Math.random() * 110, r = Math.random() * 720 - 360;
    const c = colors[Math.floor(Math.random() * colors.length)];
    const d = 0.9 + Math.random() * 0.7;
    return `<i style="--x:${x}px;--y:${y}px;--r:${r}deg;background:${c};animation-duration:${d}s;animation-delay:${Math.random() * 0.12}s"></i>`;
  }).join('');
  setTimeout(() => { box.innerHTML = ''; }, 1900);
}
