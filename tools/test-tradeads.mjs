// Tests de l'auto-post de trade ads (background/tradeads.js) : format envoyé à chaque site,
// session du navigateur réutilisée (credentials: 'include', aucun mot de passe ni cookie lu),
// délais et limites des sites respectés, rien vers roblox.com. Aucun réseau (fetch simulé).
// Usage : node tools/test-tradeads.mjs
const store = new Map();
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
let granted = new Set(['https://routility.io/*']);
const alarms = new Map();
globalThis.chrome = {
  storage: {
    local: {
      async get(k) { return store.has(k) ? { [k]: clone(store.get(k)) } : {}; },
      async set(obj) { for (const [k, v] of Object.entries(obj)) store.set(k, clone(v)); },
      async remove(k) { store.delete(k); }
    }
  },
  permissions: { contains: async ({ origins }) => origins.every(o => granted.has(o)) },
  alarms: { async clear(n) { alarms.delete(n); }, async create(n, o) { alarms.set(n, o); } },
  windows: { async create(o) { windows.push(o); return { id: 7, tabs: [{ id: 70 }] }; }, async remove(id) { closed.push(id); } },
  tabs: { async create() {} }
};
const windows = [], closed = [];

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
  const c = ta.sanitize({ interval: 3, offer: [1, 1, 2, 3, 4, 5, -1, 'x'], tags: ['any', 'hack', 'demand'], items: [9, 8, 7], sites: { inconnu: true, routility: true } });
  check('intervalle 15 min au moins', c.interval === 15);
  check('4 offerts au plus, sans doublon ni id invalide', JSON.stringify(c.offer) === '[1,2,3,4]');
  check('tags inconnus retirés', JSON.stringify(c.tags) === '["any","demand"]');
  check('items + tags demandés ≤ 4', c.items.length + c.tags.length === 4);
  check('un site inconnu ne peut pas être coché', !c.sites.inconnu && c.sites.routility);
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
  await ta.saveTradeAds({ on: true, interval: 15, offer: [111, 222], items: [333], tags: ['any'], sites: { rolimons: true, routility: true } });
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
  check('aucun appel à roblox.com', calls.every(c => !/roblox\.com/.test(c.url)));
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
  await ta.saveTradeAds({ on: true, interval: 15, offer: [1], tags: ['demand'], sites: { rolimons: true, routility: false } });
  routes[ROLI] = [422, {}];
  const r = await ta.runTradeAds({ me: 42, now: 1e12 });
  check('422 Rolimon\'s → connexion à refaire', r.results.rolimons === 'login' && (await ta.getConfig()).status.rolimons === 'login');
  routes[ROLI] = [400, {}];
  check('400 → délai du site', (await ta.runTradeAds({ me: 42, now: 1e12 + 16 * MIN })).results.rolimons === 'cooldown');

  reset();
  await ta.saveTradeAds({ on: true, interval: 15, offer: [1], tags: ['demand'] });
  const cfg = await ta.getConfig();
  cfg.sent.rolimons = Array.from({ length: 55 }, (_, i) => 1e12 - i * MIN);
  store.set('tradeads', cfg);
  routes[ROLI] = [201, {}];
  const d = await ta.runTradeAds({ me: 42, now: 1e12 + 16 * MIN });
  check('55 annonces en 24 h → plus rien chez Rolimon\'s', d.results.rolimons === 'daily' && !calls.length);

  reset();
  await ta.saveTradeAds({ on: true, interval: 15, offer: [1], tags: ['any'] });
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
  check('deux sites seulement', Object.keys(s).join() === 'rolimons,routility');
  routes[ME] = [401, {}];
  check('RoUtility sans session → à connecter', (await ta.tradeAdsStatus()).sites.routility.state === 'login');
  granted = new Set();
  calls = [];
  s = (await ta.tradeAdsStatus()).sites;
  check('sans permission routility.io → pas de requête, « perm »', s.routility.state === 'perm' && !calls.length);
}

