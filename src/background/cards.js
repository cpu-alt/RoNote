/**
 * ==========================================================================
 *  LES CARTES DE TRADE
 * --------------------------------------------------------------------------
 *  Un trade evalue : son detail brut (Roblox, ou a defaut la page Roblox),
 *  l'analyse faite avec les cotes du moment, le portrait du partenaire et les
 *  vignettes. Le service worker en fabrique pour ses notifications, le popup
 *  en demande pour ses listes : les deux passent par ici, et par le meme cache.
 * ==========================================================================
 */
import { B, safe } from '../common/shim.js';
import * as api from '../common/api.js';
import { ApiError } from '../common/api.js';
import { getState } from '../common/state.js';
import { analyze, verdict, thumbKeysFor, missingValueAssetIds, unresolvedAssetIds } from '../common/analysis.js';
import { resolveThumbs } from '../common/thumbs.js';
import { newestEntries, serialQueue } from '../common/utils.js';
import { normStatus } from './tracker.js';

const DETAIL_KEEP = 7 * 24 * 60 * 60 * 1000;   // le contenu d'un trade ne change jamais
const DETAIL_CAP = 150;

/* ==================== details fournis par la page ===================== */

const CAPTURED_CAP = 60;
const CAPTURED_FRESH = 10 * 60 * 1000;   // meme detail recu il y a moins de 10 min : rien a reecrire

// Les messages de la page arrivent en rafale, et chacun lit, modifie puis
// reecrit la meme cle : en file, aucun n'efface l'ajout du precedent.
const pageWrites = serialQueue();

/** Un numero de trade tel que la page ou l'utilisateur l'ecrit : chiffres seuls. */
export const cleanTradeId = (id) => String(id ?? '').replace(/[^0-9]/g, '');

/**
 * La page Roblox affiche sans probleme les trades que l'API refuse de nous
 * servir. On conserve donc ce qu'elle recupere : c'est la source la plus fiable
 * qui soit, puisque c'est exactement ce que l'utilisateur voit.
 */
export function rememberCapturedTrade(tradeId, detail) {
  const id = cleanTradeId(tradeId);
  if (!id || !detail) return;
  return pageWrites(async () => {
    const { captured } = await B.storage.local.get('captured');
    const prev = captured?.[id];
    // La page redemande souvent le trade qu'elle affiche.
    if (prev && Date.now() - prev.at < CAPTURED_FRESH && JSON.stringify(prev.detail) === JSON.stringify(detail)) return;
    await B.storage.local.set({ captured: newestEntries({ ...captured, [id]: { at: Date.now(), detail } }, CAPTURED_CAP) });
  });
}

/**
 * Trade lu directement sur la page. On le convertit au format interne : les
 * identifiants suffisent, les cotes viennent ensuite de Rolimon's comme pour
 * n'importe quel autre trade.
 */
export function rememberScrapedTrade(trade, myId) {
  const items = (list) => (list || []).map(i => ({
    id: null, assetId: Number(i.assetId) || 0, bundleId: Number(i.bundleId) || 0,
    name: i.name || '', recentAveragePrice: 0, serialNumber: null
  }));

  // Quelle colonne est la mienne ? La page cite un profil dans chacune : si
  // c'est le mien qui figure dans la seconde, les colonnes sont inversees par
  // rapport a l'ordre de lecture. Sans ce repere, un trade replie sur la page
  // pouvait s'afficher a l'envers — gain lu comme perte.
  const uids = Array.isArray(trade.userIds) ? trade.userIds : [];
  const has = (i) => myId && (uids[i] || []).some(id => Number(id) === Number(myId));
  const swapped = has(1) && !has(0);
  const mine = swapped ? trade.get : trade.give;
  const theirs = swapped ? trade.give : trade.get;

  const detail = {
    id: trade.tradeId || 0,
    offers: [
      { user: { id: myId }, userAssets: items(mine), robux: 0 },
      { user: { id: -1, name: trade.handle, displayName: trade.handle }, userAssets: items(theirs), robux: 0 }
    ],
    fromPage: true
  };
  return pageWrites(async () => {
    const { scraped } = await B.storage.local.get('scraped');
    const next = { ...scraped };
    if (trade.tradeId) next['id:' + trade.tradeId] = { at: Date.now(), detail };
    if (trade.handle) next['h:' + trade.handle.toLowerCase()] = { at: Date.now(), detail };
    await B.storage.local.set({ scraped: newestEntries(next, CAPTURED_CAP) });
  });
}

/** Retrouve un trade lu sur la page, par identifiant ou par partenaire. */
export async function getScrapedTrade(tradeId, partnerName) {
  const { scraped } = await B.storage.local.get('scraped');
  if (!scraped) return null;
  return scraped['id:' + tradeId]?.detail
    || (partnerName ? scraped['h:' + String(partnerName).toLowerCase()]?.detail : null)
    || null;
}

export async function getCapturedTrade(tradeId) {
  const { captured } = await B.storage.local.get('captured');
  return captured?.[String(tradeId)]?.detail || null;
}

