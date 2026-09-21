import { analyze, netRobux } from './analysis.js';
import { flatName, NAME } from './roli.js';

// flat name -> { assetId } | { bundleId }, rebuilt when the table changes.
let nameIndex = null, nameIndexTs = -1;
function indexOf(cat) {
  if (nameIndex && nameIndexTs === (cat?.ts || 0)) return nameIndex;
  nameIndex = new Map();
  nameIndexTs = cat?.ts || 0;
  const add = (entries, key) => {
    for (const [id, e] of Object.entries(entries || {})) {
      const k = flatName(e?.[NAME]);
      if (!k) continue;
      // Two items with the same name: ambiguous, never guessed.
      nameIndex.set(k, nameIndex.has(k) ? null : { [key]: Number(id) });
    }
  };
  add(cat?.assets, 'assetId');
  add(cat?.bundles, 'bundleId');
  return nameIndex;
}

/**
 * Items read by their name only (trade being built): give them their id from
 * the Rolimon's table. A truncated name ("Perfectly Legitimate…") matches only
 * when a single known name starts with it.
 */
export function findByName(name, cat) {
  if (!cat?.ready) return null;
  const index = indexOf(cat);
  const raw = String(name || '');
  const cut = /(?:…|\.\.\.)\s*$/.test(raw);
  const k = flatName(raw);
  if (!k) return null;
  if (!cut) return index.get(k) || null;
  let hit = null;
  for (const [name2, ids] of index) {
    if (!name2.startsWith(k)) continue;
    if (hit || !ids) return null;
    hit = ids;
  }
  return hit;
}

export function resolveNames(page, cat) {
  if (!page?.sides || !cat?.ready) return page;
  const find = (item) => {
    for (const n of item.names?.length ? item.names : [item.name]) {
      const hit = findByName(n, cat);
      if (hit) return { ...hit, name: item.name };
    }
    return null;
  };
  return { ...page, sides: page.sides.map(s => ({ ...s, items: (s.items || []).map(i =>
    i.assetId || i.bundleId ? i : { ...i, ...(find(i) || {}), byName: true }) })) };
}

const amount = n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const itemsKey = items => items.map(i => i.bundleId ? `b${i.bundleId}` : `a${i.assetId}`).sort().join(',');

// An asset + serial identifies a copy even when the displayed trade has no
// owner/trade ID. Do not couple history links to valuation/offer matching.
export function addKnownInstances(analysis, details) {
  const copies = new Map();
  for (const detail of details || []) for (const offer of detail?.offers || []) for (const item of offer.userAssets || []) {
    if (!/^[1-9]\d*$/.test(String(item.id || '')) || item.serialNumber == null) continue;
    const key = item.bundleId ? `b${item.bundleId}` : `a${item.assetId}`;
    if (!copies.has(key)) copies.set(key, new Map());
    const serial = String(item.serialNumber), entries = copies.get(key);
    const old = entries.get(serial);
    if (old === undefined) entries.set(serial, String(item.id));
    else if (old !== String(item.id)) entries.set(serial, null);
  }
  for (const side of analysis.pageItems || []) for (const item of side) {
    const entries = copies.get(item.bundleId ? `b${item.bundleId}` : `a${item.assetId}`);
    if (!entries) continue;
    item.instances = [...entries].filter(([, uaid]) => uaid).map(([serial, uaid]) => ({ serial, uaid }));
  }
  // History does not need the logged-in user's identity. Match both baskets
  // directly and require all matching snapshots to agree on the copy ID.
  const sides = analysis.pageItems || [];
  if (sides.length === 2) {
    const matches = [];
    for (const detail of details || []) {
      if (detail?.offers?.length !== 2) continue;
      const order = sides.map(side => detail.offers.filter(o => itemsKey(o.userAssets || []) === itemsKey(side)));
      if (order.some(o => o.length !== 1) || order[0][0] === order[1][0]) continue;
      matches.push(order.map(o => o[0]));
    }
    for (const [index, side] of sides.entries()) for (const item of side) {
      const ids = new Set();
      for (const offers of matches) {
        const copies = offers[index].userAssets.filter(i => itemsKey([i]) === itemsKey([item]));
        if (copies.length !== 1 || !/^[1-9]\d*$/.test(String(copies[0].id || ''))) { ids.add(null); continue; }
        ids.add(String(copies[0].id));
      }
      if (matches.length) item.matchedUaid = ids.size === 1 && !ids.has(null) ? [...ids][0] : null;
    }
  }
  return analysis;
}

