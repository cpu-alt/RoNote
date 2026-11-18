/**
 * ==========================================================================
 *  LE FILTRE PAR OBJETS (Profils, Deals, Robux)
 * --------------------------------------------------------------------------
 *  18 nov. (MYd : « un filtre pour certains items, intuitif, propre, optimisé ») :
 *  on choisit un ou plusieurs objets (8 au plus) dans le catalogue Rolimon's
 *  déjà chargé par le worker (`ronote:catalog-search` : nom, acronyme ou id,
 *  avec vignette et value), puis le côté où ils doivent se trouver. Une carte
 *  passe si elle contient AU MOINS UN des objets choisis, du bon côté.
 *
 *  Intuitif : les objets choisis restent visibles en puces sous la barre, même
 *  filtres repliés (on voit toujours ce qui filtre) ; le champ d'ajout et le
 *  côté sont dans le panneau « Filtres ». Clavier : ↑ ↓ dans les suggestions,
 *  Entrée ajoute, Échap ferme, Retour arrière sur un champ vide retire la
 *  dernière puce.
 *
 *  Optimisé : la recherche part 180 ms après la dernière frappe, une seule à la
 *  fois (la réponse d'une frappe dépassée est jetée) ; les suggestions se
 *  redessinent seules, sans toucher à la liste ; le filtrage est un Set d'ids
 *  testé sur les objets de chaque carte, sans requête.
 *  Le choix est gardé par vue dans ce navigateur (localStorage).
 * ==========================================================================
 */
import { t } from '../common/i18n.js';
import { fmtNum, escapeHtml } from '../common/utils.js';
import { send } from '../common/ui.js';

const MAX = 8;
// Les côtés proposés par vue : [clé, libellé]. Robux n'en a qu'un (ce qui est vendu).
const SIDES = {
  deals: [['any', 'Les deux'], ['get', 'Tu reçois'], ['give', 'Tu donnes']],
  profiles: [['any', 'Les deux'], ['get', 'Possède'], ['give', 'Cherche']],
  robux: null
};

const key = (view) => 'ronote.itemfilter.' + view;
export function itemFilter(view) {
  let v = {};
  try { v = JSON.parse(localStorage.getItem(key(view))) || {}; } catch { /* navigation privée */ }
  const items = (Array.isArray(v.items) ? v.items : []).filter(i => Number(i?.assetId) || Number(i?.bundleId)).slice(0, MAX);
  const sides = SIDES[view];
  return { items, side: sides && sides.some(([k]) => k === v.side) ? v.side : 'any' };
}
function save(view, f) { try { localStorage.setItem(key(view), JSON.stringify(f)); } catch { /* navigation privée */ } }

/** Le nombre de filtres « objet » actifs (pour la pastille du bouton Filtres). */
export const itemFilterCount = (view) => (itemFilter(view).items.length ? 1 : 0);

/**
 * Une fonction qui dit si une carte passe. `sidesOf(x)` rend { get: [...], give: [...] } : les objets
 * (au format Neuronal : `id`) de chaque côté. Sans objet choisi : tout passe, sans rien calculer.
 */
export function itemMatcher(view) {
  const f = itemFilter(view);
  if (!f.items.length) return null;
  const ids = new Set(f.items.flatMap(i => [Number(i.assetId), Number(i.bundleId)]).filter(Boolean));
  // Secours par nom exact : une face peut être connue par l'ancien id d'asset d'un côté (Neuronal)
  // et par l'id de son bundle de l'autre (le catalogue).
  const flat = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const names = new Set(f.items.map(i => flat(i.name)).filter(Boolean));
  const has = (list) => (list || []).some(it => ids.has(Number(it?.id)) || names.has(flat(it?.name)));
  return (sides) => (f.side === 'get' ? has(sides.get) : f.side === 'give' ? has(sides.give) : has(sides.get) || has(sides.give));
}

const thumb = (i) => (i.thumb && /^https:\/\//.test(i.thumb)
  ? `<img src="${escapeHtml(i.thumb)}" alt="" loading="lazy" decoding="async">`
  : `<span class="if-ph">${escapeHtml((i.acronym || i.name || '?').slice(0, 2))}</span>`);

/** Les puces des objets choisis : toujours visibles quand il y en a. */
export function itemChipsHtml(view) {
  const f = itemFilter(view);
  if (!f.items.length) return '';
  const side = SIDES[view]?.find(([k]) => k === f.side);
  return `<div class="if-chips" data-if-view="${view}">${f.items.map((i, k) =>
    `<button class="if-chip" data-if-del="${k}" title="${escapeHtml(t('Retirer {name}', { name: i.name }))}">${thumb(i)}<span>${escapeHtml(i.acronym || i.name)}</span><b aria-hidden="true">×</b></button>`).join('')}
    ${side && f.side !== 'any' ? `<span class="if-side-tag">${escapeHtml(t(side[1]))}</span>` : ''}
    <button class="if-clear" data-if-clear>${t('Effacer')}</button></div>`;
}

