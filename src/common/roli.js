import { fetchWithTimeout } from './utils.js';
/**
 * ==========================================================================
 *  LE CATALOGUE ROLIMON'S
 * --------------------------------------------------------------------------
 *  Roblox ne publie qu'un chiffre : le RAP, moyenne des ventes recentes. Il
 *  se manipule (deux complices qui se revendent l'objet), et il ne dit rien
 *  de ce qu'un objet vaut REELLEMENT sur le marche du trade.
 *
 *  La « value » Rolimon's est ce chiffre-la : une cote fixee par une equipe
 *  communautaire, revisee regulierement. C'est elle que lit tout le monde,
 *  c'est donc elle qu'on met en avant — sans jamais cacher le RAP a cote,
 *  parce qu'une cote peut etre contestee et qu'un ecart franc entre les deux
 *  est une information en soi.
 *
 * --------------------------------------------------------------------------
 *  DEUX SOURCES, ET POURQUOI LES DEUX
 *
 *    v3  { assets: {...}, bundles: {...} }   2 405 assets + 160 bundles
 *    v1  { items:  {...} }                   2 514 assets
 *
 *  v3 est la source moderne : c'est la SEULE qui cote les bundles, donc la
 *  seule qui connaisse les visages depuis que Roblox les a convertis en
 *  bundles DynamicHead.
 *
 *  v1 est reste sur l'ancien monde : il cote encore les 158 visages sous leur
 *  ANCIEN identifiant d'asset, ceux que v3 a retires.
 *
 *  Ces 158 asset-la sont exactement le pont dont on a besoin :
 *
 *      v3.bundles[160001924154932] = ["The Dog Whisperer", "DW", 64766, 55000, …]
 *      v1.items  [34764447]        = ["The Dog Whisperer", "DW", 64766, 55000, …]
 *
 *  Meme nom, meme cote. On rapproche donc les deux par le nom, en ne
 *  considerant QUE les assets presents dans v1 et absents de v3 : sur les 160
 *  bundles cotes, 158 trouvent leur ancien visage, zero ambiguite. (Restreindre
 *  au « v1 seul » est ce qui evite le piege « Zip It! », qui existe en visage
 *  24126147 ET en chapeau 100931472.)
 *
 *  Ce pont sert partout :
 *    - la VIGNETTE d'un visage : l'image plate de l'ancien visage, celle que
 *      tout le monde reconnait, plutot que le rendu de tete du bundle ;
 *    - le PORTEFEUILLE : savoir qu'un asset compte par Rolimon's et un bundle
 *      possede sur Roblox sont le meme objet (voir portfolio.js).
 * ==========================================================================
 */
import { B } from './shim.js';

const V3 = 'https://api.rolimons.com/items/v3/itemdetails';
const V1 = 'https://api.rolimons.com/items/v1/itemdetails';

const KEY = 'roli';
const KEY_CHANGES = 'roliChanges';
export const CACHE_VERSION = 4;

const TTL = 3 * 60 * 60 * 1000;           // fraicheur de la table
const VERY_STALE = 24 * 60 * 60 * 1000;   // au-dela, on ne filtre plus dessus
const CHANGE_WINDOW = 7 * 24 * 60 * 60 * 1000;
const CHANGE_CAP = 4000;
const MIN_CHANGE_PCT = 3;

/* --------------------------- format d'une fiche ------------------------- */

/**
 * Une fiche normalisee, 8 colonnes, identique pour un asset et un bundle.
 * Un tableau plutot qu'un objet : 2 500 fiches en `storage.local`, la
 * difference se compte en centaines de kilo-octets.
 */
export const NAME = 0, ACRO = 1, RAP = 2, VALUE = 3, DEMAND = 4, TREND = 5, PROJ = 6, RARE = 7;

/** `-1` chez Rolimon's = « non renseigne ». */
const num = (v) => (typeof v === 'number' && v > 0 ? v : 0);
const flag = (v) => (v === 1 ? 1 : 0);
const level = (v) => (typeof v === 'number' && v >= 0 ? v : -1);

/**
 * Les deux versions ne publient pas le meme nombre de colonnes :
 *   v1 (10) [nom, acro, rap, value, valueDefaut, demande, tendance, projete, hype, rare]
 *   v3  (9) [nom, acro, rap, value, valueDefaut, demande, tendance, projete,       rare]
 * v3 a laisse tomber « hype ». `rare` est donc en 9 chez v1 et en 8 chez v3 :
 * on lit la DERNIERE colonne, ce qui vaut pour les deux.
 */
function normalizeEntry(d) {
  if (!Array.isArray(d) || d.length < 5) return null;
  const rap = num(d[2]);
  const value = num(d[3]);
  if (!rap && !value) return null;      // fiche vide : rien a en tirer
  return [
    String(d[0] ?? ''), String(d[1] ?? ''),
    rap, value,
    level(d[5]), level(d[6]), flag(d[7]), flag(d[d.length - 1])
  ];
}

