/**
 * La carte Premium des réglages (#s-premium) : Connect Discord en premier, « J'ai une clé »
 * à côté, puis la vérification du compte Roblox par un code dans la description du profil.
 * Tout passe par le service worker (background/premium.js) ; cette page n'affiche que son état.
 * Le vrai verrou est sur Neuronal : ici, rien ne débloque quoi que ce soit.
 */
import { B } from '../common/shim.js';
import { NEURONAL } from '../common/defaults.js';
import { escapeHtml } from '../common/utils.js';
import { t, locale } from '../common/i18n.js';
import { ic } from '../common/icons.js';
import { send, onStoredChange } from '../common/ui.js';

const SUBSCRIBE = 'https://discord.gg/neuronal';
const FEATURES = [
  ['lookup', 'Fiches Neuronal', "Ce que le réseau sait d'un joueur ou d'un objet, dans leur fiche."],
  ['profiles', 'Profils', 'Profile discovery : les joueurs repérés, classique et Neuronal.'],
  ['deals', 'Deals', 'Le Deal Sniper et le Robux Sniper, en direct.']
];

const ERRORS = {
  permission: "Sans l'accès à neuronal.live, RoNote ne peut pas vérifier ton abonnement.",
  cancelled: 'Connexion annulée.',
  failed: "La connexion n'a pas été confirmée. Réessaie dans un instant.",
  not_member: "Ce compte Discord n'est pas sur le serveur Neuronal. Rejoins-le, puis réessaie.",
  not_configured: "Le premium n'est pas encore ouvert sur Neuronal. Réessaie plus tard.",
  bad_key: 'Clé inconnue ou expirée. Tape /key sur le Discord Neuronal pour revoir la tienne.',
  bad_request: 'Cette clé ne ressemble pas à une clé RoNote (RN-XXXX-XXXX-XXXX-XXXX).',
  subscribe: 'Aucun abonnement actif sur ce compte Discord.',
  key_bound: 'Cette clé est liée à un autre compte Roblox.',
  taken: 'Ce compte Roblox est déjà lié à un autre membre du Discord.',
  cooldown: 'Tu as changé de compte Roblox il y a moins de 7 jours.',
  code_missing: "Le code n'est pas encore dans ta description. Enregistre-la sur Roblox, puis réessaie dans quelques secondes.",
  expired: 'Le code a expiré : recommence.',
  no_roblox: "Connecte-toi d'abord sur roblox.com : RoNote doit savoir quel compte vérifier.",
  roblox_unavailable: 'Roblox ne répond pas, réessaie dans un instant.',
  roblox_not_found: 'Roblox ne trouve pas ce compte.',
  unsupported: "Ce navigateur ne permet pas la connexion Discord : utilise une clé.",
  rate_limited: "Trop d'essais : attends un peu.",
  revoked: 'Ta session a été fermée : reconnecte-toi.',
  login: 'Reconnecte-toi.',
  other_account: "Roblox a confirmé un autre compte que celui suivi par RoNote. Connecte-toi sur roblox.com avec le bon compte, puis réessaie.",
  roblox_oauth_off: "La connexion Roblox n'est pas encore ouverte : utilise le code dans la description."
};
const errorText = (e) => t(ERRORS[e] || 'Neuronal est injoignable.');

let root = null;
let status = null;
let message = '';
let keyOpen = false;
let busy = false;

const fmtDate = (sec) => new Date(sec * 1000).toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' });

function signedOutHtml() {
  return `<div class="pm-actions">
      <button class="btn pm-main" data-pm="connect" type="button"${busy ? ' disabled' : ''}>${ic('discord')}<span>${t('Connecter Discord')}</span></button>
      <button class="btn" data-pm="key-open" type="button" aria-expanded="${keyOpen}">${t("J'ai une clé")}</button>
    </div>
    ${keyOpen ? `<form class="pm-key" data-pm-form="key">
      <input type="text" id="pm-key" autocomplete="off" spellcheck="false" placeholder="RN-XXXX-XXXX-XXXX-XXXX" aria-label="${escapeHtml(t('Ta clé RoNote'))}" maxlength="40">
      <button class="btn" type="submit"${busy ? ' disabled' : ''}>${t('Valider')}</button>
      <small>${t('Reçue en message privé à ton abonnement, ou avec /key sur le Discord.')}</small>
    </form>` : ''}
    <p class="pm-sub">${t('Pas encore abonné ?')} <a href="${SUBSCRIBE}" target="_blank" rel="noopener noreferrer">${t("S'abonner sur le Discord Neuronal")}</a></p>`;
}

