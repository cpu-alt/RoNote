/**
 * ==========================================================================
 *  WATCHLIST (26 novembre) : les items que je veux, avec un prix cible
 * --------------------------------------------------------------------------
 *  Sans serveur : le worker lit le meilleur prix au catalogue Roblox
 *  (background/watchlist.js) et alerte quand il passe sous la cible.
 *  L'ajout passe par la recherche du catalogue Rolimon's déjà en cache.
 * ==========================================================================
 */
import { t } from '../common/i18n.js';
import { ic } from '../common/icons.js';
import { fmtNum, escapeHtml } from '../common/utils.js';
import { send } from '../common/ui.js';
import { discoverSwitch } from './deals.js';

let last = null;       // la dernière réponse du worker
let found = [];        // résultats de la recherche
let query = '';
let searchSeq = 0;

/** L'état d'une ligne : sous la cible, proche (≤ 10 % au-dessus), ou rien. Exposé pour les tests. */
export function stateOf(w) {
  if (!(w.target > 0) || !(w.bp > 0)) return '';
  if (w.bp <= w.target) return 'hit';
  return w.bp <= w.target * 1.1 ? 'near' : '';
}

const urlOf = (w) => w.kind === 'bundle' ? `https://www.roblox.com/bundles/${w.id}` : `https://www.roblox.com/catalog/${w.id}`;
const img = (r) => r.thumb ? `<img src="${escapeHtml(r.thumb)}" alt="" width="34" height="34" loading="lazy" decoding="async">`
  : `<span class="nc-ph">${escapeHtml((r.acronym || r.name || '?').slice(0, 2))}</span>`;

function rowHtml(w) {
  const st = stateOf(w);
  const diff = w.bp && w.value ? Math.round((w.bp / w.value - 1) * 100) : null;
  return `<div class="mi-row wl-row ${st}">
    <button class="mi-open" data-open="${urlOf(w)}" title="${escapeHtml(t('Ouvrir sur Roblox'))}">
      <span class="mi-img">${img(w)}</span>
      <span class="mi-id"><b>${escapeHtml(w.name)}</b><small>${w.value ? `Value ${fmtNum(w.value)} · ` : ''}RAP ${fmtNum(w.rap)}</small></span>
      <span class="mi-num"><b class="mi-ratio ${st === 'hit' ? 'hot' : st === 'near' ? 'up' : ''}">${w.bp ? fmtNum(w.bp) : t('Personne')}</b>${diff == null ? ''
        : `<small class="${diff <= 0 ? 'win' : 'loss'}">${diff > 0 ? '+' : ''}${diff} % ${t('vs value')}</small>`}</span>
    </button>
    <span class="wl-side"><label class="wl-target" title="${escapeHtml(t('Alerte quand le meilleur prix passe sous ce prix'))}"><i>${t('Cible')}</i>
      <input type="text" inputmode="numeric" data-wl-target="${escapeHtml(w.key)}" value="${w.target || ''}" placeholder="—" autocomplete="off"></label>
      <button class="wl-x" data-wl-remove="${escapeHtml(w.key)}" aria-label="${escapeHtml(t('Retirer'))}" title="${escapeHtml(t('Retirer'))}">×</button></span>
  </div>`;
}

function foundHtml() {
  if (!found.length) return query.trim().length >= 2 ? `<p class="mi-foot">${t('Aucun item trouvé.')}</p>` : '';
  const have = new Set((last?.items || []).map(w => w.key));
  return `<div class="wl-found">${found.map(f => {
    const kind = f.bundleId ? 'bundle' : 'asset', id = f.bundleId || f.assetId, key = (kind === 'bundle' ? 'b' : 'a') + id;
    return `<button class="wl-add" data-wl-add="${key}" ${have.has(key) ? 'disabled' : ''}>
      <span class="mi-img">${img(f)}</span><span class="mi-id"><b>${escapeHtml(f.name)}</b><small>Value ${fmtNum(f.value || 0)}</small></span>
      <i>${have.has(key) ? '✓' : '+'}</i></button>`;
  }).join('')}</div>`;
}

