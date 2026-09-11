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
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {}, setBadgeTextColor: async () => {} },
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
let route = null;
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  calls.push((init.method || 'GET') + ' ' + url);
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

console.log(`\n${passed} réussis, ${failed} échoués.`);
process.exit(failed ? 1 : 0);
