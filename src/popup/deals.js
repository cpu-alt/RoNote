/**
 * ==========================================================================
 *  DEALS : LE DEAL SNIPER ET LE ROBUX SNIPER DE NEURONAL, DANS LE POPUP
 * --------------------------------------------------------------------------
 *  Deux listes, comme les deux catégories du serveur Discord :
 *   - Deals : les trade ads Rolimon's des 15 dernières minutes notées sur
 *     100 par le bot. Ce que tu DONNES (ce que le joueur demande), ce que tu
 *     REÇOIS (ce qu'il offre), le gain, la note, son palier (S ≥ 80, A ≥ 65,
 *     B) et les raisons en deux mots ;
 *   - Robux : les joueurs qui vendent leurs items contre des Robux (tag
 *     « robux » demandé), avec la value, le RAP et ce que coûte la même chose
 *     au plus bas du catalogue Roblox.
 *
 *  Une seule lecture de /ext/v1/deals pour les deux (gardée 60 s par le
 *  serveur et le worker, 304 quand rien n'a changé). Paliers et tailles se
 *  choisissent à plusieurs et se filtrent ici. En direct : relu chaque minute
 *  tant que l'onglet est affiché ; les nouvelles annonces entrent animées,
 *  celles de plus de 15 min s'estompent.
 * ==========================================================================
 */
import { t } from '../common/i18n.js';
import { fmtNum, timeAgo, escapeHtml } from '../common/utils.js';
import { send } from '../common/ui.js';
import { nwTilesHtml } from './nwcard.js';
import { lockHtml } from './lock.js';
import { ic } from '../common/icons.js';
import { itemFilterHtml, itemChipsHtml, itemFilterCount, itemMatcher, bindItemFilter } from './itemfilter.js';

const KEY = 'ronote.deals';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* navigation privée */ } };

const KINDS = [['deals', 'Deals'], ['robux', 'Robux']];
const GRADES = ['S', 'A', 'B'];
// la taille : la value de ce qu'on reçoit, comme les salons des deux snipers sur Discord
const SIZES = [['s', '< 10k', 0, 10e3], ['m', '10k+', 10e3, 100e3], ['l', '100k+', 100e3, 500e3], ['xl', '500k+', 500e3, 1e6], ['xxl', '1M+', 1e6, Infinity]];
const SORTS = [['best', 'Meilleurs'], ['new', 'Récents']];
// la période demandée à Neuronal (?minutes=) ; 0 = celle d'office (15 min les deals, 10 min les Robux)
const SINCE = [[0, 'Auto'], [5, '5 min'], [15, '15 min'], [30, '30 min'], [60, '1 h'], [180, '3 h']];
const DEMAND = ['peu demandé', 'peu demandé', 'demande normale', 'très demandé', 'très demandé'];
const LIVE_MS = 60e3;
const STALE_S = 15 * 60;

let last = null;          // la dernière réponse { data }
let seen = new Set();
let timer = 0;
let token = 0;
let query = '';           // la recherche d'items : gardée le temps du popup, pas enregistrée

/** Un item répond à la recherche : un bout de son nom, ses initiales (« vv » → Violet Valkyrie), ou son id. */
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
export function itemMatches(it, q) {
  const n = norm(it?.name);
  const initials = n.split(/[^a-z0-9]+/).filter(Boolean).map(w => w[0]).join('');
  return n.includes(q) || initials === q.replace(/\s+/g, '') || String(it?.id) === q;
}
const hasItem = (x, q) => !q || [...(x.get || []), ...(x.give || [])].some(it => itemMatches(it, q));

function pick() {
  const p = read();
  return {
    kind: KINDS.some(([k]) => k === p.kind) ? p.kind : 'deals',
    grades: (Array.isArray(p.grades) ? p.grades : []).filter(g => GRADES.includes(g)),
    sizes: (Array.isArray(p.sizes) ? p.sizes : []).filter(k => SIZES.some(([s]) => s === k)),
    sort: SORTS.some(([k]) => k === p.sort) ? p.sort : 'best',
    since: SINCE.some(([k]) => k === p.since) ? p.since : 0,
    open: p.open === true                       // les filtres dépliés (repliés d'office)
  };
}