function pendingHtml(p) {
  const who = p.roblox?.name ? '@' + escapeHtml(p.roblox.name) : '#' + p.roblox?.id;
  // 2.16.8 : la page officielle de Roblox d'abord (un clic), le code dans la bio en secours.
  const oauth = p.oauth ? `<div class="pm-oauth">
      <p>${t('Prouve que {who} est bien ton compte :', { who })}</p>
      <div class="pm-actions"><button class="btn pm-main" data-pm="roblox" type="button"${busy ? ' disabled' : ''}>${t('Se connecter avec Roblox')}</button></div>
      <small>${t('La page officielle de Roblox. Neuronal ne reçoit que ton identifiant et ton pseudo.')}</small>
    </div>
    <p class="pm-or">${t('ou, sans passer par Roblox :')}</p>` : '';
  return `${oauth}<div class="pm-code">
      <p>${t('Colle ce code dans la description de ton profil Roblox ({who}), enregistre, puis clique sur « C’est fait ». Tu pourras le retirer juste après.', { who })}</p>
      <div class="pm-words"><code id="pm-code">${escapeHtml(p.code)}</code>
        <button class="btn" data-pm="copy" type="button" title="${escapeHtml(t('Copier'))}">${ic('copy')}</button></div>
      <div class="pm-actions">
        <a class="btn" href="https://www.roblox.com/users/${Number(p.roblox?.id) || 0}/profile" target="_blank" rel="noopener noreferrer">${ic('external')}<span>${t('Ouvrir mon profil Roblox')}</span></a>
        <button class="btn${p.oauth ? '' : ' pm-main'}" data-pm="verify" type="button"${busy ? ' disabled' : ''}>${t('C’est fait')}</button>
        <button class="btn" data-pm="cancel" type="button">${t('Annuler')}</button>
      </div>
      <small>${t('Pourquoi ? Neuronal relit ta description publique : c’est la preuve que ce compte Roblox est bien le tien, sans jamais toucher à ta session Roblox.')}</small>
    </div>`;
}

function signedInHtml(me, roblox) {
  const services = (me.services || []).map(s => escapeHtml(s.name)).join(', ');
  const until = me.lifetime ? t('à vie') : me.until ? t("jusqu'au {date}", { date: fmtDate(me.until) }) : '';
  const linked = me.roblox;
  const other = linked && roblox && Number(linked.id) !== Number(roblox.id);
  const robloxRow = !linked
    ? `<div class="pm-warn">${ic('alert')}<span>${t('Vérifie ton compte Roblox pour débloquer les fonctions.')}</span>
        <button class="btn pm-main" data-pm="link" type="button"${busy ? ' disabled' : ''}>${t('Vérifier mon compte Roblox')}</button></div>`
    : other
      ? `<div class="pm-warn">${ic('alert')}<span>${t('Ton accès est lié à {name}, pas au compte suivi en ce moment.', { name: '@' + escapeHtml(linked.name || linked.id) })}
          ${me.link_change_at && me.link_change_at * 1000 > Date.now() ? t('Changement possible le {date}.', { date: fmtDate(me.link_change_at) }) : ''}</span>
          ${!me.link_change_at || me.link_change_at * 1000 <= Date.now() ? `<button class="btn" data-pm="link" type="button">${t('Lier ce compte à la place')}</button>` : ''}</div>`
      : `<div class="pm-line">${ic('check-circle')}<span>${t('Compte Roblox vérifié : {name}', { name: '@' + escapeHtml(linked.name || linked.id) })}</span></div>`;
  const feats = FEATURES.map(([k, name, desc]) => {
    const on = !!me.features?.[k];
    return `<li class="${on ? 'on' : 'off'}">${ic(on ? 'check' : 'lock')}<span><b>${t(name)}</b><small>${t(desc)}</small></span></li>`;
  }).join('');
  return `<div class="pm-line">${ic('discord')}<span>${t('Connecté avec Discord : {name}', { name: escapeHtml(me.discord?.name || me.discord?.id || '') })}</span></div>
    ${services
      ? `<div class="pm-line">${ic('star')}<span>${t('Abonnement : {s}', { s: services })}${until ? ' · ' + until : ''}</span></div>`
      : `<div class="pm-warn">${ic('alert')}<span>${t('Aucun abonnement actif.')}</span>
          <a class="btn pm-main" href="${escapeHtml(me.subscribe_url || SUBSCRIBE)}" target="_blank" rel="noopener noreferrer">${t("S'abonner")}</a></div>`}
    ${robloxRow}
    <ul class="pm-feats">${feats}</ul>
    <div class="pm-actions"><button class="btn" data-pm="logout" type="button">${t('Se déconnecter')}</button></div>`;
}