console.log('Mode malin');
{
  reset();
  check('par défaut : malin', ta.DEFAULTS.interval === 0 && ta.sanitize({ interval: 0 }).interval === 0);
  check("Rolimon's : une toutes les 27 min (53 / 24 h, jamais bloqué)", ta.smartGap(ta.SITES.rolimons) === 27 && 24 * 60 / 27 <= 55);
  check('RoUtility : le délai du site', ta.smartGap(ta.SITES.routility) === 15);
  await ta.saveTradeAds({ on: true, offer: [1], tags: ['any'], sites: { rolimons: true, routility: true } });
  check('alarme chaque minute', alarms.get(ta.ALARM)?.periodInMinutes === 1);
  routes[ROLI] = [201, {}]; routes[RU] = [201, {}];
  routes['https://routility.io/api/ads/mine'] = [200, { ads: [3, 1, 5, 2, 4].map(n => ({ id: 'ad' + n, created_at: n })) }];
  routes['https://routility.io/api/ads/ad1'] = [200, {}];
  await ta.runTradeAds({ me: 42, now: 1e12 });
  check('RoUtility plein (5) : la plus ancienne supprimée avant la nouvelle',
    calls.some(c => c.method === 'DELETE' && c.url.endsWith('/ad1')) && calls.findIndex(c => c.method === 'DELETE') < calls.findIndex(c => c.url === RU && c.method === 'POST'));
  calls = [];
  await ta.runTradeAds({ me: 42, now: 1e12 + 20 * MIN });
  check("20 min : RoUtility repart, Rolimon's attend", calls.some(c => c.url === RU && c.method === 'POST') && !calls.some(c => c.url === ROLI));
  calls = [];
  await ta.runTradeAds({ me: 42, now: 1e12 + 27 * MIN });
  check("27 min : Rolimon's repart", calls.some(c => c.url === ROLI));
  let n = 0;   // une journée entière, une alarme par minute : la limite n'est jamais touchée
  reset();
  await ta.saveTradeAds({ on: true, offer: [1], tags: ['any'], sites: { rolimons: true, routility: false } });
  routes[ROLI] = [201, {}];
  for (let m = 0; m < 3 * 24 * 60; m++) if ((await ta.runTradeAds({ me: 42, now: 1e12 + m * MIN })).results?.rolimons) n++;
  check(`3 jours : ${n} annonces Rolimon's, aucune refusée pour la limite`, n >= 159 && (await ta.getConfig()).log.every(l => l.result === 'ok'));
}
console.log('Se connecter avec Roblox');
{
  reset();
  await ta.tradeAdsLogin('rolimons');
  check('fenêtre ouverte sur le login OAuth de Roblox', windows[0]?.url.startsWith('https://apis.roblox.com/oauth/v1/authorize') && windows[0].type === 'popup');
  await ta.onTradeAdsTab(70, { url: 'https://apis.roblox.com/oauth/v1/authorize?x' });
  check('encore chez Roblox : rien ne se ferme', !closed.length);
  await ta.onTradeAdsTab(99, { url: 'https://www.rolimons.com/' });
  check('un autre onglet ne compte pas', !closed.length);
  await ta.onTradeAdsTab(70, { url: 'https://www.rolimons.com/verify' });
  check("retour sur rolimons.com : fenêtre fermée, Rolimon's connecté", closed[0] === 7 && (await ta.tradeAdsStatus()).sites.rolimons.state === 'ok');
  await ta.tradeAdsLogin('routility');
  check('RoUtility : son « Sign in with Roblox »', windows[1]?.url.startsWith('https://routility.io/api/auth/roblox'));
  await ta.onTradeAdsTab(70, { url: 'https://routility.io/api/auth/callback?code=1' });
  check('RoUtility : le retour /api/ ne ferme pas encore', closed.length === 1);
  await ta.onTradeAdsTab(70, { url: 'https://routility.io/trade-ads/create' });
  check('RoUtility : de retour sur le site, fermée', closed.length === 2);
}
console.log('\nModèles d\'annonce');
{
  Object.assign(globalThis.chrome, { runtime: { id: 'test', getURL: (x) => x } });
  globalThis.chrome.storage.onChanged = { addListener() {} };
  globalThis.localStorage ??= { getItem: () => null, setItem() {} };
  const { presetAd } = await import('../src/popup/tradeads.js');
  const inv = [{ id: 1, value: 100, demand: 3 }, { id: 2, value: 5000, demand: 1 }, { id: 3, value: 900, projected: true },
    { id: 4, value: 300, demand: 0 }, { id: 5, value: 50, demand: 4 }, { id: 6, value: 80, demand: 2 }];
  const all = ['upgrade', 'downgrade', 'demand', 'robux', 'any'].map(k => presetAd(k, inv));
  check('un projected n\'est jamais offert', all.every(a => !a.offer.includes(3)));
  check('4 offerts et 4 demandés au plus', all.every(a => a.offer.length <= 4 && a.tags.length <= 4));
  check('Downgrade : le plus gros item seul', JSON.stringify(all[1].offer) === '[2]');
  check('Demande : les moins demandés d\'abord', all[2].offer[0] === 4);
  check('inventaire vide : aucun modèle', presetAd('any', []) === null);
}
console.log(`\n${passed} réussis, ${failed} échoué(s)`);
if (failed) process.exit(1);
