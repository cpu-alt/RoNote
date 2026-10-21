/**
 * ==========================================================================
 *  LES COURBES DU POPUP
 * --------------------------------------------------------------------------
 *  Portefeuille, accueil, fiche d'un joueur, fiche d'un objet : un seul
 *  modele, un seul lissage, un seul survol. La carte Flex reprend le meme
 *  modele (chartModel, smoothPath) pour que l'image partagee et le graphique
 *  ne puissent pas dire deux choses differentes.
 *
 *  Les montants passent par `setMoneyFormat` : c'est le popup qui sait s'ils
 *  doivent etre masques (mode anonyme).
 * ==========================================================================
 */
import { fmtNum, fmtPct, fmtFull, fmtDate, toneOf, clamp } from '../common/utils.js';
import { t } from '../common/i18n.js';
import { REDUCED_MOTION } from '../common/ui.js';

let money = { full: fmtFull, short: fmtNum };

/** Le popup fournit ses formats de montant, qui suivent le mode anonyme. */
export function setMoneyFormat(full, short) {
  money = { full, short };
}

/** Un chiffre d'une courbe : un montant (masquable) ou un nombre d'objets. */
export const seriesText = (def, n) => (def.money ? money.full(n) : fmtFull(n));
const seriesShort = (def, n) => (def.money ? money.short(n) : fmtNum(n));

/** Séries valides, dans l'ordre de référence — jamais aucune. */
export function orderedSeries(keys, defs) {
  const list = Object.keys(defs).filter(k => Array.isArray(keys) && keys.includes(k));
  return list.length ? list : [Object.keys(defs)[0]];
}

/** Ajoute ou retire une courbe ; la dernière affichée ne se retire pas. */
export function toggleSeries(keys, key, defs) {
  const next = keys.includes(key) ? keys.filter(k => k !== key) : [...keys, key];
  return next.length ? orderedSeries(next, defs) : keys;
}

/* ------------------------------ les courbes ------------------------------ */

const CHART = { W: 400, H: 130, PT: 24, PB: 20, PR: 14, MAX: 220 };
const plotX = (fx) => fx * (CHART.W - CHART.PR);
const plotPct = (fx) => (plotX(fx) / CHART.W) * 100;
const chartY = (v, min, span) =>
  (CHART.PT + (1 - (v - min) / span) * (CHART.H - CHART.PT - CHART.PB)) / CHART.H;

/** Au-delà de ~220 points la courbe n'y gagne rien : on échantillonne, premier et dernier compris. */
export function downsample(pts) {
  if (pts.length <= CHART.MAX) return pts;
  const step = (pts.length - 1) / (CHART.MAX - 1);
  return Array.from({ length: CHART.MAX }, (_, i) => pts[Math.round(i * step)]);
}

function nearestIndex(pts, at) {
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].at < at) lo = mid; else hi = mid;
  }
  return at - pts[lo].at <= pts[hi].at - at ? lo : hi;
}

/**
 * Les courbes, prêtes à tracer, placées dans le temps réel (pas au rang du
 * relevé : un historique résumé sur les années anciennes ne doit pas les
 * étirer). Des courbes de même unité partagent l'axe ; dès qu'on mêle Robux
 * et nombre d'objets, chacune passe en variation depuis le début de la
 * période — la seule façon honnête de les empiler.
 */
export function chartModel(pts, keys, defs) {
  const t0 = pts[0].at, t1 = pts[pts.length - 1].at;
  const xs = pts.map(p => (t1 > t0 ? (p.at - t0) / (t1 - t0) : 0));
  const percent = keys.length > 1 && new Set(keys.map(k => defs[k].money)).size > 1;
  const lines = keys.map(key => {
    const base = pts.find(p => p[key] > 0)?.[key] || 0;
    const vals = pts.map(p => (percent ? (base ? (((p[key] || 0) - base) / base) * 100 : 0) : (p[key] || 0)));
    return { key, base, vals };
  });
  const all = lines.flatMap(l => l.vals);
  let min = Math.min(...all), max = Math.max(...all);
  if (percent) { min = Math.min(min, 0); max = Math.max(max, 0); }
  return { xs, lines, percent, min, span: (max - min) || 1 };
}

