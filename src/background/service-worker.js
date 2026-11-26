import { B, safe } from '../common/shim.js';
import * as api from '../common/api.js';
import { ApiError } from '../common/api.js';
import {
  getSettings, saveSettings, replaceSettings, adoptSyncedSettings, getState, setState, getStreams, saveStreams,
  pushHistory, getHistory, clearHistory, getPortfolio, savePortfolio,
  getPortfolioReport, savePortfolioReport
} from '../common/state.js';
import { getCatalog, readEntry } from '../common/roli.js';
import { pageDetail, analyzePage, capturedForPage, resolveNames, findByName, addKnownInstances } from '../common/page-trade.js';
import { setLang, t } from '../common/i18n.js';
import { pullSettings, isSettingsChange, notifiedElsewhere, shareNotifs, closedElsewhere, leaveSync } from '../common/sync.js';
import { NEURONAL } from '../common/defaults.js';
import { thumbKeysFor, resolveItem } from '../common/analysis.js';
import { resolveThumbs, flushThumbs, clearThumbs, assetKey, bundleKey } from '../common/thumbs.js';
import { buildPortfolio, portfolioThumbKeys, attachPortfolioThumbs } from '../common/portfolio.js';
import { detectRevaluations, newestRevision } from '../common/revalue.js';
import { passesFilters } from '../common/filters.js';
import { historyFor, thinSeries, playerFaces, partnerTimeline, partnerStats } from '../common/player.js';
import { eachLimit, inQuietHours, newestEntries, serialQueue } from '../common/utils.js';
import { pollStream, markSeen, directionOf } from './streams.js';
import { neuronalPlayerTrades, neuronalLookup, neuronalProfiles, neuronalDeals, neuronalBestPrices, neuronalDemand, shareWithNeuronal, neuronalExternal, syncHelloScript, neuronalForget, neuronalWatch } from './neuronal.js';
import { premiumStatus, premiumConnect, premiumKey, premiumLink, premiumVerify, premiumRobloxOAuth, premiumCancel, premiumLogout, premiumShowcase, premiumGet, premiumHeaders } from './premium.js';
import { proofPrepare, proofShare, proofSave } from './proof.js';
import { recordSent, sentHistory, clearSent } from './sent.js';
import { roliDeals } from './roli-deals.js';
import { checkWatchlist, readWatchPrices, watchKey, WATCH_MAX } from './watchlist.js';
import { ALARM as TRADEADS_ALARM, tradeAdsStatus, saveTradeAds, scheduleTradeAds, runTradeAds, tradeAdsLogin, onTradeAdsTab, drawTradeAds, relayPush, relayPull, getConfig as getTradeAdsConfig } from './tradeads.js';
import {
  resolveTracked, normStatus, OUTCOMES,
  noteCounterFromPartner, noteCounterByMe, takeHint, purgeHints
} from './tracker.js';
import {
  notifyTrade, notifySummary, notifyRevaluations, notifySystem, playSound, playSoundsFor, setBadge,
  notifTarget, forgetNotif
} from './notifier.js';
import {
  buildCard, makeCard, stubCard, safeCard, liteTrade, snapshotHints, cleanTradeId,
  loadDetailCache, saveDetailCache, saveDetailCacheSoon, forgetCard, resetCards, knownDetails, cachedDetail,
  rememberCapturedTrade, rememberScrapedTrade, getCapturedTrade, getScrapedTrade
} from './cards.js';

const ALARM = 'ronote:poll';
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
const ROUTILITY_RULE_ID = 2;
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
      removeRuleIds: [HEADER_RULE_ID, ROUTILITY_RULE_ID],
      addRules: [{
        // RoUtility (mise à jour du 20 nov.) : ses écritures refusent une `Origin` qui n'est pas la sienne.
        // Seulement nos requêtes hors onglet : la page du site, elle, n'est jamais touchée.
        id: ROUTILITY_RULE_ID,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'origin', operation: 'set', value: 'https://routility.io' },
            { header: 'referer', operation: 'set', value: 'https://routility.io/trade-ads/create' }
          ]
        },
        condition: { requestDomains: ['routility.io'], tabIds: [-1], resourceTypes: ['xmlhttprequest'] }
      }, {
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

/**
 * Rolimon's sans pubs (24 nov.) : le script n'est enregistré que si l'option est active, pour qu'il
 * passe avant la page (monde MAIN, document_start) sans attendre la lecture des réglages.
 */
const ADFREE_ID = 'ronote-rolimons-adfree';
async function syncAdFree(settings) {
  const sc = B.scripting;
  if (!sc?.registerContentScripts) return;
  const have = (await sc.getRegisteredContentScripts({ ids: [ADFREE_ID] }).catch(() => [])).length > 0;
  const want = !!settings?.rolimonsAdFree;
  if (want && !have) {
    await sc.registerContentScripts([{ id: ADFREE_ID, matches: ['https://www.rolimons.com/*'], js: ['content/rolimons-adfree.js'],
      runAt: 'document_start', world: 'MAIN', allFrames: false, persistAcrossSessions: true }]).catch(() => {});
  } else if (!want && have) {
    await sc.unregisterContentScripts({ ids: [ADFREE_ID] }).catch(() => {});
  }
}

/* =========================== cycle de vie ============================== */

B.runtime.onInstalled.addListener(async (details) => {
  await installHeaderRules();
  await safe(syncHelloScript);
  const settings = await getSettings();
  setLang(settings.lang);
  await configureAlarm(settings);
  await applySidePanel(settings);
  await safe(() => syncAdFree(settings));
  // Les alarmes ne survivent pas toujours à une mise à jour de l'extension : sans ça, l'auto-post s'arrêtait en silence.
  await safe(() => scheduleTradeAds());
  if (details.reason === 'update') await safe(refreshRobloxTabs);
  await safe(syncFromCloud);
  // Première installation : la page d'accueil (merci + comment épingler l'icône) remplace la notification.
  if (details.reason === 'install') {
    const opened = await safe(() => B.tabs.create({ url: B.runtime.getURL('welcome/welcome.html') }), null);
    if (!opened) await notifySystem(t('RoNote est installé'),
      t('Ouvre roblox.com et connecte-toi : la surveillance démarre toute seule. Les trades déjà présents ne déclencheront aucune alerte.'));
  }
  // Restes de la courbe « bundles comptés », retirée avant publication : les
  // corrections mesurées et la reconstruction des visages ne servent plus.
  await safe(() => B.storage.local.remove(['portfolioCorr', 'faceScan', 'faceLedger', 'faceHistory', 'portfolioCorrSeries']));
  tick('installed');
});

B.runtime.onStartup?.addListener(async () => {
  await installHeaderRules();
  await safe(syncHelloScript);
  const settings = await getSettings();
  await configureAlarm(settings);
  await applySidePanel(settings);
  await safe(() => syncAdFree(settings));
  await safe(() => scheduleTradeAds());
  await safe(syncFromCloud);
  tick('startup');
});

/**
 * Après une mise à jour, les onglets roblox.com gardent l'ancien script, coupé de l'extension : plus de
 * values ni de boutons jusqu'au F5. Les onglets en arrière-plan sont rechargés tout de suite ; l'onglet
 * qu'on regarde (un trade peut être en cours) reçoit seulement un bandeau « Recharger ».
 */
async function refreshRobloxTabs() {
  const tabs = await B.tabs.query({ url: 'https://www.roblox.com/*' });
  const msg = t('RoNote vient de se mettre à jour.'), btn = t('Recharger la page');
  for (const tab of tabs) {
    if (!tab.active && !tab.audible) { await safe(() => B.tabs.reload(tab.id)); continue; }
    await safe(() => B.scripting.executeScript({
      target: { tabId: tab.id },
      args: [msg, btn],
      func: (msg, btn) => {
        if (document.getElementById('ronote-updated')) return;
        const d = document.createElement('div');
        d.id = 'ronote-updated';
        d.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;display:flex;gap:10px;align-items:center;padding:10px 14px;border-radius:12px;background:#15171c;color:#fff;font:600 13px system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.35)';
        d.textContent = msg;
        const b = document.createElement('button');
        b.textContent = btn;
        b.style.cssText = 'border:0;border-radius:8px;padding:6px 10px;background:#3b82f6;color:#fff;font:inherit;cursor:pointer';
        b.onclick = () => location.reload();
        const x = document.createElement('button');
        x.textContent = '×';
        x.style.cssText = 'border:0;background:none;color:#aaa;font:inherit;font-size:16px;cursor:pointer';
        x.onclick = () => d.remove();
        d.append(b, x);
        document.documentElement.appendChild(d);
      }
    }));
  }
}

/* ============================ barre laterale =========================== */

// Comme Phantom : au lieu du popup, l'icone ouvre RoNote dans une barre sur le
// cote, qui reste ouverte pendant la navigation. Chrome a son API `sidePanel`
// (l'icone l'ouvre d'elle-meme), Firefox sa `sidebarAction` qu'on bascule au
// clic. Dans les deux cas le popup doit etre retire, sinon il passe devant.
const POPUP = 'popup/popup.html';
const PANEL = 'popup/popup.html?panel=1';

async function applySidePanel(settings) {
  const on = !!settings.sidePanel;
  await safe(() => B.action.setPopup({ popup: on ? '' : POPUP }));
  if (globalThis.chrome?.sidePanel) {
    await safe(() => chrome.sidePanel.setOptions({ path: PANEL, enabled: true }));
    await safe(() => chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: on }));
  }
}

