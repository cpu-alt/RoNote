/**
 * Apercu du popup, alimente par un faux service worker.
 *
 * On ne remaquette rien : c'est popup.html / popup.css / popup.js tels quels,
 * avec de vraies cotes Rolimon's et de vraies vignettes du CDN Roblox. Une
 * maquette separee finirait toujours par mentir sur le rendu reel.
 */

const store = {};
globalThis.chrome = {
  storage: { local: { get: async () => ({}), set: async () => {} } },
  runtime: { getURL: (p) => p }
};

const roli = await import('../src/common/roli.js');
const apiMod = await import('../src/common/api.js');
const analysis = await import('../src/common/analysis.js');

const json = (p) => fetch(p).then(r => r.json());
const [rawV3, rawV1, thumbs, fxPortfolio] = await Promise.all([
  json('./fixtures/rolimons-v3-itemdetails.json'),
  json('./fixtures/rolimons-itemdetails.json'),
  json('./fixtures/thumbs.json'),
  json('./fixtures/portfolio-sample.json')
]);

const cat = {
  ...roli.mergeSources(roli.parseItems(rawV3), roli.parseItems(rawV1)),
  ratio: 1.6, changes: {}, ready: true, ts: Date.now(), stale: false
};

// Une revision de cote recente, pour voir la pastille 🔁.
cat.changes['a:1029025'] = { from: 340000, to: 400000, pct: 17.6, at: Date.now() - 3600e3 };

// `?lang=en` pour voir l'interface traduite sans toucher aux reglages.
const SETTINGS = {
  enabled: true, pollSeconds: 30, valueBasis: 'value', robuxTax: true,
  showItemDetails: true, useRolimons: true, trackPortfolio: true, reconcilePortfolio: true,
  lang: new URLSearchParams(location.search).get('lang') || 'fr'
};

const ME = 1234567890;
const asset = (id, rap, name, serial = null) =>
  ({ assetId: id, name, recentAveragePrice: rap, serialNumber: serial });
const bundle = (id, rap, name, serial = null) =>
  ({ itemTarget: { itemType: 'Bundle', targetId: String(id) }, itemName: name, recentAveragePrice: rap, serialNumber: serial });

const thumbFor = (item) => {
  for (const k of analysis.thumbKeysFor(item)) {
    const url = thumbs[k.slice(2)];
    if (url) return url;
  }
  return null;
};

let nextId = 3210000000000000;
function makeCard(kind, partner, mine, theirs, { robuxMine = 0, robuxTheirs = 0, minutes = 5, status = 'Open' } = {}) {
  const id = ++nextId;
  const detail = apiMod.normalizeTradeDetail({
    tradeId: id, status,
    participantAOffer: { user: { id: ME, name: 'DemoTrader', displayName: 'DemoTrader' }, robux: robuxMine, items: mine },
    participantBOffer: { user: partner, robux: robuxTheirs, items: theirs }
  }, { created: new Date(Date.now() - minutes * 60000).toISOString() });

  const a = analysis.analyze(detail, ME, cat, null, null, SETTINGS);
  for (const it of [...a.give.items, ...a.get.items]) it.thumb = thumbFor(it);
  return {
    tradeId: id, kind, partner, headshot: thumbs['u' + partner.id] || null,
    created: detail.created, status, analysis: a, verdict: analysis.verdict(a),
    url: 'https://www.roblox.com/trades?tradeId=' + id
  };
}

const bob   = { id: 261, name: 'Shedletsky', displayName: 'Shedletsky' };
const alice = { id: 1, name: 'Roblox', displayName: 'Roblox' };

const CARDS = {
  inbound: [
    // Le cas qui ne s'affichait pas du tout avant : des visages des deux cotes.
    makeCard('inbound', bob,
      [bundle(74870047635131, 13601, 'Snowman Face', 88)],
      [bundle(236385495807573, 19100, 'Fawkes Face'),
       bundle(141680612726107, 1940, 'Blue Goof'),
       asset(1048037, 3114, 'Bighead')],
      { robuxTheirs: 2000, minutes: 3 }),
    // Une perte franche, avec un objet projected en face.
    makeCard('counter', alice,
      [asset(1029025, 372080, 'The Classic ROBLOX Fedora', 4412),
       bundle(160001924154932, 64766, 'The Dog Whisperer', 12)],
      [asset(1037673, 24448, "Jester's Cap")], { minutes: 42 }),
    // Un objet qu'aucune table ne connait : ecart non calculable, jamais 0.
    makeCard('inbound', bob,
      [asset(1048037, 3114, 'Bighead')],
      [asset(999999999, 0, 'UGC tout neuf')], { minutes: 130 })
  ],
  outbound: [
    makeCard('outbound', alice,
      [bundle(141680612726107, 1940, 'Blue Goof')],
      [asset(1048037, 3114, 'Bighead')], { minutes: 900, status: 'Open' })
  ],
  // Une liste PLEINE : c'est le seul cas qui revele les problemes de hauteur,
  // de defilement et de charge (25 cartes, autant que le popup en remonte).
  completed: Array.from({ length: 25 }, (_, i) => makeCard('completed', i % 2 ? bob : alice,
    [asset(1048037, 3114, 'Bighead')],
    i % 3 === 0
      ? [bundle(74870047635131, 13601, 'Snowman Face')]
      : [asset(1037673, 24448, "Jester's Cap")],
    { minutes: 2600 + i * 90, status: 'Completed' }))
};

const lite = (c) => ({ tradeId: c.tradeId, partner: c.partner, created: c.created, status: c.status });

/* ------------------------------ portefeuille --------------------------- */

