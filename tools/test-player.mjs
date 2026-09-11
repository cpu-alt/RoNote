// La fiche d'un joueur : module pur, aucun reseau.
// Usage : node tools/test-player.mjs
import { readFileSync } from 'node:fs';
import { historyFor, partnerTimeline, partnerStats, accountAge, thinSeries, playerFaces, YOUNG_ACCOUNT_DAYS } from '../src/common/player.js';
import { parseItems, mergeSources } from '../src/common/roli.js';
import { holdingsOf } from '../src/common/revalue.js';
import { reconcile, emptyReport, portfolioItems } from '../src/common/portfolio.js';

const fixture = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8'));

let passed = 0, failed = 0;
function check(label, got, expected) {
  const g = JSON.stringify(got), e = JSON.stringify(expected);
  if (g === e) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}\n      attendu ${e}\n      obtenu  ${g}`); failed++; }
}

const bob = { id: 261, name: 'Shedletsky', displayName: 'Shed' };
const H = 3600e3, T = Date.parse('2026-09-10T12:00:00Z');

/* ---------------------------------------------------------------------- */
console.log('\nLe journal de ce joueur');

const history = [
  { at: T - 1 * H, kind: 'inbound', tradeId: 1, partner: 'Shed', partnerId: 261, pct: -40, give: 1000, get: 600, unknown: 0 },
  { at: T - 2 * H, kind: 'inbound', tradeId: 2, partner: 'Shed', partnerId: 261, pct: 10, give: 1000, get: 1100, unknown: 0 },
  { at: T - 0.5 * H, kind: 'declined_by_me', tradeId: 1, partner: 'Shed', partnerId: 261, skipped: 'refusé depuis RoNote' },
  { at: T - 5 * H, kind: 'completed', tradeId: 3, partner: 'shedletsky', partnerId: null, pct: 20, give: 500, get: 600, unknown: 0 },
  { at: T - 6 * H, kind: 'inbound', tradeId: 4, partner: 'Shed', partnerId: 999, pct: 5 },
  { at: T - 7 * H, kind: 'revalued', name: 'Domino Crown', partner: 'Shed' },
  { at: T - 8 * H, kind: 'outbound_declined', tradeId: 5, partner: 'Shed', partnerId: 261, pct: 2, give: 300, get: 306 }
];
const mine = historyFor(history, bob);
check('par identifiant, et par nom seulement quand l’entrée n’a pas d’identifiant',
  mine.map(h => h.tradeId), [1, 2, 1, 3, 5]);
check('un homonyme au nom identique mais d’un autre identifiant est écarté',
  historyFor(history, bob).some(h => h.tradeId === 4), false);
check('journal vide ou absent', [historyFor(null, bob), historyFor([], bob)], [[], []]);

/* ---------------------------------------------------------------------- */
console.log('\nUne ligne par trade');

const live = [
  { tradeId: 2, kind: 'inbound', created: new Date(T - 2 * H).toISOString(),
    analysis: { incomplete: false, pctMain: 12, mainGive: 1000, mainGet: 1120 } },
  { tradeId: 6, kind: 'outbound', created: T - 30 * H, analysis: null },
  { tradeId: 3, kind: 'completed', created: T - 5 * H, analysis: null }
];
const rows = partnerTimeline(mine, live);
check('un trade à plusieurs traces ne compte qu’une fois', rows.map(r => r.tradeId), [1, 2, 3, 5, 6]);
check('dernier état connu : reçu puis refusé depuis RoNote',
  [rows[0].kind, rows[0].dir, rows[0].at], ['declined_by_me', 'in', T - 0.5 * H]);
check('le chiffre du trade reste celui de son évaluation', [rows[0].pct, rows[0].give, rows[0].get], [-40, 1000, 600]);
check('le popup a le dernier mot sur l’évaluation', [rows[1].pct, rows[1].get, rows[1].open], [12, 1120, true]);
check('un trade envoyé encore ouvert, absent du journal', [rows[4].kind, rows[4].dir, rows[4].open, rows[4].at], ['outbound', 'out', true, T - 30 * H]);
check('un trade terminé reste terminé', [rows[2].kind, rows[2].done, rows[2].open], ['completed', true, false]);

/* ---------------------------------------------------------------------- */
console.log('\nLe bilan de la relation');

const s = partnerStats(rows);
check('offres reçues, envoyées, conclues', [s.received, s.sent, s.done], [2, 2, 1]);
check('gain moyen de ses offres (−40 % et +12 %)', [s.rated, s.avgIn], [2, -14]);
check('bilan des trades conclus', s.net, 100);
check('dernier échange', s.last, T - 0.5 * H);
check('aucun échange : aucun chiffre inventé', partnerStats([]), { received: 0, sent: 0, done: 0, rated: 0, avgIn: null, net: null, last: 0 });
check('un trade sans cote ne fausse pas la moyenne',
  partnerStats(partnerTimeline([{ at: T, kind: 'inbound', tradeId: 9, partnerId: 261, pct: null, unknown: 2 }], [])).avgIn, null);

/* ---------------------------------------------------------------------- */
console.log('\nÂge du compte');

const day = 864e5;
check('en jours sous deux mois', accountAge(T - 12 * day, T), { n: 12, unit: 'day', days: 12 });
check('en mois sous deux ans', accountAge(T - 400 * day, T).unit + accountAge(T - 400 * day, T).n, 'month13');
check('en années ensuite', accountAge(T - 3700 * day, T).unit + accountAge(T - 3700 * day, T).n, 'year10');
check('date absente ou future : rien', [accountAge(0, T), accountAge(T + day, T)], [null, null]);
check('un compte de 12 jours est récent', accountAge(T - 12 * day, T).days < YOUNG_ACCOUNT_DAYS, true);

/* ---------------------------------------------------------------------- */
console.log('\nHistorique d’inventaire allégé');

const daily = Array.from({ length: 3000 }, (_, i) => ({ at: T - (2999 - i) * day, v: i, r: i, n: 1 }));
const thin = thinSeries(daily, 400, T);
check('au plus 400 relevés', thin.length <= 400, true);
check('premier et dernier relevés gardés', [thin[0].at, thin[thin.length - 1].at], [daily[0].at, daily[2999].at]);
check('les 90 derniers jours restent complets',
  thin.filter(p => p.at >= T - 90 * day).length, daily.filter(p => p.at >= T - 90 * day).length);
check('dans l’ordre du temps, sans doublon', thin.every((p, i) => !i || thin[i - 1].at < p.at), true);
check('un historique court passe tel quel', thinSeries(daily.slice(0, 50), 400, T).length, 50);
check('relevés sans date écartés', thinSeries([{ at: 0 }, null, { at: T }], 400, T).length, 1);

/* ---------------------------------------------------------------------- */
console.log('\nSes bundles (inventaire réel anonymisé)');

const cat = mergeSources(parseItems(fixture('rolimons-v3-itemdetails.json')), parseItems(fixture('rolimons-itemdetails.json')));
const fx = fixture('portfolio-sample.json');
const owned = fx.bundles.filter(b => b.bundleType === 'DynamicHead');
const rep = reconcile({ ...emptyReport(fx.userId), rolimons: fx.playerinfo }, fx.playerinfo,
  { counts: fx.playerassets, holds: [] }, owned, cat);
Object.assign(rep, portfolioItems(holdingsOf({ counts: fx.playerassets }, owned, cat), cat));
const pf = playerFaces(rep);

check('chaque bundle coté possédé est listé, avec sa quantité',
  pf.faces.filter(f => f.kind === 'bundle').reduce((s, f) => s + f.count, 0), rep.ownedFaces);
check('ceux qu’il n’a plus sont les fantômes de la réconciliation',
  [pf.ghosts.length, pf.ghostValue, pf.ghosts.map(g => g.name)], [rep.ghosts.length, rep.ghostValue, rep.ghosts.map(g => g.name)]);
check('les bundles que Rolimon’s ne voit pas sont marqués',
  pf.faces.filter(f => f.ignored).map(f => f.id).sort(), rep.extras.map(e => e.bundleId).sort());
check('du plus gros total au plus petit', pf.faces.every((f, n) => !n || pf.faces[n - 1].total >= f.total), true);
check('value corrigée et value Rolimon’s', [pf.value, pf.rawValue, pf.corrected], [rep.value, fx.playerinfo.value, rep.corrected]);
check('rapport absent : rien', playerFaces(null), null);
check('inventaire privé : aucune liste inventée',
  (({ private: p, faces, ghosts }) => [p, faces, ghosts])(playerFaces({ ...emptyReport(1), ok: false, private: true })), [true, [], []]);
console.log(`    (${pf.faces.length} bundles, ${pf.ghosts.length} qu’il n’a plus)`);

console.log(`\n${passed} réussis, ${failed} échoués.`);
if (failed) process.exit(1);
