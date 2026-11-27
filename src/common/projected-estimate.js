/**
 * ==========================================================================
 *  LE VRAI PRIX D'UN ITEM PROJECTED (Elite)
 * --------------------------------------------------------------------------
 *  Le calcul de `/projected check` (Neuronal, neuronal/16_projected.py,
 *  `analyser_projected`), porté tel quel pour quand Neuronal ne répond pas.
 *  Source : la page item de Rolimon's, `history_data` (RAP et best price
 *  toutes les 30 min depuis 2016) et `sales_data` (ventes par jour).
 *
 *  27 nov. (MYd, Crazy Spiked Hood : ~20k réels, RoNote donnait bien moins) :
 *  l'ancien calcul lisait les ventes de Roblox (resale-data), FIGÉES depuis
 *  janvier 2025 : il voyait l'item à 4 995 avant même son pump d'août 2025.
 *
 *   1. Le pump : la plus grosse montée tenue (×1,3 sur la médiane des 14 jours
 *      d'avant, jamais redescendue sous ×1,2) autour du flag Rolimon's quand
 *      on connaît sa date, sinon dans l'année, puis les deux ans ; sinon le
 *      dernier saut VIOLENT (×2,5) ; on recule sur les pumps enchaînés.
 *   2. La base : la médiane du RAP des 60 jours d'avant le pump. Une vraie
 *      Value Rolimon's passe devant.
 *   3. Les ventes d'après pump (sans les pumpeurs, au-dessus de 80 % du RAP
 *      affiché, ni les dons, sous 20 % de la base) : où l'item retombe
 *      (médiane pondérée, demi-vie 30 jours), jamais sous la base.
 *   4. Demande, gros item, annonce la plus basse de l'année sur un marché mort,
 *      marge −10 %, best price en plafond ; Lowball 0,80× / Max 1,05×.
 *  Aucun réseau ici. Temps en SECONDES, comme Rolimon's et Neuronal.
 * ==========================================================================
 */

const DAY = 86400;
export const PROJ_DAYS_HISTO = 730;
export const PROJ_DAYS_FULL = 365 * 10;
export const PROJ_VIOLENT = 2.5;
export const PROJ_DAYS_SALES = 90;
export const PROJ_DAYS_TREND = 180;
export const PROJ_HALF_LIFE = 30 * DAY;
export const PROJ_FLAG_BEFORE = 120, PROJ_FLAG_AFTER = 3;
export const PROJ_RECENT_WINDOWS = [365, 730];
export const PROJ_BIG_BONUS = [[100_000, 0.05], [50_000, 0.03]];
export const PROJ_MARGIN = 0.90;
export const PROJ_LOWBALL = 0.80, PROJ_MAX = 1.05;

/** Médiane entière, comme `_mediane` (la moyenne des deux du milieu, arrondie vers le bas). */
export function median(xs) {
  const v = xs.filter(x => x != null).sort((a, b) => a - b);
  if (!v.length) return 0;
  const n = v.length;
  return n % 2 ? v[n >> 1] : Math.floor((v[n / 2 - 1] + v[n / 2]) / 2);
}
const percentile = (xs, p) => {
  const v = xs.filter(x => x != null).sort((a, b) => a - b);
  return v.length ? v[Math.min(v.length - 1, Math.floor((v.length - 1) * p))] : 0;
};

/** Un montant qu'on dit à l'oral : au 100 près sous 10k, au 500 sous 100k, au 1 000 au-delà. */
export function roundNice(x) {
  x = Math.trunc(Number(x) || 0);
  if (x <= 0) return 0;
  const step = x < 10_000 ? 100 : x < 100_000 ? 500 : 1_000;
  return Math.round(x / step) * step;
}

/** [[jour_ts, dernier RAP du jour]] sur les N derniers jours, du plus ancien au plus récent. */
export function dailySeries(ts, rap, days, now) {
  const since = now - days * DAY;
  const byDay = new Map();
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i], r = rap[i];
    if (t == null || r == null || t < since || r <= 0) continue;
    byDay.set(Math.floor(t / DAY), Math.trunc(r));
  }
  return [...byDay].sort((a, b) => a[0] - b[0]).map(([d, r]) => [d * DAY, r]);
}

