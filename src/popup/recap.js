/**
 * ==========================================================================
 *  CARTES A PARTAGER : BILAN DU MOIS, INVENTAIRE
 * --------------------------------------------------------------------------
 *  Les cartes PNG à partager, dans l'esprit de Trade Flex :
 *    - le bilan du mois : value gagnée sur les trades terminés, taux de
 *      victoire, meilleur trade, évolution du compte, offres reçues ;
 *    - le Flex du portefeuille : sa value, sa variation et son graphique
 *      Rolimon's, en paysage, dans le style de Trade Flex.
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
async function frame(canvas, tone, kicker, title, logoUrl, clear = false) {
  canvas.width = W; canvas.height = H;
  const g = canvas.getContext('2d');
  if (clear) return header(g, kicker, title, logoUrl);   // fond fourni à part (flexbg.js)
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

  return header(g, kicker, title, logoUrl);
}

async function header(g, kicker, title, logoUrl) {
  const logo = await loadImage(logoUrl);
  if (logo) { rounded(g, 72, 70, 64, 64, 16); g.save(); g.clip(); g.drawImage(logo, 72, 70, 64, 64); g.restore(); }
  text(g, 'RoNote', 156, 112, { size: 38, weight: 800 });
  text(g, kicker, W - 72, 94, { size: 22, weight: 800, color: C.dim, align: 'right', spacing: 4 });
  text(g, title, W - 72, 132, { size: 34, weight: 800, color: C.accent, align: 'right' });
  return g;
}

/** Dessine la carte du mois sur `canvas` (redimensionné en 1080 × 1350). */
export async function drawRecap(canvas, s, logoUrl, { clear = false } = {}) {
  const tone = s.trades ? (s.net > 0 ? 'win' : s.net < 0 ? 'loss' : 'even') : 'even';
  const month = new Date(s.y, s.m, 1).toLocaleDateString(locale(), { month: 'long', year: 'numeric' });
  const g = await frame(canvas, tone, t('BILAN DU MOIS'), month.charAt(0).toUpperCase() + month.slice(1), logoUrl, clear);

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

/* ------------------------- flex du portefeuille --------------------------- */

/*
 * Dans l'esprit de Trade Flex (content/trade-flex.js) : carte en paysage,
 * rendue en 2× pour rester nette une fois partagée, liseré et halo de la
 * couleur du résultat, gros chiffre à gauche, variation à droite. Au milieu,
 * le graphique Rolimon's du Portefeuille ; en bas, une barre de chiffres.
 * Pas d'objets : la carte parle du portefeuille, pas de son contenu.
 */
export const FLEX_W = 1200, FLEX_H = 760, FLEX_S = 2;
/** La zone du graphique, en coordonnées de la carte (le popup y calcule les tracés). */
export const FLEX_PLOT = { x: 72, y: 350, w: 1056, h: 176 };

const TONE = { win: '#3ee6a0', loss: '#ff5c7a', even: '#a9b8d0' };
const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
};

/**
 * @param w { label, value, anon, asOf, change: {d, pct, label}|null,
 *            tiles: [[libellé, nombre ou texte, préfixe ?]],
 *            chart: { lines: [{color, label, path, start, end}], top, bottom, from, to } | null }
 */
