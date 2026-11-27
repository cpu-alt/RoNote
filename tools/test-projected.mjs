// Tests du vrai prix d'un projected (common/projected-estimate.js, Elite) : le calcul de
// /projected check (Neuronal, analyser_projected) porté en JS, sur la page item Rolimon's
// (history_data + sales_data). Cas réel : Crazy Spiked Hood, pumpé en août 2025, ~20k en vrai.
// Puis les revendeurs Roblox et la lecture Neuronal. Aucun réseau (fetch simulé).
// Usage : node tools/test-projected.mjs
const store = new Map();
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
globalThis.chrome = {
  storage: { local: {
    async get(keys) { const o = {}; for (const k of [].concat(keys)) if (store.has(k)) o[k] = clone(store.get(k)); return o; },
    async set(obj) { for (const [k, v] of Object.entries(obj)) store.set(k, clone(v)); }
  }, session: { async get() { return {}; }, async set() {} } },
  runtime: { getManifest: () => ({ version: '0' }) },
  permissions: { contains: async () => true }
};
let fetched = [];
let answer = () => ({});
globalThis.fetch = async (url) => {
  fetched.push(String(url));
  const r = answer(String(url));
  if (typeof r === 'string') return new Response(r, { status: 200, headers: { 'content-type': 'text/html' } });
  return new Response(JSON.stringify(r.body ?? r), { status: r.status || 200, headers: { 'content-type': 'application/json' } });
};

const { estimateProjected, roundNice, detectPump, dailySeries } = await import('../src/common/projected-estimate.js');
const { parseProjectedSource, getProjectedSource } = await import('../src/common/api.js');

let passed = 0, failed = 0;
const check = (name, ok, extra = '') => { ok ? passed++ : failed++; console.log((ok ? '  ok  ' : '  ÉCHEC ') + name + (ok ? '' : '  ' + extra)); };

const NOW = Date.parse('2026-11-27T12:00:00Z');
const NOW_S = NOW / 1000;
const day = (n) => new Date(NOW - n * 864e5).toISOString();
const sec = (iso) => Date.parse(iso + 'T12:00:00Z') / 1000;

// Crazy Spiked Hood (105340931), relevé sur Rolimon's le 27 nov. 2026 : [date, RAP, best price].
const HOOD = [['2024-11-19', 5315, 5000], ['2024-12-11', 5105, 5495], ['2025-01-24', 4995, 5495], ['2025-02-15', 4895, 4991],
  ['2025-03-09', 4798, 4600], ['2025-04-11', 4718, 4889], ['2025-05-11', 4642, 4698], ['2025-05-31', 4571, 4600],
  ['2025-06-30', 4595, 24500], ['2025-07-30', 4365, 24900], ['2025-08-09', 4921, 24900], ['2025-08-19', 18305, 149000],
  ['2025-08-29', 47247, 99900], ['2025-09-08', 72523, 88888], ['2025-12-17', 67770, 40000], ['2026-04-06', 62993, 74999],
  ['2026-06-05', 62993, 45000], ['2026-07-07', 58794, 74999], ['2026-08-08', 55415, 58800], ['2026-09-17', 55415, 27998],
  ['2026-10-03', 52223, 24500], ['2026-11-20', 49200, 21998], ['2026-11-27', 49200, 21998]];
const HOOD_SALES = [['2025-01-10', 4000, 1], ['2025-02-12', 4000, 1], ['2025-02-28', 4912, 1], ['2025-04-04', 4000, 1],
  ['2025-05-10', 3950, 1], ['2025-05-31', 4599, 1], ['2025-06-27', 4700, 1], ['2025-07-16', 4425, 1], ['2025-07-22', 2700, 2],
  ['2025-07-28', 5000, 2], ['2025-08-04', 3500, 1], ['2025-08-07', 10700, 1], ['2025-08-15', 24900, 1],
  ['2025-08-19', 65000, 2], ['2025-08-22', 138000, 1], ['2025-08-26', 200000, 1], ['2025-09-08', 300000, 1],
  ['2025-12-15', 25000, 1], ['2026-04-03', 20000, 1], ['2026-07-07', 21000, 1], ['2026-08-03', 25000, 1],
  ['2026-09-27', 23499, 1], ['2026-11-18', 21997, 1]];
