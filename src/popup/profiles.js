/**
 * ==========================================================================
 *  PROFILS : LE PROFILE DISCOVERY DE NEURONAL, DANS LE POPUP
 * --------------------------------------------------------------------------
 *  Les deux listes que le bot poste sur Discord :
 *   - Classique : les joueurs repérés par leurs annonces Rolimon's, rangés
 *     par nombre d'annonces (rookie = 1, novice = 5, …) ;
 *   - Neuronal : les joueurs que le réseau a VUS trader, avec en plus le
 *     palier « ghost » (aucune annonce, jamais).
 *  On montre l'une, l'autre ou les deux mêlées (les plus récentes d'abord),
 *  filtrées par palier et par value d'inventaire minimale.
 *
 *  RAPIDE : chaque liste est lue UNE fois (route /ext/v1/profiles, gardée
 *  2 min par le worker et ici) ; changer de filtre ne redemande rien, tout se
 *  trie dans le popup. Les fiches sont dessinées par paquets de PAGE (la suite
 *  à l'approche du bas) et `content-visibility` laisse au navigateur celles
 *  hors de l'écran. Aucun appel à Roblox : avatars et vignettes viennent de la
 *  réponse de neuronal.live. Mêmes conditions que les fiches Neuronal : option
 *  `neuronalLookup` et permission accordée.
 *
 *  Chaque fiche montre ce que montre Discord (le trade qui l'a révélé, ou son
 *  annonce Propose / Cherche) et un bouton « Envoyer un trade ». Les choix
 *  (liste, palier, value) restent dans ce navigateur (localStorage).
 * ==========================================================================
 */
import { t } from '../common/i18n.js';
import { ic } from '../common/icons.js';
import { fmtNum, timeAgo, escapeHtml } from '../common/utils.js';
import { send } from '../common/ui.js';
import { nwTradeCard, nwTilesHtml } from './nwcard.js';

const KEY = 'ronote.profiles';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* navigation privée */ } };

const SOURCES = [['both', 'Les deux'], ['classic', 'Classique'], ['neuronal', 'Neuronal']];
const TIERS = ['ghost', 'rookie', 'novice', 'beginner', 'casual', 'regular', 'active', 'experienced', 'veteran'];
const MINS = [0, 10e3, 50e3, 100e3, 500e3, 1e6];
const PAGE = 15;
const KEEP_MS = 2 * 60e3;
// En direct : tant que l'onglet est affiché, la liste est relue chaque minute.
// Le worker et le serveur gardent chacun la réponse 2 min, donc ça ne coûte
// au plus qu'une vraie requête toutes les 2 min par liste ; rien ne part si
// le popup est caché ou sur un autre onglet.
const LIVE_MS = 60e3;

const lists = {};            // 'classic' | 'neuronal' -> { at, res }
let token = 0;
let shown = [];              // les fiches filtrées, dans l'ordre
let drawn = 0;
let observer = null;
let seen = new Set();        // `id:at` des fiches déjà montrées
let fresh = 0;               // fiches arrivées pendant qu'on lisait plus bas
let timer = 0;
const keyOf = (x) => x.id + ':' + x.at;

function pick() {
  const p = read();
  return {
    src: SOURCES.some(([k]) => k === p.src) ? p.src : 'both',
    tier: TIERS.includes(p.tier) ? p.tier : '',
    min: MINS.includes(p.min) ? p.min : 0
  };
}

/** Une liste, gardée 2 min ici (le worker la garde aussi) : un filtre ne relit rien. */
async function list(kind, force = false) {
  const hit = lists[kind];
  if (!force && hit && Date.now() - hit.at < KEEP_MS) return hit.res;
  const res = await send({ type: 'ronote:neuronal-profiles', kind, tier: '' }).catch(() => null) || { error: 'empty' };
  if (res.data) lists[kind] = { at: Date.now(), res };
  return res;
}

