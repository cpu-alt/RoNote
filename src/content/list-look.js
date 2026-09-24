/**
 * ==========================================================================
 *  L'APPARENCE DES ÉCARTS SUR LES LISTES DE TRADES
 * --------------------------------------------------------------------------
 *  Partagée entre la page Roblox (content/trade-list.js, qui s'occupe de
 *  trouver les lignes et de placer la colonne) et l'aperçu des réglages :
 *  ce qu'on voit dans les réglages est ce qu'on aura sur la page. Script
 *  classique : la page Roblox n'accepte pas les imports d'une extension.
 *
 *  Les styles (Discret, Vif, Néon, Plein) sont ceux du bandeau des écarts,
 *  pris dans content/delta-banner.js ; « Sobre » est le texte seul, dans la
 *  police de la ligne.
 *
 *  Réglages lus :
 *    listShow    both | value | rap
 *    listFormat  full | short | pct
 *    listStyle   text | soft | vivid | neon | solid
 *    listSize    s | m | l
 *    listLabels  les libellés « RAP » / « Value » devant les chiffres
 *    listGain, listLoss       couleurs propres ; vides = celles du bandeau
 *    bannerGain, bannerLoss   les couleurs du bandeau
 * ==========================================================================
 */
(() => {
  if (globalThis.RoNoteListLook) return;

  const SHOWS = ['both', 'value', 'rap'];
  const FORMATS = ['full', 'short', 'pct'];
  const STYLES = ['text', 'soft', 'vivid', 'neon', 'solid'];
  const SIZES = { s: 0.9, m: 1, l: 1.15 };
  const DEFAULTS = { listShow: 'both', listFormat: 'full', listStyle: 'text', listSize: 'm',
    listLabels: true, listGain: '', listLoss: '' };
  const pick = (v, list, d) => (list.includes(v) ? v : d);
  const hex = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c.toLowerCase() : '');

  function normalize(st = {}) {
    const b = globalThis.RoNoteBanner?.normalize(st);
    return {
      gain: hex(st.listGain) || b?.gain || '#22e57a',
      loss: hex(st.listLoss) || b?.loss || '#ff4d5e',
      ownColors: !!(hex(st.listGain) || hex(st.listLoss)),
      labels: st.listLabels !== false,
      show: pick(st.listShow, SHOWS, 'both'),
      format: pick(st.listFormat, FORMATS, 'full'),
      style: pick(st.listStyle, STYLES, 'text'),
      size: SIZES[st.listSize] ? st.listSize : 'm'
    };
  }

  // Chiffres groupés comme Roblox les écrit sur la même page (« 5 121 »,
  // voir content/trade-delta.js).
  const fr = (document.documentElement.lang || navigator.language || '').toLowerCase().startsWith('fr');
  const locale = fr ? 'fr-FR' : 'en-US';
  const grouped = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const pct1 = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const sign = (n) => (n > 0 ? '+' : n < 0 ? '−' : '');

  function money(n, compact) {
    const a = Math.abs(n);
    const s = !compact ? grouped.format(Math.round(a))
      : a >= 1e6 ? (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M'
      : a >= 1e3 ? (a / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k'
      : String(Math.round(a));
    return sign(n) + s;
  }

  /** L'écart rapporté à ce que tu donnes (analysis.js, `pctRap` / `pctValue`). */
  function percent(p) {
    const a = Math.abs(p);
    return sign(p) + (a < 10 ? pct1 : grouped).format(a) + (fr ? ' %' : '%');
  }

  /** La couleur du signe, en texte seul ou en pastille selon le style. */
  function paint(el, n, o) {
    const color = n > 0 ? o.gain : n < 0 ? o.loss : null;
    if (!color) return;
    if (o.style === 'text' || !globalThis.RoNoteBanner?.tone) { el.style.color = color; return; }
    const t = globalThis.RoNoteBanner.tone(color, o.style);
    Object.assign(el.style, {
      background: t.bg, color: t.text, borderColor: t.border, boxShadow: t.glow, textShadow: t.shadow
    });
  }

  function line(label, n, p, o) {
    const row = document.createElement('div');
    row.className = 'ronote-lb-line';
    const v = document.createElement('span');
    v.className = 'ronote-lb-val';
    if (Number.isFinite(n)) {
      v.dataset.n = String(n);
      if (Number.isFinite(p)) v.dataset.p = String(p);
      paint(v, n, o);
    } else {
      v.textContent = '—';
    }
    // Sans libellé, la ligne le garde en infobulle.
    if (o.labels) {
      const l = document.createElement('span');
      l.textContent = label;
      row.append(l);
    } else row.title = label;
    row.append(v);
    return row;
  }

  /** Écris (ou réécris) les chiffres : `compact` force la forme courte en Robux. */
  function write(col, o, compact = o.format === 'short') {
    for (const v of col.querySelectorAll('[data-n]')) {
      v.textContent = o.format === 'pct' && v.dataset.p
        ? percent(Number(v.dataset.p))
        : money(Number(v.dataset.n), compact);
    }
  }

  /**
   * La colonne d'un trade. Un trade dont un objet n'a pas de cote n'affiche
   * pas de Value : un total partiel passerait pour un vrai.
   *
   * @param a  l'analyse du trade (analysis.js) ou null
   */
  function build(a, o) {
    const col = document.createElement('div');
    col.className = 'ronote-lb';
    col.dataset.style = o.style;
    const valued = a && !a.incomplete;
    if (o.show !== 'value') col.append(line('RAP', a?.deltaRap, a?.pctRap, o));
    if (o.show !== 'rap') col.append(line('Value', valued ? a.deltaValue : null, valued ? a.pctValue : null, o));
    write(col, o);
    return col;
  }

  // Aucune police ni taille fixées ici : la colonne les reprend de la ligne
  // qui l'accueille. Les pastilles gardent leur bordure transparente en style
  // Sobre pour que changer de style ne décale rien.
  const CSS = `
    .ronote-lb{display:flex;flex-direction:column;align-items:flex-end;white-space:nowrap}
    .ronote-lb-line{display:flex;align-items:center;justify-content:flex-end;gap:.4em}
    .ronote-lb-val{font-weight:700;font-size:1.1em;font-variant-numeric:tabular-nums}
    .ronote-lb:not([data-style="text"]){gap:3px}
    .ronote-lb:not([data-style="text"]) .ronote-lb-val{padding:.1em .45em;border-radius:.45em;border:1px solid transparent;line-height:1.15}
  `;

  globalThis.RoNoteListLook = { DEFAULTS, STYLES, SIZES, normalize, build, write, CSS };
})();