/** Vue lisible d'une fiche. `noValue` = Rolimon's n'a pas cote l'objet. */
export function readEntry(entry) {
  if (!entry) return null;
  return {
    name: entry[NAME], acronym: entry[ACRO],
    rap: entry[RAP],
    // Convention de tout l'ecosysteme : sans cote publiee, on retombe sur le
    // RAP. `noValue` permet a l'interface de dire que c'est ce qui se passe —
    // sur un objet « projected », le RAP est justement le chiffre gonfle.
    value: entry[VALUE] || entry[RAP],
    rawValue: entry[VALUE],
    demand: entry[DEMAND], trend: entry[TREND],
    projected: !!entry[PROJ], rare: !!entry[RARE],
    noValue: !entry[VALUE]
  };
}

export const DEMAND_LABEL = ['Terrible', 'Faible', 'Normale', 'Bonne', 'Élevée', 'Très élevée'];
export const TREND_LABEL  = ['En baisse', 'Instable', 'Stable', 'En hausse', 'Fluctuante'];

/* ------------------------------ le pont --------------------------------- */

/** Deux noms comparables : minuscules, sans accent, sans ponctuation. */
export function flatName(name) {
  return String(name ?? '')
    .normalize('NFD').replace(/\p{Mn}/gu, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * bundleId -> ancien assetId du visage, et l'inverse.
 *
 * On ne cherche le nom QUE parmi les assets que v1 cote encore et que v3 a
 * retires : ce sont, par construction, les objets migres vers un bundle. Un
 * nom partage avec un chapeau encore cote en v3 ne peut donc pas polluer.
 */
function buildFaceBridge(v3assets, v3bundles, v1assets) {
  const faceOf = {}, bundleOf = {};
  if (!v1assets) return { faceOf, bundleOf };

  const index = new Map();   // nom aplati -> [assetId]
  for (const id of Object.keys(v1assets)) {
    if (v3assets[id]) continue;                     // toujours cote comme asset : pas un migre
    const key = flatName(v1assets[id][NAME]);
    if (!key) continue;
    const list = index.get(key);
    if (list) list.push(id); else index.set(key, [id]);
  }

  for (const [bundleId, entry] of Object.entries(v3bundles)) {
    const hit = index.get(flatName(entry[NAME]));
    if (!hit || hit.length !== 1) continue;         // ambigu : on s'abstient
    faceOf[bundleId] = hit[0];
    bundleOf[hit[0]] = bundleId;
  }
  return { faceOf, bundleOf };
}

/* ------------------------------ analyse --------------------------------- */

/**
 * Transforme une reponse Rolimon's en tables exploitables.
 * Fonction pure, testee sur des reponses REELLES : c'est le seul moyen de
 * detecter qu'un renommage de champ cote Rolimon's vide la table.
 * @returns {{assets, bundles}|null} — null si la reponse est inutilisable.
 */
export function parseItems(json) {
  if (!json || typeof json !== 'object') return null;

  const read = (raw) => {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [id, d] of Object.entries(raw)) {
      const entry = normalizeEntry(d);
      if (entry) out[id] = entry;
    }
    return out;
  };

  // v3 : { assets, bundles }   v2/v1 : { items }   ancien : { item_details }
  const assets = read(json.assets ?? json.items ?? json.item_details);
  const bundles = read(json.bundles);

  // Une table vide est une panne, pas un resultat : on le fait remonter.
  if (!Object.keys(assets).length && !Object.keys(bundles).length) return null;
  return { assets, bundles };
}

/** Assemble les deux versions en une table unique, pont compris. */
export function mergeSources(v3, v1) {
  const assets = { ...(v3?.assets || {}) };
  const bundles = { ...(v3?.bundles || {}) };
  const v1assets = v1?.assets || null;

  // Les assets que v1 est seul a coter (les visages migres) restent
  // consultables : un trade peut encore designer un objet par son ancien id.
  if (v1assets) for (const [id, e] of Object.entries(v1assets)) if (!assets[id]) assets[id] = e;

  const { faceOf, bundleOf } = buildFaceBridge(v3?.assets || {}, bundles, v1assets);
  return { assets, bundles, faceOf, bundleOf };
}

/* ------------------------ revisions de cote ----------------------------- */

function pruneChanges(store) {
  const cutoff = Date.now() - CHANGE_WINDOW;
  return Object.fromEntries(
    Object.entries(store || {})
      .filter(([, c]) => (c?.at || 0) > cutoff)
      .sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
      .slice(0, CHANGE_CAP)
  );
}

/** Cotes qui ont bouge entre deux rafraichissements. */
function diffValues(prev, next, prefix, at) {
  const out = {};
  if (!prev) return out;
  for (const [id, cur] of Object.entries(next)) {
    const old = prev[id];
    if (!old || !old[VALUE] || !cur[VALUE] || old[VALUE] === cur[VALUE]) continue;
    const pct = ((cur[VALUE] - old[VALUE]) / old[VALUE]) * 100;
    if (Math.abs(pct) < MIN_CHANGE_PCT) continue;
    out[prefix + id] = { from: old[VALUE], to: cur[VALUE], pct, at };
  }
  return out;
}

/* ------------------------------ chargement ------------------------------ */

async function fetchJson(url) {
  // La table fait ~300 Ko : on lui laisse un peu plus de temps qu'a un appel ordinaire.
  const r = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 30000);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

let mem = null;   // { ts, table } — evite de relire 300 Ko a chaque appel

/**
 * Contexte d'evaluation, servi depuis le cache tant qu'il est frais.
 *
 * @returns {{assets, bundles, faceOf, bundleOf, ts, stale, veryStale,
 *            changes, basis, ratio, count, ready}}
 *   stale : la table servie vient d'un cache perime (Rolimon's injoignable).
 *           On continue a s'en servir — mais on le DIT.
 */
export async function getCatalog(settings) {
  const ratio = Number(settings?.speculativeRatio) || 1.6;
  const basis = settings?.valueBasis || 'value';

  const empty = {
    assets: {}, bundles: {}, faceOf: {}, bundleOf: {},
    ts: 0, stale: false, veryStale: false, changes: {},
    basis: 'rap', ratio, count: 0, ready: false
  };
  if (settings && settings.useRolimons === false) return empty;

  const now = Date.now();
  if (mem && now - mem.ts < TTL) return { ...mem.table, basis, ratio };

  const got = await B.storage.local.get([KEY, KEY_CHANGES]);
  const cached = got[KEY];
  let changes = pruneChanges(got[KEY_CHANGES]);

  // Une table ecrite par une version anterieure peut etre vide ou mal formee :
  // on ne la reutilise que si elle porte la version courante et contient des cotes.
  const usable = cached?.v === CACHE_VERSION && cached.assets && Object.keys(cached.assets).length > 0;

  const wrap = (t, ts, stale) => ({
    assets: t.assets, bundles: t.bundles, faceOf: t.faceOf, bundleOf: t.bundleOf,
    ts, stale, veryStale: stale && (now - ts) > VERY_STALE,
    changes, basis, ratio,
    count: Object.keys(t.assets).length + Object.keys(t.bundles).length,
    ready: true
  });

  if (usable && (now - cached.ts) < TTL) {
    const table = wrap(cached, cached.ts, false);
    // Le cache memoire vieillit avec la TABLE, pas avec le moment de la
    // lecture : sinon une table de 2 h 59 restait servie 3 h de plus.
    mem = { ts: cached.ts, table };
    return table;
  }

  try {
    // Les deux versions en parallele : v3 fait autorite, v1 n'apporte que le
    // pont des visages. Si v1 manque, on perd le pont, pas les cotes.
    const [r3, r1] = await Promise.allSettled([fetchJson(V3), fetchJson(V1)]);
    const v3 = r3.status === 'fulfilled' ? parseItems(r3.value) : null;
    const v1 = r1.status === 'fulfilled' ? parseItems(r1.value) : null;
    if (!v3 && !v1) throw new Error('aucune source de cotes exploitable');

    const table = mergeSources(v3 || { assets: {}, bundles: {} }, v1);
    const at = Date.now();
    changes = pruneChanges({
      ...changes,
      ...diffValues(cached?.assets, table.assets, 'a:', at),
      ...diffValues(cached?.bundles, table.bundles, 'b:', at)
    });

    await B.storage.local.set({
      [KEY]: { v: CACHE_VERSION, ts: at, ...table },
      [KEY_CHANGES]: changes
    });
    // Tables ecrites par les versions <= 2.0 : ~200 Ko qui ne servent plus.
    await B.storage.local.remove?.(['rolimons', 'rolimonsChanges']);
    const out = wrap(table, at, false);
    mem = { ts: at, table: out };
    return out;
  } catch (e) {
    console.debug("[RoNote] Rolimon's indisponible:", e?.message || e);
    if (usable) return wrap(cached, cached.ts, true);
    return { ...empty, stale: true, veryStale: true };
  }
}

/** Force le prochain `getCatalog` a repasser par le reseau. */
export function invalidateCatalog() { mem = null; }

export const BASIS_LABEL = {
  value: "Value Rolimon's",
  rap: 'RAP Roblox',
  prudent: 'Base prudente (min des deux)'
};
export const BASIS_SHORT = { value: 'Value', rap: 'RAP', prudent: 'Prudent' };
