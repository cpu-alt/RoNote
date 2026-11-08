// Tests de la contribution au réseau Neuronal (background/neuronal.js) : ce qui
// part, une seule fois, et rien quand l'option ou la permission manque.
// Aucun réseau (fetch simulé). Usage : node tools/test-neuronal.mjs
const store = new Map();
const session = new Map();
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
let granted = true;
globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        const o = {};
        for (const k of [].concat(keys)) if (store.has(k)) o[k] = clone(store.get(k));
        return o;
      },
      async set(obj) { for (const [k, v] of Object.entries(obj)) store.set(k, clone(v)); }
    },
    session: {
      async get(k) { return session.has(k) ? { [k]: clone(session.get(k)) } : {}; },
      async set(obj) { for (const [k, v] of Object.entries(obj)) session.set(k, clone(v)); }
    }
  },
  runtime: { getManifest: () => ({ version: '2.17.0' }) },
  permissions: { contains: async () => granted }
};

let posts = [];
let status = 200;
globalThis.fetch = async (url, init = {}) => {
  posts.push({ url: String(url), body: JSON.parse(init.body || 'null'), headers: init.headers, credentials: init.credentials });
  return new Response('{}', { status });
};

const { tradeReport, shareWithNeuronal, neuronalLookup, neuronalExternal } = await import('../src/background/neuronal.js');

let passed = 0, failed = 0;
const check = (label, ok) => { if (ok) { passed++; console.log('  ✓ ' + label); } else { failed++; console.error('  ✗ ' + label); } };

const detail = (id, robuxMine = 0, robuxTheirs = 0) => ({
  id, created: '2026-10-30T12:00:00Z', status: 'Completed',
  offers: [
    { user: { id: 1, name: 'me' }, robux: robuxMine,
      userAssets: [{ id: 9001, assetId: 1365767, bundleId: 0, serialNumber: 42, name: 'Valkyrie Helm' }] },
    { user: { id: 77, name: 'bob' }, robux: robuxTheirs,
      userAssets: [{ id: 'guid-x', assetId: 0, bundleId: 5, serialNumber: null, name: 'Face' }] }
  ]
});
const settings = { neuronalShare: true };
const me = { id: 1, name: 'me', displayName: 'Me' };

console.log('\nLe rapport d\'un trade');
{
  const r = tradeReport(detail(500, 0, 1200), 1, Date.UTC(2026, 9, 31) );
  check('vu du compte qui envoie', r.gave.items[0].assetId === 1365767 && r.got.items[0].bundleId === 5);
  check('Robux de chaque côté, bruts', r.gave.robux === 0 && r.got.robux === 1200);
  check('userAssetId et série gardés', r.gave.items[0].uaid === 9001 && r.gave.items[0].serial === 42);
  check('un GUID v2 ne passe pas pour un userAssetId', r.got.items[0].uaid === null);
  check('partenaire identifié', r.partner.id === 77 && r.partner.name === 'bob');
  check('dates en secondes', r.created === Date.parse('2026-10-30T12:00:00Z') / 1000 && r.seen === Date.UTC(2026, 9, 31) / 1000);
  const scraped = detail(501); scraped.offers[1].user.id = -1;
  check('trade sans id du partenaire : pas de rapport', tradeReport(scraped, 1) === null);
  check('compte absent du trade : pas de rapport', tradeReport(detail(502), 999) === null);
}

console.log('\nUn passage avec l\'option active');
{
  store.clear(); posts = []; status = 200;
  const details = { 500: detail(500, 0, 1200), 501: detail(501) };
  const res = await shareWithNeuronal({ settings, me, completed: [500, 501, 502], detailOf: (id) => details[id] || null, portfolio: { v: 100000, r: 80000 } });
  check('présence puis trades', posts.map(p => p.url.split('/').pop()).join(',') === 'presence,trades');
  check('présence : compte et valeur', posts[0].body.user.id === 1 && posts[0].body.value === 100000 && posts[0].body.version === '2.17.0');
  check('seuls les trades déjà en cache partent', res.n === 2 && posts[1].body.trades.map(t => t.id).join(',') === '500,501');
  check('sans cookie, avec l\'en-tête X-RoNote', posts.every(p => p.credentials === 'omit' && p.headers['X-RoNote'] === '2.17.0'));

  posts = [];
  await shareWithNeuronal({ settings, me, completed: [500, 501], detailOf: (id) => details[id] || null });
  check('au passage suivant, rien ne repart', posts.length === 0);

  details[503] = detail(503, 300, 0);
  await shareWithNeuronal({ settings, me, completed: [503, 500, 501], detailOf: (id) => details[id] || null });
  check('un nouveau trade part seul, sans présence', posts.length === 1 && posts[0].body.trades.length === 1 && posts[0].body.trades[0].id === 503);
}

