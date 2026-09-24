/**
 * ==========================================================================
 *  ÉCARTS RAP / VALUE SUR LES LISTES DE TRADES
 * --------------------------------------------------------------------------
 *  Script classique : la page Roblox n'accepte pas les imports d'une
 *  extension (voir content/tradedom.js).
 *
 *  Contrairement au bandeau (content/trade-delta.js), qui lit les DEUX
 *  offres d'un trade OUVERT, ici la liste (Reçus / Envoyés / Terminés)
 *  n'affiche jamais les objets : impossible de recalculer quoi que ce soit
 *  depuis la page seule. On réutilise donc ce que RoNote a déjà évalué pour
 *  son propre popup (`ronote:get`, `ronote:hydrate`) plutôt que d'inventer
 *  un second système : même cache, même limite de débit, aucun appel réseau
 *  de plus que d'ouvrir le popup sur cet onglet.
 *
 * --------------------------------------------------------------------------
 *  RATTACHER UNE LIGNE À UN TRADE, SANS SON IDENTIFIANT
 *
 *  La page ne porte l'identifiant du trade nulle part dans une ligne de
 *  liste (seul un trade OUVERT le met dans l'URL). RoNote connaît en
 *  revanche l'ordre exact des trades (même tri « plus récent d'abord » que
 *  Roblox) et le pseudo de chaque partenaire : la ligne N de la page et
 *  l'entrée N du relevé sont donc censées être le même trade.
 *
 *  Une pastille sur le MAUVAIS trade serait pire que pas de pastille du
 *  tout — le genre d'erreur qui pousse à accepter un trade en pensant que
 *  c'en est un autre. Le rang seul ne suffit donc pas : le pseudo affiché
 *  sur la ligne doit aussi correspondre à celui du relevé. Un désaccord,
 *  une ligne en trop ou en moins, et cette ligne reste simplement sans
 *  pastille plutôt que d'en recevoir une fausse.
 * ==========================================================================
 */
