// Tests du service worker réel dans un faux navigateur : écritures concurrentes,
// arrêt sur limite de débit, réveil qui ne relance pas une vérification trop tôt.
// Aucun réseau (fetch simulé). Usage : node tools/test-worker.mjs
const store = new Map();
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const listeners = {};
const ev = (name) => ({ addListener: (fn) => { (listeners[name] ||= []).push(fn); } });

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        const ks = keys == null ? [...store.keys()] : Array.isArray(keys) ? keys : [keys];
        const o = {};
        for (const k of ks) if (store.has(k)) o[k] = clone(store.get(k));
        return o;
      },
      async set(obj) { for (const [k, v] of Object.entries(obj)) store.set(k, clone(v)); },
      async remove(keys) { for (const k of [].concat(keys)) store.delete(k); }
    },
    onChanged: ev('storage')
  },
  runtime: {
    onInstalled: ev('installed'), onStartup: ev('startup'), onMessage: ev('message'),
    getURL: (p) => 'chrome-extension://x/' + p, getManifest: () => ({ version: '2.10.0' }),
    sendMessage: async () => ({})
  },
  alarms: { create: async () => {}, clear: async () => true, onAlarm: ev('alarm') },
  notifications: {
    create: async (id) => id, clear: async () => true,
    onClicked: ev('nclick'), onButtonClicked: ev('nbtn'), onClosed: ev('nclosed')
  },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setBadgeTextColor: async () => {},
    setPopup: async () => {}, onClicked: { addListener() {} } },
  declarativeNetRequest: { updateSessionRules: async () => {} },
  tabs: { query: async () => [] }
};

let passed = 0, failed = 0;
const check = (label, ok) => { if (ok) { passed++; console.log('  ✓ ' + label); } else { failed++; console.error('  ✗ ' + label); } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function waitFor(fn, ms = 15000) {
  const t0 = Date.now();
  while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(20); }
  return true;
}

let calls = [];
let bodies = [];
let route = null;
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  calls.push((init.method || 'GET') + ' ' + url);
  if (init.body) bodies.push([url, init.body]);
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const custom = route && await route(url, json);
  if (custom) return custom;
  if (url.includes('/users/authenticated')) return json({ id: 1, name: 'me', displayName: 'me' });
  if (url.includes('/decline')) return json({});
  if (/\/trades\/(Inbound|Outbound|Completed|Inactive)\?/.test(url)) return json({ data: [] });
  if (url.includes('/inbound/count')) return json({ count: 0 });
  return json({}, 404);
};

const seeded = () => Object.fromEntries(['inbound', 'outbound', 'completed', 'inactive']
  .map(k => [k, { seen: [], newest: 0, seededAt: 1, belowMark: 0 }]));
function preset(state = {}) {
  store.clear();
  store.set('settings', { enabled: true, useRolimons: false, trackPortfolio: false, desktopNotifications: false, sound: false });
  store.set('state', { userId: 1, userName: 'me', meCheckedAt: Date.now(), ...state });
  store.set('streams', seeded());
  calls = [];
}
const SW = new URL('../src/background/service-worker.js', import.meta.url).href;

console.log('\nUn suivi et un refus demandés pendant une vérification');
{
  preset();
  let release;
  const gate = new Promise(r => { release = r; });
  route = async (url) => { if (/\/trades\/Inbound\?/.test(url)) await gate; return null; };
  await import(SW + '?run=1');
  const send = (msg) => new Promise(res => listeners.message.at(-1)(msg, {}, res));

  check('la vérification est bien en cours (liste Inbound demandée)', await waitFor(() => calls.some(c => c.includes('/trades/Inbound?'))));
  const tr = await send({ type: 'ronote:track', tradeId: 555, on: true, partner: { id: 9 } });
  check('le suivi répond tout de suite', !!tr?.tracked?.[555]);
  const de = await send({ type: 'ronote:decline', tradeId: 777, kind: 'inbound', partner: 'bob', partnerId: 9 });
  check('le refus répond tout de suite', de?.ok === true);
  release();
  check('la vérification se termine', await waitFor(() => (store.get('state')?.lastOkAt || 0) > 0));
  await sleep(100);
  const st = store.get('state'), streams = store.get('streams');
  check('le suivi a survécu à l\'écriture de la vérification', !!st.tracked?.[555]);
  check('le refus reste marqué vu (Inactive)', streams.inactive.seen.includes(777));
  check('le refus reste marqué vu (Completed)', streams.completed.seen.includes(777));
  check('l\'ancienne table des clics n\'est plus dans state', !('notifMap' in st));
  route = null;
}

