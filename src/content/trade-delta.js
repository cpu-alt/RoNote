// Script classique du monde isolé : aucun import que la CSP de Roblox pourrait bloquer.
(() => {
  const B = globalThis.browser ?? globalThis.chrome;
  const dom = globalThis.RoNoteDom;
  if (!dom || globalThis.__rnDelta) return;
  globalThis.__rnDelta = true;
  // Recharger ou mettre à jour l'extension laisse cette copie tourner dans les
  // onglets ouverts, coupée d'elle : chaque appel chrome.* lève alors « Extension
  // context invalidated ». Une copie orpheline retire ce qu'elle a posé et s'arrête.
  let dead = false, observer = null, ticker = 0;
  const alive = () => {
    if (dead) return false;
    try { if (B?.runtime?.id) return true; } catch { /* invalidated */ }
    shutdown();
    return false;
  };
  const assetUrl = (path) => { try { return B.runtime.getURL(path); } catch { return ''; } };
  const fr = (document.documentElement.lang || navigator.language || '').startsWith('fr');
  // Groupés comme les chiffres de Roblox : « 14 996 » en français, « 14,996 » en anglais.
  const number = new Intl.NumberFormat(fr ? 'fr-FR' : 'en-US', { maximumFractionDigits: 0 });
  const deltaNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + deltaNumber.format(Math.abs(n));
  // Les textes de la page, dans la langue de Roblox : écrits une fois ici.
  const TEXT = fr ? {
    projected: 'Projected : RAP gonflé par des reventes, chiffre peu fiable',
    currentValue: 'Cote Rolimon’s actuelle',
    rapUsed: 'RAP actuel utilisé : aucune Value publiée pour cet objet.',
    valueMissing: 'Cote temporairement indisponible',
    noValue: 'Pas de Value publiée pour cet objet',
    totalLabel: 'Value Rolimon’s :',
    totalOk: 'Total selon les cotes Rolimon’s, Robux inclus',
    totalMissing: 'Total Value temporairement indisponible',
    copyHistory: 'Historique de cet exemplaire sur Rolimon’s',
    copyUnknown: 'Historique indisponible : identifiant de cet exemplaire non reçu.',
    showSerials: 'Afficher les serials', blurSerials: 'Flouter les serials',
    profile: (who) => `Ouvrir le profil de ${who || 'ce joueur'} sur Rolimon’s`,
    flex: 'Créer une image du trade',
    catalog: 'Cotes Rolimon’s pas encore chargées.',
    stale: 'Cotes Rolimon’s trop anciennes.',
    noFigure: 'Aucun chiffre pour : ',
    unreachable: 'Extension injoignable : recharge la page.',
    insufficient: 'Données insuffisantes pour calculer cet écart.',
    explanation: 'Reçu − donné, par rapport à ce que tu donnes. Robux inclus ; les montants reçus déjà nets ne sont pas taxés une seconde fois.',
    cached: ' Cotes en cache, actualisation temporairement indisponible.',
    rapForUnvalued: ' RAP utilisé pour les objets sans value.'
  } : {
    projected: 'Projected: RAP inflated by resales, unreliable figure',
    currentValue: 'Current Rolimon’s value',
    rapUsed: 'Current RAP used: no published value for this item.',
    valueMissing: 'Value temporarily unavailable',
    noValue: 'No published value for this item',
    totalLabel: 'Rolimon’s Value:',
    totalOk: 'Total using Rolimon’s values, including Robux',
    totalMissing: 'Total Value temporarily unavailable',
    copyHistory: 'This copy’s history on Rolimon’s',
    copyUnknown: 'History unavailable: this copy’s ID has not been received.',
    showSerials: 'Show serials', blurSerials: 'Blur serials',
    profile: (who) => `Open ${who || 'this player'} on Rolimon’s`,
    flex: 'Create a trade image',
    catalog: 'Rolimon’s values not loaded yet.',
    stale: 'Rolimon’s values too old.',
    noFigure: 'No figure for: ',
    unreachable: 'Extension unreachable: reload the page.',
    insufficient: 'Insufficient data to calculate this difference.',
    explanation: 'Received − given, relative to what you give. Includes Robux; received amounts already shown net are not taxed again.',
    cached: ' Cached prices; refresh temporarily unavailable.',
    rapForUnvalued: ' RAP used for items without a value.'
  };
  // La liste des trades (/trades) et la page de création d'un trade, ouverte
  // depuis un profil (/users/123/trade), avec ou sans préfixe de langue (/fr/…).
  const onPage = () => /^(?:\/[a-z]{2}(?:[-_][a-z]{2})?)?\/(?:trades|users\/\d+\/trade)(?:\/|$)/i.test(location.pathname);
  let host, profileLink, tools, signature = '', generation = 0, timer, retryAt = 0, lastUrl = location.href;
  // Une réponse incomplète (catalogue encore en chargement, détail du trade pas
  // encore capté parce que Roblox l'a redessiné depuis son propre cache) se
  // redemande vite, puis de moins en moins souvent : attendre une minute entière
  // laissait le bandeau gris jusqu'au rechargement de la page.
  const RETRY_STEPS = [1500, 3000, 6000, 12000, 25000];
  let retries = 0;
  const nextRetry = () => Date.now() + (RETRY_STEPS[retries++] ?? 60000);
  const cache = new Map();
  const badges = new Map();
  const totalBadges = new Map();
  let shownPage, shownAnalysis, analysisPending = false;
  // La dernière réponse complète de chaque trade : une réponse plus tardive sans la
  // Value (worker réveillé sans ses caches, limite de débit Roblox) ne l'efface pas.
  const good = new Map();
  // Réglages > Analyse des values. Lu une fois, puis suivi en direct.
  let enabled = true;
  // L'allure du badge projected (Réglages > Analyse des values), image comprise.
  const look = { color: '', size: 'm', shape: 'rounded', corner: 'left', image: '' };
  const lookOf = (st) => ({ color: st?.projectedColor || '', size: st?.projectedSize || 'm',
    shape: st?.projectedShape || 'rounded', corner: st?.projectedCorner === 'right' ? 'right' : 'left' });
  const lookKey = (l) => [l.color, l.size, l.shape, l.corner].join('|');
  // La value Rolimon's sous chaque objet et les deux totaux (Réglages > Apparence).
  let itemValues = true;
  // Diamant « rare » et Lucky Cat (content/item-marks.js), dans le coin opposé au
  // badge projected. `lucky` est l'exemplaire tiré par Rolimon's, gardé par le worker.
  let showRare = true, showLucky = true, lucky = null, luckyAskedAt = 0;
  const setLucky = (v) => { const next = v?.uaid ? v : null; if (next?.uaid !== lucky?.uaid) { lucky = next; schedule(); } };
  // Couleurs, style et taille du bandeau : tous les réglages sont gardés,
  // content/delta-banner.js y prend ce qu'il lui faut.
  let bannerSettings = {};
  const bannerKey = (st) => ['bannerGain', 'bannerLoss', 'bannerStyle', 'bannerSize', 'bannerShow', 'bannerFormat', 'bannerPct']
    .map(k => String(st?.[k] ?? '')).join('|');
  function restyleBanner() {
    if (host?._style && globalThis.RoNoteBanner) host._style.textContent = globalThis.RoNoteBanner.css(bannerSettings);
  }
  if (alive()) B.storage?.local?.get(['settings', 'projectedIcon', 'luckyCat']).then(got => {
    enabled = got?.settings?.pageDelta !== false;
    itemValues = got?.settings?.pageItemValues !== false;
    showRare = got?.settings?.showRare !== false;
    showLucky = got?.settings?.showLuckyCat !== false;
    lucky = got?.luckyCat?.uaid ? got.luckyCat : null;
    Object.assign(look, lookOf(got?.settings), { image: got?.projectedIcon || '' });
    bannerSettings = got?.settings || {};
    restyleBanner();
    if (!enabled) clear(); else { restyleFlags(); schedule(); }
  }).catch(() => {});
  if (alive()) B.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local' || dead) return;
    if (changes.projectedIcon) { look.image = changes.projectedIcon.newValue || ''; restyleFlags(); }
    if (changes.luckyCat) setLucky(changes.luckyCat.newValue);
    // Nouvelle table Rolimon's : on redemande tout de suite, sans attendre la minute.
    if (changes.roli && enabled) { cache.clear(); retryAt = 0; schedule(); }
    if (!changes.settings) return;
    const nextSettings = changes.settings.newValue || {};
    if (bannerKey(nextSettings) !== bannerKey(bannerSettings)) {
      bannerSettings = nextSettings; restyleBanner();
      if (host?.isConnected && shownAnalysis !== undefined) render(shownAnalysis, analysisPending);
    }
    const nextLook = lookOf(changes.settings.newValue);
    if (lookKey(nextLook) !== lookKey(look)) { Object.assign(look, nextLook); restyleFlags(); }
    const nextItems = nextSettings.pageItemValues !== false;
    if (nextItems !== itemValues) { itemValues = nextItems; retryAt = 0; schedule(); }
    const nextRare = nextSettings.showRare !== false, nextLucky = nextSettings.showLuckyCat !== false;
    if (nextRare !== showRare || nextLucky !== showLucky) { showRare = nextRare; showLucky = nextLucky; luckyAskedAt = 0; schedule(); }
    const next = changes.settings.newValue?.pageDelta !== false;
    if (next === enabled) return;
    enabled = next; cache.clear(); good.clear();
    if (!enabled) clear(); else { retryAt = 0; schedule(); }
  });
  const itemKey = i => i.bundleId ? 'b' + i.bundleId : 'a' + i.assetId;

  // Avertissement jaune dans le coin d'un objet « projected » : son RAP a été
  // gonflé par des reventes entre complices, ses chiffres ne sont pas fiables.
  const warnTitle = TEXT.projected;

  // Objets déjà connus pour être projected (ou non), gardés d'une visite à
  // l'autre : l'avertissement s'affiche dès la première image, sans attendre le worker.
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
      // Seuls les positifs valent d'être gardés ; un objet inconnu attend, simplement.
      const out = {};
      for (const [k, v] of [...projectedKnown].slice(-600)) if (v) out[k] = 1;
      if (alive()) B.storage?.local?.set({ [PROJ_KEY]: out }).catch(() => {});
    }, 1500);
  }

  function dropBadge(badge) {
    badge.node.remove();
    badge.shelf?.remove();
    dropFlag(badge);
    dropMarks(badge);
  }
  // Le numéro de série que Roblox écrit sur une carte (« #1371 »), pour reconnaître l'exemplaire Lucky Cat.
  function serialOf(card) {
    for (const leaf of card.querySelectorAll('*')) {
      if (leaf.childElementCount || leaf.closest('[data-rn]')) continue;
      const text = (leaf.textContent || '').trim();
      if (/^#\s*\d+$/.test(text)) return text.replace(/\D/g, '');
    }
    return '';
  }
  const marksCorner = () => (look.corner === 'right' ? 'left' : 'right');
  /**
   * Un coin de la carte pour nos repères, posé d'un coup et jamais déplacé :
   * une boîte de hauteur nulle en tête de carte, quels que soient les styles
   * de Roblox et que la vignette soit chargée ou non. Une carte en ligne
   * (vignette, nom et prix côte à côte) écraserait cette boîte parmi les
   * autres : le repère termine alors la ligne. `corner` n'est rendu qu'en
   * surimpression, pour que restyleFlags puisse le changer de côté.
   */
  function cornerBox(card, name, side, clickable) {
    const box = document.createElement('span');
    box.dataset.rn = name;
    const corner = document.createElement('span');
    const row = sideBySide(card);
    const events = clickable ? '' : 'pointer-events:none;';
    box.style.cssText = row
      ? `display:block;position:static;flex:none;margin:0 6px 0 0;align-self:center;line-height:0;${events}`
      : 'display:block;position:relative;width:100%;height:0;margin:0;padding:0;pointer-events:none;';
    corner.style.cssText = row
      ? `position:static;display:block;line-height:0;${events}`
      : `position:absolute;top:7px;${side}:7px;z-index:3;pointer-events:${clickable ? 'auto' : 'none'};line-height:0;`;
    const root = corner.attachShadow({ mode: 'closed' });
    box.append(corner);
    card.prepend(box);
    return { box, corner: row ? null : corner, root };
  }
  function showMarks(badge, card, rare, isLucky) {
    const marks = { rare: showRare && !!rare, lucky: showLucky && isLucky ? lucky : null };
    if ((!marks.rare && !marks.lucky) || !globalThis.RoNoteMarks) { dropMarks(badge); return; }
    const key = `${marks.rare ? 1 : 0}|${marks.lucky?.uaid || ''}`;
    if (badge.marks?.isConnected && badge.marks.parentElement === card && badge.marksKey === key) return;
    dropMarks(badge);
    const { box, corner, root } = cornerBox(card, 'item-marks', marksCorner(), true);
    globalThis.RoNoteMarks.fill(root, marks);
    badge.marks = box;
    badge.marksKey = key;
    badge.marksCorner = corner;
  }
  function dropMarks(badge) {
    badge.marks?.remove();
    badge.marks = null;
    badge.marksCorner = null;
  }
  function showFlag(badge, card, projected) {
    if (!projected) { dropFlag(badge); return; }
    if (badge.flag?.isConnected && badge.flag.parentElement === card) return;
    dropFlag(badge);
    if (!globalThis.RoNoteBadge) return;
    const { box, corner, root } = cornerBox(card, 'item-projected', look.corner, false);
    globalThis.RoNoteBadge.fill(root, look, warnTitle);
    badge.flag = box;
    badge.flagRoot = root;
    badge.flagCorner = corner;
  }
  // Nouvelle couleur, taille, forme, coin ou image : les badges se redessinent sur place.
  function restyleFlags() {
    for (const badge of [...badges.values(), ...invBadges.values()]) {
      if (badge.flagRoot) globalThis.RoNoteBadge?.fill(badge.flagRoot, look, warnTitle);
      if (badge.flagCorner) {
        badge.flagCorner.style.left = look.corner === 'left' ? '7px' : '';
        badge.flagCorner.style.right = look.corner === 'right' ? '7px' : '';
      }
      if (badge.marksCorner) {
        badge.marksCorner.style.left = marksCorner() === 'left' ? '7px' : '';
        badge.marksCorner.style.right = marksCorner() === 'right' ? '7px' : '';
      }
    }
  }
  function dropFlag(badge) {
    badge.flag?.remove();
    badge.flag = null;
    badge.flagRoot = null;
  }
  // La Value a sa petite ligne sous le RAP, alignée sur l'icône Robux de Roblox.
  // Si une carte de hauteur fixe la coupe, elle passe sur la vignette.
  const CHIP_CSS = `
    :host{display:block;clear:both;width:max-content;max-width:100%;margin:-2px 0 0;line-height:1;color:inherit}
    :host([data-below]) .v{padding:0;gap:4px;line-height:1.1;background:none;border:0;box-shadow:none}
    :host([data-inline]){display:inline-flex;vertical-align:middle;clear:none;width:auto;flex:none;margin:0 0 0 .75em}
    :host([data-inline]) .v{padding:0;gap:4px;line-height:inherit;background:none;border:0;box-shadow:none}
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
  // La pastille est-elle vraiment visible ? Dans sa carte, sur la ligne de son RAP,
  // et coupée par aucun ancêtre qui masque ses débordements (cartes de hauteur fixe, points de suspension).
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
    if (badge.mode === 'inline') {
      // Pas la place d'une ligne à elle (paniers sur une ligne) : la Value se met sur
      // la ligne du RAP, juste après le montant. Jamais dans l'élément du montant :
      // le lecteur de page le cherche comme une feuille sans enfant.
      node.dataset.inline = '1'; delete node.dataset.below; delete node.dataset.over;
      node.style.display = '';
      badge.label.textContent = '';
      if (node.previousElementSibling !== badge.anchor) badge.anchor.after(node);
    } else if (badge.mode === 'below') {
      node.dataset.below = '1'; delete node.dataset.over; delete node.dataset.inline;
      badge.label.textContent = '';
      // Placée juste après la ligne du RAP, la Value commence exactement au même
      // endroit, même quand le nombre est découpé en plusieurs spans.
      if (node.previousElementSibling !== badge.line) badge.line.after(node);
    } else if (badge.mode === 'overlay') {
      // Un panier compact n'a pas la place d'une autre ligne. On ne couvre jamais
      // sa vignette ni ses boutons d'une pastille flottante.
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
    if (badge.mode === 'inline' && !anchor) badge.mode = 'overlay';
    if (badge.mode !== 'overlay' && badge.mode !== 'inline') badge.mode = line ? 'below' : 'overlay';
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
    const where = badge.mode === 'overlay' ? badge.shelf : badge.mode === 'inline' ? anchor.parentElement : line?.parentElement;
    if (!badge.node.isConnected || badge.node.parentElement !== where ||
        (badge.mode === 'below' && badge.node.previousElementSibling !== line) ||
        (badge.mode === 'inline' && badge.node.previousElementSibling !== anchor)) seat(badge, card);
    return badge;
  }

  function paintBadge(badge, text, state, title, card) {
    // Values coupées : la pastille reste en place, cachée, pour le badge projected.
    if (!itemValues) { badge.node.style.display = 'none'; badge.checked = false; return; }
    if (badge.mode !== 'overlay' && badge.node.style.display === 'none') badge.node.style.display = '';
    const grew = badge.value.textContent !== text;
    if (grew) badge.value.textContent = text;
    if (badge.pill.dataset.state !== state) badge.pill.dataset.state = state;
    badge.pill.title = title;
    // Vérifié quand le texte change : un nombre plus long peut ne plus tenir. Sous
    // le RAP d'abord, puis sur sa ligne, et cachée seulement si rien ne tient.
    if (card && (grew || !badge.checked) && badge.mode !== 'overlay' && !chipVisible(badge, card)) {
      badge.mode = badge.mode === 'below' && badge.anchor?.isConnected ? 'inline' : 'overlay';
      seat(badge, card);
      if (badge.mode === 'inline' && !chipVisible(badge, card)) { badge.mode = 'overlay'; seat(badge, card); }
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
      label.textContent = TEXT.totalLabel;
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
    // Même libellé et même montant que Roblox, typographie du thème comprise.
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
    if (!itemValues) page = null;
    for (const [index, side] of (page?.sides || []).entries()) {
      const total = ensureTotal(side);
      if (!total) continue;
      keep.add(side.root);
      const fallback = side.role === 'give' ? analysis?.give?.value : side.role === 'get' ? analysis?.get?.value : null;
      const value = analysis?.pageTotals?.[index] ?? fallback;
      const available = !!analysis?.valueAvailable && Number.isFinite(value);
      const text = available ? number.format(value) : pending ? '…' : '—';
      if (total.value.textContent !== text) total.value.textContent = text;
      const title = available ? TEXT.totalOk : TEXT.totalMissing;
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
        // Un objet lu par son nom reçoit son identifiant du worker : on compare le nom.
        const matched = info && (itemKey(info) === itemKey(item) ||
          (!item.assetId && !item.bundleId && info.name && info.name === item.name));
        const available = matched && Number.isFinite(info.value) && info.value > 0;
        const rapFallback = matched && info.noValue && Number.isFinite(item.rap) && item.rap >= 0;
        paintBadge(badge, available ? number.format(info.value) : rapFallback ? number.format(item.rap) : pending ? '…' : '—',
          available || rapFallback ? 'ok' : pending ? 'wait' : 'none',
          available ? TEXT.currentValue : rapFallback ? TEXT.rapUsed : TEXT.valueMissing, card);
        showFlag(badge, card, matched && typeof info.projected === 'boolean'
          ? info.projected : !!projectedKnown.get(itemKey(item)));
        showMarks(badge, card, matched && !!info.rare, !!globalThis.RoNoteMarks?.isLucky(lucky,
          { uaid: matched ? info.matchedUaid : null, assetId: item.assetId || info?.assetId, serial: serialOf(card) }));
      }
    }
    for (const [card, badge] of badges) if (!keep.has(card)) { dropBadge(badge); badges.delete(card); }
  }
  /* ----------------------------------------------------------------------
   * Les deux inventaires de la page de création d'un trade : value et badge
   * projected sur chaque objet affiché, page après page. Les réponses sont
   * gardées par objet : remonter ou changer de page redessine aussitôt, sans redemander.
   * -------------------------------------------------------------------- */
  const invBadges = new Map();
  const invInfo = new Map();          // clé d'objet -> { value, projected } selon le worker
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
      if (info?.known && info.value) paintBadge(badge, number.format(info.value), 'ok', TEXT.currentValue, card);
      else if (info?.known && Number.isFinite(item.rap) && item.rap >= 0) paintBadge(badge, number.format(item.rap), 'ok', TEXT.rapUsed, card);
      else paintBadge(badge, info?.known ? '—' : '…', info?.known ? 'none' : 'wait', TEXT.noValue, card);
      showFlag(badge, card, !!info?.projected);
      showMarks(badge, card, !!info?.rare, !!globalThis.RoNoteMarks?.isLucky(lucky, { assetId: item.assetId, serial: serialOf(card) }));
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
      // Table pas encore chargée : rien n'est gardé, le passage suivant redemande.
      if (!res?.ready) {
        invRetryAt = Date.now() + 8000;
        setTimeout(schedule, 8050);
        return;
      }
      // Inconnu ou absent de la réponse : redemandé dans 8 s.
      const unknown = (key) => { retryUnknownAt = Date.now() + 8000; invInfo.set(key, { known: false, retryAt: retryUnknownAt }); };
      const returned = new Set((res.items || []).map(r => r.key));
      for (const item of missing.slice(0, 150)) if (!returned.has(item.key)) unknown(item.key);
      for (const r of res.items || []) {
        if (r.known === false) unknown(r.key);
        else invInfo.set(r.key, { known: true, value: r.value || 0, projected: !!r.projected, rare: !!r.rare });
      }
      if (invInfo.size > 3000) invInfo.delete(invInfo.keys().next().value);
    } catch {
      if (!alive()) return;
      invRetryAt = Date.now() + 8000;
      setTimeout(schedule, 8050);
    } finally {
      invAsking = false;
      // Les cartes visibles ont pu changer pendant la requête : on les relit
      // maintenant, pour qu'aucun lot ne se perde.
      schedule();
      if (retryUnknownAt) setTimeout(schedule, Math.max(50, retryUnknownAt - Date.now() + 50));
    }
    if (enabled && onPage()) {
      const again = dom.inventoryItems?.((shownPage?.sides || []).map(s => s.root));
      if (again) renderInventories(again);
    }
  }

  /**
   * Les styles que RoNote pose sur les éléments de Roblox (filets masqués,
   * place des outils) : chaque propriété garde sa valeur d'origine, rendue
   * telle quelle au départ. Rien de Roblox n'est jamais supprimé.
   */
  function borrowStyle(saved, el, name, value, priority = 'important') {
    if (!saved.some(([e, n]) => e === el && n === name)) {
      saved.push([el, name, el.style.getPropertyValue(name), el.style.getPropertyPriority(name)]);
    }
    el.style.setProperty(name, value, priority);
  }
  function returnStyles(saved) {
    for (const [el, name, value, priority] of saved.splice(0)) {
      if (value) el.style.setProperty(name, value, priority); else el.style.removeProperty(name);
    }
  }

  let undo = [];
  const nearbyLines = [];
  const clearNearbyLines = () => returnStyles(nearbyLines);
  function tidyBannerBoundary() {
    if (!host?.isConnected) return;
    const h = host.getBoundingClientRect();
    if (!h.width || !h.height) return;
    const hide = (el, property, value) => borrowStyle(nearbyLines, el, property, value);
    // Le filet qui reste peut appartenir à un conteneur, ou être un fond d'un
    // pixel plutôt qu'un <hr>. Seule la frontière immédiate est examinée.
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
  // En capture, avant le lien de la vignette et les écouteurs de React. Certains
  // badges sont dans le lien du catalogue, d'autres ont pointer-events:none.
  document.addEventListener('click', event => {
    for (const node of event.composedPath?.() || []) {
      const rec = serialNodes.get(node);
      if (rec) { rec.click(event); return; }
    }
  }, true);
  /** Un numéro de série rendu tel que Roblox l'avait affiché. */
  function releaseSerial(el, rec) {
    el.style.filter = rec.filter;
    el.style.cursor = rec.cursor;
    el.style.pointerEvents = rec.pointerEvents;
    el.removeEventListener('click', rec.click, true);
    el.removeEventListener('keydown', rec.key, true);
    for (const [name, value] of rec.attrs) {
      if (value === null) el.removeAttribute(name); else el.setAttribute(name, value);
    }
    serialNodes.delete(el);
  }
  function resetSerials() {
    for (const [el, rec] of serialNodes) releaseSerial(el, rec);
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
    const label = serialHidden ? TEXT.showSerials : TEXT.blurSerials;
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
      // L'étoile et le numéro sont souvent voisins dans un même petit badge.
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
          el.setAttribute('aria-label', TEXT.copyHistory);
        } else {
          for (const [name, value] of rec.attrs) { if (name === 'title') continue; if (value === null) el.removeAttribute(name); else el.setAttribute(name, value); }
        }
        const hint = url ? TEXT.copyHistory : TEXT.copyUnknown;
        if (el.getAttribute('title') !== hint) el.setAttribute('title', hint);
      }
    }
    for (const [el, rec] of serialNodes) if (!live.has(el)) releaseSerial(el, rec);
  }
  /**
   * Les icônes (Trade Flex, serials floutés, profil Rolimon's) ont UNE place
   * fixe : contre le bord droit du titre « Trade avec … @pseudo », leur place
   * réservée une fois pour toutes. Elles ne bougent pas avec la longueur du nom :
   * les points de suspension de Roblox coupent un nom long avant elles. Ancré à
   * droite, le bouton Flex (trades terminés seulement) apparaît à gauche sans
   * décaler les deux autres. Le titre retrouve sa position et sa marge quand la page change.
   */
  const TOOLS_ROOM = 3 * 30 + 2 * 6 + 12;   // trois boutons, leurs écarts, un peu d'air
  const headingSaved = [];   // voir borrowStyle
  let toolsHeading = null;
  function releaseHeading() {
    returnStyles(headingSaved);
    toolsHeading = null;
  }
  function placeTools(heading, handle) {
    if (toolsHeading && toolsHeading !== heading) releaseHeading();
    if (!toolsHeading) {
      toolsHeading = heading;
      // Certaines mises en page posent le @pseudo sur sa propre ligne : il reste à côté du nom.
      if (handle && handle !== heading && heading.contains(handle) && getComputedStyle(handle).display === 'block') {
        borrowStyle(headingSaved, handle, 'display', 'inline', '');
      }
      const cs = getComputedStyle(heading);
      const padding = parseFloat(cs.paddingRight) || 0;
      if (cs.position === 'static') borrowStyle(headingSaved, heading, 'position', 'relative', '');
      borrowStyle(headingSaved, heading, 'padding-right', `${padding + TOOLS_ROOM}px`);
      Object.assign(tools.style, { right: `${padding}px` });
    }
    if (tools.parentElement !== heading) heading.append(tools);
  }
  /**
   * Trade Flex montre une affaire conclue : seul un trade terminé se flexe,
   * jamais une offre en attente ou tombée à l'eau. Les titres des offres le
   * disent (« Items you gave ») ; l'onglet Completed de l'URL prend le relais
   * quand ils se taisent.
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
    const title = TEXT.profile(page.handle);
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
        flexControl = document.createElement('button');
        flexControl.type = 'button';
        flexControl.dataset.rn = 'trade-flex';
        flexControl.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>';
        flexControl.title = TEXT.flex;
        flexControl.setAttribute('aria-label', flexControl.title);
        flexControl.style.cssText = profileLink.style.cssText + 'padding:0;cursor:pointer;color:#ffc94d;';
        flexControl.addEventListener('click', () => { if (isCompleted(shownPage)) globalThis.RoNoteFlex.open(shownPage, shownAnalysis); });
      }
      if (tools.firstElementChild !== flexControl) tools.prepend(flexControl);
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
    // Roblox utilise aussi des div vides avec une bordure CSS au lieu d'un HR.
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
    // Le filet peut se cacher quelques niveaux plus bas : le dernier élément du
    // premier bloc, le premier du second.
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
    // Le séparateur de Roblox revient à la navigation ; ses nœuds ne sont jamais supprimés.
    override(first, 'border-bottom-width', '0px');
    override(second, 'border-top-width', '0px');
    for (const line of lines) override(line, 'display', 'none');
  }

  // Conteneurs où un enfant ajouté n'atterrit pas là où on l'insère : une rangée
  // flex le pose à côté des autres (et repousse une colonne à la ligne), une
  // grille le place après les cellules positionnées par Roblox — en bas, quelle
  // que soit sa place dans le DOM.
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
   * Placer le bandeau sur une page dont on ne connaît pas les styles. Plutôt que
   * de deviner ce qu'une flexbox ou une grille fera d'un enfant ajouté, chaque
   * position candidate est essayée et MESURÉE : gardée seulement si le bandeau
   * apparaît où il doit, sur toute la largeur, sans rien déplacer de ce qu'on surveille.
   * -------------------------------------------------------------------- */
  let placement = '', lastPlaceTry = 0;

  /* ----------------------------------------------------------------------
   * Ce que RoNote voit d'une page de trade, gardé pour Réglages > Maintenance >
   * « Copier le diagnostic de la page » : la structure réelle de la page, pour
   * corriger la lecture sans deviner. Local seulement, réécrit au plus toutes les 4 s.
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
      // À la place du séparateur : son filet (élément ou bordure) est masqué, jamais supprimé.
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
      // À la place du séparateur entre « Your Inventory » et l'inventaire du partenaire.
      const [mine, theirs] = page.inventories;
      let lca = mine.parentElement;
      while (lca && !lca.contains(theirs)) lca = lca.parentElement;
      if (lca && lca !== document.body) {
        let a = mine, b = theirs;
        while (a.parentElement !== lca) a = a.parentElement;
        while (b.parentElement !== lca) b = b.parentElement;
        // Le bas de mon inventaire : son dernier objet, pagination comprise.
        const mineEnd = a;
        const lines = a !== b ? boundary(a, b, lca) : [];
        const own = lines.find(l => l.parentElement === lca);
        const cands = [];
        if (a !== b) {
          cands.push({ name: 'divider', parent: lca, anchor: own || b, lines, a, b });
          cands.push({ name: 'before-theirs', parent: lca, anchor: b });
          cands.push({ name: 'end-of-mine', parent: a, anchor: null });
        }
        // Chaque niveau entre le titre du partenaire et le conteneur commun.
        for (let n = theirs; n && n !== lca; n = n.parentElement) {
          cands.push({ name: 'above-title-' + cands.length, parent: n.parentElement, anchor: n });
        }
        const landed = (h) => h.top >= box(mineEnd).top && between(h, mine, theirs) &&
          // sous tout mon inventaire, pas seulement son titre
          [...mineEnd.querySelectorAll('img')].every(img => box(img).bottom <= h.top + 1);
        // Chaque placement remplace la même frontière entre inventaires, y compris les
        // positions de repli quand le premier candidat ne tenait pas.
        if (placeMeasured(cands.map(c => ({ ...c, a, b, lines })), landed, watch)) return true;
      }
    }
    // Sinon, entre le « Total Value » de l'offre et « Your Request ».
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
    // Aucune mesure juste (onglet caché, page en chargement) : dans le panier de l'offre.
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
    // On cherche la vraie frontière avant de se replier près du titre.
    const lines = boundary(first, second, parent);
    let anchor = second;
    while (anchor.parentElement !== parent) anchor = anchor.parentElement;
    const heading = page.sides[1].heading;
    if (heading && second.contains(heading)) { parent = heading.parentElement; anchor = heading; }
    if (lines.length) { anchor = lines[0]; parent = anchor.parentElement; }
    // Même prudence sur un trade existant : dans l'offre reçue, plutôt.
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
    if (field === 'value' && a?.valueMissing === 'catalog') return TEXT.catalog;
    if (field === 'value' && a?.valueMissing === 'stale') return TEXT.stale;
    if (field === 'value' && a?.missingNames?.length) return TEXT.noFigure + a.missingNames.join(', ');
    // Seule la réponse du worker porte `valueMissing` : sans elle, il n'a jamais répondu.
    if (field === 'value' && a && !('valueMissing' in a)) return TEXT.unreachable;
    return TEXT.insufficient;
  }

  function render(a, pending = false) {
    shownAnalysis = a;
    learnProjected(a);
    if (shownPage) { renderItems(shownPage, a, pending); renderTotals(shownPage, a, pending); }
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
      const text = !available ? `${label} · ${pending && field === 'value' ? '…' : '—'}`
        : globalThis.RoNoteBanner ? globalThis.RoNoteBanner.amount(delta, pct, bannerSettings)
        : `${signed(delta)} (${pct === null ? '—' : signed(Math.round(pct)) + '%'})`;
      if (cell.children[1].textContent !== text) cell.children[1].textContent = text;
      cell.title = available ? TEXT.explanation +
        (a.valueStale ? TEXT.cached : '') +
        (field === 'value' && items.some(i => i.noValue) ? TEXT.rapForUnvalued : '')
        : missingWhy(a, field);
    }
    tidyBannerBoundary();
  }

  async function update() {
    if (!alive()) return;
    lastUrl = location.href;
    if (!enabled || !onPage() || document.hidden) { clear(); clearInventories(); return; }
    // Le Lucky Cat change toutes les quelques heures : le worker le relit s'il date.
    if (showLucky && Date.now() - luckyAskedAt > 10 * 60 * 1000) {
      luckyAskedAt = Date.now();
      B.runtime.sendMessage({ type: 'ronote:lucky-cat' }).then(r => setLucky(r?.luckyCat)).catch(() => {});
    }
    let page;
    try { page = dom.readTradePage(); } catch { clear(); return; }
    mountProfileLink(page);
    updateInventories(page.ok ? page : null);
    if (!page.ok) { clear(); return; }
    const sig = location.href + '|' + dom.signatureOf(page);
    shownPage = page;
    // La page n'était pas encore mise en page quand le bandeau a été posé : on
    // remesure, au plus toutes les 2 s, sans perdre l'analyse en route.
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
      // Une réponse lente n'écrase jamais un trade choisi entre-temps.
      if (current !== generation || !host?.isConnected) return;
      // La page a bougé pendant que le worker répondait : on redemande aussitôt
      // plutôt que de garder l'attente jusqu'à l'expiration du cache de 60 s.
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
      // Seule une réponse complète est gardée une minute ; une Value manquante se redemande.
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
    // Peut tourner avant que le reste du script soit prêt : rien ici ne doit lever d'erreur.
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
  // Seulement sur une page de trade : ailleurs sur Roblox, défiler ou
  // redimensionner relançait toute la mise à jour toutes les 40 ms, pour rien.
  const scheduleOnPage = () => { if (onPage() || host) schedule(); };
  globalThis.addEventListener('resize', scheduleOnPage);
  globalThis.addEventListener('ronote:detail-ready', () => { generation++; cache.clear(); retryAt = 0; schedule(); });
  // Le champ Robux d'un trade en préparation compte tout de suite : changer la
  // valeur d'un champ ne modifie pas forcément son attribut.
  document.addEventListener('input', event => {
    if (enabled && onPage() && event.target?.matches?.('input')) { retryAt = 0; schedule(); }
  }, true);
  document.addEventListener('scroll', scheduleOnPage, { capture: true, passive: true });
  // Retour sur l'onglet avec un bandeau gris : on redemande tout de suite.
  const refreshIncomplete = () => {
    if (!document.hidden && shownPage && !shownAnalysis?.valueAvailable) { retryAt = 0; }
    schedule();
  };
  document.addEventListener('visibilitychange', refreshIncomplete);
  globalThis.addEventListener('focus', refreshIncomplete);
  // Couvre aussi la navigation par pushState sans mutation du DOM, et les erreurs passagères.
  ticker = setInterval(() => {
    if (!alive()) return;
    if (!document.hidden && (onPage() || host) &&
        (location.href !== lastUrl || Date.now() >= retryAt || (shownPage?.composer && !profileLink?.isConnected))) schedule();
  }, 2000);
  schedule();
})();