function paint() {
  if (!root) return;
  const s = status || {};
  const body = s.pending ? pendingHtml(s.pending) : s.signedIn && s.me ? signedInHtml(s.me, s.roblox) : signedOutHtml();
  const msg = message || (s.error && !s.signedIn ? errorText(s.error) : '');
  root.innerHTML = body + (msg ? `<p class="pm-msg" role="status">${escapeHtml(msg)}</p>` : '');
}

async function refresh(fresh = false) {
  status = await send({ type: 'ronote:premium-status', fresh }).catch(() => null) || {};
  paint();
}

/** La permission sur neuronal.live : demandée DANS le geste, avant tout await. */
function askPermission() {
  return B.permissions.request({ origins: NEURONAL.origins }).catch(() => false);
}

async function act(type, extra = {}, okText = '') {
  busy = true; message = ''; paint();
  const r = await send({ type, ...extra }).catch(() => ({ error: 'network' })) || { error: 'network' };
  busy = false;
  message = r.error ? errorText(r.error) : okText;
  await refresh(!r.error);
  return r;
}

async function onClick(e) {
  const el = e.target.closest('[data-pm]');
  if (!el) return;
  const what = el.dataset.pm;
  if (what === 'connect') {
    const perm = askPermission();
    if (!await perm) { message = errorText('permission'); paint(); return; }
    await act('ronote:premium-connect', {}, t('Connecté.'));
  } else if (what === 'key-open') {
    keyOpen = !keyOpen; message = ''; paint();
    if (keyOpen) root.querySelector('#pm-key')?.focus();
  } else if (what === 'link') {
    await act('ronote:premium-link');
  } else if (what === 'roblox') {
    await act('ronote:premium-roblox', {}, t('Compte Roblox vérifié. Les fonctions premium sont ouvertes.'));
  } else if (what === 'verify') {
    await act('ronote:premium-verify', {}, t('Compte Roblox vérifié. Les fonctions premium sont ouvertes.'));
  } else if (what === 'cancel') {
    await act('ronote:premium-cancel');
  } else if (what === 'logout') {
    keyOpen = false;
    await act('ronote:premium-logout', {}, t('Déconnecté.'));
  } else if (what === 'copy') {
    navigator.clipboard?.writeText(status?.pending?.code || '').then(() => { message = t('Code copié.'); paint(); }, () => {});
  }
}

async function onSubmit(e) {
  if (!e.target.matches('[data-pm-form="key"]')) return;
  e.preventDefault();
  const key = root.querySelector('#pm-key')?.value || '';
  const perm = askPermission();
  if (!await perm) { message = errorText('permission'); paint(); return; }
  await act('ronote:premium-key', { key });
}

/** La langue de la page vient d'être appliquée (options.js, après chaque lecture des réglages). */
export function repaintPremium() { paint(); }

export function mountPremium(el) {
  root = el;
  if (!root) return;
  root.addEventListener('click', onClick);
  root.addEventListener('submit', onSubmit);
  onStoredChange(['premium'], 200, () => refresh());
  refresh(true);
}
