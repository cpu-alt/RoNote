// Onglet Mes items (popup/myitems.js) : best price / RAP de l'inventaire.
// Usage : node tools/test-myitems.mjs
globalThis.chrome = { storage: { local: { async get() { return {}; }, async set() {} }, onChanged: { addListener() {} } }, runtime: { getURL: (x) => x } };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
const { rowsOf } = await import('../src/popup/myitems.js');
let passed = 0, failed = 0;
const check = (l, ok) => { if (ok) { passed++; console.log('  ✓ ' + l); } else { failed++; console.error('  ✗ ' + l); } };
const { rows, unlisted } = rowsOf([
  { id: 1, rap: 1000 }, { id: 2, rap: 500 },            // 2 : personne ne le vend
  { id: 30, kind: 'bundle', faceAssetId: 31, rap: 200 }, // un visage : son ancien asset porte le prix
  { id: 4, rap: 0 }                                      // pas de RAP : pas de ratio
], { 1: 1500, 31: 100, 4: 900 });
check('ratio = best price / RAP', rows[0].ratio === 1.5 && rows[0].gain === 500);
check("visage lu par son ancien asset", rows[1]?.bp === 100 && rows[1].ratio === 0.5 && rows[1].gain === -100);
check('sans vente ou sans RAP : comptés à part', rows.length === 2 && unlisted === 2);
const { totalsOf } = await import('../src/popup/myitems.js');
const tot = totalsOf([{ bp: 1500, gain: 500, count: 2 }, { bp: 100, gain: -100 }]);
check('totaux : revente et profit comptent les copies', tot.worth === 3100 && tot.profit === 1000 && tot.above === 1);
check('items non vendus gardés pour « Pas en vente aussi »', rowsOf([{ id: 9, rap: 50, name: 'x' }], {}).idle[0]?.id === 9);
const { resaleNet } = await import('../src/common/api.js');
check('vente : 30 % de frais, 1 R$ minimum', resaleNet(200) === 140 && resaleNet(2) === 1 && resaleNet(1) === 0);
console.log(`\n${passed} réussis, ${failed} échoués`);
process.exit(failed ? 1 : 0);
