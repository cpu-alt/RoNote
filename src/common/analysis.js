/**
 * ==========================================================================
 *  L'EVALUATION D'UN TRADE
 * --------------------------------------------------------------------------
 *  La VALUE d'abord. C'est le chiffre sur lequel se fait un trade : le RAP
 *  n'est qu'une moyenne de ventes, il se gonfle a coups de rachats entre
 *  complices, et personne ne trade au RAP. Toute l'interface est donc
 *  construite autour de la value — mais le RAP reste affiche a cote, parce
 *  qu'un ecart franc entre les deux est justement le signal qui compte.
 *
 *  Regle de conduite : on n'invente jamais un chiffre. Un objet sans cote est
 *  marque comme tel et l'ecart est annonce non calculable, plutot que d'etre
 *  presente comme sur en valant secretement zero.
 * ==========================================================================
 */
import { readEntry, DEMAND_LABEL, TREND_LABEL } from './roli.js';
import { assetKey, bundleKey } from './thumbs.js';

/** Part prelevee par Roblox sur les Robux recus dans un trade. */
export const ROBUX_TAX = 0.3;

/* ------------------------- identite d'un objet -------------------------- */

/**
 * Rattache un objet d'offre a une fiche du catalogue.
 *
 * Quatre chemins, du plus sur au plus indirect :
 *   1. l'API annonce un bundle          -> fiche bundle (visages, tenues)
 *   2. l'API annonce un asset cote      -> fiche asset
 *   3. l'identifiant est en fait un bundle (v2 « Unknown ») -> fiche bundle
 *   4. l'asset n'est que le CONTENU d'un bundle -> resolu via le catalogue
 *
 * Un visage migre est reconnu dans les deux sens : par son bundle (le trade
 * moderne) comme par son ancien asset (les pages, les vieux caches).
 */
export function resolveItem(raw, cat, extra = null, bundleIds = null) {
  const assets = cat?.assets || {};
  const bundles = cat?.bundles || {};
  const faceOf = cat?.faceOf || {};
  const bundleOf = cat?.bundleOf || {};

  const assetId = Number(raw.assetId) || 0;
  let bundleId = Number(raw.bundleId) || 0;
  let legacyAssetId = 0;
  let entry = null;
  let viaBundle = false;

  if (bundleId) {
    entry = bundles[String(bundleId)] || null;
    legacyAssetId = Number(faceOf[String(bundleId)]) || 0;
    if (!entry && legacyAssetId) entry = assets[String(legacyAssetId)] || null;
    viaBundle = true;
  } else if (assetId) {
    entry = assets[String(assetId)] || null;
    if (entry) {
      // Cet asset est-il un visage passe en bundle ? Alors c'est le bundle
      // qui est reellement echange, et son image est celle de l'ancien visage.
      const b = Number(bundleOf[String(assetId)]) || 0;
      if (b) { bundleId = b; legacyAssetId = assetId; }
    } else if (bundles[String(assetId)]) {
      bundleId = assetId;
      entry = bundles[String(assetId)];
      legacyAssetId = Number(faceOf[String(assetId)]) || 0;
      viaBundle = true;
    } else {
      const b = Number(bundleIds?.[String(assetId)]) || 0;
      if (b) {
        bundleId = b;
        entry = bundles[String(b)] || null;
        legacyAssetId = Number(faceOf[String(b)]) || 0;
        if (!entry && legacyAssetId) entry = assets[String(legacyAssetId)] || null;
        viaBundle = true;
      }
    }
  }

  const isFace = !!legacyAssetId;
  const info = readEntry(entry);

  const tradeRap = Number(raw.recentAveragePrice) || 0;
  const resaleRap = Number(extra?.[String(assetId)]) || 0;
  // Confiance decroissante : le RAP du trade (celui que Roblox affiche a
  // l'ecran), puis l'API economy, puis celui publie par Rolimon's.
  const rap = tradeRap || resaleRap || (info?.rap ?? 0);

  const community = info?.rawValue > 0 ? info.rawValue : 0;
  const value = community || rap;
  // Base prudente : ne pas se laisser porter par une cote gonflee.
  const prudent = community > 0 && rap > 0 ? Math.min(community, rap) : value;
  const ratio = community > 0 && rap > 0 ? community / rap : null;

  const changeKey = viaBundle && bundleId ? bundleKey(bundleId)
    : assetKey(legacyAssetId || assetId || bundleId);

  return {
    uaid: raw.id ?? null,
    assetId,
    bundleId,
    legacyAssetId,
    isFace,
    isBundle: !!bundleId,
    name: raw.name || info?.name || (bundleId ? `Bundle #${bundleId}` : `Objet #${assetId}`),
    acronym: info?.acronym || '',
    serial: raw.serialNumber ?? null,
    stock: raw.stock || 0,
    onHold: !!raw.onHold,

    rap,
    value,
    prudent,
    ratio,
    unknown: !(value > 0),
    noValue: !community,                 // cote non publiee : le chiffre est un RAP
    projected: !!info?.projected,
    rare: !!info?.rare,
    demand: info?.demand ?? -1,
    trend: info?.trend ?? -1,
    demandLabel: DEMAND_LABEL[info?.demand] || '',
    trendLabel: TREND_LABEL[info?.trend] || '',

    source: community > 0 ? (viaBundle ? 'bundle' : 'rolimons')
      : tradeRap > 0 ? 'rap' : resaleRap > 0 ? 'resale' : 'inconnu',
    changeKey
  };
}

