/**
 * ==========================================================================
 *  CARTES A PARTAGER : BILAN DU MOIS, INVENTAIRE
 * --------------------------------------------------------------------------
 *  Les cartes PNG à partager, dans l'esprit de Trade Flex :
 *    - le bilan du mois : value gagnée sur les trades terminés, taux de
 *      victoire, meilleur trade, évolution du compte, offres reçues ;
 *    - « Mon inventaire » (Portefeuille) : value, RAP, rang, courbe sur
 *      30 jours et les six plus gros objets avec leurs vignettes.
 *
 *  Les chiffres viennent du journal (tout le journal, pas les 100 lignes du
 *  popup) et de la courbe Rolimon's du compte. Le journal garde de 100 à
 *  1 000 événements (Réglages) : un mois ancien peut donc être incomplet, ce
 *  que la carte ne prétend pas cacher. Ni pseudo ni identifiant de trade n'y
 *  figure.
 * ==========================================================================
 */
import { t, locale } from '../common/i18n.js';

const DONE = new Set(['completed', 'outbound_accepted']);
const EVEN_BAND = 1;   // entre -1 % et +1 % : un trade égal

/** Premier et dernier instant d'un mois (heure locale). */
export const monthRange = (y, m) => [new Date(y, m, 1).getTime(), new Date(y, m + 1, 1).getTime()];

/** Les chiffres d'un mois. `wallet` : la courbe du compte, [{at, v, r, n}]. */
export function recapStats(history, wallet, y, m) {
  const [from, to] = monthRange(y, m);
  const inMonth = (h) => h.at >= from && h.at < to;
  const hist = (history || []).filter(inMonth);

  // Un trade peut apparaître deux fois (terminé vu des deux côtés) : une seule ligne par trade.
  const seen = new Set();
  const trades = [];
  for (const h of hist.sort((a, b) => a.at - b.at)) {
    if (!DONE.has(h.kind) || h.give == null || h.get == null) continue;
    if (h.tradeId && seen.has(h.tradeId)) continue;
    seen.add(h.tradeId);
    const pct = Number.isFinite(h.pct) ? h.pct : (h.give > 0 ? (h.get - h.give) / h.give * 100 : 0);
    trades.push({ at: h.at, net: h.get - h.give, pct, give: h.give, get: h.get });
  }
  const wins = trades.filter(x => x.pct > EVEN_BAND).length;
  const losses = trades.filter(x => x.pct < -EVEN_BAND).length;
  const best = trades.reduce((b, x) => (!b || x.net > b.net ? x : b), null);

  // La value du compte : dernier relevé avant le mois (ou premier du mois), puis dernier du mois.
  const pts = (wallet || []).filter(p => p.v > 0).sort((a, b) => a.at - b.at);
  const before = [...pts].reverse().find(p => p.at < from);
  const during = pts.filter(p => p.at >= from && p.at < to);
  const start = before || during[0] || null;
  const end = during[during.length - 1] || null;
  const curve = [...(before ? [before] : []), ...during];

  return {
    y, m, from, to,
    trades: trades.length, wins, losses, evens: trades.length - wins - losses,
    net: trades.reduce((s, x) => s + x.net, 0),
    winRate: trades.length ? Math.round(wins / trades.length * 100) : null,
    best: best && best.net > 0 ? best : null,
    received: hist.filter(h => h.kind === 'inbound' || h.kind === 'counter').length,
    accepted: hist.filter(h => h.kind === 'outbound_accepted').length,
    declined: hist.filter(h => h.kind === 'declined_by_me' || h.kind === 'outbound_declined').length,
    revals: hist.filter(h => h.kind === 'revalued').length,
    walletStart: start?.v || null,
    walletEnd: end?.v || null,
    curve: curve.map(p => ({ at: p.at, v: p.v }))
  };
}

/** Les mois qu'on peut afficher : du plus ancien relevé au mois en cours. */
export function recapMonths(history, wallet) {
  const ats = [...(history || []).map(h => h.at), ...(wallet || []).map(p => p.at)].filter(Number.isFinite);
  const now = new Date();
  const first = ats.length ? new Date(Math.min(...ats)) : now;
  const out = [];
  for (let d = new Date(now.getFullYear(), now.getMonth(), 1); d >= new Date(first.getFullYear(), first.getMonth(), 1) && out.length < 36;
    d = new Date(d.getFullYear(), d.getMonth() - 1, 1)) out.push([d.getFullYear(), d.getMonth()]);
  return out;
}

/* -------------------------------- dessin -------------------------------- */

