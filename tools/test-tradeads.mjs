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
  permissions: { contains: async ({ origins = [], permissions = [] }) => origins.every(o => granted.has(o)) && permissions.every(o => granted.has(o)) },
  cookies: { async getAll({ url }) { return url.includes('rolimons') ? [{ name: '_RoliVerification', value: 'v', domain: '.rolimons.com' }] : []; } },
  runtime: { getManifest: () => ({ version: '9.9.9' }) },
  alarms: { async clear(n) { alarms.delete(n); }, async create(n, o) { alarms.set(n, o); } },
  windows: { async create(o) { windows.push(o); return { id: 7, tabs: [{ id: 70 }] }; }, async remove(id) { closed.push(id); } },
  tabs: { async create() {} }
};
const windows = [], closed = [];

let calls = [];
let routes = {};
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), method: init.method || 'GET', credentials: init.credentials, body: JSON.parse(init.body || 'null') });
  calls[calls.length - 1].headers = init.headers || {};
  const r = routes[String(url)] || [404, {}];
  return new Response(JSON.stringify(r[1]), { status: r[0] });
};

const ta = await import('../src/background/tradeads.js');

let passed = 0, failed = 0;
const check = (label, ok) => { if (ok) { passed++; console.log('  ✓ ' + label); } else { failed++; console.error('  ✗ ' + label); } };
const ROLI = 'https://api.rolimons.com/tradeads/v1/createad';
const RU = 'https://routility.io/api/ads/';
const ME = 'https://routility.io/api/auth/me';
const PREMIUM = { token: 't', exp: 4e9, me: { features: { tradeads: true }, roblox: { id: 42 } } };
const reset = () => { store.clear(); store.set('premium', clone(PREMIUM)); calls = []; routes = {}; alarms.clear(); granted = new Set(['https://routility.io/*']); };
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
  const ru = calls.find(c => c.url === RU && c.method === 'POST');
  check('deux sites publiés', r.results.rolimons === 'ok' && r.results.routility === 'ok');
  check('Rolimon\'s : player_id, offer_item_ids, request_item_ids, request_tags',
    JSON.stringify(roli.body) === '{"player_id":42,"offer_item_ids":[111,222],"request_item_ids":[333],"request_tags":["any"]}');
  check('RoUtility : offering / looking_for (items puis tags)',
    JSON.stringify(ru.body) === '{"offering":[{"asset_id":"111"},{"asset_id":"222"}],"looking_for":[{"asset_id":"333"},{"type":"tag","tag":"any"}],"note":"","show_as":"roblox"}');
  check('session du navigateur réutilisée (credentials include)', calls.every(c => c.credentials === 'include'));
  check('aucun appel à roblox.com', calls.every(c => !/roblox\.com/.test(c.url)));
  const cfg = await ta.getConfig();
  check('journal : deux lignes « ok »', cfg.log.length === 2 && cfg.log.every(l => l.result === 'ok'));

  calls = [];
  const again = await ta.runTradeAds({ me: 42, now: 1e12 + 10 * MIN, force: true });
  check('« Publier maintenant » respecte les 15 min du site', calls.length === 0 && !Object.keys(again.results).length);
  await ta.runTradeAds({ me: 42, now: 1e12 + 20 * MIN });
  check('intervalle 15 min passé (20 min) → nouvel envoi', calls.filter(c => c.method === 'POST').length === 2);
}

