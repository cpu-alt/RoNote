/**
 * ==========================================================================
 *  MODE ANONYME SUR ROBLOX.COM
 * --------------------------------------------------------------------------
 *  Le mode anonyme du popup (l'œil de l'entête, ou H) masque aussi, sur toutes
 *  les pages de Roblox, le pseudo (barre du haut et menu de gauche, avec son portrait) et le solde de Robux
 *  (partage d'écran, stream). Le popup recopie son état dans `storage.local`
 *  (clé `anon`) ; le vrai texte est remplacé à l'écran, pas flouté : rien de
 *  lisible ne reste, même sur une capture agrandie.
 * ==========================================================================
 */
(() => {
  const B = globalThis.browser ?? globalThis.chrome;
  if (!B?.runtime?.id || globalThis.__rnAnon) return;
  globalThis.__rnAnon = true;

  const CSS = `
    .age-bracket-label-username,#nav-robux-amount,#nav-robux-balance{font-size:0!important;letter-spacing:0!important}
    .age-bracket-label-username::after{content:"Anonymous";font-size:12px;font-weight:600}
    #nav-robux-amount::after,#nav-robux-balance::after{content:"•••";font-size:14px}
    nav li:first-child>a[href$="/users/profile"]>span:last-child>*{display:none!important}
    nav li:first-child>a[href$="/users/profile"]>span:last-child::after{content:"Anonymous"}
    nav li:first-child>a[href$="/users/profile"] img,.age-bracket-label img{visibility:hidden!important}`;
  let style = null;
  const apply = (on) => {
    if (on && !style) {
      style = document.createElement('style');
      style.dataset.rn = 'anon';
      style.textContent = CSS;
      (document.head || document.documentElement).append(style);
    } else if (!on && style) { style.remove(); style = null; }
  };
  try {
    B.storage.local.get('anon').then(r => apply(!!r?.anon)).catch(() => {});
    B.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && 'anon' in changes) apply(!!changes.anon.newValue);
    });
  } catch { /* extension rechargée : rien à masquer */ }
})();