function series(points, sales) {
  const src = { ts: [], rap: [], best: [], salesTs: [], salesPrice: [], salesVol: [] };
  for (let k = 0; k < points.length - 1; k++) {
    for (let t = sec(points[k][0]); t < sec(points[k + 1][0]); t += 86400) {
      src.ts.push(t); src.rap.push(points[k][1]); src.best.push(points[k][2]);
    }
  }
  const last = points[points.length - 1];
  src.ts.push(sec(last[0])); src.rap.push(last[1]); src.best.push(last[2]);
  for (const [d, p, v] of sales) { src.salesTs.push(sec(d)); src.salesPrice.push(p); src.salesVol.push(v); }
  return src;
}
const hood = series(HOOD, HOOD_SALES);

let e = estimateProjected(hood, { bestNow: 21998, now: NOW_S });
check('Crazy Spiked Hood : Fair 20 000 (ce que les gens donnent)', e?.fair === 20000, JSON.stringify(e));
check('Crazy Spiked Hood : Lowball 16 000 / Max 21 000', e?.low === 16000 && e?.high === 21000, JSON.stringify(e));
check('le pump est celui d’août 2025', e?.pumped && new Date(e.pumpTs * 1000).toISOString().startsWith('2025-08-19'), String(e?.pumpTs));
check('la base est le RAP d’avant le pump', e && e.base >= 4300 && e.base <= 5000, String(e?.base));
check('les ventes de pumpeurs ne comptent pas', e?.sales === 6, String(e?.sales));

e = estimateProjected(hood, { bestNow: 15000, now: NOW_S });
check('plafonné au best price', e?.fair === 15000 && e.high === 15000, JSON.stringify(e));
e = estimateProjected(hood, { value: 30000, now: NOW_S });
check('une vraie Value Rolimon’s passe devant', e?.basis === 'value' && e.base === 30000, JSON.stringify(e));
e = estimateProjected(hood, { demand: 3, bestNow: 99999, now: NOW_S });
check('la demande ajoute 5 %', e?.fair === 21000, JSON.stringify(e));

// Pumps enchaînés : un premier saut 3 mois avant le gros, la base se prend avant le premier.
const chained = series([['2025-01-01', 10000, 0], ['2026-05-01', 14000, 0], ['2026-08-01', 60000, 0], ['2026-11-27', 60000, 0]], []);
const full = dailySeries(chained.ts, chained.rap, 3650, NOW_S);
const i = detectPump(full, dailySeries(chained.ts, chained.rap, 730, NOW_S), null, NOW_S);
check('pumps enchaînés : on recule au premier', new Date(full[i][0] * 1000).toISOString().startsWith('2026-05-01'), new Date(full[i][0] * 1000).toISOString());

check('sans historique : rien', estimateProjected({ ts: [], rap: [] }) === null);
check('arrondi comme Discord', roundNice(78432) === 78500 && roundNice(1234567) === 1235000 && roundNice(87) === 100 && roundNice(9940) === 9900);

// La page Rolimon's : un point par jour (dernier RAP, plus bas best price), ventes telles quelles.
const html = `<script>var history_data = {"timestamp":[1700000000,1700003600,1700090000],"rap":[100,120,130],"best_price":[90,80,95]};
var sales_data = {"timestamp":[1700000000],"avg_daily_sales_price":[110],"sales_volume":[2]};</script>`;
const src = parseProjectedSource(html);
check('page Rolimon’s : un point par jour', src.ts.length === 2 && src.rap.join() === '120,130' && src.best.join() === '80,95', JSON.stringify(src));
check('page Rolimon’s : ventes lues', src.salesPrice[0] === 110 && src.salesVol[0] === 2);
let threw = false;
try { parseProjectedSource('<html></html>'); } catch { threw = true; }
check('page sans historique : erreur', threw);
answer = () => html;
const got = await getProjectedSource(105340931);
check('lu sur rolimons.com/item/<id>', got.rap.length === 2 && fetched.some(u => u === 'https://www.rolimons.com/item/105340931'));