console.log('\nLimite de débit pendant une vérification');
{
  preset();
  route = async (url, json) => (/\/trades\/Inactive\?/.test(url) ? json({}, 429) : null);
  await import(SW + '?run=2');
  check('la pause est posée', await waitFor(() => (store.get('state')?.backoffUntil || 0) > Date.now()));
  await sleep(200);
  const lists = calls.filter(c => /\/trades\/(Inbound|Outbound|Completed)\?/.test(c));
  check('aucune autre liste demandée après le refus', lists.length === 0);
  check('l\'erreur est retenue', store.get('state')?.lastError?.status === 429);
  route = null;
}

console.log('\nRéveil du worker juste après une vérification');
{
  preset({ lastPollAt: Date.now() - 5000 });
  await import(SW + '?run=3');
  await sleep(600);
  check('aucun appel : la cadence de 30 s est respectée', calls.length === 0);
}

console.log('\nAccepter un trade reçu, puis une vérification exigée par Roblox');
{
  preset({ inboundCount: 2, snapshot: { inbound: [{ tradeId: 888 }, { tradeId: 889 }], outbound: [] } });
  let challenge = false;
  route = async (url, json) => {
    if (!url.includes('/accept')) return null;
    return challenge ? json({ errors: [{ code: 0, message: 'Challenge is required to authorize the request' }] }, 403) : json({});
  };
  await import(SW + '?run=4');
  const send = (msg) => new Promise(res => listeners.message.at(-1)(msg, {}, res));
  const ok = await send({ type: 'ronote:accept', tradeId: 888, partner: 'bob', partnerId: 9 });
  check('l\'acceptation répond ok', ok?.ok === true);
  check('Roblox reçoit bien un POST /accept', calls.some(c => /^POST .*\/trades\/888\/accept$/.test(c)));
  const st = store.get('state'), streams = store.get('streams');
  check('le trade accepté sort de la liste des reçus', !st.snapshot.inbound.some(t => t.tradeId === 888));
  check('le compteur des reçus baisse', st.inboundCount === 1);
  check('le trade accepté est marqué vu (Completed) : pas d\'alerte de son propre geste', streams.completed.seen.includes(888));
  check('le flux Inactive reste libre : un rejet de Roblox sera signalé', !streams.inactive.seen.includes(888));
  challenge = true;
  const ch = await send({ type: 'ronote:accept', tradeId: 889 });
  check('une vérification exigée est signalée comme telle', ch?.challenge === true && !ch.ok);
  check('le trade non accepté reste dans la liste', store.get('state').snapshot.inbound.some(t => t.tradeId === 889));
  route = null;
}

console.log('\nChangement de compte sur roblox.com pendant que l\'identité est en cache');
{
  // Le compte 1 est connu et vérifié il y a peu ; le navigateur est désormais
  // connecté au compte 2, dont les trades reçus sont tous inconnus du compte 1.
  preset({ lastPollAt: 0 });
  const now = new Date().toISOString();
  const theirs = [101, 102, 103].map(id => ({ id, status: 'Open', created: now, user: { id: 50 + id, name: 'p' + id } }));
  route = async (url, json) => {
    if (url.includes('/users/authenticated')) return json({ id: 2, name: 'alt', displayName: 'Alt' });
    if (/\/trades\/Inbound\?/.test(url)) return json({ data: theirs });
    return null;
  };
  await import(SW + '?run=5');
  check('le changement de compte est détecté', await waitFor(() => Number(store.get('state')?.userId) === 2));
  await sleep(200);
  const hist = store.get('history') || [];
  check('aucun trade du nouveau compte ne part en notification ni au journal', !hist.some(h => [101, 102, 103].includes(h.tradeId)));
  check('le nouveau compte rejoint la liste des comptes', (store.get('state').accounts || []).some(a => a.id === 2 && a.name === 'alt'));
  check('les flux de l\'ancien compte sont oubliés', !Object.values(store.get('streams') || {}).some(s => s.seen?.length && !s.seen.some(id => id >= 101)));
  route = null;
}