/** Le sélecteur en tête des vues Profils et Deals (une seule icône dans la barre d'onglets). */
export const discoverSwitch = (active, extra = '') => `<div class="dc-switch" role="tablist" aria-label="Neuronal">${[['profiles', t('Profils')], ['deals', t('Deals')]]
  .map(([k, l]) => `<button role="tab" data-go-tab="${k}" aria-selected="${k === active}">${l}</button>`).join('')}${extra}</div>`;

const chip = (attr, value, label, on, cls = '', role = 'checkbox') =>
  `<button role="${role}" aria-checked="${on}" ${attr}="${escapeHtml(value)}"${cls ? ` class="${cls}"` : ''}>${label}</button>`;

const list = (data, kind) => (kind === 'robux' ? data?.robux : data?.deals) || [];
const valueOf = (x, kind) => (kind === 'robux' ? x.value : x.get_value) || 0;
const sizeOf = (x, kind) => (SIZES.find(([, , lo, hi]) => valueOf(x, kind) >= lo && valueOf(x, kind) < hi) || SIZES[0])[0];

// Le bouton qui déplie les filtres de Profils et de Deals, avec le nombre de filtres actifs (18 nov. : 3 à 5
// lignes de puces passaient avant la première fiche ; repliées d'office, la liste commence tout de suite).
export const filterToggle = (attr, open, active) => `<button class="pf-ftog${active ? ' on' : ''}" ${attr} aria-expanded="${open}">${ic('filter')}<span>${t('Filtres')}</span>${active ? `<i>${active}</i>` : ''}</button>`;

function toolbarHtml(p, count, counts) {
  const n = (k) => (counts ? `<i class="dl-kn">${counts[k]}</i>` : '');
  const live = count === null ? '' : `<span class="pf-count pf-live" title="${escapeHtml(t('En direct : les nouvelles annonces arrivent toutes seules'))}">${
    p.kind === 'robux' ? t('{n} annonces', { n: count }) : t('{n} deals', { n: count })}</span>`;
  return `<div class="pf-head">${discoverSwitch('deals', live)}
    <div class="pf-bar"><div class="pf-seg dl-kinds" role="radiogroup" aria-label="${escapeHtml(t('Liste'))}">${KINDS.map(([k, l]) =>
      `<button role="radio" aria-checked="${k === p.kind}" data-dl-kind="${k}">${t(l)}${n(k)}</button>`).join('')}</div>
      <div class="pf-seg dl-sorts" role="radiogroup" aria-label="${escapeHtml(t('Tri'))}">${SORTS.map(([k, l]) =>
        chip('data-dl-sort', k, t(l), k === p.sort, '', 'radio')).join('')}</div></div>
    <div class="pf-bar dl-search"><input type="search" data-dl-search placeholder="${escapeHtml(t('Chercher un item (nom, initiales ou id)'))}"
      value="${escapeHtml(query)}" aria-label="${escapeHtml(t('Chercher un item'))}" autocomplete="off" spellcheck="false">
      ${filterToggle('data-dl-ftog', p.open, (p.kind === 'deals' ? p.grades.length : 0) + p.sizes.length + (p.since ? 1 : 0) + itemFilterCount(p.kind))}</div>
    ${itemChipsHtml(p.kind)}
    ${p.open ? itemFilterHtml(p.kind) : ''}
    ${!p.open ? '' : p.kind === 'deals' ? `<div class="pf-row" role="group" aria-label="${escapeHtml(t('Paliers'))}">
      <span class="pf-lbl">${t('Palier')}</span>${chip('data-dl-grade', '', t('Tous'), !p.grades.length)}${GRADES.map(g =>
        chip('data-dl-grade', g, g, p.grades.includes(g), 'dl-g g-' + g)).join('')}</div>` : ''}
    ${p.open ? `<div class="pf-row" role="radiogroup" aria-label="${escapeHtml(t('Depuis'))}">
      <span class="pf-lbl">${t('Depuis')}</span>${SINCE.map(([k, l]) => chip('data-dl-since', k, t(l), k === p.since, '', 'radio')).join('')}</div>
    <div class="pf-row" role="group" aria-label="${escapeHtml(t('Taille'))}">
      <span class="pf-lbl">${t('Taille')}</span>${chip('data-dl-size', '', t('Toutes'), !p.sizes.length)}${SIZES.map(([k, l]) =>
        chip('data-dl-size', k, l, p.sizes.includes(k))).join('')}</div>` : ''}
  </div>`;
}