function empty(title, text, options = false) {
  return `<div class="empty"><div class="empty-ic">${ic('user')}</div><b>${t(title)}</b>${text ? `<span>${t(text)}</span>` : ''}
    ${options ? `<button class="pf-opt" data-pf-options>${t('Ouvrir les réglages')}</button>` : ''}</div>`;
}

function stateHtml(res) {
  if (res?.off) return empty('Fiches Neuronal coupées',
    'Active « Fiches Neuronal » dans Réglages › Valeurs pour voir les profils.', true);
  if (res?.unavailable) return empty('Profils indisponibles', 'Neuronal ne partage pas ces listes pour le moment.');
  if (res?.limited) return empty('Trop de demandes', 'Réessaie dans quelques minutes.');
  return empty('Neuronal est injoignable.', '');
}

const chip = (attr, value, label, on, cls = '') =>
  `<button role="radio" aria-checked="${on}" ${attr}="${escapeHtml(String(value))}"${cls ? ` class="${cls}"` : ''}>${label}</button>`;

function toolbarHtml(p, count) {
  return `<div class="pf-head">
    <div class="pf-bar"><div class="pf-seg" role="radiogroup" aria-label="${escapeHtml(t('Liste'))}">${SOURCES.map(([k, label]) =>
      chip('data-pf-src', k, t(label), k === p.src)).join('')}</div>
      <span class="pf-count${count === null ? '' : ' pf-live'}" title="${escapeHtml(t('En direct : les nouveaux profils arrivent tout seuls'))}">${count === null ? '' : t('{n} profils', { n: count })}</span></div>
    <div class="pf-row" role="radiogroup" aria-label="${escapeHtml(t('Palier'))}">
      ${chip('data-pf-tier', '', t('Tous'), !p.tier)}${TIERS.filter(k => k !== 'ghost' || p.src !== 'classic').map(k =>
        chip('data-pf-tier', k, escapeHtml(k), k === p.tier, 't-' + k)).join('')}</div>
    <div class="pf-row pf-min" role="radiogroup" aria-label="${escapeHtml(t('Inventaire minimum'))}">
      <span class="pf-lbl">${t('Inventaire')}</span>${MINS.map(v =>
        chip('data-pf-min', v, v ? fmtNum(v) + '+' : t('Tout'), v === p.min)).join('')}</div>
  </div>`;
}

/** Une fiche, comme sur Discord : qui, le trade qui l'a révélé ou son annonce, et les liens. */
function cardHtml(p, both, isNew = false) {
  const id = Number(p.id);
  const name = escapeHtml(p.name || '#' + id);
  const ads = !p.ads ? t('aucune annonce') : p.ads === 1 ? t('1 annonce') : t('{n} annonces', { n: fmtNum(p.ads) });
  const av = p.thumb
    ? `<img class="pf-av" src="${escapeHtml(p.thumb)}" alt="" width="36" height="36" loading="lazy" decoding="async">`
    : `<span class="pf-av" aria-hidden="true">${escapeHtml((p.name || '?').slice(0, 1).toUpperCase())}</span>`;
  const ad = (p.offering?.length || p.wanting?.length) && !p.last ? `<div class="pf-ad">
      <div class="pf-ad-s"><span class="pf-ad-l win">${t('Propose')}</span>${nwTilesHtml(p.offering)}</div>
      <div class="pf-ad-s"><span class="pf-ad-l loss">${t('Cherche')}</span>${nwTilesHtml(p.wanting)}</div>
    </div>` : '';
  const trade = p.last ? nwTradeCard({ ...p.last, partner: p.partner }, true) : '';
  return `<article class="pf-card${isNew ? ' pf-new' : ''}" data-pf-id="${id}">
    <header class="pf-top">
      <span class="pf-avw t-${escapeHtml(p.tier)}">${av}</span>
      <span class="pf-id"><span class="pf-nl"><b>${name}</b>${p.ronote ? `<span class="pf-rn" title="${escapeHtml(t('Utilise RoNote et partage ses trades'))}">RoNote</span>` : ''}</span>
        <small>${ads} · ${timeAgo(p.at * 1000)}</small></span>
      <span class="pf-side"><span class="pf-tier t-${escapeHtml(p.tier)}">${escapeHtml(p.tier)}</span>
        ${p.value ? `<b class="pf-val" title="${escapeHtml(t('Value de son inventaire'))}">${fmtNum(p.value)}</b>` : ''}</span>
    </header>
    ${trade}${ad}
    <footer class="pf-acts">
      <button class="pf-send" data-open="https://www.roblox.com/users/${id}/trade">${ic('send')} ${t('Envoyer un trade')}</button>
      <button data-open="https://www.roblox.com/users/${id}/profile" title="Roblox">Roblox</button>
      <button data-open="https://www.rolimons.com/player/${id}" title="Rolimon's">Rolimon's</button>
      ${both ? `<span class="pf-src">${p._kind === 'neuronal' ? 'Neuronal' : t('Classique')}</span>` : ''}
    </footer>
  </article>`;
}

