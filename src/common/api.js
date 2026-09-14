/**
 * ==========================================================================
 *  L'ACCES AUX API ROBLOX
 * --------------------------------------------------------------------------
 *  Transport uniquement : recuperer, normaliser, ne rien interpreter. Les
 *  cotes sont dans roli.js, les vignettes dans thumbs.js, l'analyse dans
 *  analysis.js.
 * ==========================================================================
 */
import { B } from './shim.js';
import { chunk, eachLimit, fetchWithTimeout, sleep } from './utils.js';

const TRADES    = 'https://trades.roblox.com/v1';
const TRADES_V2 = 'https://trades.roblox.com/v2';
const USERS     = 'https://users.roblox.com/v1';
const THUMBS    = 'https://thumbnails.roblox.com/v1';
const ECONOMY   = 'https://economy.roblox.com/v1';
const CATALOG   = 'https://catalog.roblox.com/v1';
const ROLIMONS  = 'https://api.rolimons.com/players/v1';

/** Plafonds imposes par Roblox : les depasser fait echouer TOUT le lot. */
export const ASSET_THUMB_BATCH  = 100;
export const BUNDLE_THUMB_BATCH = 30;

/**
 * Attente maximale tenue sur place apres un 429. Au-dela, l'erreur remonte
 * avec son `retry-after` : c'est au backoff du service worker de l'absorber.
 */
const RETRY_AFTER_MAX = 10000;

/** Vignettes reprises une par une : jamais plus de 4 a la fois. */
const SOLO_THUMB_PARALLEL = 4;

/** Onglets ou rejouer une requete : ceux du site, la ou la session est ouverte. */
const ROBLOX_TABS = 'https://www.roblox.com/*';

/* ====================== garde-fou de debit, par hote ===================== */

/**
 * Roblox compte les requetes par adresse IP, tous ses sous-domaines confondus.
 * Or la verification de fond, le popup qui defile et une fiche joueur ouverte
 * respectaient chacun « sa » limite, sans rien savoir des autres : leurs
 * salves s'additionnaient, et la limite tombait sur celui qui passait la.
 *
 * Tout ce qui sort passe donc par une seule porte, une par hote. Et un 429
 * vaut pour l'hote entier : la porte se ferme pour tout le monde le temps
 * demande, au lieu de laisser chaque appel suivant aller le chercher.
 */
const MAX_INFLIGHT = { 'roblox.com': 5, "rolimons.com": 3 };

/**
 * Plafond de cadence, en requetes par minute et par hote.
 *
 * Limiter les appels EN VOL ne limite pas leur nombre dans le temps : cinq a
 * la fois, sans arret, reste une cadence soutenue — et c'est la cadence que
 * Roblox compte. Ni Roblox ni Rolimon's ne publient leurs quotas : on part
 * large, et on apprend. Chaque 429 divise le plafond par deux, jusqu'a un
 * plancher ; apres dix minutes sans refus, il remonte d'un cran.
 */
const RATE = {
  'roblox.com':   { start: 90, min: 15 },
  "rolimons.com": { start: 30, min: 6 }
};
const RATE_RECOVER = 10 * 60 * 1000;

const gates = new Map();

function gateFor(url) {
  let host = 'roblox.com';
  try { host = new URL(url).hostname.endsWith('rolimons.com') ? 'rolimons.com' : 'roblox.com'; } catch { /* url relative : Roblox */ }
  let g = gates.get(host);
  if (!g) {
    g = {
      host, label: host === 'rolimons.com' ? "Rolimon's" : 'Roblox',
      free: MAX_INFLIGHT[host], queue: [], holdUntil: 0,
      rate: RATE[host].start, tokens: RATE[host].start, filledAt: Date.now(), lastRateHit: 0
    };
    gates.set(host, g);
  }
  return g;
}

/** Remet des jetons dans le seau, au prorata du temps ecoule. */
function refill(g) {
  const now = Date.now();
  g.tokens = Math.min(g.rate, g.tokens + ((now - g.filledAt) / 60000) * g.rate);
  g.filledAt = now;
  if (g.lastRateHit && now - g.lastRateHit > RATE_RECOVER) {
    g.rate = Math.min(RATE[g.host].start, Math.ceil(g.rate * 1.5));
    g.lastRateHit = now;
  }
}

/** Attend son tour dans la cadence. L'attente se compte en secondes, jamais plus. */
async function takeToken(g) {
  for (;;) {
    refill(g);
    if (g.tokens >= 1) { g.tokens -= 1; return; }
    await sleep(Math.max(50, Math.ceil((1 - g.tokens) * (60000 / g.rate))));
  }
}

const take = (g) => (g.free > 0 ? (g.free--, Promise.resolve()) : new Promise(go => g.queue.push(go)));
const give = (g) => { const next = g.queue.shift(); if (next) next(); else g.free++; };

/**
 * Un 429 ferme la porte de son hote : les autres appels n'ont pas a le revivre.
 * Et il apprend quelque chose — le plafond de cadence etait trop haut pour ce
 * compte, a cette heure : on le divise par deux.
 */
function holdBack(url, seconds) {
  const g = gateFor(url);
  g.holdUntil = Math.max(g.holdUntil, Date.now() + Math.max(1, seconds) * 1000);
  g.rate = Math.max(RATE[g.host].min, Math.floor(g.rate / 2));
  g.tokens = Math.min(g.tokens, g.rate);
  g.lastRateHit = Date.now();
}

/** Le plafond de cadence appris pour chaque hote, en requetes par minute. */
export function rateLimits() {
  const out = {};
  for (const g of gates.values()) out[g.host] = g.rate;
  return out;
}

