// Tests de RoNote premium (background/premium.js et la lecture des fiches, neuronal.js) :
// le jeton part sur les seules requêtes vers Neuronal, un refus du serveur verrouille,
// un jeton expiré est renouvelé une fois, une session fermée l'efface.
// Aucun réseau (fetch simulé). Usage : node tools/test-premium.mjs
const store = new Map();
const session = new Map();
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
let granted = true;
let flow = null;                       // ce que launchWebAuthFlow rend
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
  runtime: { getManifest: () => ({ version: '2.16.7' }) },
  permissions: { contains: async () => granted },
  identity: {
    getRedirectURL: (p) => 'https://' + 'a'.repeat(32) + '.chromiumapp.org/' + p,
    async launchWebAuthFlow({ url }) { flow.asked = url; if (flow.throw) throw new Error('closed'); return flow.back; }
  }
};

let calls = [];
let routes = {};
globalThis.fetch = async (url, init = {}) => {
  const path = String(url).replace('https://neuronal.live/ext/v1/', '').split('?')[0];
  calls.push({ path, headers: init.headers || {}, body: JSON.parse(init.body || 'null') });
  const r = typeof routes[path] === 'function' ? routes[path](init) : routes[path] || [404, {}];
  return new Response(JSON.stringify(r[1]), { status: r[0] });
};

const premium = await import('../src/background/premium.js');
const { neuronalLookup, neuronalForget } = await import('../src/background/neuronal.js');

let passed = 0, failed = 0;
const check = (label, ok) => { if (ok) { passed++; console.log('  ✓ ' + label); } else { failed++; console.error('  ✗ ' + label); } };
const settings = { neuronalLookup: true };
const later = (h) => Math.floor(Date.now() / 1000) + h * 3600;
const reset = async () => { store.clear(); session.clear(); calls = []; routes = {}; await neuronalForget(); };
store.set('state', { userId: 42, accounts: [{ id: 42, name: 'me' }] });

console.log('\nSans session : rien ne part, le serveur verrouille');
{
  await reset(); store.set('state', { userId: 42, accounts: [{ id: 42, name: 'me' }] });
  routes['player/7'] = [401, { error: 'login' }];
  const r = await neuronalLookup('player', 7, settings);
  check('aucun en-tête Authorization', !calls[0].headers.Authorization && calls[0].headers['X-RoNote'] === '2.16.7');
  check('401 login → verrouillé', r.locked === 'login' && !r.data);
}

console.log('\nConnect Discord');
{
  await reset(); store.set('state', { userId: 42, accounts: [{ id: 42, name: 'me' }] });
  flow = { back: 'https://x.chromiumapp.org/premium#token=TOK1&exp=' + later(24) };
  routes['auth/me'] = [200, { discord: { id: '1', name: 'Me' }, roblox: { id: 42, name: 'me' }, features: { deals: true } }];
  const r = await premium.premiumConnect();
  check('jeton du fragment gardé', r.ok && (await premium.premiumGet()).token === 'TOK1');
  check("l'adresse de retour de l'extension est passée à Neuronal", flow.asked.includes('auth/discord?redirect=' + encodeURIComponent('https://' + 'a'.repeat(32) + '.chromiumapp.org/premium')));
  const s = await premium.premiumStatus();
  check('la carte sait qui est connecté', s.signedIn && s.me.discord.name === 'Me');
  flow = { back: 'https://x.chromiumapp.org/premium#error=not_member' };
  check('pas sur le serveur : erreur claire', (await premium.premiumConnect()).error === 'not_member');
  flow = { throw: true };
  check('fenêtre fermée : annulé', (await premium.premiumConnect()).error === 'cancelled');
  granted = false;
  check('sans la permission neuronal.live : rien', (await premium.premiumConnect()).error === 'permission');
  granted = true;
}

console.log('\nAvec un jeton : il part, et un refus verrouille');
{
  await reset(); store.set('state', { userId: 42, accounts: [{ id: 42, name: 'me' }] });
  store.set('premium', { token: 'TOK2', exp: later(20) });
  routes['player/8'] = [200, { known: true, id: 8 }];
  const ok = await neuronalLookup('player', 8, settings);
  check('Authorization et compte Roblox suivi', calls[0].headers.Authorization === 'Bearer TOK2' && calls[0].headers['X-RoNote-User'] === '42');
  check('la fiche arrive', ok.data?.known === true);
  routes['deals'] = [403, { error: 'subscribe', subscribe_url: 'https://discord.gg/neuronal' }];
  const { neuronalDeals } = await import('../src/background/neuronal.js');
  const no = await neuronalDeals(settings);
  check('403 subscribe → verrouillé avec le lien', no.locked === 'subscribe' && no.subscribeUrl === 'https://discord.gg/neuronal');
}

