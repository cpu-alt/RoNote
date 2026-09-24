/**
 * ==========================================================================
 *  LA COTE SUR LA PAGE D'UN OBJET ROBLOX
 * --------------------------------------------------------------------------
 *  Sur /catalog/{id} et /bundles/{id}, une rangée « Value » sous « Best
 *  Price », à l'allure des rangées de Roblox : la value Rolimon's, la demande
 *  et la tendance, le tout menant à la fiche Rolimon's. Sans rangée « Best
 *  Price » (aucun revendeur), le bloc se pose au-dessus du nom. Seuls les
 *  objets du catalogue Rolimon's (les limiteds) sont concernés.
 *
 *  Script classique : la page Roblox n'accepte pas les imports d'une
 *  extension (voir content/tradedom.js).
 *
 *  Le panneau d'infos est une application React (#item-info-container-frontend)
 *  qui peut se redessiner : un observateur replace le bloc s'il disparaît.
 * ==========================================================================
 */
(() => {
  const B = globalThis.browser ?? globalThis.chrome;
  if (!B || globalThis.__rnItemPage) return;
  globalThis.__rnItemPage = true;

  let dead = false, observer = null, timer = null, lastUrl = location.href;
  const alive = () => {
    if (dead) return false;
    try { if (B?.runtime?.id) return true; } catch { /* invalidated */ }
    shutdown();
    return false;
  };
  const assetUrl = (path) => { try { return B.runtime.getURL(path); } catch { return ''; } };
  const fr = (document.documentElement.lang || navigator.language || '').toLowerCase().startsWith('fr');
  const number = new Intl.NumberFormat(fr ? 'fr-FR' : 'en-US', { maximumFractionDigits: 0 });

  // Mêmes niveaux que roli.js (DEMAND_LABEL / TREND_LABEL), dans les deux langues.
  const DEMAND = fr ? ['Terrible', 'Faible', 'Normale', 'Bonne', 'Élevée', 'Très élevée']
    : ['Terrible', 'Low', 'Normal', 'Good', 'High', 'Amazing'];
  const TREND = fr ? ['En baisse', 'Instable', 'Stable', 'En hausse', 'Fluctuante']
    : ['Lowering', 'Unstable', 'Stable', 'Raising', 'Fluctuating'];

  /** {assetId, bundleId} de la page, ou null hors d'une page d'objet. */
  function pageItem() {
    const m = /^(?:\/[a-z]{2}(?:[-_][a-z]{2})?)?\/(catalog|bundles)\/(\d+)(?:\/|$)/i.exec(location.pathname);
    if (!m) return null;
    return m[1].toLowerCase() === 'bundles' ? { assetId: 0, bundleId: Number(m[2]) } : { assetId: Number(m[2]), bundleId: 0 };
  }
  const keyOf = (i) => i ? (i.bundleId ? 'b' + i.bundleId : 'a' + i.assetId) : '';

  let enabled = true;
  let info = null, infoKey = '', asking = false, retryAt = 0;
  let host = null;

  if (alive()) B.storage?.local?.get('settings').then(got => {
    enabled = got?.settings?.itemPageValue !== false && got?.settings?.useRolimons !== false;
    if (!enabled) remove(); else schedule();
  }).catch(() => {});
  if (alive()) B.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local' || dead) return;
    if (changes.settings) {
      const s = changes.settings.newValue || {};
      const next = s.itemPageValue !== false && s.useRolimons !== false;
      if (next !== enabled) { enabled = next; info = null; infoKey = ''; retryAt = 0; if (!enabled) remove(); else schedule(); }
    }
    // Nouvelle table Rolimon's : la cote a pu bouger.
    if (changes.roli && enabled) { infoKey = ''; retryAt = 0; schedule(); }
  });

  const CSS = `
    :host{display:block;color:inherit}
    .r{display:inline-flex;align-items:center;flex-wrap:wrap;gap:4px 14px;max-width:100%;box-sizing:border-box;
      padding:6px 10px;border-radius:8px;color:inherit;text-decoration:none;
      font:13px/18px "Builder Sans","Gotham SSm",system-ui,sans-serif;font-variant-numeric:tabular-nums;
      background:color-mix(in srgb,currentColor 6%,transparent);
      box-shadow:inset 0 0 0 1px color-mix(in srgb,currentColor 12%,transparent);
      transition:background .15s,box-shadow .15s}
    a.r:hover{background:color-mix(in srgb,currentColor 11%,transparent);
      box-shadow:inset 0 0 0 1px color-mix(in srgb,currentColor 22%,transparent)}
    a.r:focus-visible{outline:2px solid #3b82f6;outline-offset:2px}
    .logo{width:16px;height:16px;object-fit:contain;display:block;margin-right:-6px}
    .v{font-size:15px;font-weight:700}
    .k{opacity:.6;margin-right:3px}
    .proj{color:#ffc400;font-weight:600;display:inline-flex;align-items:center;gap:4px}
    .proj svg,.rare svg{width:13px;height:13px;display:block}
    .rare{display:inline-flex}
    .go{width:12px;height:12px;opacity:.45;transition:opacity .15s,transform .15s}
    a.r:hover .go{opacity:.9;transform:translate(1px,-1px)}
    /* Dans la liste de Roblox : une valeur parmi les autres, sans cadre. */
    .inrow .r{padding:0;background:none;box-shadow:none;border-radius:4px;font:inherit;gap:4px 12px}
    .inrow a.r:hover{background:none;box-shadow:none}
    .inrow a.r:hover .v{text-decoration:underline;text-underline-offset:3px}
    .inrow .v{font-size:inherit}
    .inrow .logo{margin-right:-8px}`;

  const ARROW = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2h6v6M10 2 3 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  /** Le nom de l'objet dans le panneau d'infos : c'est au-dessus qu'on se pose. */
  function titleEl() {
    const panel = document.getElementById('item-info-container-frontend');
    if (!panel) return null;
    const named = panel.querySelector('h1') || panel.querySelector('h2,[class*="item-name"],[class*="ItemName"]');
    if (named) return named;
    // Sinon : le texte le plus gros du panneau, c'est le nom de l'objet.
    let best = null, size = 0;
    for (const el of panel.querySelectorAll('span,div,p')) {
      if (el.childElementCount || !el.textContent.trim() || el.closest('[data-rn]')) continue;
      const px = parseFloat(getComputedStyle(el).fontSize) || 0;
      if (px > size) { size = px; best = el; }
    }
    return size >= 20 ? best : null;
  }

  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]); }

  const WARN = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.8 1 14h14L8 1.8z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 6.4v3.4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="11.9" r=".95" fill="currentColor"/></svg>';

  /** `inRow` : posée dans la liste de Roblox, sous « Best Price ». Le libellé
   *  « Value » est alors dans la colonne de gauche, et le RAP déjà affiché
   *  par Roblox dans son tableau des prix. */
  function draw(data, inRow) {
    const logo = assetUrl('assets/rolimons-logo.webp');
    const parts = [];
    const amount = `<span class="v">${esc(number.format(data.value))}</span>`;
    parts.push(data.value > 0
      ? (inRow ? amount : `<span><span class="k">Value</span>${amount}</span>`)
      : `<span class="k">${fr ? 'Pas de value' : 'No value'}</span>`);
    if (data.rap > 0 && !inRow) parts.push(`<span><span class="k">RAP</span>${esc(number.format(data.rap))}</span>`);
    if (DEMAND[data.demand]) parts.push(`<span><span class="k">${fr ? 'Demande' : 'Demand'}</span>${DEMAND[data.demand]}</span>`);
    if (TREND[data.trend]) parts.push(`<span><span class="k">${fr ? 'Tendance' : 'Trend'}</span>${TREND[data.trend]}</span>`);
    const flags = [];
    if (data.projected) flags.push(`<span class="proj" title="${fr ? 'RAP gonflé par des reventes, chiffre peu fiable' : 'RAP inflated by resales, unreliable figure'}">${WARN}Projected</span>`);
    if (data.rare && globalThis.RoNoteMarks?.DIAMOND) flags.push(`<span class="rare" title="${fr ? 'Objet rare selon Rolimon’s' : 'Rare item according to Rolimon’s'}">${globalThis.RoNoteMarks.DIAMOND}</span>`);
    const body = `<img class="logo" alt="" src="${logo}">` + parts.join('') + flags.join('');
    // Toute la ligne mène à la fiche Rolimon's : une seule cible, évidente.
    const row = data.roliId
      ? `<a class="r" href="https://www.rolimons.com/item/${data.roliId}" target="_blank" rel="noopener noreferrer"
          title="${fr ? 'Voir sur Rolimon’s' : 'View on Rolimon’s'}">${body}${ARROW.replace('<svg', '<svg class="go"')}</a>`
      : `<span class="r">${body}</span>`;
    return `<style>${CSS}</style>${inRow ? `<div class="inrow">${row}</div>` : row}`;
  }

  // Ce que RoNote a inséré dans la page (une rangée, ou un libellé et sa
  // cellule) et de quoi vérifier que c'est toujours à sa place.
  let seat = null;

  const short = (el) => {
    const t = (el?.textContent || '').trim();
    return t.length > 0 && t.length < 40 && !el.querySelector('button,img,a');
  };
  const bare = (el, deep) => {
    const c = el.cloneNode(deep);
    for (const n of [c, ...c.querySelectorAll('[id]')]) n.removeAttribute('id');
    return c;
  };

  /**
   * La rangée « Best Price » de Roblox, repérée par sa structure plutôt que
   * par ses classes ou son texte (traduit) : c'est celle du bouton d'achat,
   * le bouton le plus large du panneau, et elle est suivie d'une rangée
   * libellé / valeur (« Tradable ») dont on copie l'allure.
   */
  function priceRow(panel) {
    let buy = null, width = 0;
    for (const b of panel.querySelectorAll('button')) {
      const w = b.getBoundingClientRect().width;
      if (w > width) { width = w; buy = b; }
    }
    if (!buy || width < 120) return null;
    for (let n = buy; n?.parentElement && n !== panel; n = n.parentElement) {
      const next = n.nextElementSibling;
      if (!next || next.contains(buy)) continue;
      // Rangées enveloppées : [libellé | cellule], [libellé | cellule]…
      if (n.children.length === 2 && !n.children[0].contains(buy) && short(n.children[0]) &&
          next.children.length === 2 && short(next.children[0])) {
        return { after: n, build: () => {
          const row = bare(next, false);
          const label = bare(next.children[0], true);
          const cell = bare(next.children[1], false);
          label.textContent = 'Value';
          cell.append(host); row.append(label, cell);
          return [row];
        } };
      }
      // Grille à plat : libellé, cellule, libellé, cellule…
      const cellTpl = next.nextElementSibling;
      if (short(n.previousElementSibling) && short(next) && cellTpl && !cellTpl.querySelector('button') &&
          /grid/.test(getComputedStyle(n.parentElement).display)) {
        return { after: n, build: () => {
          const label = bare(next, true);
          const cell = bare(cellTpl, false);
          label.textContent = 'Value';
          cell.append(host);
          return [label, cell];
        } };
      }
    }
    return null;
  }

  function place() {
    if (!info?.known) { remove(); return; }
    const panel = document.getElementById('item-info-container-frontend');
    if (!panel) return;
    if (!host) {
      host = document.createElement('div');
      host.dataset.rn = 'item-page';
      host._shadow = host.attachShadow({ mode: 'closed' });
    }
    // Toujours en place : rien à faire (l'observateur rappelle souvent).
    if (seat?.holds()) {
      if (host._drawn !== info) { host._shadow.innerHTML = draw(info, seat.inRow); host._drawn = info; }
      return;
    }
    remove();
    const found = priceRow(panel);
    if (found) {
      const nodes = found.build();
      nodes.forEach(n => { n.dataset.rn = 'item-page'; });
      found.after.after(...nodes);
      host.style.margin = '';
      seat = { nodes, inRow: true, holds: () => nodes.every(n => n.isConnected) && nodes[0].previousElementSibling === found.after };
    } else {
      // Pas de rangée « Best Price » (objet sans revendeur…) : au-dessus du nom.
      const title = titleEl();
      if (!title?.parentElement) return;
      // Le nom partage parfois une rangée avec le panier : on se pose au-dessus
      // de la rangée entière, pas à côté du nom.
      let anchor = title;
      for (let p = anchor.parentElement; p && p !== panel; p = anchor.parentElement) {
        const css = getComputedStyle(p);
        if (!/flex|grid/.test(css.display) || (css.display.includes('flex') && css.flexDirection.startsWith('column'))) break;
        anchor = p;
      }
      anchor.before(host);
      host.style.margin = '0 0 10px';
      // Une rangée « Best Price » apparue après coup reprend la main.
      seat = { nodes: [host], inRow: false, holds: () => host.nextElementSibling === anchor && !priceRow(panel) };
    }
    host._shadow.innerHTML = draw(info, seat.inRow); host._drawn = info;
  }

  function remove() {
    for (const n of seat?.nodes || []) n.remove();
    host?.remove();
    seat = null;
  }

  async function run() {
    timer = null;
    if (!alive() || !enabled) return;
    if (location.href !== lastUrl) { lastUrl = location.href; info = null; infoKey = ''; retryAt = 0; remove(); }
    const item = pageItem();
    if (!item) { remove(); return; }
    const key = keyOf(item);
    if (infoKey === key) { place(); return; }
    if (asking || Date.now() < retryAt) return;
    asking = true;
    try {
      const res = await B.runtime.sendMessage({ type: 'ronote:item-page', ...item });
      if (res?.off) { enabled = false; remove(); return; }
      // Table Rolimon's pas encore chargée : on redemande un peu plus tard.
      if (!res?.ready) { retryAt = Date.now() + 5000; setTimeout(schedule, 5050); return; }
      if (keyOf(pageItem()) !== key) { schedule(); return; }
      info = res; infoKey = key;
      place();
    } catch {
      if (!alive()) return;
      retryAt = Date.now() + 8000; setTimeout(schedule, 8050);
    } finally { asking = false; }
  }

  function schedule() {
    if (dead || timer) return;
    timer = setTimeout(run, 150);
  }

  function shutdown() {
    dead = true;
    observer?.disconnect();
    clearTimeout(timer);
    try { host?.remove(); } catch { /* ignore */ }
  }

  // Roblox navigue parfois sans recharger, et React redessine le panneau :
  // on surveille l'URL et la présence du bloc.
  // Il voit passer chaque mutation de roblox.com : il ne relit l'URL que
  // quand elle change, et ne fait rien du tout hors d'une page d'objet.
  let seenUrl = location.href, onItem = !!pageItem();
  observer = new MutationObserver(() => {
    if (location.href !== seenUrl) { seenUrl = location.href; onItem = !!pageItem(); schedule(); return; }
    if (!onItem || !enabled) return;
    if (!infoKey || (info?.known && !host?.isConnected)) schedule();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  schedule();
})();
