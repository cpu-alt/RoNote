// Les objets du portefeuille : module pur, aucun reseau.
// Usage : node tools/test-portfolio.mjs
import { readFileSync } from 'node:fs';
import { parseItems, mergeSources } from '../src/common/roli.js';
import { holdingsOf } from '../src/common/revalue.js';
import { portfolioItems, portfolioThumbKeys, attachPortfolioThumbs, emptyReport, fromRolimons } from '../src/common/portfolio.js';
import { parseItemHistory } from '../src/common/api.js';

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
const holdings = holdingsOf({ counts: fx.playerassets }, cat);
const { items, unrated } = portfolioItems(holdings, cat);
const copies = (list) => list.reduce((s, i) => s + i.count, 0);

check('chaque exemplaire détenu est listé ou compté comme non coté',
  copies(items) + unrated, Object.values(holdings).reduce((s, n) => s + n, 0));
check('du plus gros total au plus petit', items.every((i, n) => !n || items[n - 1].total >= i.total), true);
check('chaque ligne a un nom, une cote, et total = cote × quantité',
  items.every(i => i.name && i.value > 0 && i.total === i.value * i.count && i.totalRap === i.rap * i.count), true);
check('chaque bundle coté possédé est un visage, avec son ancien asset',
  items.filter(i => i.kind === 'bundle').every(i => i.isFace && i.faceAssetId > 0), true);
check('les visages comptés sous leur ancien asset sont rangés sous leur bundle',
  [items.filter(i => i.kind === 'bundle').length, copies(items.filter(i => i.isFace))], [fx.expected.legacyFaces, fx.expected.faces]);
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

const rep = { items: r.items };
attachPortfolioThumbs(rep, ['i1', 'i2', null]);
check('vignettes recollées dans l\'ordre des objets', rep.items.map(i => i.thumb), ['i1', 'i2', null]);

/* ---------------------------------------------------------------------- */
console.log('\nLe rapport : les chiffres de Rolimon\'s, tels quels');

const full = fromRolimons(emptyReport(fx.userId), fx.playerinfo, { counts: fx.playerassets, holds: [], scannedAt: 7 }, cat);
check('value et RAP : ceux du profil Rolimon\'s, sans correction',
  [full.value, full.rap], [fx.expected.value, fx.expected.rap]);
check('inventaire et liste des objets remplis',
  [full.ok, full.partial, full.items.length > 0, !!full.holdings], [true, false, true, true]);
check('date du dernier relevé de la courbe reprise', full.chartScannedAt, 7);
const blind = fromRolimons(emptyReport(1), { value: 10, rap: 9, rank: 3 }, null, cat);
check('inventaire injoignable : chiffres du profil, liste absente et signalée',
  [blind.value, blind.rap, blind.rank, blind.holdings, blind.items, blind.partial], [10, 9, 3, null, [], true]);

/* ---------------------------------------------------------------------- */
console.log('\nHistorique d\'un objet (page Rolimon\'s)');
{
  const now = Date.parse('2026-09-10T12:00:00Z');
  const DAY = 864e5, H = 3600e3;
  const D = Math.floor(now / DAY) * DAY;                              // minuit du jour
  const old = Math.floor((D - 400 * DAY) / (14 * DAY)) * 14 * DAY;    // début d'un seau de 14 jours
  const H2 = Math.floor(now / (2 * H)) * 2 * H;                       // début d'un seau de 2 heures
  const s = (ms) => ms / 1000;
  const history = {
    num_points: 6,
    timestamp: [old + H, old + 2 * H, D - 30 * DAY + H, D - 30 * DAY + 5 * H, H2 - 2 * H + 60e3, H2 + 60e3].map(s),
    rap: [10, 11, 20, 21, 30, 31],
    best_price: [12, 13, 22, 23, 32, 33]
  };
  const changes = [
    [s(old - DAY), 1, null, 1000],
    [s(D - 30 * DAY), 1, 1000, 1500],
    [s(D - 10 * DAY), 3, '2', '0'],          // tendance : pas la value
    [s(H2), 1, 1500, 1200]
  ];
  const html = `<script>var item_id = 1;\nvar history_data = ${JSON.stringify(history)};\nvar value_changes = ${JSON.stringify(changes)};\n</script>`;
  const h = parseItemHistory(html, now);
  check('un point par seau, le dernier relevé du seau',
    h.t, [old + 2 * H, D - 30 * DAY + 5 * H, H2 - 2 * H + 60e3, H2 + 60e3]);
  check('RAP et meilleur prix du même relevé', [h.r, h.p], [[11, 21, 30, 31], [13, 23, 32, 33]]);
  check('value à chaque date : la dernière révision antérieure', h.v, [1000, 1500, 1500, 1200]);
  check('seules les révisions de value, dans la période tracée',
    h.changes, [[D - 30 * DAY, 1000, 1500], [H2, 1500, 1200]]);
  let err = '';
  try { parseItemHistory('<html>rien</html>', now); } catch (e) { err = e.message; }
  check('page sans historique : erreur explicite', err.includes('historique'), true);
}

console.log(`\n${passed} réussis, ${failed} échoués`);
process.exit(failed ? 1 : 0);
