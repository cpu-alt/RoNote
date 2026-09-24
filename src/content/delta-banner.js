/**
 * ==========================================================================
 *  LE BANDEAU DES ÉCARTS (RAP / Value)
 * --------------------------------------------------------------------------
 *  Le style du bandeau posé entre les deux offres sur la page des trades,
 *  partagé avec l'aperçu des réglages. Script classique : la page Roblox
 *  n'accepte pas les imports d'une extension.
 *
 *  Réglages lus :
 *    bannerGain   couleur d'un gain (#rrggbb)
 *    bannerLoss   couleur d'une perte
 *    bannerStyle  soft | vivid | neon | solid
 *    bannerSize   s | m | l
 *    bannerShow   both | value | rap
 *    bannerFormat full (+2,345) | short (+2.3K)
 *    bannerPct    le pourcentage entre parenthèses (true / false)
 * ==========================================================================
 */
(() => {
  if (globalThis.RoNoteBanner) return;

  const DEFAULTS = { gain: '#22e57a', loss: '#ff4d5e', style: 'soft', size: 'm', show: 'both', format: 'full', pct: true };
  const SHOWS = ['both', 'value', 'rap'];
  const STYLES = ['soft', 'vivid', 'neon', 'solid'];
  const SIZES = { s: { font: 12, h: 30, arrow: 11 }, m: { font: 14, h: 38, arrow: 14 }, l: { font: 16, h: 46, arrow: 16 } };

  const hex = (c, fallback) => /^#[0-9a-f]{6}$/i.test(c || '') ? c.toLowerCase() : fallback;
  const rgb = (c) => [1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16));
  const alpha = (c, a) => `rgba(${rgb(c).join(',')},${a})`;
  const mix = (c, to, k) => '#' + rgb(c).map((v, i) => Math.round(v + (to[i] - v) * k)
    .toString(16).padStart(2, '0')).join('');
  const light = (c) => { const [r, g, b] = rgb(c); return (r * 299 + g * 587 + b * 114) / 1000 > 150; };

  /** Réglages bruts -> options complètes et valides. */
  function normalize(settings = {}) {
    return {
      gain: hex(settings.bannerGain, DEFAULTS.gain),
      loss: hex(settings.bannerLoss, DEFAULTS.loss),
      style: STYLES.includes(settings.bannerStyle) ? settings.bannerStyle : DEFAULTS.style,
      size: SIZES[settings.bannerSize] ? settings.bannerSize : DEFAULTS.size,
      show: SHOWS.includes(settings.bannerShow) ? settings.bannerShow : DEFAULTS.show,
      format: settings.bannerFormat === 'short' ? 'short' : 'full',
      pct: settings.bannerPct !== false
    };
  }

  // Chiffres à l'anglaise, comme Roblox les écrit sur la page des trades.
  const full = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const short = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
  const sign = (n) => (n > 0 ? '+' : n < 0 ? '−' : '');

  /** Le texte d'une case : « +2,480 (+35%) », selon le format choisi. */
  function amount(delta, pct, settings) {
    const o = normalize(settings);
    const a = Math.abs(delta);
    const n = sign(delta) + (o.format === 'short' && a >= 1000 ? short.format(a) : full.format(a));
    if (!o.pct) return n;
    return `${n} (${pct === null || !Number.isFinite(pct) ? '—' : sign(Math.round(pct)) + Math.abs(Math.round(pct)) + '%'})`;
  }

  function tone(color, style) {
    const bright = mix(color, [255, 255, 255], 0.28);
    switch (style) {
      case 'soft': return {
        bg: `linear-gradient(180deg,${alpha(color, .16)},${alpha(color, .07)})`,
        border: alpha(color, .38), text: bright, arrow: color, glow: 'none', shadow: 'none' };
      case 'neon': return {
        bg: `linear-gradient(180deg,${alpha(color, .3)},${alpha(color, .12)})`,
        border: bright, text: bright, arrow: bright,
        glow: `0 0 0 1px ${color},0 0 22px ${alpha(color, .75)},inset 0 0 16px ${alpha(color, .45)}`,
        shadow: `0 0 10px ${alpha(color, .9)}` };
      case 'solid': {
        const ink = light(color) ? '#0d0f14' : '#fff';
        return {
          bg: `linear-gradient(180deg,${mix(color, [255, 255, 255], .12)},${mix(color, [0, 0, 0], .1)})`,
          border: mix(color, [255, 255, 255], .35), text: ink, arrow: ink,
          glow: `0 4px 14px ${alpha(color, .4)}`, shadow: 'none' };
      }
      default: return {                                   // vivid
        bg: `linear-gradient(180deg,${alpha(color, .58)},${alpha(color, .3)})`,
        border: bright, text: '#fff', arrow: '#fff',
        glow: `0 0 0 1px ${alpha(color, .35)},0 0 16px ${alpha(color, .5)}`, shadow: `0 1px 2px ${alpha('#000000', .45)}` };
    }
  }

  /** Feuille de style du shadow root du bandeau. */
  function css(settings) {
    const o = normalize(settings);
    const z = SIZES[o.size];
    const up = tone(o.gain, o.style), down = tone(o.loss, o.style);
    const cell = (sel, t) => `.cell[data-tone="${sel}"]{background:${t.bg};border-color:${t.border};color:${t.text};box-shadow:${t.glow};text-shadow:${t.shadow}}
      .cell[data-tone="${sel}"] .arrow{background:${t.arrow}}`;
    return `
      :host{color-scheme:dark;container-type:inline-size}*{box-sizing:border-box}
      .row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;font:650 ${z.font}px/1.4 "Builder Sans",Arial,sans-serif;color:#f4f5f7}
      .cell{position:relative;min-width:0;min-height:${z.h + 18}px;display:flex;align-items:center;justify-content:center;gap:8px;padding:23px 12px 9px;border-radius:12px;
        white-space:nowrap;font-variant-numeric:tabular-nums;letter-spacing:normal;
        background:linear-gradient(145deg,rgba(37,40,53,.97),rgba(24,26,36,.97));border:1px solid rgba(180,190,220,.16);
        box-shadow:inset 0 1px 0 rgba(255,255,255,.035),0 3px 10px rgba(0,0,0,.1);
        transition:background .2s ease,border-color .2s ease,color .2s ease,box-shadow .2s ease}
      .cell::before{content:attr(data-metric);position:absolute;top:7px;left:0;right:0;text-align:center;font-size:10px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;opacity:.65}
      .cell[data-tone="neutral"]{color:#c7cbd8}
      ${o.show === 'both' ? '' : `.row{grid-template-columns:1fr}.cell[data-metric="${o.show === 'value' ? 'RAP' : 'Value'}"]{display:none}`}
      ${cell('up', up)}
      ${cell('down', down)}
      .arrow{width:${z.arrow}px;height:${Math.round(z.arrow * 1.15)}px;flex:none;background:#8a91a0;
        clip-path:polygon(50% 0,100% 46%,69% 46%,69% 100%,31% 100%,31% 46%,0 46%)}
      .down{transform:rotate(180deg)}
      .flat{clip-path:none;width:10px;height:2px;border-radius:1px}
      @container(max-width:360px){.cell{font-size:${Math.max(11, z.font - 2)}px;gap:5px;padding:23px 6px 9px;white-space:normal;text-align:center}}
      @container(max-width:260px){.row{grid-template-columns:1fr;gap:6px}}
      @media(prefers-reduced-motion:reduce){.cell{transition:none}}`;
  }

  // `tone` sert aussi aux écarts des listes (content/list-look.js) : mêmes
  // styles, mêmes couleurs, un seul endroit où les définir.
  globalThis.RoNoteBanner = { DEFAULTS, STYLES, SIZES, normalize, css, tone, amount };
})();