(() => {
  const B = globalThis.browser ?? globalThis.chrome;
  const look = globalThis.RoNoteListLook;
  if (!B || !look || globalThis.__rnListBadges) return;
  globalThis.__rnListBadges = true;

  let dead = false, observer = null, ticker = 0, timer = null, lastUrl = location.href, lastKind = null;
  const alive = () => {
    if (dead) return false;
    try { if (B?.runtime?.id) return true; } catch { /* invalidated */ }
    shutdown();
    return false;
  };

  let enabled = true;
  // Contenu, format, style, taille, et les couleurs du bandeau (Réglages ›
  // Analyse de valeur) : voir content/list-look.js.
  let prefs = look.normalize();
  if (alive()) B.storage?.local?.get('settings').then(got => {
    enabled = got?.settings?.listBadges !== false;
    prefs = look.normalize(got?.settings);
    if (!enabled) clearRows(); else schedule();
  }).catch(() => {});
  // Ce qui change ce qu'affiche une ligne : la table des cotes (`roli`,
  // écrite par roli.js à chaque rafraîchissement) et ces réglages.
  const REDRAW_SETTINGS = ['valueBasis', 'robuxTax', 'speculativeRatio', 'useRolimons',
    'bannerGain', 'bannerLoss', 'bannerStyle', ...Object.keys(look.DEFAULTS)];
  if (alive()) B.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local' || dead) return;
    if (changes.settings) {
      prefs = look.normalize(changes.settings.newValue);
      const next = changes.settings.newValue?.listBadges !== false;
      if (next !== enabled) {
        enabled = next;
        if (!enabled) { clearRows(); return; }
        schedule();
      }
    }
    const before = changes.settings?.oldValue, after = changes.settings?.newValue;
    if (changes.roli || (changes.settings && REDRAW_SETTINGS.some(k => before?.[k] !== after?.[k]))) refreshAll();
  });

  const TAB_KIND = { inbound: 'inbound', outbound: 'outbound', completed: 'completed' };
  // Nos éléments seulement : `data-rn` marque aussi ceux du bandeau
  // (content/trade-delta.js), affiché dans le panneau de droite de cette même page.
  const OURS = '.ronote-lb, .ronote-lb-date';

  // L'apparence vient de content/list-look.js ; ici, seulement le placement
  // par-dessus la ligne de Roblox. Aucune police, taille ni gris à nous :
  // `layout` recopie ceux du statut de la ligne.
  const STYLE_ID = 'ronote-list-style';
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = look.CSS + `
      .ronote-lb{position:absolute;top:0;right:12px;pointer-events:none;z-index:2}
      .ronote-lb-date{position:absolute;pointer-events:none;white-space:nowrap;z-index:2;margin:0}
    `;
    document.head.appendChild(style);
  }

  /** The trades list (/trades), never a single trade open (?tradeId=…). */
  function onListPage() {
    const p = location.pathname;
    if (!/^(?:\/[a-z]{2}(?:[-_][a-z]{2})?)?\/trades\/?$/i.test(p)) return false;
    // URLSearchParams#has is case-sensitive; Roblox's own param is "tradeId".
    for (const key of new URLSearchParams(location.search).keys()) {
      if (key.toLowerCase() === 'tradeid') return false;
    }
    return true;
  }
  /** Reçus / Envoyés / Terminés only: Inactive mixes outcomes RoNote doesn't score the same way. */
  function currentKind() {
    const tab = (new URLSearchParams(location.search).get('tab') || 'Inbound').toLowerCase();
    return TAB_KIND[tab] || null;
  }

  const USER_LINK = 'a[href*="/users/"]';
  const norm = (s) => String(s || '').toLowerCase().replace(/^@/, '').replace(/[^a-z0-9]/g, '');
  const sameName = (a, b) => !!a && !!b && (a === b || a.includes(b) || b.includes(a));

  /**
   * La ligne d'un lien de profil : son plus proche ancêtre qui porte du
   * texte — l'avatar seul (ce que contient le lien) n'en a jamais, le pseudo
   * juste à côté (hors du lien) en apporte. Compter les frères de même
   * classe pour repérer « la » ligne échoue dès qu'un seul trade est ouvert
   * (rien à quoi le comparer) et attrape alors un ancêtre bien plus large au
   * hasard d'une classe de mise en page partagée ailleurs sur la page —
   * vérifié sur roblox.com/trades. Monter jusqu'au premier texte est plus
   * sûr et ne dépend d'aucun nom de classe.
   */
  function rowOf(link) {
    let el = link;
    for (let i = 0; i < 8 && el.parentElement; i++) {
      el = el.parentElement;
      if (el.textContent.trim()) return el;
    }
    return null;
  }

  /**
   * Le pseudo n'est pas dans le lien de profil (il n'entoure que l'avatar) :
   * c'est le premier texte visible de la ligne, avant le statut et la date.
   */
  function firstText(row) {
    const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode());) {
      const t = n.textContent.trim();
      if (t) return t;
    }
    return '';
  }

  // Chaque ligne de liste porte une date (« …Completed9/23/2026 ») ; le
  // panneau de détail à droite, lui, montre le même profil sous un « Trade
  // with X » sans date — c'est ce qui les distingue, pas leur forme.
  const ROW_DATE = /\d{1,2}\/\d{1,2}\/\d{2,4}/;
  const DATE_ONLY = /^\d{1,2}\/\d{1,2}\/\d{2,4}$/;

  /** Les feuilles de texte de Roblox dans la ligne, dans l'ordre : pseudo, statut, date. */
  function textLeaves(row) {
    const out = [];
    for (const el of row.querySelectorAll('*')) {
      if (el.children.length || el.closest('[data-rn]')) continue;
      if (el.textContent.trim()) out.push(el);
    }
    return out;
  }

  /** L'élément de Roblox qui porte la date (masqué ou non), jamais notre copie. */
  function dateElIn(row) {
    return textLeaves(row).find(el => DATE_ONLY.test(el.textContent.trim())) || null;
  }

  /**
   * La carte entière du trade, marges comprises. `rowOf` s'arrête au bloc
   * qui porte le texte (la hauteur de l'avatar) ; la pastille, elle, doit
   * pouvoir occuper toute la carte. On remonte tant que l'ancêtre ne contient
   * que CE trade (un seul lien de profil) et qu'il ne grandit pas d'un coup
   * — ce qui signalerait qu'on est sorti de la carte.
   */
  function cardOf(row) {
    let el = row;
    for (let i = 0; i < 6 && el.parentElement; i++) {
      const p = el.parentElement;
      if (p.querySelectorAll(USER_LINK).length > 1) break;
      const a = el.getBoundingClientRect(), b = p.getBoundingClientRect();
      if (b.height > Math.max(a.height * 2.2, 160) || b.width > a.width * 1.4) break;
      el = p;
    }
    return el;
  }

  /** Le rectangle du TEXTE, pas de son conteneur (le statut occupe toute la largeur). */
  function textRect(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect();
  }

  function findRows() {
    const seen = new Set();
    const rows = [];
    const scope = document.querySelector('main') || document;
    for (const link of scope.querySelectorAll(USER_LINK)) {
      const row = rowOf(link);
      if (!row || seen.has(row)) continue;
      // Une ligne de liste est compacte (pseudo, statut, date) ; un texte
      // bien plus long trahit un ancêtre trop large — mieux vaut l'ignorer
      // que risquer une pastille posée n'importe où.
      const text = row.textContent.trim();
      if (!text || text.length > 160 || !ROW_DATE.test(text)) continue;
      const name = firstText(row);
      if (!name) continue;
      seen.add(row);
      rows.push({ row, name: norm(name), top: row.getBoundingClientRect().top });
    }
    rows.sort((a, b) => a.top - b.top);
    return rows;
  }

  /**
   * RAP et Value l'un sous l'autre, dans la colonne où Roblox mettait la
   * date (content/list-look.js). Les deux peuvent diverger (RAP en hausse,
   * Value en baisse) — c'est justement le repère que RoNote met en avant
   * ailleurs (voir analysis.js, `divergent`) : chacun garde sa propre couleur.
   */
  function badgeEl(card) {
    const b = look.build(card.analysis, prefs);
    b.dataset.rn = '1';
    return b;
  }

  /**
   * La date de Roblox occupe le coin droit de la ligne, exactement là où la
   * pastille doit aller. Elle passe donc sous le pseudo, à la suite du statut
   * (« Completed · 9/22/2026 »), et la colonne de droite revient entière à
   * la pastille.
   *
   * L'élément de Roblox n'est jamais déplacé : React le gère, et déplacer un
   * nœud qu'il suit lui fait lever une erreur au prochain rendu. Il est
   * seulement rendu invisible (sa place reste réservée, rien ne bouge
   * autour), et une copie à nous est posée au bon endroit.
   */
  function place(row, card) {
    if (!row.isConnected) return;
    const tile = cardOf(row);
    tile.querySelectorAll(':scope > .ronote-lb, :scope > .ronote-lb-date').forEach(el => el.remove());
    // La carte doit être l'ancre des éléments absolus ; `!important` : une
    // règle Roblox plus spécifique doit tout de même céder, sans quoi ils se
    // positionneraient contre un ancêtre bien plus grand (vu en test).
    if (getComputedStyle(tile).position === 'static') {
      tile.style.setProperty('position', 'relative', 'important');
    }
    tile.appendChild(badgeEl(card));
    const date = dateElIn(row);
    if (date) {
      const copy = document.createElement('span');
      copy.dataset.rn = 'date';
      copy.className = 'ronote-lb-date';
      copy.textContent = date.textContent.trim();
      tile.appendChild(copy);
      date.dataset.rnHidden = '1';
      date.style.visibility = 'hidden';
    }
    row.dataset.rnBadge = '1';
    layout(row);
  }

  /**
   * Positions mesurées sur la carte telle qu'elle est rendue, jamais
   * supposées : sa hauteur et la place de chaque texte changent avec le
   * zoom et la largeur de fenêtre. Rejouée au redimensionnement.
   */
  function layout(row) {
    const tile = cardOf(row);
    const badge = tile.querySelector(':scope > .ronote-lb');
    if (!badge) return;
    const rowRect = tile.getBoundingClientRect();
    const date = row.querySelector('[data-rn-hidden]');
    const leaves = textLeaves(row).filter(el => el !== date);

    // 1) La date sous le pseudo, en premier : c'est elle qui fixe jusqu'où
    //    va réellement la colonne de texte.
    const copy = tile.querySelector(':scope > .ronote-lb-date');
    const [nameEl, statusEl] = leaves;
    const anchor = statusEl || nameEl;
    if (copy && !anchor) copy.remove();
    else if (copy) {
      // Même police que le statut : « Completed · 9/22/2026 » se lit comme
      // une seule ligne de Roblox, pas comme un ajout.
      const cs = getComputedStyle(anchor);
      copy.style.font = cs.font;
      copy.style.color = cs.color;
      const text = textRect(anchor);
      const box = anchor.getBoundingClientRect();
      const dateText = date ? date.textContent.trim() : copy.textContent.replace(/^·\s*/, '');
      if (statusEl) {
        copy.textContent = '· ' + dateText;
        copy.style.left = Math.round(text.right - rowRect.left + 5) + 'px';
        copy.style.top = Math.round(box.top - rowRect.top) + 'px';
      } else {
        copy.textContent = dateText;
        copy.style.left = Math.round(text.left - rowRect.left) + 'px';
        copy.style.top = Math.round(box.bottom - rowRect.top + 1) + 'px';
      }
    }

    // 2) RAP et Value dans la colonne de droite, dans la police et le gris du
    //    statut, à la taille choisie.
    const [firstLine, secondLine] = badge.children;
    const cs = getComputedStyle(statusEl || nameEl || row);
    badge.style.font = cs.font;
    badge.style.fontSize = parseFloat(cs.fontSize) * look.SIZES[prefs.size] + 'px';
    badge.style.color = cs.color;
    const dateRect = date?.getBoundingClientRect();
    badge.style.right = (dateRect ? Math.round(rowRect.right - dateRect.right) : 12) + 'px';
    const nameBox = nameEl?.getBoundingClientRect();
    const statusBox = statusEl?.getBoundingClientRect() || nameBox;

    // En Robux complets tant qu'ils ne touchent pas le texte de gauche
    // (pseudo très long, fenêtre étroite) ; sinon la forme courte.
    let textRight = rowRect.left;
    for (const el of leaves) textRight = Math.max(textRight, textRect(el).right);
    if (copy?.isConnected) textRight = Math.max(textRight, copy.getBoundingClientRect().right);
    if (prefs.format === 'full') {
      look.write(badge, prefs, false);
      if (badge.getBoundingClientRect().left < textRight + 12) look.write(badge, prefs, true);
    }

    if (!nameBox || !firstLine) return;
    if (prefs.style === 'text' && prefs.size === 'm') {
      // Texte seul, taille de la page : chaque ligne à la hauteur de celle
      // d'en face — RAP face au pseudo, Value face au statut. Une seule ligne
      // affichée : face au pseudo, là où Roblox mettait la date.
      badge.style.top = Math.round(nameBox.top - rowRect.top) + 'px';
      firstLine.style.height = Math.round(nameBox.height) + 'px';
      if (secondLine) secondLine.style.height = Math.round(statusBox.height) + 'px';
    } else {
      // Pastilles ou autre taille : leur hauteur n'est plus celle des lignes
      // de Roblox, on centre la colonne sur le bloc pseudo + statut.
      const mid = (nameBox.top + statusBox.bottom) / 2 - rowRect.top;
      badge.style.top = Math.round(mid - badge.getBoundingClientRect().height / 2) + 'px';
    }
  }

  function clearRows() {
    document.querySelectorAll(OURS).forEach(el => el.remove());
    document.querySelectorAll('[data-rn-badge]').forEach(row => { delete row.dataset.rnBadge; });
    document.querySelectorAll('[data-rn-hidden]').forEach(date => {
      date.style.visibility = '';
      delete date.dataset.rnHidden;
    });
  }

  // Cartes déjà connues (verdict, %) : une ligne redessinée par React n'a
  // pas à redemander au service worker ce qu'on sait déjà pour ce trade.
  const cardCache = new Map();
  let generation = 0;

  /**
   * Cotes révisées ou réglage de calcul changé : chaque pastille est
   * recalculée. Les anciennes restent affichées jusqu'à ce que la nouvelle
   * arrive — rien ne clignote, rien ne disparaît. Le service worker refait
   * l'analyse sur le détail qu'il garde déjà : aucun appel à Roblox.
   */
  function refreshAll() {
    if (!enabled || dead) return;
    generation++;
    cardCache.clear();
    document.querySelectorAll('[data-rn-badge]').forEach(row => { delete row.dataset.rnBadge; });
    schedule();
  }

  let scanning = false;
  async function update() {
    if (!alive()) return;
    lastUrl = location.href;
    if (!enabled || !onListPage()) { clearRows(); lastKind = null; return; }
    const kind = currentKind();
    if (kind !== lastKind) { clearRows(); cardCache.clear(); lastKind = kind; }
    if (!kind || scanning) return;

    scanning = true;
    // Une réponse partie avant une révision de cotes ne doit pas reposer
    // d'anciens chiffres par-dessus le rafraîchissement.
    const gen = generation;
    const stale = () => { if (gen === generation) return false; schedule(); return true; };
    try {
      // Toutes les lignes, déjà badgées comprises : le rapprochement se fait
      // par rang, et retirer les lignes déjà servies décalerait tous les
      // suivants — une ligne évaluée en retard ne recevait alors jamais rien.
      const rows = findRows();
      if (!rows.some(r => !r.row.dataset.rnBadge)) return;
      const resp = await B.runtime.sendMessage({ type: 'ronote:get', lite: true }).catch(() => null);
      if (!alive() || !resp || stale()) return;
      const list = resp.state?.snapshot?.[kind] || [];
      if (!list.length) return;

      const matches = [];
      const toFetch = [];
      for (let i = 0; i < rows.length && i < list.length; i++) {
        if (rows[i].row.dataset.rnBadge) continue;
        const entry = list[i];
        const want = norm(entry.partner?.displayName) || norm(entry.partner?.name);
        if (!sameName(want, rows[i].name)) continue;
        const id = Number(entry.tradeId);
        if (!id) continue;
        matches.push({ row: rows[i].row, tradeId: id });
        if (!cardCache.has(id)) toFetch.push(id);
      }
      if (!matches.length) return;

      if (toFetch.length) {
        const hydrated = await B.runtime.sendMessage({ type: 'ronote:hydrate', kind, ids: toFetch }).catch(() => null);
        if (!alive() || stale()) return;
        for (const card of hydrated?.cards || []) cardCache.set(card.tradeId, card);
      }
      for (const m of matches) {
        const card = cardCache.get(m.tradeId);
        if (card) place(m.row, card);
      }
    } finally { scanning = false; }
  }

  function schedule() {
    if (timer || dead) return;
    timer = setTimeout(() => { timer = null; update(); }, 300);
  }

  function shutdown() {
    if (dead) return;
    dead = true;
    try { observer?.disconnect(); clearInterval(ticker); clearTimeout(timer); } catch { /* not set up yet */ }
    try { clearRows(); } catch { /* page already gone */ }
  }

  // Les comptes à rebours ("24 minutes") mutent le texte des lignes en
  // continu : seuls les ajouts/retraits de nœuds justifient un nouveau
  // passage, sinon chaque tick relancerait le rapprochement pour rien.
  observer = new MutationObserver(records => {
    if (!alive() || !enabled) return;
    // Hors des listes (et rien à retirer) : les pages de jeux ajoutent des
    // nœuds sans arrêt, inutile de relancer un passage pour chacun. Un
    // changement d'URL est vu par la minuterie plus bas.
    if (!lastKind && !onListPage()) return;
    if (records.some(r => r.addedNodes.length || r.removedNodes.length)) schedule();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  globalThis.addEventListener('popstate', schedule);
  globalThis.addEventListener('hashchange', schedule);
  // Largeur de fenêtre ou zoom changés : les textes de Roblox se replacent,
  // les nôtres doivent suivre.
  let relayout = 0;
  globalThis.addEventListener('resize', () => {
    cancelAnimationFrame(relayout);
    relayout = requestAnimationFrame(() => {
      if (!dead) document.querySelectorAll('[data-rn-badge]').forEach(layout);
    });
  });
  // Couvre aussi la navigation par pushState (onglets Reçus/Envoyés) sans mutation du DOM.
  ticker = setInterval(() => {
    if (!alive()) return;
    if (!document.hidden && location.href !== lastUrl) schedule();
  }, 1000);
  schedule();
})();
