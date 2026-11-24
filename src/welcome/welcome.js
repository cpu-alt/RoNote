/**
 * ==========================================================================
 *  LA PAGE D'ACCUEIL (ouverte une fois, à l'installation)
 * --------------------------------------------------------------------------
 *  Un merci, puis le geste pour épingler RoNote, animé sur une barre de
 *  navigateur dessinée. Sur Chrome / Edge, `action.getUserSettings` dit si
 *  l'icône est déjà épinglée : la carte passe au vert dès que c'est fait.
 *  Firefox n'a pas cette API : le guide reste affiché, sans détection.
 * ==========================================================================
 */
import { B } from '../common/shim.js';
import { applyLang } from '../common/ui.js';
import { t } from '../common/i18n.js';

// Chargée aussi par tools/selftest.html (sans API d'extension ni gabarit) : tout est facultatif.
const browser = document.querySelector('.browser');
if (browser) {
  const got = await Promise.resolve(B?.storage?.local?.get('settings')).catch(() => null);
  applyLang(got?.settings?.lang || 'auto');
  document.title = t('Bienvenue sur RoNote');
}

// Le curseur dessiné vise les vrais éléments, quelle que soit la largeur de la page.
function aim() {
  const box = browser.getBoundingClientRect();
  const at = (sel, dx = 0, dy = 0) => {
    const r = document.querySelector(sel).getBoundingClientRect();
    return `translate(${Math.round(r.left - box.left + r.width / 2 + dx)}px,${Math.round(r.top - box.top + r.height / 2 + dy)}px)`;
  };
  browser.style.setProperty('--p1', at('.puzzle', -4, -2));
  browser.style.setProperty('--p2', at('.pinbtn', -4, -2));
  // L'icône RoNote apparaît à gauche du puzzle : on vise cet emplacement.
  browser.style.setProperty('--p3', at('.puzzle', -34, -2));
}
if (browser) { aim(); addEventListener('resize', aim); }

// Épinglée ou pas : la question est gratuite (aucune requête), une fois par seconde tant que l'onglet est visible.
const getUserSettings = B?.action?.getUserSettings?.bind(B.action);
if (browser && getUserSettings) {
  const card = document.getElementById('pin'), badge = document.getElementById('pinState');
  const check = async () => {
    if (document.hidden) return;
    const s = await getUserSettings().catch(() => null);
    const on = !!s?.isOnToolbar;
    card.classList.toggle('done', on);
    badge.hidden = !on;
  };
  check();
  setInterval(check, 1000);
  document.addEventListener('visibilitychange', check);
}
