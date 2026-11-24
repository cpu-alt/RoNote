/**
 * ==========================================================================
 *  ROLIMON'S SANS PUBS (24 novembre)
 * --------------------------------------------------------------------------
 *  Injecté par le service worker (registerContentScripts, monde MAIN, au tout
 *  début du chargement) seulement si le réglage `rolimonsAdFree` est actif.
 *  Rolimon's passe par NitroPay (relevé le 24/11 sur /item/…) :
 *    - `window.nitroAds` est posé AVANT la page, avec un createAd qui ne fait
 *      rien ; la page garde le nôtre (`window.nitroAds = window.nitroAds || …`)
 *      et la bibliothèque, si elle arrivait quand même, ne peut pas le remplacer ;
 *    - le script `s.nitropay.com/ads-*.js` est retiré dès que l'analyseur le pose,
 *      avant d'être téléchargé : la page charge plus vite ;
 *    - les emplacements (bandeaux, colonnes latérales, ancres du bas, vidéo) sont
 *      masqués, sans laisser de trou.
 *  Rien d'autre n'est touché : pas de requête bloquée hors de rolimons.com,
 *  aucune nouvelle permission (l'accès à www.rolimons.com existait déjà).
 * ==========================================================================
 */
(() => {
  if (window.__ronoteAdFree) return;
  window.__ronoteAdFree = true;

  const noop = () => {};
  const stub = Object.freeze({ createAd: noop, addUserToken: noop, queue: [], loaded: false });
  try {
    Object.defineProperty(window, 'nitroAds', { configurable: false, get: () => stub, set: noop });
  } catch { /* déjà défini : le masquage ci-dessous suffit */ }

  // Les emplacements relevés : desktop_*, mobile_*, la vidéo, et les colonnes qui leur gardaient la place.
  const css = `[id^="desktop_"][id$="_lb"],[id^="desktop_"][id$="_lb2"],[id*="_gutter_skyscraper"],
    [id^="mobile_"][id*="_inline"],[id^="mobile_"][id$="_lb"],#mobile_floating_video,#nitro-outstream,
    #left_gutter,#right_gutter,[id^="nitro"],iframe[src*="nitropay"],div[class*="nitro"]{display:none!important}`;
  const style = document.createElement('style');
  style.id = 'ronote-adfree';
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);

  const isAd = (n) => n.tagName === 'SCRIPT' && /(^|\.)nitropay\.com\//.test(n.src || '');
  const mo = new MutationObserver((list) => {
    for (const m of list) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (isAd(n)) { n.type = 'javascript/blocked'; n.remove(); }
      else if (n.tagName === 'HEAD' && !style.isConnected) n.appendChild(style);
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  // La page finie, plus rien à surveiller.
  addEventListener('DOMContentLoaded', () => { mo.disconnect(); if (!style.isConnected) document.head?.appendChild(style); }, { once: true });
})();