/** Ce qui reste d'une pause de debit, par hote. Diagnostic et auto-tests. */
export function rateHolds() {
  const out = {};
  for (const g of gates.values()) out[g.host] = Math.max(0, g.holdUntil - Date.now());
  return out;
}

/** Rouvre les portes. Les auto-tests s'en servent ; ailleurs, les pauses expirent seules. */
export function clearRateHolds() {
  for (const g of gates.values()) {
    g.holdUntil = 0;
    g.rate = RATE[g.host].start;
    g.tokens = g.rate;
    g.lastRateHit = 0;
  }
}

/**
 * Passe la porte, puis lance la requete. Une pause courte s'attend sur place ;
 * une longue est refusee tout de suite, avec son delai — garder cent appels en
 * file reviendrait a les relacher tous ensemble a la reouverture, et la limite
 * repartirait pour un tour.
 */
async function through(url, run) {
  const g = gateFor(url);
  if (g.holdUntil - Date.now() > RETRY_AFTER_MAX) {
    throw new ApiError('HTTP 429', 429, Math.ceil((g.holdUntil - Date.now()) / 1000), g.label);
  }
  await take(g);
  try {
    const wait = g.holdUntil - Date.now();
    if (wait > 0) await sleep(Math.min(wait, RETRY_AFTER_MAX));
    await takeToken(g);
    return await run();
  } finally {
    give(g);
  }
}

let csrfToken = '';

/** Jeton preleve sur une page Roblox ouverte (aucune requete supplementaire). */
export function setCsrfToken(t) {
  if (t && t !== csrfToken) csrfToken = String(t);
}
export const hasCsrfToken = () => !!csrfToken;

export class ApiError extends Error {
  constructor(message, status, retryAfter, source = 'Roblox') {
    super(message);
    this.name = 'ApiError';
    this.status = status ?? 0;
    this.retryAfter = retryAfter ?? 0;
    // Qui a refuse : « Roblox » ou « Rolimon's ». Leurs quotas sont distincts,
    // et un message qui accuse le mauvais service envoie chercher au mauvais
    // endroit.
    this.source = source;
  }
  get isAuth() { return this.status === 401 || this.status === 403; }
  get isRate() { return this.status === 429; }
}

/**
 * Repli : si le fetch depuis le service worker n'emporte pas le cookie
 * .ROBLOSECURITY (politiques cookies, conteneurs Firefox...), on relaie la
 * requete depuis un onglet roblox.com deja ouvert, ou l'appel est first-party.
 *
 * `func` s'execute DANS l'onglet et ne voit rien de ce fichier. Un onglet qui
 * repond sans succes passe la main au suivant, sauf avec `firstAnswer` : pour
 * une ecriture, Roblox donnerait la meme reponse depuis n'importe quel onglet.
 */
async function relayInTabs(url, func, { firstAnswer = false } = {}) {
  if (!B.tabs?.query || !B.scripting?.executeScript) return { note: 'relais indisponible' };
  let tabs = [];
  try { tabs = await B.tabs.query({ url: ROBLOX_TABS }); } catch { return { note: 'relais refusé' }; }
  if (!tabs.length) return { note: 'aucun onglet roblox.com ouvert pour le relais' };
  for (const tab of tabs) {
    if (!tab.id || tab.discarded) continue;
    try {
      const [inj] = await B.scripting.executeScript({ target: { tabId: tab.id }, args: [url], func });
      if (inj?.result?.ok) return inj.result;
      if (firstAnswer && inj?.result) return { ...inj.result, note: `HTTP ${inj.result.status}` };
    } catch { /* onglet inaccessible, on essaie le suivant */ }
  }
  return { note: 'relais tenté sans succès' };
}

function relayFetch(url) {
  return relayInTabs(url, async (u) => {
    try {
      const r = await fetch(u, { credentials: 'include', headers: { Accept: 'application/json' } });
      return { ok: r.ok, status: r.status, body: await r.text() };
    } catch (e) {
      return { ok: false, status: 0, body: String(e) };
    }
  });
}

async function apiGet(url, { allowRelay = true, retryOn429 = true, retryOnCsrf = true, relayAnyError = false } = {}) {
  let res = null, netErr = null;
  const headers = { Accept: 'application/json' };
  // Roblox rejette certains appels sans jeton, meme en GET.
  if (csrfToken) headers['x-csrf-token'] = csrfToken;
  try {
    res = await through(url, () => fetchWithTimeout(url, { credentials: 'include', headers }));
  } catch (e) {
    // La porte refuse tout de suite pendant une longue pause : c'est deja
    // l'erreur finale, inutile de la rehabiller.
    if (e instanceof ApiError) throw e;
    netErr = e;
  }

  // Roblox renvoie un jeton frais dans l'en-tete quand le notre est perime.
  const fresh = res?.headers?.get?.('x-csrf-token');
  if (fresh && fresh !== csrfToken) {
    csrfToken = fresh;
    // Un jeton perime explique a lui seul le refus : on rejoue une seule fois.
    if (!res.ok && retryOnCsrf) {
      return apiGet(url, { allowRelay, relayAnyError, retryOn429, retryOnCsrf: false });
    }
  }

  if (res?.ok) return res.json();

  // Roblox limite le debit par salves courtes. Une seule attente suffit
  // presque toujours, et evite de perdre un trade pour un 429 passager.
  //
  // Quand Roblox annonce une pause plus longue que RETRY_AFTER_MAX, la tenir
  // ici garderait le cycle de verification ouvert pour rien : on rend la main
  // avec le delai demande, et le service worker pose son backoff dessus.
  if (res?.status === 429) {
    const asked = Number(res.headers?.get('retry-after')) || 0;
    const wait = (asked || 1.5) * 1000;
    holdBack(url, asked || 5);
    if (retryOn429 && wait <= RETRY_AFTER_MAX) {
      await sleep(wait);
      return apiGet(url, { allowRelay, relayAnyError, retryOnCsrf, retryOn429: false });
    }
  }

  const status = res?.status ?? 0;
  // `relayAnyError` : pour les appels critiques, on tente le relais quelle que
  // soit l'erreur. Rejouee depuis un onglet roblox.com, la requete est
  // first-party et passe la ou celle du service worker echoue. Jamais sur une
  // limite de debit : rejouer depuis chaque onglet ouvert la prolongerait.
  let relayNote = '';
  if (allowRelay && status !== 429 && (relayAnyError || status === 0 || status === 401 || status === 403)) {
    const relayed = await relayFetch(url);
    if (relayed?.body) {
      try { return JSON.parse(relayed.body); } catch { /* corps illisible */ }
    }
    relayNote = relayed?.note || '';
  }
  const retryAfter = Number(res?.headers?.get('retry-after') || 0);
  const base = netErr ? `Réseau: ${netErr.message}` : `HTTP ${status}`;
  throw new ApiError(relayNote ? `${base} — ${relayNote}` : base, status, retryAfter, gateFor(url).label);
}

