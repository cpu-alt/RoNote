import { t, locale } from './i18n.js';

export const nowMs = () => Date.now();

/**
 * LES NOMBRES S'ECRIVENT COMME ROBLOX LES ECRIT : 1,836,950 — virgule pour
 * les milliers, point pour la decimale, quelle que soit la langue. Le format
 * francais (espaces fines) ressortait avec des espaces tantot larges, tantot
 * doubles selon la police, et jurait avec les nombres de la page juste a cote.
 */
const NUM_LOCALE = 'en-US';
const nf = (n, max) => Number(n).toLocaleString(NUM_LOCALE, { minimumFractionDigits: 0, maximumFractionDigits: max });
/**
 * Nombre compact : 1,5k · 24k · 2,4M. Le separateur decimal est celui de la
 * langue — un « 1.5k » au milieu de nombres ecrits « 1 500 » se voit.
 */
export function fmtNum(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return '\u2014';
  const a = Math.abs(n);
  if (a >= 1_000_000) return nf(n / 1_000_000, a >= 10_000_000 ? 0 : 1) + 'M';
  if (a >= 1_000)     return nf(n / 1_000, a >= 10_000 ? 0 : 1) + 'k';
  return String(Math.round(n));
}

/**
 * Pourcentage signe : +12,4% · −93% · +3 482%. Une decimale en dessous de
 * 100 %, aucune au-dela — « +3482.1% » se lit mal et la decimale n'y apporte
 * rien. Meme signe moins que fmtSigned (« − », pas « - »).
 */
export function fmtPct(p) {
  if (p === null || p === undefined || !Number.isFinite(p)) return '\u2014';
  const a = Math.abs(p);
  const body = nf(a, a >= 100 ? 0 : 1);
  return (p < 0 ? '\u2212' : p > 0 ? '+' : '') + body + '%';
}

export function timeAgo(iso) {
  const at = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!at) return '';
  const s = Math.max(0, (Date.now() - at) / 1000);
  if (s < 60) return t('il y a {n}s', { n: Math.floor(s) });
  if (s < 3600) return t('il y a {n} min', { n: Math.floor(s / 60) });
  if (s < 86400) return t('il y a {n} h', { n: Math.floor(s / 3600) });
  return t('il y a {n} j', { n: Math.floor(s / 86400) });
}

/** Delai restant : « dans 3 h ». Vide si la date est passee. */
export function timeUntil(iso) {
  const at = typeof iso === 'number' ? iso : Date.parse(iso);
  if (!at) return '';
  const s = (at - Date.now()) / 1000;
  if (s <= 0) return '';
  if (s < 3600) return t('dans {n} min', { n: Math.max(1, Math.floor(s / 60)) });
  if (s < 86400) return t('dans {n} h', { n: Math.floor(s / 3600) });
  return t('dans {n} j', { n: Math.floor(s / 86400) });
}

/** "23:00" -> 1380 */
function hm(str) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(str || '').trim());
  if (!m) return null;
  return (+m[1]) * 60 + (+m[2]);
}

/** Gere aussi les plages qui passent minuit (23:00 -> 08:00). */
export function inQuietHours(qh, date = new Date()) {
  if (!qh?.enabled) return false;
  const start = hm(qh.start), end = hm(qh.end);
  if (start === null || end === null) return false;
  const cur = date.getHours() * 60 + date.getMinutes();
  return start <= end ? (cur >= start && cur < end) : (cur >= start || cur < end);
}

export function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * fetch avec delai maximal. Sans lui, un appel que Roblox ou Rolimon's ne
 * terminait jamais gardait le cycle de verification ouvert indefiniment — et
 * son verrou avec : plus aucune notification jusqu'au redemarrage du worker.
 */
export async function fetchWithTimeout(url, init = {}, ms = 20000) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
  try {
    return await fetch(url, ctrl ? { ...init, signal: ctrl.signal } : init);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/** Nombre complet, separateurs francais : 1 836 950. */
export function fmtFull(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—';
  return Math.round(Number(n)).toLocaleString(NUM_LOCALE);
}

/** Ecart signe, toujours avec son signe : +12,4k / -3 200. */
export function fmtSigned(n, full = false) {
  const v = Number(n) || 0;
  return (v > 0 ? '+' : v < 0 ? '−' : '') + (full ? fmtFull(Math.abs(v)) : fmtNum(Math.abs(v)));
}

export const fmtDate = (ms) =>
  new Date(ms).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: '2-digit' });

/** Signe du ton a appliquer : win / loss / even. */
export const toneOf = (n, dead = 0) =>
  (n > dead ? 'win' : n < -dead ? 'loss' : 'even');

export const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Vrai si deux valeurs serialisables sont identiques (evite un rendu inutile). */
export const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
