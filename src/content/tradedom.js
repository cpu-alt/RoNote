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
 *  NI CLASSES CSS, NI LIBELLES, NI NOMBRES
 *
 *  Roblox renomme ses classes, traduit ses titres et abrege ses nombres. Les
 *  trois seules choses stables sur cette page sont :
 *
 *    - les LIENS des objets      /catalog/{id} et /bundles/{id}
 *    - les LIENS des profils     /users/{id}
 *    - la STRUCTURE              les objets d'une meme colonne partagent un
 *                                ancetre que l'autre colonne n'a pas.
 *
 *  Le decoupage en colonnes s'appuie d'abord sur le PROFIL : une offre cite
 *  toujours son proprietaire, donc chaque objet est rattache au plus proche
 *  ancetre qui cite un profil. Deux colonnes, deux proprietaires, aucune
 *  ambiguite — et si un inventaire est ouvert a cote, ses objets tombent sur
 *  un troisieme ancetre, ce qui fait renoncer au lieu de melanger l'inventaire
 *  avec l'offre.
 *
 *  Si la page ne cite aucun profil (mise en page degradee), on retombe sur la
 *  seule structure : le plus haut ancetre qui ne contient PAS tous les liens.
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
      if (node.querySelectorAll(ITEM_LINK).length >= links.length) break;
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
function readTradePage() {
  const links = [...document.querySelectorAll(ITEM_LINK)]
    .filter(a => idOf(a) && a.offsetParent !== null);
  if (!links.length) return { ok: false, reason: 'vide', tradeId: '', handle: '', sides: [] };

  const groups = groupLinks(links);
  if (groups.length !== 2) {
    return { ok: false, reason: 'colonnes:' + groups.length, tradeId: '', handle: '', sides: [] };
  }

  const m = /[?&]tradeId=(\d+)/.exec(location.search);
  return {
    ok: true,
    tradeId: m ? m[1] : '',
    handle: partnerHandle(),
    sides: groups.map(g => ({
      root: g.root,
      // La cote et la pastille se posent DANS le lien de l'objet : c'est le
      // seul element dont on soit sur qu'il n'appartienne qu'a cet objet-la.
      // Remonter a la « carte » parait plus joli, mais quand une colonne n'a
      // qu'un objet, sa carte et la grille entiere se ressemblent trop pour
      // etre distinguees — et la cote finit posee a cote de l'objet.
      items: g.links.map(a => ({ ...idOf(a), name: nameOf(a), link: a })),
      userIds: userIdsIn(g.root),
      robuxText: robuxTextIn(g.root)
    }))
  };
}

/** La meme lecture, debarrassee des elements du DOM : transmissible en message. */
function plain(page) {
  return {
    tradeId: page.tradeId,
    handle: page.handle,
    sides: page.sides.map(s => ({
      items: s.items.map(i => ({ assetId: i.assetId, bundleId: i.bundleId, name: i.name })),
      userIds: s.userIds,
      robuxText: s.robuxText
    }))
  };
}

/** Signature de ce qui est a l'ecran : evite de reevaluer un trade inchange. */
function signatureOf(page) {
  if (!page?.ok) return 'x:' + (page?.reason || '');
  return page.tradeId + '|' + page.sides.map(s =>
    s.items.map(i => (i.bundleId ? 'b' : 'a') + (i.bundleId || i.assetId)).join(',')
    + '/' + (s.robuxText || '') + '/' + s.userIds.join('.')
  ).join('||');
}

/* Le monde isole des scripts de contenu : c'est notre seul point de rendez-vous. */
globalThis.RoNoteDom = {
  ITEM_LINK, USER_LINK,
  idOf, nameOf, groupLinks, partnerHandle, readTradePage, plain, signatureOf
};
})();
