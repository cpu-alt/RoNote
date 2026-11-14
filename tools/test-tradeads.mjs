// Tests de l'auto-post de trade ads (background/tradeads.js) : format envoyé à chaque site,
// session du navigateur réutilisée (credentials: 'include', aucun mot de passe ni cookie lu),
// délais et limites des sites respectés, Rotility jamais appelé. Aucun réseau (fetch simulé).
// Usage : node tools/test-tradeads.mjs
const store = new Map();
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
let granted = new Set(['https://routility.io/*']);
const alarms = new Map();
globalThis.chrome = {
  storage: {
    local: {
      async get(k) { return store.has(k) ? { [k]: clone(store.get(k)) } : {}; },
      async set(obj) { for (const [k, v] of Object.entries(obj)) store.set(k, clone(v)); }
    }
  },
  permissions: { contains: async ({ origins }) => origins.every(o => granted.has(o)) },
  alarms: { async clear(n) { alarms.delete(n); }, async create(n, o) { alarms.set(n, o); } }
};

let calls = [];
let routes = {};
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), method: init.method || 'GET', credentials: init.credentials, body: JSON.parse(init.body || 'null') });
  const r = routes[String(url)] || [404, {}];
  return new Response(JSON.stringify(r[1]), { status: r[0] });
};

const ta = await import('../src/background/tradeads.js');

let passed = 0, failed = 0;
const check = (label, ok) => { if (ok) { passed++; console.log('  ✓ ' + label); } else { failed++; console.error('  ✗ ' + label); } };
const ROLI = 'https://api.rolimons.com/tradeads/v1/createad';
const RU = 'https://routility.io/api/ads/';
const ME = 'https://routility.io/api/auth/me';
const reset = () => { store.clear(); calls = []; routes = {}; alarms.clear(); granted = new Set(['https://routility.io/*']); };
const MIN = 60e3;

console.log('\nRéglages nettoyés');
{
  reset();
  const c = ta.sanitize({ interval: 3, offer: [1, 1, 2, 3, 4, 5, -1, 'x'], tags: ['any', 'hack', 'demand'], items: [9, 8, 7], sites: { rotility: true, routility: true } });
  check('intervalle 15 min au moins', c.interval === 15);
  check('4 offerts au plus, sans doublon ni id invalide', JSON.stringify(c.offer) === '[1,2,3,4]');
  check('tags inconnus retirés', JSON.stringify(c.tags) === '["any","demand"]');
  check('items + tags demandés ≤ 4', c.items.length + c.tags.length === 4);
  check('Rotility ne peut pas être coché', !c.sites.rotility && c.sites.routility);
  check('interrupteur éteint par défaut', ta.DEFAULTS.on === false);
}

console.log('\nAlarme');
{
  reset();
  await ta.saveTradeAds({ on: true, interval: 30 });
  check('allumé → alarme à l\'intervalle choisi', alarms.get(ta.ALARM)?.periodInMinutes === 30);
  await ta.saveTradeAds({ on: false });
  check('éteint → plus d\'alarme', !alarms.has(ta.ALARM));
}

