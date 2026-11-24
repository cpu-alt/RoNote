/**
 * ==========================================================================
 *  MES ITEMS : LE BEST PRICE DE CE QUE JE POSSÈDE (24 novembre)
 * --------------------------------------------------------------------------
 *  Comme le panneau d'un compte suivi sur Discord : pour chaque item de mon
 *  inventaire, le moins cher en vente au catalogue Roblox (best price) et le
 *  ratio best price / RAP. Un ratio haut = l'item se revend bien au-dessus de
 *  son RAP. Insider et Elite (le serveur refuse les autres : `lockHtml`).
 *
 *  Rapide : une seule liste (`/ext/v1/bestprices`, gardée 60 s par le worker
 *  et le serveur), croisée ici avec l'inventaire du Portefeuille déjà en
 *  mémoire (`report.items`, RAP et vignettes compris). Aucun appel à Roblox.
 * ==========================================================================
 */
import { t } from '../common/i18n.js';
import { ic } from '../common/icons.js';
import { fmtNum, escapeHtml } from '../common/utils.js';
import { send } from '../common/ui.js';
import { discoverSwitch } from './deals.js';
import { lockHtml } from './lock.js';

const KEY = 'ronote.myitems';
const MINS = [0, 1.2, 1.5, 2];
const SORTS = [['ratio', 'Ratio'], ['gain', 'Profit']];
const pick = () => {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* privé */ }
  return { min: MINS.includes(p.min) ? p.min : 0, sort: SORTS.some(([k]) => k === p.sort) ? p.sort : 'ratio' };
};
const write = (p) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* privé */ } };

let last = null;          // la dernière réponse du worker
let report = null;        // l'inventaire du Portefeuille

/** Mes items en vente, avec ratio et gain (best price − RAP, par copie). Exposé pour les tests. */
export function rowsOf(items, prices) {
  const rows = [];
  let unlisted = 0;
  for (const i of items || []) {
    // un visage est rangé sous son bundle : son ancien asset est l'id que connaît le catalogue
    const bp = prices[String(i.id)] || (i.faceAssetId && prices[String(i.faceAssetId)]) || 0;
    if (!bp || !(i.rap > 0)) { unlisted += 1; continue; }
    rows.push({ ...i, bp, ratio: bp / i.rap, gain: bp - i.rap });
  }
  return { rows, unlisted };
}

const chip = (attr, v, label, on) => `<button role="radio" aria-checked="${on}" ${attr}="${v}">${label}</button>`;

function rowHtml(r) {
  const img = r.thumb ? `<img src="${escapeHtml(r.thumb)}" alt="" width="34" height="34" loading="lazy" decoding="async">`
    : `<span class="nc-ph">${escapeHtml((r.acronym || r.name || '?').slice(0, 2))}</span>`;
  const url = r.kind === 'bundle' ? `https://www.roblox.com/bundles/${r.id}` : `https://www.roblox.com/catalog/${r.id}`;
  const tone = r.ratio >= 1.5 ? 'hot' : r.ratio >= 1 ? 'up' : 'down';
  return `<button class="mi-row" data-open="${url}" title="${escapeHtml(t('Ouvrir sur Roblox pour le vendre'))}">
    <span class="mi-img">${img}${r.count > 1 ? `<i class="nc-n">×${r.count}</i>` : ''}</span>
    <span class="mi-id"><b>${escapeHtml(r.name)}</b><small>RAP ${fmtNum(r.rap)} · ${t('Meilleur prix')} <b>${fmtNum(r.bp)}</b></small></span>
    <span class="mi-num"><b class="mi-ratio ${tone}">x${r.ratio.toFixed(2)}</b><small class="${r.gain >= 0 ? 'win' : 'loss'}">${r.gain >= 0 ? '+' : '−'}${fmtNum(Math.abs(r.gain))}</small></span>
  </button>`;
}

function empty(title, text) {
  return `<div class="empty"><div class="empty-ic">${ic('percent')}</div><b>${t(title)}</b>${text ? `<span>${t(text)}</span>` : ''}</div>`;
}

function paint(root) {
  const p = pick();
  const head = (count) => `<div class="pf-head">${discoverSwitch('myitems', count == null ? '' : `<span class="pf-count">${t('{n} objets', { n: count })}</span>`)}
    <div class="pf-bar"><div class="pf-seg" role="radiogroup" aria-label="${escapeHtml(t('Ratio minimum'))}">${MINS.map(m =>
      chip('data-mi-min', m, m ? 'x' + m + '+' : t('Tous'), m === p.min)).join('')}</div>
      <div class="pf-seg" role="radiogroup" aria-label="${escapeHtml(t('Tri'))}">${SORTS.map(([k, l]) => chip('data-mi-sort', k, t(l), k === p.sort)).join('')}</div></div></div>`;
  if (!last) { root.innerHTML = head(null) + `<div class="pf-list">${'<div class="pf-skel"></div>'.repeat(4)}</div>`; return; }
  if (last.locked) { root.innerHTML = head(null) + lockHtml(last); return; }
  if (!last.data) {
    root.innerHTML = head(null) + (last.off ? empty('Fiches Neuronal coupées', 'Active « Fiches Neuronal » dans Réglages › Valeurs.')
      : empty('Neuronal est injoignable.', ''));
    return;
  }
  if (!report?.items?.length) { root.innerHTML = head(null) + empty('Inventaire pas encore lu', 'Ouvre le Portefeuille une fois, puis reviens ici.'); return; }
  const { rows, unlisted } = rowsOf(report.items, last.data.prices || {});
  const shown = rows.filter(r => r.ratio >= p.min).sort((a, b) => p.sort === 'gain' ? b.gain - a.gain : b.ratio - a.ratio);
  root.innerHTML = head(shown.length) + (shown.length
    ? `<div class="mi-list">${shown.map(rowHtml).join('')}</div>`
    : empty('Aucun item', 'Rien de ton inventaire en vente à ce ratio.'))
    + (unlisted ? `<p class="mi-foot">${t('{n} autres items : personne ne les vend en ce moment.', { n: unlisted })}</p>` : '');
}

export async function renderMyItems(root, inventory) {
  report = inventory;
  if (!root.dataset.miBound) {
    root.dataset.miBound = '1';
    root.addEventListener('click', (e) => {
      if (root.dataset.tab !== 'myitems') return;
      const el = e.target.closest('[data-mi-min], [data-mi-sort]');
      if (!el) return;
      const p = pick();
      if (el.dataset.miMin !== undefined) p.min = Number(el.dataset.miMin);
      else p.sort = el.dataset.miSort;
      write(p);
      paint(root);
    });
  }
  paint(root);
  last = await send({ type: 'ronote:neuronal-bestprices' }).catch(() => null) || { error: 'empty' };
  if (root.dataset.tab === 'myitems') paint(root);
}
