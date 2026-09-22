/**
 * ==========================================================================
 *  LIRE LE TRADE AFFICHÉ SUR LA PAGE
 * --------------------------------------------------------------------------
 *  Le lecteur de la page, a part de scrape.js qui s'en sert : le repli quand
 *  l'API refuse le detail d'un trade. Isole, il reste testable seul.
 *
 * --------------------------------------------------------------------------
 *  PAS UN MODULE, ET C'EST VOLONTAIRE
 *
 *  Roblox sert une politique de securite de contenu stricte :
 *
 *      script-src 'self' 'unsafe-inline' apis.roblox.com js.rbxcdn.com ...
 *
 *  Le scheme `chrome-extension:` n'y figure pas. Or un `import()` dynamique
 *  lance depuis un script de contenu est resolu par le chargeur de modules de
 *  LA PAGE : il tombe donc sous cette politique et se fait refuser. Le script
 *  echouait a sa premiere ligne, en silence, et rien ne s'affichait.
 *
 *  Ce fichier est donc un script classique, declare dans le manifeste avant
 *  ceux qui s'en servent. Les scripts de contenu d'une meme extension
 *  partagent le meme monde isole : `RoNoteDom` suffit a les relier, sans un
 *  seul chargement reseau.
 *
 * --------------------------------------------------------------------------
 *  IDENTIFIANTS POUR LES OBJETS, LIBELLES POUR LES OFFRES ET LES TOTAUX
 *
 *  Roblox renomme ses classes, traduit ses titres et abrege ses nombres. Les
 *  trois seules choses stables sur cette page sont :
 *
 *    - les LIENS des objets      /catalog/{id} et /bundles/{id}
 *    - les LIENS des profils     /users/{id}
 *    - la STRUCTURE              les objets d'une meme colonne partagent un
 *                                ancetre que l'autre colonne n'a pas.
 *
 *  Le decoupage en colonnes s'appuie d'abord sur le PROFIL quand il existe :
 *  chaque objet est rattache au plus proche
 *  ancetre qui cite un profil. Deux colonnes, deux proprietaires, aucune
 *  ambiguite — et si un inventaire est ouvert a cote, ses objets tombent sur
 *  un troisieme ancetre, ce qui fait renoncer au lieu de melanger l'inventaire
 *  avec l'offre.
 *
 *  Sans profil (page classique avec « Items you gave / received »), la
 *  structure separe les offres et leurs titres en donnent le sens. Les prix
 *  exacts des cartes et les lignes de total completent la lecture ; aucun
 *  montant abrege ni numero de serie n'est traite comme un prix.
 *
 *  Le NOM lu ici ne sert qu'a l'affichage et au rapprochement de secours :
 *  deux objets peuvent porter des noms tres proches pour des cotes tres
 *  differentes (« Gucci ... (1.0) » vaut 5787, « (3.0) » vaut 3113). Ce qui
 *  compte, c'est l'identifiant.
 * ==========================================================================
 */