console.log('\nLa fiche gardée en cache après un envoi');
{
  store.clear(); posts = []; status = 200;
  await neuronalLookup('player', 77, { neuronalLookup: true });
  await neuronalLookup('player', 5, { neuronalLookup: true });
  posts = [];
  await neuronalLookup('player', 77, { neuronalLookup: true });
  check('avant : la fiche du partenaire vient du cache', posts.length === 0);
  await shareWithNeuronal({ settings, me, completed: [600], detailOf: () => detail(600) });
  const keys = Object.keys(session.get('neuronalCache') || {});
  check('après : celle du partenaire est oubliée', !keys.includes('player:77'));
  check('les autres fiches restent', keys.includes('player:5'));
}

console.log('\nLa page neuronal.live/ronote parle à l\'extension');
{
  const site = { origin: 'https://neuronal.live', url: 'https://neuronal.live/ronote' };
  let opened = null;
  const open = async (hash) => { opened = hash; };
  granted = true;
  const hi = await neuronalExternal({ type: 'ronote:hello' }, site, { neuronalShare: true }, open);
  check('hello : version et contribution active', hi.version === '2.17.0' && hi.share === true);
  const off = await neuronalExternal({ type: 'ronote:hello' }, site, { neuronalShare: false }, open);
  check('hello : option coupée → share false', off.share === false);
  granted = false;
  const noPerm = await neuronalExternal({ type: 'ronote:hello' }, site, { neuronalShare: true }, open);
  check('hello : permission absente → share false', noPerm.share === false);
  granted = true;
  const ok = await neuronalExternal({ type: 'ronote:open', section: 'neuronal' }, site, {}, open);
  check('open : réglages ouverts sur la section Neuronal', ok.ok === true && opened === 's-neuronal');
  opened = null;
  const evil = await neuronalExternal({ type: 'ronote:open', section: 'neuronal' }, { origin: 'https://neuronal.live.evil.com' }, {}, open);
  check('une autre origine reste sans réponse', evil === null && opened === null);
  const http = await neuronalExternal({ type: 'ronote:hello' }, { url: 'http://neuronal.live/ronote' }, {}, open);
  check('http:// refusé (repli sur sender.url)', http === null);
  check('message inconnu : sans réponse', await neuronalExternal({ type: 'ronote:decline' }, site, {}, open) === null);
}

console.log('\nRoute absente, option ou permission coupée');
{
  store.clear(); posts = []; status = 404;
  const now = Date.now();
  const r = await shareWithNeuronal({ settings, me, completed: [500], detailOf: () => detail(500), now });
  check('404 : pause de plusieurs heures', r.why === 'unavailable' && store.get('neuronalShare').holdUntil >= now + 5 * 3600e3);
  posts = [];
  await shareWithNeuronal({ settings, me, completed: [500], detailOf: () => detail(500), now: now + 60e3 });
  check('pendant la pause, aucune requête', posts.length === 0);

  store.clear(); posts = []; status = 200;
  await shareWithNeuronal({ settings: { neuronalShare: false }, me, completed: [500], detailOf: () => detail(500) });
  check('option coupée : rien', posts.length === 0);
  granted = false;
  await shareWithNeuronal({ settings, me, completed: [500], detailOf: () => detail(500) });
  check('permission absente : rien', posts.length === 0);
  granted = true;
}

{
  // 8 novembre : le lien Rolimon's d'une tuile suit `roli` (/bundle/ d'un visage ou d'un bundle)
  const { nwTilesHtml } = await import('../src/popup/nwcard.js');
  const face = nwTilesHtml([{ id: 494291269, name: 'Super Super Happy Face', value: 1, thumb: 'https://tr.rbxcdn.com/x', roli: 'https://www.rolimons.com/bundle/158380697314856' }]);
  check('tuile : vignette affichée', face.includes('<img src="https://tr.rbxcdn.com/x"'));
  const bundle = nwTilesHtml([{ id: 939596, name: 'The Jade Catseye', value: 1, roli: 'https://www.rolimons.com/bundle/939596' }]);
  check('tuile bundle : page /bundle/', bundle.includes('data-open="https://www.rolimons.com/bundle/939596"'));
  const piege = nwTilesHtml([{ id: 7, name: 'x', roli: 'https://evil.example/item/7' }]);
  check('tuile : lien étranger ignoré', piege.includes('data-open="https://www.rolimons.com/item/7"') && !piege.includes('evil'));
  const ancien = nwTilesHtml([{ id: 7, name: 'x' }]);
  check('tuile sans roli (ancien serveur) : /item/<id>', ancien.includes('data-open="https://www.rolimons.com/item/7"'));
}

console.log(`\n${passed} réussis, ${failed} échoués`);
process.exit(failed ? 1 : 0);