/** Suit `nextPageCursor` jusqu'au bout (ou jusqu'au plafond de pages). */
async function allPages(baseUrl, { maxPages = 12, opts = {} } = {}) {
  const out = [];
  let cursor = '';
  for (let page = 0; page < maxPages; page++) {
    const url = cursor ? `${baseUrl}&cursor=${encodeURIComponent(cursor)}` : baseUrl;
    const j = await apiGet(url, opts);
    for (const d of j?.data || []) out.push(d);
    cursor = j?.nextPageCursor || '';
    if (!cursor) break;
  }
  return out;
}

/* ============================== identite ================================ */

export function getAuthenticatedUser() {
  return apiGet(`${USERS}/users/authenticated`);
}

export function getInboundCount() {
  return apiGet(`${TRADES}/trades/inbound/count`).then(r => r?.count ?? 0);
}

/** type: Inbound | Outbound | Completed | Inactive */
export function listTrades(type, limit = 25, cursor = '') {
  const q = new URLSearchParams({ limit: String(limit), sortOrder: 'Desc' });
  if (cursor) q.set('cursor', cursor);
  return apiGet(`${TRADES}/trades/${type}?${q}`);
}

/* ========================= detail d'un trade ============================ */

/**
 * Retrouve les deux offres d'un trade, quelle que soit la version d'API.
 *
 * v1 : `offers: [ {user, userAssets, robux}, … ]`
 * v2 : `participantAOffer` / `participantBOffer` — deux champs nommes, pas un
 *      tableau, et les objets sont dans `items`. C'est ce format que renvoient
 *      les trades contenant un bundle (donc tous ceux avec un visage).
 */
function findOffers(raw) {
  const direct = raw.offers || raw.tradeOffers || raw.offer || raw.tradeItems;
  if (Array.isArray(direct) && direct.length) return { offers: direct, host: raw };

  const a = raw.participantAOffer ?? raw.participantAOffers ?? raw.offerA ?? raw.senderOffer;
  const b = raw.participantBOffer ?? raw.participantBOffers ?? raw.offerB ?? raw.recipientOffer;
  if (a || b) return { offers: [a, b].filter(Boolean), host: raw };

  for (const key of ['data', 'trade', 'result', 'tradeDetail', 'details']) {
    const inner = raw[key];
    if (inner && typeof inner === 'object') {
      const found = findOffers(inner);
      if (found.offers.length) return found;
    }
  }
  return { offers: [], host: raw };
}

/** L'identite du participant, quel que soit l'emboitement des champs. */
function normalizeUser(o) {
  const u = o.user || o.participant || {};
  return {
    id: Number(u.id ?? u.userId ?? o.userId ?? o.participantId) || 0,
    name: u.name ?? u.username ?? o.username ?? '',
    displayName: u.displayName ?? o.displayName ?? u.name ?? u.username ?? o.username ?? ''
  };
}

/**
 * Un objet d'une offre, quelle que soit la version d'API.
 *
 * C'EST ICI QUE TOUT SE JOUE. Le schema officiel de la v2 :
 *
 *   { collectibleItemInstanceId: "…",
 *     itemTarget: { itemType: "Asset" | "Bundle" | "Unknown", targetId: "160001924154932" },
 *     itemName, serialNumber, originalPrice, recentAveragePrice, assetStock, isOnHold }
 *
 * L'identifiant de l'objet n'est PAS a la racine : il est dans `itemTarget`,
 * et son type y est annonce explicitement. Chercher `assetId` / `bundleId` /
 * `id` a la racine (ce que faisait la version precedente) ne trouvait rien :
 * tous les objets d'un trade contenant un visage ressortaient avec un
 * identifiant nul — donc sans cote et sans vignette, pour le trade ENTIER.
 *
 * Attention aussi a `id` : en v1 c'est le `userAssetId`, l'identifiant de
 * l'EXEMPLAIRE, jamais celui de l'objet. Le prendre comme assetId produit des
 * vignettes cassees et des cotes fantaisistes ; il n'est donc jamais utilise
 * comme repli.
 */