// getResellers (27 nov. : catalogue → collectibleItemId → marketplace-sales) : triés du moins
// cher, 5 au plus, best price = le premier, gardés 60 s ; l'ancienne route economy n'est plus appelée.
const { getResellers } = await import('../src/common/api.js');
fetched = [];
let sellers = [7, 3, 9, 4, 8, 5, 6];
answer = (url) => url.includes('/catalog/items/details') ? { data: [{ collectibleItemId: 'abc', lowestResalePrice: 999 }] }
  : url.includes('/marketplace-sales/v1/item/abc/resellers') ? { data: sellers.map((p, n) => ({ seller: { sellerId: n + 1, name: 'u' + n }, price: p * 1000, serialNumber: n })) }
  : { status: 410, body: { errors: [{ code: 5 }] } };
let sale = await getResellers('asset', 42, NOW);
check('5 revendeurs, du moins cher', sale.resellers.length === 5 && sale.resellers.map(r => r.price).join() === '3000,4000,5000,6000,7000', JSON.stringify(sale));
check('best price = le moins cher, vendeur nommé', sale.best === 3000 && sale.resellers[0].name === 'u1' && sale.resellers[0].id === 2);
check('nouvelle route seulement', fetched.every(u => !u.includes('/v1/assets/42/resellers')) && fetched.some(u => u.includes('marketplace-sales')));
const n = fetched.length;
await getResellers('asset', 42, NOW + 30e3);
check('gardés 60 s', fetched.length === n, fetched.length);
await getResellers('asset', 42, NOW + 61e3);
check('relus après 60 s', fetched.length > n);
sellers = [];
sale = await getResellers('bundle', 43, NOW);
check('personne en revente listée : le plus bas du catalogue', sale.best === 999 && sale.resellers.length === 0);

// neuronalProjected (27 nov.) : le Lowball / Fair / Max de /projected check, gardé 5 min par item ;
// un refus ou une panne rend la réponse telle quelle (le worker retombe sur son calcul).
const { neuronalProjected } = await import('../src/background/neuronal.js');
fetched = [];
answer = (url) => url.includes('/ext/v1/projected?ids=')
  ? { items: { 500: { low: 13000, fair: 16000, high: 17000, rap: 60000, confidence: 'high', source: 'pump' }, 501: null } } : {};
let nw = await neuronalProjected([500, 501], NOW);
check('Neuronal : le Fair de Discord', nw.items[500].fair === 16000 && nw.items[501] === null, JSON.stringify(nw));
check('Neuronal : une seule requête pour deux items', fetched.filter(u => u.includes('/ext/v1/projected')).length === 1
  && fetched.some(u => u.includes('ids=500,501')));
await neuronalProjected([500], NOW + 60e3);
check('Neuronal : gardé 5 min', fetched.filter(u => u.includes('/ext/v1/projected')).length === 1);
answer = () => ({ status: 403, body: { error: 'subscribe' } });
nw = await neuronalProjected([502], NOW);
check('Neuronal : un refus remonte (repli local)', nw.locked === 'subscribe' && !nw.items, JSON.stringify(nw));

// 27 nov. (« ça prend 50 ans à charger ») : la page Rolimon's est lue UNE fois pour le graphique
// et le calcul ; un Neuronal absent n'est pas redemandé avant 10 min.
const { getItemHistory, rolimonsItemHtml } = await import('../src/common/api.js');
fetched = [];
answer = () => html;
await Promise.all([getItemHistory(777), getProjectedSource(777), rolimonsItemHtml(777)]);
check('une seule lecture de la page Rolimon’s pour tout', fetched.filter(u => u.endsWith('/item/777')).length === 1, fetched.length);
const { neuronalProjected: np2 } = await import('../src/background/neuronal.js');
fetched = [];
answer = () => ({ status: 404, body: {} });
const a1 = await np2([900], NOW + 1e6);
const a2 = await np2([901, 902], NOW + 1e6 + 60e3);
check('Neuronal absent : mémorisé, pas redemandé', a1.unavailable && a2.unavailable && fetched.length === 1, fetched.length);
answer = (url) => ({ items: { 903: { low: 1, fair: 2, high: 3, rap: 9 } } });
const a3 = await np2([903], NOW + 1e6 + 11 * 60e3);
check('Neuronal redemandé après 10 min', a3.items?.[903]?.fair === 2 && fetched.length === 2, fetched.length);

console.log(`\n${passed} réussis, ${failed} échoués`);
if (failed) process.exit(1);