function filtered(p, data) {
  const byItem = itemMatcher(p.kind);            // null sans objet choisi : rien à tester
  const out = list(data, p.kind).filter(x => (p.kind !== 'deals' || !p.grades.length || p.grades.includes(x.grade))
    && (!p.sizes.length || p.sizes.includes(sizeOf(x, p.kind))) && hasItem(x, norm(query).trim())
    && (!byItem || byItem({ get: x.get, give: p.kind === 'robux' ? [] : x.give })));
  if (p.sort === 'new') return out.sort((a, b) => b.at - a.at);
  return p.kind === 'robux' ? out.sort((a, b) => (b.demand - a.demand) || (b.value - a.value)) : out;
}

const ago = (at) => timeAgo(at * 1000);
const who = (x) => escapeHtml(x.user?.name || '#' + (x.user?.id || '?'));
// Les actions : trois petits boutons dans l'en-tête (18 nov. : le pied de carte prenait une ligne entière).
const acts = (uid) => `<span class="pf-qa">
    <button class="pf-ib" data-open="https://www.rolimons.com/player/${uid}" title="Rolimon's">R</button>
    <button class="pf-ib" data-open="https://www.roblox.com/users/${uid}/profile" title="Roblox">${ic('user')}</button>
    <button class="pf-ib pf-send" data-open="https://www.roblox.com/users/${uid}/trade" title="${escapeHtml(t('Envoyer un trade'))}">${ic('send')}</button></span>`;
const stale = (x) => (Date.now() / 1000 - x.at > STALE_S ? ' dl-old' : '');

function dealHtml(d, isNew) {
  const gain = d.get_value - d.give_value;
  const pct = d.give_value ? gain / d.give_value * 100 : 0;
  const uid = Number(d.user?.id) || 0;
  // 18 nov. : une ligne d'en-tête (note, gain, qui, actions), une ligne d'objets (donne → reçoit), les
  // raisons en une ligne. Plus de barre ni de pied : ~110 px au lieu de ~180.
  const why = (d.reasons || []).slice(0, 3);
  return `<article class="pf-card dl-card g-${escapeHtml(d.grade)}${isNew ? ' pf-new' : ''}${stale(d)}" data-dl-id="d${Number(d.id)}">
    <header class="dl-top">
      <span class="dl-grade" title="${escapeHtml(t('Note {n}/100', { n: d.score }))}"><b>${escapeHtml(d.grade)}</b><i>${Number(d.score)}</i></span>
      <span class="dl-gain"><b>+${fmtNum(gain)}</b><small>+${pct.toFixed(pct < 10 ? 1 : 0)} % · ${who(d)} · ${ago(d.at)}</small></span>
      ${acts(uid)}
    </header>
    <div class="ncl-sides dl-ln">
      <div class="ncl-s"><b>${fmtNum(d.give_value)}</b>${nwTilesHtml(d.give)}</div><span class="ncl-ar">→</span>
      <div class="ncl-s"><b class="win">${fmtNum(d.get_value)}</b>${nwTilesHtml(d.get)}</div>
    </div>
    ${why.length ? `<div class="dl-why">${why.map(([good, label]) => `<span class="${good ? 'win' : 'loss'}">${escapeHtml(label)}</span>`).join('')}${
      d.reasons.length > why.length ? `<span class="n">+${d.reasons.length - why.length}</span>` : ''}</div>` : ''}
  </article>`;
}

