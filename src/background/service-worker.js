import { B, safe } from '../common/shim.js';
import * as api from '../common/api.js';
import { ApiError } from '../common/api.js';
import {
  getSettings, saveSettings, getState, setState, getStreams, saveStreams, resetStreams,
  pushHistory, getHistory, clearHistory, getPortfolio, savePortfolio,
  getPortfolioReport, savePortfolioReport
} from '../common/state.js';
import { getCatalog } from '../common/roli.js';
import { setLang, t, currentLang, dictFor } from '../common/i18n.js';
import {
  analyze, verdict, thumbKeysFor, missingValueAssetIds, unresolvedAssetIds
} from '../common/analysis.js';
import { resolveThumbs, flushThumbs, clearThumbs } from '../common/thumbs.js';
import { buildPortfolio, portfolioThumbKeys, attachPortfolioThumbs } from '../common/portfolio.js';
import { passesFilters } from '../common/filters.js';
import { inQuietHours } from '../common/utils.js';
import { pollStream, markSeen, directionOf } from './streams.js';
import {
  resolveTracked, normStatus, OUTCOMES,
  noteCounterFromPartner, noteCounterByMe, takeHint, purgeHints
} from './tracker.js';
import { notifyTrade, notifySummary, notifySystem, playSound, playSoundsFor, setBadge } from './notifier.js';

const ALARM = 'ronote:poll';
const DETAIL_TTL = 10 * 60 * 1000;
const DETAIL_CAP = 250;
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

/**
 * La page Roblox affiche sans probleme les trades que l'API refuse de nous
 * servir. On conserve donc ce qu'elle recupere : c'est la source la plus fiable
 * qui soit, puisque c'est exactement ce que l'utilisateur voit.
 */
