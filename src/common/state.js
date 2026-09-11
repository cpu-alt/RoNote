import { B } from './shim.js';
import { DEFAULTS } from './defaults.js';

const KEY_SETTINGS = 'settings';
const KEY_STATE    = 'state';
const KEY_STREAMS  = 'streams';
const KEY_HISTORY  = 'history';

export const SEEN_CAP = 2000;

/* ------------------------------- reglages ------------------------------ */

/** Reglages stockes, completes des valeurs par defaut et des migrations. */
export function withDefaults(s) {
  const stored = { ...(s || {}) };

  // Migration v1 -> v2 : `watchDeclined` est devenu le suivi des envoyes.
  if (stored.watchDeclined !== undefined && stored.watchOutbound === undefined) {
    stored.watchOutbound = true;
    stored.notifyUntrackedOutbound = !!stored.watchDeclined;
    delete stored.watchDeclined;
  }
  // Migration v2 -> v3 : la base « rolimons » s'appelle desormais « value ».
  if (stored.valueBasis === 'rolimons') stored.valueBasis = 'value';

  // Migration v2.8 -> v2.9 : une seule sonnerie (`soundName`) devient un son
  // par famille d'evenement ; l'ancienne devient celle des trades recus.
  const sounds = { ...DEFAULTS.sounds, ...(stored.sounds || {}) };
  if (stored.soundName && !stored.sounds?.inbound) sounds.inbound = stored.soundName;

  return {
    ...DEFAULTS,
    ...stored,
    sounds,
    quietHours: { ...DEFAULTS.quietHours, ...(stored.quietHours || {}) },
    notifyOutbound: { ...DEFAULTS.notifyOutbound, ...(stored.notifyOutbound || {}) },
    ignoredUsers: Array.isArray(stored.ignoredUsers) ? stored.ignoredUsers : []
  };
}

export async function getSettings() {
  const { [KEY_SETTINGS]: s } = await B.storage.local.get(KEY_SETTINGS);
  return withDefaults(s);
}

export async function saveSettings(patch) {
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  if (patch?.notifyOutbound) next.notifyOutbound = { ...cur.notifyOutbound, ...patch.notifyOutbound };
  if (patch?.quietHours) next.quietHours = { ...cur.quietHours, ...patch.quietHours };
  if (patch?.sounds) next.sounds = { ...cur.sounds, ...patch.sounds };
  await B.storage.local.set({ [KEY_SETTINGS]: next });
  return next;
}

/* --------------------------------- etat -------------------------------- */

/**
 * state = petit objet volatil, reecrit a chaque verification :
 *   userId, userName, meCheckedAt, inboundCount, lastPollAt, lastOkAt,
 *   lastError, backoffUntil, tickCount,
 *   tracked      : { [tradeId]: {at, partner, auto, counterTo, round, checkedAt} }
 *   counterHints : { [partnerId]: {fromOutbound, at, round, notified} }
 *   myCounters   : { [partnerId]: {fromInbound, at, round} }
 *   links        : { [tradeId]: {counterTo, round, at} }
 *   snapshot
 *
 * Les ensembles d'ids (gros, quasi immuables) vivent dans une cle separee :
 * on evite ainsi de reecrire des milliers d'ids toutes les 30 secondes. La
 * table des clics sur les notifications aussi (voir notifier.js).
 */
export function withStateDefaults(st) {
  return {
    userId: null, userName: null, meCheckedAt: 0,
    inboundCount: 0, tickCount: 0,
    lastPollAt: 0, lastOkAt: 0, lastError: null, backoffUntil: 0,
    tracked: {}, counterHints: {}, myCounters: {}, links: {},
    snapshot: { inbound: [], completed: [], outbound: [], at: 0 },
    ...(st || {})
  };
}

export async function getState() {
  const { [KEY_STATE]: st } = await B.storage.local.get(KEY_STATE);
  return withStateDefaults(st);
}

export async function setState(state) {
  // Les flux ont leur propre cle ; `notifMap` y vivait avant d'avoir la sienne.
  const { streams, notifMap, ...rest } = state;
  await B.storage.local.set({ [KEY_STATE]: rest });
  return state;
}

/* -------------------------------- flux --------------------------------- */

let streamsSignature = null;

/**
 * Signature bon marche des flux. Comparer un JSON complet (des milliers d'ids)
 * a chaque verification coutait plus cher que l'ecriture qu'on cherchait a
 * eviter. Le haut de la fenetre suffit : un id ajoute y entre toujours, meme
 * quand la liste, pleine, garde la meme longueur.
 */
const SIGNATURE_IDS = 120;

function signatureOf(streams) {
  return Object.keys(streams).sort().map(k => {
    const s = streams[k] || {};
    return `${k}:${s.newest || 0}:${s.belowMark || 0}:${s.seen?.length || 0}:${s.seededAt || 0}:`
      + (s.seen || []).slice(0, SIGNATURE_IDS).join(',');
  }).join('|');
}

export async function getStreams() {
  let { [KEY_STREAMS]: streams } = await B.storage.local.get(KEY_STREAMS);

  // Migration v1 -> v2 : les flux etaient stockes dans `state.streams`.
  if (!streams) {
    const { [KEY_STATE]: st } = await B.storage.local.get(KEY_STATE);
    if (st?.streams) {
      streams = st.streams;
      await B.storage.local.set({ [KEY_STREAMS]: streams });
    }
  }
  streams = streams || {};
  streamsSignature = signatureOf(streams);
  return streams;
}

/** N'ecrit que si quelque chose a reellement change. @returns true si ecrit */
export async function saveStreams(streams) {
  const sig = signatureOf(streams);
  if (sig === streamsSignature) return false;
  streamsSignature = sig;
  await B.storage.local.set({ [KEY_STREAMS]: streams });
  return true;
}

export async function resetStreams() {
  streamsSignature = null;
  await B.storage.local.set({ [KEY_STREAMS]: {} });
}

/* ---------------------------- portefeuille ------------------------------ */

const KEY_PORTFOLIO = 'portfolio';

export async function getPortfolio() {
  const { [KEY_PORTFOLIO]: p } = await B.storage.local.get(KEY_PORTFOLIO);
  return Array.isArray(p) ? p : [];
}

/**
 * Serie complete telle que publiee par Rolimon's. On la stocke telle quelle :
 * c'est la meme donnee que leur graphique, il n'y a rien a reconstruire.
 */
export async function savePortfolio(points) {
  await B.storage.local.set({ [KEY_PORTFOLIO]: points });
  return points.length;
}

/* ------------------------- rapport de reconciliation -------------------- */

const KEY_REPORT = 'portfolioReport';

export async function getPortfolioReport() {
  const { [KEY_REPORT]: r } = await B.storage.local.get(KEY_REPORT);
  return r && typeof r === 'object' ? r : null;
}

export async function savePortfolioReport(report) {
  await B.storage.local.set({ [KEY_REPORT]: report });
  return report;
}

/* ------------------------------ historique ------------------------------ */

export async function getHistory() {
  const { [KEY_HISTORY]: h } = await B.storage.local.get(KEY_HISTORY);
  return Array.isArray(h) ? h : [];
}

export async function pushHistory(entries, limit = DEFAULTS.historyLimit) {
  if (!entries?.length) return;
  const hist = await getHistory();
  await B.storage.local.set({ [KEY_HISTORY]: [...entries, ...hist].slice(0, limit) });
}

export async function clearHistory() {
  await B.storage.local.set({ [KEY_HISTORY]: [] });
}
