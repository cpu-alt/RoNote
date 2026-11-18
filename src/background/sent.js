/**
 * ==========================================================================
 *  L'HISTORIQUE D'ENVOI (page « Trade with … »)
 * --------------------------------------------------------------------------
 *  Sous le titre de la page d'envoi d'un trade, les objets que j'ai donnés
 *  dans mes derniers trades envoyés : ceux faits avec ce joueur d'abord.
 *  RoNote premium Insider / Elite (fonction « profiles » du jeton Neuronal),
 *  désactivé par défaut (réglage `sentHistory`).
 *
 *  Aucune requête Roblox de plus :
 *    - au moment de l'envoi, la page dit ce qu'on donne (content/sent-history.js
 *      lit le panier, hook.js voit la réponse de Roblox avec le numéro du trade) :
 *      on le garde ici, en local, 150 envois au plus, et seulement si l'option
 *      est active ;
 *    - les trades envoyés déjà dans le cache des fiches (7 jours) complètent.
 *  Les values viennent de la table Rolimon's déjà chargée, les vignettes du
 *  cache des vignettes. La réponse est gardée 30 s par joueur.
 *  Rien ne quitte l'ordinateur.
 * ==========================================================================
 */
import { B } from '../common/shim.js';
import { getState, getStreams } from '../common/state.js';
import { getCatalog } from '../common/roli.js';
import { resolveItem, thumbKeysFor } from '../common/analysis.js';
import { resolveThumbs } from '../common/thumbs.js';
import { loadDetailCache, cachedCards, cachedDetail } from './cards.js';
import { serialQueue, eachLimit } from '../common/utils.js';
import * as api from '../common/api.js';
import { directionOf } from './streams.js';

const KEY = 'sentLog';
export const SENT_CAP = 150;
const ITEMS_SHOWN = 16;                           // la ligne « Recent » (envoi rapide)
const MEMO_MS = 30e3;
const writes = serialQueue();
let memo = null;                                  // { pid, at, value }