/** [[indice, facteur]] : le RAP saute de `jump`× la médiane des `win` jours d'avant et ne redescend plus sous `hold`×. */
export function pumpJumps(serie, jump = 1.3, win = 14, hold = 1.2) {
  if (serie.length < win + 2) return [];
  const raps = serie.map(([, r]) => r);
  const lowFrom = raps.slice();
  for (let i = raps.length - 2; i >= 0; i--) lowFrom[i] = Math.min(raps[i], lowFrom[i + 1]);
  const out = [];
  for (let i = win; i < raps.length; i++) {
    const ref = median(raps.slice(i - win, i));
    if (ref > 0 && raps[i] >= jump * ref && lowFrom[i] >= hold * ref) out.push([i, raps[i] / ref]);
  }
  return out;
}
const pumpCandidates = (serie, jump, win, hold) => pumpJumps(serie, jump, win, hold).map(([i]) => i);

function pumpAroundFlag(full, flagTs, now) {
  if (!full.length) return null;
  const start = full[0][0] + 90 * DAY;
  const jumps = pumpJumps(full, 1.3, 14, 1.2).filter(([k]) => full[k][0] >= start);
  const windows = flagTs ? [[flagTs - PROJ_FLAG_BEFORE * DAY, flagTs + PROJ_FLAG_AFTER * DAY]] : [];
  for (const d of PROJ_RECENT_WINDOWS) windows.push([now - d * DAY, now]);
  for (const [from, to] of windows) {
    const inside = jumps.filter(([k]) => full[k][0] >= from && full[k][0] <= to);
    if (inside.length) return inside.reduce((a, b) => (b[1] > a[1] ? b : a))[0];
  }
  return null;
}

function backOverChained(full, i) {
  for (let n = 0; n < 5; n++) {
    const tPump = full[i][0];
    const before = pumpCandidates(full.slice(0, i), 1.3, 14, 1.2).filter(k => full[k][0] >= tPump - 180 * DAY);
    if (!before.length) break;
    i = before[0];
  }
  return i;
}

/** L'indice du vrai début de la projection dans `full`, ou null (`detecter_pump_complet`). */
export function detectPump(full, recent, flagTs, now) {
  let i = pumpAroundFlag(full, flagTs, now);
  if (i != null) return backOverChained(full, i);
  let violent = pumpCandidates(full, PROJ_VIOLENT, 14, 1.5);
  if (full.length) violent = violent.filter(k => full[k][0] >= full[0][0] + 90 * DAY);
  if (violent.length) i = violent[violent.length - 1];
  else {
    const rec = pumpCandidates(recent, 1.3, 14, 1.2);
    if (!rec.length) return null;
    const t = recent[rec[0]][0];
    i = full.findIndex(([tk]) => tk >= t);
    if (i < 0) return null;
  }
  return backOverChained(full, i);
}

function weightedMedian(values, weights) {
  const pairs = values.map((v, k) => [v, weights[k]]).sort((a, b) => a[0] - b[0]);
  const total = weights.reduce((s, w) => s + w, 0);
  if (total <= 0) return 0;
  let acc = 0;
  for (const [v, w] of pairs) { acc += w; if (acc >= total / 2) return Math.trunc(v); }
  return Math.trunc(pairs[pairs.length - 1][0]);
}

/** Où convergent les ventes d'après pump : [direction | null, niveau] (`tendance_ventes`). */
export function salesTrend(dated, now) {
  if (dated.length < 2) return [null, dated.length ? dated[0][1] : 0];
  const prices = dated.map(([, p]) => p);
  const level = weightedMedian(prices, dated.map(([t]) => Math.pow(0.5, (now - t) / PROJ_HALF_LIFE)));
  const half = prices.length >> 1;
  const before = median(prices.slice(0, half)), after = median(prices.slice(half));
  if (before && after < 0.85 * before) return ['falling', Math.trunc(level * 0.9)];
  if (before && after > 1.15 * before) return ['rising', level];
  return ['settled', level];
}

/**
 * Lowball / Fair / Max d'un projected, comme `/projected check`.
 * @param {object} src  { ts, rap, best: séries de history_data ; salesTs, salesPrice, salesVol : sales_data }
 * @param {object} opt  { value (Value Rolimon's ou 0), demand (-1 sans), bestNow, flagTs, now (s) }
 * @returns {null | {fair, low, high, rap, base, basis: 'pump'|'value'|'distribution', pumped, pumpTs, sales, trend}}
 */