/**
 * Courbe lisse qui ne dépasse jamais les relevés (cubique monotone,
 * Fritsch-Carlson) : une révision de cote reste une marche franche, pas une
 * vague qui inventerait un creux avant la hausse.
 */
export function smoothPath(xy) {
  const f = (n) => n.toFixed(1);
  const n = xy.length;
  if (n < 3) return 'M' + xy.map(p => `${f(p[0])},${f(p[1])}`).join('L');
  const dx = [], m = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = (xy[i + 1][0] - xy[i][0]) || 1e-6;
    m[i] = (xy[i + 1][1] - xy[i][1]) / dx[i];
  }
  const tan = [m[0]];
  for (let i = 1; i < n - 1; i++) tan[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  tan[n - 1] = m[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { tan[i] = 0; tan[i + 1] = 0; continue; }
    const a = tan[i] / m[i], b = tan[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); tan[i] = k * a * m[i]; tan[i + 1] = k * b * m[i]; }
  }
  let d = `M${f(xy[0][0])},${f(xy[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${f(xy[i][0] + h)},${f(xy[i][1] + tan[i] * h)} ${f(xy[i + 1][0] - h)},${f(xy[i + 1][1] - tan[i + 1] * h)} ${f(xy[i + 1][0])},${f(xy[i + 1][1])}`;
  }
  return d;
}

/**
 * Le graphique : courbes lissées et remplies, point du moment qui pulse,
 * plus haut et plus bas de la période, révisions de cote. Le survol est
 * branché ensuite par mountChart.
 */
export function chartHtml({ id, pts, keys, defs, animate = false, markers = [] }) {
  if (pts.length < 2) return `<div class="w-nochart">${t('Pas encore assez de points sur cette période.')}</div>`;
  const { W, H } = CHART;
  const m = chartModel(pts, keys, defs);
  const yPct = (v) => chartY(v, m.min, m.span) * 100;

  let gradients = '';
  const areas = [], lines = [], ends = [];
  m.lines.forEach((l, n) => {
    const def = defs[l.key];
    const d = smoothPath(l.vals.map((v, i) => [plotX(m.xs[i]), chartY(v, m.min, m.span) * H]));
    const gid = `${id}-g${n}`;
    const solo = m.lines.length === 1;
    gradients += `<linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="${def.color}" stop-opacity="${solo ? 0.36 : 0.15}"/>
      <stop offset="100%" stop-color="${def.color}" stop-opacity="0"/></linearGradient>`;
    // Le remplissage court jusqu'au bord, à plat depuis le dernier relevé :
    // sans ça, il s'arrêtait net sous le point du moment, en arête verticale.
    const lastY = (chartY(l.vals[l.vals.length - 1], m.min, m.span) * H).toFixed(1);
    areas.push(`<path d="${d}L${W},${lastY}L${W},${H}L0,${H}Z" fill="url(#${gid})"/>`);
    lines.push(`<path class="w-line" d="${d}" fill="none" stroke="${def.color}" stroke-width="${n ? 1.7 : 2.3}"
      stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" style="filter:drop-shadow(0 0 5px ${def.color}55)"/>`);
    ends.push(`<i class="w-end" style="left:${plotPct(1)}%;top:${yPct(l.vals[l.vals.length - 1])}%;--c:${def.color}"></i>`);
  });

  const zeroY = (chartY(0, m.min, m.span) * H).toFixed(1);
  const zero = m.percent ? `<line class="w-zero" x1="0" x2="${W}" y1="${zeroY}" y2="${zeroY}" vector-effect="non-scaling-stroke"/>` : '';

  // Plus haut et plus bas : seulement pour une courbe seule, sinon illisible.
  let extremes = '';
  if (m.lines.length === 1) {
    const vals = m.lines[0].vals;
    let hi = 0, lo = 0;
    vals.forEach((v, i) => { if (v > vals[hi]) hi = i; if (v < vals[lo]) lo = i; });
    if (vals[hi] !== vals[lo]) {
      const tag = (i, cls) => `<span class="w-ext ${cls}" style="left:${clamp(plotPct(m.xs[i]), 10, 88)}%;top:${yPct(vals[i])}%">${seriesShort(defs[keys[0]], vals[i])}</span>`;
      extremes = tag(hi, 'hi') + tag(lo, 'lo');
    }
  }

  // Révisions de la cote, posées sur la courbe de la value. Un objet ancien en
  // compte des dizaines par an : seules les 10 plus fortes de la période.
  const vLine = !m.percent ? m.lines.find(l => l.key === 'v') : null;
  const swing = (c) => Math.abs(c.to - c.from) / (c.from || c.to || 1);
  const marks = vLine
    ? markers.filter(c => c.at >= pts[0].at && c.at <= pts[pts.length - 1].at)
      .sort((a, b) => swing(b) - swing(a)).slice(0, 10).map(c => {
      const i = nearestIndex(pts, c.at);
      return `<i class="w-mark ${c.to >= c.from ? 'up' : 'down'}" style="left:${plotPct(m.xs[i])}%;top:${yPct(vLine.vals[i])}%"></i>`;
    }).join('')
    : '';

  return `<div class="w-plot${animate && !REDUCED_MOTION ? ' reveal' : ''}" id="${id}">
    <svg class="w-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <defs>${gradients}</defs>${zero}${areas.reverse().join('')}${lines.reverse().join('')}
    </svg>
    ${marks}${extremes}${ends.join('')}
    <div class="w-cursor" hidden></div>
    ${keys.map(k => `<i class="w-cdot" style="--c:${defs[k].color}" hidden></i>`).join('')}
    <div class="w-tip" hidden></div>
  </div>`;
}