// Match both complete offers, with multiplicity. A response from a previously
// selected trade must never determine the direction of the current one.
export function capturedForPage(page, captured, myId) {
  if (!myId || page?.sides?.length !== 2 || captured?.offers?.length !== 2) return null;
  const matches = page.sides.map(s => captured.offers.filter(o => itemsKey(s.items || []) === itemsKey(o.userAssets || [])));
  if (matches.some(m => m.length !== 1) || matches[0][0] === matches[1][0]) return null;
  const offers = matches.map(m=>m[0]);
  if (offers.filter(o=>Number(o.user?.id)===Number(myId)).length !== 1) return null;
  const sides = page.sides.map((s,index) => {
    const o = offers[index], role = Number(o.user.id) === Number(myId) ? 'give' : 'get';
    if (s.role && s.role !== role) return null;
    return { ...s, role, userIds:[Number(o.user.id)] };
  });
  return sides.every(Boolean) ? {...page,sides} : null;
}

// Ownership comes from explicit give/receive headings, or profile IDs. Never order.
export function pageDetail(page, myId) {
  const sides = page?.sides;
  if (!Array.isArray(sides) || sides.length !== 2) return null;
  const owners = sides.map(s => Array.isArray(s.userIds) && s.userIds.length === 1
    ? Number(s.userIds[0]) : 0);
  const roles = sides.map(s => s.role);
  let mine = roles.includes('give') && roles.includes('get') ? roles.indexOf('give') : -1;
  if (mine < 0) {
    if (!myId || owners.some(id => !Number.isSafeInteger(id) || id <= 0) ||
        owners[0] === owners[1] || !owners.includes(Number(myId))) return null;
    mine = owners.indexOf(Number(myId));
  } else if (myId && owners.includes(Number(myId)) && owners.indexOf(Number(myId)) !== mine) return null;
  const perspective = Number(myId) || -1;
  if (owners[1 - mine] === perspective) return null;
  const offers = [];
  for (const [index, side] of sides.entries()) {
    // A basket being built may still be empty (or Robux only).
    if (!Array.isArray(side.items) || (!side.items.length && !page.composer) || side.items.length > 8) return null;
    const userAssets = side.items.map(i => ({
      assetId: Number(i.assetId) || 0, bundleId: Number(i.bundleId) || 0,
      name: String(i.name || '').slice(0, 120),
      recentAveragePrice: amount(i.rap) ? i.rap : 0
    }));
    // In a basket being built, an item Rolimon's doesn't list is still known
    // by its name and the RAP shown next to it: it counts at that RAP.
    if (userAssets.some(i => !Number.isSafeInteger(i.assetId) || i.assetId < 0 ||
        !Number.isSafeInteger(i.bundleId) || i.bundleId < 0 ||
        !(i.assetId || i.bundleId || (page.composer && i.recentAveragePrice > 0)))) return null;
    offers.push({ user: { id: index === mine ? perspective : owners[index] || -2 }, robux: 0, userAssets });
  }
  return { id: page.tradeId || 0, offers, perspective, mine };
}