function normalizeItem(it) {
  const target = it.itemTarget || it.target || null;
  const type = String(target?.itemType ?? it.itemType ?? it.type ?? '').toLowerCase();
  const targetId = Number(target?.targetId ?? it.targetId) || 0;

  let assetId = Number(it.assetId ?? it.assetID) || 0;
  let bundleId = Number(it.bundleId ?? it.bundleID) || 0;

  const put = (id) => {
    if (!id) return;
    if (type === 'bundle') bundleId = bundleId || id;
    else if (type === 'asset') assetId = assetId || id;
    // `Unknown` : on ne tranche pas ici. Le resolveur d'objets (analysis.js)
    // essaiera la table des assets PUIS celle des bundles avec le meme id.
    else if (!assetId && !bundleId) assetId = id;
  };
  put(targetId);
  if (!assetId && !bundleId) put(Number(it.itemId) || 0);

  return {
    // Identifiant d'exemplaire : `userAssetId` en v1, GUID en v2.
    id: it.userAssetId ?? it.userAssetID ?? it.collectibleItemInstanceId ?? it.id ?? null,
    assetId,
    bundleId,
    typeHint: type || '',
    name: it.name ?? it.itemName ?? it.assetName ?? '',
    recentAveragePrice: Number(it.recentAveragePrice ?? it.rap ?? 0) || 0,
    originalPrice: Number(it.originalPrice) || 0,
    stock: Number(it.assetStock) || 0,
    serialNumber: it.serialNumber ?? it.serial ?? it.collectibleSerialNumber ?? null,
    onHold: !!it.isOnHold
  };
}

/**
 * Normalise le detail d'un trade, v1 comme v2.
 * @param hint  ce que la liste des trades sait deja (date, expiration, statut,
 *              partenaire) — la v2 ne renvoie que `tradeId`, `status` et les
 *              deux offres, sans aucune date.
 */
export function normalizeTradeDetail(raw, hint = null) {
  if (!raw || typeof raw !== 'object') return raw;
  const { offers, host } = findOffers(raw);
  if (!offers.length) return raw;
  // On repart de l'enveloppe qui portait reellement les offres.
  const src = host === raw ? raw : { ...host, ...raw };

  const norm = offers.map(o => {
    const list = o.items || o.userAssets || o.assets || o.userAssetItems
      || o.offerItems || o.collectibles || [];
    return {
      ...o,
      user: normalizeUser(o),
      userAssets: (Array.isArray(list) ? list : []).map(normalizeItem),
      robux: Number(o.robux ?? o.robuxAmount ?? o.robuxOffered ?? 0) || 0
    };
  });

  return {
    ...src,
    id: Number(src.id ?? src.tradeId ?? hint?.tradeId ?? 0) || 0,
    created: src.created ?? src.createdAt ?? src.creationDate ?? hint?.created ?? null,
    expiration: src.expiration ?? src.expiresAt ?? src.expirationDate ?? hint?.expiration ?? null,
    status: src.status ?? src.tradeStatus ?? hint?.status ?? 'Unknown',
    user: src.user ?? hint?.partner ?? null,
    offers: norm
  };
}

const itemCount = (d) => (d?.offers || []).reduce((s, o) => s + (o.userAssets?.length || 0), 0);
const robuxTotal = (d) => (d?.offers || []).reduce((s, o) => s + (o.robux || 0), 0);

/**
 * Detail d'un trade. C'est l'appel le plus critique : sans lui, aucune carte.
 *
 * v1 d'abord : son format porte la date, l'expiration et le partenaire en une
 * seule requete, et il couvre l'immense majorite des trades. Il ne sait
 * cependant pas representer un bundle et refuse (403) les trades qui en
 * contiennent — on bascule alors sur v2, qui les gere.
 *
 * On bascule AUSSI quand v1 repond mais rend un trade vide : un trade sans le
 * moindre objet ni Robux n'existe pas, c'est le signe que v1 a silencieusement
 * laisse tomber ce qu'il ne sait pas decrire.
 *
 * Les deux versions en direct d'abord, le relais par un onglet ensuite. Un
 * relais injecte un script dans chaque onglet Roblox ouvert : relayer le refus
 * de v1 avant meme d'essayer v2 coutait ces injections pour chaque trade a
 * bundle. Seule une version qui a echoue en direct est relayee — un v1 qui
 * repond vide repondrait vide depuis l'onglet aussi.
 */
export async function getTrade(id, hint = null) {
  let v1Result = null;
  const errors = new Map();   // version -> erreur de l'appel direct

  const accept = (base, raw) => {
    const d = normalizeTradeDetail(raw, hint);
    if (itemCount(d) || robuxTotal(d)) return d;
    if (base === TRADES) v1Result = v1Result || d;
    return null;
  };

  for (const base of [TRADES, TRADES_V2]) {
    try {
      const d = accept(base, await apiGet(`${base}/trades/${id}`, { allowRelay: false }));
      if (d) return d;
    } catch (e) {
      if (e?.isRate) throw e;   // limite atteinte : insister la prolongerait
      errors.set(base, e);
    }
  }

  // v1 refuse par construction les trades a bundle : v2 passe alors en premier.
  const order = errors.get(TRADES)?.status === 403 ? [TRADES_V2, TRADES] : [TRADES, TRADES_V2];
  let relayNote = '';
  for (const base of order) {
    if (!errors.has(base)) continue;
    const relayed = await relayFetch(`${base}/trades/${id}`);
    if (!relayed?.body) { relayNote = relayed?.note || relayNote; continue; }
    try {
      const d = accept(base, JSON.parse(relayed.body));
      if (d) return d;
    } catch { /* corps illisible */ }
  }

  if (v1Result) return v1Result;     // v2 muet : on rend ce que v1 a donne
  const first = errors.get(TRADES) || errors.get(TRADES_V2);
  throw relayNote ? new ApiError(`${first.message} — ${relayNote}`, first.status, first.retryAfter) : first;
}