function paint(root) {
  const items = last?.items || [];
  const hits = items.filter(w => stateOf(w) === 'hit').length;
  const head = `<div class="pf-head">${discoverSwitch('watch', `<span class="pf-count">${t('{n} objets', { n: items.length })}</span>`)}
    <div class="pf-bar dl-search"><input type="search" data-wl-q placeholder="${escapeHtml(t('Ajouter un item (nom, initiales)'))}"
      value="${escapeHtml(query)}" aria-label="${escapeHtml(t('Ajouter un item'))}" autocomplete="off" spellcheck="false"></div>${foundHtml()}</div>`;
  if (!last) { root.innerHTML = head + `<div class="pf-list">${'<div class="pf-skel"></div>'.repeat(3)}</div>`; return; }
  const sorted = [...items].sort((a, b) => (stateOf(b) === 'hit') - (stateOf(a) === 'hit') || (stateOf(b) === 'near') - (stateOf(a) === 'near'));
  root.innerHTML = head + (items.length
    ? (hits ? `<p class="wl-hits">${t('{n} sous ta cible', { n: hits })}</p>` : '') + `<div class="mi-list">${sorted.map(rowHtml).join('')}</div>`
      + `<p class="mi-foot">${t('Prix lus sur Roblox toutes les 2 min. Une notification part quand un item passe sous sa cible.')}</p>`
    : `<div class="empty"><div class="empty-ic">${ic('search')}</div><b>${t('Ta watchlist est vide')}</b><span>${t('Cherche un item au-dessus, fixe un prix cible : RoNote te prévient quand quelqu\'un le vend moins cher.')}</span></div>`);
}

async function load(root, force = false) {
  last = await send({ type: 'ronote:wl-get', force }).catch(() => null) || { items: [] };
  if (root.dataset.tab === 'watch') paint(root);
}

const keepFocus = (root, sel) => {
  const box = root.querySelector(sel);
  box?.focus(); box?.setSelectionRange?.(box.value.length, box.value.length);
};

export function renderWatchlist(root) {
  if (!root.dataset.wlBound) {
    root.dataset.wlBound = '1';
    root.addEventListener('click', async (e) => {
      if (root.dataset.tab !== 'watch') return;
      const add = e.target.closest('[data-wl-add]');
      if (add) {
        const f = found.find(x => (x.bundleId ? 'b' + x.bundleId : 'a' + x.assetId) === add.dataset.wlAdd);
        if (!f) return;
        add.disabled = true;
        const res = await send({ type: 'ronote:wl-set', item: { id: f.bundleId || f.assetId, kind: f.bundleId ? 'bundle' : 'asset', name: f.name, target: 0 } });
        if (res?.error) { add.title = res.error; return; }
        query = ''; found = [];
        await load(root, true);
        root.querySelector('.wl-row input')?.focus();     // le prix cible, tout de suite
        return;
      }
      const rm = e.target.closest('[data-wl-remove]');
      if (rm) {
        const w = last?.items.find(x => x.key === rm.dataset.wlRemove);
        if (!w) return;
        last.items = last.items.filter(x => x !== w);
        paint(root);
        await send({ type: 'ronote:wl-set', remove: true, item: { id: w.id, kind: w.kind } });
      }
    });
    root.addEventListener('input', (e) => {
      if (root.dataset.tab !== 'watch') return;
      if (e.target.matches('[data-wl-target]')) { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 10); return; }
      if (!e.target.matches('[data-wl-q]')) return;
      query = e.target.value;
      const seq = ++searchSeq;
      if (query.trim().length < 2) { found = []; paint(root); keepFocus(root, '[data-wl-q]'); return; }
      send({ type: 'ronote:catalog-search', query }).then((res) => {
        if (seq !== searchSeq || root.dataset.tab !== 'watch') return;
        found = res?.items || [];
        paint(root); keepFocus(root, '[data-wl-q]');
      }).catch(() => {});
    });
    // La cible s'enregistre en quittant le champ (ou Entrée), pas à chaque chiffre.
    root.addEventListener('change', async (e) => {
      if (root.dataset.tab !== 'watch' || !e.target.matches('[data-wl-target]')) return;
      const w = last?.items.find(x => x.key === e.target.dataset.wlTarget);
      if (!w) return;
      w.target = Number(e.target.value) || 0;
      await send({ type: 'ronote:wl-set', item: { id: w.id, kind: w.kind, name: w.name, target: w.target } });
      paint(root);
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.matches?.('[data-wl-target]')) e.target.blur();
    });
  }
  paint(root);
  load(root);
}
