/**
 * ==========================================================================
 *  LA PAGE D'ACCUEIL (ouverte une fois, à l'installation)
 * --------------------------------------------------------------------------
 *  Un merci, puis une courte « vidéo » : une scène en HTML jouée par une ligne
 *  de temps (curseur, clics, menu Extensions, épingle, popup). Pas de fichier
 *  vidéo : nette à toutes les tailles, traduite, et ~0 Ko de plus. Le lecteur a
 *  lecture / pause, une barre de progression, des chapitres et des sous-titres.
 *
 *  Langue : l'anglais par défaut ; le français si l'utilisateur l'a choisi dans
 *  les réglages, ou avec le sélecteur EN / FR (?lang=fr).
 *
 *  Sur Chrome / Edge, `action.getUserSettings` dit si l'icône est épinglée :
 *  le lecteur passe au vert et lâche des confettis au moment où c'est fait.
 *  Firefox n'a pas cette API : le guide reste affiché, sans détection.
 *
 *  Économe : l'animation s'arrête quand l'onglet est caché ou la scène hors
 *  de l'écran ; la vérification de l'épingle ne fait aucune requête réseau.
 * ==========================================================================
 */
import { B } from '../common/shim.js';
import { applyLang } from '../common/ui.js';
import { t } from '../common/i18n.js';
import { fillIcons } from '../common/icons.js';

// Chargée aussi par tools/selftest.html (sans API d'extension ni gabarit) : tout est facultatif.
const scene = document.getElementById('scene');
if (scene) {
  const asked = new URLSearchParams(location.search).get('lang');
  const got = await Promise.resolve(B?.storage?.local?.get('settings')).catch(() => null);
  const saved = got?.settings?.lang;
  const lang = asked === 'fr' || asked === 'en' ? asked : saved === 'fr' || saved === 'en' ? saved : 'en';
  applyLang(lang);
  document.title = t('Bienvenue sur RoNote');
  document.querySelectorAll('.lang button').forEach(b => {
    b.classList.toggle('on', b.dataset.l === lang);
    b.addEventListener('click', () => { if (b.dataset.l !== lang) location.search = '?lang=' + b.dataset.l; });
  });
  fillIcons(document);
  player();
  pinWatch();
}

