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

const KEY = 'ronote.deals';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* navigation privée */ } };

const KINDS = [['deals', 'Deals'], ['robux', 'Robux']];
const GRADES = ['S', 'A', 'B'];
// la taille : la value de ce qu'on reçoit, comme les salons des deux snipers sur Discord
const SIZES = [['s', '< 10k', 0, 10e3], ['m', '10k+', 10e3, 100e3], ['l', '100k+', 100e3, 500e3], ['xl', '500k+', 500e3, 1e6], ['xxl', '1M+', 1e6, Infinity]];
const SORTS = [['best', 'Meilleurs'], ['new', 'Récents']];
const DEMAND = ['peu demandé', 'peu demandé', 'demande normale', 'très demandé', 'très demandé'];
const LIVE_MS = 60e3;
const STALE_S = 15 * 60;

let last = null;          // la dernière réponse { data }
let seen = new Set();
let timer = 0;
let token = 0;

function pick() {
  const p = read();
  return {
    kind: KINDS.some(([k]) => k === p.kind) ? p.kind : 'deals',
    grades: (Array.isArray(p.grades) ? p.grades : []).filter(g => GRADES.includes(g)),
    sizes: (Array.isArray(p.sizes) ? p.sizes : []).filter(k => SIZES.some(([s]) => s === k)),
    sort: SORTS.some(([k]) => k === p.sort) ? p.sort : 'best'
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

function toolbarHtml(p, count, counts) {
  const n = (k) => (counts ? `<i class="dl-kn">${counts[k]}</i>` : '');
  const live = count === null ? '' : `<span class="pf-count pf-live" title="${escapeHtml(t('En direct : les nouvelles annonces arrivent toutes seules'))}">${
    p.kind === 'robux' ? t('{n} annonces', { n: count }) : t('{n} deals', { n: count })}</span>`;
  return `<div class="pf-head">${discoverSwitch('deals', live)}
    <div class="pf-bar"><div class="pf-seg dl-kinds" role="radiogroup" aria-label="${escapeHtml(t('Liste'))}">${KINDS.map(([k, l]) =>
      `<button role="radio" aria-checked="${k === p.kind}" data-dl-kind="${k}">${t(l)}${n(k)}</button>`).join('')}</div>
      <div class="pf-seg dl-sorts" role="radiogroup" aria-label="${escapeHtml(t('Tri'))}">${SORTS.map(([k, l]) =>
        chip('data-dl-sort', k, t(l), k === p.sort, '', 'radio')).join('')}</div></div>
    ${p.kind === 'deals' ? `<div class="pf-row" role="group" aria-label="${escapeHtml(t('Paliers'))}">
      <span class="pf-lbl">${t('Palier')}</span>${chip('data-dl-grade', '', t('Tous'), !p.grades.length)}${GRADES.map(g =>
        chip('data-dl-grade', g, g, p.grades.includes(g), 'dl-g g-' + g)).join('')}</div>` : ''}
    <div class="pf-row" role="group" aria-label="${escapeHtml(t('Taille'))}">
      <span class="pf-lbl">${t('Taille')}</span>${chip('data-dl-size', '', t('Toutes'), !p.sizes.length)}${SIZES.map(([k, l]) =>
        chip('data-dl-size', k, l, p.sizes.includes(k))).join('')}</div>
  </div>`;
}

function filtered(p, data) {
  const out = list(data, p.kind).filter(x => (p.kind !== 'deals' || !p.grades.length || p.grades.includes(x.grade))
    && (!p.sizes.length || p.sizes.includes(sizeOf(x, p.kind))));
  if (p.sort === 'new') return out.sort((a, b) => b.at - a.at);
  return p.kind === 'robux' ? out.sort((a, b) => (b.demand - a.demand) || (b.value - a.value)) : out;
}

const ago = (at) => timeAgo(at * 1000);
const who = (x) => escapeHtml(x.user?.name || '#' + (x.user?.id || '?'));
const acts = (uid) => `<footer class="pf-acts">
    <button class="pf-send" data-open="https://www.roblox.com/users/${uid}/trade">${t('Envoyer un trade')}</button>
    <button data-open="https://www.rolimons.com/player/${uid}" title="Rolimon's">Rolimon's</button>
    <button data-open="https://www.roblox.com/users/${uid}/profile" title="Roblox">Roblox</button>
  </footer>`;
const stale = (x) => (Date.now() / 1000 - x.at > STALE_S ? ' dl-old' : '');

function dealHtml(d, isNew) {
  const gain = d.get_value - d.give_value;
  const pct = d.give_value ? gain / d.give_value * 100 : 0;
  const uid = Number(d.user?.id) || 0;
  const share = d.get_value + d.give_value ? d.give_value / (d.get_value + d.give_value) * 100 : 50;
  return `<article class="pf-card dl-card g-${escapeHtml(d.grade)}${isNew ? ' pf-new' : ''}${stale(d)}" data-dl-id="d${Number(d.id)}">
    <header class="dl-top">
      <span class="dl-grade" title="${escapeHtml(t('Note {n}/100', { n: d.score }))}"><b>${escapeHtml(d.grade)}</b><i>${Number(d.score)}</i></span>
      <span class="dl-gain"><b>+${fmtNum(gain)}</b><small>+${pct.toFixed(pct < 10 ? 1 : 0)} % ${t('de value')}</small></span>
      <span class="dl-who"><b>${who(d)}</b><small>${ago(d.at)}</small></span>
    </header>
    <div class="dl-sides">
      <div class="dl-side"><div class="dl-lbl"><span>${t('Tu donnes')}</span><b>${fmtNum(d.give_value)}</b></div>${nwTilesHtml(d.give)}</div>
      <div class="dl-side"><div class="dl-lbl"><span>${t('Tu reçois')}</span><b class="win">${fmtNum(d.get_value)}</b></div>${nwTilesHtml(d.get)}</div>
    </div>
    <div class="dl-bar" title="${escapeHtml(t('Donné face à reçu'))}"><i style="width:${share.toFixed(1)}%"></i></div>
    ${d.reasons?.length ? `<div class="dl-why">${d.reasons.map(([good, label]) => `<span class="${good ? 'win' : 'loss'}">${escapeHtml(label)}</span>`).join('')}</div>` : ''}
    ${acts(uid)}
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
      <span class="dl-gain"><b>${fmtNum(r.value)}</b><small>${t('de value contre des Robux')}${r.only_robux ? '' : ' · ' + t('ou items')}</small></span>
      <span class="dl-who"><b>${who(r)}</b><small>${ago(r.at)}</small></span>
    </header>
    <div class="dl-one">${nwTilesHtml(r.get)}</div>
    <div class="dl-facts">
      <span><small>RAP</small><b>${r.rap ? fmtNum(r.rap) : 'N/A'}</b></span>
      <span><small>${t('Moins cher sur Roblox')}</small><b>${r.market ? fmtNum(r.market) + ' R$' : t('pas en vente')}</b></span>
      <span><small>${t('Demande')}</small><b class="${r.demand >= 2.5 ? 'win' : r.demand < 1.5 ? 'loss' : ''}">${t(demand)}</b></span>
    </div>
    ${vsMarket !== null && Math.abs(vsMarket) >= 5 ? `<div class="dl-why"><span class="n">${vsMarket > 0
      ? t('value {p} % au-dessus du catalogue', { p: Math.round(vsMarket) }) : t('value {p} % sous le catalogue', { p: Math.round(-vsMarket) })}</span></div>` : ''}
    ${acts(uid)}
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
    : empty(p.kind === 'robux' ? 'Aucune vente contre des Robux' : 'Aucun deal', p.grades.length || p.sizes.length
      ? 'Rien ne correspond à ces filtres pour le moment.'
      : p.kind === 'robux' ? 'Personne ne vend contre des Robux ces 10 dernières minutes.' : 'Aucune annonce assez bonne ces 15 dernières minutes.'));
}

const visible = (root) => root.isConnected && root.dataset.tab === 'deals' && document.visibilityState === 'visible';
const sig = (r) => [...list(r.data, 'deals').map(d => d.id + ':' + d.score), ...list(r.data, 'robux').map(x => 'r' + x.id)].join(',');

async function load(root, live = false) {
  const mine = ++token;
  const res = await send({ type: 'ronote:neuronal-deals' }).catch(() => null) || { error: 'empty' };
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
      const el = e.target.closest('[data-dl-grade], [data-dl-size], [data-dl-sort], [data-dl-kind]');
      if (!el) return;
      const p = pick();
      const toggle = (arr, k) => (!k ? [] : arr.includes(k) ? arr.filter(x => x !== k) : [...arr, k]);
      if (el.dataset.dlKind !== undefined) p.kind = el.dataset.dlKind;
      else if (el.dataset.dlSort !== undefined) p.sort = el.dataset.dlSort;
      else if (el.dataset.dlGrade !== undefined) { p.grades = toggle(p.grades, el.dataset.dlGrade); if (p.grades.length === GRADES.length) p.grades = []; }
      else { p.sizes = toggle(p.sizes, el.dataset.dlSize); if (p.sizes.length === SIZES.length) p.sizes = []; }
      write(p);
      paint(listEl);
      listEl.scrollTop = 0;
    });
    document.addEventListener('visibilitychange', () => { if (visible(listEl)) load(listEl, true); });
  }
  clearInterval(timer);
  timer = setInterval(() => { if (visible(listEl)) load(listEl, true); }, LIVE_MS);
  paint(listEl);
  load(listEl);
}