/** Le champ d'ajout et le côté : dans le panneau Filtres. */
export function itemFilterHtml(view) {
  const f = itemFilter(view);
  const sides = SIDES[view];
  return `<div class="pf-row if-row" data-if-view="${view}">
    <span class="pf-lbl">${t('Items')}</span>
    <span class="if-add"><input type="search" data-if-q placeholder="${escapeHtml(f.items.length >= MAX ? t('8 items au plus') : t('Ajouter un item…'))}"
      ${f.items.length >= MAX ? 'disabled' : ''} autocomplete="off" spellcheck="false" aria-label="${escapeHtml(t('Ajouter un item au filtre'))}"
      aria-autocomplete="list" aria-expanded="false"><div class="if-sug" role="listbox" hidden></div></span>
    ${sides ? `<span class="if-sides" role="radiogroup" aria-label="${escapeHtml(t('Où'))}">${sides.map(([k, l]) =>
      `<button role="radio" aria-checked="${k === f.side}" data-if-side="${k}">${t(l)}</button>`).join('')}</span>` : ''}
  </div>`;
}

/**
 * Câble le filtre sur la racine d'une vue (une seule fois). `repaint()` redessine la vue ;
 * le champ garde le focus après un ajout.
 */
export function bindItemFilter(root, view, isActive, repaint) {
  let timer = 0, ticket = 0, found = [], cursor = 0;
  const box = () => root.querySelector(`.if-row[data-if-view="${view}"]`);
  const close = () => { const s = box()?.querySelector('.if-sug'); if (s) { s.hidden = true; s.innerHTML = ''; } box()?.querySelector('[data-if-q]')?.setAttribute('aria-expanded', 'false'); found = []; };
  const drawSug = () => {
    const s = box()?.querySelector('.if-sug');
    if (!s) return;
    const chosen = new Set(itemFilter(view).items.map(i => `${i.assetId}:${i.bundleId}`));
    s.innerHTML = found.length ? found.map((i, k) => `<button role="option" class="if-opt${k === cursor ? ' on' : ''}${chosen.has(`${i.assetId}:${i.bundleId}`) ? ' had' : ''}" data-if-pick="${k}">
        ${thumb(i)}<span class="if-on">${escapeHtml(i.name)}${i.acronym ? ` <small>${escapeHtml(i.acronym)}</small>` : ''}</span><b>${i.value ? fmtNum(i.value) : ''}</b></button>`).join('')
      : `<span class="if-none">${t('Aucun item')}</span>`;
    s.hidden = false;
    box()?.querySelector('[data-if-q]')?.setAttribute('aria-expanded', 'true');
  };
  const add = (i) => {
    const f = itemFilter(view);
    if (!i || f.items.length >= MAX || f.items.some(x => x.assetId === i.assetId && x.bundleId === i.bundleId)) { close(); return; }
    f.items.push({ assetId: i.assetId || 0, bundleId: i.bundleId || 0, name: i.name, acronym: i.acronym || '', thumb: i.thumb || null });
    save(view, f);
    close();
    repaint();
    const q = box()?.querySelector('[data-if-q]');
    if (q) { q.value = ''; q.focus(); }
  };
  root.addEventListener('input', (e) => {
    if (!isActive() || !e.target.matches?.(`.if-row[data-if-view="${view}"] [data-if-q]`)) return;
    const query = e.target.value.trim();
    clearTimeout(timer);
    if (query.length < 2) { close(); return; }
    timer = setTimeout(async () => {
      const mine = ++ticket;
      const r = await send({ type: 'ronote:catalog-search', query }).catch(() => null);
      if (mine !== ticket || !isActive()) return;         // une frappe plus récente a pris le relais
      found = (r?.items || []).slice(0, 8);
      cursor = 0;
      drawSug();
    }, 180);
  });
  root.addEventListener('keydown', (e) => {
    if (!isActive() || !e.target.matches?.(`.if-row[data-if-view="${view}"] [data-if-q]`)) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!found.length) return;
      e.preventDefault();
      cursor = (cursor + (e.key === 'ArrowDown' ? 1 : found.length - 1)) % found.length;
      drawSug();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      add(found[cursor]);
    } else if (e.key === 'Escape') {
      if (found.length) { e.preventDefault(); e.stopPropagation(); close(); }
    } else if (e.key === 'Backspace' && !e.target.value) {
      const f = itemFilter(view);
      if (f.items.length) { f.items.pop(); save(view, f); repaint(); box()?.querySelector('[data-if-q]')?.focus(); }
    }
  });
  root.addEventListener('click', (e) => {
    if (!isActive()) return;
    const pick = e.target.closest(`.if-row[data-if-view="${view}"] [data-if-pick]`);
    if (pick) { add(found[Number(pick.dataset.ifPick)]); return; }
    const del = e.target.closest(`.if-chips[data-if-view="${view}"] [data-if-del]`);
    if (del) { const f = itemFilter(view); f.items.splice(Number(del.dataset.ifDel), 1); save(view, f); repaint(); return; }
    if (e.target.closest(`.if-chips[data-if-view="${view}"] [data-if-clear]`)) { save(view, { ...itemFilter(view), items: [] }); repaint(); return; }
    const side = e.target.closest(`.if-row[data-if-view="${view}"] [data-if-side]`);
    if (side) { save(view, { ...itemFilter(view), side: side.dataset.ifSide }); repaint(); return; }
    if (!e.target.closest('.if-add')) close();
  });
}