/* ======================= Le lecteur ======================= */
function player() {
  const $ = (id) => document.getElementById(id);
  const win = scene.querySelector('.win'), cursor = $('cursor'), ripple = $('ripple'), cap = $('cap');
  const fill = $('fill'), track = $('track'), time = $('time'), pp = $('pp');
  const D = 10500;                                   // durée d'un tour (ms)
  const CH = [0, 1700, 3400];                        // débuts des chapitres
  const CAPS = [t('Clique sur l’icône Extensions'), t('Clique sur l’épingle à côté de RoNote'),
    t('RoNote est dans ta barre : un clic et tes trades sont là')];
  const CLICKS = [1400, 2700, 4600];

  // Où va le curseur, et quand. `at` : un élément de la scène, ou un point en fraction de la fenêtre.
  const KF = [
    { t: 0, at: [0.42, 0.72] },
    { t: 1250, at: '#puzzle' },
    { t: 1700, at: '#puzzle' },
    { t: 2550, at: '#pinb' },
    { t: 3100, at: '#pinb' },
    { t: 4450, at: '#slot' },
    { t: 5000, at: '#slot' },
    { t: 6200, at: '#pop .tr', dx: -40, dy: 4 },
    { t: D, at: '#pop .tr', dx: -40, dy: 4 }
  ];
  const ease = (p) => p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
  function point(k) {
    const w = win.getBoundingClientRect();
    if (Array.isArray(k.at)) return [k.at[0] * w.width, k.at[1] * w.height];
    const r = scene.querySelector(k.at).getBoundingClientRect();
    return [r.left - w.left + r.width / 2 + (k.dx || 0), r.top - w.top + r.height / 2 + (k.dy || 0)];
  }
  function cursorAt(ms) {
    let i = 0;
    while (i < KF.length - 2 && KF[i + 1].t <= ms) i++;
    const a = KF[i], b = KF[i + 1];
    const p = ease(Math.min(1, Math.max(0, (ms - a.t) / Math.max(1, b.t - a.t))));
    const [ax, ay] = point(a), [bx, by] = point(b);
    return [ax + (bx - ax) * p, ay + (by - ay) * p];
  }

  // L'état de la scène à un instant donné : toujours recalculé, donc la recherche dans la barre marche.
  let lastS = '', lastPin = null, lastCh = -1;
  function stateAt(ms) {
    const s = ms >= 4600 ? '3' : ms >= 2100 && ms < 3300 ? '2' : ms >= 1400 && ms < 3300 ? '1' : '0';
    const pin = ms >= 2700;
    if (s !== lastS) scene.dataset.s = lastS = s;
    if (pin !== lastPin) { lastPin = pin; if (pin) scene.dataset.pin = ''; else delete scene.dataset.pin; }
    const ch = ms >= CH[2] ? 2 : ms >= CH[1] ? 1 : 0;
    if (ch !== lastCh) {
      const first = lastCh === -1;
      lastCh = ch;
      cap.classList.add('swap');
      setTimeout(() => { cap.textContent = CAPS[ch]; cap.classList.remove('swap'); }, first ? 0 : 180);
      document.querySelectorAll('#chapters li').forEach((li, n) => li.classList.toggle('on', n === ch));
    }
  }
  function click(x, y) {
    ripple.style.left = x + 'px'; ripple.style.top = y + 'px';
    ripple.classList.remove('go'); void ripple.offsetWidth; ripple.classList.add('go');
    cursor.classList.add('down'); setTimeout(() => cursor.classList.remove('down'), 140);
  }
  function draw(ms, prev) {
    const [x, y] = cursorAt(ms);
    cursor.style.transform = `translate(${(x - 4).toFixed(1)}px,${(y - 2).toFixed(1)}px)`;
    stateAt(ms);
    if (prev != null && ms > prev && ms - prev < 200) for (const c of CLICKS) if (prev < c && ms >= c) click(x, y);
    const pct = ms / D * 100;
    fill.style.width = pct + '%';
    track.setAttribute('aria-valuenow', Math.round(pct));
    time.textContent = '0:' + String(Math.floor(ms / 1000)).padStart(2, '0');
  }

  // Les repères des chapitres sur la barre.
  $('marks').innerHTML = CH.slice(1).map(c => `<span style="left:${c / D * 100}%"></span>`).join('');

  let pos = 0, running = false, raf = 0, last = 0, visible = true, wanted = true;
  function frame(now) {
    const prev = pos;
    pos += now - last; last = now;
    if (pos >= D) pos = 0;                            // en boucle
    draw(pos, prev);
    raf = requestAnimationFrame(frame);
  }
  // `wanted` : le choix de l'utilisateur ; `running` : ce qui tourne vraiment (visible, onglet au premier plan).
  function sync() {
    const on = wanted && visible && !document.hidden;
    scene.classList.toggle('paused', !wanted);
    pp.innerHTML = `<i data-ic="${wanted ? 'pause' : 'play'}"></i>`;
    pp.setAttribute('aria-label', wanted ? t('Pause') : t('Lecture'));
    fillIcons(pp);
    if (on === running) return;
    running = on;
    if (on) { last = performance.now(); raf = requestAnimationFrame(frame); } else cancelAnimationFrame(raf);
  }
  const toggle = () => { wanted = !wanted; sync(); };
  const seek = (ms) => { pos = Math.max(0, Math.min(D - 1, ms)); draw(pos, null); };

  pp.addEventListener('click', toggle);
  $('bigPlay').addEventListener('click', toggle);
  scene.querySelector('.win').addEventListener('click', toggle);
  document.querySelectorAll('#chapters button').forEach(b => b.addEventListener('click', () => {
    seek(CH[+b.dataset.ch]);
    if (!wanted) toggle();
  }));
  // La barre : clic, glisser, flèches.
  const fromX = (x) => { const r = track.getBoundingClientRect(); seek((x - r.left) / r.width * D); };
  track.addEventListener('pointerdown', e => {
    track.setPointerCapture(e.pointerId); fromX(e.clientX);
    const move = (ev) => fromX(ev.clientX);
    track.addEventListener('pointermove', move);
    track.addEventListener('pointerup', () => track.removeEventListener('pointermove', move), { once: true });
  });
  track.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); seek(pos + (e.key === 'ArrowRight' ? 1000 : -1000)); }
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggle(); }
  });

  // Rien ne tourne quand personne ne regarde.
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; sync(); }).observe(scene);
  document.addEventListener('visibilitychange', sync);
  addEventListener('resize', () => draw(pos, null));

  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { wanted = false; seek(6200); }
  else draw(0, null);
  sync();
}

/* ======================= Épinglée ? ======================= */
function pinWatch() {
  const getUserSettings = B?.action?.getUserSettings?.bind(B.action);
  if (!getUserSettings) return;
  const card = document.getElementById('pin'), badge = document.getElementById('pinState');
  let was = null;
  const check = async () => {
    if (document.hidden) return;
    const s = await getUserSettings().catch(() => null);
    const on = !!s?.isOnToolbar;
    if (on === was) return;
    card.classList.toggle('done', on);
    badge.hidden = !on;
    if (on && was === false) confetti();             // épinglée pendant que la page est ouverte
    was = on;
  };
  check();
  setInterval(check, 1000);
  document.addEventListener('visibilitychange', check);
}

/* Une pluie de confettis, 2,5 s, sur un canvas : rien ne reste après. */
function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const cv = document.getElementById('confetti'), ctx = cv.getContext('2d');
  const dpr = devicePixelRatio || 1;
  cv.width = innerWidth * dpr; cv.height = innerHeight * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const from = document.getElementById('pinState').getBoundingClientRect();
  const COLORS = ['#a78bfa', '#7dd3fc', '#4ade80', '#f5d27a', '#f472b6', '#ffffff'];
  const bits = Array.from({ length: 140 }, () => ({
    x: from.left + from.width / 2, y: from.top + from.height / 2,
    vx: (Math.random() - .5) * 14, vy: -Math.random() * 13 - 3, r: Math.random() * Math.PI,
    vr: (Math.random() - .5) * .3, w: 5 + Math.random() * 6, h: 3 + Math.random() * 4, c: COLORS[Math.random() * COLORS.length | 0]
  }));
  const end = performance.now() + 2500;
  (function step(now) {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const b of bits) {
      b.vy += .35; b.vx *= .99; b.x += b.vx; b.y += b.vy; b.r += b.vr;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r);
      ctx.globalAlpha = Math.max(0, Math.min(1, (end - now) / 600));
      ctx.fillStyle = b.c; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); ctx.restore();
    }
    if (now < end) requestAnimationFrame(step); else ctx.clearRect(0, 0, innerWidth, innerHeight);
  })(performance.now());
}