/* ============================== le cache =============================== */

/**
 * LE CACHE DES TRADES.
 *
 * Le contenu d'un trade ne change jamais : ce qu'on donne et ce qu'on recoit
 * est fixe a sa creation. Seule l'ANALYSE depend de l'exterieur — la table des
 * cotes et deux reglages. On garde donc le detail brut 7 jours avec la fiche :
 *   - memes cotes, memes reglages  -> la fiche sert telle quelle ;
 *   - cotes revisees               -> l'analyse est refaite sur le detail garde,
 *                                     sans redemander le trade a Roblox.
 * L'ancienne regle (tout jeter apres 10 minutes) faisait recharger chaque trade
 * a chaque ouverture du popup, un appel reseau par carte.
 */
const memDetails = new Map(); // tradeId -> {at, sig, detail, card}
let detailsDirty = false;    // evite de reecrire le cache a chaque tour
let detailsLoaded = false;   // le cache stocke a ete fusionne en memoire
let detailsLoading = null;   // lecture en cours : deux demandes simultanees ne la doublent pas
let detailsSaveTimer = null;

/**
 * Lu une fois par vie du worker. Le test porte sur un drapeau, pas sur la
 * taille de la memoire : une carte ajoutee avant la lecture (un trade suivi
 * resolu au reveil) faisait croire le cache charge, et la sauvegarde suivante
 * remplacait les 150 trades gardes par cette seule carte.
 */
export async function loadDetailCache() {
  if (detailsLoaded) return;
  if (!detailsLoading) {
    detailsLoading = B.storage.local.get('details').then(({ details }) => {
      const now = Date.now();
      for (const [id, rec] of Object.entries(details || {})) {
        if (now - (rec?.at || 0) < DETAIL_KEEP && !memDetails.has(Number(id))) memDetails.set(Number(id), rec);
      }
      detailsLoaded = true;
    }).finally(() => { detailsLoading = null; });
  }
  await detailsLoading;
}

/**
 * Le cache pese quelques centaines de Ko : pendant que le popup charge ses
 * listes lot par lot, on l'ecrit une fois a la fin plutot qu'apres chaque lot.
 */
export function saveDetailCacheSoon() {
  clearTimeout(detailsSaveTimer);
  detailsSaveTimer = setTimeout(() => { saveDetailCache(); }, 1500);
}

export async function saveDetailCache() {
  clearTimeout(detailsSaveTimer);
  if (!detailsDirty) return;
  // Jamais sans le cache stocke : ecrire la memoire seule l'effacerait.
  await loadDetailCache();
  detailsDirty = false;
  const entries = [...memDetails.entries()]
    .sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
    .slice(0, DETAIL_CAP);
  memDetails.clear();
  const obj = {};
  for (const [id, rec] of entries) { memDetails.set(id, rec); obj[id] = rec; }
  await B.storage.local.set({ details: obj });
}

/** Un trade refuse ou annule quitte le cache : la lecture suivante ne le ramene pas. */
export async function forgetCard(tradeId) {
  await loadDetailCache();
  memDetails.delete(Number(tradeId));
  detailsDirty = true;
  await saveDetailCache();
}

/** Changement de compte : le cache stocke vient d'etre vide, la memoire suit. */
export function resetCards() {
  memDetails.clear();
  detailsLoaded = true;
}

/** Les details bruts gardes en memoire, du plus recent au plus ancien. */
export const knownDetails = () => [...memDetails.entries()]
  .map(([id, r]) => ({ id: String(id), at: r?.at || 0, detail: r?.detail }));

/* ============================== cartes ================================= */

/** Ce dont depend l'analyse d'un trade : la table des cotes et deux reglages. */
const analysisSig = (cat, settings) =>
  [cat?.ts || 0, cat?.ratio || 0, settings?.valueBasis || 'value', settings?.robuxTax !== false].join('|');