/**
 * Teste toute la chaine de recuperation d'un trade et renvoie un rapport brut.
 * Sert a diagnostiquer un trade qui refuse de s'evaluer sans avoir a deviner.
 */
export async function probeTradeDetail(id) {
  const report = [];
  const clean = String(id).replace(/[^0-9]/g, '');
  if (!clean) return [{ etape: 'entrée', erreur: 'identifiant de trade invalide' }];

  for (const [label, base] of [['v1', TRADES], ['v2', TRADES_V2]]) {
    const url = `${base}/trades/${clean}`;
    try {
      const r = await fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } });
      const body = await r.text();
      const line = { etape: `${label} direct`, statut: r.status, extrait: body.slice(0, 260) };
      if (r.ok) {
        try {
          const j = JSON.parse(body);
          line.cles = Object.keys(j).join(', ');
          const n = normalizeTradeDetail(j);
          line.clesOffre = Object.keys(n?.offers?.[0] || {}).join(', ') || '(aucune offre)';
          line.objetsReconnus = itemCount(n);
          const first = n?.offers?.[0]?.userAssets?.[0];
          if (first) line.premierObjet = `assetId=${first.assetId} bundleId=${first.bundleId} « ${first.name} »`;
        } catch { line.cles = '(JSON illisible)'; }
      }
      report.push(line);
    } catch (e) {
      report.push({ etape: `${label} direct`, erreur: String(e?.message || e) });
    }
  }

  for (const [label, base] of [['v1', TRADES], ['v2', TRADES_V2]]) {
    const relayed = await relayFetch(`${base}/trades/${clean}`);
    report.push(relayed?.body
      ? { etape: `${label} via onglet`, statut: relayed.status, extrait: relayed.body.slice(0, 260) }
      : { etape: `${label} via onglet`, note: relayed?.note || 'indisponible' });
  }
  return report;
}

/* ========================= agir sur un trade ============================ */

/**
 * Rejoue une requete depuis un onglet roblox.com ouvert. La page y est
 * first-party : elle a le cookie, le bon `Origin`, et peut aller chercher elle
 * meme un jeton CSRF frais. C'est le chemin le plus fiable pour une ECRITURE.
 */
function relayPost(url) {
  return relayInTabs(url, async (u) => {
    const send = (token) => fetch(u, {
      method: 'POST',
      credentials: 'include',
      headers: token
        ? { 'Content-Type': 'application/json', 'x-csrf-token': token }
        : { 'Content-Type': 'application/json' },
      body: '{}'
    });
    try {
      // Roblox refuse le premier envoi et joint un jeton frais : c'est
      // le protocole normal, pas une erreur.
      let r = await send('');
      if (r.status === 403) {
        const token = r.headers.get('x-csrf-token');
        if (token) r = await send(token);
      }
      return { ok: r.ok, status: r.status, body: await r.text() };
    } catch (e) {
      return { ok: false, status: 0, body: String(e) };
    }
  }, { firstAnswer: true });
}

async function apiPost(url) {
  const send = async () => {
    const headers = { 'Content-Type': 'application/json' };
    if (csrfToken) headers['x-csrf-token'] = csrfToken;
    return fetchWithTimeout(url, { method: 'POST', credentials: 'include', headers, body: '{}' });
  };

  let res = null, netErr = null;
  try { res = await send(); } catch (e) { netErr = e; }

  // Jeton perime ou absent : Roblox en renvoie un frais dans l'en-tete du refus.
  const fresh = res?.headers?.get?.('x-csrf-token');
  if (fresh && fresh !== csrfToken) {
    csrfToken = fresh;
    if (!res.ok) { try { res = await send(); } catch (e) { netErr = e; } }
  }
  if (res?.ok) return { ok: true, via: 'direct' };

  // Le service worker n'a pas toujours le cookie ni le bon Origin. Depuis un
  // onglet Roblox, la requete est indistinguable de celle du site.
  const relayed = await relayPost(url);
  if (relayed?.ok) return { ok: true, via: 'onglet' };

  let reason = netErr ? `Réseau: ${netErr.message}` : `HTTP ${res?.status ?? 0}`;
  // Roblox explique souvent le refus dans le corps : « Trade is not active »…
  try {
    const body = JSON.parse(relayed?.body || (res ? await res.clone().text() : '') || '{}');
    const msg = body?.errors?.[0]?.message;
    if (msg) reason = msg;
  } catch { /* corps illisible : on garde le statut */ }
  throw new ApiError(reason, res?.status ?? 0);
}

/**
 * Refuse un trade. Le MEME endpoint annule un trade qu'on a envoye : Roblox
 * n'expose pas de « cancel », le site appelle `decline` dans les deux sens.
 * Irreversible cote Roblox — la confirmation se fait dans l'interface.
 */
export function declineTrade(tradeId) {
  const id = String(tradeId).replace(/[^0-9]/g, '');
  if (!id) throw new ApiError('identifiant de trade invalide', 0);
  return apiPost(`${TRADES}/trades/${id}/decline`);
}

/* ------------------ petites recherches mises en cache ------------------- */

const LOOKUP_PARALLEL = 4;             // appels simultanes, par recherche
const LOOKUP_RETRY = 30 * 60 * 1000;   // une erreur passagere se retente apres