console.log('\nJeton expiré : renouvelé une fois ; session fermée : effacé');
{
  await reset(); store.set('state', { userId: 42, accounts: [{ id: 42, name: 'me' }] });
  store.set('premium', { token: 'OLD', exp: later(20) });
  let n = 0;
  routes['player/9'] = (init) => (init.headers.Authorization === 'Bearer NEW' ? [200, { known: false }] : (n++, [401, { error: 'expired' }]));
  routes['auth/refresh'] = [200, { token: 'NEW', exp: later(24) }];
  const r = await neuronalLookup('player', 9, settings);
  check('relu avec le nouveau jeton', r.data && (await premium.premiumGet()).token === 'NEW' && n === 1);
  await neuronalForget();
  routes['player/9'] = [401, { error: 'expired' }];
  routes['auth/refresh'] = [401, { error: 'revoked' }];
  const r2 = await neuronalLookup('player', 9, settings);
  check('renouvellement refusé : verrouillé, jeton oublié', r2.locked && !(await premium.premiumGet()).token);
  // près d'expirer : renouvelé AVANT l'appel
  await reset(); store.set('state', { userId: 42, accounts: [{ id: 42, name: 'me' }] });
  store.set('premium', { token: 'SOON', exp: later(1) });
  routes['auth/refresh'] = [200, { token: 'FRESH', exp: later(24) }];
  const h = await premium.premiumHeaders();
  check("moins de 2 h : renouvelé d'avance", h.Authorization === 'Bearer FRESH');
}

console.log('\nLa clé, puis le code dans la bio');
{
  await reset(); store.set('state', { userId: 42, accounts: [{ id: 42, name: 'me' }] });
  routes['auth/key'] = (init) => (JSON.parse(init.body).key === 'RN-GOOD' ? [200, { ticket: 'T', code: 'ABEILLE CASTOR CITRON BISON', expires_in: 900 }] : [401, { error: 'bad_key' }]);
  check('mauvaise clé', (await premium.premiumKey('RN-BAD')).error === 'bad_key');
  routes['auth/key'] = [403, { error: 'key_bound' }];
  check('clé liée à un autre compte Roblox : refusée', (await premium.premiumKey('RN-GOOD')).error === 'key_bound');
  routes['auth/key'] = (init) => [200, { ticket: 'T', code: 'ABEILLE CASTOR CITRON BISON', expires_in: 900, sent: JSON.parse(init.body) }];
  const k = await premium.premiumKey('RN-GOOD');
  check('le compte suivi est envoyé avec la clé', calls.at(-1).body.roblox_id === 42 && calls.at(-1).body.name === 'me');
  check('le code attend', k.pending.code.split(' ').length === 4 && (await premium.premiumStatus()).pending.ticket === 'T');
  routes['auth/verify'] = [409, { error: 'code_missing' }];
  check("pas encore dans la bio : on attend", (await premium.premiumVerify()).error === 'code_missing' && (await premium.premiumGet()).pending);
  routes['auth/verify'] = [200, { token: 'KEYTOK', exp: later(24), roblox: { id: 42 } }];
  check('vérifié : jeton gardé, code oublié', (await premium.premiumVerify()).ok && (await premium.premiumGet()).token === 'KEYTOK' && !(await premium.premiumGet()).pending);
  store.set('state', { userId: 0 });
  check('pas de compte Roblox suivi : rien ne part', (await premium.premiumKey('RN-GOOD')).error === 'no_roblox');
}

console.log('\nSe déconnecter');
{
  store.set('premium', { token: 'BYE', exp: later(10) });
  calls = []; routes['auth/logout'] = [200, { ok: true }];
  await premium.premiumLogout();
  check('la session est fermée sur le serveur, le jeton effacé', calls[0].path === 'auth/logout' && !(await premium.premiumGet()).token);
}

console.log(`\n${passed} réussis, ${failed} échoués`);
process.exit(failed ? 1 : 0);
