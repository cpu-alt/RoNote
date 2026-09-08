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
import { chunk, fetchWithTimeout } from './utils.js';

const TRADES    = 'https://trades.roblox.com/v1';
const TRADES_V2 = 'https://trades.roblox.com/v2';
const USERS     = 'https://users.roblox.com/v1';
const THUMBS    = 'https://thumbnails.roblox.com/v1';
const ECONOMY   = 'https://economy.roblox.com/v1';
const CATALOG   = 'https://catalog.roblox.com/v1';
const INVENTORY = 'https://inventory.roblox.com/v1';
const ROLIMONS  = 'https://api.rolimons.com/players/v1';

/** Plafonds imposes par Roblox : les depasser fait echouer TOUT le lot. */
export const ASSET_THUMB_BATCH  = 100;
export const BUNDLE_THUMB_BATCH = 30;

let csrfToken = '';

/** Jeton preleve sur une page Roblox ouverte (aucune requete supplementaire). */
export function setCsrfToken(t) {
  if (t && t !== csrfToken) csrfToken = String(t);
}
export const hasCsrfToken = () => !!csrfToken;

export class ApiError extends Error {
  constructor(message, status, retryAfter) {
    super(message);
    this.name = 'ApiError';
    this.status = status ?? 0;
    this.retryAfter = retryAfter ?? 0;
  }
  get isAuth() { return this.status === 401 || this.status === 403; }
  get isRate() { return this.status === 429; }
}

/**
 * Repli : si le fetch depuis le service worker n'emporte pas le cookie
 * .ROBLOSECURITY (politiques cookies, conteneurs Firefox...), on relaie la
 * requete depuis un onglet roblox.com deja ouvert, ou l'appel est first-party.
 */
async function relayFetch(url) {
  if (!B.tabs?.query || !B.scripting?.executeScript) return { note: 'relais indisponible' };
  let tabs = [];
  try { tabs = await B.tabs.query({ url: '*://*.roblox.com/*' }); } catch { return { note: 'relais refusé' }; }
  if (!tabs.length) return { note: 'aucun onglet roblox.com ouvert pour le relais' };
  for (const tab of tabs) {
    if (!tab.id || tab.discarded) continue;
    try {
      const [inj] = await B.scripting.executeScript({
        target: { tabId: tab.id },
        args: [url],
        func: async (u) => {
          try {
            const r = await fetch(u, { credentials: 'include', headers: { Accept: 'application/json' } });
            return { ok: r.ok, status: r.status, body: await r.text() };
          } catch (e) {
            return { ok: false, status: 0, body: String(e) };
          }
        }
      });
      if (inj?.result?.ok) return inj.result;
    } catch { /* onglet inaccessible, on essaie le suivant */ }
  }
  return { note: 'relais tenté sans succès' };
}