function robuxHtml(r, isNew) {
  const uid = Number(r.user?.id) || 0;
  // ce que l'annonce vaut face au moins cher du catalogue : une idée du prix à proposer
  const vsMarket = r.market ? (r.value - r.market) / r.market * 100 : null;
  const demand = DEMAND[Math.max(0, Math.min(4, Math.round(r.demand)))];
  return `<article class="pf-card dl-card dl-rbx${isNew ? ' pf-new' : ''}${stale(r)}" data-dl-id="r${Number(r.id)}">
    <header class="dl-top">
      <span class="dl-grade dl-r" aria-hidden="true"><b>R$</b></span>
      <span class="dl-gain"><b>${fmtNum(r.value)}</b><small>${r.only_robux ? t('Robux seulement') : t('Robux ou items')} · ${who(r)} · ${ago(r.at)}</small></span>
      ${acts(uid)}
    </header>
    <div class="dl-rb"><div class="dl-one">${nwTilesHtml(r.get)}</div>
    <div class="dl-facts">
      <span><small>RAP</small><b>${r.rap ? fmtNum(r.rap) : 'N/A'}</b></span>
      <span><small title="${escapeHtml(t('Moins cher sur Roblox'))}">${t('Catalogue')}</small><b>${r.market ? fmtNum(r.market) + ' R$' : t('pas en vente')}</b></span>
      <span><small>${t('Demande')}</small><b class="${r.demand >= 2.5 ? 'win' : r.demand < 1.5 ? 'loss' : ''}">${t(demand)}</b></span>
    </div></div>
    ${vsMarket !== null && Math.abs(vsMarket) >= 5 ? `<div class="dl-why"><span class="n">${vsMarket > 0
      ? t('value {p} % au-dessus du catalogue', { p: Math.round(vsMarket) }) : t('value {p} % sous le catalogue', { p: Math.round(-vsMarket) })}</span></div>` : ''}
  </article>`;
}

function empty(title, text, options = false) {
  return `<div class="empty"><b>${t(title)}</b>${text ? `<span>${t(text)}</span>` : ''}
    ${options ? `<button class="pf-opt" data-dl-options>${t('Ouvrir les réglages')}</button>` : ''}</div>`;
}

function stateHtml(res) {
  if (res?.locked) return lockHtml(res);
  if (res?.off) return empty('Fiches Neuronal coupées', 'Active « Fiches Neuronal » dans Réglages › Valeurs pour voir les deals.', true);
  if (res?.unavailable) return empty('Deals indisponibles', 'Neuronal ne partage pas les deals pour le moment.');
  if (res?.limited) return empty('Trop de demandes', 'Réessaie dans quelques minutes.');
  return empty('Neuronal est injoignable.', '');
}

const idOf = (x, kind) => (kind === 'robux' ? 'r' : 'd') + x.id;

function paint(root) {
  // la liste est redessinée en entier (en direct aussi) : le champ de recherche garde le focus et le curseur
  const box = root.querySelector('[data-dl-search]');
  const typing = box && document.activeElement === box ? box.selectionStart : null;
  draw(root);
  if (typing !== null) { const b = root.querySelector('[data-dl-search]'); b?.focus(); b?.setSelectionRange(typing, typing); }
}

function draw(root) {
  const p = pick();
  if (!last) {
    root.innerHTML = toolbarHtml(p, null, null) + `<div class="pf-list">${'<div class="pf-skel"></div>'.repeat(3)}</div>`;
    return;
  }
  if (!last.data) { root.innerHTML = toolbarHtml(p, null, null) + stateHtml(last); return; }
  const shown = filtered(p, last.data);
  const counts = { deals: list(last.data, 'deals').length, robux: list(last.data, 'robux').length };
  seen = new Set([...list(last.data, 'deals').map(x => idOf(x, 'deals')), ...list(last.data, 'robux').map(x => idOf(x, 'robux'))]);
  const card = p.kind === 'robux' ? robuxHtml : dealHtml;
  root.innerHTML = toolbarHtml(p, shown.length, counts) + (shown.length
    ? `<div class="pf-list">${shown.map(x => card(x, false)).join('')}</div>`
    : empty(p.kind === 'robux' ? 'Aucune vente contre des Robux' : 'Aucun deal', p.grades.length || p.sizes.length || query.trim() || itemFilterCount(p.kind)
      ? 'Rien ne correspond à ces filtres pour le moment.'
      : p.kind === 'robux' ? 'Personne ne vend contre des Robux ces 10 dernières minutes.' : 'Aucune annonce assez bonne ces 15 dernières minutes.'));
}