/**
 * Une reponse par identifiant, gardee en stockage : le RAP de secours d'un
 * objet, le bundle d'un asset. Les deux ont la meme mecanique.
 *
 * Seule une vraie reponse de Roblox (vide, 400, 404) dit « rien ici » : elle
 * est gardee le temps du cache. Une autre erreur n'apprend rien et se retente
 * apres 30 min — la garder aussi longtemps laissait des objets sans cote
 * pendant des jours, un mois pour les bundles. Une limite de debit arrete la
 * recherche sans rien memoriser.
 *
 * @param field  champ stocke ({[field]: valeur, at}), celui des versions precedentes
 */
function cachedLookup({ key, field, ttl, cap, perCall, fetchOne }) {
  let cache = null;
  let loading = null;
  return async function lookup(ids) {
    if (!cache) {
      loading = loading || B.storage.local.get(key).then(got => got?.[key] || {});
      cache = await loading;
    }
    const out = {};
    const now = Date.now();
    const todo = [];
    for (const id of new Set((ids || []).map(Number).filter(Boolean))) {
      const hit = cache[String(id)];
      if (hit && now - hit.at < ttl) {
        if (hit[field] > 0) out[String(id)] = hit[field];
      } else if (todo.length < perCall) {
        todo.push(id);
      }
    }
    if (!todo.length) return out;

    let changed = false;
    let limited = false;
    await eachLimit(todo, LOOKUP_PARALLEL, async (id) => {
      if (limited) return;
      let value = 0;
      let at = now;
      try {
        value = await fetchOne(id);
      } catch (e) {
        if (e?.status === 429) { limited = true; return; }
        if (e?.status !== 400 && e?.status !== 404) at = now - ttl + LOOKUP_RETRY;
      }
      cache[String(id)] = { [field]: value, at };
      changed = true;
      if (value > 0) out[String(id)] = value;
    });
    if (!changed) return out;

    const entries = Object.entries(cache);
    if (entries.length > cap) {
      cache = Object.fromEntries(entries.sort((a, b) => b[1].at - a[1].at).slice(0, cap));
    }
    await B.storage.local.set({ [key]: cache });
    return out;
  };
}

/**
 * RAP officiel d'un objet, via l'API economy. Filet de securite quand ni la
 * reponse du trade ni Rolimon's ne donnent de chiffre : c'est le cas des
 * nouveautes et de certains UGC limiteds.
 * @returns { [assetId]: rap }  (seulement les RAP > 0)
 */
export const getResaleRaps = cachedLookup({
  key: 'resale', field: 'rap',
  ttl: 12 * 60 * 60 * 1000, cap: 800, perCall: 24,
  fetchOne: async (id) => {
    const j = await apiGet(`${ECONOMY}/assets/${id}/resale-data`, { allowRelay: false, retryOn429: false });
    return Number(j?.recentAveragePrice) || 0;
  }
});

/**
 * assetId -> bundleId, via le catalogue.
 *
 * Sert quand un trade designe un objet par un asset qui n'est que le CONTENU
 * d'un bundle (la tete d'un visage DynamicHead, par exemple) : la cote et la
 * vignette qui comptent sont celles du bundle. Un asset ne change pas de
 * bundle : la reponse se garde 30 jours.
 */
export const resolveBundleIds = cachedLookup({
  key: 'bundleOf', field: 'b',
  ttl: 30 * 24 * 60 * 60 * 1000, cap: 1200, perCall: 24,
  fetchOne: async (id) => {
    const j = await apiGet(`${CATALOG}/assets/${id}/bundles?limit=10`, { allowRelay: false, retryOn429: false });
    return Number(j?.data?.[0]?.id) || 0;
  }
});

/* --------------------------- vignettes brutes --------------------------- */

/**
 * Une reponse de vignette n'est valide que si Roblox a REELLEMENT rendu
 * l'image. Un identifiant inconnu ne provoque pas d'erreur HTTP : il revient
 * avec `state: "Error"` et l'URL d'un carre casse, qui s'afficherait comme une
 * vignette normale si on ne la filtrait pas.
 */
function readThumbs(json, into) {
  let n = 0;
  for (const d of json?.data ?? []) {
    if (d?.state !== 'Completed') continue;
    const url = d.imageUrl;
    if (!url || url.includes('/BrokenImage/')) continue;
    into[String(d.targetId)] = url;
    n++;
  }
  return n;
}

/**
 * Vignettes par lots. Un lot refuse en bloc ne doit pas emporter les autres :
 * on retente objet par objet plutot que de rendre le trade entier sans image.
 */
async function fetchThumbBatches(ids, batch, urlOf) {
  const out = {};
  for (const part of chunk([...new Set(ids.map(Number).filter(Boolean))], batch)) {
    try {
      readThumbs(await apiGet(urlOf(part), { allowRelay: false, retryOn429: false }), out);
    } catch (e) {
      // Une limite de debit vaut pour tout l'hote : reprendre le lot objet par
      // objet multiplierait les appels par sa taille — jusqu'a cent d'un coup —
      // et prolongerait la limite au lieu de la passer. On s'arrete la ; les
      // vignettes manquantes reviennent au prochain passage, le trade reste lu.
      if (e?.status === 429) break;
      if (part.length > 1) {
        await eachLimit(part, SOLO_THUMB_PARALLEL, async (id) => {
          try {
            readThumbs(await apiGet(urlOf([id]), { allowRelay: false, retryOn429: false }), out);
          } catch { /* vignette absente : le reste du lot passe quand meme */ }
        });
      }
    }
  }
  return out;
}