/** Sous un graphique à plusieurs courbes : la variation de chacune sur la période. */
export function legendHtml(pts, keys, defs) {
  if (keys.length < 2 || pts.length < 2) return '';
  const m = chartModel(pts, keys, defs);
  const items = keys.map(k => {
    const def = defs[k];
    const base = pts.find(p => p[k] > 0)?.[k] || 0;
    const last = pts[pts.length - 1][k] || 0;
    const pct = base ? ((last - base) / base) * 100 : 0;
    return `<span><i style="background:${def.color}"></i>${t(def.label)} <em class="${toneOf(pct)}">${fmtPct(pct)}</em></span>`;
  }).join('');
  return `<div class="w-leg">${items}${m.percent ? `<small>${t('en % depuis le début de la période')}</small>` : ''}</div>`;
}

/**
 * Le survol : curseur, un point par courbe, infobulle avec la valeur de
 * chacune au jour pointé. Tout suit la souris image par image.
 */
export function mountChart({ id, pts, keys, defs, onScrub = null }) {
  const plot = document.getElementById(id);
  if (!plot || pts.length < 2) return;
  const m = chartModel(pts, keys, defs);
  const cursor = plot.querySelector('.w-cursor');
  const tip = plot.querySelector('.w-tip');
  const dots = [...plot.querySelectorAll('.w-cdot')];
  const t0 = pts[0].at, t1 = pts[pts.length - 1].at;
  let frame = 0;
  // Mesurees une fois : l'infobulle garde la meme forme d'un point a l'autre
  // (une ligne par courbe), et le trace garde sa hauteur. Les lire apres avoir
  // ecrit leur contenu forcait un calcul de mise en page a chaque image du
  // survol — d'ou les saccades.
  let tipH = 0, plotH = 0;

  const show = (clientX) => {
    const box = plot.getBoundingClientRect();
    const fx = clamp((clientX - box.left) / (box.width * (CHART.W - CHART.PR) / CHART.W), 0, 1);
    const i = nearestIndex(pts, t0 + fx * (t1 - t0));
    const x = plotPct(m.xs[i]);
    plot.classList.add('scrub');
    cursor.hidden = tip.hidden = false;
    cursor.style.left = x + '%';
    dots.forEach((dot, n) => {
      dot.hidden = false;
      dot.style.left = x + '%';
      dot.style.top = chartY(m.lines[n].vals[i], m.min, m.span) * 100 + '%';
    });
    tip.innerHTML = `<b>${fmtDate(pts[i].at)}</b>` + keys.map((k, n) => {
      const def = defs[k];
      const pct = m.percent ? `<em>${fmtPct(m.lines[n].vals[i])}</em>` : '';
      return `<span><i style="background:${def.color}"></i>${t(def.label)}<strong>${seriesText(def, pts[i][k] || 0)}</strong>${pct}</span>`;
    }).join('');
    tip.style.left = clamp(x, 21, 79) + '%';
    // L'infobulle ne doit pas cacher le point survolé : quand la courbe passe
    // sous elle, elle descend en bas du graphique.
    const highest = Math.min(...m.lines.map(l => chartY(l.vals[i], m.min, m.span)));
    if (!tipH) tipH = tip.offsetHeight;
    if (!plotH) plotH = plot.clientHeight;
    const low = highest < (tipH + 8) / plotH;
    tip.style.top = low ? 'auto' : '0';
    tip.style.bottom = low ? '0' : 'auto';
    onScrub?.(i);
  };

  plot.addEventListener('pointermove', (e) => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => show(e.clientX));
  });
  plot.addEventListener('pointerleave', () => {
    cancelAnimationFrame(frame);
    plot.classList.remove('scrub');
    cursor.hidden = tip.hidden = true;
    dots.forEach(dot => { dot.hidden = true; });
    onScrub?.(null);
  });
}

