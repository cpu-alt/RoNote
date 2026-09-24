/**
 * ==========================================================================
 *  LE BADGE « PROJECTED »
 * --------------------------------------------------------------------------
 *  Un seul dessin pour deux endroits : le coin des objets sur la page des
 *  trades Roblox, et l'aperçu dans les réglages. Script classique (pas de
 *  module) : la page Roblox n'accepte pas les imports d'une extension.
 *
 *  Réglages lus :
 *    projectedColor  couleur de fond (#rrggbb), jaune vif par défaut
 *    projectedSize   s | m | l
 *    projectedShape  rounded | circle | square
 *    projectedIcon   (clé de stockage à part) image importée, en data: URL —
 *                    elle remplace le triangle
 * ==========================================================================
 */
(() => {
  if (globalThis.RoNoteBadge) return;

  const DEFAULT_COLOR = '#ffc400';
  const SIZES = { s: 20, m: 26, l: 34 };
  const SHAPES = { rounded: 0.3, circle: 0.5, square: 0.12 };

  const hex = (c) => /^#[0-9a-f]{6}$/i.test(c || '') ? c.toLowerCase() : DEFAULT_COLOR;
  const rgb = (c) => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
  const mix = (c, to, k) => '#' + rgb(c).map((v, i) => Math.round(v + (to[i] - v) * k)
    .toString(16).padStart(2, '0')).join('');
  // Luminance perçue : un fond clair veut un triangle sombre, et inversement.
  const light = (c) => { const [r, g, b] = rgb(c); return (r * 299 + g * 587 + b * 114) / 1000 > 150; };

  const TRIANGLE = (ink) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8 1.6 21h20.8L12 2.8z" fill="${ink}" fill-opacity=".14" stroke="${ink}" stroke-width="2.4" stroke-linejoin="round"/><path d="M12 9.6v5.2" stroke="${ink}" stroke-width="2.6" stroke-linecap="round"/><circle cx="12" cy="18" r="1.45" fill="${ink}"/></svg>`;

  /**
   * Le contenu d'un shadow root : style + badge.
   * @param {{color?: string, size?: string, shape?: string, image?: string}} opts
   */
  function html(opts = {}) {
    const color = hex(opts.color);
    const px = SIZES[opts.size] || SIZES.m;
    const image = typeof opts.image === 'string' && /^data:image\/(png|jpeg|gif|webp);base64,/.test(opts.image)
      ? opts.image : '';
    const ink = light(color) ? '#1a1200' : '#ffffff';
    const top = mix(color, [255, 255, 255], 0.35);
    const deep = mix(color, [0, 0, 0], 0.18);
    const radius = Math.round(px * (SHAPES[opts.shape] ?? SHAPES.rounded));
    const style = `
      :host{all:initial}
      .b{box-sizing:border-box;width:${px}px;height:${px}px;border-radius:${radius}px;display:grid;place-items:center;
        overflow:hidden;cursor:help;
        background:${image ? '#0000' : `linear-gradient(160deg,${top},${color} 55%,${deep})`};
        box-shadow:0 0 0 2px #fff,0 0 0 3.5px rgba(0,0,0,.35),0 0 ${Math.round(px * 0.55)}px ${color}cc,0 3px 8px rgba(0,0,0,.5);
        animation:pop .28s cubic-bezier(.3,1.6,.5,1) both}
      .b svg{width:${Math.round(px * 0.66)}px;height:${Math.round(px * 0.66)}px;filter:drop-shadow(0 1px 0 ${light(color) ? '#fff6' : '#0006'})}
      .b img{width:100%;height:100%;object-fit:cover;display:block}
      @keyframes pop{from{transform:scale(.4);opacity:0}to{transform:none;opacity:1}}
      @media (prefers-reduced-motion:reduce){.b{animation:none}}`;
    const body = image ? `<img alt="" src="${image}">` : TRIANGLE(ink);
    return { style, body, px };
  }

  function fill(root, opts, title = '') {
    const { style, body } = html(opts);
    root.innerHTML = `<style>${style}</style><div class="b"${title ? ` title="${title.replace(/"/g, '&quot;')}"` : ''}>${body}</div>`;
  }

  globalThis.RoNoteBadge = { DEFAULT_COLOR, SIZES, SHAPES, html, fill };
})();
