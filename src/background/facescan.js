/**
 * ==========================================================================
 *  LE PARCOURS DES TRADES, POUR LES VISAGES
 * --------------------------------------------------------------------------
 *  Pour rejouer la courbe (faces.js), il faut savoir quand chaque bundle est
 *  arrive ou parti. Seul l'historique des trades termines le dit. On le
 *  parcourt UNE fois, du plus recent au plus ancien, puis on ne regarde plus
 *  que les nouveaux trades.
 *
 *  Discretion d'abord : quelques trades par verification, espaces, jamais
 *  plus. Un historique de mille trades se lit en une demi-heure, sans que
 *  Roblox ne voie autre chose qu'un joueur qui feuillette ses trades, et sans
 *  jamais retarder une alerte.
 *
 *  Date d'un mouvement : la date de CREATION du trade. Roblox ne dit pas quand
 *  un trade a ete accepte ; il l'est en general dans les heures qui suivent.
 * ==========================================================================
 */
import { B } from '../common/shim.js';
import * as api from '../common/api.js';
import { sleep } from '../common/utils.js';
import { FACE_KEYS, getPortfolio, getPortfolioReport } from '../common/state.js';
import { bundleMoves, currentGaps, priceLookup, reconstructCorrections } from '../common/faces.js';

const PAGE = 100;                        // trades par page de la liste
const DETAILS_PER_RUN = 12;              // details lus par verification
const GAP_MS = 600;                      // entre deux details
const MARGIN = 120 * 864e5;              // au-dela du premier mouvement de bundle : fini
const CAP = 3000;                        // trades parcourus au plus
const NO_FACE_CAP = 600;                 // aucun bundle dans les 600 derniers trades : fini
const RECENT_CAP = 300;                  // ids deja lus, pour reconnaitre les nouveaux
const REFRESH = 30 * 60 * 1000;          // nouveaux trades, une fois le parcours fini
const HISTORY_TTL = 7 * 864e5;           // cote d'un visage, jour par jour
const HISTORY_RETRY = 60 * 60 * 1000;    // page Rolimon's injoignable : on retente dans 1 h
const BUILD_GAP = 2 * 60 * 1000;         // pendant le parcours, la courbe se refait au plus toutes les 2 min

let mem = null;       // { scan, ledger, histories, series } du compte courant
let running = false;

const freshScan = (userId) => ({
  userId, done: false, cursor: '', queue: [], scanned: 0, faceTrades: 0, oldestAt: 0,
  failed: 0, recent: [], lastRefreshAt: 0, startedAt: Date.now(),
  sig: '', builtAt: 0, gapKeys: [], unexplained: {}, firstMoveAt: 0
});

async function load(userId) {
  if (mem && mem.scan.userId === userId) return mem;
  const got = await B.storage.local.get(Object.values(FACE_KEYS));
  const scan = got[FACE_KEYS.scan];
  if (!scan || scan.userId !== userId) {
    mem = { scan: freshScan(userId), ledger: {}, histories: {}, series: [] };
    await save(mem, { ledger: true, histories: true, series: true });
  } else {
    mem = {
      scan: { ...freshScan(userId), ...scan },
      ledger: got[FACE_KEYS.ledger] || {},
      histories: got[FACE_KEYS.histories] || {},
      series: Array.isArray(got[FACE_KEYS.series]) ? got[FACE_KEYS.series] : []
    };
  }
  return mem;
}

/** Le parcours s'ecrit a chaque pas ; le reste seulement quand il a change. */
async function save(data, dirty = {}) {
  const out = { [FACE_KEYS.scan]: data.scan };
  if (dirty.ledger) out[FACE_KEYS.ledger] = data.ledger;
  if (dirty.histories) out[FACE_KEYS.histories] = data.histories;
  if (dirty.series) out[FACE_KEYS.series] = data.series;
  await B.storage.local.set(out);
}

