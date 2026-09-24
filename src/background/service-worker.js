import { B, safe } from '../common/shim.js';
import * as api from '../common/api.js';
import { ApiError } from '../common/api.js';
import {
  getSettings, saveSettings, replaceSettings, getState, setState, getStreams, saveStreams,
  pushHistory, getHistory, clearHistory, getPortfolio, savePortfolio,
  getPortfolioReport, savePortfolioReport
} from '../common/state.js';
import { getCatalog } from '../common/roli.js';
import { pageDetail, analyzePage, capturedForPage, resolveNames, findByName, addKnownInstances } from '../common/page-trade.js';
import { setLang, t, currentLang, dictFor } from '../common/i18n.js';
import {
  analyze, verdict, thumbKeysFor, missingValueAssetIds, unresolvedAssetIds, resolveItem
} from '../common/analysis.js';
import { resolveThumbs, flushThumbs, clearThumbs } from '../common/thumbs.js';
import { buildPortfolio, portfolioThumbKeys, attachPortfolioThumbs } from '../common/portfolio.js';
import { detectRevaluations, newestRevision } from '../common/revalue.js';
import { passesFilters } from '../common/filters.js';
import { historyFor, thinSeries, playerFaces } from '../common/player.js';
import { eachLimit, inQuietHours, serialQueue } from '../common/utils.js';
import { pollStream, markSeen, directionOf } from './streams.js';
import {
  resolveTracked, normStatus, OUTCOMES,
  noteCounterFromPartner, noteCounterByMe, takeHint, purgeHints
} from './tracker.js';
import {
  notifyTrade, notifySummary, notifyRevaluations, notifySystem, playSound, playSoundsFor, setBadge,
  notifTarget, forgetNotif
} from './notifier.js';

const ALARM = 'ronote:poll';
const DETAIL_KEEP = 7 * 24 * 60 * 60 * 1000;   // le contenu d'un trade ne change jamais
const DETAIL_CAP = 150;
const HYDRATE_PARALLEL = 3;   // trades evalues en meme temps pour le popup
const ME_TTL = 15 * 60 * 1000;   // on ne redemande pas l'identite a chaque tour
const LINKS_CAP = 120;
const PAGE_LIMIT = 25;
const SNAPSHOT_LIMIT = 25;  // trades remontes au popup (etait 12)

let runningSince = 0;     // verrou anti-recouvrement, horodate (voir tick)
const TICK_STALE_MS = 2 * 60 * 1000;   // au-dela, un cycle est considere comme perdu
let softTimer = null;     // cadence < 30 s (best effort tant que le worker vit)

/* ===================== en-tetes des requetes ========================== */

const HEADER_RULE_ID = 1;
let headerRulesActive = null;   // null = pas encore tente

/**
 * Roblox refuse certains GET authentifies quand l'`Origin` n'est pas le sien :
 * le service worker envoie `chrome-extension://…` et aucun `Referer`, d'ou des
 * 403 sur le detail de certains trades.
 *
 * On reecrit donc ces deux en-tetes pour NOS requetes uniquement
 * (`tabIds: [-1]` = requetes hors onglet). Cette condition n'existe que pour les
 * regles de SESSION : un `rules.json` statique la refuse. Les regles de session
 * disparaissant a chaque redemarrage, on les repose au demarrage du worker.
 */
async function installHeaderRules() {
  const dnr = B.declarativeNetRequest;
  if (!dnr?.updateSessionRules) { headerRulesActive = false; return false; }
  try {
    await dnr.updateSessionRules({
      removeRuleIds: [HEADER_RULE_ID],
      addRules: [{
        id: HEADER_RULE_ID,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'origin', operation: 'set', value: 'https://www.roblox.com' },
            { header: 'referer', operation: 'set', value: 'https://www.roblox.com/' }
          ]
        },
        condition: {
          requestDomains: ['roblox.com'],
          tabIds: [-1],
          resourceTypes: ['xmlhttprequest']
        }
      }]
    });
    headerRulesActive = true;
    return true;
  } catch (e) {
    console.debug('[RoNote] règles d\'en-têtes indisponibles:', e?.message || e);
    headerRulesActive = false;
    return false;
  }
}

/* =========================== cycle de vie ============================== */

B.runtime.onInstalled.addListener(async (details) => {
  await installHeaderRules();
  const settings = await getSettings();
  setLang(settings.lang);
  await configureAlarm(settings);
  if (details.reason === 'install') {
    await notifySystem(t('RoNote est installé'),
      t('Ouvre roblox.com et connecte-toi : la surveillance démarre toute seule. Les trades déjà présents ne déclencheront aucune alerte.'));
  }
  // Restes de la courbe « bundles comptés », retirée avant publication : les
  // corrections mesurées et la reconstruction des visages ne servent plus.
  await safe(() => B.storage.local.remove(['portfolioCorr', 'faceScan', 'faceLedger', 'faceHistory', 'portfolioCorrSeries']));
  tick('installed');
});

B.runtime.onStartup?.addListener(async () => {
  await installHeaderRules();
  await configureAlarm(await getSettings());
  tick('startup');
});

B.alarms.onAlarm.addListener(a => { if (a.name === ALARM) tick('alarm'); });

async function configureAlarm(settings) {
  await safe(() => B.alarms.clear(ALARM));
  if (!settings.enabled) { clearTimeout(softTimer); return; }
  const minutes = Math.max(0.5, (Number(settings.pollSeconds) || 30) / 60);
  await safe(() => B.alarms.create(ALARM, { periodInMinutes: minutes }));
}

function scheduleSoftTick(settings) {
  clearTimeout(softTimer);
  const s = Number(settings.pollSeconds) || 30;
  if (s >= 30 || !settings.enabled) return;
  softTimer = setTimeout(() => tick('soft'), s * 1000);
}

/* ==================== details fournis par la page ===================== */

const CAPTURED_CAP = 60;
const CAPTURED_FRESH = 10 * 60 * 1000;   // meme detail recu il y a moins de 10 min : rien a reecrire

// Les messages de la page arrivent en rafale, et chacun lit, modifie puis
// reecrit la meme cle : en file, aucun n'efface l'ajout du precedent.
const pageWrites = serialQueue();

/**
 * La page Roblox affiche sans probleme les trades que l'API refuse de nous
 * servir. On conserve donc ce qu'elle recupere : c'est la source la plus fiable
 * qui soit, puisque c'est exactement ce que l'utilisateur voit.
 */
function rememberCapturedTrade(tradeId, detail) {
  const id = String(tradeId).replace(/[^0-9]/g, '');
  if (!id || !detail) return;
  return pageWrites(async () => {
    const { captured } = await B.storage.local.get('captured');
    const prev = captured?.[id];
    // La page redemande souvent le trade qu'elle affiche.
    if (prev && Date.now() - prev.at < CAPTURED_FRESH && JSON.stringify(prev.detail) === JSON.stringify(detail)) return;
    const next = { ...(captured || {}), [id]: { at: Date.now(), detail } };
    const kept = Object.entries(next).sort((x, y) => y[1].at - x[1].at).slice(0, CAPTURED_CAP);
    await B.storage.local.set({ captured: Object.fromEntries(kept) });
  });
}

/**
 * Trade lu directement sur la page. On le convertit au format interne : les
 * identifiants suffisent, les cotes viennent ensuite de Rolimon's comme pour
 * n'importe quel autre trade.
 */
async function rememberScrapedTrade(trade, myId) {
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
    const next = { ...(scraped || {}) };
    if (trade.tradeId) next['id:' + trade.tradeId] = { at: Date.now(), detail };
    if (trade.handle) next['h:' + trade.handle.toLowerCase()] = { at: Date.now(), detail };
    const kept = Object.entries(next).sort((x, y) => y[1].at - x[1].at).slice(0, CAPTURED_CAP);
    await B.storage.local.set({ scraped: Object.fromEntries(kept) });
  });
}

/** Retrouve un trade lu sur la page, par identifiant ou par partenaire. */
async function getScrapedTrade(tradeId, partnerName) {
  const { scraped } = await B.storage.local.get('scraped');
  if (!scraped) return null;
  return scraped['id:' + tradeId]?.detail
    || (partnerName ? scraped['h:' + String(partnerName).toLowerCase()]?.detail : null)
    || null;
}

async function getCapturedTrade(tradeId) {
  const { captured } = await B.storage.local.get('captured');
  return captured?.[String(tradeId)]?.detail || null;
}