async function apiGet(url, { allowRelay = true, retryOn429 = true, retryOnCsrf = true, relayAnyError = false } = {}) {
  let res = null, netErr = null;
  const headers = { Accept: 'application/json' };
  // Roblox rejette certains appels sans jeton, meme en GET.
  if (csrfToken) headers['x-csrf-token'] = csrfToken;
  try {
    res = await fetchWithTimeout(url, { credentials: 'include', headers });
  } catch (e) { netErr = e; }

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
  if (res?.status === 429 && retryOn429) {
    const wait = Math.min(5000, (Number(res.headers?.get('retry-after')) || 1.5) * 1000);
    await new Promise(r => setTimeout(r, wait));
    return apiGet(url, { allowRelay, relayAnyError, retryOnCsrf, retryOn429: false });
  }

  const status = res?.status ?? 0;
  // `relayAnyError` : pour les appels critiques (detail d'un trade), on tente le
  // relais quelle que soit l'erreur. Rejouee depuis un onglet roblox.com, la
  // requete est first-party et passe la ou celle du service worker echoue.
  let relayNote = '';
  if (allowRelay && (relayAnyError || status === 0 || status === 401 || status === 403)) {
    const relayed = await relayFetch(url);
    if (relayed?.body) {
      try { return JSON.parse(relayed.body); } catch { /* corps illisible */ }
    }
    relayNote = relayed?.note || '';
  }
  const retryAfter = Number(res?.headers?.get('retry-after') || 0);
  const base = netErr ? `Réseau: ${netErr.message}` : `HTTP ${status}`;
  throw new ApiError(relayNote ? `${base} — ${relayNote}` : base, status, retryAfter);
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
 */
export async function getTrade(id, hint = null) {
  let firstErr = null;
  let v1Result = null;

  try {
    const d = normalizeTradeDetail(await apiGet(`${TRADES}/trades/${id}`, { relayAnyError: true }), hint);
    if (itemCount(d) || robuxTotal(d)) return d;
    v1Result = d;
  } catch (e) {
    firstErr = e;
  }

  try {
    return normalizeTradeDetail(await apiGet(`${TRADES_V2}/trades/${id}`, { relayAnyError: true }), hint);
  } catch (e) {
    if (v1Result) return v1Result;     // v2 muet : on rend ce que v1 a donne
    throw firstErr || e;
  }
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
async function relayPost(url) {
  if (!B.tabs?.query || !B.scripting?.executeScript) return { note: 'relais indisponible' };
  let tabs = [];
  try { tabs = await B.tabs.query({ url: '*://*.roblox.com/*' }); } catch { return { note: 'relais refusé' }; }
  if (!tabs.length) return { note: 'aucun onglet roblox.com ouvert' };

  for (const tab of tabs) {
    if (!tab.id || tab.discarded) continue;
    try {
      const [inj] = await B.scripting.executeScript({
        target: { tabId: tab.id },
        args: [url],
        func: async (u) => {
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
        }
      });
      if (inj?.result?.ok) return inj.result;
      if (inj?.result) return { ...inj.result, note: `HTTP ${inj.result.status}` };
    } catch { /* onglet inaccessible, on essaie le suivant */ }
  }
  return { note: 'relais tenté sans succès' };
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

/* ------------------------- cotes de secours ----------------------------- */

const RESALE_TTL = 12 * 60 * 60 * 1000;
const RESALE_CAP = 800;
const RESALE_MAX_PER_CALL = 24;
let resaleCache = null;

/**
 * RAP officiel d'un objet, via l'API economy. Filet de securite quand ni la
 * reponse du trade ni Rolimon's ne donnent de chiffre : c'est le cas des
 * nouveautes et de certains UGC limiteds.
 * Les echecs sont mis en cache aussi, pour ne pas rappeler l'API en boucle.
 * @returns { [assetId]: rap }  (seulement les RAP > 0)
 */
export async function getResaleRaps(assetIds) {
  if (!resaleCache) {
    const { resale } = await B.storage.local.get('resale');
    resaleCache = resale || {};
  }
  const out = {};
  const now = Date.now();
  const todo = [];

  for (const raw of new Set((assetIds || []).map(Number).filter(Boolean))) {
    const hit = resaleCache[String(raw)];
    if (hit && now - hit.at < RESALE_TTL) {
      if (hit.rap > 0) out[String(raw)] = hit.rap;
    } else if (todo.length < RESALE_MAX_PER_CALL) {
      todo.push(raw);
    }
  }
  if (!todo.length) return out;

  // En parallele : une dizaine de petits GET independants, les enchainer
  // faisait attendre l'utilisateur pour rien.
  const results = await Promise.all(todo.map(async (raw) => {
    try {
      const j = await apiGet(`${ECONOMY}/assets/${raw}/resale-data`, { allowRelay: false });
      return [raw, Number(j?.recentAveragePrice) || 0];
    } catch { return [raw, 0]; }   // objet non revendable ou inconnu
  }));

  for (const [raw, rap] of results) {
    resaleCache[String(raw)] = { rap, at: now };
    if (rap > 0) out[String(raw)] = rap;
  }
  resaleCache = Object.fromEntries(
    Object.entries(resaleCache).sort((a, b) => b[1].at - a[1].at).slice(0, RESALE_CAP)
  );
  await B.storage.local.set({ resale: resaleCache });
  return out;
}

/* ------------------- assets appartenant a un bundle --------------------- */

const BUNDLE_TTL = 30 * 24 * 60 * 60 * 1000;   // un asset ne change pas de bundle
const BUNDLE_CAP = 1200;
const BUNDLE_MAX_PER_CALL = 24;
let bundleCache = null;

/**
 * assetId -> bundleId, via le catalogue.
 *
 * Sert quand un trade designe un objet par un asset qui n'est que le CONTENU
 * d'un bundle (la tete d'un visage DynamicHead, par exemple) : la cote et la
 * vignette qui comptent sont celles du bundle.
 */
export async function resolveBundleIds(assetIds) {
  if (!bundleCache) {
    const { bundleOf } = await B.storage.local.get('bundleOf');
    bundleCache = bundleOf || {};
  }
  const out = {};
  const now = Date.now();
  const todo = [];

  for (const raw of new Set((assetIds || []).map(Number).filter(Boolean))) {
    const hit = bundleCache[String(raw)];
    if (hit && now - hit.at < BUNDLE_TTL) {
      if (hit.b) out[String(raw)] = hit.b;
    } else if (todo.length < BUNDLE_MAX_PER_CALL) {
      todo.push(raw);
    }
  }
  if (!todo.length) return out;

  const results = await Promise.all(todo.map(async (raw) => {
    try {
      const j = await apiGet(`${CATALOG}/assets/${raw}/bundles?limit=10`, { allowRelay: false });
      return [raw, Number(j?.data?.[0]?.id) || 0];
    } catch { return [raw, 0]; }      // asset hors bundle : on memorise l'absence
  }));

  for (const [raw, bundleId] of results) {
    bundleCache[String(raw)] = { b: bundleId, at: now };
    if (bundleId) out[String(raw)] = bundleId;
  }
  bundleCache = Object.fromEntries(
    Object.entries(bundleCache).sort((a, b) => b[1].at - a[1].at).slice(0, BUNDLE_CAP)
  );
  await B.storage.local.set({ bundleOf: bundleCache });
  return out;
}

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

/** @returns { [assetId]: url } — les identifiants non rendus sont absents. */
export async function fetchAssetThumbs(assetIds, size = '150x150') {
  const out = {};
  for (const part of chunk([...new Set(assetIds.map(Number).filter(Boolean))], ASSET_THUMB_BATCH)) {
    const q = new URLSearchParams({ assetIds: part.join(','), size, format: 'Png', isCircular: 'false' });
    try {
      readThumbs(await apiGet(`${THUMBS}/assets?${q}`, { allowRelay: false }), out);
    } catch {
      // Un lot refuse en bloc ne doit pas emporter les autres : on retente
      // objet par objet plutot que de rendre le trade entier sans image.
      if (part.length > 1) {
        const solo = await Promise.all(part.map(id => fetchAssetThumbs([id], size).catch(() => ({}))));
        for (const s of solo) Object.assign(out, s);
      }
    }
  }
  return out;
}

/** @returns { [bundleId]: url } — lots de 30 maximum, plafond impose par Roblox. */
export async function fetchBundleThumbs(bundleIds, size = '150x150') {
  const out = {};
  for (const part of chunk([...new Set(bundleIds.map(Number).filter(Boolean))], BUNDLE_THUMB_BATCH)) {
    const q = new URLSearchParams({ bundleIds: part.join(','), size, format: 'Png' });
    try {
      readThumbs(await apiGet(`${THUMBS}/bundles/thumbnails?${q}`, { allowRelay: false }), out);
    } catch {
      if (part.length > 1) {
        const solo = await Promise.all(part.map(id => fetchBundleThumbs([id], size).catch(() => ({}))));
        for (const s of solo) Object.assign(out, s);
      }
    }
  }
  return out;
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

/* ============================= inventaire =============================== */

/** Limiteds « classiques » : [{assetId, name, recentAveragePrice, serialNumber, …}] */
export function getCollectibles(userId, maxPages = 12) {
  return allPages(`${INVENTORY}/users/${userId}/assets/collectibles?limit=100&sortOrder=Asc`, { maxPages });
}

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

async function rolimons(url, what) {
  const r = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new ApiError('HTTP ' + r.status, r.status);
  const j = await r.json();
  if (!j?.success) throw new ApiError(`${what} indisponible chez Rolimon's`, 0);
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
    terminated: !!j.terminated
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
  const r = await fetchWithTimeout(`https://www.rolimons.com/player/${userId}`, { headers: { Accept: 'text/html' } }, 30000);
  if (!r.ok) throw new ApiError('HTTP ' + r.status, r.status);
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

/* ================================ liens ================================= */

export const TRADE_URL  = (id) => `https://www.roblox.com/trades?tradeId=${id}`;
export const TAB_URL    = (tab) => `https://www.roblox.com/trades?tab=${tab}`;
export const USER_URL   = (id) => `https://www.roblox.com/users/${id}/profile`;
export const ASSET_URL  = (id) => `https://www.roblox.com/catalog/${id}`;
export const BUNDLE_URL = (id) => `https://www.roblox.com/bundles/${id}`;
export const ROLI_ITEM_URL   = (id) => `https://www.rolimons.com/item/${id}`;
export const ROLI_PLAYER_URL = (id) => `https://www.rolimons.com/player/${id}`;
