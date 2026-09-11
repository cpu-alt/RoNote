// Les nouveautés affichées dans les réglages : données pures.
// Usage : node tools/test-changelog.mjs
import { readFileSync } from 'node:fs';
import { RELEASES } from '../src/common/changelog.js';

let passed = 0, failed = 0;
function check(label, got, expected) {
  const g = JSON.stringify(got), e = JSON.stringify(expected);
  if (g === e) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}\n      attendu ${e}\n      obtenu  ${g}`); failed++; }
}

const manifest = JSON.parse(readFileSync(new URL('../src/manifest.json', import.meta.url), 'utf8'));
const parts = (v) => v.split('.').map(Number);
const newer = (a, b) => {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

console.log('\nQuoi de neuf');
check('la version du manifeste a ses nouveautés', RELEASES.some(r => r.version === manifest.version), true);
check('la version en préparation, s’il y en a une, est en tête', RELEASES.findIndex(r => !r.version) <= 0, true);
const versions = RELEASES.filter(r => r.version).map(r => r.version);
check('de la plus récente à la plus ancienne, sans doublon', versions.every((v, i) => !i || newer(versions[i - 1], v)), true);
check('chaque titre existe dans les deux langues', RELEASES.every(r => r.title?.fr && r.title?.en), true);
check('chaque version a au moins une évolution', RELEASES.every(r => r.items?.length > 0), true);
check('chaque évolution existe dans les deux langues', RELEASES.flatMap(r => r.items).every(i => i.fr && i.en), true);
check('dates au format AAAA-MM-JJ', RELEASES.every(r => !r.date || /^\d{4}-\d{2}-\d{2}$/.test(r.date)), true);
check('aucun emoji dans les textes',
  RELEASES.flatMap(r => [r.title, ...r.items]).every(s => !/\p{Extended_Pictographic}/u.test(s.fr + s.en)), true);

console.log(`\n${passed} réussis, ${failed} échoués.`);
if (failed) process.exit(1);
