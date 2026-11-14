/**
 * ==========================================================================
 *  TRADE FLEX
 * --------------------------------------------------------------------------
 *  Une carte PNG du trade affiché, à partager. Dessinée localement sur un
 *  canvas, en 2× pour rester nette une fois partagée. Ni pseudo ni serial
 *  n'y figure, et une image de fond importée ne quitte jamais l'ordinateur.
 *
 *  Refaite le 14 nov. (MYd : « vieillot, pas très clean ni intuitif ») : une
 *  fenêtre en deux colonnes, l'aperçu en grand et les réglages à côté :
 *  format (carte complète ou compacte), fond (cinq thèmes ou son image,
 *  assombrie et floutée), résultat mis en avant, ce qu'on affiche, une
 *  légende à soi. Les réglages sont retenus (storage `flexPrefs`, le fond
 *  dans `flexBackground`). Copier, Télécharger, Partager (si le système sait).
 *
 *  Script classique : la page Roblox n'accepte pas les imports d'une
 *  extension. Seul point d'entrée : globalThis.RoNoteFlex.open(page, analysis).
 * ==========================================================================
 */
(() => {
  const fr = (document.documentElement.lang || navigator.language || '').startsWith('fr');
  const L = (a, b) => (fr ? a : b);
  const fmt = n => Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : 'N/A';
  const W = 1200, S = 2;                      // largeur logique, facteur de rendu
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  const TONES = { win: '#3ee6a0', loss: '#ff5c7a', even: '#a9b8d0' };
  const THEMES = {
    night: { from: '#0c1428', to: '#060a14', glow: '#3b82f6', name: L('Nuit', 'Night') },
    purple: { from: '#2b0f52', to: '#0e0720', glow: '#a855f7', name: L('Violet', 'Purple') },
    emerald: { from: '#062a21', to: '#03110d', glow: '#10b981', name: L('Émeraude', 'Emerald') },
    sunset: { from: '#3a1420', to: '#120812', glow: '#f97316', name: L('Coucher de soleil', 'Sunset') },
    carbon: { from: '#1c1c20', to: '#09090b', glow: '#a1a1aa', name: L('Carbone', 'Carbon') }
  };
  const DEFAULTS = { format: 'card', theme: 'night', metric: '', dim: 55, blur: 0, caption: '',
    show: { itemValues: true, compare: true, robux: true, date: true } };
  const store = globalThis.browser?.storage?.local || globalThis.chrome?.storage?.local;
  const load = async (keys) => { try { return (await store?.get(keys)) || {}; } catch { return {}; } };
  const save = (obj) => { try { store?.set(obj)?.catch?.(() => {}); } catch { /* aperçu sans extension */ } };

  let active = null, customBackground = null, backgroundLoaded = false;
  function close() { if (active) { active.close?.(); active?.remove(); active = null; } }

  /* ------------------------------ données ------------------------------- */

  /** Tout est figé avant d'attendre les vignettes : changer de trade ne mélange jamais deux offres. */
  function snapshot(page, analysis) {
    return ['give', 'get'].map(role => {
      const side = page.sides.find(s => s.role === role);
      if (!side) throw new Error('sides');
      const index = page.sides.indexOf(side);
      return {
        role, robux: side.robux || 0,
        rap: analysis?.[role]?.rap ?? side.rapTotal,
        value: analysis?.valueAvailable ? analysis?.[role]?.value : null,
        items: (side.items || []).map((item, i) => {
          const info = analysis?.pageItems?.[index]?.[i];
          return {
            name: item.name || 'Item', rap: item.rap,
            value: info?.value ?? (info?.noValue ? item.rap : null),
            projected: !!info?.projected,
            src: item.card?.querySelector('img:not([data-rn])')?.src
          };
        })
      };
    });
  }

  function loadImage(src) {
    return new Promise(resolve => {
      if (!src || !/^https:\/\/[^/]*rbxcdn\.com\//i.test(src)) return resolve(null);
      const img = new Image(); img.crossOrigin = 'anonymous';
      const timer = setTimeout(() => resolve(null), 2500);
      img.onload = () => { clearTimeout(timer); resolve(img); };
      img.onerror = () => { clearTimeout(timer); resolve(null); };
      img.src = src;
    });
  }

  function result(sides, field) {
    const a = sides[0][field], b = sides[1][field];
    const valid = Number.isFinite(a) && Number.isFinite(b);
    const delta = valid ? b - a : 0;
    const tone = !valid || delta === 0 ? 'even' : delta > 0 ? 'win' : 'loss';
    return {
      valid, delta, tone, color: TONES[tone],
      amount: valid ? (delta > 0 ? '+' : delta < 0 ? '−' : '') + fmt(Math.abs(delta)) : 'N/A',
      pct: valid && a > 0 ? (delta > 0 ? '+' : delta < 0 ? '−' : '') + Math.abs(delta / a * 100).toFixed(1) + '%' : 'N/A'
    };
  }

  /* ------------------------------- dessin ------------------------------- */

  const alpha = (hex, a) => {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
  };

  function painter(c) {
    const font = (size, weight = 600) => `${weight} ${size}px ${FONT}`;
    const spacing = (px) => { if ('letterSpacing' in c) c.letterSpacing = px + 'px'; };
    return {
      text(v, x, y, { size = 20, weight = 600, color = '#f3f6fc', align = 'left', track = 0 } = {}) {
        c.font = font(size, weight); c.fillStyle = color; c.textAlign = align; spacing(track);
        c.fillText(String(v), x, y); spacing(0); c.textAlign = 'left';
      },
      width(v, size, weight = 600) { c.font = font(size, weight); return c.measureText(String(v)).width; },
      fit(v, max, size, weight = 600) {
        c.font = font(size, weight);
        let s = String(v);
        if (c.measureText(s).width <= max) return s;
        while (s.length > 1 && c.measureText(s + '…').width > max) s = s.slice(0, -1);
        return s.trimEnd() + '…';
      },
      box(x, y, w, h, r, fill, stroke, lineWidth = 1) {
        c.beginPath(); c.roundRect(x, y, w, h, r);
        if (fill) { c.fillStyle = fill; c.fill(); }
        if (stroke) { c.strokeStyle = stroke; c.lineWidth = lineWidth; c.stroke(); }
      }
    };
  }

  /** Le logo de RoNote, redessiné : deux flèches opposées sur un carré sombre. */
  function logo(c, x, y, s) {
    const p = painter(c);
    p.box(x, y, s, s, s * .26, '#0f1728', 'rgba(255,255,255,.1)');
    c.lineCap = 'round'; c.lineWidth = s * .1;
    const arrow = (y0, from, to, color) => {
      c.strokeStyle = color; c.fillStyle = color;
      c.beginPath(); c.moveTo(x + s * from, y + s * y0); c.lineTo(x + s * to, y + s * y0); c.stroke();
      const dir = Math.sign(to - from), tip = x + s * (to + dir * .1);
      c.beginPath(); c.moveTo(tip, y + s * y0);
      c.lineTo(tip - dir * s * .2, y + s * (y0 - .13)); c.lineTo(tip - dir * s * .2, y + s * (y0 + .13)); c.fill();
    };
    arrow(.37, .22, .6, '#34d399');
    arrow(.63, .78, .4, '#38bdf8');
  }

  function projectedBadge(c, x, y) {
    const p = painter(c);
    p.box(x, y, 28, 28, 8, '#ffc400', 'rgba(255,255,255,.85)', 2);
    c.fillStyle = '#1a1200'; c.beginPath();
    c.moveTo(x + 14, y + 6); c.lineTo(x + 23, y + 22); c.lineTo(x + 5, y + 22); c.closePath(); c.fill();
    c.fillStyle = '#ffc400'; c.fillRect(x + 13, y + 11, 2, 6); c.fillRect(x + 13, y + 18.5, 2, 2);
  }

  const TILE_W = 256, TILE_H = 188, GAP = 16, PAD = 40, HEAD = 240;
  const panelHeight = (opts) => 24 + 30 + 18 + TILE_H + (opts.show.itemValues ? 78 : 50) + 58;
  const gaveLabel = (index) => index ? L('Tu as reçu', 'You received') : L('Tu as donné', 'You gave');

  /** Le fond (thème ou image importée, assombrie et floutée), les halos et le liseré du résultat. */
  function backdrop(c, p, H, opts, hero) {
    const theme = THEMES[opts.theme] || THEMES.night;
    const custom = opts.theme === 'custom' && customBackground;
    const bg = c.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, theme.from); bg.addColorStop(1, theme.to);
    c.fillStyle = bg; c.fillRect(0, 0, W, H);
    if (custom) {
      const img = customBackground, k = Math.max(W / img.width, H / img.height);
      // Flouter déborde des bords : on agrandit un peu l'image pour qu'ils restent pleins.
      const grow = opts.blur ? 1 + opts.blur / 100 : 1;
      if (opts.blur) c.filter = `blur(${opts.blur}px)`;
      c.drawImage(img, (W - img.width * k * grow) / 2, (H - img.height * k * grow) / 2, img.width * k * grow, img.height * k * grow);
      c.filter = 'none';
      c.fillStyle = `rgba(5,8,16,${opts.dim / 100})`; c.fillRect(0, 0, W, H);
    }
    const glow = (x, y, r, color, a) => {
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, alpha(color, a)); g.addColorStop(1, alpha(color, 0));
      c.fillStyle = g; c.fillRect(0, 0, W, H);
    };
    glow(W - 120, 60, 520, hero.color, custom ? .16 : .22);
    if (!custom) glow(80, H - 60, 560, theme.glow, .14);
    const edge = c.createLinearGradient(0, 0, 0, H);
    edge.addColorStop(0, alpha(hero.color, .9)); edge.addColorStop(.55, alpha(hero.color, .25)); edge.addColorStop(1, alpha(hero.color, .5));
    p.box(10, 10, W - 20, H - 20, 30, null, edge, 2);
    return !!custom;
  }

  /** L'en-tête commun : la marque, le verdict et sa légende, le pourcentage et l'écart. */
  function heading(c, p, opts, hero, { word = 88, pct = 84, base = 178 } = {}) {
    logo(c, PAD, 40, 40);
    p.text('RONOTE', PAD + 54, 58, { size: 15, weight: 800, color: '#e8eef8', track: 2.5 });
    p.text('TRADE FLEX', PAD + 54, 78, { size: 13, weight: 600, color: '#8795ad', track: 2 });
    const verdict = hero.valid ? { win: 'WIN', loss: 'LOSS', even: 'EVEN' }[hero.tone] : 'TRADE';
    c.save(); c.shadowColor = alpha(hero.color, .55); c.shadowBlur = 34;
    p.text(verdict, PAD - 3, base, { size: word, weight: 850, color: hero.color, track: -1 });
    c.restore();
    p.text(p.fit(opts.caption || L('Mon trade, en un regard', 'My trade at a glance'), W / 2 - PAD, 18, 500), PAD, base + 32, { size: 18, weight: 500, color: '#93a1b8' });
    const pctGrad = c.createLinearGradient(W - 480, base - 78, W - PAD, base + 2);
    pctGrad.addColorStop(0, hero.color); pctGrad.addColorStop(1, alpha('#ffffff', .92));
    c.save(); c.shadowColor = alpha(hero.color, .35); c.shadowBlur = 28;
    p.text(hero.pct, W - PAD, base - 10, { size: pct, weight: 850, color: pctGrad, align: 'right', track: -1 });
    c.restore();
    p.text(`${hero.amount} ${opts.metric === 'rap' ? 'RAP' : 'Value'}`, W - PAD, base + 28, { size: 24, weight: 700, color: '#f3f6fc', align: 'right' });
  }

  function footer(c, p, H, opts) {
    p.text(L("Cotes Rolimon's · pseudos et serials masqués", "Rolimon's values · names and serials hidden"),
      PAD, H - 38, { size: 15, weight: 500, color: '#7f8ca3' });
    if (opts.show.date) {
      const date = new Date().toLocaleDateString(fr ? 'fr-FR' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' });
      p.text(date, W - PAD, H - 38, { size: 15, weight: 600, color: '#7f8ca3', align: 'right' });
    }
  }

  function robuxPill(p, right, top, robux) {
    const label = `+ R$ ${fmt(robux)}`, lw = p.width(label, 15, 700) + 24;
    p.box(right - lw, top, lw, 30, 15, 'rgba(62,230,160,.12)', 'rgba(62,230,160,.35)');
    p.text(label, right - lw / 2, top + 20, { size: 15, weight: 700, color: '#7ff0c0', align: 'center' });
  }

  function draw(canvas, sides, images, opts) {
    const H = opts.format === 'compact' ? 640 : HEAD + 2 * panelHeight(opts) + (opts.show.compare ? 112 : 8) + 84;
    canvas.width = W * S; canvas.height = H * S;
    const c = canvas.getContext('2d');
    c.setTransform(S, 0, 0, S, 0, 0);
    const p = painter(c);
    const hero = result(sides, opts.metric);
    const custom = backdrop(c, p, H, opts, hero);
    if (opts.format === 'compact') {
      heading(c, p, opts, hero, { word: 76, pct: 72, base: 168 });
      let imageIndex = 0;
      sides.forEach((side, index) => { column(c, p, side, index, images, imageIndex, custom, opts); imageIndex += side.items.length; });
    } else {
      heading(c, p, opts, hero);
      let top = HEAD, imageIndex = 0;
      sides.forEach((side, index) => {
        panel(c, p, side, top, index, images, imageIndex, custom, opts);
        imageIndex += side.items.length;
        top += panelHeight(opts);
        if (index === 0) { if (opts.show.compare) { comparator(c, p, sides, top + 16); top += 112; } else top += 8; }
      });
    }
    footer(c, p, H, opts);
  }

  function panel(c, p, side, top, index, images, imageIndex, custom, opts) {
    const x = PAD - 8, w = W - 2 * (PAD - 8), h = panelHeight(opts) - 16;
    p.box(x, top, w, h, 24, custom ? 'rgba(8,12,22,.74)' : 'rgba(255,255,255,.035)', 'rgba(255,255,255,.08)');
    const inner = x + 24;
    p.box(inner, top + 28, 10, 10, 5, index ? '#3ee6a0' : '#ff8a5c');
    p.text(gaveLabel(index), inner + 20, top + 39, { size: 21, weight: 700 });
    p.text(`${side.items.length} ${side.items.length > 1 ? L('objets', 'items') : L('objet', 'item')}`,
      inner + 20 + p.width(gaveLabel(index), 21, 700) + 12, top + 39, { size: 15, weight: 500, color: '#7f8ca3' });
    if (side.robux && opts.show.robux) robuxPill(p, x + w - 24, top + 18, side.robux);

    const ty = top + 72;
    if (!side.items.length) {
      p.box(inner, ty, w - 48, TILE_H, 18, 'rgba(255,255,255,.03)', 'rgba(255,255,255,.06)');
      p.text(side.robux ? L('Robux seulement', 'Robux only') : L('Aucun objet', 'No items'),
        x + w / 2, ty + TILE_H / 2 + 7, { size: 20, weight: 600, color: '#7f8ca3', align: 'center' });
    }
    side.items.forEach((item, i) => {
      const tx = inner + i * (TILE_W + GAP);
      const g = c.createLinearGradient(0, ty, 0, ty + TILE_H);
      g.addColorStop(0, 'rgba(255,255,255,.09)'); g.addColorStop(1, 'rgba(255,255,255,.03)');
      p.box(tx, ty, TILE_W, TILE_H, 18, g, 'rgba(255,255,255,.07)');
      const img = images[imageIndex + i];
      if (img) {
        const k = Math.min(160 / img.width, 160 / img.height);
        c.save(); c.shadowColor = 'rgba(0,0,0,.45)'; c.shadowBlur = 18; c.shadowOffsetY = 8;
        c.drawImage(img, tx + (TILE_W - img.width * k) / 2, ty + (TILE_H - img.height * k) / 2, img.width * k, img.height * k);
        c.restore();
      } else {
        p.text('◆', tx + TILE_W / 2, ty + TILE_H / 2 + 14, { size: 40, color: '#5d6b85', align: 'center' });
      }
      if (item.projected) projectedBadge(c, tx + 10, ty + 10);
      p.text(p.fit(item.name, TILE_W - 4, 17, 700), tx + 2, ty + TILE_H + 28, { size: 17, weight: 700 });
      if (!opts.show.itemValues) return;
      p.text('RAP', tx + 2, ty + TILE_H + 56, { size: 13, weight: 700, color: '#7f8ca3', track: 1 });
      p.text(fmt(item.rap), tx + 38, ty + TILE_H + 56, { size: 16, weight: 600, color: '#c9d3e3' });
      const value = fmt(item.value);
      p.text(value, tx + TILE_W - 2, ty + TILE_H + 56, { size: 16, weight: 700, color: '#7cc4ff', align: 'right' });
      p.text('VALUE', tx + TILE_W - 10 - p.width(value, 16, 700), ty + TILE_H + 56, { size: 13, weight: 700, color: '#5c89b8', align: 'right', track: 1 });
    });

    // Totaux de l'offre, sur une barre à part.
    const fy = top + h - 50;
    p.box(inner, fy, w - 48, 36, 12, 'rgba(255,255,255,.04)');
    p.text('Total RAP', inner + 16, fy + 24, { size: 15, weight: 600, color: '#8795ad' });
    p.text(fmt(side.rap), inner + 16 + p.width('Total RAP', 15) + 10, fy + 24, { size: 16, weight: 700 });
    const val = fmt(side.value);
    p.text(val, x + w - 40, fy + 24, { size: 16, weight: 800, color: '#7cc4ff', align: 'right' });
    p.text('Total Value', x + w - 40 - p.width(val, 16, 800) - 10, fy + 24, { size: 15, weight: 600, color: '#8795ad', align: 'right' });
  }

  /** Format compact (1200 × 640, l'aperçu d'un lien) : deux colonnes, une ligne par objet. */
  function column(c, p, side, index, images, imageIndex, custom, opts) {
    const y = 236, h = 352, w = (W - 2 * PAD - 24) / 2, x = PAD + index * (w + 24);
    const field = opts.metric === 'rap' ? 'rap' : 'value', color = field === 'rap' ? '#c9d3e3' : '#7cc4ff';
    p.box(x, y, w, h, 22, custom ? 'rgba(8,12,22,.74)' : 'rgba(255,255,255,.035)', 'rgba(255,255,255,.08)');
    p.box(x + 22, y + 27, 10, 10, 5, index ? '#3ee6a0' : '#ff8a5c');
    p.text(gaveLabel(index), x + 42, y + 38, { size: 20, weight: 700 });
    if (side.robux && opts.show.robux) robuxPill(p, x + w - 20, y + 17, side.robux);
    if (!side.items.length) {
      p.text(side.robux ? L('Robux seulement', 'Robux only') : L('Aucun objet', 'No items'),
        x + w / 2, y + h / 2, { size: 19, weight: 600, color: '#7f8ca3', align: 'center' });
    }
    side.items.forEach((item, i) => {
      const ry = y + 62 + i * 52;
      p.box(x + 18, ry, 42, 42, 10, 'rgba(255,255,255,.07)');
      const img = images[imageIndex + i];
      if (img) { const k = Math.min(38 / img.width, 38 / img.height); c.drawImage(img, x + 39 - img.width * k / 2, ry + 21 - img.height * k / 2, img.width * k, img.height * k); }
      if (item.projected) p.box(x + 52, ry - 3, 12, 12, 6, '#ffc400', 'rgba(255,255,255,.85)', 1.5);
      const amount = opts.show.itemValues ? fmt(item[field]) : '';
      p.text(p.fit(item.name, w - 96 - (amount ? p.width(amount, 16, 700) + 16 : 0), 17, 650), x + 72, ry + 27, { size: 17, weight: 650 });
      if (amount) p.text(amount, x + w - 20, ry + 27, { size: 16, weight: 700, color, align: 'right' });
    });
    const fy = y + h - 52;
    p.box(x + 16, fy, w - 32, 36, 12, 'rgba(255,255,255,.05)');
    const label = field === 'rap' ? 'Total RAP' : 'Total Value', total = fmt(side[field]);
    p.text(label, x + 32, fy + 24, { size: 15, weight: 600, color: '#8795ad' });
    p.text(total, x + w - 32, fy + 24, { size: 17, weight: 800, color, align: 'right' });
  }

  /** Entre les deux offres : les deux écarts, de part et d'autre d'un rond ⇄. */
  function comparator(c, p, sides, y) {
    const mid = W / 2, h = 72, capW = 470;
    for (const [i, field] of ['rap', 'value'].entries()) {
      const r = result(sides, field);
      const x = i ? mid + 50 : mid - 50 - capW;
      p.box(x, y, capW, h, 20, alpha(r.color, .08), alpha(r.color, .45), 1.5);
      p.text(field === 'rap' ? 'RAP' : 'VALUE', x + 24, y + 30, { size: 13, weight: 800, color: alpha(r.color, .8), track: 2 });
      p.text(r.amount, x + 24, y + 58, { size: 26, weight: 800, color: r.color });
      p.text(r.pct, x + capW - 24, y + 50, { size: 22, weight: 700, color: r.color, align: 'right' });
    }
    p.box(mid - 30, y + h / 2 - 30, 60, 60, 30, '#111a2e', 'rgba(255,255,255,.14)', 1.5);
    c.strokeStyle = '#c9d3e3'; c.lineWidth = 3; c.lineCap = 'round'; c.lineJoin = 'round';
    const cy = y + h / 2;
    c.beginPath();
    c.moveTo(mid - 12, cy - 6); c.lineTo(mid + 12, cy - 6); c.moveTo(mid + 6, cy - 12); c.lineTo(mid + 12, cy - 6); c.lineTo(mid + 6, cy);
    c.moveTo(mid + 12, cy + 6); c.lineTo(mid - 12, cy + 6); c.moveTo(mid - 6, cy); c.lineTo(mid - 12, cy + 6); c.lineTo(mid - 6, cy + 12);
    c.stroke();
  }

  /* ------------------------------ fenêtre ------------------------------- */

  const CSS = `
    *{box-sizing:border-box}
    section{display:flex;flex-direction:column;max-height:94vh;font:13px/1.45 ${FONT};color:#e7e9ee}
    header{display:flex;align-items:center;gap:12px;padding:16px 20px;border-bottom:1px solid #1d2026}
    .logo{display:grid;place-items:center;width:34px;height:34px;border-radius:10px;background:#2a2410;color:#ffc94d;flex:none}
    .logo svg{width:19px;height:19px}
    .ttl{flex:1;min-width:0}.ttl b{display:block;font-size:16px}.ttl small{display:block;color:#8a909b;font-size:12px}
    button,input,label{font:inherit;color:inherit}
    button{cursor:pointer}
    :focus-visible{outline:2px solid #5aa2ff;outline-offset:2px}
    .x{display:grid;place-items:center;width:32px;height:32px;padding:0;border-radius:9px;border:1px solid #262a31;background:none;color:#9aa0aa}
    .x:hover{color:#fff;background:#191c22}.x svg{width:15px;height:15px}
    .wrap{display:grid;grid-template-columns:minmax(0,1fr) 300px;min-height:0;flex:1}
    .stage{display:flex;align-items:center;justify-content:center;min-height:0;padding:20px;overflow:auto;
      background:#08090c radial-gradient(circle at 50% 40%,#151821,#08090c 70%)}
    .stage img{display:block;max-width:100%;max-height:calc(94vh - 150px);border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.55)}
    .status{padding:80px 20px;text-align:center;color:#8a909b}
    aside{display:flex;flex-direction:column;min-height:0;border-left:1px solid #1d2026;background:#0f1115}
    .opts{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:18px}
    .grp{display:flex;flex-direction:column;gap:8px}
    h3{margin:0;font-size:11.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#8a909b}
    .seg{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:3px;padding:3px;border-radius:10px;background:#0b0c10;border:1px solid #1f2229}
    .seg button{padding:7px 4px;border-radius:7px;border:0;background:none;color:#aeb3bc;font-size:12.5px;white-space:nowrap}
    .seg button:hover{color:#fff}
    .seg button[aria-pressed="true"]{background:#23272f;color:#fff;font-weight:600;box-shadow:0 1px 2px rgba(0,0,0,.4)}
    .sw-row{display:flex;flex-wrap:wrap;gap:8px}
    .swatch{width:34px;height:34px;padding:0;border-radius:50%;border:2px solid transparent;box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}
    .swatch[aria-pressed="true"]{border-color:#fff}
    .swatch.img{display:grid;place-items:center;background:#191c22;color:#cfd3da;background-size:cover;background-position:center}
    .swatch.img svg{width:16px;height:16px}
    .range{display:grid;grid-template-columns:72px 1fr 34px;align-items:center;gap:8px;color:#aeb3bc;font-size:12px}
    .range output{text-align:right;color:#8a909b;font-variant-numeric:tabular-nums}
    input[type=range]{width:100%;accent-color:#3ee6a0}
    .links{display:flex;gap:12px}
    .link{padding:0;border:0;background:none;color:#8fb8ff;font-size:12px;text-decoration:underline;cursor:pointer;position:relative;overflow:hidden}
    .link input{position:absolute;inset:0;opacity:0;cursor:pointer}
    .sw{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12.5px;cursor:pointer}
    .sw[aria-disabled="true"]{opacity:.45}
    .sw input{appearance:none;position:relative;width:34px;height:20px;margin:0;border-radius:99px;background:#2a2e36;cursor:pointer;flex:none;transition:background .15s}
    .sw input::after{content:"";position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:50%;background:#cfd3da;transition:transform .15s}
    .sw input:checked{background:#2f9e5a}.sw input:checked::after{transform:translateX(14px);background:#fff}
    .txt{width:100%;padding:8px 10px;border-radius:9px;border:1px solid #262a31;background:#0b0c10;color:#e7e9ee}
    .txt:focus{outline:none;border-color:#5aa2ff}
    .acts{display:flex;flex-direction:column;gap:8px;padding:14px 16px;border-top:1px solid #1d2026}
    .row{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:8px}
    .btn{display:flex;align-items:center;justify-content:center;gap:7px;padding:9px;border-radius:10px;border:1px solid #262a31;background:#191c22;font-size:12.5px;text-decoration:none}
    .btn:hover{background:#20242b}.btn svg{width:15px;height:15px}
    .primary{border:0;background:#2f9e5a;color:#fff;font-weight:700;padding:11px}
    .primary:hover{background:#36ad64}
    .msg{min-height:1.2em;margin:0;font-size:12px;text-align:center;color:#8a909b}.msg.err{color:#ff9aae}.msg.ok{color:#3fcf6e}
    .hint{margin:0;font-size:11.5px;color:#666c77;text-align:center}
    [hidden]{display:none!important}
    @media(max-width:820px){.wrap{grid-template-columns:1fr;overflow-y:auto}aside{border-left:0;border-top:1px solid #1d2026}.stage img{max-height:55vh}}
    @media(prefers-reduced-motion:reduce){.sw input,.sw input::after{transition:none}}`;

  const icon = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;
  const ICON_TROPHY = icon('<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>');
  const ICON_X = icon('<path d="M6 6l12 12M18 6L6 18"/>', ' stroke-width="2.4"');
  const ICON_IMAGE = icon('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>');
  const ICON_SAVE = icon('<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>');
  const ICON_COPY = icon('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>');
  const ICON_SHARE = icon('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>');

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'html') node.innerHTML = v;
      else if (k === 'class') node.className = v;
      else if (k.startsWith('aria-') || k.startsWith('data-') || ['type', 'accept', 'for', 'role'].includes(k)) node.setAttribute(k, v);
      else node[k] = v;
    }
    node.append(...children);
    return node;
  }

  function segmented(label, options, value, onChange) {
    const seg = el('div', { class: 'seg', role: 'group', 'aria-label': label });
    const buttons = options.map(([key, text]) => {
      const b = el('button', { type: 'button', textContent: text, 'aria-pressed': String(key === value) });
      b.onclick = () => { for (const o of buttons) o.setAttribute('aria-pressed', String(o === b)); onChange(key); };
      return b;
    });
    seg.append(...buttons);
    return seg;
  }

  const group = (title, ...children) => el('div', { class: 'grp' }, [el('h3', { textContent: title }), ...children]);

  /** Une image (fichier ou dataURL) réduite à `max` px, dans un canvas : seule cette copie reste en mémoire. */
  async function shrinkImage(src, max) {
    const img = new Image(); img.src = src; await img.decode();
    const scaled = document.createElement('canvas'), k = Math.min(1, max / Math.max(img.width, img.height));
    scaled.width = Math.max(1, Math.round(img.width * k)); scaled.height = Math.max(1, Math.round(img.height * k));
    scaled.getContext('2d').drawImage(img, 0, 0, scaled.width, scaled.height);
    return scaled;
  }

  async function open(page, analysis) {
    close();
    const dialog = document.createElement('dialog');
    dialog.dataset.rn = 'flex';
    dialog.style.cssText = 'padding:0;border:1px solid rgba(255,255,255,.1);border-radius:20px;background:#0f1115;color:#e7e9ee;width:min(1180px,96vw);max-height:94vh;overflow:hidden;box-shadow:0 40px 120px rgba(0,0,0,.6);';
    const container = document.createElement('div'); dialog.append(container);
    const root = container.attachShadow({ mode: 'closed' });
    const dismiss = el('button', { type: 'button', class: 'x', html: ICON_X, 'aria-label': L('Fermer', 'Close'), title: L('Fermer (Échap)', 'Close (Esc)') });
    dismiss.onclick = close;
    const header = el('header', {}, [el('span', { class: 'logo', html: ICON_TROPHY }),
      el('div', { class: 'ttl' }, [el('b', { textContent: 'Trade Flex' }), el('small', { textContent: L('Une image de ton trade, prête à partager', 'An image of your trade, ready to share') })]), dismiss]);
    const status = el('div', { class: 'status', textContent: L('Création de ton image…', 'Creating your image…') });
    const stage = el('div', { class: 'stage' }, [status]);
    const wrap = el('div', { class: 'wrap' }, [stage]);
    root.append(el('style', { textContent: CSS }), el('section', {}, [header, wrap]));
    document.body.append(dialog); active = dialog;
    dialog.addEventListener('close', () => { dialog.remove(); if (active === dialog) active = null; });
    dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
    dialog.showModal();

    let sides;
    try { sides = snapshot(page, analysis); }
    catch { status.textContent = L('Impossible de créer la carte. Attends que les deux offres soient chargées, puis réessaie.', 'Could not create the card. Wait for both offers to load and try again.'); return; }

    const [images, stored] = await Promise.all([
      Promise.all(sides.flatMap(s => s.items).map(i => loadImage(i.src))),
      load(['flexPrefs', 'flexBackground'])
    ]);
    if (active !== dialog) return;
    if (!backgroundLoaded && stored.flexBackground) customBackground = await shrinkImage(stored.flexBackground, 2400).catch(() => null);
    backgroundLoaded = true;
    if (active !== dialog) return;

    const hasValue = Number.isFinite(sides[0].value) && Number.isFinite(sides[1].value);
    const prefs = stored.flexPrefs || {};
    const opts = { ...DEFAULTS, ...prefs, show: { ...DEFAULTS.show, ...prefs.show } };
    if (!THEMES[opts.theme] && !(opts.theme === 'custom' && customBackground)) opts.theme = 'night';
    if (!hasValue || !opts.metric) opts.metric = hasValue ? 'value' : 'rap';
    const remember = () => save({ flexPrefs: { format: opts.format, theme: opts.theme, metric: opts.metric, dim: opts.dim, blur: opts.blur, caption: opts.caption, show: opts.show } });

    const canvas = document.createElement('canvas');
    const image = el('img', { alt: L('Carte récapitulative du trade', 'Trade summary card') });
    status.replaceWith(image);
    const msg = el('p', { class: 'msg', role: 'status', 'aria-live': 'polite' });
    const say = (text, tone = '') => { msg.textContent = text; msg.className = 'msg' + (tone ? ' ' + tone : ''); };

    // Format
    const formatSeg = segmented(L('Format', 'Format'), [['card', L('Complète', 'Full')], ['compact', L('Compacte', 'Compact')]], opts.format,
      key => { opts.format = key; sync(); });

    // Fond : les thèmes en pastilles, puis « Mon image » avec ses réglages.
    const file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': L('Importer un fond', 'Import a background') });
    const swatches = Object.entries(THEMES).map(([key, t]) => {
      const b = el('button', { type: 'button', class: 'swatch', title: t.name, 'aria-label': t.name, 'data-theme': key });
      b.style.background = `linear-gradient(135deg,${t.glow},${t.from} 55%,${t.to})`;
      b.onclick = () => { opts.theme = key; sync(); };
      return b;
    });
    const imgSwatch = el('button', { type: 'button', class: 'swatch img', html: ICON_IMAGE, title: L('Mon image', 'My image'), 'aria-label': L('Mon image', 'My image'), 'data-theme': 'custom' });
    imgSwatch.onclick = () => { if (!customBackground) { file.click(); return; } opts.theme = 'custom'; sync(); };
    const range = (label, key, min, max) => {
      const input = el('input', { type: 'range', min, max, value: opts[key], 'aria-label': label });
      const out = el('output', { textContent: opts[key] });
      input.oninput = () => { opts[key] = Number(input.value); out.textContent = input.value; sync(); };
      return el('label', { class: 'range' }, [el('span', { textContent: label }), input, out]);
    };
    const dimRange = range(L('Assombrir', 'Dim'), 'dim', 20, 85);
    const blurRange = range(L('Flou', 'Blur'), 'blur', 0, 20);
    const remove = el('button', { type: 'button', class: 'link', textContent: L('Retirer', 'Remove') });
    /** La pastille « Mon image » montre l'image (une petite copie, faite une fois par import). */
    const paintImgSwatch = () => {
      imgSwatch.style.backgroundImage = customBackground ? `url(${customBackground.toDataURL('image/jpeg', .5)})` : '';
      imgSwatch.innerHTML = customBackground ? '' : ICON_IMAGE;
    };
    remove.onclick = () => { customBackground = null; save({ flexBackground: '' }); opts.theme = 'night'; paintImgSwatch(); sync(); };
    const change = el('label', { class: 'link' }, [L('Changer…', 'Change…'), file]);
    const custom = el('div', { class: 'grp' }, [dimRange, blurRange, el('div', { class: 'links' }, [change, remove])]);

    // Résultat mis en avant
    const metricSeg = segmented(L('Résultat mis en avant', 'Featured result'), [['value', 'Value'], ['rap', 'RAP']], opts.metric,
      key => { opts.metric = key; sync(); });
    if (!hasValue) metricSeg.firstElementChild.disabled = true;

    // Afficher
    const toggle = (key, label) => {
      const input = el('input', { type: 'checkbox' }); input.checked = !!opts.show[key];
      input.onchange = () => { opts.show[key] = input.checked; sync(); };
      return el('label', { class: 'sw', 'data-key': key }, [label, input]);
    };
    const toggles = [toggle('itemValues', L('Montant de chaque objet', 'Amount of each item')), toggle('compare', L('Comparateur RAP / Value', 'RAP / Value comparison')),
      toggle('robux', 'Robux'), toggle('date', L('Date', 'Date'))];

    // Légende
    const caption = el('input', { class: 'txt', type: 'text', value: opts.caption, maxLength: 60, placeholder: L('Mon trade, en un regard', 'My trade at a glance'), 'aria-label': L('Légende', 'Caption') });
    caption.oninput = () => { opts.caption = caption.value.trim(); sync(); };

    // Actions
    const blob = () => new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('blob')), 'image/png'));
    const fileName = () => `ronote-trade-flex-${new Date().toISOString().slice(0, 10)}.png`;
    const download = el('a', { class: 'btn primary', html: ICON_SAVE + `<span>${L('Télécharger', 'Download')}</span>`, role: 'button' });
    download.onclick = () => { download.download = fileName(); say(L('Image enregistrée dans tes téléchargements.', 'Image saved to your downloads.'), 'ok'); };
    const copy = el('button', { type: 'button', class: 'btn', html: ICON_COPY + `<span>${L('Copier', 'Copy')}</span>` });
    copy.onclick = async () => {
      try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': await blob() })]); say(L('Image copiée : colle-la dans Discord.', 'Image copied: paste it into Discord.'), 'ok'); }
      catch { say(L("Copie refusée par le navigateur : clic droit sur l'image → Copier l'image.", 'The browser refused the copy: right-click the image → Copy image.'), 'err'); }
    };
    const probe = typeof File === 'function' ? new File([''], 'x.png', { type: 'image/png' }) : null;
    const share = el('button', { type: 'button', class: 'btn', html: ICON_SHARE + `<span>${L('Partager', 'Share')}</span>` });
    share.hidden = !(probe && navigator.canShare?.({ files: [probe] }));
    share.onclick = async () => {
      try { await navigator.share({ files: [new File([await blob()], fileName(), { type: 'image/png' })], title: 'Trade Flex' }); say(''); }
      catch (e) { if (e?.name !== 'AbortError') say(L('Partage impossible.', 'Could not share.'), 'err'); }
    };

    const aside = el('aside', {}, [
      el('div', { class: 'opts' }, [
        group(L('Format', 'Format'), formatSeg),
        group(L('Fond', 'Background'), el('div', { class: 'sw-row', role: 'group', 'aria-label': L('Fond', 'Background') }, [...swatches, imgSwatch]), custom),
        group(L('Résultat mis en avant', 'Featured result'), metricSeg),
        group(L('Afficher', 'Show'), ...toggles),
        group(L('Légende', 'Caption'), caption)
      ]),
      el('div', { class: 'acts' }, [download, el('div', { class: 'row' }, [copy, share]), msg,
        el('p', { class: 'hint', textContent: L('Pseudos et serials ne figurent jamais sur la carte. Ton image reste sur ton ordinateur.', 'Names and serials never appear on the card. Your image stays on your computer.') })])
    ]);
    wrap.append(aside);

    let frame;
    const render = () => {
      draw(canvas, sides, images, opts);
      image.src = canvas.toDataURL('image/png');
      download.href = image.src;
    };
    /** L'état des réglages suit `opts`, puis la carte est redessinée à la prochaine image et les choix retenus. */
    function sync() {
      for (const b of [...swatches, imgSwatch]) b.setAttribute('aria-pressed', String(b.dataset.theme === opts.theme));
      custom.hidden = opts.theme !== 'custom';
      for (const t of toggles) if (t.dataset.key === 'compare') {
        const off = opts.format === 'compact';
        t.setAttribute('aria-disabled', String(off)); t.querySelector('input').disabled = off;
      }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { if (active === dialog) render(); });
      remember();
    }

    let importId = 0;
    file.onchange = async () => {
      const selected = file.files[0], id = ++importId;
      if (!selected) return;
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(selected.type) || selected.size > 15 * 1024 * 1024) {
        say(L('Choisis un PNG, JPEG ou WebP de moins de 15 Mo.', 'Choose a PNG, JPEG or WebP under 15 MB.'), 'err');
        return;
      }
      const url = URL.createObjectURL(selected);
      try {
        const scaled = await shrinkImage(url, 2400);
        if (active !== dialog || id !== importId) return;
        customBackground = scaled;
        // Retenue pour la prochaine fois, plus petite : rien n'est envoyé nulle part.
        save({ flexBackground: (await shrinkImage(scaled.toDataURL('image/jpeg', .9), 1600)).toDataURL('image/jpeg', .85) });
        opts.theme = 'custom'; say(''); paintImgSwatch(); sync();
      } catch {
        say(L('Cette image ne peut pas être chargée.', 'This image could not be loaded.'), 'err');
      } finally { URL.revokeObjectURL(url); file.value = ''; }
    };

    // Raccourcis : Ctrl+S télécharge, Ctrl+C copie (hors du champ de légende). Échap ferme (la boîte de dialogue).
    dialog.addEventListener('keydown', e => {
      if (!(e.ctrlKey || e.metaKey) || e.composedPath()[0] === caption) return;
      if (e.key === 's') { e.preventDefault(); download.click(); }
      else if (e.key === 'c') { e.preventDefault(); copy.click(); }
    });

    paintImgSwatch();
    sync();
    render();
    download.focus();
  }

  globalThis.RoNoteFlex = { open, close };
})();