/**
 * Les vignettes possibles pour un objet, de la plus parlante a la moins.
 * Pour un visage, l'ancienne image plate passe devant le rendu de tete du
 * bundle : c'est celle que tout le monde reconnait.
 */
export function thumbKeysFor(item) {
  const keys = [];
  if (item.legacyAssetId) keys.push(assetKey(item.legacyAssetId));
  if (item.bundleId) keys.push(bundleKey(item.bundleId));
  if (item.assetId) {
    keys.push(assetKey(item.assetId));
    // Un identifiant de type inconnu peut designer un bundle : on essaie.
    if (!item.bundleId) keys.push(bundleKey(item.assetId));
  }
  return [...new Set(keys)];
}

/* ------------------------- objets a completer --------------------------- */

const eachItem = function* (detail) {
  for (const offer of detail?.offers || []) {
    for (const a of offer.userAssets || []) yield a;
  }
};

/**
 * Assets qu'aucune table ne connait : candidats a une resolution par bundle
 * via le catalogue Roblox (le contenu d'un bundle porte un id inedit).
 */
export function unresolvedAssetIds(detail, cat) {
  const assets = cat?.assets || {};
  const bundles = cat?.bundles || {};
  const out = new Set();
  for (const a of eachItem(detail)) {
    const id = Number(a.assetId) || 0;
    if (!id || Number(a.bundleId)) continue;
    if (assets[String(id)] || bundles[String(id)]) continue;
    out.add(id);
  }
  return [...out];
}

/** Objets sans aucun chiffre, meme apres resolution : dernier recours economy. */
export function missingValueAssetIds(detail, cat, bundleIds = null) {
  const out = new Set();
  for (const a of eachItem(detail)) {
    const item = resolveItem(a, cat, null, bundleIds);
    if (item.unknown && item.assetId) out.add(item.assetId);
  }
  return [...out];
}

/* ------------------------------ une offre ------------------------------- */

const BASIS_FIELD = { value: 'value', rap: 'rap', prudent: 'prudent' };

function sideOf(offer, cat, extra, bundleIds, opts) {
  const specRatio = Number(cat?.ratio) || 1.6;
  const changes = cat?.changes || {};

  const items = (offer.userAssets || []).map(raw => {
    const item = resolveItem(raw, cat, extra, bundleIds);
    item.speculative = item.ratio !== null && item.ratio >= specRatio;
    // Une revision de cote n'a de sens que s'il y a une cote communautaire.
    item.moved = item.noValue ? null : (changes[item.changeKey] || null);
    return item;
  });

  const gross = Number(offer.robux) || 0;
  // Roblox preleve 30 % sur les Robux d'un trade : celui qui les recoit
  // n'en touche que 70. Compter le montant brut surevalue l'offre.
  const net = opts.robuxTax ? Math.round(gross * (1 - ROBUX_TAX)) : gross;

  const known = items.filter(i => !i.unknown);
  const sum = (f) => known.reduce((s, i) => s + i[f], 0);

  return {
    user: offer.user,
    items,
    robux: gross,
    robuxNet: net,
    rap: sum('rap'),
    value: sum('value'),
    prudent: sum('prudent'),
    itemCount: items.length,
    unknownCount: items.length - known.length,
    unknownItems: items.filter(i => i.unknown).map(i => i.name),
    faces: items.filter(i => i.isFace).length,
    projected: items.some(i => i.projected),
    speculative: items.some(i => i.speculative),
    moved: items.filter(i => i.moved)
  };
}

const pctOf = (from, to) => (from > 0 ? ((to - from) / from) * 100 : (to > 0 ? 100 : 0));

/**
 * @param detail     reponse normalisee de /trades/{id}
 * @param myId       userId connecte
 * @param cat        catalogue Rolimon's (getCatalog) ou null
 * @param extra      { [assetId]: rap } recuperes en secours
 * @param bundleIds  { [assetId]: bundleId } resolus via le catalogue Roblox
 */
