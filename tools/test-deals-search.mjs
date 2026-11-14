// Recherche d'items de l'onglet Deals (popup/deals.js) : nom, initiales, id, sans accents.
// Usage : node tools/test-deals-search.mjs
globalThis.chrome = { storage: { local: { async get() { return {}; }, async set() {} }, onChanged: { addListener() {} } }, runtime: { getURL: (x) => x } };
globalThis.localStorage = { getItem() { return null; }, setItem() {} };
const { itemMatches } = await import('../src/popup/deals.js');
let passed = 0, failed = 0;
const check = (l, ok) => { if (ok) { passed++; console.log('  ✓ ' + l); } else { failed++; console.error('  ✗ ' + l); } };
const vv = { id: 1402432199, name: 'Violet Valkyrie' };
check('bout du nom', itemMatches(vv, 'valk'));
check('initiales', itemMatches(vv, 'vv'));
check('id exact', itemMatches(vv, '1402432199'));
check('accents ignorés', itemMatches({ id: 2, name: 'Épée' }, 'epee'));
check('autre item refusé', !itemMatches(vv, 'dominus'));
console.log(`\n${passed} réussis, ${failed} échoués`);
process.exit(failed ? 1 : 0);