// Firefox : le clic n'arrive ici que si le popup est retire, donc barre
// laterale active. `toggle()` exige le geste de l'utilisateur : aucun await avant.
B.action.onClicked.addListener(() => { B.sidebarAction?.toggle(); });

B.alarms.onAlarm.addListener(a => {
  if (a.name === ALARM) tick('alarm');
  if (a.name === TRADEADS_ALARM) postTradeAds();
});
// La fenêtre « Se connecter avec Roblox » des trade ads (tradeads.js) : refermée quand le site a repris la main.
B.tabs?.onUpdated?.addListener((tabId, info) => { onTradeAdsTab(tabId, info).catch(() => {}); });

/** Ce que les tirages des trade ads lisent : l'inventaire du portefeuille et, pour la demande aléatoire, le catalogue en cache. */
async function tradeAdsInputs({ pool = false } = {}) {
  const [state, report] = await Promise.all([getState(), getPortfolioReport()]);
  const inventaire = (report?.items || []).map(i => ({ id: i.kind === 'bundle' ? i.faceAssetId : i.id, value: i.value, name: i.name, projected: i.projected })).filter(i => i.id > 0);
  const offerable = inventaire.length ? new Set(inventaire.map(i => i.id)) : null;
  // Aucune requête en plus : la table Rolimon's déjà en cache, sans projected, œuf, ni item sans vraie value.
  let demandables = null;
  if (pool || (await getTradeAdsConfig()).reqAlea) {
    const cat = await safe(async () => getCatalog(await getSettings()), null);
    if (cat?.ready) {
      demandables = [];
      for (const [id, entry] of Object.entries(cat.assets || {})) {
        const e = readEntry(entry);
        if (e && !e.noValue && !e.projected && !/\begg/i.test(e.name || '')) demandables.push({ id: Number(id), value: e.value });
      }
    }
  }
  return { me: Number(state.userId) || 0, inventaire, offerable, demandables };
}

/** Un tour d'auto-post (tradeads.js) : le compte suivi, et seulement les items encore dans l'inventaire. */
async function postTradeAds(force = false) {
  return runTradeAds({ ...(await tradeAdsInputs()), force });
}

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

/* ============================== journal ================================ */

function record(ctx, card, extra = {}) {
  ctx.history.push({
    at: Date.now(), kind: card.kind, tradeId: card.tradeId, uid: ctx.me?.id ?? null,
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

/**
 * La carte d'un evenement : evaluee si possible, minimale sinon. Le type vient
 * de l'evenement, pas du cache : un trade recu puis termine garde sa fiche.
 */
async function eventCard(ctx, t, kind, opts = {}) {
  const card = await safeCard(() => buildCard(t.id, kind, ctx.me.id, ctx.cat, ctx.settings, opts), null)
    || stubCard(t, kind);
  card.kind = kind;
  return card;
}

/**
 * L'issue d'un trade envoye merite-t-elle une alerte ? Un suivi pose a la main
 * previent toujours ; l'auto-suivi et les non-suivis suivent les reglages.
 */
function wantsOutcome(ctx, meta, opt) {
  const on = ctx.settings.notifyOutbound[opt];
  return meta ? (!meta.auto || on) : (ctx.settings.notifyUntrackedOutbound && on);
}

/** La negociation dont le trade fait partie : a quel trade il repond, a quel tour. */
const withRound = (card, meta) => Object.assign(card, { counterTo: meta?.counterTo || null, round: meta?.round || 1 });

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
        // Le partenaire a contre un trade envoye.
        noteCounterFromPartner(ctx.state.counterHints, pid, id, (meta?.round || ctx.state.links[id]?.round || 1) + 1);
        if (pid && wantsOutcome(ctx, meta, 'countered')) {
          ctx.pendingCountered.set(pid, withRound(stubCard(t, 'outbound_countered'), meta));
        }
      }
      continue;
    }

    if (status === 'RejectedDueToError' || status === 'InterventionRequired') {
      if (!ctx.settings.watchRejectedError) continue;
      const card = await eventCard(ctx, t, 'trade_error');
      card.statusLabel = OUTCOMES[status].title
        + (dir === 'outbound' ? ' · trade envoyé' : dir === 'inbound' ? ' · trade reçu' : '');
      ctx.events.push(card);
      record(ctx, card, { status });
      continue;
    }

    // Declined / Expired sur un trade envoye : suivi a la main, auto-suivi ou
    // pas suivi du tout : chacun ses regles, une seule notification.
    if (dir === 'outbound' && ctx.settings.watchOutbound) {
      const info = OUTCOMES[status];
      if (!info) continue;
      if (!wantsOutcome(ctx, meta, info.opt)) continue;
      const card = withRound(await eventCard(ctx, t, info.kind), meta);
      card.statusLabel = info.title;
      ctx.events.push(card);
      record(ctx, card, { status, tracked: !!meta });
    }
  }
}

