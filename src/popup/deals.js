/**
 * ==========================================================================
 *  DEALS : LE DEAL SNIPER DE NEURONAL, DANS LE POPUP
 * --------------------------------------------------------------------------
 *  Les trade ads Rolimon's des 15 dernières minutes que le bot a notées sur
 *  100 (salon Deal Sniper de Discord) : ce que tu DONNES (ce que le joueur
 *  demande), ce que tu REÇOIS (ce qu'il offre), le gain, la note, son palier
 *  (S ≥ 80, A ≥ 65, B) et les raisons en deux mots.
 *
 *  Une seule lecture de /ext/v1/deals (gardée 60 s par le serveur et le
 *  worker, 304 quand rien n'a changé) ; paliers et tailles se choisissent à
 *  plusieurs et se filtrent ici, sans rien redemander. En direct : relu
 *  chaque minute tant que l'onglet est affiché, les nouveaux deals entrent en
 *  haut avec l'animation des Profils ; ceux de plus de 15 min s'estompent.
 * ==========================================================================
 */
import { t } from '../common/i18n.js';
import { fmtNum, timeAgo, escapeHtml } from '../common/utils.js';
import { send } from '../common/ui.js';
import { nwTilesHtml } from './nwcard.js';

const KEY = 'ronote.deals';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* navigation privée */ } };

const GRADES = ['S', 'A', 'B'];
// la taille d'un deal : la value de ce qu'on reçoit, comme les salons du Deal Sniper sur Discord
const SIZES = [['s', '< 10k', 0, 10e3], ['m', '10k+', 10e3, 100e3], ['l', '100k+', 100e3, 500e3], ['xl', '500k+', 500e3, 1e6], ['xxl', '1M+', 1e6, Infinity]];
const SORTS = [['score', 'Meilleurs'], ['new', 'Récents']];
const LIVE_MS = 60e3;
const STALE_S = 15 * 60;

let last = null;          // la dernière réponse { data }
let seen = new Set();
let timer = 0;
let token = 0;

function pick() {
  const p = read();
  return {
    grades: (Array.isArray(p.grades) ? p.grades : []).filter(g => GRADES.includes(g)),
    sizes: (Array.isArray(p.sizes) ? p.sizes : []).filter(k => SIZES.some(([s]) => s === k)),
    sort: SORTS.some(([k]) => k === p.sort) ? p.sort : 'score'
  };
}

/** Le sélecteur en tête des vues Profils et Deals (une seule icône dans la barre d'onglets). */
export const discoverSwitch = (active) => `<div class="dc-switch" role="tablist" aria-label="Neuronal">${[['profiles', t('Profils')], ['deals', t('Deals')]]
  .map(([k, l]) => `<button role="tab" data-go-tab="${k}" aria-selected="${k === active}">${l}</button>`).join('')}</div>`;

const chip = (attr, value, label, on, cls = '', role = 'checkbox') =>
  `<button role="${role}" aria-checked="${on}" ${attr}="${escapeHtml(value)}"${cls ? ` class="${cls}"` : ''}>${label}</button>`;

function toolbarHtml(p, count) {
  return `<div class="pf-head">${discoverSwitch('deals')}
    <div class="pf-bar"><div class="pf-seg" role="radiogroup" aria-label="${escapeHtml(t('Tri'))}">${SORTS.map(([k, l]) =>
      chip('data-dl-sort', k, t(l), k === p.sort, '', 'radio')).join('')}</div>
      <span class="pf-count${count === null ? '' : ' pf-live'}" title="${escapeHtml(t('En direct : les nouveaux deals arrivent tout seuls'))}">${count === null ? '' : t('{n} deals', { n: count })}</span></div>
    <div class="pf-row" role="group" aria-label="${escapeHtml(t('Paliers'))}">
      <span class="pf-lbl">${t('Palier')}</span>${chip('data-dl-grade', '', t('Tous'), !p.grades.length)}${GRADES.map(g => chip('data-dl-grade', g, g, p.grades.includes(g), 'dl-g g-' + g)).join('')}
      </div>
    <div class="pf-row" role="group" aria-label="${escapeHtml(t('Taille'))}">
      <span class="pf-lbl">${t('Taille')}</span>${chip('data-dl-size', '', t('Toutes'), !p.sizes.length)}${SIZES.map(([k, l]) => chip('data-dl-size', k, l, p.sizes.includes(k))).join('')}</div>
  </div>`;
}

const sizeOf = (d) => (SIZES.find(([, , lo, hi]) => d.get_value >= lo && d.get_value < hi) || SIZES[0])[0];

function filtered(p, deals) {
  const out = deals.filter(d => (!p.grades.length || p.grades.includes(d.grade)) && (!p.sizes.length || p.sizes.includes(sizeOf(d))));
  return p.sort === 'new' ? out.sort((a, b) => b.at - a.at) : out;
}