export function estimateProjected(src, { value = 0, demand = -1, bestNow = 0, flagTs = null, now = Date.now() / 1000 } = {}) {
  const ts = src?.ts || [], rap = src?.rap || [];
  if (!ts.length) return null;
  const serie = dailySeries(ts, rap, PROJ_DAYS_HISTO, now);
  const full = dailySeries(ts, rap, PROJ_DAYS_FULL, now);
  const rapNow = Math.trunc(rap[rap.length - 1] || 0);
  if (!(rapNow > 0)) return null;
  const i = detectPump(full, serie, flagTs, now);
  let base, pumpTs = null;
  if (i != null) {
    const before = full.slice(0, i).filter(([t]) => t >= full[i][0] - 60 * DAY).map(([, r]) => r);
    base = before.length ? median(before) : percentile(serie.map(([, r]) => r), 0.25);
    pumpTs = full[i][0];
  } else base = percentile(serie.map(([, r]) => r), 0.25);
  let basis = pumpTs != null ? 'pump' : 'distribution';
  if (base >= rapNow) { base = Math.min(percentile(serie.map(([, r]) => r), 0.10), rapNow); pumpTs = null; basis = 'distribution'; }
  if (value && value > 0 && value < Math.max(rapNow, 1) * 1.5) { base = Math.trunc(value); pumpTs = null; basis = 'value'; }

  // Les ventes réelles : plafond à 80 % du RAP affiché (le pumpeur), plancher à 20 % de la base (les dons).
  const cap = rapNow > base && base > 0 ? Math.trunc(rapNow * 0.8) : base ? 3 * base : 0;
  const since = now - (pumpTs ? PROJ_DAYS_FULL : PROJ_DAYS_TREND) * DAY;
  let dated = [];
  const sT = src.salesTs || [], sP = src.salesPrice || [], sV = src.salesVol || [];
  for (let k = 0; k < sT.length; k++) {
    const t = sT[k], p = sP[k];
    if (t == null || p == null || t < since || p <= 0 || (cap && p > cap)) continue;
    for (let n = 0; n < Math.max(1, Math.trunc(sV[k] || 1)); n++) dated.push([Number(t), Math.trunc(p)]);
  }
  dated = dated.filter(([, p]) => !base || p >= 0.2 * base).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const post = pumpTs ? dated.filter(([t]) => t >= pumpTs) : dated.filter(([t]) => t >= now - PROJ_DAYS_TREND * DAY);
  const recent = dated.filter(([t]) => t >= now - PROJ_DAYS_SALES * DAY);
  const n = recent.length, med = median(recent.map(([, p]) => p));
  let [trend, level] = salesTrend(post, now);

  let target = base;
  if (trend && level && base && post.length >= 3) {
    level = Math.max(level, base);
    const w = Math.min(post.length, 4) / 4;
    target = base * (1 - w) + level * w;
  } else if (n && med && base) {
    const w = Math.min(n, 6) / 6;
    target = base * (1 - w) + med * w;
  } else if (base) target *= 0.90;
  if (pumpTs != null && now - pumpTs < 30 * DAY) target *= 0.90;
  if (demand != null && demand >= 2) target *= 1.05;
  for (const [limit, bonus] of PROJ_BIG_BONUS) if (target >= limit) { target *= 1 + bonus; break; }

  // L'annonce la plus basse de l'année, seulement sur un marché mort (pas 3 ventes en 6 mois).
  const best = src.best || [];
  const yearLow = ts.map((t, k) => [t, best[k]]).filter(([t, b]) => t != null && t >= now - 365 * DAY && b > 0).map(([, b]) => b);
  const sellerFloor = yearLow.length ? Math.min(...yearLow) : 0;
  const alive = post.filter(([t]) => t >= now - 180 * DAY).length >= 3;
  if (sellerFloor && !alive && target > sellerFloor * 1.1) {
    const next = Math.max(sellerFloor * 1.1, target * 0.6, base);
    if (next < target) target = next;
  }
  if (target > 0) target *= PROJ_MARGIN;
  if (bestNow && bestNow > 0 && bestNow < target) target = bestNow;
  if (!(target > 0)) return null;

  let low = roundNice(target * PROJ_LOWBALL), high = roundNice(target * PROJ_MAX);
  if (bestNow && bestNow > 0 && bestNow < high) high = roundNice(bestNow);
  if (low > high) low = high;
  const fair = Math.min(Math.max(roundNice(target), low), high);
  return { fair, low, high, rap: rapNow, base: Math.trunc(base), basis, pumped: pumpTs != null, pumpTs,
    sales: post.length, trend: trend || '' };
}
