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

console.log('\nOù en est le trade, d\'après le titre des offres');
const phase = (s) => ctx.RoNoteDom.phaseOf(s);
check('terminé : « Items you gave / received »', [phase('Items you gave'), phase('Items you received:')], ['done', 'done']);
check('terminé, en français', [phase('Objets que tu as donnés'), phase('Objets que vous avez reçus')], ['done', 'done']);
check('en cours : « will give », « give », « receive »',
  [phase('Items you will give'), phase('Items you give'), phase('Items you receive')], ['open', 'open', 'open']);
check('tombé à l\'eau : « would have »', [phase('Items you would have given'), phase("Items you would've received")], ['inactive', 'inactive']);
check('autre titre : rien', [phase('Your Offer'), phase('')], ['', '']);

console.log('\nCharger deux fois de suite ne casse rien');
// Une navigation dans l'application monopage peut faire rejouer un script.
let again = null;
try {
  for (const f of files) vm.runInContext(src(f), ctx, { filename: f });
} catch (e) { again = String(e?.message || e); }
check('second chargement sans collision', again, null);

/* ----------------------- le pont page ↔ extension ----------------------- */

// hook.js tourne dans le monde MAIN, relay.js dans le monde isolé : le premier
// capte le jeton CSRF et les détails de trade que la page reçoit, le second
// les remet au service worker. Ce qui compte : le message ne vise QUE
// l'origine de la page (corrigé en v2.9.1), et le relais refuse tout ce qui
// ne vient pas d'elle.

const ORIGIN = 'https://www.roblox.com';
const flush = () => new Promise(r => setImmediate(r));

/** Un monde MAIN minimal : fetch, XMLHttpRequest, une balise meta, postMessage espionné. */
function mainWorld({ fetchImpl, meta = null } = {}) {
  const posted = [];
  class FakeXHR {
    open() {}
    setRequestHeader() {}
    send() {}
    addEventListener(type, fn) { this['on' + type] = fn; }
  }
  const ctx = vm.createContext({ console, JSON, Promise, String, Number, Array, Object, RegExp, Error });
  ctx.globalThis = ctx;
  ctx.window = ctx;
  ctx.location = { origin: ORIGIN, href: ORIGIN + '/trades' };
  ctx.fetch = fetchImpl;
  ctx.XMLHttpRequest = FakeXHR;
  ctx.document = {
    querySelector: (sel) => (sel === 'meta[name="csrf-token"]' && meta ? { content: meta } : null)
  };
  ctx.postMessage = (data, targetOrigin) =>
    posted.push({ data: JSON.parse(JSON.stringify(data)), targetOrigin });
  vm.runInContext(src('hook.js'), ctx, { filename: 'hook.js' });
  return { ctx, posted, FakeXHR };
}

console.log('\nhook.js : ce que la page laisse passer (monde MAIN)');
{
  const responses = {
    'https://trades.roblox.com/v1/trades/123': { offers: [], status: 'Open' },
    'https://trades.roblox.com/v1/trades/456': { message: 'pas un trade' },
    'https://catalog.roblox.com/v1/items/details': { data: [] }
  };
  const w = mainWorld({
    meta: 'jeton-meta',
    fetchImpl: async (url) => ({ ok: true, clone: () => ({ json: async () => responses[url] }) })
  });

  check('le jeton de la balise meta part au chargement',
    w.posted.map(p => p.data), [{ __ronote: 'csrf', token: 'jeton-meta' }]);

  const pageRes = await w.ctx.fetch('https://catalog.roblox.com/v1/items/details',
    { headers: { 'x-csrf-token': 'jeton-fetch' } });
  await w.ctx.fetch('https://catalog.roblox.com/v1/items/details',
    { headers: { get: (h) => (h === 'x-csrf-token' ? 'jeton-headers' : null) } });
  await w.ctx.fetch('https://trades.roblox.com/v1/trades/123');
  await w.ctx.fetch('https://trades.roblox.com/v1/trades/456');
  await flush(); await flush();

  check('la page reçoit toujours sa propre réponse', typeof pageRes?.clone, 'function');
  check('jeton lu dans les en-têtes d\'un fetch (objet simple ou Headers)',
    w.posted.filter(p => p.data.__ronote === 'csrf').map(p => p.data.token),
    ['jeton-meta', 'jeton-fetch', 'jeton-headers']);
  check('détail capté, et seulement s\'il ressemble à un trade',
    w.posted.filter(p => p.data.__ronote === 'trade-detail').map(p => p.data.tradeId), ['123']);

  const x = new w.FakeXHR();
  x.open('GET', 'https://trades.roblox.com/v2/trades/789');
  x.setRequestHeader('X-CSRF-TOKEN', 'jeton-xhr');
  x.send();
  Object.assign(x, { status: 200, responseType: '', responseText: JSON.stringify({ participantAOffer: {} }) });
  x.onload?.();

  check('XHR : jeton et détail captés aussi',
    w.posted.slice(-2).map(p => [p.data.__ronote, p.data.token || p.data.tradeId]),
    [['csrf', 'jeton-xhr'], ['trade-detail', '789']]);
  check('chaque message vise l\'origine de la page, jamais « * »',
    [...new Set(w.posted.map(p => p.targetOrigin))], [ORIGIN]);
}

console.log('\nrelay.js : le relais n\'écoute que la page elle-même (monde isolé)');
{
  const sent = [];
  let onMessage = null;
  const ctx = tab();
  ctx.addEventListener = (type, fn) => { if (type === 'message') onMessage = fn; };
  ctx.chrome.runtime.sendMessage = async (m) => { sent.push(m); return {}; };
  ctx.document.querySelector = (sel) => (sel === 'meta[name="csrf-token"]' ? { content: 'jeton-meta' } : null);
  vm.runInContext(src('relay.js'), ctx, { filename: 'relay.js' });

  check('le jeton de la page part au chargement', sent.map(m => m.token), ['jeton-meta']);
  check('un écouteur de messages est posé', typeof onMessage, 'function');

  // La fenetre telle que le script la voit : depuis l'exterieur du bac a
  // sable, `ctx` n'est pas le meme objet que le `window` du script.
  const pageWindow = vm.runInContext('window', ctx);
  const deliver = (data, { origin = ORIGIN, source = pageWindow } = {}) => onMessage({ data, origin, source });
  sent.length = 0;
  deliver({ __ronote: 'csrf', token: 'jeton-page' });
  deliver({ __ronote: 'csrf', token: 'jeton-etranger' }, { origin: 'https://evil.example' });
  deliver({ __ronote: 'csrf', token: 'jeton-iframe' }, { source: {} });
  deliver({ __ronote: 'trade-detail', tradeId: '42', detail: { offers: [] } });
  deliver({ __ronote: 'autre', token: 'x' });
  deliver('pas un objet');

  check('seuls les messages de la page, depuis son origine, sont relayés',
    sent.map(m => [m.type, m.token || m.tradeId]),
    [['ronote:csrf', 'jeton-page'], ['ronote:captured-trade', '42']]);
}

console.log(`\n${passed} réussis, ${failed} échoués`);
process.exit(failed ? 1 : 0);