const W = 1080, H = 1350;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const C = { win: '#3ee6a0', loss: '#ff5c7a', even: '#a9b8d0', fg: '#eef3ff', dim: '#93a3bf', faint: '#5f6d86', accent: '#6fb2ff' };

const full = (n) => new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(Math.round(n));
const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + full(Math.abs(n));

function rounded(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function panel(g, x, y, w, h, r = 28) {
  rounded(g, x, y, w, h, r);
  const f = g.createLinearGradient(x, y, x, y + h);
  f.addColorStop(0, '#ffffff10'); f.addColorStop(1, '#ffffff06');
  g.fillStyle = f; g.fill();
  g.strokeStyle = '#ffffff17'; g.lineWidth = 2; g.stroke();
}
function text(g, s, x, y, { size = 28, weight = 600, color = C.fg, align = 'left', spacing = 0 } = {}) {
  g.font = `${weight} ${size}px ${FONT}`; g.fillStyle = color; g.textAlign = align; g.textBaseline = 'alphabetic';
  if ('letterSpacing' in g) g.letterSpacing = spacing + 'px';
  g.fillText(s, x, y);
  if ('letterSpacing' in g) g.letterSpacing = '0px';
}
function fit(g, s, max, size, weight) {
  let px = size;
  do { g.font = `${weight} ${px}px ${FONT}`; if (g.measureText(s).width <= max) break; px -= 4; } while (px > 24);
  return px;
}

const loadImage = (src, cors = false) => new Promise(res => {
  if (!src) return res(null);
  const i = new Image();
  if (cors) i.crossOrigin = 'anonymous';   // sans ça, une vignette Roblox rendrait la carte impossible à exporter
  const timer = setTimeout(() => res(null), 4000);
  i.onload = () => { clearTimeout(timer); res(i); };
  i.onerror = () => { clearTimeout(timer); res(null); };
  i.src = src;
});

/** Fond, halos à la couleur du verdict, grille et en-tête : commun à toutes les cartes. */
async function frame(canvas, tone, kicker, title, logoUrl) {
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  const glow = tone === 'win' ? '#1fd08a' : tone === 'loss' ? '#ff4d6d' : '#4d7dff';

  // Fond : nuit profonde, halo à la couleur du verdict, fine grille.
  const bg = g.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0d1530'); bg.addColorStop(1, '#05080f');
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  for (const [cx, cy, r, a] of [[W * 0.85, 120, 620, '55'], [W * 0.05, H * 0.7, 520, '26']]) {
    const halo = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    halo.addColorStop(0, glow + a); halo.addColorStop(1, glow + '00');
    g.fillStyle = halo; g.fillRect(0, 0, W, H);
  }
  g.strokeStyle = '#ffffff08'; g.lineWidth = 1;
  for (let x = 0; x <= W; x += 54) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let y = 0; y <= H; y += 54) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }

  const logo = await loadImage(logoUrl);
  if (logo) { rounded(g, 72, 70, 64, 64, 16); g.save(); g.clip(); g.drawImage(logo, 72, 70, 64, 64); g.restore(); }
  text(g, 'RoNote', 156, 112, { size: 38, weight: 800 });
  text(g, kicker, W - 72, 94, { size: 22, weight: 800, color: C.dim, align: 'right', spacing: 4 });
  text(g, title, W - 72, 132, { size: 34, weight: 800, color: C.accent, align: 'right' });
  return g;
}