(() => {

const ITEM_LINK = 'a[href*="/catalog/"], a[href*="/bundles/"]';

/** {assetId, bundleId} porte par un lien d'objet, ou null. */
function idOf(a) {
  const href = a.getAttribute('href') || '';
  let m = /\/bundles\/(\d+)/.exec(href);
  if (m) return { bundleId: Number(m[1]), assetId: 0 };
  m = /\/catalog\/(\d+)/.exec(href);
  if (m) return { bundleId: 0, assetId: Number(m[1]) };
  return null;
}

/**
 * Texte le plus proche servant de nom a l'objet.
 *
 * Ce que RoNote a lui-meme ajoute sous l'objet (sa cote, sa pastille) est
 * ecarte : sinon le nom lu grossirait a chaque rendu et ne designerait plus
 * l'objet mais notre propre affichage.
 */
function nameOf(a) {
  let t = '';
  for (const n of a.childNodes) {
    if (n.nodeType === 1 && n.dataset?.rn) continue;
    t += n.textContent || '';
  }
  t = t.trim();
  if (t) return t.slice(0, 120);
  const img = a.querySelector('img[alt]');
  return (img?.getAttribute('alt') || '').trim().slice(0, 120);
}

const USER_LINK = 'a[href*="/users/"]';

// Exact amounts only: never interpret 1.4K or a serial number as a price.
function count(text) {
  const s = String(text ?? '').trim();
  if (!/^(?:\d+|\d{1,3}(?:[, .\u00a0\u202f]\d{3})+)$/.test(s)) return null;
  const n = Number(s.replace(/[, .\u00a0\u202f]/g, ''));
  return Number.isSafeInteger(n) ? n : null;
}

const HEADING = 'h1,h2,h3,h4,h5,h6,[role="heading"],.font-header-1,.font-header-2,.font-header-3';
const headingText = (text) => String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[’']/g, "'").replace(/\byou've\b/g,'you have')
    .replace(/\byou would've\b/g,'you would have').replace(/\s+/g,' ').trim().replace(/\s*:\s*$/,'');
function roleOf(text) {
  const s = headingText(text);
  if (/^items you (?:gave|give|will give|are giving|would give|would have given|offered)$/.test(s) ||
      /^(?:objets|articles) que (?:vous|tu) (?:avez donne|avez donnes|as donnes|donnez|donnes|allez donner|vas donner|auriez donnes|aurais donnes|auriez donne|aurais donne)$/.test(s)) return 'give';
  if (/^items you (?:received|receive|will receive|are receiving|would receive|would have received)$/.test(s) ||
      /^(?:objets|articles) que (?:vous|tu) (?:avez recu|avez recus|as recus|recevez|recois|allez recevoir|vas recevoir|auriez recus|aurais recus|auriez recu|aurais recu)$/.test(s)) return 'get';
  return '';
}

/**
 * Where the trade stands, read from the tense of an offer heading:
 *   done      "Items you gave / received"            (Completed tab)
 *   inactive  "Items you would have given / received"
 *   open      "Items you will give / give / receive…" (Inbound, Outbound)
 * '' when the heading says nothing about it.
 */
function phaseOf(text) {
  const s = headingText(text);
  if (/^items you would have (?:given|received)$/.test(s) ||
      /^(?:objets|articles) que (?:vous|tu) (?:auriez|aurais) (?:donnes?|recus?)$/.test(s)) return 'inactive';
  if (/^items you (?:gave|received)$/.test(s) ||
      /^(?:objets|articles) que (?:vous|tu) (?:avez|as) (?:donnes?|recus?)$/.test(s)) return 'done';
  return roleOf(text) ? 'open' : '';
}

function headingFor(root) {
  let own = [...root.querySelectorAll(HEADING)].filter(h => h.offsetParent !== null && roleOf(h.textContent));
  // Closed uses plain text containers on some versions of Roblox.
  if (!own.length) own = [...root.querySelectorAll('*')].filter(h => h.offsetParent !== null && roleOf(h.textContent));
  if (own.length && new Set(own.map(h => roleOf(h.textContent))).size === 1) return own[0];
  // Some versions place the heading immediately before the item grid.
  for (let n = root.previousElementSibling; n; n = n.previousElementSibling) {
    if (n.querySelector?.(ITEM_LINK)) break;
    if (roleOf(n.textContent)) return n;
  }
  return null;
}

function numericIn(node) {
  if (!node) return null;
  const direct = count(node.getAttribute?.('title')) ?? count(node.textContent);
  if (direct !== null) return direct;
  for (const el of node.querySelectorAll('*')) {
    const n = count(el.getAttribute('title')) ?? count(el.textContent);
    if (n !== null) return n;
  }
  return null;
}

function labeledAmount(root, pattern) {
  for (const el of root.querySelectorAll('*')) {
    if (!pattern.test((el.textContent || '').trim()) || el.querySelector(ITEM_LINK)) continue;
    for (let row = el.parentElement, depth = 0; row && root.contains(row) && depth < 3; row = row.parentElement, depth++) {
      if (row.querySelector(ITEM_LINK)) break;
      const amount = numericIn(row);
      if (amount !== null) return { amount, label: el.textContent };
    }
  }
  return null;
}

/** L'élément qui porte le montant lui-même (« 1496 »), pour écrire la Value à côté. */
function amountLeaf(node) {
  if (!node) return null;
  if (!node.childElementCount && count(node.textContent) !== null) return node;
  for (const el of node.querySelectorAll('*')) {
    if (!el.childElementCount && !el.closest('[data-rn]') && count(el.textContent) !== null) return el;
  }
  return null;
}

function itemOnPage(a, root) {
  const id = idOf(a), key = i => i.bundleId ? 'b' + i.bundleId : 'a' + i.assetId;
  let card = a, rap = null, priceEl = null;
  for (let node = a; node && node !== root; node = node.parentElement) {
    const links = [...node.querySelectorAll(ITEM_LINK)];
    if (links.some(link => idOf(link) && key(idOf(link)) !== key(id))) break;
    // Past its own card, a node holding another thumbnail is a whole grid:
    // its prices belong to the neighbours (cards without links included).
    if (node !== a && node.querySelectorAll('img').length > Math.max(1, a.querySelectorAll('img').length)) break;
    if (card === a && node.matches?.('.item-card,.item-card-container,li')) card = node;
    const prices = [...node.querySelectorAll('[class*="robux" i]')];
    for (const price of prices) {
      rap = numericIn(price);
      if (rap !== null) priceEl = amountLeaf(price);
      // An icon may have a sibling amount, but not a sibling card/name.
      if (rap === null && !price.parentElement?.querySelector(ITEM_LINK)) {
        rap = numericIn(price.parentElement);
        if (rap !== null) priceEl = amountLeaf(price.parentElement);
      }
      if (rap !== null) { card = node; break; }
    }
    if (rap !== null) break;
    // A recognised card is the limit: nothing above it describes this item.
    if (card !== a && card === node) break;
  }
  return { ...id, name: nameOf(a), link: a, card, rap, priceEl };
}

function sideOnPage(g) {
  const heading = headingFor(g.root);
  const seen = new Set();
  const items = g.links.map(a => itemOnPage(a, g.root)).filter(i => {
    if (seen.has(i.card)) return false;
    seen.add(i.card); return true;
  });
  const total = labeledAmount(g.root, /^(?:Total Value|Valeur totale)\s*:?$/i);
  const totalLabel = [...g.root.querySelectorAll('*')].find(el =>
    !el.childElementCount && /^(?:Total Value|Valeur totale)\s*:?$/i.test((el.textContent || '').trim())) || null;
  const robux = labeledAmount(g.root, /^(?:Robux Offered|Robux offerts|Robux proposes)(?:\s*\([^)]*\))?\s*:?$/i);
  return {
    root: g.root, heading, totalLabel, role: roleOf(heading?.textContent), items,
    userIds: userIdsIn(g.root), robuxText: robuxTextIn(g.root),
    rapTotal: total?.amount ?? null,
    robux: robux?.amount ?? 0,
    robuxNet: !!robux && /after|apres|nets?/i.test(robux.label)
  };
}

// Synchronous RAP while the worker resolves Rolimon's values.
function visibleAnalysis(page) {
  const give = page.sides.find(s => s.role === 'give');
  const get = page.sides.find(s => s.role === 'get');
  if (!give || !get) return null;
  const side = s => ({ items: s.items, rap: s.rapTotal ??
    (s.items.every(i => i.rap !== null && i.rap !== undefined) ? s.items.reduce((n, i) => n + i.rap, 0) +
      (s === get && !s.robuxNet ? Math.floor((s.robux || 0) * .7 + 1e-9) : s.robux || 0) : null) });
  const a = { give: side(give), get: side(get), valueAvailable: false, fromPage: true };
  a.rapAvailable = a.give.rap !== null && a.get.rap !== null;
  return a;
}

const byRoot = (links, rootOf) => {
  const groups = new Map();
  for (const a of links) {
    const r = rootOf(a);
    if (!r) return null;                 // un lien qu'on ne sait pas rattacher
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(a);
  }
  return [...groups.entries()].map(([root, list]) => ({ root, links: list }));
};

/** Le plus proche ancetre du lien qui cite AUSSI un profil : le panneau d'offre. */
function offerRootOf(a) {
  for (let n = a.parentElement; n; n = n.parentElement) {
    if (n.querySelector(USER_LINK)) return n;
  }
  return null;
}

/** Deux colonnes dont l'une contient l'autre : le decoupage ne veut rien dire. */
const nested = (groups) => groups.some(g =>
  groups.some(o => o !== g && g.root.contains(o.root)));

/** Le decoupage par structure : le plus haut ancetre qui n'a pas tous les liens. */
function structural(links) {
  if (links.length < 2) return [{ root: links[0], links: [...links] }];
  return byRoot(links, (a) => {
    let node = a, best = a;
    while (node.parentElement) {
      node = node.parentElement;
      if (links.every(link => node.contains(link))) break;
      best = node;
    }
    return best;
  }) || [];
}

/**
 * Regroupe les liens en colonnes sans dependre de la langue ni des classes.
 *
 * Le decoupage par proprietaire passe en premier. Quand il ne donne pas deux
 * colonnes nettes, on retombe sur la structure — mais seulement si aucune des
 * deux colonnes obtenues ne cite DEUX proprietaires : ce cas-la, c'est le
 * trade entier pris pour une colonne et un inventaire pris pour l'autre. Le
 * panneau annoncerait alors un gain calcule sur l'inventaire, ce qui est bien
 * pire que pas de panneau du tout.
 *
 * @returns {Array<{root: Element, links: Element[]}>} deux colonnes, ou un
 *          decoupage que `readTradePage` refusera.
 */
function groupLinks(links) {
  if (!links.length) return [];

  const byOffer = byRoot(links, offerRootOf);
  if (byOffer?.length === 2 && !nested(byOffer)) return byOffer;

  const st = structural(links);
  const oneOwnerEach = st.every(g => g.root.querySelectorAll(USER_LINK).length <= 1);
  if (st.length === 2 && !nested(st) && oneOwnerEach) return st;

  return byOffer || st;
}

/** Identifiants de profil cites dans une colonne : dit a qui elle appartient. */
function userIdsIn(root) {
  const out = new Set();
  for (const a of root.querySelectorAll('a[href*="/users/"]')) {
    const m = /\/users\/(\d+)/.exec(a.getAttribute('href') || '');
    if (m) out.add(Number(m[1]));
  }
  return [...out];
}

/**
 * Montant en Robux affiche dans une colonne, tel quel (le texte, pas un
 * nombre : c'est `strictCount` qui decide s'il est exploitable).
 * @returns {string|null} null si la colonne n'affiche aucun Robux.
 */
function robuxTextIn(root) {
  for (const el of root.querySelectorAll('[class*="robux" i]')) {
    // L'icone elle-meme n'a pas de texte : le montant est a cote, donc on
    // remonte d'un cran ou deux, sans jamais sortir de la colonne.
    let node = el;
    for (let up = 0; up < 3 && node && node !== root.parentElement; up++) {
      const txt = (node.textContent || '').trim();
      if (/\d/.test(txt)) return txt.slice(0, 40);
      node = node.parentElement;
    }
  }
  return null;
}

/** @handle du partenaire, seul identifiant textuel fiable de la page. */
function partnerHandle() {
  // `textContent`, pas `innerText` : innerText force un calcul de mise en page
  // de TOUTE la page a chaque appel — et cet appel revient a chaque mutation.
  const root = document.querySelector('main') || document.body;
  const m = /@([A-Za-z0-9_]{3,20})/.exec(root?.textContent || '');
  return m ? m[1] : '';
}

/**
 * Le trade affiche, colonnes comprises.
 *
 * On s'ABSTIENT des que la mise en page n'est pas celle attendue (une seule
 * colonne, trois colonnes, un inventaire ouvert a cote) : mieux vaut aucun
 * panneau qu'un panneau qui additionne l'inventaire avec l'offre.
 *
 * @returns {{ok: boolean, reason?: string, tradeId: string, handle: string,
 *            sides: Array<{root, items: Array<{assetId, bundleId, name, link}>,
 *                          userIds: number[], robuxText: string|null}>}}
 */
/* --------------------------------------------------------------------------
 *  LA PAGE DE CRÉATION D'UN TRADE
 *
 *  « Trade with X » : ton inventaire et le sien à gauche, « Your Offer » et
 *  « Your Request » à droite. Lire la page entière y prenait les deux
 *  INVENTAIRES pour les offres. Ici, seuls les deux paniers comptent : chacun
 *  est le plus proche ancêtre de son titre qui porte sa ligne « Total Value »
 *  sans contenir l'autre titre.
 * ------------------------------------------------------------------------ */
const OFFER_HEAD = /^(?:your offer|votre offre|ton offre)$/i;
const REQUEST_HEAD = /^(?:your request|votre demande|ta demande)$/i;
const TOTAL_LABEL = /^(?:Total Value|Valeur totale)\s*:?$/i;
const TRADE_WITH = /^(?:trade with|échanger avec|echanger avec)\b/i;
// Les deux inventaires de la colonne de gauche : le bandeau se pose sur le
// séparateur qui les divise.
const MY_INVENTORY = /^(?:your inventory|ton inventaire|votre inventaire)$/i;
const THEIR_INVENTORY = /^(?:.{1,32}['’]s inventory|inventaire de .{1,32})$/i;

function visibleText(re) {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const v = n.nodeValue;
    if (v.length > 40 || !re.test(v.trim().replace(/\s*:$/, ''))) continue;
    const el = n.parentElement;
    if (el && el.offsetParent !== null && !el.closest('[data-rn]')) return el;
  }
  return null;
}

function composerTitle() {
  const heading = [...document.querySelectorAll(HEADING)].find(el =>
    el.offsetParent !== null && TRADE_WITH.test((el.textContent || '').trim()));
  if (heading) return heading;
  // Roblox has also shipped this title as plain nested divs. Start from its
  // text node and keep the smallest visible parent containing the @handle.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!TRADE_WITH.test((n.nodeValue || '').trim())) continue;
    for (let el = n.parentElement, depth = 0; el && depth < 5; el = el.parentElement, depth++) {
      if (el.offsetParent !== null && /@[A-Za-z0-9_]{3,20}/.test(el.textContent || '')) return el;
    }
  }
  return null;
}

function composerPartnerId(title) {
  const fromPath = /\/users\/(\d+)\/trade(?:\/|$|[?#])/i.exec(location.href || location.pathname || '');
  if (fromPath) return Number(fromPath[1]);
  const handle = /@([A-Za-z0-9_]{3,20})/.exec(title?.textContent || '')?.[1] || '';
  const links = [...document.querySelectorAll('a[href*="/users/"]')];
  const link = title?.closest?.('a[href*="/users/"]') || title?.querySelector?.('a[href*="/users/"]') ||
    links.find(a => handle && new RegExp(`@?${handle}$`, 'i').test((a.textContent || '').trim()));
  const fromLink = /\/users\/(\d+)/i.exec(link?.getAttribute('href') || '');
  return fromLink ? Number(fromLink[1]) : 0;
}

function composerHandleElement(title) {
  const handle = /@([A-Za-z0-9_]{3,20})/.exec(title?.textContent || '')?.[0] || '';
  if (!handle) return title;
  return [title, ...title.querySelectorAll('*')]
    .filter(el => el.offsetParent !== null && (el.textContent || '').trim() === handle)
    .sort((a, b) => a.childElementCount - b.childElementCount)[0] || title;
}

function basketOf(heading, other) {
  for (let n = heading.parentElement; n && n !== document.body; n = n.parentElement) {
    if (n.contains(other)) return null;
    for (const el of n.querySelectorAll('*')) {
      if (!el.childElementCount && TOTAL_LABEL.test((el.textContent || '').trim())) return n;
    }
  }
  return null;
}

/**
 * Les objets d'un panier quand ils ne sont pas des liens : une ligne avec une
 * vignette, un nom et un montant (« Signature Kicks  657 »). L'identifiant
 * vient ensuite du nom, rapproché de la table Rolimon's par le service worker.
 */
const STATUS_TEXT = /^(?:holding|on hold|en attente|bloqu[ée]e?|#\d+|serial.*|limited(?: u)?|new|nouveau|page|all|tous)$/i;

/**
 * Les cartes d'une grille ou d'une liste, sans dépendre des classes ni des
 * images : une carte porte UN montant exact, et a au moins une sœur de même
 * balise qui en porte un aussi. Ça distingue une vignette d'inventaire de la
 * grille entière, quels que soient les icônes ou images qu'elle contient.
 */
function tileCards(root) {
  const leaves = [...root.querySelectorAll('*')].filter(e => !e.childElementCount && !e.closest('[data-rn]') &&
    e.offsetParent !== null && count(e.textContent) !== null && !e.closest('input,textarea,select'));
  const amounts = new Map();                 // element -> amounts below it
  for (const leaf of leaves) {
    for (let n = leaf; n && n !== root; n = n.parentElement) amounts.set(n, (amounts.get(n) || 0) + 1);
  }
  const cards = new Map();                   // card -> its amount leaf
  for (const leaf of leaves) {
    for (let node = leaf; node.parentElement && node.parentElement !== root; node = node.parentElement) {
      if (amounts.get(node) !== 1) break;
      const twin = [...node.parentElement.children].some(c => c !== node && c.tagName === node.tagName && amounts.has(c));
      if (twin) { cards.set(node, leaf); break; }
    }
  }
  return cards;
}

function namedItems(root) {
  const out = [];
  const rows = new Set();
  for (const [card, priceEl] of tileCards(root)) {
    const texts = [...card.querySelectorAll('*')]
      .filter(e => !e.childElementCount && !e.closest('[data-rn]'))
      .map(e => (e.textContent || '').trim()).filter(Boolean);
    if (texts.some(t => TOTAL_LABEL.test(t))) continue;
    const names = texts.filter(t => count(t) === null && /[a-z]/i.test(t) && !STATUS_TEXT.test(t));
    if (!names.length) continue;
    rows.add(card);
    out.push({ assetId: 0, bundleId: 0, name: names[0].slice(0, 120), names: names.slice(0, 4).map(n => n.slice(0, 120)),
      link: null, card, rap: count(priceEl.textContent), priceEl });
  }
  // Une carte seule dans sa liste n'a pas de sœur : lecture par sa vignette.
  for (const img of root.querySelectorAll('img')) {
    if (img.offsetParent === null || img.closest('[data-rn]')) continue;
    for (let row = img.parentElement, depth = 0; row && row !== root && depth < 5; row = row.parentElement, depth++) {
      if (row.querySelectorAll('img').length > 1 || row.querySelector('input')) break;
      const leaves = [...row.querySelectorAll('*')].filter(e => !e.childElementCount && !e.closest('[data-rn]'));
      const texts = leaves.map(e => (e.textContent || '').trim()).filter(Boolean);
      if (texts.some(t => TOTAL_LABEL.test(t))) break;
      const rap = texts.map(count).find(n => n !== null);
      const priceEl = leaves.find(e => count(e.textContent) !== null) || null;
      // « Holding », « #375 »… : ce qui s'affiche sur la vignette n'est pas le nom.
      const names = texts.filter(t => count(t) === null && /[a-z]/i.test(t) && !STATUS_TEXT.test(t));
      if (rap === undefined || !names.length) continue;
      if (![...rows].some(r => r.contains(row) || row.contains(r))) {
        rows.add(row);
        out.push({ assetId: 0, bundleId: 0, name: names[0].slice(0, 120), names: names.slice(0, 4).map(n => n.slice(0, 120)), link: null, card: row, rap, priceEl });
      }
      break;
    }
  }
  return out;
}

/**
 * Les objets des deux inventaires affichés (page de création d'un trade) :
 * la page courante de chacun, relue à chaque défilement ou changement de page.
 * Les paniers (`exclude`) n'en font pas partie.
 */
/** Objets à lien, complétés par ceux qui n'en ont pas (lus par leur nom). */
function withNamed(linked, root) {
  const named = namedItems(root).filter(n => !n.card.querySelector(ITEM_LINK) &&
    !linked.some(l => l.card.contains(n.card) || n.card.contains(l.card)));
  return [...linked, ...named];
}

function inventoryItems(exclude = []) {
  const mine = visibleText(MY_INVENTORY);
  const theirs = mine && visibleText(THEIR_INVENTORY);
  if (!theirs) return null;
  let col = mine.parentElement;
  while (col && !col.contains(theirs)) col = col.parentElement;
  if (!col || col === document.body || col === document.documentElement) return null;
  const seen = new Set();
  let items = [...col.querySelectorAll(ITEM_LINK)]
    .filter(a => idOf(a) && a.offsetParent !== null)
    .map(a => itemOnPage(a, col))
    .filter(it => !seen.has(it.card) && seen.add(it.card));
  items = withNamed(items, col);
  return items.filter(it => !exclude.some(root => root && root.contains(it.card)));
}

function readComposer() {
  const offer = visibleText(OFFER_HEAD);
  const request = offer && visibleText(REQUEST_HEAD);
  if (!request) return null;
  const roots = [basketOf(offer, request), basketOf(request, offer)];
  if (!roots[0] || !roots[1]) return null;
  const sides = roots.map((root, i) => {
    const seen = new Set();
    let items = [...root.querySelectorAll(ITEM_LINK)]
      .filter(a => idOf(a) && a.offsetParent !== null)
      .map(a => itemOnPage(a, root))
      .filter(it => !seen.has(it.card) && seen.add(it.card));
    items = withNamed(items, root);
    const total = labeledAmount(root, TOTAL_LABEL);
    const totalLabel = [...root.querySelectorAll('*')].find(el =>
      !el.childElementCount && TOTAL_LABEL.test((el.textContent || '').trim())) || null;
    // Les Robux se saisissent dans un champ : sa valeur, pas son texte.
    const field = [...root.querySelectorAll('input')].find(inp => count(inp.value) !== null);
    return {
      root, heading: i ? request : offer, totalLabel, role: i ? 'get' : 'give', items,
      userIds: [], robuxText: field ? field.value : null,
      rapTotal: total?.amount ?? null,
      robux: field ? count(field.value) : 0,
      robuxNet: false
    };
  });
  const mine = visibleText(MY_INVENTORY);
  const theirs = mine && visibleText(THEIR_INVENTORY);
  const tradeHeading = composerTitle();
  return { ok: true, composer: true, tradeId: '', handle: partnerHandle(), partnerId: composerPartnerId(tradeHeading),
    tradeHeading, tradeHandle: composerHandleElement(tradeHeading), sides,
    inventories: theirs ? [mine, theirs] : null };
}

function readTradePage() {
  const composer = readComposer();
  if (composer) return composer;
  const links = [...document.querySelectorAll(ITEM_LINK)]
    .filter(a => idOf(a) && a.offsetParent !== null);
  if (!links.length) return { ok: false, reason: 'vide', tradeId: '', handle: '', sides: [] };

  const groups = groupLinks(links);
  if (groups.length !== 2) {
    return { ok: false, reason: 'colonnes:' + groups.length, tradeId: '', handle: '', sides: [] };
  }

  const m = /(?:[?&#]|^)tradeId=(\d+)/i.exec((location.search || '') + (location.hash || ''));
  const tradeHeading = composerTitle();
  return {
    ok: true,
    tradeHeading, tradeHandle: composerHandleElement(tradeHeading), partnerId: composerPartnerId(tradeHeading),
    tradeId: m ? m[1] : '',
    handle: partnerHandle(),
    sides: groups.map(sideOnPage)
  };
}

/** La meme lecture, debarrassee des elements du DOM : transmissible en message. */
function plain(page) {
  return {
    tradeId: page.tradeId,
    handle: page.handle,
    partnerId: page.partnerId || 0,
    composer: !!page.composer,
    sides: page.sides.map(s => ({
      items: s.items.map(i => ({ assetId: i.assetId, bundleId: i.bundleId, name: i.name, names: i.names, rap: i.rap })),
      role: s.role, rapTotal: s.rapTotal, robux: s.robux, robuxNet: s.robuxNet,
      userIds: s.userIds,
      robuxText: s.robuxText
    }))
  };
}

/** Signature de ce qui est a l'ecran : evite de reevaluer un trade inchange. */
function signatureOf(page) {
  if (!page?.ok) return 'x:' + (page?.reason || '');
  return (page.composer ? 'new|' : '') + page.tradeId + '|' + page.sides.map(s =>
    s.items.map(i => (i.bundleId ? 'b' : 'a') + (i.bundleId || i.assetId || i.name) + ':' + i.rap + ':' +
      [...(i.card?.querySelectorAll?.('*') || [])].filter(el => !el.childElementCount && /^#\s*\d+$/.test((el.textContent || '').trim())).map(el => el.textContent.trim()).join('.')).join(',')
    + '/' + s.role + '/' + s.rapTotal + '/' + s.robux + '/' + s.robuxNet
    + '/' + (s.robuxText || '') + '/' + s.userIds.join('.')
  ).join('||');
}

/* Le monde isole des scripts de contenu : c'est notre seul point de rendez-vous. */
globalThis.RoNoteDom = {
  ITEM_LINK, USER_LINK,
  idOf, nameOf, groupLinks, partnerHandle, readTradePage, plain, signatureOf, visibleAnalysis, phaseOf,
  inventoryItems
};
})();
