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
let fetches = 0;
const urls = []; globalThis.fetch = async (u) => { fetches++; urls.push(String(u)); return new Response('{}', { status: 500 }); };

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
check('le compte suivi seulement, sans doublon', h.rows.map(r => r.id).join() === '3,1,2');
check('avec ce joueur d’abord, du plus récent au plus ancien', h.rows[0].partnerId === 7 && h.rows[1].partnerId === 7);
check('le @ du pseudo est retiré', h.rows.find(r => r.id === '1').handle === 'bob');
check('encore dans Outbound : en cours', h.rows[0].status === 'open');
check('le total des objets donnés', h.rows.find(r => r.id === '1').value === 300);
check('les Robux sont gardés', h.rows[0].robux === 50);
check('aucune requête réseau', fetches === 0);

for (let i = 0; i < SENT_CAP + 10; i++) await recordSent({ tradeId: 100 + i, partnerId: 1, give: [item(1)] }, 42);
check(`${SENT_CAP} envois au plus`, store.get('sentLog').length === SENT_CAP);
await clearSent();
check('couper l’option efface l’historique', !store.has('sentLog') && (await sentHistory(7, settings)).rows.length === 0);

console.log(`\n${passed} réussis, ${failed} échoués`);
if (failed) process.exit(1);
