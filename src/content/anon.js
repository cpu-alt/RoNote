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

  // Le pseudo part toujours ; le solde de Robux seulement si les réglages ne le gardent pas (`anonShowRobux`).
  const NAME_CSS = `
    .age-bracket-label-username{font-size:0!important;letter-spacing:0!important}
    .age-bracket-label-username::after{content:"Anonymous";font-size:12px;font-weight:600}
    nav li:first-child>a[href$="/users/profile"]>span:last-child>*{display:none!important}
    nav li:first-child>a[href$="/users/profile"]>span:last-child::after{content:"Anonymous"}
    nav li:first-child>a[href$="/users/profile"] img,.age-bracket-label img{visibility:hidden!important}`;
  const ROBUX_CSS = `
    #nav-robux-amount,#nav-robux-balance{font-size:0!important;letter-spacing:0!important}
    #nav-robux-amount::after,#nav-robux-balance::after{content:"•••";font-size:14px}`;
  let style = null;
  let anon = false, showRobux = false;
  const apply = () => {
    const css = anon ? NAME_CSS + (showRobux ? '' : ROBUX_CSS) : '';
    if (css && !style) {
      style = document.createElement('style');
      style.dataset.rn = 'anon';
      (document.head || document.documentElement).append(style);
    } else if (!css && style) { style.remove(); style = null; }
    if (style) style.textContent = css;
  };
  try {
    B.storage.local.get(['anon', 'settings']).then(r => {
      anon = !!r?.anon; showRobux = !!r?.settings?.anonShowRobux; apply();
    }).catch(() => {});
    B.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if ('anon' in changes) anon = !!changes.anon.newValue;
      if ('settings' in changes) showRobux = !!changes.settings.newValue?.anonShowRobux;
      apply();
    });
  } catch { /* extension rechargée : rien à masquer */ }
})();
