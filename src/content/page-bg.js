/**
 * ==========================================================================
 *  TON IMAGE EN FOND DE ROBLOX
 * --------------------------------------------------------------------------
 *  L'image importée dans Réglages › Apparence (clé de stockage `pageBgImage`,
 *  une data: URL JPEG) posée derrière toutes les pages de roblox.com.
 *
 *  Seul `body` est opaque chez Roblox : on le rend transparent et l'image
 *  vit dans un calque fixe (body::before) derrière le contenu. Un voile de la
 *  couleur du thème par-dessus garde le texte lisible, en clair comme en
 *  sombre ; sa couleur est lue sur la page avant qu'on y touche.
 *
 *  La politique de sécurité de Roblox accepte les images `data:` (img-src),
 *  pas les `blob:` : l'image reste donc en data: URL.
 *
 *  Réglages lus :
 *    pageBgDim   force du voile, en %   (0 à 90)
 *    pageBgBlur  flou de l'image, en px (0 à 24)
 * ==========================================================================
 */
(() => {
  const B = globalThis.browser ?? globalThis.chrome;
  if (!B || globalThis.__rnPageBg) return;
  globalThis.__rnPageBg = true;

  let dead = false, image = '', settings = {}, style = null, veil = null;
  const alive = () => {
    if (dead) return false;
    try { if (B?.runtime?.id) return true; } catch { /* invalidated */ }
    dead = true; style?.remove();
    return false;
  };
  const valid = (v) => typeof v === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,/.test(v);
  const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

  /** La couleur de fond du thème, lue avant qu'on la retire. */
  function themeColor() {
    if (veil) return veil;
    const c = getComputedStyle(document.body).backgroundColor;
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(c || '');
    if (m && (m[4] === undefined || Number(m[4]) > 0.5)) return (veil = `${m[1]},${m[2]},${m[3]}`);
    return document.body.classList.contains('light-theme') ? '255,255,255' : '25,27,29';
  }

  function apply() {
    if (!alive()) return;
    if (!valid(image)) { style?.remove(); return; }
    // Les feuilles de style de Roblox d'abord : sans elles, pas de couleur de thème à lire.
    if (!document.body || document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', apply, { once: true }); return; }
    const color = themeColor();
    const dim = clamp(settings.pageBgDim, 0, 90, 60) / 100;
    const blur = clamp(settings.pageBgBlur, 0, 24, 0);
    if (!style) { style = document.createElement('style'); style.dataset.rn = 'page-bg'; }
    // Le calque déborde de la fenêtre quand il est flou : sans ça, le flou
    // laisse un liseré clair sur les bords.
    // Calque à part (will-change) : le défilement le déplace sans le repeindre,
    // flou compris. La règle, qui porte toute l'image, n'est réécrite que si
    // elle change : sinon le navigateur réanalyserait des centaines de Ko.
    const css = `
      html body{background:transparent!important}
      html body::before{content:"";position:fixed;inset:${-blur * 2}px;z-index:-1;pointer-events:none;
        will-change:transform;contain:strict;
        background:linear-gradient(rgba(${color},${dim}),rgba(${color},${dim})),url("${image}") center/cover no-repeat;
        ${blur ? `filter:blur(${blur}px);` : ''}}`;
    if (style.textContent !== css) style.textContent = css;
    if (!style.isConnected) (document.head || document.documentElement).append(style);
  }

  if (alive()) B.storage?.local?.get(['pageBgImage', 'settings']).then(got => {
    image = got?.pageBgImage || '';
    settings = got?.settings || {};
    apply();
  }).catch(() => {});
  if (alive()) B.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local' || dead) return;
    if (!changes.pageBgImage && !changes.settings) return;
    if (changes.pageBgImage) image = changes.pageBgImage.newValue || '';
    if (changes.settings) {
      const next = changes.settings.newValue || {};
      if (next.pageBgDim === settings.pageBgDim && next.pageBgBlur === settings.pageBgBlur && !changes.pageBgImage) { settings = next; return; }
      settings = next;
    }
    apply();
  });
})();