/** Le paquet suivant de fiches, au bout de la liste. */
function drawMore(root) {
  const box = root.querySelector('.pf-list');
  if (!box || drawn >= shown.length) return;
  const both = pick().src === 'both';
  box.insertAdjacentHTML('beforeend', shown.slice(drawn, drawn + PAGE).map(p => cardHtml(p, both)).join(''));
  drawn = Math.min(shown.length, drawn + PAGE);
  const end = root.querySelector('.pf-end');
  if (end) end.hidden = drawn >= shown.length;
}

/** Les deux listes mêlées puis filtrées : un joueur présent deux fois garde sa fiche la plus récente. */
function merge(p, ok) {
  const byId = new Map();
  for (const { kind, res } of ok) {
    for (const x of res.data.profiles || []) {
      const had = byId.get(x.id);
      if (!had || x.at > had.at) byId.set(x.id, { ...x, _kind: kind });
    }
  }
  return [...byId.values()]
    .filter(x => (!p.tier || x.tier === p.tier) && (!p.min || (x.value || 0) >= p.min))
    .sort((a, b) => b.at - a.at);
}

const visible = (root) => root.isConnected && root.dataset.tab === 'profiles' && document.visibilityState === 'visible';

/**
 * Relecture en direct : seules les fiches NOUVELLES (ou dont le joueur a
 * bougé) entrent, en haut, avec l'animation ; le reste de la liste ne bouge
 * pas. Si on lit plus bas, la position est gardée et une pastille propose
 * de remonter.
 */
async function poll(root) {
  if (!visible(root) || !root.querySelector('.pf-list')) return;
  const p = pick();
  const mine = token;
  const kinds = p.src === 'both' ? ['classic', 'neuronal'] : [p.src];
  const results = await Promise.all(kinds.map(async kind => ({ kind, res: await list(kind, true) })));
  if (mine !== token || !visible(root)) return;
  const ok = results.filter(r => r.res.data);
  if (!ok.length) return;                       // panne passagère : on garde ce qu'on a
  const next = merge(p, ok);
  const added = next.filter(x => !seen.has(keyOf(x)));
  if (!added.length) return;

  const box = root.querySelector('.pf-list');
  const ids = new Set(added.map(x => x.id));
  let gone = 0;                                 // anciennes fiches de ces joueurs, déjà dessinées
  box.querySelectorAll('.pf-card').forEach(el => { if (ids.has(Number(el.dataset.pfId))) { el.remove(); gone++; } });

  const anchor = box.querySelector('.pf-card');
  const before = anchor?.getBoundingClientRect().top;
  const reading = root.scrollTop > 60;
  const both = p.src === 'both';
  box.insertAdjacentHTML('afterbegin', added.map(x => cardHtml(x, both, true)).join(''));
  if (reading && anchor) root.scrollTop += anchor.getBoundingClientRect().top - before;

  shown = next;
  drawn = Math.min(shown.length, drawn - gone + added.length);
  added.forEach(x => seen.add(keyOf(x)));

  const count = root.querySelector('.pf-count');
  if (count) {
    count.textContent = t('{n} profils', { n: shown.length });
    count.classList.remove('pf-bump'); void count.offsetWidth; count.classList.add('pf-bump');
  }
  if (reading) {
    fresh += added.length;
    let pill = root.querySelector('.pf-pill');
    if (!pill) {
      pill = document.createElement('button');
      pill.className = 'pf-pill';
      root.querySelector('.pf-head')?.after(pill);
    }
    pill.textContent = '↑ ' + (fresh === 1 ? t('1 nouveau profil') : t('{n} nouveaux profils', { n: fresh }));
  }
}

