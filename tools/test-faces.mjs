// Les visages dans le temps : module pur, aucun reseau.
// Usage : node tools/test-faces.mjs
import {
  bundleMoves, currentGaps, seriesAt, priceLookup, reconstructCorrections
} from '../src/common/faces.js';

let passed = 0, failed = 0;
function check(label, got, expected) {
  const g = JSON.stringify(got), e = JSON.stringify(expected);
  if (g === e) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}\n      attendu ${e}\n      obtenu  ${g}`); failed++; }
}

// Fiche normalisee de roli.js : [nom, sigle, rap, value, demande, tendance, projete, rare]
const cat = {
  bundles: {
    900: ['Old Face', 'OF', 9000, 10000, 2, 2, 0, 0],
    901: ['Blue Goof', 'BG', 1800, 2000, 2, 2, 0, 0],
    950: ['Kicks', 'K', 600, 700, -1, -1, 0, 0]
  },
  assets: { 300: ['Old Face', 'OF', 9000, 10000, 2, 2, 0, 0] },
  faceOf: { 900: '300' },
  bundleOf: { 300: '900' }
};
const ME = 42;
const trade = (mine, theirs) => ({
  offers: [{ user: { id: ME }, userAssets: mine }, { user: { id: 7 }, userAssets: theirs }]
});
const bundle = (id, typeHint = 'bundle') =>
  (typeHint === 'bundle' ? { bundleId: id, assetId: 0, typeHint } : { bundleId: 0, assetId: id, typeHint });

/* ---------------------------------------------------------------------- */
console.log('\nLes bundles d\'un trade');

check('bundle donné : −1, bundle reçu : +1',
  bundleMoves(trade([bundle(901)], [bundle(900)]), ME, cat), [[901, -1], [900, 1]]);
check('asset ordinaire ou bundle non coté : ignorés',
  bundleMoves(trade([{ assetId: 1048037, bundleId: 0, typeHint: 'asset' }], [bundle(12345)]), ME, cat), []);
check('type inconnu dont l\'identifiant est un bundle coté : compté',
  bundleMoves(trade([], [bundle(950, 'unknown')]), ME, cat), [[950, 1]]);
check('le même bundle donné et reçu : aucun mouvement',
  bundleMoves(trade([bundle(900)], [bundle(900)]), ME, cat), []);
check('mon côté du trade introuvable : on ne devine pas',
  bundleMoves({ offers: [{ user: { id: 1 }, userAssets: [bundle(900)] }] }, ME, cat), null);

/* ---------------------------------------------------------------------- */
console.log('\nL\'écart d\'aujourd\'hui et la cote d\'un jour');

check('bundles en plus comptés positifs, fantômes négatifs',
  currentGaps({ extras: [{ bundleId: 900, count: 1 }, { bundleId: 901, count: 2 }], ghosts: [{ bundleId: 950, count: 1 }] }),
  { 900: 1, 901: 2, 950: -1 });
const hist = { t: [100, 200, 300], v: [10, 20, 30], r: [9, 19, 29] };
check('le dernier relevé avant la date, le premier avant tout',
  [seriesAt(hist, 'v', 250), seriesAt(hist, 'v', 300), seriesAt(hist, 'v', 50)], [20, 30, 10]);
const price = priceLookup({ 900: { t: [100, 200], v: [0, 20000], r: [8000, 9000] } }, cat);
check('value du jour ; avant sa première value, le RAP du jour',
  [price(900, 250), price(900, 150)], [{ value: 20000, rap: 9000 }, { value: 8000, rap: 8000 }]);
check('sans historique : la cote actuelle du catalogue', price(901, 1), { value: 2000, rap: 1800 });

/* ---------------------------------------------------------------------- */
console.log('\nLa courbe rejouée trade par trade');

const DAY = 864e5;
const points = [0, 1, 2, 3, 4, 5].map(d => ({ at: d * DAY }));
const flat = () => ({ value: 100, rap: 90 });
const dv = (ledger, gaps, extra = {}) =>
  reconstructCorrections({ points, ledger, gaps, prices: flat, ...extra }).corrections.map(c => c.dv);

check('visage reçu le jour 2 : compte à partir du jour 2',
  dv([{ at: 2 * DAY - 1000, moves: [[900, 1]] }], { 900: 1 }), [0, 0, 100, 100, 100, 100]);
check('visage donné le jour 3 : fantôme à partir du jour 3',
  dv([{ at: 3 * DAY - 1000, moves: [[900, -1]] }], { 900: -1 }), [0, 0, 0, -100, -100, -100]);
check('reçu le jour 1, redonné le jour 4 : ne compte qu\'entre les deux',
  dv([{ at: DAY - 1000, moves: [[901, 1]] }, { at: 4 * DAY - 1000, moves: [[901, -1]] }], {}), [0, 100, 100, 100, 0, 0]);
check('chaque jour à la cote de ce jour, pas à celle d\'aujourd\'hui',
  reconstructCorrections({
    points, ledger: [{ at: 0, moves: [[900, 1]] }], gaps: { 900: 1 },
    prices: (b, at) => ({ value: 1000 + (at / DAY) * 10, rap: 0 })
  }).corrections.map(c => c.dv), [1000, 1010, 1020, 1030, 1040, 1050]);
{
  const r = reconstructCorrections({
    points, ledger: [{ at: 3 * DAY - 1000, moves: [[901, 1]] }], gaps: { 901: 1, 900: 1 }, prices: flat
  });
  check('bundle sans trade retrouvé : compté depuis le premier mouvement, et signalé',
    [r.corrections.map(c => c.dv), r.unexplained], [[0, 0, 0, 200, 200, 200], { 900: 1 }]);
}
check('parcours pas encore fini : rien avant le plus ancien trade lu',
  reconstructCorrections({ points, ledger: [], gaps: { 900: 1 }, prices: flat, coveredFrom: 3 * DAY })
    .corrections.map(c => c.at / DAY), [3, 4, 5]);
check('RAP et nombre d\'exemplaires suivent la même règle',
  reconstructCorrections({ points: [{ at: 0 }], ledger: [], gaps: { 900: 2, 950: -1 }, prices: flat }).corrections,
  [{ at: 0, dv: 100, dr: 90, dn: 1 }]);

console.log(`\n${passed} réussis, ${failed} échoués`);
process.exit(failed ? 1 : 0);
