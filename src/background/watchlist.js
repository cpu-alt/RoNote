/**
 * ==========================================================================
 *  WATCHLIST : LES ITEMS QUE JE VEUX (26 novembre)
 * --------------------------------------------------------------------------
 *  Des items que je ne possède pas, avec un prix cible. Aucun serveur : le
 *  meilleur prix vient du catalogue Roblox (`catalog/items/details`, UNE
 *  requête pour toute la liste, 120 items au plus), lu au plus toutes les
 *  2 minutes, et seulement quand la liste n'est pas vide. Value et RAP
 *  viennent du catalogue Rolimon's déjà en cache.
 *
 *  La liste vit dans les réglages (`watchList`) : elle suit donc la synchro
 *  entre appareils. Les prix lus restent locaux (`watchPrices`).
 * ==========================================================================
 */
import { B, safe } from '../common/shim.js';
import { getCatalogDetails } from '../common/api.js';
import { notifyWatch } from './notifier.js';
import { premiumHas } from './premium.js';
import { t } from '../common/i18n.js';

export const WATCH_MAX = 60;
export const WATCH_FREE = 3;                 // 26 nov. : au-delà, Insider ou Elite (premiumHas('watchlist'))
const EVERY = 2 * 60 * 1000;
const RENOTIFY = 6 * 60 * 60 * 1000;   // même prix toujours sous la cible : une alerte toutes les 6 h au plus
const KEY = 'watchPrices';

export const watchKey = (w) => `${w.kind === 'bundle' ? 'b' : 'a'}${w.id}`;
export const watchUrl = (w) => w.kind === 'bundle' ? `https://www.roblox.com/bundles/${w.id}` : `https://www.roblox.com/catalog/${w.id}`;

/** Les meilleurs prix d'une réponse du catalogue, par clé de la watchlist. Exposé pour les tests. */
export function pricesOf(data) {
  const out = {};
  for (const d of data || []) {
    const kind = d.itemType === 'Bundle' ? 'bundle' : 'asset';
    const bp = Number(d.lowestResalePrice ?? d.lowestPrice) || 0;
    out[watchKey({ kind, id: d.id })] = bp;
  }
  return out;
}

/** Les items passés sous leur cible et qui méritent une alerte. Exposé pour les tests. */
export function hitsOf(list, prices, prev, now = Date.now()) {
  const hits = [];
  for (const w of list) {
    const k = watchKey(w), bp = prices[k], p = prev[k] || {};
    if (!(w.target > 0) || !(bp > 0) || bp > w.target) continue;
    if (p.hitAt && p.hitBp === bp && now - p.hitAt < RENOTIFY) continue;
    if (p.hitAt && p.hitBp && bp >= p.hitBp && now - p.hitAt < RENOTIFY) continue;   // pas moins cher qu'à la dernière alerte
    hits.push({ ...w, bp });
  }
  return hits;
}

export async function readWatchPrices() {
  const { [KEY]: s } = await B.storage.local.get(KEY);
  return s && typeof s === 'object' ? { checkedAt: s.checkedAt || 0, items: s.items || {} } : { checkedAt: 0, items: {} };
}

let running = null;
/** Relit les prix si c'est l'heure (ou `force`), et alerte sous la cible. */
export function checkWatchlist(settings, { force = false, full } = {}) {
  if (!(settings?.watchList || []).length) return readWatchPrices();
  running = running || (async () => {
    try {
      // Sans premium, seuls les 3 premiers items sont surveillés (les autres restent dans la liste).
      const list = settings.watchList.slice(0, (full ?? await premiumHas('watchlist')) ? WATCH_MAX : WATCH_FREE);
      const stored = await readWatchPrices();
      if (!force && Date.now() - stored.checkedAt < EVERY) return stored;
      const prices = pricesOf(await getCatalogDetails(list.map(w => ({ itemType: w.kind === 'bundle' ? 'Bundle' : 'Asset', id: Number(w.id) }))));
      const now = Date.now();
      const hits = hitsOf(list, prices, stored.items, now);
      const items = {};
      for (const w of list) {
        const k = watchKey(w), p = stored.items[k] || {};
        const hit = hits.find(h => watchKey(h) === k);
        items[k] = { bp: prices[k] ?? p.bp ?? 0, at: now,
          ...(hit ? { hitAt: now, hitBp: hit.bp } : p.hitAt && prices[k] <= w.target ? { hitAt: p.hitAt, hitBp: p.hitBp } : {}) };
      }
      const next = { checkedAt: now, items };
      await B.storage.local.set({ [KEY]: next });
      if (settings.desktopNotifications !== false) {
        for (const h of hits) {
          await safe(() => notifyWatch(t('{name} à {n} R$', { name: h.name, n: h.bp.toLocaleString('en-US') }),
            t('Sous ta cible de {n} R$ : clique pour l\'acheter avant les autres.', { n: Number(h.target).toLocaleString('en-US') }), watchUrl(h)));
        }
      }
      return next;
    } finally { running = null; }
  })();
  return running;
}