/** Dessine la carte du mois sur `canvas` (redimensionné en 1080 × 1350). */
export async function drawRecap(canvas, s, logoUrl) {
  const tone = s.trades ? (s.net > 0 ? 'win' : s.net < 0 ? 'loss' : 'even') : 'even';
  const month = new Date(s.y, s.m, 1).toLocaleDateString(locale(), { month: 'long', year: 'numeric' });
  const g = await frame(canvas, tone, t('BILAN DU MOIS'), month.charAt(0).toUpperCase() + month.slice(1), logoUrl);

  // Le chiffre du mois.
  panel(g, 72, 180, W - 144, 300, 36);
  text(g, t('Value gagnée en trade'), 112, 248, { size: 28, weight: 700, color: C.dim });
  const hero = s.trades ? signed(s.net) : '—';
  const px = fit(g, hero, W - 224, 150, 900);
  text(g, hero, 108, 400, { size: px, weight: 900, color: C[tone] });
  text(g, s.trades ? t('sur {n} trades terminés', { n: s.trades }) : t('Aucun trade terminé ce mois-ci'),
    112, 448, { size: 28, weight: 600, color: C.dim });

  // Trois tuiles.
  const tiles = [
    [t('Trades'), s.trades ? String(s.trades) : '0', C.fg],
    [t('Victoires'), s.winRate == null ? '—' : s.winRate + ' %', s.winRate == null ? C.dim : s.winRate >= 50 ? C.win : C.loss],
    [t('Meilleur trade'), s.best ? signed(s.best.net) : '—', s.best ? C.win : C.dim]
  ];
  const tw = (W - 144 - 2 * 24) / 3;
  tiles.forEach(([label, value, color], i) => {
    const x = 72 + i * (tw + 24);
    panel(g, x, 508, tw, 170, 28);
    text(g, label, x + 30, 560, { size: 24, weight: 700, color: C.dim });
    text(g, value, x + 30, 640, { size: fit(g, value, tw - 60, 56, 850), weight: 850, color });
  });
  if (s.best) text(g, `${s.best.pct > 0 ? '+' : ''}${Math.round(s.best.pct)} %`, 72 + 2 * (tw + 24) + tw - 30, 560, { size: 22, weight: 800, color: C.win, align: 'right' });

  // Victoires / égalités / défaites.
  const bx = 72, by = 706, bw = W - 144, bh = 22;
  rounded(g, bx, by, bw, bh, 11); g.fillStyle = '#ffffff10'; g.fill();
  if (s.trades) {
    g.save(); rounded(g, bx, by, bw, bh, 11); g.clip();
    let x = bx;
    for (const [n, c] of [[s.wins, C.win], [s.evens, C.even], [s.losses, C.loss]]) {
      const w = bw * n / s.trades; g.fillStyle = c; g.fillRect(x, by, w, bh); x += w;
    }
    g.restore();
  }
  text(g, `${s.wins} ${t('gagnés')}  ·  ${s.evens} ${t('égaux')}  ·  ${s.losses} ${t('perdus')}`, bx, by + 60, { size: 24, weight: 650, color: C.dim });

  // Value du compte sur le mois.
  panel(g, 72, 800, W - 144, 330, 36);
  text(g, t('Value du compte'), 112, 862, { size: 28, weight: 700, color: C.dim });
  if (s.walletStart && s.walletEnd) {
    const d = s.walletEnd - s.walletStart;
    const pct = s.walletStart ? d / s.walletStart * 100 : 0;
    const col = d > 0 ? C.win : d < 0 ? C.loss : C.even;
    text(g, full(s.walletEnd), 112, 934, { size: 60, weight: 850 });
    text(g, `${signed(d)}  (${pct > 0 ? '+' : ''}${pct.toFixed(1)} %)`, W - 112, 934, { size: 32, weight: 800, color: col, align: 'right' });
    spark(g, s.curve, 112, 966, W - 224, 136, col);
  } else {
    text(g, t('Pas encore de relevé Rolimon’s pour ce mois.'), 112, 934, { size: 28, weight: 600, color: C.faint });
  }

  // Pied : l'activité du mois.
  const foot = [[t('Offres reçues'), s.received], [t('Envoyés acceptés'), s.accepted], [t('Réévaluations'), s.revals]];
  const fw = (W - 144) / 3;
  foot.forEach(([label, n], i) => {
    const x = 72 + i * fw + fw / 2;
    text(g, String(n), x, 1212, { size: 46, weight: 850, align: 'center' });
    text(g, label, x, 1250, { size: 22, weight: 650, color: C.dim, align: 'center' });
  });
  text(g, t('Fait avec RoNote'), W / 2, 1310, { size: 20, weight: 700, color: C.faint, align: 'center', spacing: 2 });
}

function spark(g, pts, x, y, w, h, color) {
  if (!pts || pts.length < 2) return;
  const t0 = pts[0].at, t1 = pts[pts.length - 1].at || t0 + 1;
  const vs = pts.map(p => p.v), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
  const px = (p) => x + (p.at - t0) / Math.max(1, t1 - t0) * w;
  const py = (p) => y + h - (p.v - lo) / span * (h - 8) - 4;
  g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(px(p), py(p)) : g.moveTo(px(p), py(p))));
  const line = new Path2D(); pts.forEach((p, i) => (i ? line.lineTo(px(p), py(p)) : line.moveTo(px(p), py(p))));
  g.lineTo(px(pts[pts.length - 1]), y + h); g.lineTo(px(pts[0]), y + h); g.closePath();
  const f = g.createLinearGradient(0, y, 0, y + h); f.addColorStop(0, color + '55'); f.addColorStop(1, color + '00');
  g.fillStyle = f; g.fill();
  g.strokeStyle = color; g.lineWidth = 5; g.lineJoin = 'round'; g.lineCap = 'round'; g.stroke(line);
  const last = pts[pts.length - 1];
  g.beginPath(); g.arc(px(last), py(last), 9, 0, Math.PI * 2); g.fillStyle = color; g.fill();
  g.beginPath(); g.arc(px(last), py(last), 16, 0, Math.PI * 2); g.fillStyle = color + '33'; g.fill();
}

