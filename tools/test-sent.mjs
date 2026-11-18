// Tests de l'historique d'envoi (background/sent.js) : un envoi vu sur la page est gardé en
// local, trié « avec ce joueur d'abord », filtré par compte Roblox, sans aucun réseau ; couper
// l'option l'efface. Usage : node tools/test-sent.mjs
const store = new Map();
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
globalThis.chrome = {
  storage: { local: {
    async get(keys) { const o = {}; for (const k of [].concat(keys ?? [...store.keys()])) if (store.has(k)) o[k] = clone(store.get(k)); return o; },
    async set(obj) { for (const [k, v] of Object.entries(obj)) store.set(k, clone(v)); },
    async remove(k) { for (const x of [].concat(k)) store.delete(x); }
  }, session: { async get() { return {}; }, async set() {} } },
  runtime: { getManifest: () => ({ version: '0' }) }
};
// Roblox simulé : mes listes de trades et leur détail (le rattrapage des trades déjà envoyés).
const day = (n) => new Date(Date.now() - n * 864e5).toISOString();
const ROUTES = {
  '/v1/trades/outbound': { data: [{ id: 50, user: { id: 7, name: 'bob' }, created: day(5), status: 'Open' }] },
  '/v1/trades/inactive': { data: [{ id: 51, user: { id: 9, name: 'eve' }, created: day(6), status: 'Declined' },
    { id: 52, user: { id: 9, name: 'eve' }, created: day(7), status: 'Declined' }] },
  '/v1/trades/completed': { data: [] },
  '/v1/trades/50': { id: 50, offers: [{ user: { id: 42 }, userAssets: [{ assetId: 2001, name: 'Old Hat', recentAveragePrice: 5 }], robux: 0 }, { user: { id: 7, name: 'bob' }, userAssets: [], robux: 0 }] },
  '/v1/trades/51': { id: 51, offers: [{ user: { id: 9 }, userAssets: [{ assetId: 2002, name: 'Not Mine' }], robux: 0 }, { user: { id: 42 }, userAssets: [], robux: 0 }] },
  '/v1/trades/52': { id: 52, offers: [{ user: { id: 42 }, userAssets: [{ assetId: 2003, name: 'Seen Inbound' }], robux: 0 }, { user: { id: 9 }, userAssets: [], robux: 0 }] }
};
let fetches = 0, roblox = false;
const urls = [];
globalThis.fetch = async (u) => {
  fetches++; urls.push(String(u));
  const path = new URL(String(u)).pathname;
  if (roblox && ROUTES[path]) return new Response(JSON.stringify(ROUTES[path]), { status: 200, headers: { 'content-type': 'application/json' } });
  return new Response('{}', { status: 500 });
};

const { recordSent, sentHistory, clearSent, SENT_CAP } = await import('../src/background/sent.js');
let passed = 0, failed = 0;
const check = (label, ok) => { if (ok) { passed++; console.log('  ✓ ' + label); } else { failed++; console.error('  ✗ ' + label); } };

store.set('state', { userId: 42, snapshot: { outbound: [{ tradeId: 3 }] } });
store.set('rolimons', null);
const item = (n) => ({ assetId: 1000 + n, name: 'Item ' + n, rap: 100 * n, thumb: 'https://tr.rbxcdn.com/abc/150/150/Image/Png' });
const settings = { useRolimons: false };

check('rien sans numéro de trade', !(await recordSent({ give: [item(1)] }, 42)));
check('rien sans rien donné', !(await recordSent({ tradeId: 9, give: [] }, 42)));
await recordSent({ tradeId: 1, at: Date.now() - 3e6, partnerId: 7, handle: '@bob', give: [item(1), item(2)] }, 42);
await recordSent({ tradeId: 2, at: Date.now() - 1e6, partnerId: 8, handle: 'amy', give: [item(3)] }, 42);
await recordSent({ tradeId: 3, at: Date.now() - 2e6, partnerId: 7, handle: 'bob', give: [item(4)], robux: 50 }, 42);
await recordSent({ tradeId: 4, at: Date.now(), partnerId: 7, give: [item(5)] }, 99);      // un autre compte Roblox
await recordSent({ tradeId: 2, at: Date.now() - 1e6, partnerId: 8, give: [item(3)] }, 42); // le même trade : pas en double

const h = await sentHistory(7, settings);
check('le compte suivi seulement, sans doublon', h.items.length === 4 && !h.items.some(i => i.name === 'Item 5'));
check('le @ du pseudo est retiré', store.get('sentLog').find(e => e.id === '1').handle === 'bob');
check('les Robux sont gardés', store.get('sentLog').find(e => e.id === '3').robux === 50);
check('la value de chaque objet', h.items.find(i => i.name === 'Item 1').value === 100);
check('mes objets récents : un par objet, le plus récent d’abord', h.items.map(i => i.name).join() === 'Item 3,Item 4,Item 1,Item 2');
check('… avec le nombre de fois et « avec ce joueur »', h.items[0].n === 1 && !h.items[0].withThem && h.items[1].withThem);
check('aucune vignette redemandée (celles de la page sont gardées)', !urls.some(u => u.includes('thumbnails.roblox.com')));

// Le rattrapage : un trade en cours envoyé (gardé), un trade reçu (écarté : l'autre offre d'abord),
// un trade déjà vu sur le flux Inbound de RoNote (écarté).
await clearSent();
store.set('streams', { inbound: { seen: [52] } });
roblox = true; fetches = 0;
const r = await sentHistory(7, settings);
const log = store.get('sentLog') || [];
check('le rattrapage reprend un trade déjà envoyé', log.some(e => e.id === '50' && e.give[0].name === 'Old Hat' && e.handle === 'bob'));
check('… sans un trade reçu', !log.some(e => e.id === '51'));
check('… ni un trade vu en Inbound', !log.some(e => e.id === '52'));
check('… et ses objets arrivent dans la liste', r.items.some(i => i.name === 'Old Hat' && i.withThem));
const avant = fetches;
await clearSent();
await recordSent({ tradeId: 60, partnerId: 7, give: [item(1)] }, 42);
await sentHistory(8, settings);
check('le rattrapage ne relit pas un trade gardé', !urls.slice(avant).some(u => /\/v1\/trades\/50$/.test(u)) || store.get('sentLog').filter(e => e.id === '50').length === 1);
roblox = false;

for (let i = 0; i < SENT_CAP + 10; i++) await recordSent({ tradeId: 100 + i, partnerId: 1, give: [item(1)] }, 42);
check(`${SENT_CAP} envois au plus`, store.get('sentLog').length === SENT_CAP);
await clearSent();
check('couper l’option efface l’historique', !store.has('sentLog') && (await sentHistory(7, settings)).items.length === 0);

console.log(`\n${passed} réussis, ${failed} échoués`);
if (failed) process.exit(1);