// La vignette que la page affichait déjà : seulement une image du CDN de Roblox.
const CDN = /^https:\/\/[a-z0-9.-]+\.rbxcdn\.com\/[^\s"'<>]{1,400}$/i;
const cleanItems = (list) => (Array.isArray(list) ? list : []).slice(0, 8).map(i => ({
  assetId: Number(i?.assetId) || 0, bundleId: Number(i?.bundleId) || 0,
  name: String(i?.name || '').slice(0, 80), rap: Number(i?.rap) || 0,
  thumb: CDN.test(String(i?.thumb || '')) ? String(i.thumb) : null
})).filter(i => i.assetId || i.bundleId || i.name);

/** Un envoi vu sur la page. Ignoré sans numéro de trade ou sans rien de donné. */
export function recordSent(msg, me) {
  const id = String(msg?.tradeId ?? '').replace(/[^0-9]/g, '');
  const give = cleanItems(msg?.give);
  const robux = Math.max(0, Number(msg?.robux) || 0);
  if (!id || (!give.length && !robux)) return Promise.resolve(false);
  const entry = {
    id, at: Number(msg.at) || Date.now(), uid: Number(me) || 0,
    partnerId: Number(msg.partnerId) || 0, handle: String(msg.handle || '').replace(/^@/, '').slice(0, 32),
    give, get: cleanItems(msg.get), robux
  };
  return writes(async () => {
    const got = await B.storage.local.get(KEY);
    const log = (Array.isArray(got?.[KEY]) ? got[KEY] : []).filter(e => e.id !== id);
    await B.storage.local.set({ [KEY]: [entry, ...log].slice(0, SENT_CAP) });
    memo = null;
    return true;
  });
}

export async function clearSent() {
  memo = null;
  lastBackfill = 0;
  gen++;
  backfilling = null;
  await B.storage.local.remove(KEY);
}

/*
 * LE RATTRAPAGE (18 nov., MYd : « les derniers items que j'ai envoyés dans mes trades précédents ») :
 * sans lui, la liste ne connaissait que les envois faits depuis l'activation. Une fois par
 * 10 min au plus, les listes Outbound et Inactive de Roblox (2 requêtes) donnent mes trades
 * récents ; le détail des 15 plus récents encore inconnus est lu (cache des fiches d'abord),
 * deux à la fois, puis gardé dans `sentLog` : il n'est plus jamais redemandé.
 * Qui a envoyé ? Un id vu sur le flux Inbound de RoNote est écarté ; sinon, l'offre que
 * Roblox met en premier doit être la mienne (18 nov. : c'est le cas pour un trade en cours lu en v1
 * et pour 35 trades terminés lus en v2, `participantAOffer` ; aucun trade reçu n'a pu servir de contre-exemple).
 */
const BACKFILL_MS = 10 * 60e3;
const BACKFILL_MAX = 15;
let lastBackfill = 0, backfilling = null, gen = 0;      // gen : un effacement annule le rattrapage en cours

async function backfill(me) {
  if (!me || Date.now() - lastBackfill < BACKFILL_MS) return backfilling;
  if (backfilling) return backfilling;
  lastBackfill = Date.now();
  const mine = gen;
  backfilling = (async () => {
    const got = await B.storage.local.get(KEY);
    const known = new Set((Array.isArray(got?.[KEY]) ? got[KEY] : []).map(e => String(e.id)));
    const streams = await getStreams().catch(() => ({}));
    const lists = await Promise.all(['outbound', 'inactive', 'completed'].map(t => api.listTrades(t, 25).catch(() => null)));
    const cand = lists.flatMap(l => l?.data || [])
      .filter(t => t?.id && !known.has(String(t.id)) && directionOf(streams, t.id) !== 'inbound')
      .sort((a, b) => (Date.parse(b.created) || 0) - (Date.parse(a.created) || 0))
      .slice(0, BACKFILL_MAX);
    const found = [];
    await eachLimit(cand, 2, async (t) => {
      const hint = { tradeId: Number(t.id), created: t.created, expiration: t.expiration, status: t.status, partner: t.user };
      const d = cachedDetail(t.id) || await api.getTrade(t.id, hint).catch(() => null);
      const offers = d?.offers || [];
      const mine = offers[0];
      if (offers.length !== 2 || Number(mine?.user?.id) !== me) return;          // pas un trade que j'ai envoyé
      const give = cleanItems((mine.userAssets || []).map(a => ({ assetId: a.assetId, bundleId: a.bundleId, name: a.name, rap: a.recentAveragePrice })));
      if (!give.length && !mine.robux) return;
      const partner = offers[1]?.user || t.user || {};
      found.push({ id: String(t.id), at: Date.parse(t.created) || Date.now(), uid: me, partnerId: Number(partner.id) || 0,
        handle: String(partner.name || '').slice(0, 32), give, get: [], robux: Number(mine.robux) || 0 });
    });
    if (!found.length || mine !== gen) return;
    await writes(async () => {
      if (mine !== gen) return;                     // l'historique a été effacé entre-temps
      const cur = await B.storage.local.get(KEY);
      const log = Array.isArray(cur?.[KEY]) ? cur[KEY] : [];
      const ids = new Set(log.map(e => String(e.id)));
      const merged = [...log, ...found.filter(e => !ids.has(e.id))].sort((a, b) => b.at - a.at).slice(0, SENT_CAP);
      await B.storage.local.set({ [KEY]: merged });
      memo = null;
    });
  })().catch(() => {}).finally(() => { backfilling = null; });
  return backfilling;
}

// Une fiche de trade envoyé (suivi jusqu'à son issue) : elle compte aussi.
const OUTCOME = { outbound_accepted: 1, outbound_declined: 1, outbound_countered: 1, outbound_expired: 1 };

/** Mes objets récents pour la page d'envoi vers `partnerId` : { items: [...] }. */
export async function sentHistory(partnerId, settings) {
  const pid = Number(partnerId) || 0;
  if (memo && memo.pid === pid && Date.now() - memo.at < MEMO_MS) return memo.value;
  const st = await getState();
  const me = Number(st.userId) || 0;
  const first = await B.storage.local.get(KEY);
  // Le rattrapage n'est attendu que la première fois (liste vide) : ensuite, la ligne s'affiche tout
  // de suite avec ce qui est gardé, et la page redemande une fois quand il a fini (`refreshing`).
  const run = backfill(me);
  const refreshing = !!run && Array.isArray(first?.[KEY]) && first[KEY].length > 0;
  if (run && !refreshing) await run;
  const got = refreshing ? first : await B.storage.local.get(KEY);
  const rows = new Map();

  for (const e of Array.isArray(got?.[KEY]) ? got[KEY] : []) {
    if (e.uid && me && e.uid !== me) continue;     // un autre compte Roblox
    rows.set(String(e.id), { id: e.id, at: e.at, partnerId: e.partnerId, handle: e.handle,
      robux: e.robux || 0, give: e.give.map(i => ({ ...i })) });
  }
  // Les trades envoyés que le cache des fiches connaît déjà (suivis jusqu'à leur issue).
  await loadDetailCache();
  for (const card of cachedCards()) {
    if (!OUTCOME[card?.kind] || rows.has(String(card.tradeId))) continue;
    const give = card.analysis?.give;
    if (!give?.items?.length && !give?.robux) continue;
    rows.set(String(card.tradeId), {
      id: String(card.tradeId), at: Date.parse(card.created) || 0,
      partnerId: Number(card.partner?.id) || 0, handle: card.partner?.name || card.partner?.displayName || '',
      robux: give.robux || 0,
      give: give.items.slice(0, 8).map(i => ({ assetId: i.assetId, bundleId: i.bundleId, legacyAssetId: i.legacyAssetId,
        name: i.name, rap: i.rap, value: i.value, thumb: i.thumb || null }))
    });
  }

  // Mes objets récents, un par objet, du dernier mis de mon côté au plus ancien (avec le nombre de fois).
  const agg = new Map();
  for (const r of [...rows.values()].sort((a, b) => b.at - a.at)) {
    for (const it of r.give) {
      const k = it.bundleId ? 'b' + it.bundleId : it.assetId ? 'a' + it.assetId : 'n' + it.name;
      const e = agg.get(k);
      if (e) { e.n++; e.withThem ||= r.partnerId === pid; continue; }
      agg.set(k, { ...it, n: 1, at: r.at, withThem: r.partnerId === pid });
    }
  }
  const items = [...agg.values()].slice(0, ITEMS_SHOWN);

  // Values (table déjà chargée) et vignettes (cache) des seuls objets affichés.
  const cat = await getCatalog(settings).catch(() => null);
  const missing = [];
  for (const it of items) {
    const res = resolveItem({ assetId: it.assetId, bundleId: it.bundleId, name: it.name }, cat);
    if (!(it.value > 0)) it.value = res.value || it.rap || 0;
    it.name = it.name || res.name;
    it.acronym = res.acronym || '';
    it.projected = !!res.projected;
    it.rare = !!res.rare;
    if (!it.thumb) missing.push([it, thumbKeysFor({ ...res, legacyAssetId: it.legacyAssetId || res.legacyAssetId })]);
  }
  if (missing.length) {
    const urls = await resolveThumbs(missing.map(m => m[1])).catch(() => []);
    missing.forEach(([it], i) => { it.thumb = urls?.[i] || null; });
  }
  const value = { items, partnerId: pid };
  if (!refreshing) memo = { pid, at: Date.now(), value };
  return refreshing ? { ...value, refreshing: true } : value;
}
