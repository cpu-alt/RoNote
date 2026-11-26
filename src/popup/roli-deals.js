/**
 * ==========================================================================
 *  LES DEALS DE ROLIMON'S (26 novembre)
 * --------------------------------------------------------------------------
 *  La page rolimons.com/deals dans RoNote : les limiteds vendus sous leur RAP
 *  ou leur value, en direct tant que la vue est ouverte (relue toutes les
 *  30 s, le worker ne lit que les changements : background/roli-deals.js).
 *  Sans serveur. Un clic ouvre la page de l'item sur Roblox pour l'acheter.
 * ==========================================================================
 */
import { t } from '../common/i18n.js';
import { fmtNum, escapeHtml, timeAgo } from '../common/utils.js';
import { send } from '../common/ui.js';
import { discoverSwitch } from './deals.js';

const KEY = 'ronote.rdeals';
const BASES = [['rap', 'RAP'], ['value', 'Value']];
const MINS = [0, 10, 20, 30];
const SORTS = [['deal', 'Remise'], ['new', 'Récents'], ['price', 'Prix']];
const MAX_ROWS = 120;

const pick = () => {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* privé */ }
  return {
    basis: BASES.some(([k]) => k === p.basis) ? p.basis : 'rap',
    min: MINS.includes(p.min) ? p.min : 10,
    sort: SORTS.some(([k]) => k === p.sort) ? p.sort : 'deal',
    proj: p.proj === true                              // projected visibles ?
  };
};
const write = (p) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* privé */ } };

let last = null, query = '', timer = 0;

/** Ce qui est montré, filtré et trié. Exposé pour les tests. */
export function shownOf(items, p, q = '') {
  const deal = (x) => p.basis === 'value' ? x.dealValue : x.dealRap;
  q = q.trim().toLowerCase();
  const out = (items || []).filter(x => (deal(x) ?? -1) >= Math.max(1, p.min) && (p.proj || !x.projected)
    && (!q || x.name.toLowerCase().includes(q) || String(x.acronym).toLowerCase() === q || String(x.id) === q));
  const key = { deal: x => deal(x), new: x => x.at, price: x => -x.bp }[p.sort];
  return out.sort((a, b) => key(b) - key(a));
}

const chip = (attr, v, label, on, role = 'radio') => `<button role="${role}" aria-checked="${on}" ${attr}="${v}">${label}</button>`;

function rowHtml(x, basis) {
  const url = x.kind === 'bundle' ? `https://www.roblox.com/bundles/${x.id}` : `https://www.roblox.com/catalog/${x.id}`;
  const d = basis === 'value' ? x.dealValue : x.dealRap;
  const img = x.thumb ? `<img src="${escapeHtml(x.thumb)}" alt="" width="34" height="34" loading="lazy" decoding="async">`
    : `<span class="nc-ph">${escapeHtml((x.acronym || x.name || '?').slice(0, 2))}</span>`;
  return `<button class="mi-row rd-row" data-open="${url}" title="${escapeHtml(t('Ouvrir sur Roblox'))}">
    <span class="mi-img">${img}</span>
    <span class="mi-id"><b>${escapeHtml(x.name)}${x.projected ? ` <i class="rd-proj">${t('projected')}</i>` : ''}</b>
      <small>${t('Prix')} <b>${fmtNum(x.bp)}</b> · RAP ${fmtNum(x.rap)}${x.value ? ` · Value ${fmtNum(x.value)}` : ''}</small></span>
    <span class="mi-num"><b class="mi-ratio ${d >= 30 ? 'hot' : 'up'}">−${d} %</b><small>${escapeHtml(timeAgo(x.at))}</small></span>
  </button>`;
}