export function analyze(detail, myId, cat = null, extra = null, bundleIds = null, settings = null) {
  const opts = { robuxTax: settings?.robuxTax !== false };
  const offers = detail?.offers || [];
  const mineRaw  = offers.find(o => o.user?.id === myId) || offers[0] || { userAssets: [], robux: 0, user: {} };
  const theirRaw = offers.find(o => o.user?.id !== myId) || offers[1] || { userAssets: [], robux: 0, user: {} };

  const give = sideOf(mineRaw, cat, extra, bundleIds, opts);
  const got  = sideOf(theirRaw, cat, extra, bundleIds, opts);

  // Les Robux comptent dans les totaux : donnes bruts, recus nets d'impot.
  give.value += give.robux; give.rap += give.robux; give.prudent += give.robux;
  got.value += got.robuxNet; got.rap += got.robuxNet; got.prudent += got.robuxNet;

  const allItems = [...give.items, ...got.items];
  // Aucune cote communautaire sur ce trade (Rolimon's coupe, injoignable, ou
  // objets non cotes) : « value » et « RAP » seraient alors le meme nombre.
  const hasValues = allItems.some(i => i.source === 'rolimons' || i.source === 'bundle');

  let basis = BASIS_FIELD[settings?.valueBasis] ? settings.valueBasis : 'value';
  if (!hasValues) basis = 'rap';
  const field = BASIS_FIELD[basis];

  const pctValue   = pctOf(give.value, got.value);
  const pctRap     = pctOf(give.rap, got.rap);
  const pctPrudent = pctOf(give.prudent, got.prudent);
  const pctMain    = basis === 'rap' ? pctRap : basis === 'prudent' ? pctPrudent : pctValue;

  const unknownCount = give.unknownCount + got.unknownCount;
  const comparable = hasValues && give.value > 0 && give.rap > 0 && got.value > 0 && got.rap > 0;
  // Contradiction franche entre l'avis de la communaute et les ventes reelles.
  const divergent = comparable && ((pctValue >= 3 && pctRap <= -3) || (pctValue <= -3 && pctRap >= 3));

  return {
    tradeId: detail.id,
    created: detail.created,
    expiration: detail.expiration,
    status: detail.status,
    partner: got.user?.id ? got.user : (detail.user || {}),
    sender: detail.user || null,
    give, get: got,

    basis, basisField: field,
    mainGive: give[field], mainGet: got[field],
    deltaMain: got[field] - give[field],
    pctMain,

    deltaValue: got.value - give.value,
    deltaRap: got.rap - give.rap,
    pctValue, pctRap, pctPrudent,

    hasValues,
    faceCount: give.faces + got.faces,
    robuxTaxed: opts.robuxTax && got.robux > 0,
    robuxLost: opts.robuxTax ? got.robux - got.robuxNet : 0,
    projectedIncoming: got.projected,
    speculativeIncoming: got.speculative,
    movedItems: [...give.moved, ...got.moved],
    divergent,

    unknownCount,
    incomplete: unknownCount > 0,

    valueStale: !!cat?.stale,
    valueVeryStale: !!cat?.veryStale,
    valueAge: cat?.ts ? Date.now() - cat.ts : null,
    usedRolimons: !!cat?.ready
  };
}

/* ------------------------------- verdict -------------------------------- */

/** Verdict lisible pour l'UI et les notifications. */
export function verdict(a) {
  if (a.incomplete) {
    return {
      label: a.unknownCount > 1 ? `${a.unknownCount} objets sans cote` : 'Objet sans cote',
      tone: 'unknown', icon: '❔'
    };
  }
  // NB : une contradiction value/RAP n'ecrase PAS le verdict. La base choisie
  // tranche, et le desaccord est affiche a cote comme un repere. Masquer un
  // gain reel derriere un « incertain » serait plus trompeur que l'inverse.
  const p = a.pctMain;
  if (p >= 25)  return { label: 'Excellent',  tone: 'win',  icon: '🔥' };
  if (p >= 10)  return { label: 'Bon gain',   tone: 'win',  icon: '🟢' };
  if (p >= 3)   return { label: 'Gain',       tone: 'win',  icon: '🟢' };
  if (p > -3)   return { label: 'Équilibré',  tone: 'even', icon: '⚪' };
  if (p > -10)  return { label: 'Perte',      tone: 'loss', icon: '🔴' };
  if (p > -25)  return { label: 'Mauvais',    tone: 'loss', icon: '🔴' };
  return          { label: 'Très mauvais',    tone: 'loss', icon: '💀' };
}