const visible = (root) => root.isConnected && root.dataset.tab === 'deals' && document.visibilityState === 'visible';
const sig = (r) => [...list(r.data, 'deals').map(d => d.id + ':' + d.score), ...list(r.data, 'robux').map(x => 'r' + x.id)].join(',');

async function load(root, live = false) {
  const mine = ++token;
  const res = await send({ type: 'ronote:neuronal-deals', minutes: pick().since }).catch(() => null) || { error: 'empty' };
  if (mine !== token || !visible(root)) return;
  if (live && !res.data) return;                     // panne passagère : on garde ce qu'on a
  if (!live || !last?.data) { last = res; paint(root); return; }
  // En direct (80 cartes au plus) : rien de changé, on ne touche à rien ; sinon la liste est
  // redessinée dans son ordre, les annonces nouvelles animées, la position de lecture gardée.
  if (sig(res) === sig(last)) return;
  const before = seen;
  last = res;
  const top = root.scrollTop;
  paint(root);
  root.scrollTop = top;
  let fresh = 0;
  for (const el of root.querySelectorAll('.dl-card')) {
    if (!before.has(el.dataset.dlId)) { el.classList.add('pf-new'); fresh++; }
  }
  if (fresh) root.querySelector('.pf-count')?.classList.add('pf-bump');
}

/** Dessine l'onglet dans `listEl` ; les clics sont câblés une seule fois sur lui. */
export function renderDeals(listEl, openOptions) {
  if (!listEl.dataset.dlBound) {
    listEl.dataset.dlBound = '1';
    listEl.addEventListener('click', (e) => {
      if (listEl.dataset.tab !== 'deals') return;
      if (e.target.closest('[data-dl-options]')) { openOptions(); return; }
      if (e.target.closest('[data-dl-ftog]')) { const q = pick(); q.open = !q.open; write(q); paint(listEl); return; }
      const el = e.target.closest('[data-dl-grade], [data-dl-size], [data-dl-sort], [data-dl-kind], [data-dl-since]');
      if (!el) return;
      const p = pick();
      const toggle = (arr, k) => (!k ? [] : arr.includes(k) ? arr.filter(x => x !== k) : [...arr, k]);
      if (el.dataset.dlSince !== undefined) {   // une autre période : une autre liste à demander
        p.since = Number(el.dataset.dlSince) || 0; write(p); last = null; paint(listEl); load(listEl); return;
      }
      if (el.dataset.dlKind !== undefined) p.kind = el.dataset.dlKind;
      else if (el.dataset.dlSort !== undefined) p.sort = el.dataset.dlSort;
      else if (el.dataset.dlGrade !== undefined) { p.grades = toggle(p.grades, el.dataset.dlGrade); if (p.grades.length === GRADES.length) p.grades = []; }
      else { p.sizes = toggle(p.sizes, el.dataset.dlSize); if (p.sizes.length === SIZES.length) p.sizes = []; }
      write(p);
      paint(listEl);
      listEl.scrollTop = 0;
    });
    listEl.addEventListener('input', (e) => {
      if (listEl.dataset.tab !== 'deals' || !e.target.matches('[data-dl-search]')) return;
      query = e.target.value;
      paint(listEl);
    });
    document.addEventListener('visibilitychange', () => { if (visible(listEl)) load(listEl, true); });
    for (const view of ['deals', 'robux']) {
      bindItemFilter(listEl, view, () => listEl.dataset.tab === 'deals' && pick().kind === view, () => paint(listEl));
    }
  }
  clearInterval(timer);
  timer = setInterval(() => { if (visible(listEl)) load(listEl, true); }, LIVE_MS);
  paint(listEl);
  load(listEl);
}