function paint(root) {
  const p = pick();
  const box = root.querySelector('[data-rd-q]');
  const typing = box && document.activeElement === box ? box.selectionStart : null;
  const shown = last?.items ? shownOf(last.items, p, query) : null;
  root.innerHTML = `<div class="pf-head">${discoverSwitch('rdeals', shown ? `<span class="pf-count pf-live">${t('{n} deals', { n: shown.length })}</span>` : '')}
    <div class="pf-bar"><div class="pf-seg" role="radiogroup" aria-label="${escapeHtml(t('Base'))}">${BASES.map(([k, l]) => chip('data-rd-basis', k, l, k === p.basis)).join('')}</div>
      <div class="pf-seg" role="radiogroup" aria-label="${escapeHtml(t('Remise minimum'))}">${MINS.map(m => chip('data-rd-min', m, m ? `−${m}%` : t('Tous'), m === p.min)).join('')}</div></div>
    <div class="pf-bar"><div class="pf-seg" role="radiogroup" aria-label="${escapeHtml(t('Tri'))}">${SORTS.map(([k, l]) => chip('data-rd-sort', k, t(l), k === p.sort)).join('')}</div>
      <button class="mi-all" role="switch" aria-checked="${p.proj}" data-rd-proj>${t('Projected aussi')}</button></div>
    <div class="pf-bar dl-search"><input type="search" data-rd-q placeholder="${escapeHtml(t('Chercher un item (nom, initiales ou id)'))}"
      value="${escapeHtml(query)}" aria-label="${escapeHtml(t('Chercher un item'))}" autocomplete="off" spellcheck="false"></div></div>`
    + (!last ? `<div class="pf-list">${'<div class="pf-skel"></div>'.repeat(4)}</div>`
      : last.off ? `<div class="empty"><b>${t("Rolimon's est désactivé dans les réglages")}</b></div>`
      : !last.items ? `<div class="empty"><b>${t("Rolimon's est injoignable.")}</b><span>${escapeHtml(last.error || '')}</span></div>`
      : shown.length ? `<div class="mi-list">${shown.slice(0, MAX_ROWS).map(x => rowHtml(x, p.basis)).join('')}</div>`
        + `<p class="mi-foot">${t("Données de rolimons.com/deals, en direct. Un clic ouvre l'item sur Roblox.")}</p>`
      : `<div class="empty"><b>${t('Aucun deal')}</b><span>${t('Rien ne correspond à ces filtres pour le moment.')}</span></div>`);
  if (typing !== null) { const b = root.querySelector('[data-rd-q]'); b?.focus(); b?.setSelectionRange(typing, typing); }
}

const visible = (root) => root.isConnected && root.dataset.tab === 'rdeals' && document.visibilityState === 'visible';

async function load(root) {
  const res = await send({ type: 'ronote:roli-deals' }).catch(() => null) || { error: 'empty' };
  if (!visible(root)) return;
  if (res.items || !last?.items) { last = res; const top = root.scrollTop; paint(root); root.scrollTop = top; }
}

export function renderRoliDeals(root) {
  if (!root.dataset.rdBound) {
    root.dataset.rdBound = '1';
    root.addEventListener('click', (e) => {
      if (root.dataset.tab !== 'rdeals') return;
      const el = e.target.closest('[data-rd-basis], [data-rd-min], [data-rd-sort], [data-rd-proj]');
      if (!el) return;
      const p = pick();
      if (el.dataset.rdBasis) p.basis = el.dataset.rdBasis;
      else if (el.dataset.rdMin !== undefined) p.min = Number(el.dataset.rdMin);
      else if (el.dataset.rdSort) p.sort = el.dataset.rdSort;
      else p.proj = !p.proj;
      write(p);
      paint(root);
    });
    root.addEventListener('input', (e) => {
      if (root.dataset.tab !== 'rdeals' || !e.target.matches('[data-rd-q]')) return;
      query = e.target.value;
      paint(root);
    });
  }
  paint(root);
  load(root);
  clearInterval(timer);
  // En direct tant que la vue est ouverte ; s'arrête tout seul en la quittant.
  timer = setInterval(() => { if (!visible(root)) { if (root.dataset.tab !== 'rdeals') clearInterval(timer); return; } load(root); }, 30000);
}