function cardHtml(d, isNew = false) {
  const gain = d.get_value - d.give_value;
  const pct = d.give_value ? gain / d.give_value * 100 : 0;
  const stale = Date.now() / 1000 - d.at > STALE_S;
  const uid = Number(d.user?.id) || 0;
  return `<article class="pf-card dl-card${isNew ? ' pf-new' : ''}${stale ? ' dl-old' : ''}" data-dl-id="${Number(d.id)}">
    <header class="dl-top">
      <span class="dl-grade g-${escapeHtml(d.grade)}" title="${escapeHtml(t('Note {n}/100', { n: d.score }))}"><b>${escapeHtml(d.grade)}</b><i>${Number(d.score)}</i></span>
      <span class="dl-gain"><b>+${fmtNum(gain)}</b><small>+${pct.toFixed(pct < 10 ? 1 : 0)} % value</small></span>
      <span class="dl-who"><b>${escapeHtml(d.user?.name || '#' + uid)}</b><small>${timeAgo(d.at * 1000)}</small></span>
    </header>
    <div class="dl-sides">
      <div class="dl-side"><div class="dl-lbl"><span>${t('Tu donnes')}</span><b>${fmtNum(d.give_value)}</b></div>${nwTilesHtml(d.give)}</div>
      <div class="dl-arrow" aria-hidden="true">→</div>
      <div class="dl-side"><div class="dl-lbl"><span>${t('Tu reçois')}</span><b class="win">${fmtNum(d.get_value)}</b></div>${nwTilesHtml(d.get)}</div>
    </div>
    ${d.reasons?.length ? `<div class="dl-why">${d.reasons.map(([good, label]) => `<span class="${good ? 'win' : 'loss'}">${escapeHtml(label)}</span>`).join('')}</div>` : ''}
    <footer class="pf-acts">
      <button class="pf-send" data-open="https://www.roblox.com/users/${uid}/trade">${t('Envoyer un trade')}</button>
      <button data-open="https://www.rolimons.com/player/${uid}" title="Rolimon's">Rolimon's</button>
      <button data-open="https://www.roblox.com/users/${uid}/profile" title="Roblox">Roblox</button>
    </footer>
  </article>`;
}

function empty(title, text, options = false) {
  return `<div class="empty"><b>${t(title)}</b>${text ? `<span>${t(text)}</span>` : ''}
    ${options ? `<button class="pf-opt" data-dl-options>${t('Ouvrir les réglages')}</button>` : ''}</div>`;
}

function stateHtml(res) {
  if (res?.off) return empty('Fiches Neuronal coupées', 'Active « Fiches Neuronal » dans Réglages › Valeurs pour voir les deals.', true);
  if (res?.unavailable) return empty('Deals indisponibles', 'Neuronal ne partage pas les deals pour le moment.');
  if (res?.limited) return empty('Trop de demandes', 'Réessaie dans quelques minutes.');
  return empty('Neuronal est injoignable.', '');
}

function paint(root) {
  const p = pick();
  if (!last) {
    root.innerHTML = toolbarHtml(p, null) + `<div class="pf-list">${'<div class="pf-skel"></div>'.repeat(3)}</div>`;
    return;
  }
  if (!last.data) { root.innerHTML = toolbarHtml(p, null) + stateHtml(last); return; }
  const shown = filtered(p, last.data.deals || []);
  seen = new Set((last.data.deals || []).map(d => d.id));
  root.innerHTML = toolbarHtml(p, shown.length) + (shown.length
    ? `<div class="pf-list">${shown.map(d => cardHtml(d)).join('')}</div>`
    : empty('Aucun deal', p.grades.length || p.sizes.length
      ? 'Rien ne correspond à ces filtres pour le moment.' : 'Aucune annonce assez bonne ces 15 dernières minutes.'));
}

const visible = (root) => root.isConnected && root.dataset.tab === 'deals' && document.visibilityState === 'visible';

async function load(root, live = false) {
  const mine = ++token;
  const res = await send({ type: 'ronote:neuronal-deals' }).catch(() => null) || { error: 'empty' };
  if (mine !== token || !visible(root)) return;
  if (live && !res.data) return;                     // panne passagère : on garde ce qu'on a
  if (!live || !last?.data) { last = res; paint(root); return; }
  // En direct (40 cartes au plus) : rien de changé, on ne touche à rien ; sinon la liste est
  // redessinée dans son ordre, les deals nouveaux animés, la position de lecture gardée.
  const sig = (r) => (r.data.deals || []).map(d => d.id + ':' + d.score).join(',');
  if (sig(res) === sig(last)) return;
  const before = seen;
  last = res;
  const top = root.scrollTop;
  paint(root);
  root.scrollTop = top;
  let fresh = 0;
  for (const el of root.querySelectorAll('.dl-card')) {
    if (!before.has(Number(el.dataset.dlId))) { el.classList.add('pf-new'); fresh++; }
  }
  const count = root.querySelector('.pf-count');
  if (fresh && count) count.classList.add('pf-bump');
}

/** Dessine l'onglet dans `listEl` ; les clics sont câblés une seule fois sur lui. */
export function renderDeals(listEl, openOptions) {
  if (!listEl.dataset.dlBound) {
    listEl.dataset.dlBound = '1';
    listEl.addEventListener('click', (e) => {
      if (listEl.dataset.tab !== 'deals') return;
      if (e.target.closest('[data-dl-options]')) { openOptions(); return; }
      const el = e.target.closest('[data-dl-grade], [data-dl-size], [data-dl-sort]');
      if (!el) return;
      const p = pick();
      const toggle = (list, k) => (!k ? [] : list.includes(k) ? list.filter(x => x !== k) : [...list, k]);
      if (el.dataset.dlSort !== undefined) p.sort = el.dataset.dlSort;
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