/** @returns { [assetId]: url } — les identifiants non rendus sont absents. */
export function fetchAssetThumbs(assetIds, size = '150x150') {
  return fetchThumbBatches(assetIds, ASSET_THUMB_BATCH, (part) =>
    `${THUMBS}/assets?${new URLSearchParams({ assetIds: part.join(','), size, format: 'Png', isCircular: 'false' })}`);
}

/** @returns { [bundleId]: url } — lots de 30 maximum, plafond impose par Roblox. */
export function fetchBundleThumbs(bundleIds, size = '150x150') {
  return fetchThumbBatches(bundleIds, BUNDLE_THUMB_BATCH, (part) =>
    `${THUMBS}/bundles/thumbnails?${new URLSearchParams({ bundleIds: part.join(','), size, format: 'Png' })}`);
}

const headshots = new Map();

export async function getUserHeadshot(userId) {
  const key = String(userId);
  if (headshots.has(key)) return headshots.get(key);
  try {
    const q = new URLSearchParams({ userIds: key, size: '150x150', format: 'Png', isCircular: 'false' });
    const j = await apiGet(`${THUMBS}/users/avatar-headshot?${q}`, { allowRelay: false });
    const out = {};
    readThumbs(j, out);
    const url = out[key] || null;
    if (url) headshots.set(key, url);
    return url;
  } catch { return null; }
}

/**
 * Profil public d'un joueur, pour sa fiche : la date de creation du compte
 * est le premier indice d'un compte jetable. Aucune session necessaire.
 */
export async function getUserProfile(userId) {
  const id = Number(userId);
  if (!id) throw new ApiError('identifiant de joueur invalide', 0);
  const j = await apiGet(`${USERS}/users/${id}`, { allowRelay: false });
  return {
    id,
    name: j?.name || '',
    displayName: j?.displayName || '',
    created: (j?.created && Date.parse(j.created)) || 0,
    banned: !!j?.isBanned,
    verified: !!j?.hasVerifiedBadge
  };
}

/* ============================= inventaire =============================== */

/**
 * Les bundles possedes. Depuis la conversion des visages en DynamicHead,
 * c'est la SEULE source qui dise ce que le joueur possede reellement en
 * visages : ni l'inventaire des collectibles ni Rolimon's ne les voient.
 */
export async function getUserBundles(userId, maxPages = 8) {
  const all = await allPages(`${CATALOG}/users/${userId}/bundles?limit=100`, { maxPages });
  return all.filter(b => b && Number(b.id));
}

/* ============================== Rolimon's =============================== */

async function rolimons(url, what, retryOn429 = true) {
  const r = await through(url, () => fetchWithTimeout(url, { headers: { Accept: 'application/json' } }));
  if (!r.ok) {
    // Meme regle que pour Roblox : une courte attente si Rolimon's la demande,
    // sinon l'erreur remonte avec son delai et le backoff du worker s'en charge.
    const asked = Number(r.headers?.get('retry-after')) || 0;
    if (r.status === 429) {
      holdBack(url, asked || 5);
      if (retryOn429 && (asked || 1.5) * 1000 <= RETRY_AFTER_MAX) {
        await sleep((asked || 1.5) * 1000);
        return rolimons(url, what, false);
      }
    }
    throw new ApiError('HTTP ' + r.status, r.status, asked, "Rolimon's");
  }
  const j = await r.json();
  if (!j?.success) throw new ApiError(`${what} indisponible chez Rolimon's`, 0, 0, "Rolimon's");
  return j;
}

/** Valeur et RAP du compte, tels que Rolimon's les publie sur le profil. */
export async function getPlayerInfo(userId) {
  const j = await rolimons(`${ROLIMONS}/playerinfo/${userId}`, 'profil');
  return {
    at: Date.now(),
    name: j.name || '',
    value: Number(j.value) || 0,
    rap: Number(j.rap) || 0,
    rank: Number(j.rank) || 0,
    scannedAt: Number(j.last_scan) ? Number(j.last_scan) * 1000 : 0,
    private: !!j.privacy_enabled,
    terminated: !!j.terminated,
    lastOnline: Number(j.last_online) ? Number(j.last_online) * 1000 : 0
  };
}

/**
 * Le detail de ce que Rolimon's COMPTE dans la valeur d'un joueur :
 *   { [assetId]: [userAssetId, …] }
 * Indispensable pour savoir ce qui manque a leur total et ce qui y traine
 * encore alors que le joueur ne l'a plus (voir portfolio.js).
 */
export async function getPlayerAssets(userId) {
  const j = await rolimons(`${ROLIMONS}/playerassets/${userId}`, 'inventaire');
  const raw = j.playerAssets || {};
  const counts = {};
  for (const [assetId, copies] of Object.entries(raw)) {
    counts[assetId] = Array.isArray(copies) ? copies.length : Number(copies) || 0;
  }
  return {
    counts,
    holds: Array.isArray(j.holds) ? j.holds : [],
    private: !!j.playerPrivacyEnabled,
    terminated: !!j.playerTerminated,
    scannedAt: Number(j.chartNominalScanTime) ? Number(j.chartNominalScanTime) * 1000 : 0
  };
}

/**
 * Historique complet du joueur, tel que Rolimon's l'affiche sur son profil.
 *
 * Il n'existe pas d'endpoint JSON pour cette serie : la page l'embarque dans
 * une variable `chart_data`. On lit donc la page et on extrait cette variable —
 * c'est la meme donnee, a la virgule pres, que le graphique du site.
 */