console.log('\nAléatoire : retiré à chaque envoi');
{
  reset();
  await ta.saveTradeAds({ on: true, interval: 15, offer: [1, 2], alea: true, tags: ['any', 'demand', 'upgrade', 'downgrade'], sites: { rolimons: true, routility: false } });
  routes[ROLI] = [201, {}];
  const inv = [10, 11, 12, 13, 14, 15, 16, 17].map(id => ({ id, value: 1000 + id * 100 })).concat([{ id: 20, value: 500 }, { id: 21, value: 5000, projected: true }]);
  let graine = 3; const rnd = () => (graine = (graine * 16807) % 2147483647) / 2147483647;
  const offres = [];
  for (let k = 0; k < 4; k++) {
    calls = [];
    await ta.runTradeAds({ me: 42, now: 1e12 + k * 20 * MIN, inventaire: inv, offerable: new Set(inv.map(i => i.id)), rnd });
    offres.push(calls.find(c => c.url === ROLI).body.offer_item_ids);
  }
  check('chaque envoi : 4 items de 1 000 et plus, ni miette ni projected', offres.every(o => o.length === 4 && o.every(id => id >= 10 && id <= 17)));
  check('les envois ne partent pas tous avec les mêmes items', new Set(offres.map(o => [...o].sort().join())).size > 1);
  check('le popup voit le dernier tirage', JSON.stringify((await ta.getConfig()).offer) === JSON.stringify(offres[3]));
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

console.log('\nPremium (la clé)');
{
  reset();
  await ta.saveTradeAds({ on: true, interval: 15, offer: [1], tags: ['any'], sites: { rolimons: true } });
  store.delete('premium');
  check('sans clé → rien ne part', (await ta.runTradeAds({ me: 42, force: true })).locked === 'login' && !calls.length);
  check('sans clé → popup verrouillé', (await ta.tradeAdsStatus()).locked === 'login');
  store.set('premium', { ...PREMIUM, me: { ...PREMIUM.me, features: { tradeads: false } } });
  check('abonnement sans la fonction → subscribe', (await ta.runTradeAds({ me: 42, force: true })).locked === 'subscribe');
  store.set('premium', { ...PREMIUM, me: { features: { tradeads: true } } });
  check('compte Roblox pas vérifié → link', (await ta.runTradeAds({ me: 42, force: true })).locked === 'link');
  store.set('premium', PREMIUM);
  check('clé liée à un autre compte → other_account', (await ta.runTradeAds({ me: 43, force: true })).locked === 'other_account');
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
  const { offerable, isEgg } = await import('../src/popup/tradeads.js');
  const eggs = [{ id: 7, name: 'Eggcellent Egg', value: 2000 }, { id: 8, name: 'Dominus Egg', value: 900000 }, { id: 9, name: 'Legendary Leggings', value: 3000 }];
  check('œufs reconnus au nom, pas « Leggings »', isEgg(eggs[0]) && isEgg(eggs[1]) && !isEgg(eggs[2]));
  check('« Sans les œufs » les retire', offerable(eggs, { noEggs: true }).map(i => i.id).join() === '9');
  check('value minimale : les petits items partent', offerable(inv, { minValue: 1000 }).map(i => i.id).join() === '2');
  check('Smart Upgrade : les gros items, pas les miettes', JSON.stringify(presetAd('upgrade', inv).offer) === '[2]');
  const mid = [{ id: 1, value: 40000 }, { id: 2, value: 30000 }, { id: 3, value: 12000 }, { id: 4, value: 9000 }, { id: 5, value: 300, name: 'Egg' }];
  check('Smart Upgrade : trois au plus, chacun ≥ un quart du premier', JSON.stringify(presetAd('upgrade', mid).offer) === '[1,2,3]');
  {
    const inv2 = [{ id: 1, value: 500000 }, { id: 2, value: 1200 }, { id: 3, value: 999 }, { id: 4, value: 5000, name: 'Egg Hunt Egg' },
      { id: 5, value: 3000, projected: true }, { id: 6, value: 1000 }, { id: 7, value: 8000 }, { id: 8, value: 20000 }];
    const tirages = Array.from({ length: 40 }, (_, k) => presetAd('random', inv2, (i) => i.id, {}, (() => { let a = (k + 1) * 104729 * 977 % 2147483647; return () => (a = (a * 16807) % 2147483647) / 2147483647; })()));
    check('Aléatoire : 4 items, jamais sous 1 000, ni œuf ni projected', tirages.every(t => t.offer.length === 4 && t.offer.every(id => [1, 2, 6, 7, 8].includes(id))));
    check('Aléatoire : les petits items (1 200) restent possibles malgré un gros item', tirages.some(t => t.offer.includes(2)));
    check('Aléatoire : des tirages différents', new Set(tirages.map(t => [...t.offer].sort().join())).size > 1);
    check('Aléatoire : demande any, demand, upgrade, downgrade', JSON.stringify(tirages[0].tags) === '["any","demand","upgrade","downgrade"]');
    check('Aléatoire : rien à offrir sous 1 000, aucun modèle', presetAd('random', [{ id: 9, value: 500 }]) === null);
  }
  {
    const { tirageAlea, sanitize: san } = await import('../src/background/tradeads.js');
    const inv3 = [{ id: 1, value: 50000 }, { id: 2, value: 1500 }, { id: 3, value: 800 }, { id: 4, value: 9000, name: 'Egg' }, { id: 5, value: 4000, projected: true }, { id: 6, value: 2000 }, { id: 7, value: 3000 }];
    const t = tirageAlea(inv3, [7], () => .5);
    check('worker : tirage aléatoire sans exclu, œuf, projected ni miette', t.length === 3 && t.every(i => [1, 2, 6].includes(i.id)));
    const c = san({ offer: [1, 2], alea: true, tags: ['any'] });
    check('le modèle Aléatoire allume alea', c.alea === true);
    check('choisir un item à la main éteint alea', san({ offer: [1] }, c).alea === false);
    check('changer les tags garde alea', san({ tags: ['demand'] }, c).alea === true);
  }
  check('aucun modèle ne propose un œuf ni une miette', !['any', 'demand'].some(k => presetAd(k, mid).offer.includes(5)));
  check('filtres gardés par le worker, valeur hors liste refusée',
    ta.sanitize({ noEggs: false, minValue: 5000 }).minValue === 5000 && ta.sanitize({ minValue: 1234 }).minValue === 0 && ta.sanitize({ noEggs: false }).noEggs === false);
  check('item exclu : jamais proposé ni par un modèle', !offerable(inv, { exclude: [2] }).some(i => i.id === 2) && !presetAd('downgrade', inv, (i) => i.id, { exclude: [2] }).offer.includes(2));
  check('« Sans les projected » les cache de la liste', !offerable(inv, { noProjected: true }).some(i => i.id === 3));
  const ex = ta.sanitize({ offer: [1, 2, 3], exclude: [2] });
  check('worker : un item exclu sort de l\'annonce', JSON.stringify(ex.offer) === '[1,3]');
  check('message borné à 200 caractères, sans retour à la ligne', ta.sanitize({ note: 'a\nb' + 'x'.repeat(300) }).note.length === 200 && !ta.sanitize({ note: 'a\nb' }).note.includes('\n'));

  console.log('\nDemande aléatoire (value équivalente + op %)');
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pool = Array.from({ length: 400 }, (_, n) => ({ id: 1000 + n, value: 500 + n * 137 }));
  let near = 0;
  for (let k = 0; k < 50; k++) {
    const d = ta.tirageDemande(pool, 20000, 10, 4, rnd);
    const tot = d.reduce((x, i) => x + i.value, 0);
    if (d.length >= 1 && d.length <= 4 && new Set(d.map(i => i.id)).size === d.length && Math.abs(tot - 22000) / 22000 <= 0.08) near++;
  }
  check('tirage : 1 à 4 items distincts, total à ±8 % de offre + 10 %', near === 50);
  check('tirage : respecte les cases libres', ta.tirageDemande(pool, 20000, 0, 1, rnd).length === 1);
  check('tirage : rien sans offre ni pool', !ta.tirageDemande(pool, 0).length && !ta.tirageDemande([], 1000).length);
  check('op hors liste ramené à 10', ta.sanitize({ op: 13 }).op === 10 && ta.sanitize({ op: 20 }).op === 20);
  check('choisir un item à la main éteint la demande aléatoire', ta.sanitize({ items: [5] }, { ...ta.DEFAULTS, reqAlea: true }).reqAlea === false);
  reset();
  await ta.saveTradeAds({ on: true, interval: 15, offer: [1], reqAlea: true, op: 10, tags: ['any'], sites: { rolimons: true, routility: false } });
  routes[ROLI] = [201, {}];
  await ta.runTradeAds({ me: 42, inventaire: [{ id: 1, value: 10000 }], demandables: pool, rnd, now: 1e12 });
  const sentReq = calls.find(c => c.url === ROLI)?.body?.request_item_ids || [];
  const totReq = sentReq.reduce((x, id) => x + pool.find(i => i.id === id).value, 0);
  check('worker : la demande tirée part avec l\'annonce', sentReq.length >= 1 && sentReq.length <= 3 && Math.abs(totReq - 11000) / 11000 <= 0.08);

  console.log('\nRoUtility après sa mise à jour');
  reset();
  await ta.saveTradeAds({ on: true, interval: 15, offer: [1], tags: ['any'], sites: { rolimons: false, routility: true } });
  routes[RU] = [201, {}];
  await ta.runTradeAds({ me: 42, now: 1e12 });
  check('show_as envoyé', calls.find(c => c.url === RU && c.method === 'POST')?.body?.show_as === 'roblox');
  reset();
  await ta.saveTradeAds({ on: true, interval: 15, offer: [1], tags: ['any'], sites: { rolimons: false, routility: true } });
  routes[RU] = [400, { error: 'Wait 12m 3s before posting again' }];
  const w = await ta.runTradeAds({ me: 42, now: 1e12 });
  check('« Wait 12m 3s » lu comme le délai du site', w.results.routility === 'cooldown');
  reset();
  await ta.saveTradeAds({ on: true, interval: 15, offer: [1], tags: ['any'], sites: { rolimons: false, routility: true } });
  routes['https://routility.io/api/ads/mine'] = [200, { ads: [], posted_24h: 10, daily_limit: 10 }];
  const dl = await ta.runTradeAds({ me: 42, now: 1e12 });
  check('limite du jour du site respectée sans envoyer', dl.results.routility === 'daily' && !calls.some(c => c.url === RU && c.method === 'POST'));

  console.log('\nRelais : continuer sur le serveur');
  const RELAY = 'https://neuronal.live/ext/v1/tradeads/relay';
  reset();
  await ta.saveTradeAds({ on: true, interval: 0, offer: [1, 2], tags: ['any'], sites: { rolimons: true, routility: true } });
  const sansPerm = await ta.relayPush(12, { me: 42, inventaire: [{ id: 1, value: 5000 }] });
  check('sans la permission cookies : rien ne part', sansPerm.error === 'permission' && !calls.some(c => c.url === RELAY));
  granted.add('cookies');
  routes[RELAY] = [200, { active: true, since: 1e9, until: 1e9 + 43200, sites: ['rolimons'] }];
  const push = await ta.relayPush(12, { me: 42, inventaire: [{ id: 1, value: 5000 }], offerable: new Set([1]) });
  const envoi = calls.find(c => c.url === RELAY);
  check('l\'annonce part avec la session du site connecté seulement', push.cfg?.relay && JSON.stringify(Object.keys(envoi.body.sessions)) === '["rolimons"]'
    && envoi.body.sessions.rolimons[0].name === '_RoliVerification' && envoi.body.hours === 12 && JSON.stringify(envoi.body.ad.offer) === '[1]');
  check('jeton premium envoyé, jamais les cookies du navigateur', /^Bearer /.test(envoi.headers.Authorization || '') && envoi.credentials === 'omit');
  check('aucun cookie Roblox demandé', !JSON.stringify(envoi.body).includes('ROBLOSECURITY'));
  calls = [];
  const pause = await ta.runTradeAds({ me: 42, now: 1e12, force: true });
  check('pendant le relais, le navigateur ne publie pas', pause.skipped === 'relay' && !calls.some(c => c.url === ROLI));
  routes[RELAY + '/stop'] = [200, { active: false, offer: [1], items: [], last: { rolimons: 1e12 }, sent: { rolimons: [1e12] },
    log: [{ at: 1e12, site: 'rolimons', result: 'ok', offer: 1, server: true }] }];
  const repris = await ta.relayPull();
  check('reprendre : journal et horloges du serveur récupérés, relais coupé', repris.cfg.relay === null && repris.cfg.log[0].server && repris.cfg.last.rolimons === 1e12
    && repris.cfg.sent.rolimons.includes(1e12));
  granted.delete('cookies');

  console.log('\nImport / export');
  const { parseConfigFile } = await import('../src/popup/tradeads.js');
  const file = JSON.stringify({ ronote: 'tradeads', v: 1, ad: ta.pickAd({ ...ta.DEFAULTS, offer: [5], tags: ['any'], on: true }) });
  const back = parseConfigFile(file);
  check('export → import : l\'annonce revient', JSON.stringify(back.offer) === '[5]' && back.tags[0] === 'any');
  check('l\'interrupteur ne voyage jamais dans un fichier', !('on' in back) && !('on' in (parseConfigFile('{"on":true,"tags":["any"]}') || {})));
  check('fichier invalide ou étranger refusé', parseConfigFile('pas du json') === null && parseConfigFile('{"foo":1}') === null);
  const sv = ta.sanitize({ saved: [{ name: 'A', ad: { offer: [1, 'x'], tags: ['hack', 'rap'], on: true } }, null, { name: 'sans ad' }] });
  check('configs enregistrées nettoyées', sv.saved.length === 1 && JSON.stringify(sv.saved[0].ad.offer) === '[1]' && JSON.stringify(sv.saved[0].ad.tags) === '["rap"]' && !('on' in sv.saved[0].ad));
}
console.log(`\n${passed} réussis, ${failed} échoué(s)`);
if (failed) process.exit(1);