async function rememberCapturedTrade(tradeId, detail) {
  const id = String(tradeId).replace(/[^0-9]/g, '');
  if (!id || !detail) return;
  const { captured } = await B.storage.local.get('captured');
  const next = { ...(captured || {}), [id]: { at: Date.now(), detail } };
  const kept = Object.entries(next).sort((x, y) => y[1].at - x[1].at).slice(0, CAPTURED_CAP);
  await B.storage.local.set({ captured: Object.fromEntries(kept) });
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
  const { scraped } = await B.storage.local.get('scraped');
  const next = { ...(scraped || {}) };
  if (trade.tradeId) next['id:' + trade.tradeId] = { at: Date.now(), detail };
  if (trade.handle) next['h:' + trade.handle.toLowerCase()] = { at: Date.now(), detail };
  const kept = Object.entries(next).sort((x, y) => y[1].at - x[1].at).slice(0, CAPTURED_CAP);
  await B.storage.local.set({ scraped: Object.fromEntries(kept) });
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

const memDetails = new Map(); // tradeId -> {at, card}
let detailsDirty = false;    // evite de reecrire ~250 fiches a chaque tour

async function loadDetailCache() {
  if (memDetails.size) return;
  const { details } = await B.storage.local.get('details');
  for (const [id, rec] of Object.entries(details || {})) memDetails.set(Number(id), rec);
}

async function saveDetailCache() {
  if (!detailsDirty) return;
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
async function makeCard(detail, kind, myId, cat, settings, { light = false } = {}) {
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
  //
  // En mode LEGER on ne les demande meme pas : le panneau de la page se pose
  // sur les vignettes que Roblox affiche deja. Les telecharger, c'est deux
  // allers-retours reseau pour rien — et c'est du temps pendant lequel l'ecart
  // ne s'affiche pas.
  const [headshot, thumbs] = light ? [null, []] : await Promise.all([
    partner.id ? safe(() => api.getUserHeadshot(partner.id), null) : null,
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
  // Une carte legere n'a pas de vignettes : la mettre en cache la servirait
  // telle quelle au popup, qui, lui, les attend.
  if (!light) {
    memDetails.set(card.tradeId, { at: Date.now(), card });
    detailsDirty = true;
  }
  return card;
}

/** Etiquette l'etape qui a echoue : sans ca, un echec est indiagnosticable. */
async function step(label, fn) {
  try { return await fn(); }
  catch (e) { throw new Error(`${label}: ${e?.message || e}`); }
}

/** Ce que la liste des trades sait deja : la v2 ne renvoie aucune date. */
async function tradeHint(tradeId) {
  const st = await getState();
  const t = ['inbound', 'outbound', 'completed']
    .flatMap(k => st.snapshot?.[k] || [])
    .find(x => Number(x.tradeId) === Number(tradeId));
  return t ? { tradeId: Number(tradeId), created: t.created, expiration: t.expiration, status: t.status, partner: t.partner } : null;
}

async function buildCard(tradeId, kind, myId, cat, settings, { force = false, hint = null } = {}) {
  await loadDetailCache();
  const cached = memDetails.get(Number(tradeId));
  if (!force && cached && (Date.now() - cached.at) < DETAIL_TTL && cached.card?.analysis) {
    return { ...cached.card, kind };
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
    if (ctx.state.tracked[id]) continue;        // le tracker s'en occupe (evite le doublon)

    const status = normStatus(t.status);
    const dir = directionOf(ctx.streams, id);
    const pid = t.user?.id;

    if (status === 'Countered') {
      if (dir === 'inbound') {
        // C'est MOI qui ai contre ce trade : mon nouveau trade envoye
        // apparaitra dans Outbound, il faudra le suivre.
        noteCounterByMe(ctx.state.myCounters, pid, id, ctx.state.links[id]?.round || 1);
      } else if (dir === 'outbound') {
        // Le partenaire a contre un trade envoye qui n'etait pas suivi.
        noteCounterFromPartner(ctx.state.counterHints, pid, id, (ctx.state.links[id]?.round || 1) + 1);
        if (pid && ctx.settings.notifyUntrackedOutbound && ctx.settings.notifyOutbound.countered) {
          ctx.pendingCountered.set(pid, stubCard(t, 'outbound_countered'));
        }
      }
      continue;
    }

    if (status === 'RejectedDueToError' || status === 'InterventionRequired') {
      if (!ctx.settings.watchRejectedError) continue;
      const card = await safe(() => buildCard(id, 'trade_error', ctx.me.id, ctx.cat, ctx.settings), null)
        || stubCard(t, 'trade_error');
      card.kind = 'trade_error';
      card.statusLabel = OUTCOMES[status].title
        + (dir === 'outbound' ? ' · trade envoyé' : dir === 'inbound' ? ' · trade reçu' : '');
      ctx.events.push(card);
      record(ctx, card, { status });
      continue;
    }

    // Declined / Expired sur un trade envoye mais non suivi
    if (dir === 'outbound' && ctx.settings.watchOutbound && ctx.settings.notifyUntrackedOutbound) {
      const info = OUTCOMES[status];
      if (!info || !ctx.settings.notifyOutbound[info.opt]) continue;
      const card = await safe(() => buildCard(id, info.kind, ctx.me.id, ctx.cat, ctx.settings), null)
        || stubCard(t, info.kind);
      card.kind = info.kind;
      card.statusLabel = info.title;
      ctx.events.push(card);
      record(ctx, card, { status });
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

    const card = await safe(() => makeCard(res.detail, info.kind, ctx.me.id, ctx.cat, ctx.settings), null)
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

/** 3) Onglet Inbound : nouveaux trades recus + rattachement des contre-offres. */
async function stepInbound(ctx) {
  const r = await pollStream('inbound', ctx.streams, { pageLimit: PAGE_LIMIT });
  ctx.snapshot.inbound = r.all.slice(0, SNAPSHOT_LIMIT).map(liteTrade);

  // Compteur exact sans appel supplementaire quand la page suffit.
  ctx.state.inboundCount = r.all.length < PAGE_LIMIT
    ? r.all.length
    : await safe(() => api.getInboundCount(), ctx.state.inboundCount ?? r.all.length);

  if (r.seeded) return;

  for (const t of r.fresh) {
    let card = await safe(() => buildCard(t.id, 'inbound', ctx.me.id, ctx.cat, ctx.settings, { force: true, hint: liteTrade(t) }), null)
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
    const kind = mine ? 'outbound_accepted' : 'completed';
    const card = await safe(() => buildCard(t.id, kind, ctx.me.id, ctx.cat, ctx.settings, { force: true, hint: liteTrade(t) }), null)
      || stubCard(t, kind);
    card.kind = kind;
    if (mine) card.statusLabel = OUTCOMES.Completed.title;
    ctx.events.push(card);
    record(ctx, card, mine ? { status: 'Completed' } : {});
  }
}

/* ============================ portefeuille ============================= */

const PORTFOLIO_TTL = 10 * 60 * 1000;   // reconciliation : 4 appels reseau
const HISTORY_TTL = 30 * 60 * 1000;     // la serie Rolimon's ne bouge qu'une fois par jour

/**
 * Les chiffres du compte : ceux de Rolimon's, la correction des visages, et
 * la serie historique. Trois cadences differentes, d'ou trois gardes de
 * fraicheur — reconstruire tout ca a chaque verification (toutes les 30 s)
 * serait une attaque en regle sur les API de Rolimon's depuis l'IP du joueur.
 */
async function refreshPortfolio(state, settings, cat, { force = false } = {}) {
  const now = Date.now();

  if (force || now - (state.portfolioAt || 0) > PORTFOLIO_TTL) {
    const report = settings.reconcilePortfolio !== false
      ? await safe(() => buildPortfolio(state.userId, cat), null)
      : null;

    if (report?.rolimons) {
      state.portfolioAt = now;
      state.portfolioPrivate = report.private;
      state.portfolioRank = report.rank;
      // `v` / `r` sont les chiffres CORRIGES : c'est ce que l'interface affiche
      // en grand. Les chiffres bruts de Rolimon's restent a cote, pour que
      // l'ecart soit lisible plutot que subi.
      state.portfolioLast = {
        v: report.value, r: report.rap, at: report.at,
        rawV: report.rolimons.value, rawR: report.rolimons.rap
      };
      const keys = portfolioThumbKeys(report);
      if (keys.length) {
        const urls = await safe(() => resolveThumbs(keys), []);
        attachPortfolioThumbs(report, urls || []);
      }
      await savePortfolioReport(report);
    } else {
      // Reconciliation coupee ou injoignable : on retombe sur le profil brut.
      const info = await safe(() => api.getPlayerInfo(state.userId), null);
      if (info) {
        state.portfolioAt = now;
        state.portfolioPrivate = info.private;
        state.portfolioRank = info.rank;
        state.portfolioLast = { v: info.value, r: info.rap, at: info.at, rawV: info.value, rawR: info.rap };
        await savePortfolioReport({
          at: now, userId: state.userId, ok: false, partial: true,
          reason: report?.reason || 'réconciliation désactivée',
          rolimons: info, ghosts: [], extras: [],
          ghostValue: 0, extraValue: 0, value: info.value, rap: info.rap, rank: info.rank
        });
      }
    }
  }

  // L'historique est une page HTML, pas une API : on l'economise.
  if (force || now - (state.historyFetchedAt || 0) > HISTORY_TTL) {
    const points = await safe(() => api.getPlayerHistory(state.userId), null);
    if (points?.length) {
      state.historyFetchedAt = now;
      state.collectibles = points[points.length - 1].n;
      await savePortfolio(points);
    }
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

    const state = await getState();

    // Le reveil du worker et l'alarme peuvent se declencher coup sur coup.
    if (reason !== 'manual' && state.lastPollAt && Date.now() - state.lastPollAt < 3000) return;
    state.lastPollAt = Date.now();

    if (state.backoffUntil && Date.now() < state.backoffUntil && reason !== 'manual') {
      await setState(state);
      return;
    }

    let me;
    try {
      me = await getMe(state);
    } catch (e) {
      state.meCheckedAt = 0;
      await handleError(e, state, settings);
      return;
    }

    const streams = await getStreams();

    if (state.userId && Number(state.userId) !== Number(me.id)) {
      // Changement de compte : on repart d'une photo vierge, sans notifier.
      await resetStreams();
      for (const k of Object.keys(streams)) delete streams[k];
      state.tracked = {}; state.counterHints = {}; state.myCounters = {}; state.links = {};
      await B.storage.local.set({ details: {}, portfolio: [], portfolioReport: null });
      state.portfolioAt = 0; state.historyFetchedAt = 0; state.portfolioLast = null;
      memDetails.clear();
      await clearThumbs();
    }
    state.userId = me.id;
    state.userName = me.displayName || me.name;
    state.lastError = null;
    state.backoffUntil = 0;
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
        await handleError(e, state, settings);
      }
    }

    // Contres non rattaches a une contre-offre entrante : on notifie a part.
    for (const card of ctx.pendingCountered.values()) ctx.events.push(card);

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
    await setState(state);
    await saveStreams(streams);
    await setBadge(state.inboundCount, settings, false);

    // Portefeuille : chiffres du moment, reconciliation, historique Rolimon's.
    if (settings.useRolimons && settings.trackPortfolio) {
      await refreshPortfolio(state, settings, ctx.cat);
      await setState(state);
    }
    await saveDetailCache();
    await flushThumbs({ force: true });
  } catch (e) {
    console.error('[RoNote] tick:', e);
  } finally {
    runningSince = 0;
    if (settings) scheduleSoftTick(settings);
  }
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

async function handleError(e, state, settings) {
  const err = e instanceof ApiError ? e : new ApiError(String(e?.message || e), 0);
  state.lastError = { message: err.message, status: err.status, at: Date.now() };

  if (err.isAuth) {
    state.lastError.message = t('Non connecté à Roblox (cookie de session introuvable).');
    state.meCheckedAt = 0;
    state.backoffUntil = Date.now() + 60000;
    if (Date.now() - authWarnedAt > 30 * 60000) {
      authWarnedAt = Date.now();
      await notifySystem(t('RoNote : connexion requise'),
        t('Connecte-toi sur roblox.com dans ce navigateur, puis ouvre un onglet Roblox. La surveillance reprendra automatiquement.'));
    }
  } else if (err.isRate) {
    state.backoffUntil = Date.now() + Math.max(60, err.retryAfter || 0) * 1000;
  } else {
    const prev = state.backoffUntil && state.backoffUntil > Date.now() ? state.backoffUntil - Date.now() : 15000;
    state.backoffUntil = Date.now() + Math.min(5 * 60000, prev * 2);
  }
  await setState(state);
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
  const st = await getState();
  const rec = st.notifMap?.[id];
  const settings = await getSettings();
  if (rec?.url && settings.openOnClick) await openUrl(rec.url);
  await safe(() => B.notifications.clear(id));
});

B.notifications.onButtonClicked?.addListener(async (id, idx) => {
  const st = await getState();
  const rec = st.notifMap?.[id];
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

B.notifications.onClosed?.addListener(async (id) => {
  const st = await getState();
  if (st.notifMap?.[id]) { delete st.notifMap[id]; await setState(st); }
});

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

async function handleMessage(msg) {
  switch (msg.type) {
    case 'ronote:get': {
      const [settings, state, history] = await Promise.all([getSettings(), getState(), getHistory()]);
      const streams = await getStreams();
      return {
        settings, state, history: history.slice(0, 100),
        portfolio: await getPortfolio(),
        report: await getPortfolioReport(),
        counts: Object.fromEntries(Object.entries(streams).map(([k, v]) => [k, v?.seen?.length || 0])),
        watermarks: Object.fromEntries(Object.entries(streams).map(([k, v]) => [k, v?.watermark || 0])),
        belowMark: Object.fromEntries(Object.entries(streams).map(([k, v]) => [k, v?.belowMark || 0]))
      };
    }
    case 'ronote:refresh':
      await tick('manual');
      return { settings: await getSettings(), state: await getState() };

    case 'ronote:hydrate': {
      const settings = await getSettings();
      const state = await getState();
      if (!state.userId) return { cards: [] };
      const cat = await getCatalog(settings);
      const cards = [];
      const failed = [];
      for (const id of (msg.ids || []).slice(0, SNAPSHOT_LIMIT)) {
        try {
          cards.push(await buildCard(id, msg.kind || 'inbound', state.userId, cat, settings));
        } catch (e) {
          // Un detail illisible ne doit JAMAIS faire disparaitre le trade de la
          // liste : on remonte l'echec, le popup affichera la carte en mode
          // degrade avec la raison.
          failed.push({ tradeId: Number(id), error: String(e?.message || e) });
        }
      }
      await saveDetailCache();
      await flushThumbs();
      return { cards, failed, links: state.links, tracked: state.tracked };
    }
    case 'ronote:portfolio': {
      const settings = await getSettings();
      const state = await getState();
      if (!state.userId) return { error: 'non connecté' };
      await refreshPortfolio(state, settings, await getCatalog(settings), { force: true });
      await setState(state);
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
        const state = await getState();
        const streams = await getStreams();

        // Notre propre annulation va reapparaitre en « Declined » sur le flux
        // Inactive : on la marque deja vue, sinon on s'alerte soi-meme.
        markSeen(streams, 'inactive', [id]);
        markSeen(streams, 'completed', [id]);
        delete state.tracked[id];

        for (const kind of ['inbound', 'outbound']) {
          const list = state.snapshot?.[kind];
          if (Array.isArray(list)) {
            state.snapshot[kind] = list.filter(t => Number(t.tradeId) !== id);
          }
        }
        if (state.inboundCount > 0 && (msg.kind === 'inbound' || msg.kind === 'counter')) {
          state.inboundCount -= 1;
        }
        memDetails.delete(id);
        detailsDirty = true;

        await setState(state);
        await saveStreams(streams);
        await saveDetailCache();
        await setBadge(state.inboundCount, await getSettings(), false);
        await pushHistory([{
          at: Date.now(), kind: 'declined_by_me', tradeId: id,
          partner: msg.partner || '?', notified: false,
          skipped: msg.kind === 'inbound' || msg.kind === 'counter' ? 'refusé depuis RoNote' : 'annulé depuis RoNote'
        }]);
        return { ok: true, via: res.via, state };
      } catch (e) {
        return { error: String(e?.message || e) };
      }
    }

    case 'ronote:track': {
      const state = await getState();
      const id = Number(msg.tradeId);
      if (msg.on === false) delete state.tracked[id];
      else state.tracked[id] = { at: Date.now(), partner: msg.partner || null, auto: false, counterTo: null, round: 1 };
      await setState(state);
      return { tracked: state.tracked };
    }
    case 'ronote:settings': {
      const settings = await saveSettings(msg.patch || {});
      setLang(settings.lang);
      await configureAlarm(settings);
      await setBadge((await getState()).inboundCount, settings, false);
      if (msg.patch?.enabled) tick('settings');
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
      const state = await getState();
      state.tracked = {}; state.counterHints = {}; state.myCounters = {}; state.links = {};
      await setState(state);
      await resetStreams();
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