/* --------------------------- flex de l'inventaire ------------------------- */

/**
 * La carte « Mon inventaire » du Portefeuille.
 * @param w { value, rap, count, rank, change: {d, pct}|null, curve: [{at, v}], top: [{name, total, count, thumb}] }
 */
export async function drawWallet(canvas, w, logoUrl) {
  const tone = w.change ? (w.change.d > 0 ? 'win' : w.change.d < 0 ? 'loss' : 'even') : 'even';
  const date = new Date().toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' });
  const g = await frame(canvas, tone, t('MON INVENTAIRE'), date, logoUrl);

  // La value du compte et sa courbe sur 30 jours.
  panel(g, 72, 180, W - 144, 400, 36);
  text(g, t('Value du compte'), 112, 248, { size: 28, weight: 700, color: C.dim });
  const hero = w.value ? full(w.value) : '—';
  text(g, hero, 108, 380, { size: fit(g, hero, W - 224, 136, 900), weight: 900 });
  if (w.change) {
    const col = C[tone];
    const pill = `${signed(w.change.d)}  ·  ${w.change.pct > 0 ? '+' : ''}${w.change.pct.toFixed(1)} %  ·  ${t('30 jours')}`;
    g.font = `800 28px ${FONT}`;
    const pw = g.measureText(pill).width + 44;
    rounded(g, 112, 408, pw, 52, 26); g.fillStyle = col + '26'; g.fill();
    text(g, pill, 134, 444, { size: 28, weight: 800, color: col });
  }
  spark(g, w.curve, 112, 478, W - 224, 80, C[tone] === C.even ? C.accent : C[tone]);

  // RAP, rang, objets.
  const tiles = [[t('RAP'), w.rap ? full(w.rap) : '—'], [t('Rang'), w.rank ? '#' + full(w.rank) : '—'], [t('Objets'), w.count ? full(w.count) : '—']];
  const tw = (W - 144 - 2 * 24) / 3;
  tiles.forEach(([label, value], i) => {
    const x = 72 + i * (tw + 24);
    panel(g, x, 606, tw, 150, 28);
    text(g, label, x + 30, 656, { size: 24, weight: 700, color: C.dim });
    text(g, value, x + 30, 722, { size: fit(g, value, tw - 60, 50, 850), weight: 850 });
  });

  // Les six plus gros objets, vignettes comprises.
  text(g, t('Top objets'), 72, 812, { size: 26, weight: 800, color: C.dim, spacing: 1 });
  const top = (w.top || []).slice(0, 6);
  const imgs = await Promise.all(top.map(i => loadImage(i.thumb, true)));
  const cw = (W - 144 - 2 * 24) / 3, ch = 206;
  top.forEach((item, i) => {
    const x = 72 + (i % 3) * (cw + 24), y = 836 + Math.floor(i / 3) * (ch + 20);
    panel(g, x, y, cw, ch, 26);
    const box = 112, bx = x + (cw - box) / 2, by = y + 14;
    rounded(g, bx, by, box, box, 18); g.fillStyle = '#ffffff0c'; g.fill();
    if (imgs[i]) g.drawImage(imgs[i], bx, by, box, box);
    if (item.count > 1) {
      rounded(g, bx + box - 52, by + 4, 50, 32, 16); g.fillStyle = '#05080fd0'; g.fill();
      text(g, '×' + item.count, bx + box - 27, by + 28, { size: 20, weight: 800, align: 'center' });
    }
    let name = item.name || '';
    g.font = `700 22px ${FONT}`;
    while (name.length > 3 && g.measureText(name).width > cw - 36) name = name.slice(0, -2).trimEnd() + '…';
    text(g, name, x + cw / 2, y + 158, { size: 22, weight: 700, color: C.dim, align: 'center' });
    text(g, full(item.total), x + cw / 2, y + 192, { size: 28, weight: 850, align: 'center' });
  });
  if (!top.length) text(g, t('Rien à montrer pour l’instant.'), W / 2, 960, { size: 26, weight: 600, color: C.faint, align: 'center' });

  text(g, t('Fait avec RoNote'), W / 2, 1316, { size: 20, weight: 700, color: C.faint, align: 'center', spacing: 2 });
}