const portfolioMod = await import('../src/common/portfolio.js');
const report = portfolioMod.reconcile(
  { ...portfolioMod.emptyReport(ME), rolimons: fxPortfolio.playerinfo, rank: fxPortfolio.playerinfo.rank },
  fxPortfolio.playerinfo,
  { counts: fxPortfolio.playerassets, holds: [] },
  fxPortfolio.bundles.filter(b => b.bundleType === 'DynamicHead'),
  cat
);
for (const l of [...report.ghosts, ...report.extras]) {
  l.thumb = thumbs[String(l.legacyAssetId)] || null;
}

const series = [];
for (let i = 120; i >= 0; i--) {
  const t = Date.now() - i * 864e5;
  const wave = Math.sin(i / 9) * 42000 + Math.sin(i / 3) * 12000;
  series.push({ at: t, v: 1720000 + (120 - i) * 980 + wave, r: 1690000 + (120 - i) * 820 + wave * .7, n: 198 });
}

const STATE = {
  userId: ME, userName: 'DemoTrader', enabled: true,
  inboundCount: CARDS.inbound.length, lastOkAt: Date.now() - 12000, lastError: null,
  tracked: { [CARDS.outbound[0].tradeId]: { at: Date.now() } },
  links: {},
  snapshot: {
    at: Date.now() - 12000,
    inbound: CARDS.inbound.map(lite),
    outbound: CARDS.outbound.map(lite),
    completed: CARDS.completed.map(lite)
  },
  valueCount: Object.keys(cat.assets).length + Object.keys(cat.bundles).length,
  valueTs: Date.now() - 42 * 60000, valueStale: false,
  portfolioRank: report.rank, portfolioPrivate: false, collectibles: 198,
  portfolioLast: { v: report.value, r: report.rap, at: Date.now(), rawV: report.rolimons.value, rawR: report.rolimons.rap }
};

const HISTORY = [
  { at: Date.now() - 3 * 60000, kind: 'inbound', tradeId: CARDS.inbound[0].tradeId, partner: 'Shedletsky', pct: 18.4, give: 400000, get: 473700, notified: true },
  { at: Date.now() - 42 * 60000, kind: 'counter', tradeId: CARDS.inbound[1].tradeId, partner: 'Roblox', pct: -93.6, give: 413601, get: 24448, notified: false, skipped: 'gain -93.6% < 0%' },
  { at: Date.now() - 130 * 60000, kind: 'inbound', tradeId: CARDS.inbound[2].tradeId, partner: 'Shedletsky', pct: null, unknown: 1, notified: true },
  { at: Date.now() - 2600 * 60000, kind: 'completed', tradeId: CARDS.completed[0].tradeId, partner: 'Shedletsky', pct: 240.4, give: 4000, get: 13601, notified: true }
];

/* --------------------------- faux service worker ----------------------- */

const log = document.getElementById('log');
const mockRuntime = {
  getURL: (p) => p,
  openOptionsPage: () => { log.textContent = '→ ouverture des réglages'; },
  async sendMessage(msg) {
    switch (msg.type) {
      case 'ronote:get':
      case 'ronote:refresh':
        return { settings: SETTINGS, state: STATE, history: HISTORY, portfolio: series, report };
      case 'ronote:hydrate': {
        const all = [...CARDS.inbound, ...CARDS.outbound, ...CARDS.completed];
        return { cards: all.filter(c => msg.ids.includes(c.tradeId)), failed: [], links: {}, tracked: STATE.tracked };
      }
      case 'ronote:portfolio':
        return { state: STATE, portfolio: series, report };
      case 'ronote:settings':
        Object.assign(SETTINGS, msg.patch || {});
        return { settings: SETTINGS };
      case 'ronote:track':
        return { tracked: STATE.tracked };
      case 'ronote:decline': {
        // On simule ce que fait le service worker : le trade disparait des
        // listes et le compteur baisse. Aucun appel reseau, evidemment.
        for (const kind of ['inbound', 'outbound']) {
          STATE.snapshot[kind] = STATE.snapshot[kind].filter(x => x.tradeId !== msg.tradeId);
          CARDS[kind] = CARDS[kind].filter(c => c.tradeId !== msg.tradeId);
        }
        STATE.inboundCount = STATE.snapshot.inbound.length;
        log.textContent = '→ trade #' + msg.tradeId + ' refusé/annulé (simulation)';
        return { ok: true, via: 'test', state: STATE };
      }
      default:
        return {};
    }
  }
};

const mockChrome = {
  runtime: mockRuntime,
  storage: { local: { get: async () => ({}), set: async () => {} } },
  tabs: { create: ({ url }) => { log.textContent = '→ ouvrirait ' + url; } }
};
globalThis.__ronoteMock = mockChrome;

/* ------------------------------ montage -------------------------------- */

const base = new URL('../src/popup/', location.href).href;
let html = await fetch('../src/popup/popup.html').then(r => r.text());
html = html
  .replace('<head>', `<head><base href="${base}">
    <script>globalThis.chrome = parent.__ronoteMock;<\/script>`);

// `about:blank` est de meme origine : on peut poser le faux `chrome` sur la
// fenetre AVANT d'ecrire le document, donc avant que popup.js ne s'execute.
const frame = document.getElementById('f');
frame.contentWindow.chrome = mockChrome;
const doc = frame.contentDocument;
doc.open();
doc.write(html);
doc.close();

document.querySelectorAll('button[data-tab]').forEach(b => {
  b.addEventListener('click', () => {
    const el = frame.contentDocument.querySelector(`.tab[data-tab="${b.dataset.tab}"]`);
    el?.click();
  });
});
