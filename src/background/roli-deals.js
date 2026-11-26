/**
 * ==========================================================================
 *  LES DEALS DE ROLIMON'S DANS RONOTE (26 novembre)
 * --------------------------------------------------------------------------
 *  Comme rolimons.com/deals : les limiteds vendus sous leur RAP ou leur value.
 *  Sans serveur. La page (~730 Ko) est lue au plus toutes les 15 minutes ;
 *  entre deux, seuls les changements arrivent, par la petite API que la page
 *  interroge elle-même (`market/v2/dealactivity`), au plus toutes les 25 s,
 *  et seulement quand la vue est ouverte (le popup demande, rien en fond).
 * ==========================================================================
 */
import * as api from '../common/api.js';
import { resolveItem } from '../common/analysis.js';

const PAGE_EVERY = 15 * 60 * 1000;
const DELTA_EVERY = 25 * 1000;

let base = null;           // { at, deltaAt, items: { "1:id": {...} } }
let busy = null;

/** Les items d'une page lue. Exposé pour les tests. */
export function itemsOf({ activity, details }) {
  const items = {};
  for (const [key, a] of Object.entries(activity || {})) {
    const d = details?.[key];
    if (!Array.isArray(a) || !Array.isArray(d)) continue;
    items[key] = { key, name: String(a[0] || d[0] || ''), at: Number(a[1]) * 1000 || 0, bp: Number(a[2]) || 0, rap: Number(a[3]) || 0,
      kind: Number(a[4]) === 2 ? 'bundle' : 'asset', id: Number(a[5]) || 0, value: Number(d[5]) || 0, acronym: d[3] || '', thumb: d[9] || null };
  }
  return items;
}

/** Applique les changements de l'API (plus récents que ce qu'on a). Exposé pour les tests. */
export function applyActivity(items, acts) {
  for (const [ts, type, id, itemType, price] of acts || []) {
    const it = items[`${Number(itemType) === 2 ? 2 : 1}:${id}`];
    const at = Number(ts) * 1000;
    if (!it || at < it.at) continue;
    if (Number(type) === 0) it.bp = Number(price) || 0; else it.rap = Number(price) || 0;
    it.at = at;
  }
  return items;
}

/** Remise par rapport au RAP et à la value, en % (positif = moins cher). Exposé pour les tests. */
export function dealOf(it) {
  return {
    rap: it.bp > 0 && it.rap > 0 ? Math.round(100 - it.bp / it.rap * 100) : null,
    value: it.bp > 0 && it.value > 0 ? Math.round(100 - it.bp / it.value * 100) : null
  };
}

export async function roliDeals(cat, { force = false, live = true } = {}) {
  busy = busy || (async () => {
    try {
      const now = Date.now();
      // Sans premium (`live` faux) : la page seule, relue toutes les 15 min ; ni changements en direct, ni relecture forcée.
      if ((force && live) || !base || now - base.at > PAGE_EVERY) {
        base = { at: now, deltaAt: now, items: itemsOf(await api.getDealsPage()) };
      } else if (live && now - base.deltaAt > DELTA_EVERY) {
        base.deltaAt = now;
        applyActivity(base.items, await api.getDealActivity().catch(() => []));
      }
      const list = [];
      for (const it of Object.values(base.items)) {
        const d = dealOf(it);
        if (!((d.rap ?? -1) > 0 || (d.value ?? -1) > 0)) continue;   // rien sous le RAP ni sous la value
        const r = resolveItem(it.kind === 'bundle' ? { bundleId: it.id } : { assetId: it.id }, cat);
        list.push({ ...it, dealRap: d.rap, dealValue: d.value, projected: !!r?.projected, value: it.value || r?.value || 0 });
      }
      return { at: base.at, items: list };
    } finally { busy = null; }
  })();
  return busy;
}
