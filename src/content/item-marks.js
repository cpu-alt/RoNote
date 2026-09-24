/**
 * ==========================================================================
 *  LES REPÈRES D'UN OBJET : DIAMANT « RARE » ET LUCKY CAT
 * --------------------------------------------------------------------------
 *  Un seul dessin pour la page des trades Roblox, le popup et l'aperçu des
 *  réglages. Script classique : la page Roblox n'accepte pas les imports
 *  d'une extension.
 *
 *    rare       Rolimon's classe l'objet « rare » (colonne `rare` du
 *               catalogue) : un petit diamant.
 *    Lucky Cat  un seul exemplaire (UAID) tiré au sort par Rolimon's toutes
 *               les 4 à 24 h ; qui le détient gagne un RoliBadge. Clé de
 *               stockage `luckyCat` : { uaid, assetId, serial, name, … }.
 * ==========================================================================
 */
(() => {
  if (globalThis.RoNoteMarks) return;

  const fr = (document.documentElement.lang || navigator.language || '').toLowerCase().startsWith('fr');

  const DIAMOND = `<svg viewBox="0 0 16 16" aria-hidden="true"><defs><linearGradient id="rn-gem" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#9ff0ff"/><stop offset=".55" stop-color="#5cc8ff"/><stop offset="1" stop-color="#a47bff"/></linearGradient></defs>
    <path d="M4.2 2h7.6l3.2 4.3L8 14.6 1 6.3z" fill="url(#rn-gem)" stroke="#e9fbff" stroke-width=".9" stroke-linejoin="round"/>
    <path d="M1 6.3h14M5.6 6.3 8 14.6l2.4-8.3M4.2 2l1.4 4.3L8 2l2.4 4.3L11.8 2" fill="none" stroke="#ffffff" stroke-opacity=".75" stroke-width=".8" stroke-linejoin="round"/></svg>`;

  // Une tête de chat porte-bonheur, oreilles dressées, yeux plissés de contentement.
  const CAT = (ink) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.6 11.2V4.4l4.3 3.3h6.2l4.3-3.3v6.8a7.4 7.4 0 0 1-14.8 0z" fill="${ink}" fill-opacity=".12" stroke="${ink}" stroke-width="2" stroke-linejoin="round"/>
    <path d="M8.3 12.4q1.1-1.2 2.2 0M13.5 12.4q1.1-1.2 2.2 0M10.6 15.4q1.4 1.1 2.8 0" fill="none" stroke="${ink}" stroke-width="1.7" stroke-linecap="round"/></svg>`;

  /** L'objet est-il l'exemplaire tiré ? Par son UAID, sinon par objet + numéro de série. */
  function isLucky(lucky, item) {
    if (!lucky?.uaid || !item) return false;
    const uaid = Number(item.uaid) || 0;
    if (uaid) return uaid === Number(lucky.uaid);
    const asset = Number(item.assetId) || 0;
    const serial = Number(String(item.serial ?? '').replace(/\D/g, '')) || 0;
    return !!asset && asset === Number(lucky.assetId) && !!serial && serial === Number(lucky.serial);
  }

  const rareTitle = () => (fr ? 'Objet rare selon Rolimon’s' : 'Rare item according to Rolimon’s');
  const luckyTitle = (lucky) => {
    const copy = lucky?.name ? `${lucky.name}${lucky.serial ? ' #' + lucky.serial : ''}` : '';
    return fr
      ? `Lucky Cat de Rolimon’s${copy ? ' : ' + copy : ''}. Cet exemplaire donne le RoliBadge Lucky Cat à qui le possède, jusqu’au prochain tirage.`
      : `Rolimon’s Lucky Cat${copy ? ': ' + copy : ''}. This copy gives the Lucky Cat RoliBadge to whoever holds it, until the next draw.`;
  };

  /** Petit repère en ligne, à la taille du texte (popup, listes). */
  const inline = {
    rare: () => `<i class="rn-mark rn-rare" title="${rareTitle()}">${DIAMOND}</i>`,
    lucky: (lucky) => `<i class="rn-mark rn-lucky" title="${luckyTitle(lucky).replace(/"/g, '&quot;')}">${CAT('#3a2400')}</i>`
  };
  const INLINE_CSS = `
    .rn-mark{display:inline-grid;place-items:center;flex:none;vertical-align:-.15em;font-style:normal;line-height:0}
    .rn-mark svg{display:block}
    .rn-rare svg{width:1em;height:1em;filter:drop-shadow(0 0 3px rgba(110,210,255,.55))}
    .rn-lucky{width:1.3em;height:1.3em;border-radius:50%;background:linear-gradient(160deg,#ffe27a,#ffb300 60%,#e08a00);
      box-shadow:0 0 0 1px rgba(255,255,255,.75),0 0 8px rgba(255,190,40,.6)}
    .rn-lucky svg{width:.95em;height:.95em}`;

  /**
   * Les repères posés dans le coin d'une vignette, dans un shadow root.
   * @param {{rare?: boolean, lucky?: object|null}} marks
   */
  function fill(root, marks, px = 22) {
    const bits = [];
    if (marks.lucky) bits.push(`<span class="m lucky" title="${luckyTitle(marks.lucky).replace(/"/g, '&quot;')}">${CAT('#3a2400')}</span>`);
    if (marks.rare) bits.push(`<span class="m rare" title="${rareTitle()}">${DIAMOND}</span>`);
    root.innerHTML = `<style>
      :host{all:initial}
      .s{display:flex;gap:4px;align-items:center}
      .m{box-sizing:border-box;width:${px}px;height:${px}px;border-radius:50%;display:grid;place-items:center;cursor:help;
        animation:pop .28s cubic-bezier(.3,1.6,.5,1) both}
      .m svg{width:${Math.round(px * 0.72)}px;height:${Math.round(px * 0.72)}px;display:block}
      .rare{background:rgba(12,18,40,.82);box-shadow:0 0 0 1.5px rgba(160,230,255,.85),0 0 ${Math.round(px * 0.5)}px rgba(92,200,255,.55),0 2px 6px rgba(0,0,0,.45)}
      .lucky{background:linear-gradient(160deg,#ffe27a,#ffb300 60%,#e08a00);
        box-shadow:0 0 0 2px #fff,0 0 0 3.5px rgba(0,0,0,.3),0 0 ${Math.round(px * 0.6)}px rgba(255,190,40,.85),0 3px 8px rgba(0,0,0,.45)}
      @keyframes pop{from{transform:scale(.4);opacity:0}to{transform:none;opacity:1}}
      @media (prefers-reduced-motion:reduce){.m{animation:none}}
    </style><div class="s">${bits.join('')}</div>`;
  }

  globalThis.RoNoteMarks = { DIAMOND, CAT, isLucky, inline, INLINE_CSS, fill, rareTitle, luckyTitle };
})();