console.log('\nEnvoi : format de chaque site');
{
  reset();
  await ta.saveTradeAds({ on: true, offer: [111, 222], items: [333], tags: ['any'], sites: { rolimons: true, routility: true } });
  routes[ROLI] = [201, {}];
  routes[RU] = [201, { id: 'a1' }];
  const r = await ta.runTradeAds({ me: 42, now: 1e12 });
  const roli = calls.find(c => c.url === ROLI);
  const ru = calls.find(c => c.url === RU);
  check('deux sites publiés', r.results.rolimons === 'ok' && r.results.routility === 'ok');
  check('Rolimon\'s : player_id, offer_item_ids, request_item_ids, request_tags',
    JSON.stringify(roli.body) === '{"player_id":42,"offer_item_ids":[111,222],"request_item_ids":[333],"request_tags":["any"]}');
  check('RoUtility : offering / looking_for (items puis tags)',
    JSON.stringify(ru.body) === '{"offering":[{"asset_id":"111"},{"asset_id":"222"}],"looking_for":[{"asset_id":"333"},{"type":"tag","tag":"any"}],"note":""}');
  check('session du navigateur réutilisée (credentials include)', calls.every(c => c.credentials === 'include'));
  check('aucun appel à Rotility ni à roblox.com', calls.every(c => !/rotility|roblox\.com/.test(c.url)));
  const cfg = await ta.getConfig();
  check('journal : deux lignes « ok »', cfg.log.length === 2 && cfg.log.every(l => l.result === 'ok'));

  calls = [];
  const again = await ta.runTradeAds({ me: 42, now: 1e12 + 10 * MIN, force: true });
  check('« Publier maintenant » respecte les 15 min du site', calls.length === 0 && !Object.keys(again.results).length);
  await ta.runTradeAds({ me: 42, now: 1e12 + 20 * MIN });
  check('intervalle 15 min passé (20 min) → nouvel envoi', calls.length === 2);
}

console.log('\nRefus et limites');
{
  reset();
  await ta.saveTradeAds({ on: true, offer: [1], tags: ['demand'], sites: { rolimons: true, routility: false } });
  routes[ROLI] = [422, {}];
  const r = await ta.runTradeAds({ me: 42, now: 1e12 });
  check('422 Rolimon\'s → connexion à refaire', r.results.rolimons === 'login' && (await ta.getConfig()).status.rolimons === 'login');
  routes[ROLI] = [400, {}];
  check('400 → délai du site', (await ta.runTradeAds({ me: 42, now: 1e12 + 16 * MIN })).results.rolimons === 'cooldown');

  reset();
  await ta.saveTradeAds({ on: true, offer: [1], tags: ['demand'] });
  const cfg = await ta.getConfig();
  cfg.sent.rolimons = Array.from({ length: 55 }, (_, i) => 1e12 - i * MIN);
  store.set('tradeads', cfg);
  routes[ROLI] = [201, {}];
  const d = await ta.runTradeAds({ me: 42, now: 1e12 + 16 * MIN });
  check('55 annonces en 24 h → plus rien chez Rolimon\'s', d.results.rolimons === 'daily' && !calls.length);

  reset();
  await ta.saveTradeAds({ on: true, offer: [1], tags: ['any'] });
  check('éteint par l\'interrupteur → rien', (await ta.saveTradeAds({ on: false }), (await ta.runTradeAds({ me: 42 })).skipped === 'off'));
  check('sans compte suivi → rien', (await ta.runTradeAds({ me: 0, force: true })).skipped === 'me');
  check('item vendu depuis → annonce vide, rien ne part', (await ta.runTradeAds({ me: 42, force: true, offerable: new Set([7]) })).skipped === 'empty' && !calls.length);
}

console.log('\nÉtat des sites');
{
  reset();
  await ta.saveTradeAds({ sites: { routility: true } });
  routes[ME] = [200, { roblox_id: 42, username: 'wars_choing' }];
  let s = (await ta.tradeAdsStatus()).sites;
  check('RoUtility connecté, avec le compte', s.routility.state === 'ok' && s.routility.account.name === 'wars_choing');
  check('Rolimon\'s : inconnu avant le premier envoi', s.rolimons.state === 'unknown');
  check('Rotility : bloqué (Turnstile)', s.rotility.state === 'blocked' && s.rotility.why === 'turnstile');
  routes[ME] = [401, {}];
  check('RoUtility sans session → à connecter', (await ta.tradeAdsStatus()).sites.routility.state === 'login');
  granted = new Set();
  calls = [];
  s = (await ta.tradeAdsStatus()).sites;
  check('sans permission routility.io → pas de requête, « perm »', s.routility.state === 'perm' && !calls.length);
}

console.log(`\n${passed} réussis, ${failed} échoué(s)`);
if (failed) process.exit(1);