export async function getPlayerHistory(userId) {
  const url = `https://www.rolimons.com/player/${userId}`;
  const r = await through(url, () => fetchWithTimeout(url, { headers: { Accept: 'text/html' } }, 30000));
  if (!r.ok) {
    if (r.status === 429) holdBack(url, Number(r.headers?.get('retry-after')) || 5);
    throw new ApiError('HTTP ' + r.status, r.status, Number(r.headers?.get('retry-after')) || 0, "Rolimon's");
  }
  const html = await r.text();

  const m = /var\s+chart_data\s*=\s*(\{[^\n]*?\});/.exec(html);
  if (!m) throw new ApiError("historique introuvable dans la page Rolimon's", 0);

  let cd;
  try { cd = JSON.parse(m[1]); } catch { throw new ApiError('historique illisible', 0); }

  const t = cd.nominal_scan_time || [];
  const v = cd.value || [], rap = cd.rap || [], n = cd.num_limiteds || [];
  const points = [];
  for (let i = 0; i < t.length; i++) {
    const at = Number(t[i]) * 1000;
    if (!at) continue;
    points.push({ at, v: Number(v[i]) || 0, r: Number(rap[i]) || 0, n: Number(n[i]) || 0 });
  }
  points.sort((x, y) => x.at - y.at);
  return points;
}

/**
 * Seaux de l'historique d'un objet : plus un releve est ancien, plus il est
 * resume.  [age maximal, largeur d'un seau]
 */
const ITEM_BUCKETS = [
  [7 * 864e5, 2 * 3600e3],
  [90 * 864e5, 864e5],
  [365 * 864e5, 3 * 864e5],
  [Infinity, 14 * 864e5]
];

/**
 * Historique d'un objet, tel que sa page Rolimon's le trace.
 *
 * Pas d'endpoint JSON ici non plus : la page embarque `history_data` (RAP et
 * meilleur prix, un releve toutes les 30 min sur la periode recente) et
 * `value_changes`, chaque evenement de la fiche sous la forme
 * [date, type, avant, apres] — le type 1 est la value. La value a une date
 * donnee est donc la derniere revision anterieure.
 *
 * La page pese jusqu'a 1,7 Mo pour 11 000 releves : on ne garde que le dernier
 * releve de chaque seau, quelques centaines de points en tout.
 *
 * @returns {{ t: number[], v: number[], r: number[], p: number[], changes: Array<[number, number, number]> }}
 */
export function parseItemHistory(html, now = Date.now()) {
  const grab = (re) => {
    const m = re.exec(html);
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch { return null; }
  };
  const hist = grab(/var\s+history_data\s*=\s*(\{[^\n]*?\});/);
  if (!Array.isArray(hist?.timestamp) || !hist.timestamp.length) {
    throw new ApiError("historique de l'objet introuvable dans la page Rolimon's", 0);
  }
  const changes = (grab(/var\s+value_changes\s*=\s*(\[[^\n]*?\]);/) || [])
    .filter(c => Array.isArray(c) && c[1] === 1 && Number(c[3]) > 0)
    .map(c => ({ at: Number(c[0]) * 1000, from: Number(c[2]) || 0, to: Number(c[3]) }))
    .sort((a, b) => a.at - b.at);

  const out = { t: [], v: [], r: [], p: [], changes: [] };
  let next = 0;
  let value = changes[0]?.from || 0;
  let lastBucket = '';
  for (let i = 0; i < hist.timestamp.length; i++) {
    const at = Number(hist.timestamp[i]) * 1000;
    if (!at) continue;
    while (next < changes.length && changes[next].at <= at) value = changes[next++].to;
    const width = ITEM_BUCKETS.find(([maxAge]) => now - at < maxAge)[1];
    const bucket = width + ':' + Math.floor(at / width);
    if (bucket !== lastBucket) {
      out.t.push(0); out.v.push(0); out.r.push(0); out.p.push(0);
      lastBucket = bucket;
    }
    const n = out.t.length - 1;
    out.t[n] = at;
    out.v[n] = value;
    out.r[n] = Number(hist.rap?.[i]) || 0;
    out.p[n] = Number(hist.best_price?.[i]) || 0;
  }
  // Une revision posterieure au dernier releve fait deja la cote du moment.
  while (next < changes.length) value = changes[next++].to;
  if (out.v.length) out.v[out.v.length - 1] = value;
  out.changes = changes.filter(c => c.at >= out.t[0]).slice(-80).map(c => [c.at, c.from, c.to]);
  return out;
}

/** Historique d'un objet, lu sur sa page publique Rolimon's (voir parseItemHistory). */
export async function getItemHistory(itemId) {
  const id = Number(itemId);
  if (!id) throw new ApiError("identifiant d'objet invalide", 0);
  const url = `https://www.rolimons.com/item/${id}`;
  const r = await through(url, () => fetchWithTimeout(url, { headers: { Accept: 'text/html' } }, 30000));
  if (!r.ok) {
    if (r.status === 429) holdBack(url, Number(r.headers?.get('retry-after')) || 5);
    throw new ApiError('HTTP ' + r.status, r.status, Number(r.headers?.get('retry-after')) || 0, "Rolimon's");
  }
  return parseItemHistory(await r.text());
}

/* ================================ liens ================================= */

export const TRADE_URL  = (id) => `https://www.roblox.com/trades?tradeId=${id}`;
export const TAB_URL    = (tab) => `https://www.roblox.com/trades?tab=${tab}`;
export const ASSET_URL  = (id) => `https://www.roblox.com/catalog/${id}`;
export const BUNDLE_URL = (id) => `https://www.roblox.com/bundles/${id}`;