export function seriesChips(defs, keys, attr) {
  return `<div class="w-series">${Object.entries(defs).map(([k, d]) =>
    `<button class="${keys.includes(k) ? 'on' : ''}" ${attr}="${k}" style="--c:${d.color}"><i></i>${t(d.label)}</button>`).join('')}</div>`;
}

/* ------------------------- graphique a plages ---------------------------- */

/** Les periodes des graphiques a plages (fiches d'un joueur et d'un objet). */
const ITEM_RANGES = [
  { key: '1m', label: '1m', days: 30 },
  { key: '3m', label: '3m', days: 90 },
  { key: '1y', label: '1a', days: 365 },
  { key: 'all', label: 'Tout', days: 0 }
];

/**
 * Le corps commun des deux graphiques a plages — celui de la fiche joueur et
 * celui de la fiche d'un objet. Ils ne different que par l'etat qui les pilote,
 * les attributs qui les nomment et ce qui se passe une fois traces ; tout le
 * reste (plage, echantillonnage, series disponibles, pastilles, courbe,
 * legende, recablage) etait ecrit deux fois, et divergeait deja.
 *
 * Rend false quand aucune serie n'a de quoi etre tracee : a l'appelant de dire
 * pourquoi, avec ses mots et sa mise en page.
 */
export function renderRangedChart({ box, points, series, state, attr, id, defs = null, markers = [], animate = false, redraw, after = null }) {
  const avail = Object.fromEntries(Object.entries(series).filter(([k]) => points.some(p => p[k] > 0)));
  if (!Object.keys(avail).length) return false;

  const range = ITEM_RANGES.find(r => r.key === state.range) || ITEM_RANGES[2];
  const since = range.days ? Date.now() - range.days * 864e5 : 0;
  const pts = downsample(points.filter(p => p.at >= since));
  const keys = orderedSeries(state.series, avail);
  const shown = defs || avail;

  box.innerHTML = `${seriesChips(avail, keys, `data-${attr}series`)}
    ${chartHtml({ id, pts, keys, defs: shown, animate, markers })}
    ${legendHtml(pts, keys, shown)}
    <div class="w-ranges">${ITEM_RANGES.map(r =>
      `<button class="${r.key === range.key ? 'on' : ''}" data-${attr}range="${r.key}">${t(r.label)}</button>`).join('')}</div>`;
  mountChart({ id, pts, keys, defs: shown });

  box.querySelectorAll(`[data-${attr}series]`).forEach(el => el.addEventListener('click', () => {
    state.series = toggleSeries(keys, el.dataset[attr + 'series'], avail);
    redraw(true);
  }));
  box.querySelectorAll(`[data-${attr}range]`).forEach(el => el.addEventListener('click', () => {
    state.range = el.dataset[attr + 'range'];
    redraw(true);
  }));

  after?.(pts, avail);
  return true;
}
