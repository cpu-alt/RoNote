// Classic isolated-world script: no imports blocked by Roblox's CSP.
(() => {
  const B = globalThis.browser ?? globalThis.chrome;
  const dom = globalThis.RoNoteDom;
  if (!dom || globalThis.__rnDelta) return;
  globalThis.__rnDelta = true;
  // Reloading or updating the extension leaves this copy running in the open
  // tabs, cut off from it: every chrome.* call then throws "Extension context
  // invalidated". Such an orphan removes what it placed and stops for good.
  let dead = false, observer = null, ticker = 0;
  const alive = () => {
    if (dead) return false;
    try { if (B?.runtime?.id) return true; } catch { /* invalidated */ }
    shutdown();
    return false;
  };
  const assetUrl = (path) => { try { return B.runtime.getURL(path); } catch { return ''; } };
  const fr = (document.documentElement.lang || navigator.language || '').startsWith('fr');
  const number = new Intl.NumberFormat(fr ? 'fr-FR' : 'en-US', { maximumFractionDigits: 0, useGrouping: false });
  const deltaNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + deltaNumber.format(Math.abs(n));
  // The trades list (/trades) and the page to build a trade, opened from a
  // profile (/users/123/trade), with or without a language prefix (/fr/...).
  const onPage = () => /^(?:\/[a-z]{2}(?:[-_][a-z]{2})?)?\/(?:trades|users\/\d+\/trade)(?:\/|$)/i.test(location.pathname);
  let host, profileLink, tools, signature = '', generation = 0, timer, retryAt = 0, lastUrl = location.href;
  // An incomplete answer (catalogue still loading, trade detail not captured
  // yet because Roblox redrew it from its own cache) is asked again soon, then
  // less and less often: waiting a full minute left the banner grey until the
  // page was refreshed.
  const RETRY_STEPS = [1500, 3000, 6000, 12000, 25000];
  let retries = 0;
  const nextRetry = () => Date.now() + (RETRY_STEPS[retries++] ?? 60000);
  const cache = new Map();
  const badges = new Map();
  const totalBadges = new Map();
  let shownPage, shownAnalysis, analysisPending = false;
  // The last complete answer per trade: a later reply without the Value (the
  // worker woke without its caches, Roblox is rate limiting) must not erase it.
  const good = new Map();
  // Settings > Value analysis. Read once, then followed live.
  let enabled = true;
  // The projected badge's look (Settings > Value analysis), image included.
  const look = { color: '', size: 'm', image: '' };
  const lookOf = (st) => ({ color: st?.projectedColor || '', size: st?.projectedSize || 'm' });
  // The banner's colours, style and size: the whole settings object is kept,
  // content/delta-banner.js picks what it needs.
  let bannerSettings = {};
  const bannerKey = (st) => ['bannerGain', 'bannerLoss', 'bannerStyle', 'bannerSize'].map(k => st?.[k] || '').join('|');
  function restyleBanner() {
    if (host?._style && globalThis.RoNoteBanner) host._style.textContent = globalThis.RoNoteBanner.css(bannerSettings);
  }
  if (alive()) B.storage?.local?.get(['settings', 'projectedIcon']).then(got => {
    enabled = got?.settings?.pageDelta !== false;
    Object.assign(look, lookOf(got?.settings), { image: got?.projectedIcon || '' });
    bannerSettings = got?.settings || {};
    restyleBanner();
    if (!enabled) clear(); else { restyleFlags(); schedule(); }
  }).catch(() => {});
  if (alive()) B.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local' || dead) return;
    if (changes.projectedIcon) { look.image = changes.projectedIcon.newValue || ''; restyleFlags(); }
    if (!changes.settings) return;
    const nextSettings = changes.settings.newValue || {};
    if (bannerKey(nextSettings) !== bannerKey(bannerSettings)) { bannerSettings = nextSettings; restyleBanner(); }
    const nextLook = lookOf(changes.settings.newValue);
    if (nextLook.color !== look.color || nextLook.size !== look.size) { Object.assign(look, nextLook); restyleFlags(); }
    const next = changes.settings.newValue?.pageDelta !== false;
    if (next === enabled) return;
    enabled = next; cache.clear(); good.clear();
    if (!enabled) clear(); else { retryAt = 0; schedule(); }
  });
  const itemKey = i => i.bundleId ? 'b' + i.bundleId : 'a' + i.assetId;

  // Yellow warning in the top-right corner of a "projected" item: its RAP was
  // pushed up by resales between accomplices, so its figures can't be trusted.
  //
  // Placed at once and never moved: a zero-height box of ours at the top of
  // the card gives the corner, whatever Roblox's styles are and whether the
  // thumbnail has loaded. Roblox's own elements are never restyled.
  const warnTitle = fr ? 'Projected : RAP gonflé par des reventes, chiffre peu fiable' : 'Projected: RAP inflated by resales, unreliable figure';

  // Items already known to be projected (or not), kept between visits: the
  // warning shows on the first frame instead of after the worker's answer.
  const PROJ_KEY = 'pageProjected';
  let projectedKnown = new Map();
  let projectedSave = null;
  if (alive()) B.storage?.local?.get(PROJ_KEY).then(got => {
    for (const [k, v] of Object.entries(got?.[PROJ_KEY] || {})) if (!projectedKnown.has(k)) projectedKnown.set(k, !!v);
    if (shownPage) renderItems(shownPage, shownAnalysis, true);
  }).catch(() => {});
  function learnProjected(analysis) {
    let changed = false;
    for (const info of (analysis?.pageItems || []).flat()) {
      if (!info || typeof info.projected !== 'boolean') continue;
      const k = itemKey(info);
      if (projectedKnown.get(k) !== info.projected) { projectedKnown.set(k, info.projected); changed = true; }
    }
    if (!changed || projectedSave) return;
    projectedSave = setTimeout(() => {
      projectedSave = null;
      // Only the positives are worth keeping; unknown items simply wait.
      const out = {};
      for (const [k, v] of [...projectedKnown].slice(-600)) if (v) out[k] = 1;
      if (alive()) B.storage?.local?.set({ [PROJ_KEY]: out }).catch(() => {});
    }, 1500);
  }

  function dropBadge(badge) {
    badge.node.remove();
    badge.shelf?.remove();
    dropFlag(badge);
  }
  function showFlag(badge, card, projected) {
    if (!projected) { dropFlag(badge); return; }
    if (badge.flag?.isConnected && badge.flag.parentElement === card) return;
    dropFlag(badge);
    if (!globalThis.RoNoteBadge) return;
    const flag = document.createElement('span');
    flag.dataset.rn = 'item-projected';
    const corner = document.createElement('span');
    // A card laid out as a row (thumbnail, name, price side by side): a box of
    // ours would be squeezed in among them, so the badge ends the row instead.
    const row = sideBySide(card);
    flag.style.cssText = row
      ? 'display:block;position:static;flex:none;margin:0 6px 0 0;align-self:center;line-height:0;pointer-events:none;'
      : 'display:block;position:relative;width:100%;height:0;margin:0;padding:0;pointer-events:none;';
    corner.style.cssText = row
      ? 'position:static;display:block;line-height:0;pointer-events:none;'
      : 'position:absolute;top:7px;left:7px;z-index:3;pointer-events:none;line-height:0;';
    const root = corner.attachShadow({ mode: 'closed' });
    globalThis.RoNoteBadge.fill(root, look, warnTitle);
    flag.append(corner);
    card.prepend(flag);
    badge.flag = flag;
    badge.flagRoot = root;
  }
  // A new colour, size or image: redraw the badges in place, without moving them.
  function restyleFlags() {
    for (const badge of [...badges.values(), ...invBadges.values()]) {
      if (badge.flagRoot) globalThis.RoNoteBadge?.fill(badge.flagRoot, look, warnTitle);
    }
  }
  function dropFlag(badge) {
    badge.flag?.remove();
    badge.flag = null;
    badge.flagRoot = null;
  }
  // The Value sits on its own small line below the RAP, aligned with Roblox's
  // Robux icon. If a fixed-height card clips it, it moves onto the thumbnail.
  const CHIP_CSS = `
    :host{display:block;clear:both;width:max-content;max-width:100%;margin:-2px 0 0;line-height:1;color:inherit}
    :host([data-below]) .v{padding:0;gap:4px;line-height:1.1;background:none;border:0;box-shadow:none}
    :host([data-over]){position:absolute;top:7px;left:7px;z-index:3;margin:0;pointer-events:auto}
    :host([data-over]) .v{padding:1px 7px 1px 6px;gap:3px;font-size:11px;line-height:16px;
      background:rgba(12,16,34,.82);border-color:rgba(125,185,255,.7);box-shadow:0 2px 8px rgba(0,0,0,.45)}
    .v{display:inline-flex;align-items:center;gap:5px;max-width:100%;padding:2px 8px 2px 6px;border-radius:999px;
      font-family:var(--rn-font-family,inherit);font-size:var(--rn-font-size,inherit);font-weight:var(--rn-font-weight,inherit);
      line-height:var(--rn-line-height,normal);letter-spacing:0;word-spacing:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
      color:var(--rn-color,inherit);background:linear-gradient(180deg,rgba(77,159,255,.30),rgba(77,159,255,.16));
      border:1px solid rgba(125,185,255,.55);box-shadow:0 1px 6px rgba(40,120,255,.18);transition:opacity .2s}
    .v img{display:block;width:.9em;height:.9em;flex:none;object-fit:contain}
    .v b{font:inherit;font-variant-numeric:normal;letter-spacing:0;word-spacing:0}
    .v[data-state="wait"],.v[data-state="none"]{color:#b8bfd0;background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.14);box-shadow:none}
    .v[data-state="wait"] img,.v[data-state="none"] img{filter:grayscale(1);opacity:.65}
    .v[data-state="wait"]{opacity:.7}`;
  // Is the chip really visible? Inside its card, on its RAP's line, and not
  // cut by any ancestor that hides overflow (fixed-height cards, ellipsis).
  function chipVisible(badge, card) {
    const n = badge.node.getBoundingClientRect();
    if (!n.width || !n.height) return false;
    for (let el = badge.node.parentElement; el; el = el.parentElement) {
      const css = getComputedStyle(el);
      if (css.overflowX !== 'visible' || css.overflowY !== 'visible' || el === card) {
        const r = el.getBoundingClientRect();
        if (n.left < r.left - 1 || n.right > r.right + 1 || n.top < r.top - 1 || n.bottom > r.bottom + 1) return false;
      }
      if (el === card) break;
    }
    return true;
  }

  function seat(badge, card) {
    const node = badge.node;
    if (badge.mode === 'below') {
      node.dataset.below = '1'; delete node.dataset.over;
      badge.label.textContent = '';
      // A sibling of the RAP row gives the two amounts exactly the same start,
      // including when the number itself is wrapped in several spans.
      if (node.previousElementSibling !== badge.line) badge.line.after(node);
    } else if (badge.mode === 'overlay') {
      // A compact basket has no room for another line. Never cover its
      // thumbnail or controls with a floating Value pill.
      node.style.display = 'none';
      badge.shelf?.remove();
      return;
    }
  }

  function ensureBadge(map, card, priceEl = null) {
    const anchor = priceEl?.isConnected && card.contains(priceEl) ? priceEl : null;
    const line = anchor?.parentElement && anchor.parentElement !== card ? anchor.parentElement : anchor;
    let badge = map.get(card);
    if (!badge) {
      const node = document.createElement('span');
      node.dataset.rn = 'item-value';
      const shadow = node.attachShadow({ mode: 'closed' });
      const style = document.createElement('style'); style.textContent = CHIP_CSS;
      const pill = document.createElement('span'); pill.className = 'v';
      const label = document.createElement('img');
      label.src = assetUrl('assets/rolimons-logo.webp'); label.alt = '';
      const value = document.createElement('b');
      pill.append(label, value); shadow.append(style, pill);
      badge = { node, pill, label, value };
      map.set(card, badge);
    }
    if (badge.mode !== 'overlay') badge.mode = line ? 'below' : 'overlay';
    if (badge.anchor !== anchor) badge.anchor = anchor;
    if (badge.line !== line) badge.line = line;
    if (anchor && (badge.typeAnchor !== anchor || !badge.typed)) {
      const css = getComputedStyle(anchor);
      for (const [name, value] of [
        ['--rn-font-family', css.fontFamily], ['--rn-font-size', css.fontSize],
        ['--rn-font-weight', css.fontWeight], ['--rn-line-height', css.lineHeight],
        ['--rn-letter-spacing', css.letterSpacing], ['--rn-color', css.color]
      ]) if (value) badge.node.style.setProperty(name, value);
      badge.typeAnchor = anchor; badge.typed = true;
    }
    const where = badge.mode === 'overlay' ? badge.shelf : line?.parentElement;
    if (!badge.node.isConnected || badge.node.parentElement !== where ||
        (badge.mode === 'below' && badge.node.previousElementSibling !== line)) seat(badge, card);
    return badge;
  }

  function paintBadge(badge, text, state, title, card) {
    const grew = badge.value.textContent !== text;
    if (grew) badge.value.textContent = text;
    if (badge.pill.dataset.state !== state) badge.pill.dataset.state = state;
    badge.pill.title = title;
    // Checked when the text changes: a longer number may no longer fit.
    if (card && (grew || !badge.checked) && badge.mode !== 'overlay' && !chipVisible(badge, card)) {
      badge.mode = 'overlay';
      seat(badge, card);
    }
    badge.checked = true;
  }

  function ensureTotal(side) {
    const row = side.totalLabel?.parentElement;
    if (!row?.after || !side.root?.contains(row)) return null;
    let total = totalBadges.get(side.root);
    if (!total) {
      const node = document.createElement('div');
      node.dataset.rn = 'total-value';
      node.style.cssText = 'box-sizing:border-box;display:flex;align-items:center;justify-content:space-between;gap:16px;width:100%;margin-top:6px;padding:0;font:inherit;color:inherit;font-variant-numeric:tabular-nums;';
      const label = document.createElement('span');
      label.textContent = fr ? 'Value Rolimon’s :' : 'Rolimon’s Value:';
      const amount = document.createElement('span');
      amount.style.cssText = 'display:inline-flex;align-items:center;justify-content:flex-end;gap:6px;font:inherit;font-weight:600;white-space:nowrap;';
      const icon = document.createElement('img');
      icon.src = assetUrl('assets/rolimons-logo.webp'); icon.alt = '';
      icon.style.cssText = 'display:block;width:13px;height:13px;object-fit:contain;';
      const value = document.createElement('b');
      value.style.cssText = 'font:inherit;font-weight:inherit;';
      amount.append(icon, value); node.append(label, amount);
      total = { node, value, amount, label, icon };
      totalBadges.set(side.root, total);
    }
    total.row = row;
    // Match the actual Roblox label and amount, including theme typography.
    const sourceAmount = [...(row.querySelectorAll?.('*') || [])].reverse().find(el =>
      !el.childElementCount && /\d/.test(el.textContent || '')) || row.lastElementChild;
    for (const [source, target] of [[side.totalLabel, total.label], [sourceAmount, total.amount]]) {
      if (!source) continue;
      const css = getComputedStyle(source);
      for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'color']) {
        if (css[property] && target.style[property] !== css[property]) target.style[property] = css[property];
      }
    }
    total.icon.style.width = '1em'; total.icon.style.height = '1em';
    if (total.node.previousElementSibling !== row) row.after(total.node);
    return total;
  }

  function renderTotals(page, analysis, pending = false) {
    const keep = new Set();
    for (const [index, side] of (page?.sides || []).entries()) {
      const total = ensureTotal(side);
      if (!total) continue;
      keep.add(side.root);
      const fallback = side.role === 'give' ? analysis?.give?.value : side.role === 'get' ? analysis?.get?.value : null;
      const value = analysis?.pageTotals?.[index] ?? fallback;
      const available = !!analysis?.valueAvailable && Number.isFinite(value);
      const text = available ? number.format(value) : pending ? '…' : '—';
      if (total.value.textContent !== text) total.value.textContent = text;
      const title = available
        ? (fr ? 'Total selon les cotes Rolimon’s, Robux inclus' : 'Total using Rolimon’s values, including Robux')
        : (fr ? 'Total Value temporairement indisponible' : 'Total Value temporarily unavailable');
      if (total.amount.title !== title) total.amount.title = title;
      total.node.style.opacity = available ? '1' : pending ? '.7' : '.8';
    }
    for (const [root, total] of totalBadges) if (!keep.has(root)) {
      total.node.remove(); totalBadges.delete(root);
    }
  }

  function renderItems(page, analysis, pending = false) {
    renderSerials(page, analysis);
    const keep = new Set();
    for (const [sideIndex, side] of page.sides.entries()) {
      for (const [index, item] of side.items.entries()) {
        const card = item.card || item.link;
        if (!card?.append) continue;
        keep.add(card);
        const badge = ensureBadge(badges, card, item.priceEl);
        const info = analysis?.pageItems?.[sideIndex]?.[index];
        // An item read by name gets its id from the worker: match on the name.
        const matched = info && (itemKey(info) === itemKey(item) ||
          (!item.assetId && !item.bundleId && info.name && info.name === item.name));
        const available = matched && Number.isFinite(info.value) && info.value > 0;
        const rapFallback = matched && info.noValue && Number.isFinite(item.rap) && item.rap >= 0;
        paintBadge(badge, available ? number.format(info.value) : rapFallback ? number.format(item.rap) : pending ? '…' : '—',
          available || rapFallback ? 'ok' : pending ? 'wait' : 'none',
          available ? (fr ? 'Cote Rolimon’s actuelle' : 'Current Rolimon’s value') :
          rapFallback ? (fr ? 'RAP actuel utilisé : aucune Value publiée pour cet objet.' : 'Current RAP used: no published value for this item.') :
          (fr ? 'Cote temporairement indisponible' : 'Value temporarily unavailable'), card);
        showFlag(badge, card, matched && typeof info.projected === 'boolean'
          ? info.projected : !!projectedKnown.get(itemKey(item)));
      }
    }
    for (const [card, badge] of badges) if (!keep.has(card)) { dropBadge(badge); badges.delete(card); }
  }
  /* ----------------------------------------------------------------------
   * The two inventories of the page to build a trade: value and projected
   * badge on every item shown, page after page. Answers are kept per item,
   * so scrolling back or changing page redraws at once, without asking again.
   * -------------------------------------------------------------------- */
  const invBadges = new Map();
  const invInfo = new Map();          // item key -> { value, projected } from the worker
  let invAsking = false, invRetryAt = 0;
  const invKey = (i) => i.assetId ? 'a' + i.assetId : i.bundleId ? 'b' + i.bundleId
    : 'n:' + (i.names || [i.name]).join('|') + ':' + (i.rap ?? '');

  function clearInventories() {
    for (const badge of invBadges.values()) { dropBadge(badge); }
    invBadges.clear();
  }

  function renderInventories(items) {
    const keep = new Set();
    for (const item of items) {
      const card = item.card || item.link;
      if (!card?.append) continue;
      const info = invInfo.get(invKey(item));
      keep.add(card);
      const badge = ensureBadge(invBadges, card, item.priceEl);
      if (info?.known && info.value) paintBadge(badge, number.format(info.value), 'ok', fr ? `Cote Rolimon’s actuelle : ${number.format(info.value)}` : `Current Rolimon’s value: ${number.format(info.value)}`, card);
      else if (info?.known && Number.isFinite(item.rap) && item.rap >= 0) paintBadge(badge, number.format(item.rap), 'ok', fr ? 'RAP actuel utilisé : aucune Value publiée pour cet objet.' : 'Current RAP used: no published value for this item.', card);
      else paintBadge(badge, info?.known ? '—' : '…', info?.known ? 'none' : 'wait', fr ? 'Pas de Value publiée pour cet objet' : 'No published value for this item', card);
      showFlag(badge, card, !!info?.projected);
    }
    for (const [card, badge] of invBadges) if (!keep.has(card)) { dropBadge(badge); invBadges.delete(card); }
  }

  async function updateInventories(page) {
    if (!alive()) return;
    let items = null;
    try { items = dom.inventoryItems?.((page?.sides || []).map(s => s.root)); } catch { items = null; }
    if (!items) { if (invBadges.size) clearInventories(); return; }
    renderInventories(items);
    const missing = [];
    const seen = new Set();
    for (const i of items) {
      const key = invKey(i);
      const cached = invInfo.get(key);
      if (cached?.known || cached?.retryAt > Date.now() || seen.has(key)) continue;
      seen.add(key);
      missing.push({ key, assetId: i.assetId || 0, bundleId: i.bundleId || 0, name: i.name || '', names: i.names || [], rap: i.rap ?? null });
    }
    if (!missing.length || invAsking || Date.now() < invRetryAt) return;
    invAsking = true;
    let retryUnknownAt = 0;
    try {
      const res = await B.runtime.sendMessage({ type: 'ronote:item-values', items: missing.slice(0, 150) });
      // Table not loaded yet: nothing is kept, the next pass asks again.
      if (!res?.ready) {
        invRetryAt = Date.now() + 8000;
        setTimeout(schedule, 8050);
        return;
      }
      const returned = new Set((res.items || []).map(r => r.key));
      for (const item of missing.slice(0, 150)) if (!returned.has(item.key)) {
        const retryAt = Date.now() + 8000;
        invInfo.set(item.key, { known: false, retryAt });
        retryUnknownAt = retryAt;
      }
      for (const r of res.items || []) {
        if (r.known === false) {
          const retryAt = Date.now() + 8000;
          invInfo.set(r.key, { known: false, retryAt });
          retryUnknownAt = Math.max(retryUnknownAt, retryAt);
        } else invInfo.set(r.key, { known: true, value: r.value || 0, projected: !!r.projected });
      }
      if (invInfo.size > 3000) invInfo.delete(invInfo.keys().next().value);

    } catch {
      if (!alive()) return;
      invRetryAt = Date.now() + 8000;
      setTimeout(schedule, 8050);
    } finally {
      invAsking = false;
      // The visible cards may have changed while this request was running.
      // Re-read them now so their own batch is never lost.
      schedule();
      if (retryUnknownAt) setTimeout(schedule, Math.max(50, retryUnknownAt - Date.now() + 50));
    }
    if (enabled && onPage()) {
      const again = dom.inventoryItems?.((shownPage?.sides || []).map(s => s.root));
      if (again) renderInventories(again);
    }
  }

  let undo = [];
  const nearbyLines = new Map();
  function clearNearbyLines() {
    for (const [el, properties] of nearbyLines) for (const [name, value, priority] of properties) {
      if (value) el.style.setProperty(name, value, priority); else el.style.removeProperty(name);
    }
    nearbyLines.clear();
  }
  function tidyBannerBoundary() {
    if (!host?.isConnected) return;
    const h = host.getBoundingClientRect();
    if (!h.width || !h.height) return;
    const hide = (el, property, value) => {
      let saved = nearbyLines.get(el);
      if (!saved) { saved = []; nearbyLines.set(el, saved); }
      if (!saved.some(p => p[0] === property)) saved.push([property, el.style.getPropertyValue(property), el.style.getPropertyPriority(property)]);
      el.style.setProperty(property, value, 'important');
    };
    // The remaining line can belong to a wrapper, or be a one-pixel
    // background rather than an <hr>. Only inspect the immediate boundary.
    for (let branch = host, depth = 0; branch?.parentElement && depth < 8; branch = branch.parentElement, depth++) {
      const parent = branch.parentElement;
      if (parent === document.body || parent === document.documentElement) break;
      const next = branch.nextElementSibling;
      const candidates = [parent, next, ...(next?.querySelectorAll?.('*') || [])].filter(Boolean);
      for (const el of candidates) {
        if (el.dataset?.rn) continue;
        const r = el.getBoundingClientRect(), css = getComputedStyle(el);
        if (r.width < h.width * .7 || Math.abs(r.left - h.left) > 40) continue;
        if (r.top >= h.bottom - 2 && r.top <= h.bottom + 48) {
          if (parseFloat(css.borderTopWidth) > 0) hide(el, 'border-top-width', '0px');
          if (isDivider(el) || (r.height > 0 && r.height <= 2 && !(el.textContent || '').trim() && !el.querySelector?.('a,button,input,img'))) hide(el, 'display', 'none');
        }
        if (r.bottom >= h.bottom - 2 && r.bottom <= h.bottom + 48 && parseFloat(css.borderBottomWidth) > 0) hide(el, 'border-bottom-width', '0px');
      }
    }
  }
  const restore = () => { for (const reset of undo) reset(); undo = []; };
  let serialControl, flexControl, serialHidden = false;
  const serialNodes = new Map();
  // Capture before the thumbnail's own link/React handlers. Some badges are
  // nested inside the catalog anchor, others have pointer-events:none.
  document.addEventListener('click', event => {
    for (const node of event.composedPath?.() || []) {
      const rec = serialNodes.get(node);
      if (rec) { rec.click(event); return; }
    }
  }, true);
  function resetSerials() {
    for (const [el, rec] of serialNodes) {
      el.style.filter = rec.filter;
      el.style.cursor = rec.cursor;
      el.style.pointerEvents = rec.pointerEvents;
      el.removeEventListener('click', rec.click, true);
      el.removeEventListener('keydown', rec.key, true);
      for (const [name, value] of rec.attrs) {
        if (value === null) el.removeAttribute(name); else el.setAttribute(name, value);
      }
    }
    serialNodes.clear();
  }
  function mountSerialControl() {
    if (!profileLink?.isConnected) return;
    if (!serialControl) {
      serialControl = document.createElement('button');
      serialControl.type = 'button'; serialControl.dataset.rn = 'serial-toggle';
      serialControl.textContent = '#';
      serialControl.style.cssText = profileLink.style.cssText + 'font:700 18px/1 Arial;cursor:pointer;padding:0;';
      serialControl.addEventListener('click', () => {
        serialHidden = !serialHidden;
        paintSerialControl();
        for (const [el, rec] of serialNodes) el.style.filter = serialHidden ? 'blur(5px)' : rec.filter;
      });
    }
    if (profileLink.previousElementSibling !== serialControl) profileLink.before(serialControl);
    paintSerialControl();
  }
  function paintSerialControl() {
    if (!serialControl) return;
    const label = serialHidden ? (fr ? 'Afficher les serials' : 'Show serials') : (fr ? 'Flouter les serials' : 'Blur serials');
    if (serialControl.title !== label) serialControl.title = label;
    serialControl.setAttribute('aria-label', label);
    serialControl.setAttribute('aria-pressed', String(serialHidden));
    serialControl.style.background = serialHidden ? '#17649a' : 'rgba(20,28,40,.45)';
  }
  function renderSerials(page, analysis) {
    const live = new Set();
    for (const [sideIndex, side] of (page?.sides || []).entries()) for (const item of side.items) {
      const card = item.card;
      if (!card?.querySelectorAll) continue;
      const info = analysis?.pageItems?.[sideIndex]?.find(i => itemKey(i) === itemKey(item) || (i.name && i.name === item.name));
      const candidates = [...card.querySelectorAll('[class*="serial" i], [class*="limited" i], [data-serial-number], [class*="unique" i], [class*="collectible" i]')];
      for (const leaf of card.querySelectorAll('*')) if (!leaf.childElementCount && /^#\s*\d+$/.test((leaf.textContent || '').trim()) && !candidates.includes(leaf)) candidates.push(leaf);
      // The star and serial are often siblings inside one small badge.
      for (const el of [...candidates]) {
        const parent = el.parentElement;
        if (parent && parent !== card && /^#\s*\d+$/.test((parent.textContent || '').trim()) && !parent.querySelector?.('button') && !candidates.includes(parent)) candidates.push(parent);
      }
      for (const el of candidates) {
        if (el.closest('[data-rn]') || candidates.some(other => other !== el && other.contains(el) && /^#?\s*\d+$/.test((other.textContent || '').trim()))) continue;
        const text = (el.textContent || '').trim();
        if (text && !/^#?\s*\d+$/.test(text)) continue;
        const serial = text.replace(/\D/g, '') ||
          (/^#\s*\d+$/.test((el.parentElement?.textContent || '').trim()) ? el.parentElement.textContent.replace(/\D/g, '') : '');
        const instances = info?.instances || [];
        const exact = serial ? instances.filter(i => String(i.serial) === serial) : [];
        const owner = el.closest('[data-user-asset-id], [data-userasset-id], [data-uaid]') || card;
        const direct = owner.getAttribute('data-user-asset-id') || owner.getAttribute('data-userasset-id') || owner.getAttribute('data-uaid');
        const uaid = direct || (serial ? (exact.length === 1 ? exact[0].uaid : null) : info?.matchedUaid);
        const url = /^[1-9]\d*$/.test(String(uaid || '')) ? `https://www.rolimons.com/uaid/${uaid}` : null;
        live.add(el);
        let rec = serialNodes.get(el);
        if (!rec) {
          rec = { filter: el.style.filter, cursor: el.style.cursor, pointerEvents: el.style.pointerEvents,
            attrs: ['role', 'tabindex', 'aria-label', 'title'].map(name => [name, el.getAttribute(name)]) };
          rec.click = e => {
            e.preventDefault(); e.stopImmediatePropagation();
            if (!rec.url) return;
            window.open(rec.url, '_blank', 'noopener,noreferrer');
          };
          rec.key = e => { if (e.key === 'Enter' || e.key === ' ') rec.click(e); };
          el.addEventListener('click', rec.click, true); el.addEventListener('keydown', rec.key, true);
          serialNodes.set(el, rec);
        }
        rec.url = url;
        el.style.pointerEvents = 'auto';
        el.style.filter = serialHidden ? 'blur(5px)' : rec.filter;
        el.style.cursor = url ? 'pointer' : rec.cursor;
        if (url) {
          el.setAttribute('role', 'link'); el.setAttribute('tabindex', '0');
          el.setAttribute('aria-label', fr ? 'Historique de cet exemplaire sur Rolimon’s' : 'This copy’s history on Rolimon’s');
        } else {
          for (const [name, value] of rec.attrs) { if (name === 'title') continue; if (value === null) el.removeAttribute(name); else el.setAttribute(name, value); }
        }
        const hint = url ? (fr ? 'Historique de cet exemplaire sur Rolimon’s' : 'This copy’s history on Rolimon’s') :
          (fr ? 'Historique indisponible : identifiant de cet exemplaire non reçu.' : 'History unavailable: this copy’s ID has not been received.');
        if (el.getAttribute('title') !== hint) el.setAttribute('title', hint);
      }
    }
    for (const [el, rec] of serialNodes) if (!live.has(el)) {
      el.style.filter = rec.filter; el.style.cursor = rec.cursor;
      el.style.pointerEvents = rec.pointerEvents;
      el.removeEventListener('click', rec.click, true); el.removeEventListener('keydown', rec.key, true);
      for (const [name, value] of rec.attrs) { if (value === null) el.removeAttribute(name); else el.setAttribute(name, value); }
      serialNodes.delete(el);
    }
  }
  /**
   * The icons (Trade Flex, blur serials, Rolimon's profile) have ONE fixed
   * place: pinned to the right edge of the "Trade with … @handle" heading,
   * with their room reserved once and for all. They never move with the
   * length of the name, and Roblox's own ellipsis cuts a long name before
   * them. Anchored on the right, the Flex button (completed trades only)
   * appears on the left without shifting the other two.
   * The heading's position and padding are restored when the page changes.
   */
  const TOOLS_ROOM = 3 * 30 + 2 * 6 + 12;   // three buttons, their gaps, some air
  let headingSaved = null;                   // [element, property, value, priority][]
  function releaseHeading() {
    for (const [el, name, value, priority] of headingSaved || []) {
      if (value) el.style.setProperty(name, value, priority); else el.style.removeProperty(name);
    }
    headingSaved = null;
  }
  function placeTools(heading, handle) {
    if (headingSaved && headingSaved[0][0] !== heading) releaseHeading();
    if (!headingSaved) {
      headingSaved = ['position', 'padding-right'].map(name =>
        [heading, name, heading.style.getPropertyValue(name), heading.style.getPropertyPriority(name)]);
      // Some layouts put the @handle on its own line: keep it next to the name.
      if (handle && handle !== heading && heading.contains(handle) && getComputedStyle(handle).display === 'block') {
        headingSaved.push([handle, 'display', handle.style.getPropertyValue('display'), handle.style.getPropertyPriority('display')]);
        handle.style.setProperty('display', 'inline');
      }
      const cs = getComputedStyle(heading);
      const padding = parseFloat(cs.paddingRight) || 0;
      if (cs.position === 'static') heading.style.setProperty('position', 'relative');
      heading.style.setProperty('padding-right', `${padding + TOOLS_ROOM}px`, 'important');
      Object.assign(tools.style, { right: `${padding}px` });
    }
    if (tools.parentElement !== heading) heading.append(tools);
  }
  /**
   * Trade Flex shows off a done deal: only a completed trade can be flexed,
   * never an offer still pending or one that fell through. The offer headings
   * say so ("Items you gave"); the Completed tab of the URL stands in when
   * they don't.
   */
  function isCompleted(page) {
    if (!page?.ok || page.composer) return false;
    const phases = (page.sides || []).map(s => dom.phaseOf?.(s.heading?.textContent)).filter(Boolean);
    if (phases.length) return phases.every(p => p === 'done');
    return /[?&]tab=completed(?:&|$)/i.test(location.search);
  }
  function mountProfileLink(page) {
    const heading = page?.partnerId > 0 && page.tradeHeading?.isConnected ? page.tradeHeading : null;
    if (!heading) { flexControl?.remove(); serialControl?.remove(); profileLink?.remove(); profileLink = null; tools?.remove(); releaseHeading(); return; }
    if (!profileLink) {
      profileLink = document.createElement('a');
      profileLink.dataset.rn = 'rolimons-profile';
      profileLink.style.cssText = 'box-sizing:border-box;position:relative;flex:none;display:inline-flex;vertical-align:middle;align-items:center;justify-content:center;width:30px;height:28px;margin:0;border-radius:7px;border:1px solid rgba(128,170,210,.3);background:rgba(20,28,40,.45);color:#56baff;text-decoration:none;';
      const content = document.createElement('span');
      content.style.cssText = 'display:flex;align-items:center;justify-content:center;width:100%;height:100%;border-radius:inherit;';
      profileLink.append(content);
      const root = content.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = ':host{transition:background .15s,border-color .15s}:host(:hover){background:rgba(0,145,230,.22)!important;border-color:#56baff!important}:host(:focus-visible){outline:2px solid #56baff;outline-offset:3px}.external{position:absolute;right:3px;top:0;font:12px/1.2 Arial,sans-serif}@media(prefers-reduced-motion:reduce){:host{transition:none}}';
      const logo = document.createElement('img');
      logo.src = assetUrl('assets/rolimons-logo.webp'); logo.alt = '';
      logo.style.cssText = 'display:block;width:20px;height:20px;object-fit:contain;';
      const external = document.createElement('span'); external.className = 'external'; external.textContent = '↗';
      external.setAttribute('aria-hidden', 'true');
      root.append(style, logo, external); profileLink.target = '_blank'; profileLink.rel = 'noopener noreferrer';
    }
    const title = fr ? `Ouvrir le profil de ${page.handle || 'ce joueur'} sur Rolimon’s` : `Open ${page.handle || 'this player'} on Rolimon’s`;
    const url = `https://www.rolimons.com/player/${page.partnerId}`;
    if (profileLink.href !== url) profileLink.href = url;
    if (profileLink.title !== title) { profileLink.title = title; profileLink.setAttribute('aria-label', title); }
    if (!tools) {
      tools = document.createElement('span');
      tools.dataset.rn = 'trade-tools';
      tools.style.cssText = 'position:absolute;top:50%;right:0;transform:translateY(-50%);display:flex;align-items:center;gap:6px;margin:0;white-space:nowrap;z-index:1;';
    }
    if (profileLink.parentElement !== tools) tools.append(profileLink);
    placeTools(heading, page.tradeHandle);
    mountSerialControl();
    if (globalThis.RoNoteFlex && isCompleted(page)) {
      if (!flexControl) {
        flexControl = document.createElement('button');flexControl.type='button';flexControl.dataset.rn='trade-flex';
        flexControl.innerHTML='<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>';
        flexControl.title=fr?'Créer une image du trade':'Create a trade image';
        flexControl.setAttribute('aria-label',flexControl.title);
        flexControl.style.cssText=profileLink.style.cssText+'padding:0;cursor:pointer;color:#ffc94d;';
        flexControl.addEventListener('click',()=>{if(isCompleted(shownPage))globalThis.RoNoteFlex.open(shownPage,shownAnalysis);});
      }
      if (tools.firstElementChild!==flexControl)tools.prepend(flexControl);
    } else if (flexControl?.isConnected) {
      flexControl.remove(); globalThis.RoNoteFlex?.close();
    }
  }
  const clear = () => {
    flexControl?.remove(); globalThis.RoNoteFlex?.close();
    resetSerials(); serialControl?.remove();
    clearNearbyLines();
    restore(); host?.remove(); host = null; signature = ''; generation++;
    profileLink?.remove(); profileLink = null; tools?.remove();
    releaseHeading();
    for (const badge of badges.values()) { dropBadge(badge); }
    badges.clear();
    for (const total of totalBadges.values()) total.node.remove();
    totalBadges.clear(); clearInventories(); shownPage = null; shownAnalysis = null; analysisPending = false;
  };

  function isDivider(el) {
    if (!el || el === host || (el.textContent || '').trim() || el.querySelector?.('a,button,input,img')) return false;
    if (el.tagName === 'HR' || el.getAttribute?.('role') === 'separator' ||
        /(?:^|[\s_-])(?:divider|separator)(?:$|[\s_-])/i.test(el.className || '')) return true;
    // Roblox also uses empty divs with a CSS border instead of an HR.
    if (typeof getComputedStyle !== 'function') return false;
    const css = getComputedStyle(el);
    return parseFloat(css.height) <= 4 &&
      (parseFloat(css.borderTopWidth) > 0 || parseFloat(css.borderBottomWidth) > 0);
  }

  function boundary(first, second, parent) {
    let a = first, b = second;
    while (a.parentElement !== parent) a = a.parentElement;
    while (b.parentElement !== parent) b = b.parentElement;
    const candidates = [];
    // The line may sit a few levels down: the last thing of the first block,
    // the first thing of the second.
    for (let n = first.lastElementChild, d = 0; n && d < 4; n = n.lastElementChild, d++) candidates.push(n);
    for (let n = host && second.firstElementChild === host ? host.nextElementSibling : second.firstElementChild, d = 0; n && d < 4; n = n.firstElementChild, d++) candidates.push(n);
    for (let n = a.nextElementSibling; n && n !== b; n = n.nextElementSibling) candidates.push(n);
    return [...new Set(candidates.filter(isDivider))];
  }

  function replaceLine(first, second, lines) {
    restore();
    const override = (el, property, value) => {
      if (!el?.style?.setProperty) return;
      const before = el.style.getPropertyValue(property), priority = el.style.getPropertyPriority(property);
      el.style.setProperty(property, value, 'important');
      undo.push(() => { if (el.style.getPropertyValue(property) === value) {
        if (before) el.style.setProperty(property, before, priority); else el.style.removeProperty(property);
      } });
    };
    // Restore Roblox's own separator on navigation; never delete its nodes.
    override(first, 'border-bottom-width', '0px');
    override(second, 'border-top-width', '0px');
    for (const line of lines) override(line, 'display', 'none');
  }

  // Containers where an added child doesn't land where it is inserted:
  // a flex row lays it beside the others (pushing a column onto a new line),
  // and a grid auto-places it after the cells Roblox has positioned — at the
  // bottom, whatever its place in the DOM.
  function sideBySide(el) {
    if (!el || typeof getComputedStyle !== 'function') return false;
    const css = getComputedStyle(el);
    if (/grid/.test(css.display)) return true;
    if (/flex/.test(css.display)) return !css.flexDirection.startsWith('column');
    return false;
  }

  function place(parent, anchor) {
    if (host.parentElement !== parent || host.nextSibling !== anchor) parent.insertBefore(host, anchor);
  }

  /* ----------------------------------------------------------------------
   * Placing the banner on a page whose styles we don't know. Rather than
   * guessing what a flex box or a grid will do with an added child, each
   * candidate position is tried and MEASURED: kept only if the banner shows
   * where it should, full width, without moving anything we watch.
   * -------------------------------------------------------------------- */
  let placement = '', lastPlaceTry = 0;

  /* ----------------------------------------------------------------------
   * What RoNote sees on a trade page, kept for Settings > Maintenance >
   * "Copy the trade page diagnostic": the real page's structure, to fix
   * the reading without guessing. Local only, rewritten at most every 4 s.
   * -------------------------------------------------------------------- */
  let diagAt = 0;
  function skeleton(root, budget = 9000) {
    let out = '';
    const walk = (n, d) => {
      if (out.length > budget || d > 12) return;
      if (n.nodeType === 3) { const t = n.nodeValue.trim(); if (t) out += ' '.repeat(d) + JSON.stringify(t.slice(0, 40)) + '\n'; return; }
      if (n.nodeType !== 1 || /^(SCRIPT|STYLE|PATH|NOSCRIPT)$/i.test(n.tagName)) return;
      const css = getComputedStyle(n);
      const r = n.getBoundingClientRect();
      const cls = typeof n.className === 'string' ? n.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
      const lay = css.display + (/flex/.test(css.display) ? '/' + css.flexDirection : '') +
        (/grid/.test(css.display) ? '/' + css.gridTemplateColumns.split(' ').length + 'col' : '') +
        (css.overflow !== 'visible' ? ' ovf:' + css.overflow : '') + (css.position !== 'static' ? ' pos:' + css.position : '');
      const href = n.getAttribute('href');
      out += ' '.repeat(d) + '<' + n.tagName.toLowerCase() + (cls ? '.' + cls : '') + (n.dataset?.rn ? ' RN=' + n.dataset.rn : '') +
        (href ? ' href=' + href.replace(/^https?:\/\/[^/]+/, '').slice(0, 40) : '') +
        ' [' + lay + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + ']>\n';
      if (/^(IMG|SVG)$/i.test(n.tagName)) return;
      const kids = [...n.childNodes];
      const elements = kids.filter(k => k.nodeType === 1);
      let shown = 0;
      for (const k of kids) {
        if (k.nodeType === 1 && elements.length > 8 && ++shown > 4) { out += ' '.repeat(d + 1) + '…(' + elements.length + ' elements)\n'; break; }
        walk(k, d + 1);
      }
    };
    walk(root, 0);
    return out;
  }
  function writeDiag(page) {
    if (Date.now() - diagAt < 4000 || !page?.composer) return;
    diagAt = Date.now();
    try {
      const heads = [...(page.inventories || []), page.sides[0].heading, page.sides[1].heading].filter(Boolean);
      let root = heads[0]?.parentElement;
      while (root && !heads.every(h => root.contains(h))) root = root.parentElement;
      const inv = dom.inventoryItems?.(page.sides.map(s => s.root)) || [];
      const diag = {
        at: new Date().toISOString(), path: location.pathname.replace(/\d{3,}/g, '#'),
        version: alive() ? B.runtime.getManifest?.().version : '',
        placement, bannerShown: !!host?.isConnected,
        inventories: !!page.inventories,
        baskets: page.sides.map(s => ({ role: s.role, total: s.rapTotal, robux: s.robux,
          items: s.items.map(i => ({ id: i.assetId || i.bundleId || 0, names: i.names || [i.name], rap: i.rap, price: !!i.priceEl })) })),
        inventoryItems: inv.slice(0, 20).map(i => {
          const info = invInfo.get(invKey(i));
          const badge = invBadges.get(i.card || i.link);
          return { id: i.assetId || i.bundleId || 0, names: i.names || [i.name], rap: i.rap, price: !!i.priceEl,
            value: info ? info.value : 'pending', projected: info?.projected, chip: badge ? badge.mode : 'none' };
        }),
        inventoryCount: inv.length,
        skeleton: root ? skeleton(root) : 'no common root'
      };
      B.storage?.local?.set({ pageDiag: diag }).catch(() => {});
    } catch { /* diagnostic only */ }
  }
  const box = (el) => el.getBoundingClientRect();
  function fitHost() {
    const parent = host?.parentElement;
    if (!parent) return;
    const css = getComputedStyle(parent);
    const width = box(parent).width - (parseFloat(css.paddingLeft) || 0) - (parseFloat(css.paddingRight) || 0)
      - (parseFloat(css.borderLeftWidth) || 0) - (parseFloat(css.borderRightWidth) || 0);
    if (width > 0) host.style.maxWidth = width + 'px';
  }
  function placeMeasured(candidates, landed, watch) {
    if (!host) createHost();
    host.remove();
    restore();
    const before = watch.filter(Boolean).map(el => [el, box(el)]);
    for (const c of candidates) {
      if (!c?.parent?.isConnected) continue;
      // In place of the divider: its line (element or border) is hidden, never removed.
      if (c.a && c.b) replaceLine(c.a, c.b, c.lines || []);
      c.parent.insertBefore(host, c.anchor && c.anchor.parentElement === c.parent ? c.anchor : null);
      fitHost();
      const h = box(host);
      const still = before.every(([el, r]) => { const n = box(el); return Math.abs(n.left - r.left) < 2 && Math.abs(n.width - r.width) < 2; });
      if (h.height > 0 && h.width >= 160 && still && landed(h)) { placement = c.name; return true; }
      host.remove();
      restore();
    }
    return false;
  }
  const between = (h, above, below) => h.top >= box(above).bottom - 1 && h.bottom <= box(below).top + 1 &&
    h.left < box(below).right && h.right > box(below).left;

  function mountComposer(page) {
    const [first, second] = page.sides.map(s => s.root);
    const watch = [page.sides[0].heading, page.sides[1].heading, ...(page.inventories || [])];
    if (page.inventories) {
      // In place of the divider between "Your Inventory" and the partner's.
      const [mine, theirs] = page.inventories;
      let lca = mine.parentElement;
      while (lca && !lca.contains(theirs)) lca = lca.parentElement;
      if (lca && lca !== document.body) {
        let a = mine, b = theirs;
        while (a.parentElement !== lca) a = a.parentElement;
        while (b.parentElement !== lca) b = b.parentElement;
        // The bottom of my inventory: its last item, pager included.
        const mineEnd = a;
        const lines = a !== b ? boundary(a, b, lca) : [];
        const own = lines.find(l => l.parentElement === lca);
        const cands = [];
        if (a !== b) {
          cands.push({ name: 'divider', parent: lca, anchor: own || b, lines, a, b });
          cands.push({ name: 'before-theirs', parent: lca, anchor: b });
          cands.push({ name: 'end-of-mine', parent: a, anchor: null });
        }
        // Every level between the partner's title and the shared container.
        for (let n = theirs; n && n !== lca; n = n.parentElement) {
          cands.push({ name: 'above-title-' + cands.length, parent: n.parentElement, anchor: n });
        }
        const landed = (h) => h.top >= box(mineEnd).top && between(h, mine, theirs) &&
          // under the whole of my inventory, not just its title
          [...mineEnd.querySelectorAll('img')].every(img => box(img).bottom <= h.top + 1);
        // Every placement replaces the same inventory boundary, including
        // fallback positions where the first candidate did not fit.
        if (placeMeasured(cands.map(c => ({ ...c, a, b, lines })), landed, watch)) return true;
      }
    }
    // Otherwise between the "Total Value" of the offer and "Your Request".
    const from = page.sides[0].totalLabel || first;
    const to = page.sides[1].heading || second;
    let lca = from.parentElement;
    while (lca && !lca.contains(to)) lca = lca.parentElement;
    const cands = [];
    for (let n = to; lca && n && n !== lca; n = n.parentElement) cands.push({ name: 'above-request', parent: n.parentElement, anchor: n });
    for (let n = from; n && n !== first.parentElement; n = n.parentElement) {
      if (n.parentElement) cands.push({ name: 'under-offer-total', parent: n.parentElement, anchor: n.nextSibling });
    }
    if (placeMeasured(cands, (h) => between(h, from, to), watch)) return true;
    // Nothing measured right (hidden tab, page still loading): in the offer basket.
    if (!host) createHost();
    first.append(host);
    placement = 'fallback';
    return true;
  }

  function mount(page) {
    clearNearbyLines();
    restore();
    const [first, second] = page.sides.map(s => s.root);
    if (page.composer) return mountComposer(page);
    let parent = first.parentElement;
    while (parent && !parent.contains(second)) parent = parent.parentElement;
    if (!parent || parent === document.body || parent === document.documentElement) return false;
    // Locate the actual boundary before choosing a fallback near the heading.
    const lines = boundary(first, second, parent);
    let anchor = second;
    while (anchor.parentElement !== parent) anchor = anchor.parentElement;
    const heading = page.sides[1].heading;
    if (heading && second.contains(heading)) { parent = heading.parentElement; anchor = heading; }
    if (lines.length) { anchor = lines[0]; parent = anchor.parentElement; }
    // Same safety on an existing trade: inside the received offer instead.
    if (sideBySide(parent)) { parent = second; anchor = second.firstChild; lines.length = 0; }
    replaceLine(first, second, lines);
    if (!host?.isConnected) createHost();
    place(parent, anchor);
    return true;
  }

  function createHost() {
    host = document.createElement('div');
    host.dataset.rn = 'delta';
    host.style.cssText = 'display:block;box-sizing:border-box;width:100%;max-width:100%;min-width:0;flex:0 0 100%;grid-column:1 / -1;margin:12px 0;';
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    host._style = style;
    style.textContent = globalThis.RoNoteBanner ? globalThis.RoNoteBanner.css(bannerSettings) : `
      :host{color-scheme:dark;container-type:inline-size}*{box-sizing:border-box}
      .row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));overflow:hidden;border:1px solid rgba(255,255,255,.1);border-radius:8px;background:rgba(24,26,32,.94);font:600 13px/1.4 "Builder Sans",Arial,sans-serif;color:#f4f5f7}
      .cell{min-width:0;min-height:34px;display:flex;align-items:center;justify-content:center;gap:7px;padding:7px 10px;white-space:nowrap;font-variant-numeric:tabular-nums;transition:background-color .16s ease,color .16s ease}
      .cell+.cell{border-left:1px solid rgba(255,255,255,.09)}
      .cell[data-tone="up"]{background:rgba(45,212,126,.055)}
      .cell[data-tone="down"]{background:rgba(248,93,104,.055)}
      .cell[data-tone="neutral"]{color:#b5bac5}
      .arrow{width:13px;height:15px;flex:none;background:#36d889;clip-path:polygon(50% 0,100% 46%,69% 46%,69% 100%,31% 100%,31% 46%,0 46%)}
      .down{background:#ff6675;transform:rotate(180deg)}
      .flat{background:#858b99;clip-path:none;width:10px;height:2px;border-radius:1px}
      @container(max-width:360px){.cell{font-size:11px;gap:5px;padding:7px 5px;white-space:normal;text-align:center}}
      @media(prefers-reduced-motion:reduce){.cell{transition:none}}
    `;
    const row = document.createElement('div');
    row.className = 'row';
    row.setAttribute('role', 'status');
    row.setAttribute('aria-live', 'polite');
    for (const label of ['RAP', 'Value']) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.dataset.metric = label;
      const arrow = document.createElement('span');
      arrow.className = 'arrow flat';
      arrow.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      text.textContent = `${label} · …`;
      cell.append(arrow, text);
      row.append(cell);
    }
    shadow.append(style, row);
    host._row = row;
  }

  function missingWhy(a, field) {
    if (field === 'value' && a?.valueMissing === 'catalog') return fr ? 'Cotes Rolimon’s pas encore chargées.' : 'Rolimon’s values not loaded yet.';
    if (field === 'value' && a?.valueMissing === 'stale') return fr ? 'Cotes Rolimon’s trop anciennes.' : 'Rolimon’s values too old.';
    if (field === 'value' && a?.missingNames?.length) return (fr ? 'Aucun chiffre pour : ' : 'No figure for: ') + a.missingNames.join(', ');
    // Only the worker's answer carries valueMissing: without it, it never replied.
    if (field === 'value' && a && !('valueMissing' in a)) return fr ? 'Extension injoignable : recharge la page.' : 'Extension unreachable: reload the page.';
    return fr ? 'Données insuffisantes pour calculer cet écart.' : 'Insufficient data to calculate this difference.';
  }

  function render(a, pending = false) {
    shownAnalysis = a;
    learnProjected(a);
    if (shownPage) { renderItems(shownPage, a, pending); renderTotals(shownPage, a, pending); }
    const explanation = fr ? 'Reçu − donné, par rapport à ce que tu donnes. Robux inclus ; les montants reçus déjà nets ne sont pas taxés une seconde fois.' : 'Received − given, relative to what you give. Includes Robux; received amounts already shown net are not taxed again.';
    for (const [index, field] of ['rap', 'value'].entries()) {
      const label = index ? 'Value' : 'RAP';
      const cell = host._row.children[index];
      const items = a ? [...a.give.items, ...a.get.items] : [];
      const explicit = a?.[field + 'Available'];
      const available = a && (typeof explicit === 'boolean' ? explicit : !a.incomplete &&
        (field !== 'value' || (a.hasValues && !a.valueVeryStale)) && items.every(i => i[field] > 0));
      const delta = available ? a.get[field] - a.give[field] : 0;
      const pct = available && a.give[field] > 0 ? delta / a.give[field] * 100 : null;
      cell.dataset.tone = delta < 0 ? 'down' : delta > 0 ? 'up' : 'neutral';
      cell.children[0].className = `arrow ${delta < 0 ? 'down' : delta > 0 ? '' : 'flat'}`;
      const text = available
        ? `${signed(delta)} (${pct === null ? '—' : signed(Math.round(pct)) + '%'})`
        : `${label} · ${pending && field === 'value' ? '…' : '—'}`;
      if (cell.children[1].textContent !== text) cell.children[1].textContent = text;
      cell.title = available ? explanation +
        (a.valueStale ? (fr ? ' Cotes en cache, actualisation temporairement indisponible.' : 'Cached prices; refresh temporarily unavailable.') : '') +
        (field === 'value' && items.some(i => i.noValue) ? (fr ? ' RAP utilisé pour les objets sans value.' : ' RAP used for items without a value.') : '')
        : missingWhy(a, field);
    }
    tidyBannerBoundary();
  }

  async function update() {
    if (!alive()) return;
    lastUrl = location.href;
    if (!enabled || !onPage() || document.hidden) { clear(); clearInventories(); return; }
    let page;
    try { page = dom.readTradePage(); } catch { clear(); return; }
    mountProfileLink(page);
    updateInventories(page.ok ? page : null);
    if (!page.ok) { clear(); return; }
    const sig = location.href + '|' + dom.signatureOf(page);
    shownPage = page;
    // The page wasn't laid out yet when the banner was placed: measure again,
    // at most every 2 s, without dropping the analysis on its way.
    if (page.composer && sig === signature && host?.isConnected && placement === 'fallback' && Date.now() - lastPlaceTry > 2000) {
      lastPlaceTry = Date.now();
      mountComposer(page);
    }
    writeDiag(page);
    if (sig === signature && host?.isConnected && Date.now() < retryAt) {
      fitHost();
      tidyBannerBoundary();
      renderItems(page, shownAnalysis, analysisPending); renderTotals(page, shownAnalysis, analysisPending); return;
    }
    const changed = sig !== signature || !host?.isConnected;
    if (changed) {
      generation++;
      signature = sig;
      retries = 0;
      if (!mount(page)) return;
    }
    const local = dom.visibleAnalysis?.(page);
    const saved = cache.get(sig);
    if (saved && Date.now() - saved.at < 60000) {
      analysisPending = false;
      render(saved.analysis); retryAt = saved.at + 60000; return;
    }
    analysisPending = true;
    if (changed) render(good.get(sig) || local, !good.has(sig));
    retryAt = Date.now() + 60000;
    const current = generation;
    try {
      const result = await B.runtime.sendMessage({ type: 'ronote:page-analysis', page: dom.plain(page) });
      // A slow response must never overwrite a newly selected trade.
      if (current !== generation || !host?.isConnected) return;
      // The page moved while the worker answered: ask again at once rather
      // than sitting on the pending render until the 60 s cache expires.
      if (!onPage() || sig !== location.href + '|' + dom.signatureOf(dom.readTradePage())) { retryAt = 0; schedule(); return; }
      if (result?.why === 'off') { enabled = false; clear(); return; }
      analysisPending = false;
      let analysis = result?.analysis || local;
      const kept = good.get(sig);
      if (!analysis?.valueAvailable && kept) analysis = { ...kept,
        pageItems: kept.pageItems?.map((side, s) => side.map((item, i) => ({ ...item,
          instances: analysis?.pageItems?.[s]?.[i]?.instances ?? item.instances,
          matchedUaid: analysis?.pageItems?.[s]?.[i]?.matchedUaid ?? null }))) };
      else if (analysis?.valueAvailable) {
        good.set(sig, analysis);
        if (good.size > 40) good.delete(good.keys().next().value);
      }
      render(analysis);
      // Only a complete answer is kept for a minute; a missing Value is retried.
      if (result?.analysis?.valueAvailable) {
        cache.set(sig, { analysis, at: Date.now() });
        if (cache.size > 20) cache.delete(cache.keys().next().value);
        retries = 0;
      } else retryAt = nextRetry();
    } catch {
      if (!alive()) return;
      if (current === generation && host?.isConnected) { analysisPending = false; render(good.get(sig) || local); retryAt = nextRetry(); }
    }
  }
  function shutdown() {
    if (dead) return;
    dead = true;
    // May run before the rest of the script is set up: nothing here may throw.
    try { observer?.disconnect(); clearInterval(ticker); clearTimeout(timer); clearTimeout(projectedSave); } catch { /* not set up yet */ }
    try { clear(); clearInventories(); } catch { /* not set up yet, or page already gone */ }
  }
  function schedule() {
    if (timer || dead) return;
    timer = setTimeout(() => { timer = null; update(); }, 40);
  }
  observer = new MutationObserver(records => {
    if (!alive()) return;
    if (!onPage()) { if (host) clear(); return; }
    if (!enabled) return;
    if (records.some(r => [...r.addedNodes, ...r.removedNodes].some(n =>
      n === profileLink || n.contains?.(profileLink) || (n !== host && !n.dataset?.rn)) ||
      r.type === 'characterData' || r.type === 'attributes')) schedule();
  }).observe(document.documentElement, { childList: true, characterData: true, attributes: true, attributeFilter: ['href', 'title'], subtree: true });
  globalThis.addEventListener('popstate', schedule);
  globalThis.addEventListener('hashchange', schedule);
  globalThis.addEventListener('resize', schedule);
  globalThis.addEventListener('ronote:detail-ready', () => { generation++; cache.clear(); retryAt = 0; schedule(); });
  // React immediately to the Robux field while a trade is being composed.
  // Changing an input's live value does not necessarily mutate its attribute.
  document.addEventListener('input', event => {
    if (enabled && onPage() && event.target?.matches?.('input')) { retryAt = 0; schedule(); }
  }, true);
  document.addEventListener('scroll', schedule, true);
  // Back on the tab with a grey banner: ask again right away.
  const refreshIncomplete = () => {
    if (!document.hidden && shownPage && !shownAnalysis?.valueAvailable) { retryAt = 0; }
    schedule();
  };
  document.addEventListener('visibilitychange', refreshIncomplete);
  globalThis.addEventListener('focus', refreshIncomplete);
  // Also covers pushState navigation without DOM mutations and transient errors.
  ticker = setInterval(() => {
    if (!alive()) return;
    if (!document.hidden && (onPage() || host) &&
        (location.href !== lastUrl || Date.now() >= retryAt || (shownPage?.composer && !profileLink?.isConnected))) schedule();
  }, 2000);
  schedule();
})();
