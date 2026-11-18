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
import { getState } from '../common/state.js';
import { getCatalog } from '../common/roli.js';
import { resolveItem, thumbKeysFor } from '../common/analysis.js';
import { resolveThumbs } from '../common/thumbs.js';
import { loadDetailCache, cachedCards } from './cards.js';
import { serialQueue } from '../common/utils.js';

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
  await B.storage.local.remove(KEY);
}

// Une fiche de trade envoyé (suivi jusqu'à son issue) : elle compte aussi.
const OUTCOME = { outbound_accepted: 1, outbound_declined: 1, outbound_countered: 1, outbound_expired: 1 };

/** Mes objets récents pour la page d'envoi vers `partnerId` : { items: [...] }. */
export async function sentHistory(partnerId, settings) {
  const pid = Number(partnerId) || 0;
  if (memo && memo.pid === pid && Date.now() - memo.at < MEMO_MS) return memo.value;
  const st = await getState();
  const me = Number(st.userId) || 0;
  const got = await B.storage.local.get(KEY);
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
    if (!it.thumb) missing.push([it, thumbKeysFor({ ...res, legacyAssetId: it.legacyAssetId || res.legacyAssetId })]);
  }
  if (missing.length) {
    const urls = await resolveThumbs(missing.map(m => m[1])).catch(() => []);
    missing.forEach(([it], i) => { it.thumb = urls?.[i] || null; });
  }
  const value = { items, partnerId: pid };
  memo = { pid, at: Date.now(), value };
  return value;
}
