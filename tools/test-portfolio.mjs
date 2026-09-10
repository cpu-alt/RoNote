// Les objets du portefeuille : module pur, aucun reseau.
// Usage : node tools/test-portfolio.mjs
import { readFileSync } from 'node:fs';
import { parseItems, mergeSources } from '../src/common/roli.js';
import { holdingsOf } from '../src/common/revalue.js';
import { portfolioItems, portfolioThumbKeys, attachPortfolioThumbs, emptyReport } from '../src/common/portfolio.js';

let passed = 0, failed = 0;
function check(label, got, expected) {
  const g = JSON.stringify(got), e = JSON.stringify(expected);
  if (g === e) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}\n      attendu ${e}\n      obtenu  ${g}`); failed++; }
}
const fixture = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));

/* ---------------------------------------------------------------------- */
console.log('\nInventaire réel anonymisé');

const cat = mergeSources(parseItems(fixture('rolimons-v3-itemdetails.json')), parseItems(fixture('rolimons-itemdetails.json')));
const fx = fixture('portfolio-sample.json');
const owned = fx.bundles.filter(b => b.bundleType === 'DynamicHead');
const holdings = holdingsOf({ counts: fx.playerassets }, owned, cat);
const { items, unrated } = portfolioItems(holdings, cat);
const copies = (list) => list.reduce((s, i) => s + i.count, 0);

check('chaque exemplaire détenu est listé ou compté comme non coté',
  copies(items) + unrated, Object.values(holdings).reduce((s, n) => s + n, 0));
check('du plus gros total au plus petit', items.every((i, n) => !n || items[n - 1].total >= i.total), true);
check('chaque ligne a un nom, une cote, et total = cote × quantité',
  items.every(i => i.name && i.value > 0 && i.total === i.value * i.count && i.totalRap === i.rap * i.count), true);
check('chaque bundle coté possédé est un visage, avec son ancien asset',
  items.filter(i => i.kind === 'bundle').every(i => i.isFace && i.faceAssetId > 0), true);
check('aucun visage listé deux fois (bundle et ancien exemplaire)',
  items.filter(i => i.kind === 'asset' && cat.bundleOf[i.id]).length, 0);
check('chaque objet sait quelle vignette demander', portfolioThumbKeys({ items }).every(k => k.length > 0), true);
console.log(`    (${items.length} objets, ${copies(items)} exemplaires, ${unrated} non cotés)`);

/* ---------------------------------------------------------------------- */
console.log('\nUne ligne d\'objet');

// Fiche normalisee de roli.js : [nom, sigle, rap, value, demande, tendance, projete, rare]
const T = 1_700_000_000_000;
const syn = {
  assets: {
    100: ['Domino Crown', 'DC', 4000000, 5000000, 4, 3, 0, 1],
    200: ['Hype Hat', 'HH', 90000, 0, -1, -1, 1, 0],        // pas de value : RAP en repli
    300: ['Old Face', 'OF', 9000, 10000, 2, 2, 0, 0]
  },
  bundles: { 900: ['Old Face', 'OF', 9000, 10000, 2, 2, 0, 0] },
  faceOf: { 900: '300' },
  bundleOf: { 300: '900' },
  changes: { 'a:300': { from: 10000, to: 13000, pct: 30, at: T } }
};

let r = portfolioItems({ 'a:100': 2, 'a:200': 1, 'b:900': 1, 'a:555': 3 }, syn);
const line = (key) => r.items.find(i => i.key === key);
check('objet absent du catalogue : compté, pas listé', [r.unrated, r.items.length], [3, 3]);
check('total multiplié par la quantité', [line('a:100').count, line('a:100').total], [2, 10000000]);
check('demande, tendance, rare repris du catalogue',
  [line('a:100').demand, line('a:100').trend, line('a:100').rare, line('a:100').projected], [4, 3, true, false]);
check('sans value : le RAP sert de cote, et c\'est signalé', [line('a:200').value, line('a:200').noValue, line('a:200').projected], [90000, true, true]);
check('visage révisé sous son ancien id : révision retrouvée sur le bundle', line('b:900').change?.pct, 30);
check('objet sans révision : aucune', line('a:100').change, null);
check('vignette d\'un visage : image plate d\'abord, tête 3D en repli',
  portfolioThumbKeys({ items: [line('b:900')] })[0], ['a:300', 'b:900']);
check('rien possédé : rien', portfolioItems(null, syn), { items: [], unrated: 0 });
check('rapport vide : liste vide prête à afficher', [emptyReport(1).items, emptyReport(1).unrated], [[], 0]);

const rep = { ghosts: [{ legacyAssetId: 7, bundleId: 8 }], extras: [], items: r.items };
attachPortfolioThumbs(rep, ['g', 'i1', 'i2', null]);
check('vignettes recollées dans l\'ordre : réconciliation puis objets',
  [rep.ghosts[0].thumb, ...rep.items.map(i => i.thumb)], ['g', 'i1', 'i2', null]);

console.log(`\n${passed} réussis, ${failed} échoués`);
process.exit(failed ? 1 : 0);