const firstMoveAt = (ledger) =>
  Object.values(ledger).reduce((min, tr) => (tr.at && (!min || tr.at < min) ? tr.at : min), 0);

const neededBundles = (data) => new Set([
  ...data.scan.gapKeys.map(String),
  ...Object.values(data.ledger).flatMap(tr => tr.moves.map(([b]) => String(b)))
]);

/** Un bundle dont la cote jour par jour manque ou a vieilli. */
const historiesDue = (data, cat) => [...neededBundles(data)].some(b => {
  const rec = data.histories[b];
  return (!rec || Date.now() - rec.at >= HISTORY_TTL) && (cat.faceOf?.[b] || !rec);
});

/**
 * Lit un trade et note ses mouvements de bundles. Le detail vient du cache des
 * cartes quand il y est ; sinon d'un seul appel. Une limite de debit ou une
 * coupure reseau arrete le pas en cours (le trade sera relu au suivant).
 */
async function readTrade([id, at], data, state, cat, lookup) {
  const { scan, ledger } = data;
  if (ledger[id]) return;
  let moves = null;
  const cached = lookup(id);
  if (cached) moves = bundleMoves(cached, state.userId, cat);
  if (moves === null) {
    try {
      moves = bundleMoves(await api.getTradeBundlesDetail(id), state.userId, cat);
    } catch (e) {
      if (e?.isRate || !e?.status) throw e;
      moves = null;
    }
  }
  if (moves === null) { scan.failed++; return; }
  if (moves.length) ledger[id] = { at, moves };
}

function finish(scan) {
  scan.done = true;
  scan.queue = [];
  scan.cursor = null;
  scan.lastRefreshAt = Date.now();
}

/** Le premier parcours, page par page, du plus recent au plus ancien. */
async function scanHistory(data, state, cat, lookup) {
  const { scan } = data;
  if (!scan.queue.length) {
    if (scan.cursor === null) { finish(scan); return true; }
    const page = await api.listTrades('Completed', PAGE, scan.cursor || '');
    const list = Array.isArray(page?.data) ? page.data : [];
    scan.queue = list.map(t => [Number(t.id), Date.parse(t.created) || 0]).filter(([id]) => id);
    scan.cursor = page?.nextPageCursor || null;
    if (!scan.queue.length) { finish(scan); return true; }
  }
  for (let i = 0; i < DETAILS_PER_RUN && scan.queue.length; i++) {
    if (i) await sleep(GAP_MS);
    const entry = scan.queue[0];
    await readTrade(entry, data, state, cat, lookup);
    scan.queue.shift();
    scan.scanned++;
    if (entry[1]) scan.oldestAt = scan.oldestAt ? Math.min(scan.oldestAt, entry[1]) : entry[1];
    if (scan.recent.length < RECENT_CAP) scan.recent.push(entry[0]);
  }
  scan.faceTrades = Object.keys(data.ledger).length;

  // Bien au-dela du premier mouvement de bundle, les trades datent d'avant la
  // conversion des visages : ils n'en contiennent plus.
  const first = firstMoveAt(data.ledger);
  if ((first && scan.oldestAt && scan.oldestAt < first - MARGIN)
    || scan.scanned >= CAP || (!first && scan.scanned >= NO_FACE_CAP)) finish(scan);
  return true;
}

/** Parcours fini : seulement les trades apparus depuis. */
async function scanRecent(data, state, cat, lookup) {
  const { scan } = data;
  const page = await api.listTrades('Completed', 25, '');
  const known = new Set(scan.recent);
  const fresh = (Array.isArray(page?.data) ? page.data : [])
    .map(t => [Number(t.id), Date.parse(t.created) || 0])
    .filter(([id]) => id && !known.has(id));
  const before = Object.keys(data.ledger).length;
  for (let i = 0; i < fresh.length && i < DETAILS_PER_RUN; i++) {
    if (i) await sleep(GAP_MS);
    await readTrade(fresh[i], data, state, cat, lookup);
    scan.recent = [fresh[i][0], ...scan.recent].slice(0, RECENT_CAP);
  }
  if (fresh.length <= DETAILS_PER_RUN) scan.lastRefreshAt = Date.now();
  scan.faceTrades = Object.keys(data.ledger).length;
  return scan.faceTrades !== before;
}