/** Fiche complete a partir d'un detail deja recupere (aucun appel superflu). */
export async function makeCard(detail, kind, myId, cat, settings, prev = null) {
  // 1) Assets qu'aucune table ne connait : depuis la bascule des visages en
  //    bundles, l'objet echange peut n'etre que le CONTENU d'un bundle. On
  //    fait le pont assetId -> bundleId via le catalogue Roblox.
  const unresolved = unresolvedAssetIds(detail, cat);
  const bundleIds = unresolved.length ? await safe(() => api.resolveBundleIds(unresolved), null) : null;

  // 2) Toujours aucun chiffre apres ca : dernier filet, le RAP officiel Roblox.
  const missing = missingValueAssetIds(detail, cat, bundleIds);
  const extra = missing.length ? await safe(() => api.getResaleRaps(missing), null) : null;

  const analysis = analyze(detail, myId, cat, extra, bundleIds, settings);

  // Detail recupere mais aucun objet reconnu : c'est que le format de reponse a
  // change. On remonte les cles reellement recues plutot qu'une carte vide,
  // pour pouvoir corriger le normaliseur sans deviner.
  const nbItems = analysis.give.items.length + analysis.get.items.length;
  const nbRobux = analysis.give.robux + analysis.get.robux;
  if (!nbItems && !nbRobux) {
    const top = Object.keys(detail || {}).join(', ') || '(vide)';
    const off = detail?.offers;
    const offInfo = Array.isArray(off)
      ? `${off.length} offre(s)${off[0] ? ' [' + Object.keys(off[0]).join(', ') + ']' : ''}`
      : `offers=${typeof off}`;
    const firstItem = off?.[0]?.userAssets?.[0] || off?.[0]?.items?.[0];
    const itemInfo = firstItem ? ` · objet [${Object.keys(firstItem).join(', ')}]` : '';
    throw new Error(`format inattendu — racine [${top}] · ${offInfo}${itemInfo}`);
  }

  const partner = analysis.partner || {};
  const items = [...analysis.give.items, ...analysis.get.items];

  // Vignettes et portrait en parallele : ce sont des conforts, ils ne doivent
  // jamais faire perdre la carte ni retarder les deux autres appels.
  const [headshot, thumbs] = await Promise.all([
    // Portrait deja connu (fiche precedente du meme trade) : pas de nouvel appel.
    partner.id ? (prev?.headshot || safe(() => api.getUserHeadshot(partner.id), null)) : null,
    safe(() => resolveThumbs(items.map(thumbKeysFor)), [])
  ]);
  items.forEach((it, i) => { it.thumb = thumbs?.[i] || null; });

  const card = {
    tradeId: Number(detail.id),
    kind,
    partner,
    headshot,
    created: detail.created,
    expiration: detail.expiration,
    status: normStatus(detail.status),
    analysis,
    verdict: verdict(analysis),
    url: api.TRADE_URL(detail.id)
  };
  memDetails.set(card.tradeId, { at: Date.now(), sig: analysisSig(cat, settings), detail, card });
  detailsDirty = true;
  return card;
}

/** Etiquette l'etape qui a echoue : sans ca, un echec est indiagnosticable. */
async function step(label, fn) {
  try { return await fn(); }
  catch (e) { throw new Error(`${label}: ${e?.message || e}`); }
}

export const liteTrade = (t) => ({
  tradeId: Number(t.id), partner: t.user, created: t.created,
  expiration: t.expiration, status: normStatus(t.status)
});

/** Ce que les listes de trades savent deja de chacun : la v2 ne renvoie aucune date. */
export function snapshotHints(state) {
  const hints = new Map();
  for (const k of ['inbound', 'outbound', 'completed']) {
    for (const t of state.snapshot?.[k] || []) {
      const id = Number(t.tradeId);
      if (!hints.has(id)) hints.set(id, { tradeId: id, created: t.created, expiration: t.expiration, status: t.status, partner: t.partner });
    }
  }
  return hints;
}

export async function buildCard(tradeId, kind, myId, cat, settings, { force = false, hint = null } = {}) {
  await loadDetailCache();
  const cached = memDetails.get(Number(tradeId));
  if (!force && cached?.card?.analysis) {
    if (cached.sig === analysisSig(cat, settings)) return { ...cached.card, kind };
    if (cached.detail) {
      return step('analyse', () => makeCard(cached.detail, kind, myId, cat, settings, cached.card));
    }
  }
  const meta = hint || snapshotHints(await getState()).get(Number(tradeId)) || null;
  let detail;
  try {
    detail = await step('détail du trade', () => api.getTrade(tradeId, meta));
  } catch (e) {
    // Replis successifs, du plus fidele au plus approximatif :
    //  1. la reponse que la page Roblox a elle-meme recue ;
    //  2. ce qui est affiche a l'ecran (identifiants lus dans les liens).
    const fromPage = await getCapturedTrade(tradeId)
      || await getScrapedTrade(String(tradeId), meta?.partner?.name || '');
    if (!fromPage) throw e;
    detail = api.normalizeTradeDetail({ ...fromPage, id: fromPage.id || tradeId }, meta);
  }
  return step('analyse', () => makeCard(detail, kind, myId, cat, settings));
}

/** Carte minimale quand le detail n'est pas recuperable (trade deja parti). */
export function stubCard(t, kind) {
  return {
    tradeId: Number(t.id), kind, partner: t.user || {}, headshot: null,
    created: t.created, status: normStatus(t.status), analysis: null,
    url: api.TRADE_URL(t.id)
  };
}

/**
 * `safe()` avale tout — y compris une limite de debit. Dix trades neufs, c'est
 * alors dix appels condamnes d'avance, chacun avec son attente, et aucun
 * backoff pose : la limite se prolonge toute seule. Ici, un 429 ressort, le
 * cycle l'attrape et met la pause qu'il faut. Le reste est avale comme avant.
 */
export async function safeCard(fn, fallback = null) {
  try { return await fn(); }
  catch (e) {
    if (e instanceof ApiError && e.isRate) throw e;
    console.debug('[RoNote] safeCard():', e?.message || e);
    return fallback;
  }
}