function live(root) {
  clearInterval(timer);
  timer = setInterval(() => poll(root), LIVE_MS);
}

function paint(root, p, results) {
  observer?.disconnect();
  if (!results) {
    root.innerHTML = toolbarHtml(p, null) + `<div class="pf-list">${'<div class="pf-skel"></div>'.repeat(4)}</div>`;
    return;
  }
  const ok = results.filter(r => r.res.data);
  if (!ok.length) { root.innerHTML = toolbarHtml(p, null) + stateHtml(results[0].res); return; }
  shown = merge(p, ok);
  seen = new Set(shown.map(keyOf));
  fresh = 0;
  drawn = 0;
  root.innerHTML = toolbarHtml(p, shown.length) + (shown.length
    ? '<div class="pf-list"></div><div class="pf-end" aria-hidden="true"></div>'
    : empty('Aucun profil', 'Rien ne correspond à ces filtres ces 7 derniers jours.'));
  drawMore(root);
  const end = root.querySelector('.pf-end');
  if (end && 'IntersectionObserver' in globalThis) {
    observer = new IntersectionObserver((e) => { if (e[0].isIntersecting) drawMore(root); }, { root, rootMargin: '400px' });
    observer.observe(end);
  }
}

async function load(root) {
  const p = pick();
  const mine = ++token;
  const kinds = p.src === 'both' ? ['classic', 'neuronal'] : [p.src];
  const ready = kinds.every(k => lists[k] && Date.now() - lists[k].at < KEEP_MS);
  if (!ready) paint(root, p, null);
  const results = await Promise.all(kinds.map(async kind => ({ kind, res: await list(kind) })));
  if (mine === token && root.isConnected && root.dataset.tab === 'profiles') paint(root, p, results);
}

/** Dessine l'onglet dans `listEl` ; les clics sont câblés une seule fois sur lui. */
export function renderProfiles(listEl, openOptions) {
  if (!listEl.dataset.pfBound) {
    listEl.dataset.pfBound = '1';
    listEl.addEventListener('click', (e) => {
      if (listEl.dataset.tab !== 'profiles') return;
      if (e.target.closest('[data-pf-options]')) { openOptions(); return; }
      if (e.target.closest('.pf-pill')) { listEl.scrollTo({ top: 0, behavior: 'smooth' }); return; }
      const el = e.target.closest('[data-pf-src], [data-pf-tier], [data-pf-min]');
      if (!el) return;
      const p = pick();
      if (el.dataset.pfSrc !== undefined) {
        p.src = el.dataset.pfSrc;
        if (p.src === 'classic' && p.tier === 'ghost') p.tier = '';
      } else if (el.dataset.pfTier !== undefined) p.tier = el.dataset.pfTier;
      else p.min = Number(el.dataset.pfMin) || 0;
      write(p);
      load(listEl);
      listEl.scrollTop = 0;
    });
    // Revenu en haut : la pastille « nouveaux profils » n'a plus lieu d'être.
    listEl.addEventListener('scroll', () => {
      if (listEl.scrollTop > 60 || !fresh) return;
      fresh = 0;
      listEl.querySelector('.pf-pill')?.remove();
    }, { passive: true });
    // Popup de nouveau visible : on rattrape tout de suite au lieu d'attendre la minute.
    document.addEventListener('visibilitychange', () => { if (visible(listEl)) poll(listEl); });
  }
  live(listEl);
  load(listEl);
}