export async function drawWallet(canvas, w, logoUrl, { clear = false } = {}) {
  const Wd = FLEX_W, Hd = FLEX_H, PAD = 40;
  canvas.width = Wd * FLEX_S; canvas.height = Hd * FLEX_S;
  const g = canvas.getContext('2d');
  g.setTransform(FLEX_S, 0, 0, FLEX_S, 0, 0);
  const tone = w.change ? (w.change.d > 0 ? 'win' : w.change.d < 0 ? 'loss' : 'even') : 'even';
  const color = TONE[tone];
  const box = (x, y, bw, bh, r, fill, stroke, lw = 1) => {
    g.beginPath(); g.roundRect(x, y, bw, bh, r);
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); }
  };
  const glow = (x, y, r, c, a) => {
    const f = g.createRadialGradient(x, y, 0, x, y, r);
    f.addColorStop(0, rgba(c, a)); f.addColorStop(1, rgba(c, 0));
    g.fillStyle = f; g.fillRect(0, 0, Wd, Hd);
  };
  const pctText = (p) => `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p).toFixed(1)}%`;

  // Fond : nuit profonde (ou le fond choisi, posé dessous), halos, liseré.
  if (!clear) {
    const bg = g.createLinearGradient(0, 0, Wd, Hd);
    bg.addColorStop(0, '#0c1428'); bg.addColorStop(1, '#060a14');
    g.fillStyle = bg; g.fillRect(0, 0, Wd, Hd);
    glow(80, Hd - 60, 560, '#3b82f6', .14);
  }
  glow(Wd - 120, 60, 520, color, clear ? .16 : .22);
  const edge = g.createLinearGradient(0, 0, 0, Hd);
  edge.addColorStop(0, rgba(color, .9)); edge.addColorStop(.55, rgba(color, .25)); edge.addColorStop(1, rgba(color, .5));
  box(10, 10, Wd - 20, Hd - 20, 30, null, edge, 2);

  // En-tête : la marque.
  const logo = await loadImage(logoUrl);
  if (logo) { g.save(); g.beginPath(); g.roundRect(PAD, 40, 40, 40, 11); g.clip(); g.drawImage(logo, PAD, 40, 40, 40); g.restore(); }
  text(g, 'RONOTE', PAD + 54, 58, { size: 15, weight: 800, color: '#e8eef8', spacing: 2.5 });
  text(g, 'PORTFOLIO FLEX', PAD + 54, 78, { size: 13, weight: 600, color: '#8795ad', spacing: 2 });

  // Le gain, en vedette : libellé, gros chiffre en dégradé, pastille du %.
  // En mode anonyme, le % prend la place du montant.
  const gainWord = { win: t('GAIN'), loss: t('PERTE'), even: t('VARIATION') }[tone];
  const kicker = w.change ? `${gainWord} ${t('SUR')} ${w.change.label.toUpperCase()}` : t('VARIATION');
  text(g, kicker, PAD, 136, { size: 16, weight: 800, color, spacing: 2.5 });
  const heroText = !w.change ? '—' : w.anon ? pctText(w.change.pct) : signed(w.change.d);
  const heroSize = fit(g, heroText, 560, 112, 850);
  const heroGrad = g.createLinearGradient(PAD, 150, PAD + 520, 240);
  heroGrad.addColorStop(0, color); heroGrad.addColorStop(1, 'rgba(255,255,255,.95)');
  g.save(); g.shadowColor = rgba(color, .45); g.shadowBlur = 36;
  text(g, heroText, PAD - 4, 236, { size: heroSize, weight: 850, color: heroGrad, spacing: -2 });
  g.restore();
  if (w.change) {
    // La pastille : la flèche et le %, ou le verdict en mode anonyme.
    g.font = `850 ${heroSize}px ${FONT}`;
    if ('letterSpacing' in g) g.letterSpacing = '-2px';
    const hx = PAD - 4 + g.measureText(heroText).width + 22;
    if ('letterSpacing' in g) g.letterSpacing = '0px';
    const arrow = tone === 'win' ? '▲' : tone === 'loss' ? '▼' : '•';
    const chip = w.anon ? `${arrow} ${{ win: 'UP', loss: 'DOWN', even: 'FLAT' }[tone]}` : `${arrow} ${pctText(w.change.pct)}`;
    g.font = `800 28px ${FONT}`;
    const cw2 = g.measureText(chip).width + 36;
    box(hx, 176, cw2, 52, 26, rgba(color, .15), rgba(color, .45), 1.5);
    text(g, chip, hx + cw2 / 2, 212, { size: 28, weight: 800, color, align: 'center' });
  }

  // À droite, discret : ce que vaut le compte.
  text(g, w.label.toUpperCase(), Wd - PAD, 160, { size: 13, weight: 700, color: '#8795ad', align: 'right', spacing: 1.5 });
  if (w.anon) text(g, t('Montants masqués'), Wd - PAD, 196, { size: 24, weight: 700, color: '#93a1b8', align: 'right' });
  else text(g, w.value ? full(w.value) : '—', Wd - PAD, 200, { size: 34, weight: 800, color: '#f3f6fc', align: 'right' });
  text(g, t('au {d}', { d: new Date(w.asOf || Date.now()).toLocaleDateString(locale(), { day: 'numeric', month: 'short' }) }),
    Wd - PAD, 230, { size: 15, weight: 600, color: '#7f8ca3', align: 'right' });

  // Le graphique, dans un panneau de verre.
  const px = PAD - 8, pw = Wd - 2 * (PAD - 8);
  box(px, 264, pw, 320, 24, clear ? 'rgba(8,12,22,.74)' : 'rgba(255,255,255,.035)', 'rgba(255,255,255,.08)');
  if (w.chart) plot(g, w.chart, px, pw, 264);
  else text(g, t('Pas encore de courbe Rolimon’s.'), Wd / 2, 430, { size: 20, weight: 600, color: '#7f8ca3', align: 'center' });

  // La barre de chiffres, comme les totaux d'une offre.
  const tiles = w.tiles.map(([label, n, prefix = '']) => [label, typeof n === 'string' ? n : n ? prefix + full(n) : '—']);
  box(px, 600, pw, 84, 20, clear ? 'rgba(8,12,22,.74)' : 'rgba(255,255,255,.04)', 'rgba(255,255,255,.07)');
  const cw = pw / tiles.length;
  tiles.forEach(([label, value], i) => {
    const cx = px + cw * i;
    if (i) { g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(cx, 616, 1, 52); }
    text(g, label.toUpperCase(), cx + 28, 632, { size: 13, weight: 700, color: '#8795ad', spacing: 1.5 });
    text(g, value, cx + 28, 664, { size: fit(g, value, cw - 56, 26, 800), weight: 800, color: '#f3f6fc' });
  });

  // Pied : d'où viennent les chiffres, et la date du relevé.
  const date = new Date(w.asOf || Date.now()).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
  text(g, w.anon ? t("Courbe Rolimon's · montants, rang et pseudo masqués") : t("Courbe Rolimon's · pseudo masqué"),
    PAD, Hd - 38, { size: 15, weight: 500, color: '#7f8ca3' });
  text(g, date, Wd - PAD, Hd - 38, { size: 15, weight: 600, color: '#7f8ca3', align: 'right' });
}