/** 2) Onglet Outbound : auto-suivi des nouveaux envois + resolution des suivis. */
async function stepOutbound(ctx) {
  const trackedCount = Object.keys(ctx.state.tracked).length;
  const r = await pollStream('outbound', ctx.streams, { pageLimit: trackedCount ? 100 : PAGE_LIMIT });
  // Un envoi tout juste fait (afterSend) que Roblox ne liste pas encore reste affiché une minute.
  const listedIds = new Set(r.all.map(t => Number(t.id)));
  const justSent = (ctx.snapshot.outbound || []).filter(t => t.pending && !listedIds.has(Number(t.tradeId))
    && Date.now() - Date.parse(t.created || 0) < 60e3);
  ctx.snapshot.outbound = [...justSent, ...r.all.slice(0, SNAPSHOT_LIMIT).map(liteTrade)];
  const openIds = new Set(r.all.map(t => Number(t.id)));

  // --- nouveaux trades envoyes ---
  if (!r.seeded && r.fresh.length) {
    // Un joueur « à envoyer plus tard » à qui on vient d'envoyer un trade sort de la liste.
    const sentTo = new Set(r.fresh.map(t => Number(t.user?.id)).filter(Boolean));
    const settings = await getSettings();
    const keep = settings.laterUsers.filter(u => !sentTo.has(Number(u.id)));
    if (keep.length !== settings.laterUsers.length) await saveSettings({ laterUsers: keep });
  }
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

    const card = withRound(await safeCard(() => makeCard(res.detail, info.kind, ctx.me.id, ctx.cat, ctx.settings), null)
      || stubCard({ id: res.tradeId, user: meta.partner, status: res.status }, info.kind), meta);
    card.kind = info.kind;
    card.statusLabel = info.title;
    record(ctx, card, { status: res.status, tracked: true });

    if (res.status === 'Countered') {
      // On attend de voir si la contre-offre arrive dans le meme passage :
      // une seule notification vaut mieux que deux pour le meme evenement.
      const pid = card.partner?.id;
      noteCounterFromPartner(ctx.state.counterHints, pid, res.tradeId, (meta.round || 1) + 1);
      if (pid && wantsOutcome(ctx, meta, 'countered')) ctx.pendingCountered.set(pid, card);
      else if (!pid) ctx.events.push(card);
      continue;
    }
    if (wantsOutcome(ctx, meta, info.opt)) ctx.events.push(card);
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
    const card = await eventCard(ctx, t, 'inbound', { force: true, hint: liteTrade(t) });

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
    // accepte » : pas un simple « trade complete » : le titre, le son et le
    // point de vue (tu as recu / tu as donne) de la notification changent.
    const mine = directionOf(ctx.streams, t.id) === 'outbound';
    // Meme raison qu'en Inactifs : la liste dit que c'est fini, le tracker n'a
    // plus a en demander le detail : et ne notifiera donc pas une seconde fois.
    delete ctx.state.tracked[t.id];
    const kind = mine ? 'outbound_accepted' : 'completed';
    const card = await eventCard(ctx, t, kind, { force: true, hint: liteTrade(t) });
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
const PROFILE_ITEMS = 60;                      // objets gardés pour l'aperçu d'inventaire d'un profil
const PLAYER_HISTORY_TTL = 6 * 60 * 60 * 1000; // courbe d'inventaire d'un joueur (page Rolimon's)
const PLAYER_HISTORY_CAP = 10;                 // joueurs dont la courbe reste en cache
const PLAYER_HISTORY_POINTS = 400;             // releves gardes par courbe
const PORTFOLIO_RETRY = 5 * 60 * 1000;         // apres un echec, sans attendre la fraicheur complete

/**
 * Les chiffres du compte : ceux de Rolimon's avec la liste des objets, et la
 * serie historique. Deux cadences differentes, d'ou deux gardes de
 * fraicheur : reconstruire tout ca a chaque verification (toutes les 30 s)
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

    if (report?.rolimons || report?.estimated) {
      // Total estime (profil injoignable) : affiche, mais le profil est
      // redemande dans 5 min plutot que 10 ; le rang connu reste en place.
      state.portfolioAt = report.estimated ? now - PORTFOLIO_TTL + PORTFOLIO_RETRY : now;
      state.portfolioPrivate = report.private;
      if (!report.estimated) state.portfolioRank = report.rank;
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
      // prochain terme normal : la redemander plus tot ne la remplirait pas.
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

/**
 * Changement de compte : on repart d'une photo vierge, sans notifier. Les
 * flux effaces se reprennent en silence au passage suivant (`seeded`).
 */
async function forgetAccount(state, streams) {
  for (const k of Object.keys(streams)) delete streams[k];
  state.tracked = {}; state.counterHints = {}; state.myCounters = {}; state.links = {};
  await B.storage.local.set({ details: {}, portfolio: [], portfolioReport: null });
  state.portfolioAt = 0; state.historyFetchedAt = 0; state.historyLastAt = 0; state.chartScannedAt = 0;
  state.portfolioLast = null; state.portfolioRank = 0; state.collectibles = 0;
  state.revalSince = 0;
  state.inboundCount = 0; state.inboundPage = ''; state.inboundCountAt = 0;
  resetCards();
  await clearThumbs();
}

const ACCOUNTS_CAP = 8;   // comptes retenus pour le menu du popup

/**
 * Le compte connecte, et la liste des comptes deja vus sur ce navigateur :
 * le menu du popup les propose (pseudo, portrait), sans jamais garder de
 * cookie ni de jeton : la bascule elle-meme se fait sur roblox.com.
 */
async function setIdentity(state, me) {
  state.userId = me.id;
  state.userName = me.displayName || me.name;
  state.userLogin = me.name || state.userLogin || '';
  const prev = (state.accounts || []).find(a => Number(a.id) === Number(me.id));
  // Identite gardee en memoire : rien de neuf a apprendre, sauf au premier passage.
  if (me.cached && prev) return;
  const avatar = await safe(() => api.getUserHeadshot(me.id), null) || prev?.avatar || null;
  state.userAvatar = avatar;
  const entry = { id: Number(me.id), name: state.userLogin, displayName: me.displayName || me.name || '', avatar, at: Date.now() };
  state.accounts = [entry, ...(state.accounts || []).filter(a => Number(a.id) !== Number(me.id))].slice(0, ACCOUNTS_CAP);
}

/** Apres un changement de compte : photo silencieuse des flux sans attendre la cadence. */
let reseedTimer = null;
function reseedSoon() {
  clearTimeout(reseedTimer);
  reseedTimer = setTimeout(() => tick('account'), 3500);
}

async function getMe(state) {
  if (state.userId && Date.now() - (state.meCheckedAt || 0) < ME_TTL) {
    return { id: state.userId, name: state.userLogin || state.userName, displayName: state.userName, cached: true };
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

/** @param edit (state, streams, replay) => void : doit pouvoir etre rejouee */
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
    // c'est tout l'interet du bouton. Mais pas outre une limite de debit :     // relancer un cycle complet pendant qu'elle court ne fait que la
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

    if (state.userId && Number(state.userId) !== Number(me.id)) await forgetAccount(state, streams);
    await setIdentity(state, me);
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
      // commence a produire : le prochain passage reprendra tout proprement.
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

    // UN AUTRE COMPTE, MEME NAVIGATEUR. L'identite n'est redemandee que toutes
    // les 15 min : entre-temps, un changement de compte sur roblox.com faisait
    // lire les listes du NOUVEAU compte avec les ids deja vus de l'ANCIEN :     // chaque trade y passait pour neuf, et partait en notification. Avant de
    // prevenir de quoi que ce soit avec une identite gardee en memoire, on la
    // reverifie (un appel, seulement quand il y a du neuf). Si le compte a
    // change, rien n'est notifie : les flux repartent d'une photo silencieuse.
    if (me.cached && (ctx.events.length || ctx.history.length || ctx.pendingCountered.size)) {
      const real = await safe(() => api.getAuthenticatedUser(), null);
      if (real?.id) state.meCheckedAt = Date.now();
      if (real?.id && Number(real.id) !== Number(me.id)) {
        await forgetAccount(state, streams);
        await setIdentity(state, real);
        state.snapshot = { inbound: [], completed: [], outbound: [], at: 0 };
        await commitStore(state, streams);
        await setBadge(0, settings, false);
        reseedSoon();
        return;
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
    // Contribution au réseau Neuronal (option) : rien que du déjà lu, voir neuronal.js.
    if (settings.neuronalShare) {
      await safe(() => shareWithNeuronal({
        settings, me, portfolio: state.portfolioLast, detailOf: cachedDetail,
        completed: (state.snapshot?.completed || []).map(t => t.tradeId)
      }));
    }
    await flushThumbs({ force: true });
    await refreshLuckyCat(settings);
    await safe(() => checkWatchlist(settings));     // watchlist : une requête catalogue toutes les 2 min au plus
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

/* ===================== un trade envoyé, tout de suite ===================== */

/**
 * 26 nov. : un trade envoyé (depuis RoNote ou depuis roblox.com) n'apparaissait dans « Envoyés » qu'à la
 * vérification suivante, jusqu'à 30 s plus tard. Il y entre maintenant à l'instant (ligne provisoire, que
 * le popup complète par `ronote:hydrate`), puis une vérification part 1,5 s après, le temps que Roblox
 * l'inscrive dans sa liste, et une seconde à +6 s s'il n'y est pas encore. Deux lectures au plus par
 * envoi : rien de plus que si l'utilisateur cliquait « vérifier ».
 */
const sentFollow = new Set();
async function afterSend(tradeId, partner = null) {
  const id = Number(tradeId);
  if (!id) return null;
  const state = await editStore((st, streams) => {
    markSeen(streams, 'outbound', [id]);
    st.snapshot ||= { inbound: [], completed: [], outbound: [], at: 0 };
    const list = Array.isArray(st.snapshot.outbound) ? st.snapshot.outbound : [];
    if (!list.some(t => Number(t.tradeId) === id)) {
      st.snapshot.outbound = [{ tradeId: id, partner: partner?.id ? { id: Number(partner.id), name: partner.name || '', displayName: partner.displayName || partner.name || '' } : null,
        created: new Date().toISOString(), expiration: null, status: 'Open', pending: true }, ...list];
    }
  });
  if (sentFollow.has(id)) return state;
  sentFollow.add(id);
  const listed = async () => ((await getState()).snapshot?.outbound || []).some(t => Number(t.tradeId) === id && !t.pending);
  setTimeout(async () => {
    await safe(() => tick('manual'));
    if (!await safe(listed, true)) setTimeout(() => { safe(() => tick('manual')); sentFollow.delete(id); }, 6000);
    else sentFollow.delete(id);
  }, 1500);
  return state;
}

/* ======================= synchro entre appareils ======================= */

/** Reglages modifies sur un autre appareil : adoptes ici, puis appliques comme apres un import. */
async function syncFromCloud() {
  const merged = await pullSettings(await getSettings());
  if (!merged) return;
  const settings = await adoptSyncedSettings(merged);
  setLang(settings.lang);
  await configureAlarm(settings);
  await applySidePanel(settings);
  await safe(() => syncAdFree(settings));
  await setBadge((await getState()).inboundCount, settings, false);
}

B.storage.onChanged?.addListener(async (changes, areaName) => {
  if (isSettingsChange(changes, areaName)) await safe(syncFromCloud);
  for (const id of await safe(() => closedElsewhere(changes, areaName), [])) {
    await safe(() => B.notifications.clear(id));
  }
});

const notifIdOf = (card) => `ronote:${card.kind}:${card.tradeId}`;

/** Envoi groupe : au-dela du plafond, une notification resume par type. */
async function emit(ctx) {
  if (!ctx.events.length) return;
  // Un trade deja notifie par un autre de mes appareils ne sonne pas une seconde fois ici.
  const elsewhere = await safe(() => notifiedElsewhere(ctx.settings), new Set());
  const events = ctx.events.filter(c => !c.tradeId || !elsewhere.has(notifIdOf(c)));
  if (!events.length) return;
  await safe(() => shareNotifs(events.filter(c => c.tradeId).map(notifIdOf), ctx.settings));
  // Le son part tout de suite, en parallele des notifications : il n'attend
  // ni le telechargement d'un portrait ni l'ecriture de l'etat. Pas de son
  // pendant les heures silencieuses, meme si les notifications restent.
  const sound = inQuietHours(ctx.settings.quietHours)
    ? null
    : playSoundsFor(events, ctx.settings).catch(() => 0);
  const max = Math.max(1, ctx.settings.maxNotificationsPerPoll || 5);
  const byKind = new Map();
  for (const card of events) {
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
  await safe(() => shareNotifs([id], settings, true));
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

B.notifications.onClosed?.addListener(async (id, byUser) => {
  await forgetNotif(id);
  // Fermee a la main ici : elle disparait aussi de mes autres appareils.
  if (byUser && id.startsWith('ronote:')) await safe(async () => shareNotifs([id], await getSettings(), true));
});

/* ============================ messages ================================= */

B.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (typeof msg?.type !== 'string' || !msg.type.startsWith('ronote:')) return;
  if (msg.type === 'ronote:play-sound') return; // destine au document offscreen
  (async () => {
    try { sendResponse(await handleMessage(msg, _sender)); }
    catch (e) { sendResponse({ error: String(e?.message || e) }); }
  })();
  return true;
});

// Permission sur neuronal.live accordée ou rendue : le script Firefox de la page suit.
B.permissions?.onAdded?.addListener(async (perm) => {
  await safe(syncHelloScript);
  // « Contribuer » cliqué dans le popup il y a moins de 2 min : Firefox a pu le
  // fermer sur la boîte de permission avant qu'il enregistre la réponse.
  const s = await getSettings();
  if (s.neuronalJoinAt > Date.now() - 120e3 && (perm?.origins || []).some(o => NEURONAL.origins.includes(o))) {
    await saveSettings({ neuronalShare: true, neuronalLookup: true, neuronalAsked: true, neuronalJoinAt: 0 });
  }
});
B.permissions?.onRemoved?.addListener(() => safe(syncHelloScript));

// La page neuronal.live/ronote (Chrome seulement, voir neuronal.js) : rien
// d'autre que « RoNote est-il là ? » et « ouvre les réglages Neuronal ».
B.runtime.onMessageExternal?.addListener((msg, sender, sendResponse) => {
  (async () => {
    const openSettings = (hash) => B.tabs.create({ url: B.runtime.getURL(`options/options.html#${hash}`) });
    const settings = await getSettings();
    sendResponse(await safe(() => neuronalExternal(msg, sender, settings, openSettings), null));
  })();
  return true;
});

/**
 * Les fiches lues a la demande (historique d'un objet, courbe et bundles d'un
 * joueur) : gardees sous `key`, les `cap` plus recentes, et resservies telles
 * quelles pendant `ttl`. La source injoignable, l'ancienne copie vaut mieux
 * que rien : elle revient marquee `stale`.
 */
async function readThrough({ key, id, field, as = field, ttl, cap, keep = () => true }, fetch) {
  const { [key]: stored } = await B.storage.local.get(key);
  const cache = stored || {};
  const hit = cache[id];
  if (hit && Date.now() - hit.at < ttl) return { [as]: hit[field] };
  try {
    const value = await fetch();
    if (keep(value)) {
      await B.storage.local.set({ [key]: newestEntries({ ...cache, [id]: { at: Date.now(), [field]: value } }, cap) });
    }
    return { [as]: value };
  } catch (e) {
    return hit ? { [as]: hit[field], stale: true } : { error: String(e?.message || e) };
  }
}

/**
 * La carte d'un profil Roblox (content/profile-card.js) : value, RAP et rang
 * Rolimon's, ses limiteds les plus chers (vignettes comprises) et son Discord
 * s'il a choisi de le montrer. Deux appels Rolimon's en parallèle, les
 * vignettes en un lot, le tout gardé 30 min : revenir sur un profil ne coûte rien.
 */
async function profileCard(id, settings) {
  const [info, assets, cat, neuronal, roblox] = await Promise.all([
    api.getPlayerInfo(id),
    api.getPlayerAssets(id).catch(() => null),
    getCatalog(settings),
    profileNeuronal(id),
    api.getUserProfile(id).catch(() => null)
  ]);
  const items = [];
  let count = 0;
  for (const [assetId, n] of Object.entries(assets?.counts || {})) {
    if (!(n > 0)) continue;
    count += n;
    const it = resolveItem({ assetId: Number(assetId) }, cat);
    if (it.unknown) continue;
    items.push({ ...it, n, worth: (it.noValue ? 0 : it.value) || it.rap || 0 });
  }
  items.sort((a, b) => b.worth - a.worth);
  const top = items.slice(0, PROFILE_ITEMS);
  const urls = await safe(() => resolveThumbs(top.map(thumbKeysFor)), []);
  await flushThumbs();
  return {
    value: info.value, rap: info.rap, rank: info.rank, private: info.private || !!assets?.private,
    terminated: info.terminated, lastOnline: info.lastOnline, scannedAt: info.scannedAt,
    count, kinds: items.length, discord: neuronal?.discord || null, tier: neuronal?.tier || null,
    created: roblox?.created || 0, verified: !!roblox?.verified,
    items: top.map((it, i) => ({
      name: it.name || '', acro: it.acronym || '', value: it.noValue ? 0 : it.value || 0, rap: it.rap || 0,
      n: it.n, projected: !!it.projected, rare: !!it.rare, thumb: urls?.[i] || '',
      url: it.bundleId ? api.BUNDLE_URL(it.bundleId) : api.ASSET_URL(it.legacyAssetId || it.assetId)
    }))
  };
}

/**
 * Ton propre profil : ton Discord et ton rang viennent de ta session RoNote
 * premium (déjà en local), sans attendre Neuronal ni l'option publique.
 */
async function selfPremium(id, card) {
  const me = (await premiumGet())?.me;
  if (!me?.roblox || Number(me.roblox.id) !== id) return {};
  const keys = new Set((me.services || []).map(s => s.key));
  const tier = keys.has('bundle') ? 'elite' : keys.has('discovery') ? 'insider' : keys.has('tracking') ? 'tracker' : null;
  const discord = card.discord || (me.discord?.id ? { id: String(me.discord.id), name: String(me.discord.name || ''), username: '', avatar: '' } : null);
  return { discord, tier: card.tier || tier, self: true, showcase: !!me.showcase };
}

/** Son rang d'abonné Neuronal (public, comme sur la carte du site) et son Discord, s'il l'a
 *  rendu public. Seulement après l'accord donné à Neuronal. */
async function profileNeuronal(id) {
  if (!await B.permissions?.contains({ origins: NEURONAL.origins }).catch(() => false)) return null;
  try {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 3000);
    const r = await fetch(`${NEURONAL.api}discord/${id}`, { credentials: 'omit', signal: ctl.signal }).finally(() => clearTimeout(tm));
    if (!r.ok) return null;
    const j = await r.json();
    const d = j?.discord;
    const tier = ['elite', 'insider', 'tracker'].includes(j?.tier) ? j.tier : null;
    const discord = d?.id && /^\d{5,22}$/.test(d.id) ? { id: d.id, name: String(d.name || '').slice(0, 40),
      username: String(d.username || '').slice(0, 40),
      avatar: /^https:\/\/cdn\.discordapp\.com\//.test(d.avatar || '') ? d.avatar : '' } : null;
    return { discord, tier };
  } catch { return null; }
}

/** Les reglages, si Rolimon's est active ; la langue suit, pour le message d'erreur. */
async function rolimonsOn() {
  const settings = await getSettings();
  setLang(settings.lang);
  return settings.useRolimons ? settings : null;
}

/**
 * Tout ce qu'affichent le popup et les reglages, en une reponse : le popup
 * l'attend pour afficher quoi que ce soit. `lite` : sans les compteurs des
 * flux, que seuls les reglages montrent : inutile de relire des milliers d'ids.
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

const presenceCache = { key: '', at: 0, map: {} };
const searchCache = new Map();
// Défis 2SV en attente de code : clé → { challenge, media, msg, at }. En mémoire seulement
// (le code expire vite côté Roblox) ; un service worker endormi oblige juste à renvoyer.
const twoStepPending = new Map();
const TWO_STEP_TTL = 5 * 60e3;
async function askTwoStep(challenge, msg) {
  if (challenge === true || msg.challengeHeaders) return { challenge: true, error: 'vérification en deux étapes requise' };
  let media = null;
  try { media = await api.twoStepStart(challenge); } catch { media = null; }
  if (!media) return { challenge: true, error: 'vérification en deux étapes requise' };
  for (const [k, v] of twoStepPending) if (Date.now() - v.at > TWO_STEP_TTL) twoStepPending.delete(k);
  const key = crypto.randomUUID();
  twoStepPending.set(key, { challenge, media, msg, at: Date.now() });
  return { twoStep: { key, media } };
}

async function handleMessage(msg, sender = null) {
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
      // L'identifiant de l'URL n'y aide pas : Roblox le garde quand on choisit
      // une autre ligne. Seules les offres affichées comptent, et l'objet avec
      // son numéro de série départage deux exemplaires.
      const stored = await B.storage.local.get('captured');
      const pool = [
        ...Object.entries(stored.captured || {}).map(([id, e]) => ({ id, at: e.at, detail: e.detail, raw: true })),
        ...knownDetails()
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
      // Aucun appel à Roblox ici : cette réponse revient à chaque trade affiché
      // et l'API economy de Roblox se fâche vite (429 pour tout le reste de
      // l'extension). Ni pont bundle ni RAP officiel : ceux des trades connus.
      // La demande Neuronal : une table gardée 1 h ; sa première lecture n'attend pas plus de 2,5 s.
      const demand = await Promise.race([neuronalDemand(settings).catch(() => null),
        new Promise(r => setTimeout(() => r(null), 2500))]);
      return { analysis: addKnownInstances(analyzePage(page, detail, cat, captured, { extra: knownRaps, demand }), details) };
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
          projected: !!item.projected, rare: !!item.rare, noValue: !!item.noValue, legacyAssetId: item.legacyAssetId || 0 };
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
      // Tout bundle, visage compris : sa page /bundle/<id> (la page de référence chez Rolimon's).
      const roliId = item.legacyAssetId || (item.isBundle ? 0 : item.assetId);
      const roliUrl = item.bundleId ? `https://www.rolimons.com/bundle/${item.bundleId}`
        : roliId ? `https://www.rolimons.com/item/${roliId}` : '';
      return { known: true, ready: !!cat.ready, roliId, roliUrl,
        value: item.noValue ? null : item.value, rap: item.rap || 0,
        demand: item.demand, trend: item.trend, projected: item.projected, rare: item.rare };
    }
    // Chercher un objet du catalogue Rolimon's (objectif du Portefeuille) :
    // par acronyme exact, début du nom, puis nom contenant la recherche. Ou
    // relire la cote d'objets déjà choisis (`ids`).
    case 'ronote:catalog-search': {
      const settings = await getSettings();
      const cat = await getCatalog(settings);
      if (!cat.ready) return { items: [], ready: false };
      const flat = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
      let picked = [];
      if (Array.isArray(msg.ids)) {
        picked = msg.ids.slice(0, 10).map(i => ({ assetId: Number(i.assetId) || 0, bundleId: Number(i.bundleId) || 0 }));
      } else {
        const q = flat(msg.query);
        if (q.length < 2) return { items: [], ready: true };
        const hits = [];
        for (const [kind, table] of [['asset', cat.assets || {}], ['bundle', cat.bundles || {}]]) {
          for (const [id, entry] of Object.entries(table)) {
            const e = readEntry(entry);
            if (!e?.name) continue;
            const name = flat(e.name), acro = flat(e.acronym);
            const score = acro === q ? 0 : name.startsWith(q) ? 1 : name.includes(q) ? 2 : -1;
            if (score >= 0) hits.push({ score, value: e.value || 0, ids: kind === 'asset' ? { assetId: Number(id), bundleId: 0 } : { assetId: 0, bundleId: Number(id) } });
          }
        }
        picked = hits.sort((a, b) => a.score - b.score || b.value - a.value).slice(0, 8).map(h => h.ids);
      }
      const items = picked.map(ids => resolveItem(ids, cat)).filter(i => !i.unknown);
      const thumbs = await safe(() => resolveThumbs(items.map(thumbKeysFor)), []);
      return {
        ready: true,
        items: items.map((i, n) => ({ assetId: i.assetId, bundleId: i.bundleId, name: i.name, acronym: i.acronym,
          value: i.value, projected: i.projected, thumb: thumbs?.[n] || null }))
      };
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
    // Fiche joueur ou objet du popup : ce que le réseau Neuronal en sait (option, voir neuronal.js).
    case 'ronote:neuronal':
      return neuronalLookup(msg.kind, msg.id, await getSettings());

    // L'onglet Profils du popup : les fiches Profile discovery (classique ou Neuronal).
    case 'ronote:neuronal-profiles':
      return neuronalProfiles(msg.kind, msg.tier, await getSettings());

    // L'onglet Deals du popup : le Deal Sniper de Neuronal.
    case 'ronote:neuronal-deals':
      return neuronalDeals(await getSettings(), Number(msg.minutes) || 0);

    // L'onglet Mes items du popup : le best price de chaque limited (Insider/Elite).
    case 'ronote:neuronal-bestprices':
      return neuronalBestPrices(await getSettings());

    // RoNote premium (premium.js) : la carte Premium des réglages. Connecté ou déconnecté,
    // les réponses Neuronal gardées (refus compris) sont oubliées, et les fiches s'allument.
    case 'ronote:premium-status':
      return premiumStatus({ fresh: !!msg.fresh });
    case 'ronote:premium-connect':
    case 'ronote:premium-verify':
    case 'ronote:premium-roblox': {
      const r = msg.type === 'ronote:premium-connect' ? await premiumConnect()
        : msg.type === 'ronote:premium-roblox' ? await premiumRobloxOAuth() : await premiumVerify();
      if (r.ok) {
        await neuronalForget();
        await saveSettings({ neuronalLookup: true });
      }
      return r;
    }
    case 'ronote:premium-key':
      return premiumKey(msg.key);
    // Auto-post de trade ads (tradeads.js) : l'onglet Trade ads du popup.
    case 'ronote:tradeads-get':
      return tradeAdsStatus();
    case 'ronote:tradeads-save':
      return saveTradeAds(msg.patch);
    case 'ronote:tradeads-login':
      return tradeAdsLogin(msg.site);
    case 'ronote:tradeads-post':
      return postTradeAds(true);
    case 'ronote:tradeads-relay':
      return relayPush(msg.hours, await tradeAdsInputs({ pool: true }));
    case 'ronote:tradeads-resume':
      return relayPull();
    case 'ronote:tradeads-draw':
      return drawTradeAds(await tradeAdsInputs());
    // Share proof (proof.js, Elite) : ce que l'onglet sait du trade, puis capture et envoi en MP par RoOp Tracker.
    case 'ronote:proof-prepare':
      return proofPrepare(msg.info || {});
    case 'ronote:proof-share':
      return proofShare(msg, sender?.tab);
    case 'ronote:proof-save':
      return proofSave(msg, sender?.tab);
    case 'ronote:proof-allow':                    // le bouton du panneau : une petite fenêtre, un bouton, la demande de Chrome
      await B.windows.create({ url: B.runtime.getURL('options/capture.html?tab=' + (sender?.tab?.id || 0)),
        type: 'popup', width: 420, height: 300, focused: true });
      return { ok: true };
    case 'ronote:premium-link':
      return premiumLink();
    case 'ronote:premium-showcase':
      return premiumShowcase(msg.show);
    case 'ronote:premium-cancel':
      return premiumCancel();
    case 'ronote:premium-logout': {
      const r = await premiumLogout();
      await neuronalForget();
      return r;
    }

    case 'ronote:item-history': {
      const id = Number(msg.itemId);
      if (!id) return { error: 'identifiant invalide' };
      if (!await rolimonsOn()) return { error: t("Rolimon's est désactivé dans les réglages") };
      return readThrough({ key: 'itemHistory', id, field: 'data', as: 'history', ttl: ITEM_HISTORY_TTL, cap: ITEM_HISTORY_CAP },
        () => api.getItemHistory(id));
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
          await B.storage.local.set({ playerCache: newestEntries({ ...cache, [id]: hit }, PLAYER_CAP) });
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
      if (!await rolimonsOn()) return { error: t("Rolimon's est désactivé dans les réglages") };
      return readThrough({ key: 'playerHistory', id, field: 'points', ttl: PLAYER_HISTORY_TTL, cap: PLAYER_HISTORY_CAP },
        async () => thinSeries(await api.getPlayerHistory(id), PLAYER_HISTORY_POINTS));
    }
    /**
     * Ses bundles, pour sa fiche : le meme rapport que le portefeuille
     * (portfolio.js), fait sur son compte. Lu a l'ouverture de la fiche
     * seulement, et garde 30 min.
     */
    case 'ronote:player-faces': {
      const id = Number(msg.userId);
      if (!id) return { error: 'identifiant invalide' };
      const settings = await rolimonsOn();
      if (!settings) return { error: t("Rolimon's est désactivé dans les réglages") };
      // Un profil injoignable ne se met pas en cache : on reessaiera.
      let answered = false;
      return readThrough({ key: 'playerFaces', id, field: 'faces', ttl: PLAYER_TTL, cap: PLAYER_HISTORY_CAP, keep: () => answered },
        async () => {
          const report = await buildPortfolio(id, await getCatalog(settings));
          answered = !!(report.rolimons || report.private || report.terminated);
          const faces = playerFaces(report);
          const lines = { items: faces.faces };
          const urls = await safe(() => resolveThumbs(portfolioThumbKeys(lines)), []);
          attachPortfolioThumbs(lines, urls || []);
          await flushThumbs();
          return faces;
        });
    }
    case 'ronote:profile-card': {
      const id = Number(msg.userId);
      if (!(id > 0)) return { error: 'identifiant invalide' };
      const settings = await getSettings();
      if (settings.profileCard === false || settings.useRolimons === false) return { off: true };
      setLang(settings.lang);
      const [res, history] = await Promise.all([
        readThrough({ key: 'profileCards2', id, field: 'card', ttl: PLAYER_TTL, cap: PLAYER_CAP }, () => profileCard(id, settings)),
        getHistory()
      ]);
      // Tes trades avec lui : le journal local, sans réseau, donc jamais en cache.
      const st = partnerStats(partnerTimeline(historyFor(history, { id })));
      if (res.card) res.card = { ...res.card, mine: st.received + st.sent + st.done ? st : null, ...await selfPremium(id, res.card) };
      return res;
    }
    // La boutique complète d'un joueur, pour l'onglet Store du panneau : à l'ouverture de
    // l'onglet seulement, page par page ; la première page est gardée 30 min.
    case 'ronote:profile-store': {
      const id = Number(msg.userId);
      if (!(id > 0)) return { error: 'identifiant invalide' };
      const cursor = String(msg.cursor || '').slice(0, 400);
      const load = async () => {
        const page = await api.getCreatorItems(id, cursor);
        const urls = await safe(() => resolveThumbs(page.items.map(i => [i.bundle ? bundleKey(i.id) : assetKey(i.id)])), []);
        await flushThumbs();
        return { next: page.next, items: page.items.map((i, n) => ({ ...i, thumb: urls?.[n] || '',
          url: i.bundle ? api.BUNDLE_URL(i.id) : api.ASSET_URL(i.id) })) };
      };
      if (cursor) { try { return { page: await load() }; } catch (e) { return { error: String(e?.message || e) }; } }
      return readThrough({ key: 'profileStores', id, field: 'page', ttl: PLAYER_TTL, cap: PLAYER_CAP }, load);
    }
    // Le cadre « derniers trades » du profil Roblox : Insider / Elite (Neuronal le vérifie).
    // Les items surveilles, communs a Discord (filtre « RoNote ») et a l'onglet Profils.
    case 'ronote:watch':
      return neuronalWatch(msg.set || null);

    // Les Deals de Rolimon's (roli-deals.js) : demandés par la vue ouverte seulement.
    case 'ronote:roli-deals': {
      if (!await rolimonsOn()) return { off: true };
      const settings = await getSettings();
      try { return await roliDeals(await getCatalog(settings), { force: !!msg.force }); }
      catch (e) { return { error: String(e?.message || e) }; }
    }

    // Watchlist (watchlist.js) : la liste est dans les réglages, les prix lus restent ici.
    case 'ronote:wl-get': {
      const settings = await getSettings();
      const prices = await safe(() => checkWatchlist(settings, { force: !!msg.force }), null) || await readWatchPrices();
      const cat = await getCatalog(settings);
      const items = settings.watchList.map(w => ({ ...w, ...resolveItem(w.kind === 'bundle' ? { bundleId: w.id } : { assetId: w.id }, cat) , name: w.name, id: w.id, kind: w.kind }));
      const thumbs = await safe(() => resolveThumbs(items.map(thumbKeysFor)), []);
      return { checkedAt: prices.checkedAt, max: WATCH_MAX, items: items.map((i, n) => ({
        key: watchKey(i), id: i.id, kind: i.kind, name: i.name, target: i.target, value: i.value || 0, rap: i.rap || 0,
        bp: prices.items[watchKey(i)]?.bp || 0, thumb: thumbs?.[n] || null })) };
    }
    case 'ronote:wl-set': {
      const settings = await getSettings();
      let list = settings.watchList.filter(w => watchKey(w) !== watchKey(msg.item || {}));
      if (msg.remove) { await saveSettings({ watchList: list }); return { ok: true }; }
      const old = settings.watchList.find(w => watchKey(w) === watchKey(msg.item));
      const item = { id: Number(msg.item.id), kind: msg.item.kind === 'bundle' ? 'bundle' : 'asset',
        name: String(msg.item.name || old?.name || '').slice(0, 60), target: Math.max(0, Math.floor(Number(msg.item.target ?? old?.target) || 0)) };
      list = old ? settings.watchList.map(w => watchKey(w) === watchKey(item) ? item : w) : [item, ...list];
      if (list.length > WATCH_MAX) return { error: t('{n} items au plus', { n: WATCH_MAX }) };
      await saveSettings({ watchList: list });
      return { ok: true };
    }
    // « Deja trade avec lui » (Profils, Deals, 18 nov.) : pour chaque partenaire connu du journal local
    // (et des envois notes par l'envoi rapide), trades conclus, envoyes, recus, gain net, dernier contact.
    // Aucune requete : tout est deja en local. Le popup le demande une fois par ouverture.
    case 'ronote:partners': {
      const by = new Map();
      for (const h of await getHistory()) {
        const pid = Number(h.partnerId);
        if (!pid || !h.tradeId) continue;
        if (!by.has(pid)) by.set(pid, []);
        by.get(pid).push(h);
      }
      const out = {};
      for (const [pid, ev] of by) {
        const s = partnerStats(partnerTimeline(ev));
        out[pid] = { done: s.done, sent: s.sent, received: s.received, net: s.net, last: s.last };
      }
      const { sentLog } = await B.storage.local.get('sentLog');
      const me = Number((await getState()).userId) || 0;
      const sentBy = new Map();
      for (const e of Array.isArray(sentLog) ? sentLog : []) {
        const pid = Number(e.partnerId);
        if (!pid || (e.uid && me && e.uid !== me)) continue;
        const cur = sentBy.get(pid) || { n: 0, last: 0 };
        sentBy.set(pid, { n: cur.n + 1, last: Math.max(cur.last, Number(e.at) || 0) });
      }
      for (const [pid, s] of sentBy) {
        const o = out[pid] || (out[pid] = { done: 0, sent: 0, received: 0, net: null, last: 0 });
        o.sent = Math.max(o.sent, s.n);
        o.last = Math.max(o.last, s.last);
      }
      return { partners: out };
    }
    // L'ecran de counter (/trades/{id}/counter) : le partenaire du trade, lu dans ce que RoNote
    // a deja (le detail que la page vient de charger, intercepte par hook.js, ou le cache des fiches).
    // Aucune requete : sans detail connu, la page redemandera au tour suivant.
    case 'ronote:trade-partner': {
      const id = String(msg.tradeId || '').replace(/[^0-9]/g, '');
      if (!id) return { partnerId: 0 };
      const st = await getState();
      const me = Number(st.userId) || 0;
      const raw = (await getCapturedTrade(id)) || cachedDetail(id);
      const d = raw ? api.normalizeTradeDetail(raw) : null;
      const other = (d?.offers || []).map(o => o.user).find(u => Number(u?.id) && Number(u.id) !== me);
      return { partnerId: Number(other?.id) || 0, name: other?.name || '' };
    }
    // L'historique d'envoi (sent.js) : desactive par defaut, RoNote premium Insider / Elite.
    case 'ronote:sent-history': {
      const settings = await getSettings();
      if (!settings.sentHistory) return { off: true };
      await safe(() => premiumHeaders());
      const p = await premiumGet();
      if (!p.token) return { locked: 'login' };
      if (!p.me?.features?.profiles) return { locked: 'subscribe' };
      return sentHistory(msg.partnerId, settings);
    }
    // Un trade envoyé depuis la page de Roblox (content/hook.js → relay.js) : même traitement.
    case 'ronote:page-sent':
      await afterSend(msg.tradeId);
      return { ok: true };
    case 'ronote:sent-record': {
      const settings = await getSettings();
      if (!settings.sentHistory) return { ok: false };
      const st = await getState();
      return { ok: await recordSent(msg, st.userId) };
    }
    case 'ronote:profile-trades': {
      const settings = await getSettings();
      if (settings.profileTrades === false) return { off: true, hidden: true };
      return neuronalPlayerTrades(msg.userId);
    }
    case 'ronote:find-user': {
      // Favoris / « plus tard » ajoutés depuis l'accueil : un pseudo ou un identifiant.
      let hit = null;
      try { hit = await api.findUser(msg.query); } catch { return { error: 'unreachable' }; }
      return hit ? { ...hit, thumb: await api.getUserHeadshot(hit.id) } : { error: 'unknown' };
    }
    case 'ronote:search-user': {
      // Barre de recherche Roblox : un pseudo exact → la fiche du joueur. 10 min en mémoire,
      // car on retape souvent le même nom ; « personne » est aussi gardé.
      const q = String(msg.query || '').trim().replace(/^@/, '').toLowerCase();
      if (!/^[a-z0-9_]{3,20}$/.test(q)) return { error: 'unknown' };
      const hit = searchCache.get(q);
      // Présence : rafraîchie après 1 min, le reste de la fiche garde ses 10 min.
      const withPresence = async (res) => {
        if (!res?.id || (res.presenceAt && Date.now() - res.presenceAt < 60e3)) return res;
        const map = await safe(() => api.getPresence([res.id]), null);
        if (map) Object.assign(res, { presence: map[res.id] ?? 0, presenceAt: Date.now() });
        return res;
      };
      if (hit && Date.now() - hit.at < 600e3) return withPresence(hit.res);
      let res;
      try {
        const u = await api.findUser(q);
        if (!u) res = { error: 'unknown' };
        else {
          const [p, thumb] = await Promise.all([safe(() => api.getUserProfile(u.id), null), api.getUserHeadshot(u.id)]);
          res = { id: u.id, name: p?.name || u.name, displayName: p?.displayName || '', created: p?.created || 0,
            banned: !!p?.banned, verified: !!p?.verified, thumb: thumb || '' };
        }
      } catch { return { error: 'unreachable' }; }
      if (searchCache.size > 200) searchCache.clear();
      searchCache.set(q, { at: Date.now(), res });
      return withPresence(res);
    }
    case 'ronote:presence': {
      // Cache d'une minute : la barre de chaque onglet Roblox et le popup demandent la même chose.
      const ids = (msg.userIds || []).map(Number).filter(n => n > 0).sort((a, b) => a - b);
      const key = ids.join(',');
      if (presenceCache.key === key && Date.now() - presenceCache.at < 60e3) return presenceCache.map;
      const map = await safe(() => api.getPresence(ids), null);
      if (map) Object.assign(presenceCache, { key, at: Date.now(), map });
      return map || {};
    }
    case 'ronote:keep-user': {
      // Favori / « plus tard » depuis la carte d'un profil Roblox : pseudo et avatar résolus ici.
      const key = msg.key === 'favUsers' ? 'favUsers' : 'laterUsers';
      const id = Number(msg.userId);
      if (!id) return { error: 'identifiant invalide' };
      const settings = await getSettings();
      const rest = settings[key].filter(u => Number(u.id) !== id);
      if (!msg.on) return { settings: await saveSettings({ [key]: rest }) };
      const [prof, thumb] = await Promise.all([safe(() => api.getUserProfile(id), null), safe(() => api.getUserHeadshot(id), null)]);
      const entry = { id, name: prof?.displayName || prof?.name || '', at: Date.now(), ...(thumb ? { thumb, thumbAt: Date.now() } : {}) };
      return { settings: await saveSettings({ [key]: [entry, ...rest] }) };
    }
    case 'ronote:headshot':
      return { url: await api.getUserHeadshot(Number(msg.userId)) };
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
     * Refuse un trade recu, ou annule un trade envoye : c'est le meme appel
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

        await forgetCard(id);
        await setBadge(state.inboundCount, await getSettings(), false);
        await pushHistory([{
          at: Date.now(), kind: 'declined_by_me', tradeId: id,
          partner: msg.partner || '?', partnerId: Number(msg.partnerId) || null, notified: false,
          skipped: incoming ? 'refusé depuis RoNote' : 'annulé depuis RoNote'
        }]);
        return { ok: true, via: res.via, state };
      } catch (e) {
        return { error: String(e?.message || e) };
      }
    }

    // Mettre un de mes items en vente depuis l'onglet Mes items (24 nov.) : `dry` rend le devis
    // (copies, plancher, frais) pour la confirmation ; sans, une copie part en vente. 2SV comme accepter.
    case 'ronote:sell': {
      const fresh = await getState();
      if (!fresh.userId) return { error: 'non connecté' };
      const kind = msg.kind === 'bundle' ? 'bundle' : 'asset';
      try {
        if (msg.dry) return { quote: await api.resaleQuote(fresh.userId, kind, msg.id) };
        return await api.putOnSale(fresh.userId, kind, msg.id, msg.price, msg.challengeHeaders || {});
      } catch (e) {
        if (e?.challenge && !msg.dry) return askTwoStep(e.challenge, msg);
        return { error: String(e?.message || e) };
      }
    }

    // Accepter un trade reçu depuis le popup (deux clics côté interface).
    case 'ronote:accept': {
      const id = Number(msg.tradeId);
      if (!id) return { error: 'identifiant de trade invalide' };
      try {
        const res = await api.acceptTrade(id, msg.challengeHeaders || {});
        dropCollectibles((await getState()).userId, msg.partnerId);   // les objets ont changé de main
        // Le trade va réapparaître en « Completed » : on le marque déjà vu, sinon
        // on s'alerterait de son propre geste. Le flux Inactive reste surveillé :
        // si Roblox le rejette ensuite (« Rejected due to an error »), l'alerte part.
        const state = await editStore((st, streams, replay) => {
          markSeen(streams, 'completed', [id]);
          const list = st.snapshot?.inbound;
          if (Array.isArray(list)) st.snapshot.inbound = list.filter(t => Number(t.tradeId) !== id);
          if (!replay && st.inboundCount > 0) st.inboundCount -= 1;
        });
        await forgetCard(id);
        await setBadge(state.inboundCount, await getSettings(), false);
        await pushHistory([{
          at: Date.now(), kind: 'accepted_by_me', tradeId: id,
          partner: msg.partner || '?', partnerId: Number(msg.partnerId) || null, notified: false,
          skipped: 'accepté depuis RoNote'
        }]);
        return { ok: true, via: res.via, state };
      } catch (e) {
        if (e?.challenge) return askTwoStep(e.challenge, msg);
        return { error: String(e?.message || e) };
      }
    }

    /**
     * L'editeur de contre-offre : les limiteds des deux joueurs, exemplaire par
     * exemplaire, cotes et illustres comme dans un trade. Un inventaire prive
     * ou injoignable n'empeche pas l'autre de s'afficher.
     */
    // 25 nov. : la souris passe sur Trade ou Contre-offre : les deux inventaires commencent à se lire,
    // l'éditeur les trouve souvent déjà là au clic. Rien n'est renvoyé ; un échec n'est pas gardé (collectiblesOf).
    case 'ronote:inv-warm': {
      const state = await getState();
      const partnerId = Number(msg.partnerId);
      if (state.userId && partnerId) {
        collectiblesOf(state.userId, false, true).catch(() => {});
        collectiblesOf(partnerId).catch(() => {});
      }
      return { ok: true };
    }

    case 'ronote:counter-load': {
      const partnerId = Number(msg.partnerId);
      const state = await getState();
      if (!state.userId) return { error: 'non connecté' };
      if (!partnerId) return { error: 'partenaire inconnu' };
      const [settings, inv] = await Promise.all([
        getSettings(),
        Promise.allSettled([collectiblesOf(state.userId, msg.fresh, true), collectiblesOf(partnerId, msg.fresh)])
      ]);
      const cat = await getCatalog(settings);
      // Les objets echangeables de Roblox (v2) : visages, UGC et doublons compris. Un objet du trade
      // absent d'une liste complete est parti ; d'une liste tronquee, il reste « non verifie ».
      const side = (r) => r.status !== 'fulfilled'
        ? { items: [], complete: false, error: String(r.reason?.message || r.reason) }
        : { private: r.value.private, complete: !!r.value.complete, partial: !!r.value.error,
          items: r.value.items.map(raw => resolveItem(raw, cat)) };
      const [me, them] = [side(inv[0]), side(inv[1])];
      const all = [...me.items, ...them.items];
      const thumbs = await safe(() => resolveThumbs(all.map(thumbKeysFor)), []);
      const lite = (i, n) => ({
        uaid: String(i.uaid), assetId: i.assetId, bundleId: i.bundleId, legacyAssetId: i.legacyAssetId,
        name: i.name, acronym: i.acronym,
        serial: i.serial, value: i.value, rap: i.rap, prudent: i.prudent, unknown: i.unknown, noValue: i.noValue,
        onHold: i.onHold, projected: i.projected, rare: i.rare, isFace: i.isFace, thumb: thumbs?.[n] || null
      });
      me.items = me.items.map((i, n) => lite(i, n));
      them.items = them.items.map((i, n) => lite(i, n + me.items.length));
      await flushThumbs();
      return { me, them, myId: state.userId };
    }

    /** Envoie la contre-offre composee dans le popup (deux clics cote interface). */
    case 'ronote:counter': {
      const id = Number(msg.tradeId);
      if (!id) return { error: 'identifiant de trade invalide' };
      const state0 = await getState();
      try {
        const res = await api.counterTrade(id, {
          myId: state0.userId, partnerId: msg.partnerId,
          give: msg.give || [], get: msg.get || [], giveRobux: msg.giveRobux, getRobux: msg.getRobux
        }, msg.challengeHeaders || {});
        // Les deux inventaires viennent de changer de main : le cache ment.
        dropCollectibles(state0.userId, msg.partnerId);
        // Le trade d'origine passe en « Countered » (Inactive) : l'etape Inactive
        // y lira ma contre-offre et rattachera le nouvel envoi, sans alerte.
        const state = await editStore((st, streams, replay) => {
          const list = st.snapshot?.inbound;
          if (Array.isArray(list)) st.snapshot.inbound = list.filter(t => Number(t.tradeId) !== id);
          if (!replay && st.inboundCount > 0) st.inboundCount -= 1;
        });
        await forgetCard(id);
        await setBadge(state.inboundCount, await getSettings(), false);
        // La contre-offre est un nouveau trade envoyé : dans les « Envoyés » tout de suite aussi.
        let newId = null;
        try { newId = Number(JSON.parse(res.body || '{}')?.id) || null; } catch { /* réponse sans id */ }
        const after = newId ? await afterSend(newId, { id: Number(msg.partnerId), name: msg.partner || '', displayName: msg.partner || '' }) : null;
        await pushHistory([{
          at: Date.now(), kind: 'countered_by_me', tradeId: id, uid: state.userId,
          partner: msg.partner || '?', partnerId: Number(msg.partnerId) || null, notified: false,
          give: Number.isFinite(msg.giveValue) ? msg.giveValue : null,
          get: Number.isFinite(msg.getValue) ? msg.getValue : null,
          pct: Number.isFinite(msg.pct) ? msg.pct : null,
          skipped: 'contre-offre envoyée depuis RoNote'
        }]);
        return { ok: true, via: res.via, state: after || state };
      } catch (e) {
        if (e?.challenge) return askTwoStep(e.challenge, msg);
        return { error: String(e?.message || e) };
      }
    }

    /** 25 nov. : un NOUVEAU trade composé dans le popup (Profils, Deals), envoyé par l'API v2. */
    case 'ronote:send-trade': {
      const partnerId = Number(msg.partnerId);
      const state0 = await getState();
      if (!state0.userId) return { error: 'non connecté' };
      if (!partnerId) return { error: 'partenaire inconnu' };
      try {
        const res = await api.sendTrade({
          myId: state0.userId, partnerId,
          give: msg.give || [], get: msg.get || [], giveRobux: msg.giveRobux, getRobux: msg.getRobux
        }, msg.challengeHeaders || {});
        dropCollectibles(state0.userId, partnerId);
        let tradeId = null;
        try { tradeId = Number(JSON.parse(res.body || '{}')?.id) || null; } catch { /* réponse sans id */ }
        // son propre envoi n'est pas une nouveauté, et il entre dans les « Envoyés » tout de suite
        const sentState = tradeId ? await afterSend(tradeId, { id: partnerId, name: msg.partner || '', displayName: msg.partner || '' }) : null;
        await pushHistory([{
          at: Date.now(), kind: 'sent_by_me', tradeId, uid: state0.userId,
          partner: msg.partner || '?', partnerId, notified: false,
          give: Number.isFinite(msg.giveValue) ? msg.giveValue : null,
          get: Number.isFinite(msg.getValue) ? msg.getValue : null,
          pct: Number.isFinite(msg.pct) ? msg.pct : null,
          skipped: 'trade envoyé depuis RoNote'
        }]);
        return { ok: true, via: res.via, tradeId, state: sentState };
      } catch (e) {
        if (e?.challenge) return askTwoStep(e.challenge, msg);
        return { error: String(e?.message || e) };
      }
    }

    // Le code de vérification en deux étapes, tapé dans le popup : on valide le défi
    // puis on rejoue l'action en attente (la contre-offre) avec les en-têtes du défi résolu.
    case 'ronote:2sv': {
      const p = twoStepPending.get(String(msg.key || ''));
      if (!p || Date.now() - p.at > TWO_STEP_TTL) { twoStepPending.delete(String(msg.key || '')); return { error: 'expired' }; }
      if (msg.resend) {
        try { await api.twoStepStart(p.challenge); return { ok: true }; } catch (e) { return { error: String(e?.message || e) }; }
      }
      let headers;
      try { headers = await api.twoStepFinish(p.challenge, p.media, msg.code); } catch (e) {
        return e?.badCode ? { badCode: true } : { error: String(e?.message || e) };
      }
      twoStepPending.delete(String(msg.key));
      return handleMessage({ ...p.msg, challengeHeaders: headers }, sender);
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
      // L'historique d'envoi coupe : ce qui avait ete garde s'efface avec lui.
      if (msg.patch?.sentHistory === false) await clearSent();
      if (msg.patch?.syncDevices === false) await leaveSync();
      if (msg.patch?.syncDevices === true) await safe(syncFromCloud);
      await configureAlarm(settings);
      await applySidePanel(settings);
      await safe(() => syncAdFree(settings));
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
      await applySidePanel(settings);
      await safe(() => syncAdFree(settings));
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

    // Une page roblox.com dit quel compte y est connecte (balise user-data) :
    // un autre que le notre, et l'identite gardee en memoire ne vaut plus rien.
    case 'ronote:page-user': {
      const id = Number(msg.userId);
      if (!id) return { ok: false };
      const st = await getState();
      if (st.userId && Number(st.userId) !== id) {
        await editStore((s) => { s.meCheckedAt = 0; });
        reseedSoon();
      }
      return { ok: true };
    }

    // Retirer un compte du menu des comptes (le compte connecte reste).
    case 'ronote:forget-account': {
      const id = Number(msg.userId);
      const state = await editStore((s) => {
        s.accounts = (s.accounts || []).filter(a => Number(a.id) !== id || Number(a.id) === Number(s.userId));
      });
      return { state };
    }

    case 'ronote:diagnose': {
      if (headerRulesActive === null) await installHeaderRules();
      const id = cleanTradeId(msg.tradeId);
      const report = [{
        etape: 'en-têtes réécrits (Origin/Referer)',
        actif: headerRulesActive ? 'oui' : 'non, API declarativeNetRequest indisponible'
      }, {
        etape: 'jeton CSRF récupéré depuis une page Roblox',
        actif: api.hasCsrfToken() ? 'oui' : 'non, ouvre un onglet roblox.com'
      }, {
        etape: 'détail fourni par la page pour ce trade',
        actif: (await getCapturedTrade(id)) ? 'oui' : 'non'
      }, {
        etape: 'trade lu sur la page affichée',
        actif: (await getScrapedTrade(id, '')) ? 'oui' : 'non, ouvre ce trade sur roblox.com une fois'
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
      await clearSent();
      return { ok: true };
    default:
      return { error: 'message inconnu: ' + msg.type };
  }
}


// Les regles de session ne survivent pas au redemarrage du navigateur : on les
// repose a chaque reveil du worker, avant la premiere requete.
installHeaderRules().finally(() => tick('boot'));


/* ------------- inventaires de la contre-offre, gardes une minute ------------ */

const COLLECTIBLES_TTL = 60 * 1000;
// 25 nov. : mon inventaire ne change que par mes trades, qui vident ce cache (envoi, contre-offre, acceptation)
const MY_COLLECTIBLES_TTL = 3 * 60 * 1000;
const collectiblesCache = new Map();   // userId -> { at, p }

/**
 * Rouvrir l'editeur (ou en ouvrir un autre avec le meme joueur) ne recharge
 * pas jusqu'a 10 pages d'inventaire : la meme promesse sert pendant une
 * minute, et deux ouvertures simultanees n'en font qu'une. Un echec ou un
 * inventaire incomplet n'est pas garde.
 */
function collectiblesOf(userId, fresh = false, mine = false) {
  const uid = Number(userId);
  const hit = collectiblesCache.get(uid);
  if (!fresh && hit && Date.now() - hit.at < (mine ? MY_COLLECTIBLES_TTL : COLLECTIBLES_TTL)) return hit.p;
  const p = api.getTradableItems(uid);
  collectiblesCache.set(uid, { at: Date.now(), p });
  p.then((v) => { if (!v?.complete && !v?.private) collectiblesCache.delete(uid); },
    () => collectiblesCache.delete(uid));
  return p;
}

function dropCollectibles(...ids) {
  for (const id of ids) collectiblesCache.delete(Number(id));
}
