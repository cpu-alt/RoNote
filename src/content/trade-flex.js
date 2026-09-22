/**
 * ==========================================================================
 *  TRADE FLEX
 * --------------------------------------------------------------------------
 *  Une carte PNG du trade affiché, à partager. Dessinée localement sur un
 *  canvas, en 2× pour rester nette une fois partagée. Ni pseudo ni serial
 *  n'y figure, et une image de fond importée ne quitte jamais l'ordinateur.
 *
 *  Script classique : la page Roblox n'accepte pas les imports d'une
 *  extension. Seul point d'entrée : globalThis.RoNoteFlex.open(page, analysis).
 * ==========================================================================
 */
(() => {
  const fr = (document.documentElement.lang || navigator.language || '').startsWith('fr');
  const L = (a, b) => (fr ? a : b);
  const fmt = n => Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '—';
  const W = 1200, S = 2;                      // largeur logique, facteur de rendu
  const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  const TONES = { win: '#3ee6a0', loss: '#ff5c7a', even: '#a9b8d0' };
  const THEMES = {
    night: { from: '#0c1428', to: '#060a14', glow: '#3b82f6' },
    purple: { from: '#2b0f52', to: '#0e0720', glow: '#a855f7' }
  };

  let active = null, customBackground = null;
  function close() { if (active) { active.remove(); active = null; } }

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
      amount: valid ? (delta > 0 ? '+' : delta < 0 ? '−' : '') + fmt(Math.abs(delta)) : '—',
      pct: valid && a > 0 ? (delta > 0 ? '+' : delta < 0 ? '−' : '') + Math.abs(delta / a * 100).toFixed(1) + '%' : '—'
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
  const PANEL_H = 24 + 30 + 18 + TILE_H + 78 + 58;

  function draw(canvas, sides, images, opts) {
    const H = HEAD + PANEL_H + 112 + PANEL_H + 84;
    canvas.width = W * S; canvas.height = H * S;
    const c = canvas.getContext('2d');
    c.setTransform(S, 0, 0, S, 0, 0);
    const p = painter(c);
    const hero = result(sides, opts.metric);
    const theme = THEMES[opts.theme] || THEMES.night;
    const custom = opts.theme === 'custom' && customBackground;

    // Fond : dégradé du thème, ou l'image importée assombrie.
    const bg = c.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, theme.from); bg.addColorStop(1, theme.to);
    c.fillStyle = bg; c.fillRect(0, 0, W, H);
    if (custom) {
      const img = customBackground, k = Math.max(W / img.width, H / img.height);
      c.drawImage(img, (W - img.width * k) / 2, (H - img.height * k) / 2, img.width * k, img.height * k);
      c.fillStyle = `rgba(5,8,16,${opts.dim / 100})`; c.fillRect(0, 0, W, H);
    }
    const glow = (x, y, r, color, a) => {
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, alpha(color, a)); g.addColorStop(1, alpha(color, 0));
      c.fillStyle = g; c.fillRect(0, 0, W, H);
    };
    glow(W - 120, 60, 520, hero.color, custom ? .16 : .22);
    if (!custom) glow(80, H - 60, 560, theme.glow, .14);

    // Liseré de la couleur du résultat, fondu vers le bas.
    const edge = c.createLinearGradient(0, 0, 0, H);
    edge.addColorStop(0, alpha(hero.color, .9)); edge.addColorStop(.55, alpha(hero.color, .25)); edge.addColorStop(1, alpha(hero.color, .5));
    p.box(10, 10, W - 20, H - 20, 30, null, edge, 2);

    // En-tête : marque, verdict, pourcentage.
    logo(c, PAD, 40, 40);
    p.text('RONOTE', PAD + 54, 58, { size: 15, weight: 800, color: '#e8eef8', track: 2.5 });
    p.text('TRADE FLEX', PAD + 54, 78, { size: 13, weight: 600, color: '#8795ad', track: 2 });

    const word = hero.valid ? { win: 'WIN', loss: 'LOSS', even: 'EVEN' }[hero.tone] : 'TRADE';
    c.save(); c.shadowColor = alpha(hero.color, .55); c.shadowBlur = 34;
    p.text(word, PAD - 3, 178, { size: 88, weight: 850, color: hero.color, track: -1 });
    c.restore();
    p.text(L('Mon trade, en un regard', 'My trade at a glance'), PAD, 210, { size: 18, weight: 500, color: '#93a1b8' });

    const pctGrad = c.createLinearGradient(W - 480, 100, W - PAD, 180);
    pctGrad.addColorStop(0, hero.color); pctGrad.addColorStop(1, alpha('#ffffff', .92));
    c.save(); c.shadowColor = alpha(hero.color, .35); c.shadowBlur = 28;
    p.text(hero.pct, W - PAD, 168, { size: 84, weight: 850, color: pctGrad, align: 'right', track: -1 });
    c.restore();
    p.text(`${hero.amount} ${opts.metric === 'rap' ? 'RAP' : 'Value'}`, W - PAD, 206, { size: 24, weight: 700, color: '#f3f6fc', align: 'right' });

    // Les deux offres, et le comparateur entre elles.
    let top = HEAD, imageIndex = 0;
    sides.forEach((side, index) => {
      panel(c, p, side, top, index, images, imageIndex, custom);
      imageIndex += side.items.length;
      top += PANEL_H;
      if (index === 0) { comparator(c, p, sides, top + 16); top += 112; }
    });

    // Pied : ce que montre la carte, et ce qu'elle cache.
    const date = new Date().toLocaleDateString(fr ? 'fr-FR' : 'en-US', { day: 'numeric', month: 'short', year: 'numeric' });
    p.text(L("Cotes Rolimon's · Robux inclus · pseudos et serials masqués", "Rolimon's values · Robux included · names and serials hidden"),
      PAD, H - 38, { size: 15, weight: 500, color: '#7f8ca3' });
    p.text(date, W - PAD, H - 38, { size: 15, weight: 600, color: '#7f8ca3', align: 'right' });
  }

  function panel(c, p, side, top, index, images, imageIndex, custom) {
    const x = PAD - 8, w = W - 2 * (PAD - 8), h = PANEL_H - 16;
    p.box(x, top, w, h, 24, custom ? 'rgba(8,12,22,.74)' : 'rgba(255,255,255,.035)', 'rgba(255,255,255,.08)');
    const inner = x + 24;
    const dot = index ? '#3ee6a0' : '#ff8a5c';
    p.box(inner, top + 28, 10, 10, 5, dot);
    p.text(index ? L('Tu as reçu', 'You received') : L('Tu as donné', 'You gave'), inner + 20, top + 39, { size: 21, weight: 700 });
    p.text(`${side.items.length} ${side.items.length > 1 ? L('objets', 'items') : L('objet', 'item')}`,
      inner + 20 + p.width(index ? L('Tu as reçu', 'You received') : L('Tu as donné', 'You gave'), 21, 700) + 12, top + 39,
      { size: 15, weight: 500, color: '#7f8ca3' });
    if (side.robux) {
      const label = `+ R$ ${fmt(side.robux)}`, lw = p.width(label, 15, 700) + 24;
      p.box(x + w - 24 - lw, top + 18, lw, 30, 15, 'rgba(62,230,160,.12)', 'rgba(62,230,160,.35)');
      p.text(label, x + w - 24 - lw / 2, top + 38, { size: 15, weight: 700, color: '#7ff0c0', align: 'center' });
    }

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
      p.text('RAP', tx + 2, ty + TILE_H + 56, { size: 13, weight: 700, color: '#7f8ca3', track: 1 });
      p.text(fmt(item.rap), tx + 38, ty + TILE_H + 56, { size: 16, weight: 600, color: '#c9d3e3' });
      const value = fmt(item.value);
      p.text(value, tx + TILE_W - 2, ty + TILE_H + 56, { size: 16, weight: 700, color: '#7cc4ff', align: 'right' });
      p.text('VALUE', tx + TILE_W - 10 - p.width(value, 16, 700), ty + TILE_H + 56, { size: 13, weight: 700, color: '#5c89b8', align: 'right', track: 1 });
    });

    // Totaux de l'offre, sur une barre à part.
    const fy = top + h - 50;
    p.box(inner, fy, w - 48, 36, 12, 'rgba(255,255,255,.04)');
    p.text(L('Total RAP', 'Total RAP'), inner + 16, fy + 24, { size: 15, weight: 600, color: '#8795ad' });
    p.text(fmt(side.rap), inner + 16 + p.width(L('Total RAP', 'Total RAP'), 15) + 10, fy + 24, { size: 16, weight: 700 });
    const val = fmt(side.value);
    p.text(val, x + w - 40, fy + 24, { size: 16, weight: 800, color: '#7cc4ff', align: 'right' });
    p.text(L('Total Value', 'Total Value'), x + w - 40 - p.width(val, 16, 800) - 10, fy + 24, { size: 15, weight: 600, color: '#8795ad', align: 'right' });
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
    section{padding:20px 22px 22px;font:14px/1.45 ${FONT};color:#e8eef8}
    header{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}
    h2{display:flex;align-items:center;gap:10px;margin:0;font-size:17px;font-weight:750;letter-spacing:.2px}
    h2 svg{width:22px;height:22px;color:#ffc94d}
    button,.upload{font:inherit;color:#e8eef8;background:#1a2336;border:1px solid #2b3650;border-radius:10px;padding:8px 14px;cursor:pointer;transition:background .15s,border-color .15s}
    button:hover,.upload:hover{background:#222d45;border-color:#3a4868}
    button:focus-visible,.upload:focus-within,input:focus-visible{outline:2px solid #71d9fb;outline-offset:2px}
    .x{width:34px;height:34px;padding:0;display:grid;place-items:center;border-radius:10px}
    .x svg{width:16px;height:16px}
    .stage{display:flex;justify-content:center;border-radius:16px;background:#070b14;box-shadow:0 20px 50px rgba(0,0,0,.45)}
    .stage img{display:block;max-width:100%;max-height:calc(94vh - 190px);border-radius:16px}
    .status{padding:80px 20px;text-align:center;color:#93a1b8}
    .bar{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:0 0 14px}
    .seg{display:inline-flex;padding:3px;background:#111827;border:1px solid #243049;border-radius:12px;gap:2px}
    .seg button{border:0;background:transparent;padding:6px 12px;border-radius:9px;color:#93a1b8;font-weight:600}
    .seg button:hover{background:#1a2336;color:#e8eef8}
    .seg button[aria-pressed=true]{background:#2a3754;color:#fff;box-shadow:inset 0 0 0 1px #3a4b70}
    .dim{display:none;align-items:center;gap:8px;color:#93a1b8}
    .dim.on{display:inline-flex}
    input[type=range]{width:110px;accent-color:#3ee6a0}
    .upload{position:relative;overflow:hidden}
    .upload input{position:absolute;inset:0;opacity:0;cursor:pointer}
    .grow{flex:1}
    .primary{background:linear-gradient(180deg,#34d399,#10b981);border-color:#34d399;color:#04140d;font-weight:750}
    .primary:hover{background:linear-gradient(180deg,#4ade9f,#16c28d);border-color:#4ade9f}
    .hint{margin:12px 2px 0;color:#7f8ca3;font-size:12.5px}
    .error{color:#ff9aae}
    a.primary{display:inline-block;padding:8px 18px;border:1px solid #34d399;border-radius:10px;text-decoration:none;cursor:pointer}
    .error:empty{display:none}
    .error{margin:-4px 2px 12px}
    @media(max-width:560px){section{padding:14px}.bar{gap:8px}.grow{display:none}}
    @media(prefers-reduced-motion:reduce){button,.upload{transition:none}}`;

  const ICON_TROPHY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>';
  const ICON_X = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'html') node.innerHTML = v;
      else if (k === 'class') node.className = v;
      else if (k.startsWith('aria-') || k === 'type' || k === 'accept') node.setAttribute(k, v);
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

  async function open(page, analysis) {
    close();
    const dialog = document.createElement('dialog');
    dialog.dataset.rn = 'flex';
    dialog.style.cssText = 'padding:0;border:1px solid rgba(255,255,255,.1);border-radius:22px;background:#0b1020;color:#e8eef8;width:min(960px,95vw);max-height:94vh;overflow:auto;box-shadow:0 40px 120px rgba(0,0,0,.6);';
    const container = document.createElement('div'); dialog.append(container);
    const root = container.attachShadow({ mode: 'closed' });
    const style = el('style', { textContent: CSS });
    const dismiss = el('button', { type: 'button', class: 'x', html: ICON_X, 'aria-label': L('Fermer', 'Close'), title: L('Fermer', 'Close') });
    dismiss.onclick = close;
    const header = el('header', {}, [el('h2', { html: ICON_TROPHY + '<span>Trade Flex</span>' }), dismiss]);
    const status = el('div', { class: 'status', textContent: L('Création de ton image…', 'Creating your image…') });
    const stage = el('div', { class: 'stage' }, [status]);
    const section = el('section', {}, [header, stage]);
    root.append(style, section);
    document.body.append(dialog); active = dialog;
    dialog.addEventListener('close', () => { dialog.remove(); if (active === dialog) active = null; });
    dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
    dialog.showModal();

    let sides;
    try { sides = snapshot(page, analysis); }
    catch { status.textContent = L('Impossible de créer la carte. Attends que les deux offres soient chargées, puis réessaie.', 'Could not create the card. Wait for both offers to load and try again.'); return; }

    const images = await Promise.all(sides.flatMap(s => s.items).map(i => loadImage(i.src)));
    if (active !== dialog) return;

    const opts = {
      theme: customBackground ? 'custom' : 'night',
      metric: Number.isFinite(sides[0].value) && Number.isFinite(sides[1].value) ? 'value' : 'rap',
      dim: 55
    };
    const canvas = document.createElement('canvas');
    const image = el('img', { alt: L('Carte récapitulative du trade', 'Trade summary card') });
    status.replaceWith(image);

    const error = el('p', { class: 'hint error', role: 'status' });
    const dim = el('input', { type: 'range', min: 20, max: 85, value: opts.dim, 'aria-label': L('Assombrir le fond', 'Dim the background') });
    const dimWrap = el('label', { class: 'dim' + (opts.theme === 'custom' ? ' on' : '') }, [L('Assombrir', 'Dim'), dim]);
    const file = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': L('Importer un fond', 'Import a background') });
    const upload = el('label', { class: 'upload' }, [L('Importer…', 'Import…'), file]);
    const themeSeg = segmented(L('Fond', 'Background'),
      [['night', L('Nuit', 'Night')], ['purple', L('Violet', 'Purple')], ['custom', L('Mon image', 'My image')]],
      opts.theme, key => {
        if (key === 'custom' && !customBackground) { file.click(); return; }
        opts.theme = key; dimWrap.classList.toggle('on', key === 'custom'); refresh();
      });
    const metricSeg = segmented(L('Résultat mis en avant', 'Featured result'),
      [['value', 'Value'], ['rap', 'RAP']], opts.metric, key => { opts.metric = key; refresh(); });
    const copy = el('button', { type: 'button', textContent: L('Copier', 'Copy') });
    const download = el('a', { class: 'primary', textContent: L('Télécharger', 'Download'), download: 'ronote-trade-flex.png', role: 'button' });
    const bar = el('div', { class: 'bar' }, [themeSeg, metricSeg, dimWrap, upload, el('span', { class: 'grow' }), copy, download]);
    const hint = el('p', { class: 'hint', textContent: L('Pseudos et serials ne figurent jamais sur la carte. Une image importée reste sur ton ordinateur.', 'Names and serials never appear on the card. An imported image stays on your computer.') });
    stage.before(bar, error);
    section.append(hint);

    let frame;
    const render = () => {
      draw(canvas, sides, images, opts);
      image.src = canvas.toDataURL('image/png');
      download.href = image.src;
    };
    const refresh = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { if (active === dialog) render(); }); };
    dim.oninput = () => { opts.dim = Number(dim.value); refresh(); };

    copy.onclick = async () => {
      try {
        const blob = await new Promise((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('blob')), 'image/png'));
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        copy.textContent = L('Copiée ✓', 'Copied ✓');
        error.textContent = '';
      } catch {
        error.textContent = L("Copie refusée par le navigateur : clic droit sur l'image → Copier l'image.", 'The browser refused the copy: right-click the image → Copy image.');
      }
      setTimeout(() => { copy.textContent = L('Copier', 'Copy'); }, 1600);
    };

    let importId = 0;
    file.onchange = async () => {
      const selected = file.files[0], id = ++importId;
      if (!selected) return;
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(selected.type) || selected.size > 15 * 1024 * 1024) {
        error.textContent = L('Choisis un PNG, JPEG ou WebP de moins de 15 Mo.', 'Choose a PNG, JPEG or WebP under 15 MB.');
        return;
      }
      const url = URL.createObjectURL(selected);
      try {
        const img = new Image(); img.src = url; await img.decode();
        if (active !== dialog || id !== importId) return;
        // Seule une copie réduite reste en mémoire ; rien n'est envoyé nulle part.
        const scaled = document.createElement('canvas'), k = Math.min(1, 2400 / Math.max(img.width, img.height));
        scaled.width = Math.max(1, Math.round(img.width * k)); scaled.height = Math.max(1, Math.round(img.height * k));
        scaled.getContext('2d').drawImage(img, 0, 0, scaled.width, scaled.height);
        customBackground = scaled;
        opts.theme = 'custom'; dimWrap.classList.add('on');
        for (const b of themeSeg.children) b.setAttribute('aria-pressed', String(b === themeSeg.lastElementChild));
        error.textContent = ''; refresh();
      } catch {
        error.textContent = L('Cette image ne peut pas être chargée.', 'This image could not be loaded.');
      } finally { URL.revokeObjectURL(url); file.value = ''; }
    };

    render();
  }

  globalThis.RoNoteFlex = { open, close };
})();