/**
 * Le graphique du Portefeuille : les courbes choisies (tracés déjà calculés
 * par le popup, même modèle et même lissage), l'aire de la première, les
 * repères, la légende et les dates de la période.
 */
function plot(g, c, px, pw, top) {
  const { x, y, w, h } = FLEX_PLOT;
  // Légende à gauche, période à droite.
  let lx = px + 24;
  for (const line of c.lines) {
    g.beginPath(); g.arc(lx + 5, top + 34, 5, 0, Math.PI * 2); g.fillStyle = line.color; g.fill();
    text(g, line.label, lx + 18, top + 40, { size: 17, weight: 700, color: '#e8eef8' });
    g.font = `700 17px ${FONT}`;
    lx += 18 + g.measureText(line.label).width + 22;
  }
  text(g, `${c.from}  →  ${c.to}`, px + pw - 24, top + 40, { size: 15, weight: 600, color: '#8795ad', align: 'right' });
  // Repères discrets.
  g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 1; g.setLineDash([4, 6]);
  for (const f of [0, .5, 1]) { g.beginPath(); g.moveTo(x, y + f * h); g.lineTo(x + w, y + f * h); g.stroke(); }
  g.setLineDash([]);
  text(g, c.top, x, y - 8, { size: 13, weight: 700, color: '#7f8ca3' });
  text(g, c.bottom, x, y + h + 20, { size: 13, weight: 700, color: '#7f8ca3' });
  // Aire sous la première courbe, puis les courbes, la première par-dessus.
  const [first] = c.lines;
  const area = new Path2D(first.path);
  area.lineTo(first.end[0], y + h); area.lineTo(first.start[0], y + h); area.closePath();
  const fill = g.createLinearGradient(0, y, 0, y + h);
  fill.addColorStop(0, rgba(first.color, .38)); fill.addColorStop(1, rgba(first.color, 0));
  g.fillStyle = fill; g.fill(area);
  g.lineJoin = 'round'; g.lineCap = 'round';
  for (const line of [...c.lines].reverse()) {
    g.save();
    if (line === first) { g.shadowColor = rgba(line.color, .6); g.shadowBlur = 14; }
    g.strokeStyle = line.color; g.lineWidth = line === first ? 3.5 : 2.5; g.globalAlpha = line === first ? 1 : .85;
    g.stroke(new Path2D(line.path));
    g.restore();
  }
  for (const line of c.lines) {
    g.beginPath(); g.arc(line.end[0], line.end[1], 9, 0, Math.PI * 2); g.fillStyle = rgba(line.color, .25); g.fill();
    g.beginPath(); g.arc(line.end[0], line.end[1], 4.5, 0, Math.PI * 2); g.fillStyle = line.color; g.fill();
  }
}