console.log('\nContre-offre envoyée depuis le popup');
{
  preset({ inboundCount: 1, snapshot: { inbound: [{ tradeId: 777001 }], outbound: [] } });
  bodies = [];
  route = async (url, json) => (url.includes('/counter') ? json({ id: 999 }) : null);
  await import(SW + '?run=6');
  const send = (msg) => new Promise(res => listeners.message.at(-1)(msg, {}, res));
  const res = await send({ type: 'ronote:counter', tradeId: 777001, partnerId: 42, partner: 'bob',
    give: [11, 12], get: [21], giveRobux: 0, getRobux: 500, giveValue: 1000, getValue: 1200, pct: 20 });
  check('la contre-offre répond ok', res?.ok === true);
  const sent = bodies.find(([u]) => /\/trades\/777001\/counter$/.test(u));
  const body = sent ? JSON.parse(sent[1]) : null;
  check('Roblox reçoit les deux offres : ses objets et Robux, puis les miens',
    JSON.stringify(body?.offers) === JSON.stringify([{ userId: 42, userAssetIds: [21], robux: 500 }, { userId: 1, userAssetIds: [11, 12], robux: 0 }]));
  check('le trade d\'origine sort des reçus', !store.get('state').snapshot.inbound.length && store.get('state').inboundCount === 0);
  check('le journal note la contre-offre', (store.get('history') || []).some(h => h.kind === 'countered_by_me' && h.tradeId === 777001));
  const empty = await send({ type: 'ronote:counter', tradeId: 777002, partnerId: 42, give: [11], get: [] });
  check('une contre-offre sans rien demander est refusée avant Roblox', !!empty?.error && !bodies.some(([u]) => u.includes('777002')));
  route = null;
}

console.log('\nLe son dit la qualité du trade');
{
  const { soundFor } = await import(new URL('../src/background/notifier.js', import.meta.url).href);
  const S = { soundByQuality: true, sounds: { inbound: 'chime', accepted: 'success', error: 'alert' } };
  const ev = (kind, pctMain, extra = {}) => ({ kind, analysis: { pctMain, ...extra } });
  check('très bon trade reçu : la note la plus claire', soundFor('inbound', [ev('inbound', 40)], S) === 'grade-5');
  check('très mauvais : la plus sombre', soundFor('inbound', [ev('inbound', -60)], S) === 'grade-1');
  check('équilibré : la note du milieu', soundFor('inbound', [ev('counter', 1)], S) === 'grade-3');
  check('plusieurs reçus dans le passage : le meilleur l\'emporte', soundFor('inbound', [ev('inbound', -12), ev('inbound', 8)], S) === 'grade-4');
  check('trade conclu : noté aussi', soundFor('accepted', [ev('completed', -10)], S) === 'grade-2');
  check('sans cote : le son choisi', soundFor('inbound', [ev('inbound', 0, { incomplete: true })], S) === 'chime');
  check('une erreur Roblox garde son son', soundFor('error', [ev('trade_error', 50)], S) === 'alert');
  check('option coupée : le son choisi', soundFor('inbound', [ev('inbound', 40)], { ...S, soundByQuality: false }) === 'chime');
  check('famille muette : reste muette', soundFor('inbound', [ev('inbound', 40)], { ...S, sounds: { inbound: 'none' } }) === 'none');
}

console.log(`\n${passed} réussis, ${failed} échoués.`);
process.exit(failed ? 1 : 0);