/* ============================== cartes ================================= */

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
async function loadDetailCache() {
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

/** Ce dont depend l'analyse d'un trade : la table des cotes et deux reglages. */
const analysisSig = (cat, settings) =>
  [cat?.ts || 0, cat?.ratio || 0, settings?.valueBasis || 'value', settings?.robuxTax !== false].join('|');

/**
 * Le cache pese quelques centaines de Ko : pendant que le popup charge ses
 * listes lot par lot, on l'ecrit une fois a la fin plutot qu'apres chaque lot.
 */
function saveDetailCacheSoon() {
  clearTimeout(detailsSaveTimer);
  detailsSaveTimer = setTimeout(() => { saveDetailCache(); }, 1500);
}

async function saveDetailCache() {
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

/** Fiche complete a partir d'un detail deja recupere (aucun appel superflu). */
async function makeCard(detail, kind, myId, cat, settings, prev = null) {
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

/** Ce que les listes de trades savent deja de chacun : la v2 ne renvoie aucune date. */
function snapshotHints(state) {
  const hints = new Map();
  for (const k of ['inbound', 'outbound', 'completed']) {
    for (const t of state.snapshot?.[k] || []) {
      const id = Number(t.tradeId);
      if (!hints.has(id)) hints.set(id, { tradeId: id, created: t.created, expiration: t.expiration, status: t.status, partner: t.partner });
    }
  }
  return hints;
}

async function tradeHint(tradeId) {
  return snapshotHints(await getState()).get(Number(tradeId)) || null;
}

async function buildCard(tradeId, kind, myId, cat, settings, { force = false, hint = null } = {}) {
  await loadDetailCache();
  const cached = memDetails.get(Number(tradeId));
  if (!force && cached?.card?.analysis) {
    if (cached.sig === analysisSig(cat, settings)) return { ...cached.card, kind };
    if (cached.detail) {
      return step('analyse', () => makeCard(cached.detail, kind, myId, cat, settings, cached.card));
    }
  }
  const meta = hint || await tradeHint(tradeId);
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
function stubCard(t, kind) {
  return {
    tradeId: Number(t.id), kind, partner: t.user || {}, headshot: null,
    created: t.created, status: normStatus(t.status), analysis: null,
    url: api.TRADE_URL(t.id)
  };
}

const liteTrade = (t) => ({
  tradeId: Number(t.id), partner: t.user, created: t.created,
  expiration: t.expiration, status: normStatus(t.status)
});

function record(ctx, card, extra = {}) {
  ctx.history.push({
    at: Date.now(), kind: card.kind, tradeId: card.tradeId,
    partner: card.partner?.displayName || card.partner?.name || '?',
    partnerId: card.partner?.id ?? null,
    basis: card.analysis?.basis ?? null,
    give: card.analysis?.mainGive ?? null,
    get: card.analysis?.mainGet ?? null,
    pct: card.analysis?.pctMain ?? null,
    pctRap: card.analysis?.pctRap ?? null,
    divergent: card.analysis?.divergent ?? null,
    unknown: card.analysis?.unknownCount ?? null,
    counterTo: card.counterTo ?? null,
    notified: true, skipped: null,
    ...extra
  });
}

/* ========================= etapes de la boucle ========================= */

/** 1) Onglet Inactive : erreurs Roblox, refus/expirations, detection des contres. */
async function stepInactive(ctx) {
  const r = await pollStream('inactive', ctx.streams, { pageLimit: PAGE_LIMIT });
  if (r.seeded) return;

  for (const t of r.fresh) {
    const id = Number(t.id);
    // Un trade suivi qui reapparait ici a son sort ecrit dans la liste : on le
    // traite tout de suite, avec les regles du suivi, et on retire le suivi.
    // Le laisser au tracker coutait un detail de plus et, depuis que le meme
    // trade n'est plus redemande a chaque passage, jusqu'a dix minutes
    // d'attente avant de prevenir.
    const meta = ctx.state.tracked[id] || null;
    if (meta) delete ctx.state.tracked[id];

    const status = normStatus(t.status);
    const dir = directionOf(ctx.streams, id);
    const pid = t.user?.id;

    if (status === 'Countered') {
      if (dir === 'inbound') {
        // C'est MOI qui ai contre ce trade : mon nouveau trade envoye
        // apparaitra dans Outbound, il faudra le suivre.
        noteCounterByMe(ctx.state.myCounters, pid, id, ctx.state.links[id]?.round || 1);
      } else if (dir === 'outbound') {
        // Le partenaire a contre un trade envoye. Un suivi pose a la main
        // previent toujours ; l'auto-suivi et les non-suivis suivent les reglages.
        noteCounterFromPartner(ctx.state.counterHints, pid, id, (meta?.round || ctx.state.links[id]?.round || 1) + 1);
        const wanted = meta
          ? (!meta.auto || ctx.settings.notifyOutbound.countered)
          : (ctx.settings.notifyUntrackedOutbound && ctx.settings.notifyOutbound.countered);
        if (pid && wanted) {
          const card = stubCard(t, 'outbound_countered');
          card.counterTo = meta?.counterTo || null;
          card.round = meta?.round || 1;
          ctx.pendingCountered.set(pid, card);
        }
      }
      continue;
    }

    if (status === 'RejectedDueToError' || status === 'InterventionRequired') {
      if (!ctx.settings.watchRejectedError) continue;
      const card = await safeCard(() => buildCard(id, 'trade_error', ctx.me.id, ctx.cat, ctx.settings), null)
        || stubCard(t, 'trade_error');
      card.kind = 'trade_error';
      card.statusLabel = OUTCOMES[status].title
        + (dir === 'outbound' ? ' · trade envoyé' : dir === 'inbound' ? ' · trade reçu' : '');
      ctx.events.push(card);
      record(ctx, card, { status });
      continue;
    }

    // Declined / Expired sur un trade envoye : suivi a la main, auto-suivi ou
    // pas suivi du tout — chacun ses regles, une seule notification.
    if (dir === 'outbound' && ctx.settings.watchOutbound) {
      const info = OUTCOMES[status];
      if (!info) continue;
      const wanted = meta
        ? (!meta.auto || ctx.settings.notifyOutbound[info.opt])
        : (ctx.settings.notifyUntrackedOutbound && ctx.settings.notifyOutbound[info.opt]);
      if (!wanted) continue;
      const card = await safeCard(() => buildCard(id, info.kind, ctx.me.id, ctx.cat, ctx.settings), null)
        || stubCard(t, info.kind);
      card.kind = info.kind;
      card.statusLabel = info.title;
      card.counterTo = meta?.counterTo || null;
      card.round = meta?.round || 1;
      ctx.events.push(card);
      record(ctx, card, { status, tracked: !!meta });
    }
  }
}

/** 2) Onglet Outbound : auto-suivi des nouveaux envois + resolution des suivis. */
async function stepOutbound(ctx) {
  const trackedCount = Object.keys(ctx.state.tracked).length;
  const r = await pollStream('outbound', ctx.streams, { pageLimit: trackedCount ? 100 : PAGE_LIMIT });
  ctx.snapshot.outbound = r.all.slice(0, SNAPSHOT_LIMIT).map(liteTrade);
  const openIds = new Set(r.all.map(t => Number(t.id)));

  // --- nouveaux trades envoyes ---
  if (!r.seeded) {
    for (const t of r.fresh) {
      const pid = t.user?.id;
      const mine = pid ? takeHint(ctx.state.myCounters, pid, ctx.windowMs) : null;
      if (mine) {
        ctx.state.links[t.id] = { counterTo: mine.fromInbound, round: (mine.round || 1) + 1, at: Date.now() };
      }
      const shouldTrack = ctx.settings.autoTrackOutbound || (mine && ctx.settings.autoTrackCounters);
      if (shouldTrack) {
        ctx.state.tracked[t.id] = {
          at: Date.now(), partner: t.user, auto: true,
          counterTo: mine ? mine.fromInbound : null,
          round: mine ? (mine.round || 1) + 1 : 1
        };
      }
    }
  }

  // --- issue des trades suivis ---
  const resolutions = await resolveTracked(ctx.state.tracked, openIds, id => api.getTrade(id));
  for (const res of resolutions) {
    const meta = res.meta || {};
    delete ctx.state.tracked[res.tradeId];
    // Le trade va aussi apparaitre dans Completed / Inactive : on le marque
    // comme deja traite pour ne pas notifier deux fois le meme evenement.
    markSeen(ctx.streams, 'completed', [res.tradeId]);
    markSeen(ctx.streams, 'inactive', [res.tradeId]);

    const info = OUTCOMES[res.status];
    if (!info) continue;

    const card = await safeCard(() => makeCard(res.detail, info.kind, ctx.me.id, ctx.cat, ctx.settings), null)
      || stubCard({ id: res.tradeId, user: meta.partner, status: res.status }, info.kind);
    card.kind = info.kind;
    card.statusLabel = info.title;
    card.counterTo = meta.counterTo || null;
    card.round = meta.round || 1;
    record(ctx, card, { status: res.status, tracked: true });

    if (res.status === 'Countered') {
      // On attend de voir si la contre-offre arrive dans le meme passage :
      // une seule notification vaut mieux que deux pour le meme evenement.
      const pid = card.partner?.id;
      noteCounterFromPartner(ctx.state.counterHints, pid, res.tradeId, (meta.round || 1) + 1);
      if (pid && (!meta.auto || ctx.settings.notifyOutbound.countered)) ctx.pendingCountered.set(pid, card);
      else if (!pid) ctx.events.push(card);
      continue;
    }
    // Un suivi pose a la main notifie toujours ; l'auto-suivi respecte les reglages.
    if (!meta.auto || ctx.settings.notifyOutbound[info.opt]) ctx.events.push(card);
  }
}

const INBOUND_COUNT_TTL = 2 * 60 * 1000;

/** 3) Onglet Inbound : nouveaux trades recus + rattachement des contre-offres. */
async function stepInbound(ctx) {
  const r = await pollStream('inbound', ctx.streams, { pageLimit: PAGE_LIMIT });
  ctx.snapshot.inbound = r.all.slice(0, SNAPSHOT_LIMIT).map(liteTrade);

  // Compteur exact sans appel supplementaire quand la page suffit. Au-dela,
  // le total ne se redemande que si la page a change, ou toutes les 2 min.
  const page = `${r.all.length}:${r.all[0]?.id}:${r.all[r.all.length - 1]?.id}`;
  if (r.all.length < PAGE_LIMIT) {
    ctx.state.inboundCount = r.all.length;
  } else if (page !== ctx.state.inboundPage || Date.now() - (ctx.state.inboundCountAt || 0) > INBOUND_COUNT_TTL) {
    ctx.state.inboundCount = await safe(() => api.getInboundCount(), ctx.state.inboundCount ?? r.all.length);
    ctx.state.inboundCountAt = Date.now();
  }
  ctx.state.inboundPage = page;

  if (r.seeded) return;

  for (const t of r.fresh) {
    let card = await safeCard(() => buildCard(t.id, 'inbound', ctx.me.id, ctx.cat, ctx.settings, { force: true, hint: liteTrade(t) }), null)
      || stubCard(t, 'inbound');

    const pid = card.partner?.id ?? t.user?.id;
    const hint = pid ? takeHint(ctx.state.counterHints, pid, ctx.windowMs) : null;
    if (hint) {
      card.kind = 'counter';
      card.counterTo = hint.fromOutbound;
      card.round = hint.round || 2;
      ctx.state.links[card.tradeId] = { counterTo: hint.fromOutbound, round: card.round, at: Date.now() };
      ctx.pendingCountered.delete(pid);   // fusionne avec la notif "trade contre"
    }

    const check = passesFilters(card, ctx.settings);
    record(ctx, card, { notified: check.ok, skipped: check.ok ? null : check.why, note: check.note ?? null });
    if (check.ok) ctx.events.push(card);
  }
}

/**
 * `safe()` avale tout — y compris une limite de debit. Dix trades neufs, c'est
 * alors dix appels condamnes d'avance, chacun avec son attente, et aucun
 * backoff pose : la limite se prolonge toute seule. Ici, un 429 ressort, le
 * cycle l'attrape et met la pause qu'il faut. Le reste est avale comme avant.
 */
async function safeCard(fn, fallback = null) {
  try { return await fn(); }
  catch (e) {
    if (e instanceof ApiError && e.isRate) throw e;
    console.debug('[RoNote] safeCard():', e?.message || e);
    return fallback;
  }
}

/** 4) Onglet Completed. */
async function stepCompleted(ctx) {
  const r = await pollStream('completed', ctx.streams, { pageLimit: PAGE_LIMIT });
  ctx.snapshot.completed = r.all.slice(0, SNAPSHOT_LIMIT).map(liteTrade);
  if (r.seeded) return;

  for (const t of r.fresh) {
    // Un trade que J'AI envoye et qui aboutit, c'est « ton trade a ete
    // accepte » — pas un simple « trade complete » : le titre, le son et le
    // point de vue (tu as recu / tu as donne) de la notification changent.
    const mine = directionOf(ctx.streams, t.id) === 'outbound';
    // Meme raison qu'en Inactifs : la liste dit que c'est fini, le tracker n'a
    // plus a en demander le detail — et ne notifiera donc pas une seconde fois.
    delete ctx.state.tracked[t.id];
    const kind = mine ? 'outbound_accepted' : 'completed';
    const card = await safeCard(() => buildCard(t.id, kind, ctx.me.id, ctx.cat, ctx.settings, { force: true, hint: liteTrade(t) }), null)
      || stubCard(t, kind);
    card.kind = kind;
    if (mine) card.statusLabel = OUTCOMES.Completed.title;
    ctx.events.push(card);
    record(ctx, card, mine ? { status: 'Completed' } : {});
  }
}

/* ============================ portefeuille ============================= */

const PORTFOLIO_TTL = 10 * 60 * 1000;   // profil + inventaire : 2 appels a Rolimon's
const HISTORY_TTL = 30 * 60 * 1000;     // la serie Rolimon's ne bouge qu'une fois par jour
const ITEM_HISTORY_TTL = 6 * 60 * 60 * 1000;   // historique d'un objet (page de 1,7 Mo)
const ITEM_HISTORY_CAP = 20;                   // objets dont l'historique reste en cache
const PLAYER_TTL = 30 * 60 * 1000;             // profil d'un joueur ouvert depuis sa fiche
const PLAYER_CAP = 30;                         // joueurs dont le profil reste en cache
const PLAYER_HISTORY_TTL = 6 * 60 * 60 * 1000; // courbe d'inventaire d'un joueur (page Rolimon's)
const PLAYER_HISTORY_CAP = 10;                 // joueurs dont la courbe reste en cache
const PLAYER_HISTORY_POINTS = 400;             // releves gardes par courbe
const PORTFOLIO_RETRY = 5 * 60 * 1000;         // apres un echec, sans attendre la fraicheur complete

/**
 * Les chiffres du compte : ceux de Rolimon's avec la liste des objets, et la
 * serie historique. Deux cadences differentes, d'ou deux gardes de
 * fraicheur — reconstruire tout ca a chaque verification (toutes les 30 s)
 * serait une attaque en regle sur les API de Rolimon's depuis l'IP du joueur.
 */
async function refreshPortfolio(state, settings, cat, { force = false } = {}) {
  const now = Date.now();
  // Releve ecrit avant 2.14 (`rawV` a cote du chiffre corrige des visages) :
  // on le remplace au premier passage plutot que d'afficher 10 min de plus
  // une correction que Rolimon's a rendue inutile.
  if (state.portfolioLast && 'rawV' in state.portfolioLast) force = true;

  if (force || now - (state.portfolioAt || 0) > PORTFOLIO_TTL) {
    const report = await safe(() => buildPortfolio(state.userId, cat), null);

    if (report?.rolimons) {
      state.portfolioAt = now;
      state.portfolioPrivate = report.private;
      state.portfolioRank = report.rank;
      state.portfolioLast = { v: report.value, r: report.rap, at: report.at };
      const keys = portfolioThumbKeys(report);
      if (keys.length) {
        const urls = await safe(() => resolveThumbs(keys), []);
        attachPortfolioThumbs(report, urls || []);
      }
      await savePortfolioReport(report);
    } else {
      // Profil injoignable : nouvel essai dans 5 min. Sans repere, chaque
      // passage relancerait les appels a Rolimon's.
      state.portfolioAt = now - PORTFOLIO_TTL + PORTFOLIO_RETRY;
    }
    if (report?.chartScannedAt) state.chartScannedAt = report.chartScannedAt;
  }

  // L'historique est une page HTML, pas une API : on l'economise. Rolimon's
  // n'y ajoute qu'un releve par jour ; tant que son dernier releve connu est
  // deja dans la serie gardee, relire la page ne rapporterait rien.
  const due = force || now - (state.historyFetchedAt || 0) > HISTORY_TTL;
  const upToDate = !force && state.chartScannedAt && state.historyLastAt >= state.chartScannedAt;
  if (due && !upToDate) {
    const points = await safe(() => api.getPlayerHistory(state.userId), null);
    if (points?.length) {
      state.historyFetchedAt = now;
      state.historyLastAt = points[points.length - 1].at;
      state.collectibles = points[points.length - 1].n;
      await savePortfolio(points);
    } else {
      // Page injoignable : nouvel essai dans 5 min. Page sans courbe : au
      // prochain terme normal — la redemander plus tot ne la remplirait pas.
      state.historyFetchedAt = points ? now : now - HISTORY_TTL + PORTFOLIO_RETRY;
    }
  }
}

/* ====================== reevaluation des objets ======================= */

/**
 * Croise les revisions de cote avec ce que le joueur possede (revalue.js).
 *
 * `state.revalSince` joue le role de la photo initiale des flux : au premier passage,
 * ou tant que l'option est coupee, il suit l'heure courante sans rien notifier.
 * Sinon, activer l'option ferait tomber d'un coup 7 jours de revisions.
 */
async function stepRevaluations(ctx) {
  const { settings, state } = ctx;
  const active = settings.revalAlerts && settings.useRolimons && settings.trackPortfolio;
  if (!active || !state.revalSince) {
    state.revalSince = Date.now();
    return;
  }

  // Rien de plus recent que le repere : inutile de relire le rapport du
  // portefeuille, ce qui arriverait sinon toutes les 30 s pour rien.
  const changes = ctx.cat?.changes || {};
  if (newestRevision(changes) <= state.revalSince) return;

  // Sans inventaire connu pour CE compte, on ne sait rien : le repere reste en
  // place, et rien n'est perdu pour le passage suivant.
  const report = await getPortfolioReport();
  if (!report?.holdings || Number(report.userId) !== Number(state.userId)) return;

  const { hits, latest } = detectRevaluations(changes, report.holdings, ctx.cat, {
    since: state.revalSince,
    minPct: Math.max(3, Number(settings.revalMinPercent) || 10)
  });
  state.revalSince = latest;
  if (!hits.length) return;

  ctx.events.push({ kind: 'revalued', hits });
  const at = Date.now();
  for (const h of hits) {
    ctx.history.push({
      at, kind: 'revalued', name: h.name, key: h.key,
      from: h.from, to: h.to, pct: h.pct, count: h.count, delta: h.delta,
      notified: true
    });
  }
}

/* =============================== tick ================================== */

async function getMe(state) {
  if (state.userId && Date.now() - (state.meCheckedAt || 0) < ME_TTL) {
    return { id: state.userId, name: state.userName, displayName: state.userName, cached: true };
  }
  const me = await api.getAuthenticatedUser();
  state.meCheckedAt = Date.now();
  return me;
}

/* ======================= ecritures concurrentes ======================== */

/**
 * UN PASSAGE TIENT SA COPIE PLUSIEURS SECONDES.
 *
 * La verification lit `state` et `streams` au debut, travaille (appels reseau,
 * notifications), puis les reecrit. Un refus, un suivi ou une remise a zero
 * demandes entre-temps depuis le popup etaient ecrases par cette ecriture :
 * le suivi disparaissait, et un trade refuse depuis RoNote pouvait revenir en
 * alerte.
 *
 * Toute modification venue d'un message passe donc par `editStore` : appliquee
 * tout de suite au stockage et, si un passage tient sa copie, notee pour qu'il
 * la rejoue avant d'ecrire. Les lectures et ecritures des deux cotes passent
 * par la meme file : aucune ne s'intercale au milieu d'une autre.
 */
const storeQueue = serialQueue();
let tickHolds = false;   // un passage a lu state/streams et va les ecrire
const lateEdits = [];    // modifications a rejouer sur sa copie

/** @param edit (state, streams, replay) => void — doit pouvoir etre rejouee */
function editStore(edit) {
  return storeQueue(async () => {
    const [state, streams] = await Promise.all([getState(), getStreams()]);
    edit(state, streams, false);
    if (tickHolds) lateEdits.push(edit);
    await setState(state);
    await saveStreams(streams);
    return state;
  });
}

/** Lecture du passage : a partir d'ici, les modifications lui seront rejouees. */
function holdStore() {
  return storeQueue(async () => {
    const got = await Promise.all([getState(), getStreams()]);
    lateEdits.length = 0;
    tickHolds = true;
    return got;
  });
}

/** Ecriture du passage, apres avoir rejoue ce qui a change pendant qu'il travaillait. */
function commitStore(state, streams, { writeStreams = true } = {}) {
  return storeQueue(async () => {
    for (const edit of lateEdits.splice(0)) edit(state, streams, true);
    await setState(state);
    if (writeStreams) await saveStreams(streams);
  });
}

function releaseStore() {
  tickHolds = false;
  lateEdits.length = 0;
}

/** Ce que refreshPortfolio ecrit dans `state`. */
const PORTFOLIO_FIELDS = ['portfolioAt', 'portfolioPrivate', 'portfolioRank', 'portfolioLast',
  'historyFetchedAt', 'historyLastAt', 'chartScannedAt', 'collectibles'];
const portfolioSig = (state) => JSON.stringify(PORTFOLIO_FIELDS.map(k => state[k] ?? null));

async function tick(reason = 'manual') {
  // Le verrou est horodate : un cycle qui n'en finit pas (appel reseau qui ne
  // repond jamais, worker suspendu en plein vol) ne doit pas bloquer tous les
  // suivants jusqu'au redemarrage du navigateur. Au-dela de TICK_STALE_MS, on
  // le considere perdu et on repart.
  if (runningSince && Date.now() - runningSince < TICK_STALE_MS) return;
  runningSince = Date.now();
  let settings = null;
  try {
    settings = await getSettings();
    setLang(settings.lang);
    if (!settings.enabled) return;

    const [state, streams] = await holdStore();

    // Le reveil du worker et l'alarme peuvent se declencher coup sur coup.
    if (reason !== 'manual' && state.lastPollAt && Date.now() - state.lastPollAt < 3000) return;
    // Un reveil n'est pas un rendez-vous : le jeton envoye par un onglet Roblox
    // reveille le worker bien plus souvent que la cadence choisie. L'alarme,
    // elle, reste a l'heure.
    const cadence = (Number(settings.pollSeconds) || 30) * 1000;
    if (reason === 'boot' && state.lastPollAt && Date.now() - state.lastPollAt < cadence * 0.8) return;
    state.lastPollAt = Date.now();

    // Un clic sur « verifier maintenant » passe outre une pause ordinaire :
    // c'est tout l'interet du bouton. Mais pas outre une limite de debit —
    // relancer un cycle complet pendant qu'elle court ne fait que la
    // prolonger, et c'est le reflexe naturel devant le point rouge.
    if (state.backoffUntil && Date.now() < state.backoffUntil
        && (reason !== 'manual' || state.backoffWhy === 'rate')) {
      await commitStore(state, streams, { writeStreams: false });
      return;
    }

    let me;
    try {
      me = await getMe(state);
    } catch (e) {
      state.meCheckedAt = 0;
      await handleError(e, state, streams, settings);
      return;
    }

    if (state.userId && Number(state.userId) !== Number(me.id)) {
      // Changement de compte : on repart d'une photo vierge, sans notifier.
      for (const k of Object.keys(streams)) delete streams[k];
      state.tracked = {}; state.counterHints = {}; state.myCounters = {}; state.links = {};
      await B.storage.local.set({ details: {}, portfolio: [], portfolioReport: null });
      state.portfolioAt = 0; state.historyFetchedAt = 0; state.historyLastAt = 0; state.chartScannedAt = 0;
      state.portfolioLast = null;
      state.revalSince = 0;
      memDetails.clear();
      detailsLoaded = true;   // le cache stocke vient d'etre vide
      await clearThumbs();
    }
    state.userId = me.id;
    state.userName = me.displayName || me.name;
    state.lastError = null;
    state.backoffUntil = 0;
    state.backoffWhy = '';
    state.rateHits = 0;
    state.tickCount = (state.tickCount || 0) + 1;

    const windowMs = Math.max(1, Number(settings.counterWindowMinutes) || 90) * 60000;
    purgeHints(state.counterHints, windowMs);
    purgeHints(state.myCounters, windowMs);

    const ctx = {
      settings, state, streams, me, windowMs,
      cat: await getCatalog(settings),
      events: [],
      history: [],
      pendingCountered: new Map(),
      snapshot: { ...(state.snapshot || {}), at: Date.now() }
    };

    // L'ordre compte : Inactive alimente les indices de contre-offre que
    // Outbound puis Inbound consomment dans le meme passage.
    const steps = [
      [settings.watchOutbound || settings.watchRejectedError, stepInactive, 'inactive'],
      [settings.watchOutbound, stepOutbound, 'outbound'],
      [settings.watchInbound, stepInbound, 'inbound'],
      [settings.watchCompleted, stepCompleted, 'completed']
    ];
    for (const [enabled, step, kind] of steps) {
      if (!enabled) continue;
      // Si l'etape echoue APRES avoir lu sa page, les trades qu'elle venait de
      // decouvrir etaient deja marques « vus » : jamais notifies, sans un mot.
      // On remet le flux dans l'etat d'avant et on oublie ce que l'etape avait
      // commence a produire — le prochain passage reprendra tout proprement.
      const before = streams[kind];
      const nEvents = ctx.events.length, nHistory = ctx.history.length;
      try { await step(ctx); }
      catch (e) {
        if (before) streams[kind] = before; else delete streams[kind];
        ctx.events.length = nEvents;
        ctx.history.length = nHistory;
        await handleError(e, state, streams, settings);
        // Limite de debit : les etapes suivantes appelleraient la meme API,
        // chacune avec son attente, et la prolongeraient.
        if (e instanceof ApiError && e.isRate) break;
      }
    }

    // Contres non rattaches a une contre-offre entrante : on notifie a part.
    for (const card of ctx.pendingCountered.values()) ctx.events.push(card);

    // Objets possedes reevalues depuis le dernier passage. L'inventaire vient
    // du rafraichissement precedent du portefeuille (10 min au plus) : il
    // change rarement plus vite, et on n'attend pas Rolimon's pour notifier.
    await stepRevaluations(ctx);

    await emit(ctx);

    // Menage des liens de negociation trop anciens.
    const links = Object.entries(state.links || {}).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, LINKS_CAP);
    state.links = Object.fromEntries(links);

    // CE QUI PRESSE D'ABORD. Le journal et l'etat sont ecrits ICI, avant le
    // portefeuille : celui-ci coute quatre appels a Rolimon's et une page HTML,
    // soit plusieurs secondes pendant lesquelles un evenement deja notifie
    // n'apparaissait pas encore dans le journal du popup. Le popup, lui, ecoute
    // l'ecriture (storage.onChanged) : l'entree s'affiche a l'instant.
    state.snapshot = ctx.snapshot;
    state.valueStale = !!ctx.cat?.stale;
    state.valueTs = ctx.cat?.ts || 0;
    state.valueCount = ctx.cat?.count ?? 0;
    state.lastOkAt = Date.now();
    if (ctx.history.length) await pushHistory(ctx.history.reverse(), settings.historyLimit);
    await commitStore(state, streams);
    await setBadge(state.inboundCount, settings, false);

    // Portefeuille : chiffres du moment, liste des objets, historique Rolimon's.
    // Le plus souvent rien n'est du : l'etat vient d'etre ecrit, inutile de
    // le reecrire a l'identique.
    if (settings.useRolimons && settings.trackPortfolio) {
      const before = portfolioSig(state);
      await refreshPortfolio(state, settings, ctx.cat);
      if (portfolioSig(state) !== before) await commitStore(state, streams, { writeStreams: false });
    }
    await saveDetailCache();
    await flushThumbs({ force: true });
    await refreshLuckyCat(settings);
  } catch (e) {
    console.error('[RoNote] tick:', e);
  } finally {
    releaseStore();
    runningSince = 0;
    if (settings) scheduleSoftTick(settings);
  }
}

/**
 * Le Lucky Cat de Rolimon's change d'exemplaire toutes les 4 a 24 h : la page
 * est relue au plus toutes les 10 min, et le resultat range sous `luckyCat`,
 * ou le popup et les pages Roblox le lisent directement. Un echec garde le
 * dernier tirage connu ; au-dela d'un jour, il ne vaut plus rien.
 */
const LUCKY_TTL = 10 * 60 * 1000;
const LUCKY_MAX_AGE = 24 * 60 * 60 * 1000;
let luckyAsking = null;
async function refreshLuckyCat(settings) {
  if (!settings.useRolimons || settings.showLuckyCat === false) return null;
  const { luckyCat } = await B.storage.local.get('luckyCat');
  const fresh = luckyCat?.checkedAt && Date.now() - luckyCat.checkedAt < LUCKY_TTL;
  if (fresh) return luckyCat;
  luckyAsking = luckyAsking || (async () => {
    try {
      const cat = await api.getLuckyCat();
      const next = { ...cat, checkedAt: Date.now(), at: Date.now() };
      await B.storage.local.set({ luckyCat: next });
      return next;
    } catch (e) {
      console.warn('[RoNote] Lucky Cat:', e?.message || e);
      const kept = luckyCat?.at && Date.now() - luckyCat.at < LUCKY_MAX_AGE ? luckyCat : null;
      // Pas de nouvel essai avant le delai normal, meme en cas d'echec.
      const next = kept ? { ...kept, checkedAt: Date.now() } : { checkedAt: Date.now() };
      await B.storage.local.set({ luckyCat: next });
      return next;
    } finally { luckyAsking = null; }
  })();
  return luckyAsking;
}

/** Envoi groupe : au-dela du plafond, une notification resume par type. */
async function emit(ctx) {
  if (!ctx.events.length) return;
  // Le son part tout de suite, en parallele des notifications : il n'attend
  // ni le telechargement d'un portrait ni l'ecriture de l'etat. Pas de son
  // pendant les heures silencieuses, meme si les notifications restent.
  const sound = inQuietHours(ctx.settings.quietHours)
    ? null
    : playSoundsFor(ctx.events.map(c => c.kind), ctx.settings).catch(() => 0);
  const max = Math.max(1, ctx.settings.maxNotificationsPerPoll || 5);
  const byKind = new Map();
  for (const card of ctx.events) {
    if (!byKind.has(card.kind)) byKind.set(card.kind, []);
    byKind.get(card.kind).push(card);
  }
  for (const [kind, cards] of byKind) {
    // Une reevaluation porte deja tous ses objets : sa propre notification.
    if (kind === 'revalued') {
      for (const c of cards) await notifyRevaluations(c.hits, ctx.settings);
      continue;
    }
    if (cards.length > max) {
      for (const c of cards.slice(-max)) await notifyTrade(c, ctx.settings);
      await notifySummary(kind, cards.length, ctx.settings);
    } else {
      for (const c of cards) await notifyTrade(c, ctx.settings);
    }
  }
  if (sound) await sound;
}

let authWarnedAt = 0;

async function handleError(e, state, streams, settings) {
  const err = e instanceof ApiError ? e : new ApiError(String(e?.message || e), 0);
  state.lastError = { message: err.message, status: err.status, at: Date.now() };

  if (err.isAuth) {
    state.lastError.message = t('Non connecté à Roblox (cookie de session introuvable).');
    state.meCheckedAt = 0;
    state.backoffUntil = Date.now() + 60000;
    state.backoffWhy = 'auth';
    if (Date.now() - authWarnedAt > 30 * 60000) {
      authWarnedAt = Date.now();
      await notifySystem(t('RoNote : connexion requise'),
        t('Connecte-toi sur roblox.com dans ce navigateur, puis ouvre un onglet Roblox. La surveillance reprendra automatiquement.'));
    }
  } else if (err.isRate) {
    // Une premiere limite se passe en une demi-minute. Si elle revient, c'est
    // que la cadence est trop haute pour ce compte : on s'ecarte davantage a
    // chaque fois, au lieu d'y retourner au meme rythme.
    state.rateHits = (state.rateHits || 0) + 1;
    const wait = Math.max(Math.min(300, 30 * state.rateHits), err.retryAfter || 0);
    state.backoffUntil = Date.now() + wait * 1000;
    state.backoffWhy = 'rate';
    // « HTTP 429 » ne dit rien a personne, et laisse croire a une panne. Le
    // service est nomme : Roblox et Rolimon's ont des quotas distincts.
    state.lastError.message = t('Trop de requêtes : {who} nous met en pause {n} s.',
      { who: err.source || 'Roblox', n: wait });
  } else {
    const prev = state.backoffUntil && state.backoffUntil > Date.now() ? state.backoffUntil - Date.now() : 15000;
    state.backoffUntil = Date.now() + Math.min(5 * 60000, prev * 2);
    state.backoffWhy = 'net';
  }
  // Appelee pendant un passage : ecrire aussi les flux enregistrerait des
  // trades vus avant qu'ils soient notifies.
  await commitStore(state, streams, { writeStreams: false });
  await setBadge(0, settings, true);
}

/* ========================== interactions ============================== */

async function openUrl(url) {
  const tabs = await safe(() => B.tabs.query({ url: '*://*.roblox.com/trades*' }), []);
  if (tabs?.length) {
    await safe(() => B.tabs.update(tabs[0].id, { active: true, url }));
    await safe(() => B.windows.update(tabs[0].windowId, { focused: true }));
  } else {
    await safe(() => B.tabs.create({ url }));
  }
}

B.notifications.onClicked.addListener(async (id) => {
  const rec = await notifTarget(id);
  const settings = await getSettings();
  if (rec?.url && settings.openOnClick) await openUrl(rec.url);
  await safe(() => B.notifications.clear(id));
});

B.notifications.onButtonClicked?.addListener(async (id, idx) => {
  const rec = await notifTarget(id);
  if (!rec) return;
  if (idx === 0 && rec.url) await openUrl(rec.url);
  if (idx === 1 && rec.userId) {
    const settings = await getSettings();
    if (!settings.ignoredUsers.some(u => Number(u.id) === Number(rec.userId))) {
      await saveSettings({ ignoredUsers: [...settings.ignoredUsers, { id: rec.userId, name: rec.userName }] });
      await notifySystem(t('Utilisateur ignoré'), t("{who} ne déclenchera plus d'alerte.", { who: rec.userName }));
    }
  }
  await safe(() => B.notifications.clear(id));
});

B.notifications.onClosed?.addListener((id) => forgetNotif(id));

/* ============================ messages ================================= */

B.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (typeof msg?.type !== 'string' || !msg.type.startsWith('ronote:')) return;
  if (msg.type === 'ronote:play-sound') return; // destine au document offscreen
  (async () => {
    try { sendResponse(await handleMessage(msg)); }
    catch (e) { sendResponse({ error: String(e?.message || e) }); }
  })();
  return true;
});

/**
 * Tout ce qu'affichent le popup et les reglages, en une reponse : le popup
 * l'attend pour afficher quoi que ce soit. `lite` : sans les compteurs des
 * flux, que seuls les reglages montrent — inutile de relire des milliers d'ids.
 */
async function uiData({ lite = false } = {}) {
  const [settings, state, history, stored, portfolio, report] = await Promise.all([
    getSettings(), getState(), getHistory(),
    lite ? null : B.storage.local.get('streams'),
    getPortfolio(), getPortfolioReport()
  ]);
  const out = { settings, state, history: history.slice(0, 100), portfolio, report };
  if (stored) {
    const streams = stored.streams || {};
    const per = (f) => Object.fromEntries(Object.entries(streams).map(([k, v]) => [k, f(v)]));
    out.counts = per(v => v?.seen?.length || 0);
    out.newest = per(v => v?.newest || 0);
    out.belowMark = per(v => v?.belowMark || 0);
  }
  return out;
}

async function handleMessage(msg) {
  switch (msg.type) {
    case 'ronote:page-analysis': {
      const [settings, state] = await Promise.all([getSettings(), getState(), loadDetailCache()]);
      if (settings.pageDelta === false) return { analysis: null, why: 'off' };
      let page = msg.page;
      let captured = null;
      // Ce que la page a chargé elle-même, puis tous les trades déjà relevés
      // par les listes (reçus, envoyés, terminés, inactifs). La page n'affiche
      // pas l'identifiant du trade choisi : on le reconnaît à ses objets. Sans
      // ce second vivier, seul le trade ouvert au chargement était reconnu.
      const stored = await B.storage.local.get('captured');
      // Roblox can keep the initial tradeId in the URL while another row is
      // selected. Match the displayed offers; never restrict copy history to
      // that initial URL ID. Asset + serial disambiguates historical copies.
      const pool = [
        ...Object.entries(stored.captured || {}).map(([id, e]) => ({ id, at: e.at, detail: e.detail, raw: true })),
        ...[...memDetails.entries()].map(([id, r]) => ({ id: String(id), at: r?.at || 0, detail: r?.detail }))
      ].filter(e => e.detail)
        .sort((a, b) => b.at - a.at);
      const details = pool.map(e => e.raw ? api.normalizeTradeDetail(e.detail) : e.detail);
      for (const candidate of details) {
        const matched = capturedForPage(page, candidate, state.userId);
        if (matched) { page = matched; captured = candidate; break; }
      }
      const cat = await getCatalog(settings);
      // Trade en préparation : ses objets peuvent n'être lus que par leur nom.
      if (page?.composer) page = resolveNames(page, cat);
      const detail = pageDetail(page, state.userId);
      if (!detail) return { analysis: null, why: 'sides' };
      // Le RAP d'un objet est le même d'un trade à l'autre : tout trade connu
      // qui le contient comble un RAP illisible sur la page, sans réseau.
      const knownRaps = {};
      for (const d of details) for (const o of d?.offers || []) for (const i of o.userAssets || []) {
        const id = Number(i.assetId) || 0, rap = Number(i.recentAveragePrice) || 0;
        if (id && rap > 0 && !knownRaps[id]) knownRaps[id] = rap;
      }
      // Aucun appel réseau ici : cette réponse revient à chaque trade affiché
      // et l'API economy de Roblox se fâche vite (429 pour tout le reste de
      // l'extension). Seuls les ponts bundle déjà en cache servent.
      const bundleIds = null;
      const extra = knownRaps;
      return { analysis: addKnownInstances(analyzePage(page, detail, cat, captured, { extra, bundleIds }), details) };
    }
    // Cote et « projected » des objets des inventaires, sur la page de création
    // d'un trade. Aucun réseau : la table Rolimon's déjà en cache suffit.
    case 'ronote:item-values': {
      const settings = await getSettings();
      if (settings.pageDelta === false) return { items: [], ready: false };
      const cat = await getCatalog(settings);
      const items = (Array.isArray(msg.items) ? msg.items : []).slice(0, 150).map(i => {
        let ids = { assetId: Number(i.assetId) || 0, bundleId: Number(i.bundleId) || 0 };
        if (!ids.assetId && !ids.bundleId) {
          for (const n of (Array.isArray(i.names) && i.names.length ? i.names : [i.name]).slice(0, 4)) {
            const hit = findByName(n, cat);
            if (hit) { ids = { assetId: hit.assetId || 0, bundleId: hit.bundleId || 0 }; break; }
          }
        }
        if (!ids.assetId && !ids.bundleId) return { key: i.key, known: false };
        const item = resolveItem({ ...ids, recentAveragePrice: Number(i.rap) || 0 }, cat);
        const listed = !item.noValue && !item.unknown;
        return { key: i.key, known: true, value: listed ? item.value : null,
          projected: !!item.projected, rare: !!item.rare, noValue: !!item.noValue };
      });
      return { items, ready: !!cat.ready };
    }
    // La page d'un objet sur Roblox (content/item-page.js) : sa cote et de
    // quoi ouvrir sa fiche Rolimon's. Rien pour un objet absent du catalogue
    // Rolimon's, c'est-a-dire tout ce qui n'est pas un limited.
    case 'ronote:item-page': {
      const settings = await getSettings();
      if (settings.itemPageValue === false || settings.useRolimons === false) return { off: true };
      const cat = await getCatalog(settings);
      const ids = { assetId: Number(msg.assetId) || 0, bundleId: Number(msg.bundleId) || 0 };
      if (!ids.assetId && !ids.bundleId) return { known: false, ready: !!cat.ready };
      const item = resolveItem(ids, cat);
      if (item.unknown) return { known: false, ready: !!cat.ready };
      // Rolimon's range ses fiches par identifiant d'asset : un visage passe
      // en bundle garde celle de son ancien asset.
      const roliId = item.legacyAssetId || (item.isBundle ? 0 : item.assetId);
      return { known: true, ready: !!cat.ready, roliId,
        value: item.noValue ? null : item.value, rap: item.rap || 0,
        demand: item.demand, trend: item.trend, projected: item.projected, rare: item.rare };
    }
    case 'ronote:get':
      return uiData(msg);

    // La reponse porte tout : le popup n'a pas a redemander derriere.
    case 'ronote:refresh':
      await tick('manual');
      return uiData(msg);

    case 'ronote:hydrate': {
      const settings = await getSettings();
      const state = await getState();
      if (!state.userId) return { cards: [] };
      const cat = await getCatalog(settings);
      const hints = snapshotHints(state);   // lu une fois, pas une fois par trade
      const cards = [];
      const failed = [];
      // Trois trades a la fois : on n'attend plus chaque carte l'une apres
      // l'autre, sans pour autant se faire limiter par Roblox.
      await eachLimit((msg.ids || []).slice(0, SNAPSHOT_LIMIT), HYDRATE_PARALLEL, async (id) => {
        try {
          // Un trade de la suite d'une liste n'est pas dans le releve : le
          // popup fournit ce qu'il en sait (dates, partenaire).
          cards.push(await buildCard(id, msg.kind || 'inbound', state.userId, cat, settings,
            { hint: hints.get(Number(id)) || msg.hints?.[id] || null }));
        } catch (e) {
          // Un detail illisible ne doit JAMAIS faire disparaitre le trade de la
          // liste : on remonte l'echec, le popup affichera la carte en mode
          // degrade avec la raison.
          failed.push({ tradeId: Number(id), error: String(e?.message || e) });
        }
      });
      saveDetailCacheSoon();
      await flushThumbs();
      return { cards, failed, links: state.links, tracked: state.tracked };
    }
    /**
     * La suite d'une liste, au-dela des 25 trades du releve : demandee par le
     * popup quand on arrive en bas, 50 par 50. Un seul appel par page ; le
     * detail de chaque trade suit a part, a mesure qu'il approche de l'ecran.
     */
    case 'ronote:list-more': {
      const type = { inbound: 'Inbound', outbound: 'Outbound', completed: 'Completed' }[msg.kind];
      if (!type) return { error: 'liste inconnue' };
      try {
        const page = await api.listTrades(type, 50, String(msg.cursor || ''));
        return { trades: (page?.data || []).map(liteTrade), cursor: page?.nextPageCursor || null };
      } catch (e) {
        return { error: String(e?.message || e) };
      }
    }
    /**
     * Historique d'un objet, pour sa fiche dans l'onglet Portefeuille. Demande
     * seulement a l'ouverture de la fiche, et garde 6 h : la page Rolimon's
     * pese jusqu'a 1,7 Mo.
     */
    case 'ronote:item-history': {
      const id = Number(msg.itemId);
      if (!id) return { error: 'identifiant invalide' };
      const settings = await getSettings();
      setLang(settings.lang);
      if (!settings.useRolimons) return { error: t("Rolimon's est désactivé dans les réglages") };
      const { itemHistory } = await B.storage.local.get('itemHistory');
      const cache = itemHistory || {};
      const hit = cache[id];
      if (hit && Date.now() - hit.at < ITEM_HISTORY_TTL) return { history: hit.data };
      try {
        const data = await api.getItemHistory(id);
        const kept = Object.entries({ ...cache, [id]: { at: Date.now(), data } })
          .sort((a, b) => b[1].at - a[1].at)
          .slice(0, ITEM_HISTORY_CAP);
        await B.storage.local.set({ itemHistory: Object.fromEntries(kept) });
        return { history: data };
      } catch (e) {
        // Rolimon's injoignable : un historique un peu ancien vaut mieux que rien.
        return hit ? { history: hit.data, stale: true } : { error: String(e?.message || e) };
      }
    }

    /**
     * Fiche d'un joueur : ce que le journal sait de vos echanges, plus ses
     * profils publics Roblox et Rolimon's. Lus seulement a l'ouverture de la
     * fiche, et gardes 30 min ; injoignables, l'ancien profil vaut mieux que rien.
     */
    case 'ronote:player': {
      const id = Number(msg.userId);
      if (!id) return { error: 'identifiant invalide' };
      const settings = await getSettings();
      const [history, { playerCache }] = await Promise.all([getHistory(), B.storage.local.get('playerCache')]);
      const cache = playerCache || {};
      let hit = cache[id];
      const why = [];
      if (!hit || Date.now() - hit.at > PLAYER_TTL) {
        // Chaque source echoue pour son compte, et dit pourquoi : « indisponible »
        // tout court ne permet de rien corriger.
        const grab = (label, fn) => Promise.resolve().then(fn)
          .catch((e) => { why.push(`${label} : ${e?.message || e}`); return null; });
        const [profile, roli] = await Promise.all([
          grab('Roblox', () => api.getUserProfile(id)),
          settings.useRolimons ? grab("Rolimon's", () => api.getPlayerInfo(id)) : null
        ]);
        if (profile || roli) {
          hit = { at: Date.now(), profile: profile || hit?.profile || null, roli: roli || hit?.roli || null };
          const kept = Object.entries({ ...cache, [id]: hit })
            .sort((a, b) => b[1].at - a[1].at)
            .slice(0, PLAYER_CAP);
          await B.storage.local.set({ playerCache: Object.fromEntries(kept) });
        }
      }
      return {
        events: historyFor(history, { id, name: msg.name, displayName: msg.displayName }),
        profile: hit?.profile || null,
        roli: settings.useRolimons ? hit?.roli || null : null,
        ignored: settings.ignoredUsers.some(u => Number(u.id) === id),
        rolimons: !!settings.useRolimons,
        why: why.join(' · ') || null
      };
    }
    /**
     * Courbe d'inventaire d'un joueur, pour sa fiche : la meme serie que celle
     * du portefeuille, lue sur sa page Rolimon's publique. Demandee a
     * l'ouverture de la fiche seulement, allegee et gardee 6 h.
     */
    case 'ronote:player-history': {
      const id = Number(msg.userId);
      if (!id) return { error: 'identifiant invalide' };
      const settings = await getSettings();
      setLang(settings.lang);
      if (!settings.useRolimons) return { error: t("Rolimon's est désactivé dans les réglages") };
      const { playerHistory } = await B.storage.local.get('playerHistory');
      const cache = playerHistory || {};
      const hit = cache[id];
      if (hit && Date.now() - hit.at < PLAYER_HISTORY_TTL) return { points: hit.points };
      try {
        const points = thinSeries(await api.getPlayerHistory(id), PLAYER_HISTORY_POINTS);
        const kept = Object.entries({ ...cache, [id]: { at: Date.now(), points } })
          .sort((a, b) => b[1].at - a[1].at)
          .slice(0, PLAYER_HISTORY_CAP);
        await B.storage.local.set({ playerHistory: Object.fromEntries(kept) });
        return { points };
      } catch (e) {
        return hit ? { points: hit.points, stale: true } : { error: String(e?.message || e) };
      }
    }
    /**
     * Ses bundles, pour sa fiche : le meme rapport que le portefeuille
     * (portfolio.js), fait sur son compte. Lu a l'ouverture de la fiche
     * seulement, et garde 30 min.
     */
    case 'ronote:player-faces': {
      const id = Number(msg.userId);
      if (!id) return { error: 'identifiant invalide' };
      const settings = await getSettings();
      setLang(settings.lang);
      if (!settings.useRolimons) return { error: t("Rolimon's est désactivé dans les réglages") };
      const { playerFaces: stored } = await B.storage.local.get('playerFaces');
      const cache = stored || {};
      const hit = cache[id];
      if (hit && Date.now() - hit.at < PLAYER_TTL) return { faces: hit.faces };
      try {
        const report = await buildPortfolio(id, await getCatalog(settings));
        const faces = playerFaces(report);
        const lines = { items: faces.faces };
        const urls = await safe(() => resolveThumbs(portfolioThumbKeys(lines)), []);
        attachPortfolioThumbs(lines, urls || []);
        await flushThumbs();
        // Un profil injoignable ne se met pas en cache : on reessaiera.
        if (report.rolimons || report.private || report.terminated) {
          const kept = Object.entries({ ...cache, [id]: { at: Date.now(), faces } })
            .sort((a, b) => b[1].at - a[1].at)
            .slice(0, PLAYER_HISTORY_CAP);
          await B.storage.local.set({ playerFaces: Object.fromEntries(kept) });
        }
        return { faces };
      } catch (e) {
        return hit ? { faces: hit.faces, stale: true } : { error: String(e?.message || e) };
      }
    }
    case 'ronote:mute': {
      let id = Number(msg.userId);
      let name = String(msg.name || '');
      // Depuis les reglages : un pseudo ou un identifiant tape a la main.
      if (!id && msg.query) {
        let hit = null;
        try { hit = await api.findUser(msg.query); } catch { return { error: 'unreachable' }; }
        if (!hit) return { error: 'unknown' };
        ({ id, name } = hit);
      }
      if (!id) return { error: 'identifiant invalide' };
      const settings = await getSettings();
      if (settings.ignoredUsers.some(u => Number(u.id) === id)) return { settings };
      return { settings: await saveSettings({ ignoredUsers: [...settings.ignoredUsers, { id, name }] }) };
    }

    case 'ronote:portfolio': {
      const settings = await getSettings();
      const fresh = await getState();
      if (!fresh.userId) return { error: 'non connecté' };
      // Calcule sur une copie et ne reporte que ses champs : une verification
      // en cours garde tout le reste (voir editStore).
      await refreshPortfolio(fresh, settings, await getCatalog(settings), { force: true });
      const state = await editStore((st) => { for (const k of PORTFOLIO_FIELDS) st[k] = fresh[k]; });
      await flushThumbs({ force: true });
      return { state, portfolio: await getPortfolio(), report: await getPortfolioReport() };
    }
    /**
     * Refuse un trade recu, ou annule un trade envoye — c'est le meme appel
     * cote Roblox. La confirmation est demandee par l'interface AVANT d'arriver
     * ici : le service worker ne fait qu'executer, mais il nettoie derriere.
     */
    case 'ronote:decline': {
      const id = Number(msg.tradeId);
      if (!id) return { error: 'identifiant de trade invalide' };
      try {
        const res = await api.declineTrade(id);
        const incoming = msg.kind === 'inbound' || msg.kind === 'counter';

        // Notre propre annulation va reapparaitre en « Declined » sur le flux
        // Inactive : on la marque deja vue, sinon on s'alerte soi-meme. Rejouee
        // sur la copie d'une verification en cours, elle ne decompte pas deux fois.
        const state = await editStore((st, streams, replay) => {
          markSeen(streams, 'inactive', [id]);
          markSeen(streams, 'completed', [id]);
          delete st.tracked[id];
          for (const kind of ['inbound', 'outbound']) {
            const list = st.snapshot?.[kind];
            if (Array.isArray(list)) st.snapshot[kind] = list.filter(t => Number(t.tradeId) !== id);
          }
          if (!replay && incoming && st.inboundCount > 0) st.inboundCount -= 1;
        });

        await loadDetailCache();   // sinon la lecture a venir ramenerait ce trade
        memDetails.delete(id);
        detailsDirty = true;
        await saveDetailCache();
        await setBadge(state.inboundCount, await getSettings(), false);
        await pushHistory([{
          at: Date.now(), kind: 'declined_by_me', tradeId: id,
          partner: msg.partner || '?', partnerId: Number(msg.partnerId) || null, notified: false,
          skipped: msg.kind === 'inbound' || msg.kind === 'counter' ? 'refusé depuis RoNote' : 'annulé depuis RoNote'
        }]);
        return { ok: true, via: res.via, state };
      } catch (e) {
        return { error: String(e?.message || e) };
      }
    }

    case 'ronote:track': {
      // `ids` : le popup desepingle d'un coup les suivis tombes hors de la
      // liste des 100 derniers envois. Une seule ecriture pour tout le lot.
      const ids = Array.isArray(msg.ids)
        ? msg.ids.map(Number).filter(Number.isFinite)
        : [Number(msg.tradeId)].filter(Number.isFinite);
      const state = await editStore((st) => {
        for (const id of ids) {
          if (msg.on === false) delete st.tracked[id];
          else st.tracked[id] = { at: Date.now(), partner: msg.partner || null, auto: false, counterTo: null, round: 1 };
        }
      });
      return { tracked: state.tracked };
    }
    case 'ronote:settings': {
      const settings = await saveSettings(msg.patch || {});
      setLang(settings.lang);
      // Un journal raccourci l'est tout de suite, pas au prochain evenement.
      if (msg.patch?.historyLimit) await pushHistory([], settings.historyLimit, true);
      await configureAlarm(settings);
      await setBadge((await getState()).inboundCount, settings, false);
      if (msg.patch?.enabled) tick('settings');
      return { settings };
    }
    // Import d'un fichier de reglages, ou remise a zero (settings: {}) : tout
    // est remplace, sauf les cles de `keep` reprises des reglages actuels.
    case 'ronote:settings-replace': {
      const cur = await getSettings();
      const raw = { ...(msg.settings || {}) };
      for (const k of msg.keep || []) if (k in cur) raw[k] = cur[k];
      const settings = await replaceSettings(raw);
      setLang(settings.lang);
      await configureAlarm(settings);
      await setBadge((await getState()).inboundCount, settings, false);
      return { settings };
    }
    case 'ronote:test': {
      const settings = await getSettings();
      setLang(settings.lang);
      await notifySystem(t('Notification de test'),
        t('Voilà à quoi ressemblera une alerte de trade. Son et affichage OK !'));
      await playSound(settings);
      return { ok: true };
    }
    /** Bouton d'ecoute des reglages : joue une sonnerie, meme si le son est coupe. */
    case 'ronote:play': {
      const settings = await getSettings();
      return { ok: await playSound(settings, String(msg.sound || ''), { force: true }) };
    }
    case 'ronote:reset-dedup': {
      await editStore((st, streams) => {
        st.tracked = {}; st.counterHints = {}; st.myCounters = {}; st.links = {};
        for (const k of Object.keys(streams)) delete streams[k];
      });
      await tick('manual');
      return { ok: true };
    }
    case 'ronote:unmute': {
      const settings = await getSettings();
      return { settings: await saveSettings({ ignoredUsers: settings.ignoredUsers.filter(u => Number(u.id) !== Number(msg.userId)) }) };
    }
    case 'ronote:scraped-trade': {
      const st = await getState();
      await rememberScrapedTrade(msg.trade || {}, st.userId);
      return { ok: true };
    }

    case 'ronote:captured-trade':
      await rememberCapturedTrade(msg.tradeId, msg.detail);
      return { ok: true };

    case 'ronote:csrf':
      api.setCsrfToken(msg.token);
      return { ok: true };

    case 'ronote:diagnose': {
      if (headerRulesActive === null) await installHeaderRules();
      const report = [{
        etape: 'en-têtes réécrits (Origin/Referer)',
        actif: headerRulesActive ? 'oui' : 'non — API declarativeNetRequest indisponible'
      }, {
        etape: 'jeton CSRF récupéré depuis une page Roblox',
        actif: api.hasCsrfToken() ? 'oui' : 'non — ouvre un onglet roblox.com'
      }, {
        etape: 'détail fourni par la page pour ce trade',
        actif: (await getCapturedTrade(String(msg.tradeId).replace(/[^0-9]/g, ''))) ? 'oui' : 'non'
      }, {
        etape: 'trade lu sur la page affichée',
        actif: (await getScrapedTrade(String(msg.tradeId).replace(/[^0-9]/g, ''), '')) ? 'oui' : 'non — ouvre ce trade sur roblox.com une fois'
      }];
      return { report: report.concat(await api.probeTradeDetail(msg.tradeId)) };
    }

    // Une page Roblox ou le popup s'ouvre : le tirage en cours, relu s'il date.
    case 'ronote:lucky-cat':
      return { luckyCat: await refreshLuckyCat(await getSettings()) };
    // L'export CSV veut tout le journal, pas les 100 lignes du popup.
    case 'ronote:history':
      return { history: await getHistory() };
    case 'ronote:history-clear':
      await clearHistory();
      return { ok: true };
    default:
      return { error: 'message inconnu: ' + msg.type };
  }
}


// Les regles de session ne survivent pas au redemarrage du navigateur : on les
// repose a chaque reveil du worker, avant la premiere requete.
installHeaderRules().finally(() => tick('boot'));