export function analyzePage(page, detail, cat, captured = null, { extra = null, bundleIds = null } = {}) {
  // Captured responses can supplement missing per-item RAP, never override live
  // DOM amounts or apply a second 30% deduction to a net amount on the page.
  const raw = samePageOffers(detail, captured) ? {
    ...detail, offers: detail.offers.map(o => {
      const other = captured.offers.find(c => Number(c.user?.id) === o.user.id);
      return { ...o, userAssets: o.userAssets.map(i => {
        const matches = other.userAssets.filter(c => Number(c.assetId || 0) === i.assetId && Number(c.bundleId || 0) === i.bundleId);
        const found = matches.length === 1 ? matches[0] : null;
        return { ...i, id: found?.id ?? null, serialNumber: found?.serialNumber ?? null,
          recentAveragePrice: i.recentAveragePrice || matches[0]?.recentAveragePrice || 0 };
      }) };
    })
  } : detail;
  const a = analyze(raw, detail.perspective, cat, extra, bundleIds);
  const sides = [page.sides[detail.mine], page.sides[1 - detail.mine]];
  for (const [index, key] of ['give', 'get'].entries()) {
    const s = sides[index];
    const robux = amount(s.robux) ? s.robux : 0;
    const net = index === 1 && !s.robuxNet ? netRobux(robux) : robux;
    a[key].rap = amount(s.rapTotal) ? s.rapTotal : a[key].rap + net;
    a[key].value += net;
    a[key].pageRap = amount(s.rapTotal);
  }
  a.rapAvailable = ['give', 'get'].every(k => a[k].pageRap || a[k].items.every(i => i.rap > 0));
  // A basket whose total is known but whose items couldn't be identified
  // would count as worth 0: no Value rather than a false one.
  const blind = page.sides.some(s => amount(s.rapTotal) && s.rapTotal > (amount(s.robux) ? s.robux : 0) && !(s.items || []).length);
  a.valueAvailable = !blind && !a.incomplete && !!cat?.ready && !cat?.veryStale;
  // Why the Value is missing, for the tooltip: otherwise "—" says nothing.
  a.valueMissing = a.valueAvailable ? '' : !cat?.ready ? 'catalog' : cat.veryStale ? 'stale' : 'items';
  a.missingNames = [...a.give.unknownItems, ...a.get.unknownItems].slice(0, 4);
  a.fromPage = true;
  // Keep DOM order and original IDs, including assets resolved to bundles.
  a.pageItems = page.sides.map((side, index) => { let k = 0; return side.items.map(raw => {
    const item = a[index === detail.mine ? 'give' : 'get'].items[k++];
    return { assetId: raw.assetId || 0, bundleId: raw.bundleId || 0, name: raw.byName ? raw.name : undefined,
      value: cat?.ready && !cat?.veryStale && item && !item.noValue && !item.unknown ? item.value : null,
      uaid: item?.uaid ?? null, serial: item?.serial ?? null,
      matchedUaid: !page.composer && samePageOffers(detail, captured) ? item?.uaid ?? null : null,
      instances: samePageOffers(detail, captured) ? (captured.offers.find(o => Number(o.user?.id) === detail.offers[index].user.id)?.userAssets || [])
        .filter(i => Number(i.assetId || 0) === Number(raw.assetId || 0) && Number(i.bundleId || 0) === Number(raw.bundleId || 0))
        .map(i => ({ uaid: i.id, serial: i.serialNumber })) : [],
      noValue: !!item?.noValue, projected: cat?.ready && item ? !!item.projected : null };
  }); });
  a.pageTotals = page.sides.map((side, index) => index === detail.mine ? a.give.value : a.get.value);
  a.deltaRap = a.get.rap - a.give.rap;
  a.deltaValue = a.get.value - a.give.value;
  return a;
}

// Only reuse authoritative item RAP when both displayed offers still match.
export function samePageOffers(detail, captured) {
  return captured?.offers?.length === 2 && detail.offers.every(o => {
    const other = captured.offers.find(c => Number(c.user?.id) === o.user.id);
    return other &&
      itemsKey(other.userAssets || []) === itemsKey(o.userAssets);
  });
}
