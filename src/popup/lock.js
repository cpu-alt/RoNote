/**
 * RoNote premium dans le popup : ce qu'on montre quand Neuronal refuse une fonction
 * réservée aux abonnés (fiches, Profils, Deals). Le refus vient du SERVEUR
 * (`res.locked` : login, subscribe, link, other_account, invalid, revoked…) : ici
 * on explique seulement, avec les deux sorties : se connecter (la carte Premium des
 * réglages) ou s'abonner sur le Discord.
 */
import { B } from '../common/shim.js';
import { t } from '../common/i18n.js';
import { ic } from '../common/icons.js';
import { escapeHtml } from '../common/utils.js';

const SUBSCRIBE = 'https://discord.gg/neuronal';

const TEXT = {
  login: 'Réservé aux abonnés du Discord Neuronal. Connecte ton compte Discord ou entre ta clé.',
  subscribe: 'Ton abonnement ne comprend pas cette fonction, ou il est terminé.',
  link: 'Vérifie ton compte Roblox dans la carte Premium pour continuer.',
  other_account: 'Ton accès premium est lié à un autre compte Roblox.'
};

const premiumUrl = () => B.runtime.getURL('options/options.html#s-premium');

/** Le cadre « Premium » : `compact` pour la fiche d'un joueur ou d'un objet. */
export function lockHtml(res, compact = false) {
  const why = TEXT[res?.locked] ? res.locked : 'login';
  const sub = escapeHtml(res?.subscribeUrl || SUBSCRIBE);
  const unlock = why === 'subscribe' ? '' : `<a class="pm-btn pm-main" href="${premiumUrl()}" target="_blank" rel="noopener">${t(why === 'login' ? 'Débloquer' : 'Ouvrir Premium')}</a>`;
  const subscribe = `<a class="pm-btn" href="${sub}" target="_blank" rel="noopener noreferrer">${t(why === 'subscribe' ? "S'abonner" : 'Pas abonné ?')}</a>`;
  return `<div class="pm-lock${compact ? ' compact' : ''}">${ic('lock')}<span><b>${t('Premium')}</b><small>${t(TEXT[why])}</small></span>
    <span class="pm-btns">${unlock}${subscribe}</span></div>`;
}
