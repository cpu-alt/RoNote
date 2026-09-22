// Reevaluation des objets possedes : module pur, aucun reseau.
// Usage : node tools/test-revalue.mjs
import { holdingsOf, detectRevaluations, newestRevision } from '../src/common/revalue.js';

let passed = 0, failed = 0;
function check(label, got, expected) {
  const g = JSON.stringify(got), e = JSON.stringify(expected);
  if (g === e) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}\n      attendu ${e}\n      obtenu  ${g}`); failed++; }
}
const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));

// Fiche au format de roli.js : [nom, acronyme, rap, value].
const fiche = (name, rap, value) => [name, '', rap, value];
const cat = {
  assets: {
    100: fiche('Domino Crown', 4000000, 5000000),
    200: fiche('Sparkle Time Fedora', 60000, 75000),
    300: fiche('Old Face', 9000, 10000)          // ancien exemplaire d'un visage migre
  },
  bundles: {
    900: fiche('Old Face', 9000, 10000),         // le meme visage, devenu bundle
    901: fiche('Another Face', 1500, 2000)
  },
  faceOf: { 900: '300' },
  bundleOf: { 300: '900' }
};

/* ---------------------------------------------------------------------- */
console.log('\nCe que le joueur détient');

check('objets comptés avec leur quantité',
  sorted(holdingsOf({ counts: { 100: 1, 200: 2 } }, cat)), { 'a:100': 1, 'a:200': 2 });
check('visage compté sous son ancien asset : rangé sous son bundle',
  holdingsOf({ counts: { 300: 2 } }, cat), { 'b:900': 2 });
check('bundle limited listé sous son propre id : rangé en bundle',
  holdingsOf({ counts: { 901: 1 } }, cat), { 'b:901': 1 });
check('objet inconnu du catalogue : gardé tel quel',
  holdingsOf({ counts: { 555: 1 } }, cat), { 'a:555': 1 });
check('sans pont (v1 injoignable) : le visage reste sous son ancien asset',
  holdingsOf({ counts: { 300: 1 } }, { ...cat, bundleOf: {} }), { 'a:300': 1 });
check('quantité nulle ou négative ignorée',
  holdingsOf({ counts: { 100: 0, 200: -1 } }, cat), {});
check('rien du tout : rien', holdingsOf(null, cat), {});

/* ---------------------------------------------------------------------- */
console.log('\nLes révisions qui concernent un objet possédé');

const T = 1_700_000_000_000;
const rev = (from, to, at) => ({ from, to, pct: ((to - from) / from) * 100, at });
const changes = {
  'a:100': rev(5000000, 5500000, T + 10),
  'a:200': rev(75000, 70000, T + 10),       // -6.7 %
  'b:900': rev(10000, 13000, T + 10),
  'a:300': rev(10000, 13000, T + 10),       // la meme revision, sous l'ancien id
  'a:777': rev(100, 200, T + 20)            // objet que le joueur n'a pas, plus recent
};
const holdings = { 'a:100': 1, 'a:200': 2, 'b:900': 1 };

let r = detectRevaluations(changes, holdings, cat, { since: T, minPct: 10 });
check('au-dessus du seuil seulement, du plus gros impact au plus petit',
  r.hits.map(h => h.key), ['a:100', 'b:900']);
check('un visage révisé sous ses deux ids ne donne qu\'une alerte',
  r.hits.filter(h => h.name === 'Old Face').length, 1);
check('nom, cotes, quantité et impact de chaque alerte',
  r.hits.map(h => [h.name, h.from, h.to, h.count, h.delta]),
  [['Domino Crown', 5000000, 5500000, 1, 500000], ['Old Face', 10000, 13000, 1, 3000]]);
check('le repère avance jusqu\'à la révision la plus récente, possédée ou non',
  r.latest, T + 20);

r = detectRevaluations(changes, holdings, cat, { since: T, minPct: 5 });
check('une baisse compte aussi, multipliée par la quantité',
  r.hits.find(h => h.key === 'a:200')?.delta, -10000);

r = detectRevaluations(changes, holdings, cat, { since: T + 10, minPct: 0 });
check('déjà vu (au repère ou avant) : aucune alerte', [r.hits.length, r.latest], [0, T + 20]);

r = detectRevaluations({}, holdings, cat, { since: T, minPct: 0 });
check('aucune révision : le repère ne bouge pas', [r.hits.length, r.latest], [0, T]);

r = detectRevaluations({ 'a:300': rev(10000, 12000, T + 5) }, { 'b:900': 1 }, cat, { since: T, minPct: 10 });
check('visage détenu en bundle, révisé sous son ancien id : retrouvé', r.hits.map(h => h.key), ['b:900']);

r = detectRevaluations({ 'b:900': rev(10000, 12000, T + 5) }, { 'a:300': 1 }, cat, { since: T, minPct: 10 });
check('visage compté sous son ancien id, révisé en bundle : retrouvé', r.hits.map(h => h.key), ['a:300']);

r = detectRevaluations({ 'a:555': rev(1000, 2000, T + 5) }, { 'a:555': 1 }, cat, { since: T, minPct: 10 });
check('objet absent du catalogue : l\'alerte garde un nom lisible', r.hits.map(h => h.name), ['#555']);

r = detectRevaluations({ 'a:100': { from: 0, to: 10, pct: NaN, at: T + 5 } }, { 'a:100': 1 }, cat, { since: T, minPct: 0 });
check('pourcentage invalide : ignoré', r.hits.length, 0);

console.log('\nLa révision la plus récente');
check('la plus récente, possédée ou non', newestRevision(changes), T + 20);
check('aucune révision : 0', [newestRevision({}), newestRevision(null)], [0, 0]);

console.log(`\n${passed} réussis, ${failed} échoués`);
process.exit(failed ? 1 : 0);
