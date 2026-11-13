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
  // La note de demande, au dixième : « 3,7 » en français, « 3.7 » en anglais.
  const note = new Intl.NumberFormat(fr ? 'fr-FR' : 'en-US', { maximumFractionDigits: 1 }).format;
  const deltaNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
  const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + deltaNumber.format(Math.abs(n));
  // Les textes de la page, dans la langue de Roblox : écrits une fois ici.
  const TEXT = fr ? {
    projected: 'Projected : RAP gonflé par des reventes, chiffre peu fiable',
    currentValue: 'Cote Rolimon’s actuelle',
    openRolimons: 'Ouvrir sur Rolimon’s',
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
    proof: 'Mode proof : cacher les autres trades de la liste (pseudo, avatar, date, gains)',
    proofOn: 'Les autres trades de la liste sont cachés. Fais ta capture, ou envoie le proof sur Discord.',
    proofLoading: 'Lecture du trade…',
    proofNotCompleted: 'Ouvre un trade terminé (Completed) pour envoyer son proof.',
    proofElite: 'Envoyer le proof sur Discord, au format de Rolimons : réservé aux membres Elite de Neuronal.',
    proofLogin: 'Envoyer le proof sur Discord : connecte RoNote à Discord (Réglages › Premium), réservé aux Elite.',
    proofSwap: 'Inverser Sender et Receiver',
    proofList: 'Ajouter la liste des trades à la capture (autres pseudos cachés)',
    proofHint: 'La capture prend ce qui est visible : garde le trade entier à l’écran. Le panneau disparaît le temps de la photo.',
    proofSend: 'Envoyer dans mes MP',
    proofSending: 'Capture et envoi…',
    proofSent: 'Envoyé : regarde tes MP de RoOp Tracker sur Discord.',
    proofShareBtn: 'Capturer avec le partage d’onglet de Chrome',
    proofClose: 'Fermer et quitter le mode proof',
    proofAllow: 'Autoriser les captures (une fois)',
    proofAllowHint: 'Dans l’onglet des réglages qui s’ouvre : « Autoriser les captures », accepte, puis reviens et renvoie.',
    proofSettings: 'Réglages du mode proof',
    proofMaskLabel: 'Remplacer par', proofMasks: ['Des points', 'Rien', 'Mon image'],
    proofScopeLabel: 'Cacher', proofScopes: ['Les autres trades', 'Toute la liste'],
    proofImport: 'Importer une image', proofRemoveImage: 'Retirer l’image', proofBadImage: 'Image illisible.',
    proofFailed: (why) => `Envoi impossible (${why}).`,
    proofErrors: { capture: 'Chrome bloque la capture : autorise-la une fois (bouton ci-dessous), ou utilise le partage d’onglet.',
      share: 'Partage d’onglet annulé ou refusé.', subscribe: 'Réservé aux membres Elite de Neuronal.', login: 'Connecte RoNote à Discord (Réglages › Premium).',
      link: 'Lie ton compte Roblox dans Réglages › Premium.', dm_closed: 'Tes MP sont fermés : autorise les messages de RoOp Tracker.',
      tracker_offline: 'RoOp Tracker est hors ligne : réessaie dans une minute.', too_large: 'Capture trop lourde : réduis la fenêtre ou décoche la liste.',
      rate_limited: 'Trop de proofs cette heure : réessaie plus tard.', bad_date: 'Date attendue au format MM/JJ/AAAA.', network: 'Neuronal injoignable : réessaie.' },
    resend: 'Renvoyer',
    resendTitle: (who) => `Ouvrir un nouveau trade avec ${who || 'ce joueur'}`,
    catalog: 'Cotes Rolimon’s pas encore chargées.',
    stale: 'Cotes Rolimon’s trop anciennes.',
    noFigure: 'Aucun chiffre pour : ',
    unreachable: 'Extension injoignable : recharge la page.',
    insufficient: 'Données insuffisantes pour calculer cet écart.',
    explanation: 'Reçu − donné, par rapport à ce que tu donnes. Robux inclus ; les montants reçus déjà nets ne sont pas taxés une seconde fois.',
    cached: ' Cotes en cache, actualisation temporairement indisponible.',
    rapForUnvalued: ' RAP utilisé pour les objets sans value.',
    demandLabel: 'Demande :',
    demandWhy: (days) => `La demande est basée sur le nombre de fois où l’objet a été tradé ces ${days} derniers jours (trades prouvés par Neuronal).`,
    demandRank: (s, rank, of, n, days) => `Demande ${s}/5 : n°${rank} sur ${of} objets, ${n} trade${n > 1 ? 's' : ''} en ${days} jours.`,
    demandNone: (days) => `Demande 1/5 : aucun trade vu par Neuronal en ${days} jours.`,
    demandProjected: 'Demande N/A : objet projected, son volume de trades n’est pas fiable.',
    demandSmall: 'Demande N/A : petit objet, pas noté.',
    demandRoli: (s, label) => `Demande ${s}/5 : demande « ${label} » sur Rolimon’s.`,
    demandRoliLabels: ['Terrible', 'Faible', 'Normale', 'Haute', 'Excellente'],
    demandRoliRank: (rank, of, days) => `Affinée d’un demi-point au plus par Neuronal : n°${rank} sur ${of} objets tradés en ${days} jours.`,
    demandAverage: 'Demande moyenne de ce côté, pondérée par la value de chaque objet : celle de Rolimon’s quand l’objet en a une, sinon le classement Neuronal des trades sur 30 jours. Les projected et les petits objets ne comptent pas.',
    demandAverageNone: 'Demande N/A : aucun objet noté de ce côté.'
  } : {
    projected: 'Projected: RAP inflated by resales, unreliable figure',
    currentValue: 'Current Rolimon’s value',
    openRolimons: 'Open on Rolimon’s',
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
    proof: 'Proof mode: hide the other trades in the list (username, avatar, date, gains)',
    proofOn: 'The other trades in the list are hidden. Take your screenshot, or send the proof to Discord.',
    proofLoading: 'Reading the trade…',
    proofNotCompleted: 'Open a completed trade to send its proof.',
    proofElite: 'Sending the proof to Discord, in the Rolimons format, is for Neuronal Elite members.',
    proofLogin: 'To send the proof to Discord, connect RoNote to Discord (Settings › Premium). Elite only.',
    proofSwap: 'Swap Sender and Receiver',
    proofList: 'Include the trade list in the screenshot (other usernames hidden)',
    proofHint: 'The screenshot takes what is visible: keep the whole trade on screen. The panel hides for the shot.',
    proofSend: 'Send to my DMs',
    proofSending: 'Capturing and sending…',
    proofSent: 'Sent: check your DMs from RoOp Tracker on Discord.',
    proofShareBtn: 'Capture with Chrome’s tab sharing',
    proofClose: 'Close and leave proof mode',
    proofAllow: 'Allow screenshots (once)',
    proofAllowHint: 'In the settings tab that opens: “Allow screenshots”, accept, then come back and send again.',
    proofSettings: 'Proof mode settings',
    proofMaskLabel: 'Replace with', proofMasks: ['Dots', 'Nothing', 'My image'],
    proofScopeLabel: 'Hide', proofScopes: ['The other trades', 'The whole list'],
    proofImport: 'Import an image', proofRemoveImage: 'Remove image', proofBadImage: 'Unreadable image.',
    proofFailed: (why) => `Could not send (${why}).`,
    proofErrors: { capture: 'Chrome blocks the screenshot: allow it once (button below), or use tab sharing.',
      share: 'Tab sharing cancelled or refused.', subscribe: 'Neuronal Elite members only.', login: 'Connect RoNote to Discord (Settings › Premium).',
      link: 'Link your Roblox account in Settings › Premium.', dm_closed: 'Your DMs are closed: allow messages from RoOp Tracker.',
      tracker_offline: 'RoOp Tracker is offline: try again in a minute.', too_large: 'Screenshot too heavy: make the window smaller or untick the list.',
      rate_limited: 'Too many proofs this hour: try again later.', bad_date: 'Date expected as MM/DD/YYYY.', network: 'Neuronal unreachable: try again.' },
    resend: 'Send again',
    resendTitle: (who) => `Open a new trade with ${who || 'this player'}`,
    catalog: 'Rolimon’s values not loaded yet.',
    stale: 'Rolimon’s values too old.',
    noFigure: 'No figure for: ',
    unreachable: 'Extension unreachable: reload the page.',
    insufficient: 'Insufficient data to calculate this difference.',
    explanation: 'Received − given, relative to what you give. Includes Robux; received amounts already shown net are not taxed again.',
    cached: ' Cached prices; refresh temporarily unavailable.',
    rapForUnvalued: ' RAP used for items without a value.',
    demandLabel: 'Demand:',
    demandWhy: (days) => `Demand is based on the number of times the item was traded in the last ${days} days (trades proven by Neuronal).`,
    demandRank: (s, rank, of, n, days) => `Demand ${s}/5: #${rank} of ${of} items, ${n} trade${n > 1 ? 's' : ''} in ${days} days.`,
    demandNone: (days) => `Demand 1/5: no trade seen by Neuronal in ${days} days.`,
    demandProjected: 'Demand N/A: projected item, its trade volume is unreliable.',
    demandSmall: 'Demand N/A: small item, not rated.',
    demandRoli: (s, label) => `Demand ${s}/5: “${label}” demand on Rolimon’s.`,
    demandRoliLabels: ['Terrible', 'Low', 'Normal', 'High', 'Amazing'],
    demandRoliRank: (rank, of, days) => `Refined by up to half a point with Neuronal: #${rank} of ${of} items traded in ${days} days.`,
    demandAverage: 'Average demand of this side, weighted by each item’s value: Rolimon’s demand when the item has one, otherwise Neuronal’s 30-day trade ranking. Projected and small items are not counted.',
    demandAverageNone: 'Demand N/A: no rated item on this side.'
  };
  // La demande : une icône colorée selon la note (par défaut cinq barres, comme un signal), la note à côté.
  const DEMAND_COLORS = ['', '#e5534b', '#f0954a', '#e3b341', '#8fd14f', '#3fcf6e'];
  const DEMAND_CSS = `
    .d{display:none;align-items:center;gap:1px;flex:none;font:inherit;font-weight:600;line-height:1;color:inherit;white-space:nowrap;cursor:help}
    .d[data-on]{display:inline-flex}
    .d .ic{display:contents}
    .d svg,.d img{display:block;width:.9em;height:.9em;flex:none;fill:var(--c);object-fit:contain}
    .d svg.bars{width:1.1em;margin-right:2px}
    .d svg.bars rect{fill:currentColor;opacity:.25}.d svg.bars rect.f{fill:var(--c);opacity:1}
    .d[data-na] img{filter:grayscale(1)}
    .d b{font:inherit}
    .d[data-compact] b span{display:none}
    .d[data-na]{opacity:.55}`;
  // Les icônes au choix (Réglages › Apparence › Icône de la demande), ou l'image importée (`demandIconImage`).
  const DEMAND_ICONS = globalThis.RoNoteDemandIcons || {};
  const demandLook = { icon: 'bars', image: '' };
  const DEMAND_HTML = '<i class="ic"></i><b></b>';
  function iconize(el, score = el.score) {
    el.score = score;
    const bars = !demandLook.image && demandLook.icon === 'bars';
    const key = demandLook.image ? 'img:' + demandLook.image.length : demandLook.icon + (bars ? ':' + (score || 0) : '');
    if (el.dataset.icon === key) return;
    el.dataset.icon = key;
    const slot = el.firstElementChild;
    if (demandLook.image) { slot.innerHTML = '<img alt="">'; slot.firstChild.src = demandLook.image; return; }
    if (bars) {
      // Une note décimale remplit la dernière barre en partie : 3,5 = trois barres et demie.
      const n = score || 0;
      slot.innerHTML = '<svg class="bars" viewBox="0 0 14 12" aria-hidden="true">' + [3, 5, 7, 9, 11]
        .map((h, k) => `<rect x="${k * 3}" y="${12 - h}" width="2" height="${h}" rx=".5"${k + 1 <= n ? ' class="f"'
          : k < n ? ` class="f" style="opacity:${(.25 + .75 * (n - k)).toFixed(2)}"` : ''}/>`).join('') + '</svg>';
      return;
    }
    const path = DEMAND_ICONS[demandLook.icon];
    slot.innerHTML = path ? `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="${path}"/></svg>` : '';
  }
  // Une autre icône choisie : toutes les pastilles et les totaux la reprennent sur place.
  function restyleDemand() {
    for (const b of badges.values()) if (b.demand) iconize(b.demand);
    for (const t of totalBadges.values()) if (t.demand) iconize(t.demand);
  }
  // `score` (nombre) ou null pour N/A ; `title` = l'infobulle entière.
  function paintDemand(el, score, title) {
    const html = score == null ? '<span>N/A</span>' : `${note(score)}<span>/5</span>`;
    iconize(el, score);
    el.style.setProperty('--c', DEMAND_COLORS[Math.round(score || 0)] || 'currentColor');
    const b = el.lastElementChild;
    if (b.innerHTML !== html) b.innerHTML = html;
    el.toggleAttribute('data-na', score == null);
    el.title = title;
    el.setAttribute('aria-label', title);
    el.dataset.on = '';
  }
  function demandTitle(d) {
    if (d.na) return d.na === 'projected' ? TEXT.demandProjected : TEXT.demandSmall;
    if (d.roli != null) return TEXT.demandRoli(note(d.score), TEXT.demandRoliLabels[d.roli]) + (d.rank ? ' ' + TEXT.demandRoliRank(d.rank, d.of, d.days) : '');
    return (d.n ? TEXT.demandRank(note(d.score), d.rank, d.of, d.n, d.days) : TEXT.demandNone(d.days)) + ' ' + TEXT.demandWhy(d.days);
  }
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
  if (alive()) B.storage?.local?.get(['settings', 'projectedIcon', 'luckyCat', 'demandIconImage', 'proofImage']).then(got => {
    Object.assign(proofLook, { mask: got?.settings?.proofMask || 'dots', scope: got?.settings?.proofScope || 'others', image: got?.proofImage || '' });
    demandLook.icon = got?.settings?.demandIcon || 'bars';
    demandLook.image = got?.demandIconImage || '';
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
    if (changes.demandIconImage) { demandLook.image = changes.demandIconImage.newValue || ''; restyleDemand(); }
    if (changes.proofImage || changes.settings) {
      if (changes.proofImage) proofLook.image = changes.proofImage.newValue || '';
      if (changes.settings) Object.assign(proofLook, { mask: changes.settings.newValue?.proofMask || 'dots', scope: changes.settings.newValue?.proofScope || 'others' });
      paintProof();
      const open = proofQ('details')?.open;
      if (proofQ('details')) { proofQ('details').outerHTML = proofSettingsHtml(); if (open) proofQ('details').open = true; }
    }
    if (changes.luckyCat) setLucky(changes.luckyCat.newValue);
    // Nouvelle table Rolimon's : on redemande tout de suite, sans attendre la minute.
    if (changes.roli && enabled) { cache.clear(); retryAt = 0; schedule(); }
    if (!changes.settings) return;
    const nextSettings = changes.settings.newValue || {};
    if (bannerKey(nextSettings) !== bannerKey(bannerSettings)) {
      bannerSettings = nextSettings; restyleBanner();
      if (host?.isConnected && shownAnalysis !== undefined) render(shownAnalysis, analysisPending);
    }
    if ((nextSettings.demandIcon || 'bars') !== demandLook.icon) { demandLook.icon = nextSettings.demandIcon || 'bars'; restyleDemand(); }
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
    restoreMargin(badge);
    unclampName(badge);
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
    .v[data-state="wait"]{opacity:.7}
    .go{display:none;align-items:center;justify-content:center;width:1.15em;height:1.15em;margin-left:1px;border-radius:4px;flex:none;
      color:inherit;opacity:.55;cursor:pointer;transition:opacity .15s,background .15s}
    .go[data-on]{display:inline-flex}
    .go:hover,.go:focus-visible{opacity:1;background:rgba(125,185,255,.22);outline:none}
    .go svg{width:.8em;height:.8em;display:block}
    .v .d{margin-left:.1em}
    .d[data-on][data-line]{display:flex;width:max-content;margin-top:3px}
    :host([data-over]) .d{display:none}` + DEMAND_CSS;
  // Le petit lien vers la page Rolimon's de l'objet, au bout de sa pastille de value.
  const GO_SVG = '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 2.5H2.5v7h7V7M7 2h3v3M10 2 5.5 6.5"/></svg>';
  // Rolimon's : tout bundle, visage compris, a sa page /bundle/<id> (la page de référence ; /item/<id de
  // bundle> rend 404). Un visage seulement connu par son ancien asset garde /item/<ancien>, qui y renvoie.
  const roliUrl = (i) => {
    const legacy = Number(i?.legacyAssetId) || 0, bundle = Number(i?.bundleId) || 0, asset = Number(i?.assetId) || 0;
    return bundle ? `https://www.rolimons.com/bundle/${bundle}` : legacy ? `https://www.rolimons.com/item/${legacy}`
      : asset ? `https://www.rolimons.com/item/${asset}` : '';
  };
  function linkBadge(badge, url) {
    if (badge.goId === url) return;
    badge.goId = url;
    if (url) badge.go.dataset.on = ''; else delete badge.go.dataset.on;
    badge.go.title = TEXT.openRolimons;
  }
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
      const go = document.createElement('span');
      go.className = 'go'; go.setAttribute('role', 'link'); go.tabIndex = 0; go.innerHTML = GO_SVG;
      pill.append(label, value, go);
      const demand = document.createElement('span');
      demand.className = 'd'; demand.innerHTML = DEMAND_HTML;
      shadow.append(style, pill, demand);
      badge = { node, pill, label, value, go, goId: null, demand };
      // La carte de Roblox réagit au clic (ajouter l'objet au trade, ouvrir sa page) : le lien
      // garde son clic pour lui et ouvre Rolimon's dans un nouvel onglet.
      const stop = (e) => { e.stopPropagation(); };
      const open = (e) => {
        e.preventDefault(); e.stopPropagation();
        if (badge.goId) window.open(badge.goId, '_blank', 'noopener');
      };
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'touchstart']) go.addEventListener(type, stop);
      go.addEventListener('click', open);
      go.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') open(e); });
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

  function paintBadge(badge, text, state, title, card, demand = null) {
    // Values coupées : la pastille reste en place, cachée, pour le badge projected.
    if (!itemValues) { badge.node.style.display = 'none'; badge.checked = false; return; }
    if (badge.mode !== 'overlay' && badge.node.style.display === 'none') badge.node.style.display = '';
    let grew = badge.value.textContent !== text;
    if (grew) badge.value.textContent = text;
    // La demande, sous la value. Sans la place pour elle, elle s'efface avant la value.
    const demandKey = demand ? JSON.stringify(demand) : '';
    if (badge.demandKey !== demandKey) {
      badge.demandKey = demandKey; grew = true;
      if (demand) paintDemand(badge.demand, demand.na ? null : demand.score, demandTitle(demand));
      else { delete badge.demand.dataset.on; restoreMargin(badge); unclampName(badge); }
    }
    if (badge.pill.dataset.state !== state) badge.pill.dataset.state = state;
    badge.pill.title = title;
    // Vérifié quand le texte change : un nombre plus long peut ne plus tenir. Sous
    // le RAP d'abord, puis sur sa ligne, et cachée seulement si rien ne tient.
    // La demande ne compte pas ici : elle cède sa place avant la value (fitDemand).
    // Avec une demande, le nom passe sur une ligne d'abord : la value y gagne aussi sa place.
    // Une value passée sur la ligne du RAP faute de place retente sa propre ligne.
    if (card && demand && badge.mode !== 'overlay' && clampName(badge, card) && badge.mode === 'inline' && badge.line?.isConnected) {
      badge.mode = 'below'; seat(badge, card); badge.checked = false;
    }
    if (card && (grew || !badge.checked) && badge.mode !== 'overlay') {
      const on = badge.demand.dataset.on !== undefined;
      delete badge.demand.dataset.on;
      if (!chipVisible(badge, card)) {
        badge.mode = badge.mode === 'below' && badge.anchor?.isConnected ? 'inline' : 'overlay';
        seat(badge, card);
        if (badge.mode === 'inline' && !chipVisible(badge, card)) { badge.mode = 'overlay'; seat(badge, card); }
      }
      if (on) badge.demand.dataset.on = '';
    }
    badge.checked = true;
    if (card && demand && (grew || badge.demandLater) && badge.mode !== 'overlay') fitDemand(badge, card);
  }

  /* La demande d'un objet : sur sa propre ligne sous la value d'abord. Si quelque chose la
   * recouvre (cartes de Roblox de hauteur fixe : les totaux passaient par-dessus), la carte
   * reçoit la marge qui manque ; sinon elle passe sur la ligne de la value, puis en note seule
   * (« 4 »), puis disparaît. « Recouverte » = le point testé n'appartient pas à la pastille :
   * ça voit aussi un ancêtre qui la coupe. Hors de l'écran, on ne peut pas savoir : réessayé. */
  // true = rien ne la touche ; null = hors écran, on ne peut pas savoir ; sinon l'élément qui la
  // recouvre. Les quatre coins : un voisin qui ne mord que le bas de la ligne compte aussi.
  function demandProbe(badge, el) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return el;
    if (r.top < 0 || r.left < 0 || r.bottom > innerHeight || r.right > innerWidth) return null;
    for (const y of [r.top + 1, r.bottom - 1]) for (const x of [r.left + 1, r.right - 1]) {
      const hit = document.elementFromPoint(x, y);
      if (hit !== badge.node) return hit || el;
    }
    return true;
  }
  const demandSeen = (badge, el) => { const p = demandProbe(badge, el); return p === null ? null : p === true; };
  // Le nom de l'objet sur une seule ligne (« XXL Basketball… », le nom entier au survol) : la ligne
  // gagnée accueille la demande sans rien pousser. Le texte de la carte qui court sur plusieurs
  // lignes, hors vignette, prix et pastilles.
  function clampName(badge, card) {
    if (badge.clamped?.el.isConnected) return false;
    badge.clamped = null;
    for (const el of card.querySelectorAll('*')) {
      if (el.closest('[data-rn]') || el.querySelector('img,svg,[data-rn]') || el.contains(badge.node) ||
          (badge.line && (badge.line.contains(el) || el.contains(badge.line)))) continue;
      const text = (el.textContent || '').trim();
      if (text.length < 4 || /^[\d\s,.#]+$/.test(text)) continue;
      // Le texte vit plus bas (Roblox : .item-card-name-link > .item-card-name) : c'est l'enfant
      // qui porte la limite à deux lignes et la hauteur fixe, c'est lui qu'on raccourcit.
      if ([...el.children].some(c => (c.textContent || '').trim() === text)) continue;
      const css = getComputedStyle(el);
      const line = parseFloat(css.lineHeight) || parseFloat(css.fontSize) * 1.25;
      if (!(el.getBoundingClientRect().height > line * 1.6)) continue;
      badge.clamped = { el, css: el.style.cssText, title: el.getAttribute('title') };
      el.style.cssText += ';display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;-webkit-line-clamp:unset;height:auto;max-height:none';
      if (!el.title) el.title = text;
      return true;
    }
    return false;
  }
  function unclampName(badge) {
    const c = badge.clamped;
    if (!c) return;
    c.el.style.cssText = c.css;
    if (c.title == null) c.el.removeAttribute('title');
    badge.clamped = null;
  }
  function restoreMargin(badge) {
    if (!badge.marginCard) return;
    badge.marginCard.style.marginBottom = badge.savedMargin;
    badge.marginCard = null;
  }
  function fitDemand(badge, card) {
    const d = badge.demand;
    if (d.dataset.on === undefined) return;
    badge.demandLater = false;
    restoreMargin(badge);
    delete d.dataset.compact;
    if (badge.mode === 'below') {
      d.dataset.line = '';
      if (d.parentNode !== badge.pill.parentNode) badge.pill.after(d);
      clampName(badge, card);
      let probe = demandProbe(badge, d);
      if (probe === null) { badge.demandLater = true; return; }
      // La boîte à agrandir : la plus extérieure que la ligne dépasse (la carte, ou son cadre de hauteur fixe).
      const bottom = d.getBoundingClientRect().bottom;
      let box = card;
      for (let k = 0; k < 5 && box.parentElement && box.parentElement.getBoundingClientRect().bottom < bottom - 1; k++) box = box.parentElement;
      // La place qui manque : ce que la ligne dépasse de sa boîte, ou ce que le voisin (les totaux) en recouvre.
      let need = bottom - box.getBoundingClientRect().bottom;
      // (un conteneur touché commence plus haut que la ligne : seul le débordement compte alors).
      if (probe !== true) {
        const top = probe.getBoundingClientRect().top;
        if (top > d.getBoundingClientRect().top) need = Math.max(need, bottom - top);
      }
      if (need > 0 && need < 40) {
        badge.savedMargin = box.style.marginBottom; badge.marginCard = box;
        box.style.marginBottom = `${(parseFloat(getComputedStyle(box).marginBottom) || 0) + need + 3}px`;
        probe = demandProbe(badge, d);
        if (probe !== true) restoreMargin(badge);
      }
      const seen = probe === true;
      if (seen !== false) return;
    }
    delete d.dataset.line;
    badge.pill.append(d);
    // La pastille rétrécit (points de suspension) plutôt que de déborder : on compare aussi sa largeur.
    // Hors de l'écran, impossible de savoir s'il est coupé : réessayé au prochain dessin.
    if (demandSeen(badge, d) === null) badge.demandLater = true;
    const fits = () => demandSeen(badge, d) !== false && badge.pill.scrollWidth <= badge.pill.clientWidth + 1;
    if (!fits()) d.dataset.compact = '';
    if (!fits()) delete d.dataset.on;
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
      // La demande moyenne du côté, sur une ligne à elle, sous la Value.
      const drow = document.createElement('div');
      drow.dataset.rn = 'total-demand';
      drow.style.cssText = node.style.cssText + 'margin-top:4px;';
      const dlabel = document.createElement('span');
      dlabel.textContent = TEXT.demandLabel;
      const dhost = document.createElement('span');
      const dshadow = dhost.attachShadow({ mode: 'closed' });
      const dstyle = document.createElement('style'); dstyle.textContent = DEMAND_CSS + '.d{gap:4px}';
      const demand = document.createElement('span');
      demand.className = 'd'; demand.innerHTML = DEMAND_HTML;
      dshadow.append(dstyle, demand); drow.append(dlabel, dhost);
      total = { node, value, amount, label, icon, drow, dlabel, dhost, demand };
      totalBadges.set(side.root, total);
    }
    total.row = row;
    // Même libellé et même montant que Roblox, typographie du thème comprise.
    const sourceAmount = [...(row.querySelectorAll?.('*') || [])].reverse().find(el =>
      !el.childElementCount && /\d/.test(el.textContent || '')) || row.lastElementChild;
    for (const [source, target] of [[side.totalLabel, total.label], [sourceAmount, total.amount],
      [side.totalLabel, total.dlabel], [sourceAmount, total.dhost]]) {
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
      const text = available ? number.format(value) : pending ? '…' : 'N/A';
      if (total.value.textContent !== text) total.value.textContent = text;
      const title = available ? TEXT.totalOk : TEXT.totalMissing;
      if (total.amount.title !== title) total.amount.title = title;
      total.node.style.opacity = available ? '1' : pending ? '.7' : '.8';
      // Pas de table de demande (option Neuronal coupée, réseau injoignable) : pas de ligne.
      const avg = analysis?.pageDemand ? analysis.pageDemand[index] : undefined;
      if (avg === undefined) total.drow.remove();
      else {
        paintDemand(total.demand, avg, avg == null ? TEXT.demandAverageNone : TEXT.demandAverage);
        if (total.drow.previousElementSibling !== total.node) total.node.after(total.drow);
      }
    }
    for (const [root, total] of totalBadges) if (!keep.has(root)) {
      total.node.remove(); total.drow.remove(); totalBadges.delete(root);
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
        paintBadge(badge, available ? number.format(info.value) : rapFallback ? number.format(item.rap) : pending ? '…' : 'N/A',
          available || rapFallback ? 'ok' : pending ? 'wait' : 'none',
          available ? TEXT.currentValue : rapFallback ? TEXT.rapUsed : TEXT.valueMissing, card,
          matched ? info.demand : null);
        linkBadge(badge, roliUrl(matched ? { assetId: item.assetId || info.assetId, bundleId: item.bundleId || info.bundleId,
          legacyAssetId: info.legacyAssetId } : item));
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
      else paintBadge(badge, info?.known ? 'N/A' : '…', info?.known ? 'none' : 'wait', TEXT.noValue, card);
      linkBadge(badge, roliUrl({ ...item, legacyAssetId: info?.legacyAssetId }));
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
        else invInfo.set(r.key, { known: true, value: r.value || 0, projected: !!r.projected, rare: !!r.rare, legacyAssetId: r.legacyAssetId || 0 });
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
  let serialControl, flexControl, proofControl, serialHidden = false;
  /* Le mode proof (trades terminés) : dans la liste de gauche, les autres trades perdent pseudo, avatar,
     statut, date et gains ; seul le trade ouvert (`.trade-row.selected`) reste. Rien n'est flouté : les
     lignes sont vidées, puis montrent des points, rien, ou l'image importée (Réglages › Apparence ›
     Mode proof), sur les autres trades seulement ou sur toute la liste. Il suit le trade ouvert et
     s'éteint quand on quitte les trades terminés. */
  const proofLook = { mask: 'dots', scope: 'others', image: '' };
  function proofCss() {
    const on = 'html[data-rn-proof]';
    const rows = `${on} .trade-row${proofLook.scope === 'list' ? '' : ':not(.selected)'}`;
    const mask = proofLook.mask === 'image' && !proofLook.image ? 'blank' : proofLook.mask;
    let css = `${rows}>:not(.trade-row-divider){visibility:hidden!important}`;
    if (mask === 'dots') css += `${rows}{position:relative}${rows}::after{content:"••••••";position:absolute;left:16px;top:50%;
      transform:translateY(-50%);font-size:18px;letter-spacing:2px;opacity:.5;pointer-events:none}`;
    if (mask === 'image') {
      // Une seule image pour toute la liste ; le trade ouvert, s'il reste, garde un fond plein par-dessus.
      css += `${on} .trade-row-list div:has(>.trade-row){background:url("${proofLook.image}") center/cover no-repeat!important}
        ${on} .trade-row-list .trade-row:not(.selected),${on} .trade-row-list .trade-row-divider{background:transparent!important}
        ${on} .trade-row-list .trade-row-divider{visibility:hidden!important}
        ${on} .trade-row-list .trade-row.selected{background:${proofLook.scope === 'list' ? 'transparent' : 'rgb(24 12 46 / .94)'}!important}`;
    }
    return css;
  }
  function paintProof() {
    let st = document.querySelector('style[data-rn="proof"]');
    if (!proofOn) { st?.remove(); return; }
    if (!st) { st = document.createElement('style'); st.dataset.rn = 'proof'; (document.head || document.documentElement).append(st); }
    const css = proofCss();
    if (st.textContent !== css) st.textContent = css;
  }
  let proofOn = false;
  function setProof(on) {
    if (on === proofOn) return;
    proofOn = on;
    paintProof();
    document.documentElement.toggleAttribute('data-rn-proof', on);
    if (on) openProofPanel(); else closeProofPanel();
    if (proofControl) {
      proofControl.setAttribute('aria-pressed', String(on));
      proofControl.style.background = on ? 'rgba(63,207,110,.28)' : 'rgba(20,28,40,.45)';
      proofControl.style.borderColor = on ? '#3fcf6e' : 'rgba(128,170,210,.3)';
    }
  }
  /* Le panneau proof (13 nov., MYd : « que le bouclier ouvre un panel à droite qui cache la gauche, et qu'on
     aille jusqu'au bout du proof là ») : le bouclier met le mode proof ET ouvre ce panneau. Pour tous : le
     mode proof. Elite : les cinq lignes que Rolimons demande, modifiables, et « Send to my DMs » : la page
     se capture sans le panneau, RoOp Tracker l'envoie en MP (background/proof.js). La capture passe par
     l'onglet (activeTab : un clic sur l'icône de RoNote dans cet onglet) ; sinon, le partage d'onglet de
     Chrome, sur un second clic. */
  const PROOF_FIELDS = [['items', 'Item(s)'], ['values', 'Values'], ['sender', 'Sender'], ['receiver', 'Receiver'], ['date', 'Date']];
  const PROOF_CSS = `
    :host{all:initial}
    aside{box-sizing:border-box;position:fixed;z-index:2147483000;top:0;right:0;width:340px;height:100vh;display:flex;flex-direction:column;
      background:#111318;color:#e8e8ea;border-left:1px solid #2a2d33;box-shadow:-18px 0 40px rgba(0,0,0,.45);
      font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif}
    header{display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:1px solid #2a2d33}
    header b{flex:1;font-size:15px}header b i{font-style:normal;color:#3fcf6e}
    button{font:inherit;cursor:pointer}
    .x{width:28px;height:28px;border-radius:8px;border:1px solid #2a2d33;background:none;color:#aeb2bb}
    .body{flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:9px}
    p{margin:0;color:#aeb2bb}
    label.f{display:grid;grid-template-columns:62px 1fr auto;align-items:center;gap:8px;font-size:12px;color:#aeb2bb}
    input:not([type]){min-width:0;padding:7px 9px;border-radius:8px;border:1px solid #2a2d33;background:#181a20;color:#e8e8ea;font:inherit}
    input:not([type]):focus{outline:none;border-color:#3d8eff}
    .swap{padding:4px 7px;border-radius:7px;border:1px solid #2a2d33;background:#181a20;color:#e8e8ea}
    .chk{display:flex;gap:8px;align-items:flex-start;font-size:12.5px;cursor:pointer}
    pre{margin:0;padding:9px 10px;border-radius:9px;background:#0b0c0f;border:1px solid #23262c;font:12px/1.5 ui-monospace,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;color:#c9d4e8}
    footer{display:flex;flex-direction:column;gap:8px;padding:12px 16px;border-top:1px solid #2a2d33}
    .send{padding:10px;border-radius:10px;border:1px solid #1f5a37;background:#10331f;color:#c9f5da;font-weight:700}
    .send:hover{background:#154527}.send:disabled{opacity:.6;cursor:default}
    .share{padding:9px;border-radius:10px;border:1px solid #2a2d33;background:#181a20;color:#e8e8ea}
    .msg{min-height:1em;font-size:12px;color:#aeb2bb}.msg.err{color:#f2545b}
    details{border:1px solid #23262c;border-radius:10px;padding:8px 10px;background:#15171c}
    summary{cursor:pointer;font-weight:600;color:#e8e8ea}
    .set{display:flex;flex-direction:column;gap:8px;margin-top:9px}
    .set label{display:grid;grid-template-columns:96px 1fr;align-items:center;gap:8px;font-size:12px;color:#aeb2bb}
    select{padding:6px 8px;border-radius:8px;border:1px solid #2a2d33;background:#181a20;color:#e8e8ea;font:inherit}
    .row{display:flex;gap:8px;flex-wrap:wrap}
    .mini{padding:6px 10px;border-radius:8px;border:1px solid #2a2d33;background:#181a20;color:#e8e8ea;font-size:12px}
    .allow{padding:9px;border-radius:10px;border:1px solid #2f5f9e;background:#13213a;color:#9dcbff;font-weight:600}
    [hidden]{display:none!important}`;
  let proofPanel = null;
  function proofInfo() {
    const a = shownAnalysis, page = shownPage;
    if (!a || !isCompleted(page)) return { ok: false };
    const items = s => s.items.map(i => ({ assetId: i.assetId || 0, bundleId: i.bundleId || 0, legacyAssetId: i.legacyAssetId || 0, name: i.name || '' }));
    // La date de la ligne ouverte, telle que Roblox l'écrit (jj/mm en français) : rendue en MM/JJ/AAAA.
    const d = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(document.querySelector('.trade-row.selected')?.textContent || '');
    const date = d ? (fr ? [d[2], d[1], d[3]] : [d[1], d[2], d[3]]).map((x, k) => k < 2 ? x.padStart(2, '0') : x).join('/') : '';
    return { ok: true, tradeId: page.tradeId || '', partner: (page.handle || '').replace(/^@/, ''),
      give: { items: items(a.give), robux: a.give.robux || 0 }, get: { items: items(a.get), robux: a.get.robux || 0 },
      values: a.valueAvailable !== false ? [a.give.value, a.get.value] : null, date };
  }
  /** La zone à capturer, en pixels CSS : le trade, ou toute la colonne des trades avec la liste. */
  function proofFrame(list) {
    const root = document.querySelector('.trades-react');
    const detail = root && [...root.children].find(c => !c.classList.contains('trade-row-list'));
    // Sans ces classes de Roblox : le plus petit bloc qui tient le titre du trade et ses deux côtés.
    const ends = [shownPage?.tradeHeading, ...(shownPage?.sides || []).map(s => s.root)].filter(n => n?.isConnected);
    let common = ends[0] || null;
    while (common && !ends.every(n => common.contains(n))) common = common.parentElement;
    const box = (list ? root : detail) || common;
    if (!box) return null;
    const r = box.getBoundingClientRect();
    const x = Math.max(0, r.left), y = Math.max(0, r.top);
    return { x, y, w: Math.min(innerWidth, r.right) - x, h: Math.min(innerHeight, r.bottom) - y, vw: innerWidth };
  }
  const proofQ = s => proofPanel?.root.querySelector(s);
  function proofSay(text, err = false) { const m = proofQ('.msg'); if (m) { m.textContent = text || ''; m.className = 'msg' + (err ? ' err' : ''); } }
  function proofFields() { return Object.fromEntries(PROOF_FIELDS.map(([k]) => [k, proofQ(`[data-f="${k}"]`)?.value.trim() || ''])); }
  function proofPreview() { const p = proofQ('pre'), f = proofFields(); if (p) p.textContent = PROOF_FIELDS.map(([k, l]) => `${l}: ${f[k]}`).join('\n') + '\n\n<screenshot>'; }
  async function proofFill() {
    const info = proofInfo(), body = proofQ('.body');
    if (!body) return;
    proofPanel.sig = JSON.stringify(info);
    proofQ('footer').hidden = true;
    if (!info.ok) { body.innerHTML = `<p>${TEXT.proofOn}</p>` + proofSettingsHtml(); return; }
    const res = await B.runtime.sendMessage({ type: 'ronote:proof-prepare', info }).catch(() => null);
    if (!proofPanel || proofPanel.sig !== JSON.stringify(info)) return;
    if (!res?.elite) { body.innerHTML = `<p>${TEXT.proofOn}</p>` + proofSettingsHtml() + `<p>🔒 ${res?.signedIn ? TEXT.proofElite : TEXT.proofLogin}</p>`; return; }
    const esc = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
    body.innerHTML = `<p>${TEXT.proofOn}</p>` + proofSettingsHtml() + PROOF_FIELDS.map(([k, l]) => `<label class="f"><span>${l}</span>
        <input data-f="${k}" value="${esc(res.fields[k] || '')}" maxlength="${k === 'items' ? 300 : 80}" spellcheck="false">
        ${k === 'receiver' ? `<button class="swap" data-swap title="${TEXT.proofSwap}">⇄</button>` : ''}</label>`).join('')
      + `<label class="chk"><input type="checkbox" data-list> ${TEXT.proofList}</label><pre></pre><p>${TEXT.proofHint}</p>`;
    proofQ('footer').hidden = false;
    proofQ('.share').hidden = true;
    proofQ('.allow').hidden = true;
    proofSay('');
    proofPreview();
  }
  /** Le partage d'onglet de Chrome, une image : quand captureVisibleTab n'a pas la permission. */
  async function proofShareCapture() {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'browser' }, audio: false,
      preferCurrentTab: true, selfBrowserSurface: 'include' });
    try {
      const video = document.createElement('video');
      video.srcObject = stream; video.muted = true;
      await video.play();
      await new Promise(r => setTimeout(r, 350));              // la boîte de Chrome fermée, une image fraîche
      const c = document.createElement('canvas');
      c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      return c.toDataURL('image/png');
    } finally { stream.getTracks().forEach(t => t.stop()); }
  }
  async function proofSend(viaShare) {
    const send = proofQ('.send');
    if (!send || send.disabled) return;
    const fields = proofFields(), list = !!proofQ('[data-list]')?.checked;
    const frame = proofFrame(list);
    if (!frame) { proofSay(TEXT.proofNotCompleted, true); return; }
    send.disabled = true; proofSay(TEXT.proofSending);
    const host = proofPanel.host;
    host.style.visibility = 'hidden';
    if (tools) tools.style.visibility = 'hidden';
    let res;
    try {
      const image = viaShare ? await proofShareCapture() : null;
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));      // la page redessinée sans le panneau
      res = await B.runtime.sendMessage({ type: 'ronote:proof-share', fields, frame, image });
    } catch (e) {
      res = { error: viaShare ? 'share' : 'capture', detail: String(e?.message || e) };
    } finally {
      host.style.visibility = '';
      if (tools) tools.style.visibility = '';
      send.disabled = false;
    }
    if (res?.ok) { proofSay(TEXT.proofSent); return; }
    if (res?.error === 'capture') { proofQ('.share').hidden = false; proofQ('.allow').hidden = false; }
    proofSay((TEXT.proofErrors[res?.error] || TEXT.proofFailed(res?.error || '?')) + (res?.detail ? ` (${res.detail})` : ''), true);
  }
  /* Les réglages du mode proof, ici aussi (13 nov.) : les mêmes que Réglages › Apparence › Mode proof. */
  function proofSettingsHtml() {
    const opt = (v, cur, l) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`;
    return `<details><summary>⚙ ${TEXT.proofSettings}</summary><div class="set">
      <label>${TEXT.proofMaskLabel}<select data-set="proofMask">${opt('dots', proofLook.mask, TEXT.proofMasks[0])}${opt('blank', proofLook.mask, TEXT.proofMasks[1])}${opt('image', proofLook.mask, TEXT.proofMasks[2])}</select></label>
      <label>${TEXT.proofScopeLabel}<select data-set="proofScope">${opt('others', proofLook.scope, TEXT.proofScopes[0])}${opt('list', proofLook.scope, TEXT.proofScopes[1])}</select></label>
      <div class="row"><label class="mini" style="display:inline-block;cursor:pointer">${TEXT.proofImport}<input type="file" data-img accept="image/png,image/jpeg,image/gif,image/webp" hidden></label>
        ${proofLook.image ? `<button class="mini" data-clear>${TEXT.proofRemoveImage}</button>` : ''}</div></div></details>`;
  }
  async function proofSetting(el) {
    if (el.dataset.set) { B.runtime.sendMessage({ type: 'ronote:settings', patch: { [el.dataset.set]: el.value } }).catch(() => {}); return; }
    const file = el.matches('[data-img]') && el.files?.[0];
    if (!file) return;
    try {
      // La même taille que l'import des réglages : 1 400 px au plus, en JPEG.
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      await B.storage.local.set({ proofImage: c.toDataURL('image/jpeg', 0.85) });
      B.runtime.sendMessage({ type: 'ronote:settings', patch: { proofMask: 'image' } }).catch(() => {});
    } catch { proofSay(TEXT.proofBadImage, true); }
  }
  function openProofPanel() {
    if (proofPanel) return;
    const host = document.createElement('div');
    host.dataset.rn = 'proof-panel';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>${PROOF_CSS}</style><aside role="dialog" aria-label="Proof">
      <header><b><i>✓</i> Proof</b><button class="x" title="${TEXT.proofClose}" aria-label="${TEXT.proofClose}">✕</button></header>
      <div class="body"><p>${TEXT.proofLoading}</p></div>
      <footer hidden><button class="send">➤ ${TEXT.proofSend}</button><button class="allow" hidden>${TEXT.proofAllow}</button><button class="share" hidden>${TEXT.proofShareBtn}</button><p class="msg"></p></footer></aside>`;
    (document.body || document.documentElement).append(host);
    proofPanel = { host, root, sig: '' };
    root.addEventListener('input', proofPreview);
    root.addEventListener('change', e => proofSetting(e.target));
    root.addEventListener('click', e => {
      if (e.target.closest('.x')) setProof(false);
      else if (e.target.closest('[data-swap]')) {
        const s = proofQ('[data-f="sender"]'), r = proofQ('[data-f="receiver"]');
        [s.value, r.value] = [r.value, s.value]; proofPreview();
      } else if (e.target.closest('.send')) proofSend(false);
      else if (e.target.closest('.share')) proofSend(true);
      else if (e.target.closest('.allow')) { B.runtime.sendMessage({ type: 'ronote:proof-allow' }).catch(() => {}); proofSay(TEXT.proofAllowHint); }
      else if (e.target.closest('[data-clear]')) { B.storage.local.set({ proofImage: '' }).catch(() => {});
        if (proofLook.mask === 'image') B.runtime.sendMessage({ type: 'ronote:settings', patch: { proofMask: 'dots' } }).catch(() => {}); }
    });
    proofFill();
  }
  function closeProofPanel() { proofPanel?.host.remove(); proofPanel = null; }
  // Un autre trade ouvert, panneau ouvert : ses lignes suivent.
  function proofFollow() { if (proofPanel && proofPanel.sig !== JSON.stringify(proofInfo())) proofFill(); }
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
  /**
   * « Send again » à côté de Decline (offres reçues et envoyées) : ouvre la
   * fenêtre de trade avec le même joueur, sans passer par son profil.
   * Le bouton est un CLONE du Decline de Roblox (calque de survol, police,
   * arrondi), le libellé seul change : il a donc son animation au survol et à
   * l'appui. Le conteneur `.trade-buttons` met déjà l'écart (flex, gap).
   * Cherché d'abord dans ce conteneur, puis dans toute la page en secours ;
   * rien n'est refait tant que le Decline reste le même.
   */
  let resendButton = null, resendFrom = null;
  const DECLINE_RE = /^(decline|refuser|rechazar|ablehnen|recusar|rifiuta)$/i;
  function declineButton() {
    if (resendFrom?.isConnected && resendFrom.offsetParent !== null) return resendFrom;
    const near = document.querySelectorAll('.trade-buttons button');
    for (const list of [near, document.querySelectorAll('button')]) {
      for (const b of list) {
        if (b === resendButton || b.closest('[data-rn]') || b.offsetParent === null) continue;
        if (DECLINE_RE.test((b.textContent || '').trim())) return b;
      }
    }
    return null;
  }
  function buildResend(decline) {
    const clone = decline.cloneNode(true);
    clone.type = 'button';
    clone.dataset.rn = 'trade-resend';
    clone.removeAttribute('id');
    clone.disabled = false;
    // le texte vit dans la feuille la plus profonde (le <span> de Roblox) : on ne touche qu'elle
    const leaf = [...clone.querySelectorAll('*')].reverse().find(el => !el.childElementCount && (el.textContent || '').trim())
      || clone;
    leaf.textContent = TEXT.resend;
    clone.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const id = Number(clone.dataset.partner) || 0;
      if (id) location.href = `https://www.roblox.com/users/${id}/trade`;
    });
    return clone;
  }
  function mountResend(page) {
    const decline = page?.partnerId > 0 && !page.composer ? declineButton() : null;
    if (!decline) { resendButton?.remove(); resendButton = null; resendFrom = null; return; }
    if (!resendButton || resendFrom !== decline || resendButton.className !== decline.className) {
      resendButton?.remove(); resendButton = null; resendFrom = null;
      resendButton = buildResend(decline);
      resendFrom = decline;
    }
    if (resendButton.dataset.partner !== String(page.partnerId)) {
      resendButton.dataset.partner = String(page.partnerId);
      const title = TEXT.resendTitle(page.handle);
      resendButton.title = title; resendButton.setAttribute('aria-label', title);
    }
    if (resendButton.previousElementSibling !== decline) decline.after(resendButton);
  }
  function mountProfileLink(page) {
    const heading = page?.partnerId > 0 && page.tradeHeading?.isConnected ? page.tradeHeading : null;
    if (!heading) { flexControl?.remove(); proofControl?.remove(); setProof(false); serialControl?.remove(); profileLink?.remove(); profileLink = null; tools?.remove(); releaseHeading(); return; }
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
    if (isCompleted(page)) {
      if (!proofControl) {
        proofControl = document.createElement('button');
        proofControl.type = 'button';
        proofControl.dataset.rn = 'trade-proof';
        // Un bouclier coché : « preuve », sans texte à traduire.
        proofControl.innerHTML = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z"/><path d="M8.5 12.2l2.4 2.4 4.6-4.8"/></svg>';
        proofControl.title = TEXT.proof;
        proofControl.setAttribute('aria-label', TEXT.proof);
        proofControl.style.cssText = profileLink.style.cssText + 'padding:0;cursor:pointer;color:#3fcf6e;';
        proofControl.addEventListener('click', () => setProof(!proofOn));
      }
      // Juste après Trade Flex (ou en tête) : une place fixe, sinon les deux s'échangent à chaque passage.
      const flexOn = flexControl?.parentElement === tools;
      if (flexOn ? flexControl.nextElementSibling !== proofControl : tools.firstElementChild !== proofControl) {
        if (flexOn) flexControl.after(proofControl); else tools.prepend(proofControl);
      }
    } else if (proofControl?.isConnected) {
      proofControl.remove(); setProof(false);
    }
  }
  const clear = () => {
    flexControl?.remove(); globalThis.RoNoteFlex?.close();
    proofControl?.remove(); setProof(false);
    resetSerials(); serialControl?.remove();
    clearNearbyLines();
    restore(); host?.remove(); host = null; signature = ''; generation++;
    profileLink?.remove(); profileLink = null; tools?.remove();
    resendButton?.remove();
    releaseHeading();
    for (const badge of badges.values()) { dropBadge(badge); }
    badges.clear();
    for (const total of totalBadges.values()) { total.node.remove(); total.drow.remove(); }
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
  // grille le place après les cellules positionnées par Roblox : en bas, quelle
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
      const text = !available ? `${label} · ${pending && field === 'value' ? '…' : 'N/A'}`
        : globalThis.RoNoteBanner ? globalThis.RoNoteBanner.amount(delta, pct, bannerSettings)
        : `${signed(delta)} (${pct === null ? 'N/A' : signed(Math.round(pct)) + '%'})`;
      if (cell.children[1].textContent !== text) cell.children[1].textContent = text;
      cell.title = available ? TEXT.explanation +
        (a.valueStale ? TEXT.cached : '') +
        (field === 'value' && items.some(i => i.noValue) ? TEXT.rapForUnvalued : '')
        : missingWhy(a, field);
    }
    tidyBannerBoundary();
    proofFollow();
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
    mountResend(page);
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
