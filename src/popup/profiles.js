/**
 * ==========================================================================
 *  PROFILS : LE PROFILE DISCOVERY DE NEURONAL, DANS LE POPUP
 * --------------------------------------------------------------------------
 *  L'onglet « Profils », ouvert depuis le menu du compte. Deux listes, celles
 *  que le bot poste sur Discord :
 *   - Classique : les joueurs repérés par leurs annonces Rolimon's, rangés
 *     par nombre d'annonces (rookie = 1, novice = 5, …) ;
 *   - Neuronal : les joueurs que le réseau a VUS trader, avec en plus le
 *     palier « ghost » (aucune annonce, jamais).
 *  Un filtre par palier. Les fiches viennent de neuronal.live (route
 *  /ext/v1/profiles, voir background/neuronal.js), avec les mêmes conditions
 *  que les fiches Neuronal : option `neuronalLookup` et permission accordée.
 *  Aucun appel à Roblox : pas de vignette, l'initiale du pseudo suffit.
 *  Le dernier choix (liste, palier) reste dans ce navigateur (localStorage).
 * ==========================================================================
 */
import { t } from '../common/i18n.js';
import { ic } from '../common/icons.js';
import { fmtNum, timeAgo, escapeHtml } from '../common/utils.js';
import { send } from '../common/ui.js';

const KEY = 'ronote.profiles';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
const write = (v) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* navigation privée */ } };

const KINDS = { classic: 'Classique', neuronal: 'Neuronal' };
let token = 0;

function stateHtml(res) {
  if (res?.off) return empty('Fiches Neuronal coupées',
    'Active « Fiches Neuronal » dans Réglages › Valeurs pour voir les profils.', true);
  if (res?.unavailable) return empty('Profils indisponibles', 'Neuronal ne partage pas ces listes pour le moment.');
  if (res?.limited) return empty('Trop de demandes', 'Réessaie dans quelques minutes.');
  if (res?.error || !res?.data) return empty('Neuronal est injoignable.', '');
  return null;
}

function empty(title, text, options = false) {
  return `<div class="empty"><div class="empty-ic">${ic('user')}</div><b>${t(title)}</b>${text ? `<span>${t(text)}</span>` : ''}
    ${options ? `<button class="pf-opt" data-pf-options>${t('Ouvrir les réglages')}</button>` : ''}</div>`;
}

function rowHtml(p) {
  const name = escapeHtml(p.name || '#' + p.id);
  const ads = !p.ads ? t('aucune annonce') : p.ads === 1 ? t('1 annonce') : t('{n} annonces', { n: fmtNum(p.ads) });
  const partner = p.partner ? ' · ' + t('a tradé avec {who}', { who: escapeHtml(p.partner.name || '#' + p.partner.id) }) : '';
  return `<a class="pf-row" href="https://www.roblox.com/users/${Number(p.id)}/profile" target="_blank" rel="noreferrer">
    <span class="pf-av" aria-hidden="true">${escapeHtml((p.name || '?').slice(0, 1).toUpperCase())}</span>
    <span class="pf-id"><b>${name}</b>${p.ronote ? `<span class="pf-rn" title="${escapeHtml(t('Utilise RoNote et partage ses trades'))}">RoNote user</span>` : ''}
      <small>${ads}${partner} · ${timeAgo(p.at * 1000)}</small></span>
    <span class="pf-end">${p.value ? `<span class="pf-val">${fmtNum(p.value)}</span>` : ''}<span class="pf-tier t-${escapeHtml(p.tier)}">${escapeHtml(p.tier)}</span></span>
  </a>`;
}

function paint(root, pick, res) {
  const head = `<div class="pf-head">
    <div class="pf-seg" role="radiogroup" aria-label="${escapeHtml(t('Liste'))}">${Object.entries(KINDS).map(([k, label]) =>
      `<button role="radio" aria-checked="${k === pick.kind}" data-pf-kind="${k}">${t(label)}</button>`).join('')}</div>
    <p class="pf-lede">${t(pick.kind === 'neuronal'
      ? 'Les joueurs que Neuronal a vus trader. Ghost : jamais une seule annonce.'
      : "Les joueurs repérés par leurs annonces Rolimon's, rangés par nombre d'annonces.")}</p>`;
  const state = res ? stateHtml(res) : `<div class="empty"><b>${t('Chargement…')}</b></div>`;
  if (state !== null) { root.innerHTML = head + '</div>' + state; return; }
  const d = res.data;
  const tiers = ['', ...(d.tiers || [])];
  const chips = `<div class="pf-tiers" role="radiogroup" aria-label="${escapeHtml(t('Palier'))}">${tiers.map(k =>
    `<button role="radio" aria-checked="${k === (pick.tier || '')}" data-pf-tier="${escapeHtml(k)}"${k ? ` class="t-${escapeHtml(k)}"` : ''}>${k ? escapeHtml(k) : t('Tous')}</button>`).join('')}</div>`;
  const list = (d.profiles || []).length
    ? `<div class="pf-list">${d.profiles.map(rowHtml).join('')}</div>`
    : empty('Aucun profil', 'Rien de posté dans ce palier ces 7 derniers jours.');
  root.innerHTML = head + chips + '</div>' + list;
}

async function load(root) {
  const pick = read();
  pick.kind = KINDS[pick.kind] ? pick.kind : 'neuronal';
  // Le palier « ghost » n'existe que dans la liste Neuronal.
  if (pick.kind === 'classic' && pick.tier === 'ghost') pick.tier = '';
  const mine = ++token;
  paint(root, pick, null);
  const res = await send({ type: 'ronote:neuronal-profiles', kind: pick.kind, tier: pick.tier || '' }).catch(() => null);
  if (mine === token && root.isConnected) paint(root, pick, res || { error: 'empty' });
}

/** Dessine l'onglet dans `listEl` ; les clics sont câblés une seule fois sur lui. */
export function renderProfiles(listEl, openOptions) {
  if (!listEl.dataset.pfBound) {
    listEl.dataset.pfBound = '1';
    listEl.addEventListener('click', (e) => {
      if (listEl.dataset.tab !== 'profiles') return;
      const kind = e.target.closest('[data-pf-kind]')?.dataset.pfKind;
      const tier = e.target.closest('[data-pf-tier]')?.dataset.pfTier;
      if (e.target.closest('[data-pf-options]')) { openOptions(); return; }
      if (kind === undefined && tier === undefined) return;
      const pick = read();
      if (kind !== undefined) { pick.kind = kind; pick.tier = ''; } else pick.tier = tier;
      write(pick);
      load(listEl);
    });
  }
  load(listEl);
}