/** La cote jour par jour d'un bundle concerne : une page Rolimon's par pas, au plus. */
async function fetchOneHistory(data, cat) {
  for (const b of neededBundles(data)) {
    const rec = data.histories[b];
    if (rec && Date.now() - rec.at < HISTORY_TTL) continue;
    const legacy = cat.faceOf?.[b];
    if (!legacy) {
      // Pas un visage (ou pas de page connue) : sa cote actuelle servira.
      if (!rec) { data.histories[b] = { at: Date.now(), data: null }; return true; }
      continue;
    }
    try {
      const h = await api.getItemHistory(legacy);
      data.histories[b] = { at: Date.now(), data: { t: h.t, v: h.v, r: h.r } };
    } catch {
      data.histories[b] = { at: Date.now() - HISTORY_TTL + HISTORY_RETRY, data: rec?.data || null };
    }
    return true;
  }
  return false;
}

/**
 * Un pas de la reconstruction, a chaque verification.
 * @param lookup  (tradeId) => detail deja en cache, ou null
 * @returns true si quelque chose a change
 */
export async function stepFaceScan({ settings, state, cat, lookup = () => null, force = false }) {
  if (running || !state?.userId || !cat?.ready) return false;
  if (!settings.useRolimons || !settings.trackPortfolio || settings.reconcilePortfolio === false) return false;
  running = true;
  try {
    const data = await load(state.userId);
    const { scan } = data;
    const wasDone = scan.done;
    let ledgerChanged = false;
    let stepped = false;

    try {
      if (!scan.done) {
        stepped = await scanHistory(data, state, cat, lookup);
        ledgerChanged = stepped;
      } else if (force || Date.now() - (scan.lastRefreshAt || 0) > REFRESH) {
        ledgerChanged = await scanRecent(data, state, cat, lookup);
        stepped = true;
      }
    } catch (e) {
      // Limite de debit ou reseau : on garde ce qui est lu, on reprendra.
      console.debug('[RoNote] parcours des visages interrompu :', e?.message || e);
      stepped = true;
    }

    // Nouveau releve, nouveau rapport, parcours fini, cote a completer : la
    // courbe se refait. Pendant le parcours, pas plus d'une fois toutes les 2 min.
    const sig = `${state.portfolioAt || 0}|${state.historyFetchedAt || 0}`;
    const due = force || scan.sig !== sig || (scan.done && !wasDone) || historiesDue(data, cat)
      || (ledgerChanged && Date.now() - (scan.builtAt || 0) > BUILD_GAP);
    if (!due) {
      if (stepped) await save(data, { ledger: ledgerChanged });
      return stepped;
    }

    const report = await getPortfolioReport();
    const gaps = currentGaps(report);
    scan.gapKeys = Object.keys(gaps);
    const historyFetched = await fetchOneHistory(data, cat);

    const points = await getPortfolio();
    let built = false;
    if (report?.ok && !report.partial && points.length) {
      const histories = Object.fromEntries(Object.entries(data.histories).map(([b, r]) => [b, r?.data || null]));
      const res = reconstructCorrections({
        points, ledger: Object.values(data.ledger), gaps,
        prices: priceLookup(histories, cat),
        coveredFrom: scan.done ? null : (scan.oldestAt || Date.now())
      });
      data.series = res.corrections;
      scan.unexplained = res.unexplained;
      scan.firstMoveAt = res.firstMoveAt || 0;
      built = true;
    }
    scan.sig = sig;
    scan.builtAt = Date.now();
    await save(data, { ledger: true, histories: historyFetched, series: built });
    return true;
  } finally {
    running = false;
  }
}
