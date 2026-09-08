/**
 * LE MONDE ISOLÉ, REPRODUIT À L'IDENTIQUE.
 *
 * Les scripts de contenu d'une même extension ne sont pas des îlots : dans un
 * onglet donné, ils s'exécutent tous dans le MÊME espace global. Deux fichiers
 * qui déclarent `const B` au niveau supérieur, et le second ne s'exécute
 * jamais — « Identifier 'B' has already been declared », le fichier entier est
 * perdu avant sa première ligne, sans que rien ne s'affiche nulle part.
 *
 * C'est exactement ce qui est arrivé : `relay.js` et `scrape.js` déclaraient
 * chacun `const B`. Le second n'a jamais démarré.
 *
 * Ce test charge les fichiers dans UN seul contexte, dans l'ordre du
 * manifeste, comme le navigateur le fait. Une collision de nom le fait tomber.
 *
 * Usage : node tools/test-content.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const src = (f) => readFileSync(join(here, '../src/content/', f), 'utf8');
const manifest = JSON.parse(readFileSync(join(here, '../src/manifest.json'), 'utf8'));

let passed = 0, failed = 0;
function check(label, got, expected) {
  const g = JSON.stringify(got), e = JSON.stringify(expected);
  if (g === e) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}\n      attendu ${e}\n      obtenu  ${g}`); failed++; }
}

/* ------------------------- un onglet, en toc ---------------------------- */

/** Un élément de page suffisamment complet pour survivre au chargement. */
const node = () => ({
  style: {}, dataset: {}, className: '', textContent: '', innerText: '',
  children: [], childNodes: [], hidden: false,
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  appendChild() {}, remove() {}, insertAdjacentElement() {},
  addEventListener() {}, removeEventListener() {},
  setAttribute() {}, getAttribute: () => null,
  querySelector: () => null, querySelectorAll: () => [],
  getBoundingClientRect: () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
});

function tab() {
  const ctx = vm.createContext({
    console, setTimeout, clearTimeout, setInterval, clearInterval,
    URLSearchParams, JSON, Math, Date, Number, String, Object, Array,
    Promise, Set, Map, RegExp, Error, isNaN, parseInt, parseFloat
  });
  ctx.globalThis = ctx;
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.addEventListener = () => {};
  ctx.innerWidth = 1280;
  ctx.innerHeight = 800;
  ctx.location = {
    pathname: '/trades', search: '?tab=Outbound',
    href: 'https://www.roblox.com/trades?tab=Outbound', origin: 'https://www.roblox.com'
  };
  ctx.navigator = { language: 'fr-FR' };
  ctx.MutationObserver = class { observe() {} disconnect() {} };
  ctx.document = {
    ...node(),
    documentElement: node(), body: node(), head: node(),
    createElement: node, createTreeWalker: () => ({ nextNode: () => null }),
    getElementById: () => null
  };
  ctx.chrome = {
    runtime: {
      getURL: (p) => 'chrome-extension://test/' + p,
      getManifest: () => ({ version: manifest.version }),
      sendMessage: async () => ({}),
      onMessage: { addListener() {} }
    },
    storage: { local: { get: async () => ({}), set: async () => {} }, onChanged: { addListener() {} } }
  };
  return ctx;
}

/* ------------------------------ le test --------------------------------- */

// L'ordre du manifeste EST la dépendance : tradedom pose
// `RoNoteLib` / `RoNoteDom`, les autres s'en servent.
const files = (manifest.content_scripts || [])
  .filter(cs => cs.world !== 'MAIN')
  .flatMap(cs => cs.js || [])
  .map(p => p.replace('content/', ''));

console.log('\nTous les scripts de contenu dans un seul espace global');
check('les fichiers viennent du manifeste', files.length > 1, true);

const ctx = tab();
let boom = null;
for (const f of files) {
  try {
    vm.runInContext(src(f), ctx, { filename: f });
    console.log(`  ✓ ${f}`);
    passed++;
  } catch (e) {
    // Une collision de nom se voit ICI, et nulle part ailleurs : dans un
    // navigateur, le fichier est simplement perdu sans un mot.
    console.error(`  ✗ ${f} — ${e?.message || e}`);
    boom = f;
    failed++;
  }
}
check('aucun fichier perdu au chargement', boom, null);

console.log('\nLe point de rendez-vous entre fichiers');
check('content/tradedom.js publie RoNoteDom', typeof ctx.RoNoteDom, 'object');
check('… et rien d\'autre ne fuit', Object.keys(ctx).filter(k => k === 'B' || k === 'PANEL_ID'), []);

console.log('\nCharger deux fois de suite ne casse rien');
// Une navigation dans l'application monopage peut faire rejouer un script.
let again = null;
try {
  for (const f of files) vm.runInContext(src(f), ctx, { filename: f });
} catch (e) { again = String(e?.message || e); }
check('second chargement sans collision', again, null);

console.log(`\n${passed} réussis, ${failed} échoués`);
process.exit(failed ? 1 : 0);
