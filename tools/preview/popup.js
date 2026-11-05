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

const roli = await import('../../src/common/roli.js');
const apiMod = await import('../../src/common/api.js');
const analysis = await import('../../src/common/analysis.js');
const playerMod = await import('../../src/common/player.js');

const json = (p) => fetch(p).then(r => r.json());
const [rawV3, rawV1, thumbs, fxPortfolio] = await Promise.all([
  json('../fixtures/rolimons-v3-itemdetails.json'),
  json('../fixtures/rolimons-itemdetails.json'),
  json('../fixtures/thumbs.json'),
  json('../fixtures/portfolio-sample.json')
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
  useRolimons: true, trackPortfolio: true,
  neuronalLookup: true,   // les fiches montrent la section Neuronal (réponses factices plus bas)
  // La question « Rejoindre la carte Neuronal ? » : seulement avec ?join=1 (sinon elle encombre chaque capture).
  neuronalAsked: !new URLSearchParams(location.search).has('join'),
  ignoredUsers: [],
  lang: new URLSearchParams(location.search).get('lang') || 'fr'
};

const ME = 1234567890;
// Chaque exemplaire a son userAssetId : la contre-offre les retrouve dans les inventaires.
let nextUaid = 900000;
const asset = (id, rap, name, serial = null) =>
  ({ userAssetId: ++nextUaid, assetId: id, name, recentAveragePrice: rap, serialNumber: serial });
const bundle = (id, rap, name, serial = null) =>
  ({ userAssetId: ++nextUaid, itemTarget: { itemType: 'Bundle', targetId: String(id) }, itemName: name, recentAveragePrice: rap, serialNumber: serial });

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

// La suite de « Terminés », au-delà des 25 du relevé : de quoi voir la liste
// se charger page par page en la faisant défiler.
const OLDER_COMPLETED = Array.from({ length: 60 }, (_, i) => makeCard('completed', i % 2 ? alice : bob,
  [asset(1048037, 3114, 'Bighead')],
  i % 4 === 0 ? [bundle(74870047635131, 13601, 'Snowman Face')] : [asset(1037673, 24448, "Jester's Cap")],
  { minutes: 2600 + (25 + i) * 90, status: 'Completed' }));

const lite = (c) => ({ tradeId: c.tradeId, partner: c.partner, created: c.created, status: c.status });

/* ------------------------------ portefeuille --------------------------- */

const portfolioMod = await import('../../src/common/portfolio.js');
const report = portfolioMod.fromRolimons(portfolioMod.emptyReport(ME), fxPortfolio.playerinfo,
  { counts: fxPortfolio.playerassets, holds: [] }, cat);
report.at = Date.now() - 4 * 60000;

// Deux révisions récentes sur des objets possédés : la tuile « 7 j », les
// pourcentages de la liste et le filtre « Réévalués » ont de quoi s'afficher.
{
  const [a, , b] = portfolioMod.portfolioItems(report.holdings, cat).items;
  cat.changes[a.key] = { from: Math.round(a.value / 1.15), to: a.value, pct: 15, at: Date.now() - 5 * 3600e3 };
  cat.changes[b.key] = { from: Math.round(b.value / 0.92), to: b.value, pct: -8, at: Date.now() - 26 * 3600e3 };
}
Object.assign(report, portfolioMod.portfolioItems(report.holdings, cat));
portfolioMod.attachPortfolioThumbs(report,
  portfolioMod.portfolioThumbKeys(report).map(keys => keys.map(k => thumbs[k.slice(2)]).find(Boolean) || null));

// `promo=1` : même courbe, décalée pour finir en hausse sur 24 h, 7 j et 1 mois
// (captures du Store), et l'accueil annonce la version réelle du manifeste.
const PROMO = new URLSearchParams(location.search).get('promo') === '1';
const [P1, P2] = PROMO ? [16, 6] : [0, 0];
const series = [];
for (let i = 120; i >= 0; i--) {
  const t = Date.now() - i * 864e5;
  const wave = Math.sin((i + P1) / 9) * 42000 + Math.sin((i + P2) / 3) * 12000;
  series.push({
    at: t, v: 1720000 + (120 - i) * 980 + wave, r: 1690000 + (120 - i) * 820 + wave * .7,
    n: Math.round(184 + (120 - i) * 0.12 + Math.sin(i / 11) * 3)
  });
}

const STATE = {
  userId: ME, userName: 'DemoTrader', userLogin: 'demotrader', enabled: true,
  userAvatar: CARDS.inbound[0]?.headshot || null,
  // Comptes deja vus sur ce navigateur : le menu du portrait les propose.
  accounts: [
    { id: ME, name: 'demotrader', displayName: 'DemoTrader', avatar: CARDS.inbound[0]?.headshot || null, at: Date.now() },
    { id: 4242, name: 'demo_alt', displayName: 'Alt du démo', avatar: CARDS.inbound[1]?.headshot || null, at: Date.now() - 2 * 864e5 },
    { id: 4343, name: 'mulefarm', displayName: 'mulefarm', avatar: null, at: Date.now() - 9 * 864e5 }
  ],
  inboundCount: CARDS.inbound.length, lastOkAt: Date.now() - 12000, lastError: null,
  tracked: {
    [CARDS.outbound[0].tradeId]: { at: Date.now() },
    // Un suivi dont le trade n'est plus dans les 100 derniers envois : c'est
    // le cas que l'onglet Envoyes montre a part, avec de quoi le desepingler.
    9876543210: { at: Date.now() - 3 * 864e5, partner: { displayName: 'DemoTrader2' }, auto: true }
  },
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
  portfolioLast: { v: report.value, r: report.rap, at: Date.now() }
};

const HISTORY = [
  // Deux reevaluations d'objets possedes : une hausse, une baisse sur deux exemplaires.
  { at: Date.now() - 20 * 60000, kind: 'revalued', name: 'Domino Crown', key: 'a:1', from: 5000000, to: 5750000, pct: 15, count: 1, delta: 750000, notified: true },
  { at: Date.now() - 20 * 60000, kind: 'revalued', name: "Jester's Cap", key: 'a:2', from: 36000, to: 31500, pct: -12.5, count: 2, delta: -9000, notified: true },
  // Un trade rejete par Roblox : le journal l'ouvre en entier (le trade OLDER_COMPLETED[3], marque en erreur).
  { at: Date.now() - 9 * 60000, kind: 'trade_error', tradeId: OLDER_COMPLETED[3].tradeId, partner: OLDER_COMPLETED[3].partner.displayName, pct: OLDER_COMPLETED[3].analysis?.pctMain ?? null, notified: true },
  { at: Date.now() - 3 * 60000, kind: 'inbound', tradeId: CARDS.inbound[0].tradeId, partner: 'Shedletsky', pct: 18.4, give: 400000, get: 473700, notified: true },
  { at: Date.now() - 42 * 60000, kind: 'counter', tradeId: CARDS.inbound[1].tradeId, partner: 'Roblox', pct: -93.6, give: 413601, get: 24448, notified: false, skipped: 'gain -93.6% < 0%' },
  { at: Date.now() - 130 * 60000, kind: 'inbound', tradeId: CARDS.inbound[2].tradeId, partner: 'Shedletsky', pct: null, unknown: 1, notified: true },
  { at: Date.now() - 2600 * 60000, kind: 'completed', tradeId: CARDS.completed[0].tradeId, partner: 'Shedletsky', pct: 240.4, give: 4000, get: 13601, notified: true }
];

/** Deux mois de trades terminés et d'offres reçues, stables d'un chargement à l'autre. */
function demoMonths() {
  let seed = 42;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const out = [];
  for (let i = 0; i < 60; i++) {
    const at = Date.now() - rnd() * 60 * 864e5;
    const give = Math.round(2000 + rnd() * 60000);
    const pct = (rnd() - 0.38) * 40;
    const kind = rnd() < 0.3 ? 'inbound' : rnd() < 0.5 ? 'outbound_accepted' : 'completed';
    out.push({ at, kind, tradeId: 9e15 + i, partner: 'Demo', give, get: Math.round(give * (1 + pct / 100)), pct, notified: true });
  }
  return out;
}

/**
 * Historique d'objet simulé, au format du service worker : trois ans de
 * relevés, plus denses sur la période récente, avec des révisions de cote.
 * Pseudo-aléatoire mais stable : le même objet donne toujours la même courbe.
 */
function demoItemHistory(itemId) {
  const item = report.items.find(i => i.id === itemId || i.faceAssetId === itemId);
  const target = item?.value || 10000;
  const now = Date.now(), day = 864e5, span = 3 * 365 * day;
  let seed = (itemId % 9973) + 1;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const out = { t: [], v: [], r: [], p: [], changes: [] };
  let value = Math.round(target * 0.55), rap = value * 0.9;
  for (let at = now - span; at <= now;) {
    const age = now - at;
    const progress = 1 - age / span;
    if (rnd() < (age < 7 * day ? 0.004 : age < 90 * day ? 0.03 : 0.08)) {
      const next = Math.round(target * (0.55 + 0.45 * progress) * (0.93 + rnd() * 0.14));
      if (next !== value) { out.changes.push([at, value, next]); value = next; }
    }
    rap += (value * (0.9 + rnd() * 0.12) - rap) * 0.3;
    out.t.push(at); out.v.push(value); out.r.push(Math.round(rap)); out.p.push(Math.round(rap * (1.03 + rnd() * 0.08)));
    at += age < 7 * day ? 2 * 3600e3 : age < 90 * day ? day : age < 365 * day ? 3 * day : 14 * day;
  }
  if (value !== target) { out.changes.push([now, value, target]); out.v[out.v.length - 1] = target; }
  return out;
}

/* --------------------------- faux service worker ----------------------- */

const PROMO_VERSION = PROMO ? (await json('../../src/manifest.json')).version : null;
const log = document.getElementById('log');
const SLOW = Number(new URLSearchParams(location.search).get('slow')) || 0;
const mockRuntime = {
  getURL: (p) => p,
  getManifest: () => ({ version: PROMO_VERSION || '2.10.0' }),   // l'accueil propose les nouveautés d'une version pas encore vue
  openOptionsPage: () => { log.textContent = '→ ouverture des réglages'; },
  async sendMessage(msg) {
    switch (msg.type) {
      case 'ronote:get':
      case 'ronote:refresh':
        // ?slow=1500 : un service worker endormi, qui met son temps à répondre.
        if (SLOW) await new Promise(r => setTimeout(r, SLOW));
        return { settings: SETTINGS, state: STATE, history: HISTORY, portfolio: series, report };
      case 'ronote:hydrate': {
        const all = [...CARDS.inbound, ...CARDS.outbound, ...CARDS.completed, ...OLDER_COMPLETED];
        await new Promise(r => setTimeout(r, 300));
        const found = all.filter(c => msg.ids.includes(c.tradeId)).map(c => ({ ...c, kind: msg.kind || c.kind,
          status: c === OLDER_COMPLETED[3] ? 'RejectedDueToError' : c.status }));
        return { cards: found, failed: [], links: {}, tracked: STATE.tracked };
      }
      case 'ronote:list-more': {
        // Pages de 50, la première recouvrant le relevé, comme l'API Roblox.
        await new Promise(r => setTimeout(r, 400));
        const all = msg.kind === 'completed' ? [...CARDS.completed, ...OLDER_COMPLETED] : (CARDS[msg.kind] || []);
        const start = Number(msg.cursor || 0);
        return { trades: all.slice(start, start + 50).map(lite), cursor: start + 50 < all.length ? String(start + 50) : null };
      }
      case 'ronote:portfolio':
        return { state: STATE, portfolio: series, report };
      // Objectif du Portefeuille : même recherche que le service worker, sur le vrai catalogue.
      case 'ronote:catalog-search': {
        const flat = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
        let ids = msg.ids || [];
        if (!msg.ids) {
          const q = flat(msg.query);
          const hits = [];
          for (const [id, e] of Object.entries(cat.assets)) {
            const r = roli.readEntry(e);
            const name = flat(r?.name), acro = flat(r?.acronym);
            const score = acro === q ? 0 : name.startsWith(q) ? 1 : name.includes(q) ? 2 : -1;
            if (score >= 0) hits.push({ score, value: r.value, id: Number(id) });
          }
          ids = hits.sort((a, b) => a.score - b.score || b.value - a.value).slice(0, 8).map(h => ({ assetId: h.id }));
        }
        const items = ids.map(i => analysis.resolveItem(i, cat)).filter(i => !i.unknown);
        return { ready: true, items: items.map(i => ({ assetId: i.assetId, bundleId: i.bundleId, name: i.name, acronym: i.acronym,
          value: i.value, thumb: thumbs[String(i.assetId)] || null })) };
      }
      // Tout le journal (bilan du mois) : le relevé du popup, plus deux mois de trades terminés.
      case 'ronote:history':
        return { history: [...HISTORY, ...demoMonths()] };
      // Fiches Neuronal : Shedletsky est dans la base, Roblox n'y est pas ; tout objet
      // dont l'identifiant est pair y a des trades, les autres non.
      case 'ronote:neuronal-profiles': {
        await new Promise(r => setTimeout(r, 300));
        const now = Date.now() / 1000;
        const neuro = msg.kind === 'neuronal';
        const tiers = neuro ? ['ghost', 'rookie', 'novice', 'beginner', 'casual', 'regular', 'active', 'experienced', 'veteran']
          : ['rookie', 'novice', 'beginner', 'casual', 'regular', 'active', 'experienced', 'veteran'];
        const it = (id, name, value, n = 1) => ({ id, name, value, n, thumb: '' });
        const last = (gave, got, gv, gt) => ({ id: 1, at: now - 240, gave_items: gave, got_items: got, gave_more: 0, got_more: 0, gave: gv, got: gt, parts: 1 });
        const all = [
          { id: 21, name: 'QuietSwapper', ads: 0, tier: 'ghost', at: now - 240, value: 184000, ronote: true, partner: { id: 22, name: 'Telamon' }, trade: 1,
            last: { ...last([it(1, 'Domino Crown', 52000), it(2, 'Sparkle Time Fedora', 9100, 2)], [it(3, 'Valkyrie Helm', 71000)], 70200, 71000), got_robux: 1200, via_ronote: true } },
          { id: 23, name: 'FirstAdGuy', ads: 1, tier: 'rookie', at: now - 900, value: 32000, offering: [it(4, 'Clockwork Shades', 18000), it(5, 'Bucket', 4200)], wanting: [it(6, 'Tailflipped Cap', 0)] },
          { id: 24, name: 'midnight_rap', ads: 4, tier: 'novice', at: now - 3600, value: 71500, partner: { id: 25, name: 'Builderman' }, trade: 2 },
          { id: 26, name: 'ValkFlipper', ads: 22, tier: 'casual', at: now - 7200, value: 1240000, ronote: true },
          { id: 27, name: 'shadow_lim', ads: 0, tier: 'ghost', at: now - 10800, value: 9800 }
        ].filter(p => tiers.includes(p.tier) && (!msg.tier || p.tier === msg.tier));
        return { data: { v: 1, kind: msg.kind, tier: msg.tier || null, tiers, profiles: all } };
      }
      case 'ronote:neuronal': {
        await new Promise(r => setTimeout(r, 450));
        const now = Date.now() / 1000;
        const it = (id, name, n, value) => ({ id, name, n, value });
        const tr = (h, a, b, gave, got, gv, gt, more = 0) => ({ id: h, at: now - h * 3600, a, b, partner: b,
          gave_items: gave, got_items: got, gave_more: more, got_more: 0, gave: gv, got: gt, parts: 1 });
        const shed = { id: bob.id, name: bob.name }, x = { id: 11, name: 'Builderman' }, y = { id: 12, name: 'Telamon' };
        if (msg.kind === 'player') {
          if (Number(msg.id) !== bob.id) return { data: { v: 1, id: Number(msg.id), known: false } };
          return { data: { v: 1, id: bob.id, known: true, name: bob.name, bot: false, term: false, depth: 3,
            first_seen: now - 41 * 86400, last_check: now - 600, trades: 37, partners: 21,
            top: [], stats: { judged: 18, net: 412300, won: 11, lost: 6 },
            recent: [
              tr(3, shed, x, [it(1, 'Domino Crown', 1, 4100000)], [it(2, 'Sparkle Time Fedora', 1, 3200000), it(3, 'Valkyrie Helm', 2, 520000)], 4100000, 4240000),
              tr(26, shed, y, [it(4, 'Clockwork\'s Headphones', 1, 210000), it(5, 'Bucket', 3, 9000)], [it(6, 'Red Sparkle Time Fedora', 1, 180000)], 237000, 180000, 1)
            ] } };
        }
        if (Number(msg.id) % 2) return { data: { v: 1, id: Number(msg.id), known: false } };
        return { data: { v: 1, id: Number(msg.id), known: true, name: 'Objet', value: 0, projected: false,
          trades: 14, holders: 9, copies: 12,
          top_holders: [{ id: 11, name: 'Builderman', n: 3 }, { id: 12, name: 'Telamon', n: 2 }, { id: bob.id, name: bob.name, n: 1 }],
          recent: [
            tr(5, x, y, [it(Number(msg.id), 'Cet objet', 1, 25000)], [it(7, 'Midnight Shades', 1, 31000)], 25000, 31000),
            tr(49, y, shed, [it(8, 'Ice Valkyrie', 1, 60000)], [it(Number(msg.id), 'Cet objet', 2, 25000)], 60000, 50000)
          ] } };
      }
      case 'ronote:item-history':
        await new Promise(r => setTimeout(r, 350));   // le temps de voir le chargement
        return { history: demoItemHistory(Number(msg.itemId)) };
      case 'ronote:player': {
        // Shedletsky joue ici le compte de 12 jours, pour voir l'alerte « compte
        // récent » ; Roblox, l'inventaire privé.
        await new Promise(r => setTimeout(r, 350));
        const id = Number(msg.userId);
        const who = [bob, alice].find(u => u.id === id) || { id, name: msg.name, displayName: msg.name };
        const priv = id === alice.id;
        return {
          events: playerMod.historyFor(HISTORY, who),
          profile: { id, name: who.name, displayName: who.displayName, created: priv ? Date.parse('2006-02-27') : Date.now() - 12 * 864e5, banned: false, verified: priv },
          roli: { value: priv ? 0 : 1250400, rap: priv ? 0 : 986200, rank: priv ? 0 : 8123, private: priv, terminated: false, lastOnline: Date.now() - 3 * 3600e3 },
          ignored: SETTINGS.ignoredUsers.some(u => Number(u.id) === id),
          rolimons: true
        };
      }
      case 'ronote:player-history': {
        // Roblox (inventaire privé) : pas d'historique, pour voir le message.
        await new Promise(r => setTimeout(r, 600));
        if (Number(msg.userId) === alice.id) return { error: 'HTTP 403' };
        const k = 1250400 / series[series.length - 1].v;
        return { points: playerMod.thinSeries(series.map(p => ({ at: p.at, v: Math.round(p.v * k), r: Math.round(p.r * k * 0.8), n: Math.round(p.n * 0.3) }))) };
      }
      case 'ronote:player-faces': {
        // Shedletsky prend l'inventaire réel anonymisé de l'aperçu (fantômes
        // compris) ; Roblox, l'inventaire privé.
        await new Promise(r => setTimeout(r, 500));
        if (Number(msg.userId) === alice.id) {
          return { faces: playerMod.playerFaces({ ...portfolioMod.emptyReport(alice.id), ok: false, private: true, reason: "inventaire privé — Rolimon's ne publie rien" }) };
        }
        return { faces: playerMod.playerFaces(report) };
      }
      // Le Lucky Cat de l'aperçu : la Classic ROBLOX Fedora #4412 du deuxième trade.
      case 'ronote:lucky-cat':
        return { luckyCat: { uaid: 987654321, assetId: 1029025, serial: 4412, name: 'The Classic ROBLOX Fedora', since: Date.now() - 2 * 3600e3 } };
      case 'ronote:mute':
        if (!SETTINGS.ignoredUsers.some(u => Number(u.id) === Number(msg.userId))) {
          SETTINGS.ignoredUsers.push({ id: Number(msg.userId), name: msg.name || '' });
        }
        return { settings: SETTINGS };
      case 'ronote:unmute':
        SETTINGS.ignoredUsers = SETTINGS.ignoredUsers.filter(u => Number(u.id) !== Number(msg.userId));
        return { settings: SETTINGS };
      case 'ronote:settings':
        Object.assign(SETTINGS, msg.patch || {});
        // Comme le vrai worker, qui écrit les réglages : le popup se redessine.
        storeListeners.forEach(fn => fn({ settings: { oldValue: SETTINGS, newValue: SETTINGS } }, 'local'));
        return { settings: SETTINGS };
      case 'ronote:track': {
        // Comme le worker : un id ou un lot, pose ou retire.
        const ids = Array.isArray(msg.ids) ? msg.ids : [msg.tradeId];
        for (const raw of ids) {
          const id = Number(raw);
          if (!Number.isFinite(id)) continue;
          if (msg.on === false) delete STATE.tracked[id];
          else STATE.tracked[id] = { at: Date.now(), partner: msg.partner || null, auto: false };
        }
        return { tracked: STATE.tracked };
      }
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
      case 'ronote:forget-account': {
        STATE.accounts = STATE.accounts.filter(a => a.id !== Number(msg.userId) || a.id === STATE.userId);
        return { state: STATE };
      }
      // Les deux inventaires de l'éditeur de contre-offre : les objets du
      // trade, puis des limiteds réels du fixture de portefeuille.
      case 'ronote:counter-load': {
        await new Promise(r => setTimeout(r, 500));
        const card = CARDS.inbound.find(c => c.partner.id === Number(msg.partnerId)) || CARDS.inbound[0];
        const fromTrade = (items) => items.map(i => ({ uaid: i.uaid, assetId: i.assetId, bundleId: i.bundleId,
          name: i.name, acronym: i.acronym, serial: i.serial, value: i.value, rap: i.rap, prudent: i.prudent,
          unknown: i.unknown, noValue: i.noValue, onHold: false, projected: i.projected, isFace: i.isFace, thumb: i.thumb }));
        const extra = (ids, base) => ids.map((id, n) => {
          const r = analysis.resolveItem({ assetId: Number(id), recentAveragePrice: 0 }, cat);
          return { uaid: base + n, assetId: r.assetId, bundleId: r.bundleId, name: r.name, acronym: r.acronym, serial: null,
            value: r.value, rap: r.rap, prudent: r.prudent, unknown: r.unknown, noValue: r.noValue,
            onHold: n === 2, projected: r.projected, isFace: r.isFace, thumb: thumbFor(r) };
        }).filter(i => !i.unknown);
        const ids = Object.keys(fxPortfolio.playerassets);
        return {
          myId: ME,
          me: { items: [...fromTrade(card.analysis.give.items), ...extra(ids.slice(0, 24), 700000)] },
          them: { items: [...fromTrade(card.analysis.get.items), ...extra(ids.slice(24, 60), 800000)] }
        };
      }
      case 'ronote:counter': {
        await new Promise(r => setTimeout(r, 400));
        STATE.snapshot.inbound = STATE.snapshot.inbound.filter(x => x.tradeId !== msg.tradeId);
        CARDS.inbound = CARDS.inbound.filter(c => c.tradeId !== msg.tradeId);
        STATE.inboundCount = STATE.snapshot.inbound.length;
        log.textContent = '→ contre-offre #' + msg.tradeId + ' : donne ' + msg.give.join(',') + ' + ' + msg.giveRobux
          + ' R$ · demande ' + msg.get.join(',') + ' + ' + msg.getRobux + ' R$ (simulation)';
        return { ok: true, via: 'test', state: STATE };
      }
      case 'ronote:accept': {
        // ?challenge=1 : Roblox exige une vérification en deux étapes, pour voir ce cas.
        if (new URLSearchParams(location.search).has('challenge')) {
          log.textContent = '→ trade #' + msg.tradeId + ' : vérification demandée par Roblox (simulation)';
          return { challenge: true, error: 'Challenge is required to authorize the request' };
        }
        STATE.snapshot.inbound = STATE.snapshot.inbound.filter(x => x.tradeId !== msg.tradeId);
        CARDS.inbound = CARDS.inbound.filter(c => c.tradeId !== msg.tradeId);
        STATE.inboundCount = STATE.snapshot.inbound.length;
        log.textContent = '→ trade #' + msg.tradeId + ' accepté (simulation)';
        return { ok: true, via: 'test', state: STATE };
      }
      default:
        return {};
    }
  }
};

// Un stockage en mémoire qui prévient ses écouteurs, comme le vrai : ce que
// le popup y range (objectif, …) revient à l'écran.
// Seme comme le vrai stockage : le popup s'affiche depuis lui, sans attendre le worker.
const memory = { settings: SETTINGS, state: STATE, history: HISTORY, portfolio: series, portfolioReport: report }, storeListeners = [];
const mockChrome = {
  runtime: mockRuntime,
  storage: {
    local: {
      get: async (k) => Object.fromEntries((Array.isArray(k) ? k : [k]).filter(x => x in memory).map(x => [x, memory[x]])),
      set: async (obj) => {
        const changes = {};
        for (const [k, v] of Object.entries(obj)) { changes[k] = { oldValue: memory[k], newValue: v }; memory[k] = v; }
        storeListeners.forEach(fn => fn(changes, 'local'));
      }
    },
    onChanged: { addListener: (fn) => storeListeners.push(fn) }
  },
  tabs: { create: ({ url }) => { log.textContent = '→ ouvrirait ' + url; } },
  // ?deny=1 : la boîte de permission refusée.
  permissions: {
    request: async () => !new URLSearchParams(location.search).has('deny'),
    contains: async () => true
  }
};
globalThis.__ronoteMock = mockChrome;

/* ------------------------- états pour les captures --------------------- */

// Captures sans clic (Chrome headless) :
//   ?tab=stats&view=grid&metric=r&hidden=1&scroll=320&item=1&lang=en
// Les préférences du portefeuille vivent dans localStorage, que le popup lit
// à son chargement : on les pose avant d'écrire la page. Sans paramètre,
// l'aperçu repart donc toujours des valeurs par défaut.
const shot = new URLSearchParams(location.search);
{
  const prefs = {};
  for (const k of ['view', 'range', 'sort', 'filter']) if (shot.get(k)) prefs[k] = shot.get(k);
  if (shot.get('series')) prefs.series = shot.get('series').split(',');
  if (shot.has('hidden')) prefs.hidden = shot.get('hidden') === '1';
  try { localStorage.setItem('ronote:wallet', JSON.stringify(prefs)); } catch { /* aperçu sans stockage */ }
}

/* ------------------------------ montage -------------------------------- */

const base = new URL('../../src/popup/', location.href).href;
let html = await fetch('../../src/popup/popup.html').then(r => r.text());
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

// La fiche d'un joueur élargit le popup : le cadre suit, comme le fait Chrome.
{
  const fit = () => {
    const w = doc.documentElement.classList.contains('side-open') ? Math.max(420, doc.body?.offsetWidth || 0) : 420;
    frame.style.width = frame.parentElement.style.width = w + 'px';
  };
  new frame.contentWindow.MutationObserver(fit).observe(doc.documentElement, { attributes: true, attributeFilter: ['class'] });
}

document.querySelectorAll('button[data-tab]').forEach(b => {
  b.addEventListener('click', () => {
    const el = frame.contentDocument.querySelector(`.tab[data-tab="${b.dataset.tab}"]`);
    el?.click();
  });
});

if (shot.get('tab')) {
  const pdoc = frame.contentDocument;
  const until = async (test) => {
    for (let i = 0; i < 120 && !test(); i++) await new Promise(r => setTimeout(r, 50));
  };
  // popup.js est un module : il ne s'exécute qu'une fois ses imports chargés.
  await until(() => pdoc.getElementById('acct')?.textContent.startsWith('@'));
  pdoc.querySelector(`.tab[data-tab="${shot.get('tab')}"]`)?.click();
  // Le défilement attend que la liste ait du contenu : sinon il retombe à zéro.
  await until(() => pdoc.querySelector('#list .tc-swap, #list .w-hero, #list .h-hero, #list .jr, #list .empty'));
  if (shot.get('scroll')) pdoc.getElementById('list').scrollTop = Number(shot.get('scroll'));
  // `scrub=0.6` : simule le survol du graphique à 60 % de sa largeur.
  if (shot.get('scrub')) {
    await until(() => pdoc.getElementById('w-plot'));
    const plot = pdoc.getElementById('w-plot');
    const box = plot.getBoundingClientRect();
    plot.dispatchEvent(new frame.contentWindow.PointerEvent('pointermove', {
      clientX: box.left + box.width * Number(shot.get('scrub')), bubbles: true
    }));
  }
  if (shot.get('item')) pdoc.querySelector('[data-item]')?.click();
  // `trade=1` : ouvre le zoom du premier trade évalué ; `detail=1` : déplie son détail.
  if (shot.get('trade') || shot.get('detail')) {
    await until(() => pdoc.querySelector('.tc-body[data-zoom] .tc-swap'));
    // `trade=2` ouvre le deuxième trade de la liste, `detail=2` déplie le sien.
    const nth = (sel, key) => pdoc.querySelectorAll(sel)[Math.max(1, Number(shot.get(key)) || 1) - 1];
    await until(() => pdoc.querySelectorAll('.tc-body[data-zoom] .tc-swap').length >= Number(shot.get('trade') || shot.get('detail')));
    if (shot.get('detail')) nth('button[data-expand]', 'detail')?.click();
    else nth('.tc-body[data-zoom]', 'trade')?.click();
  }
  // `player=2` : ouvre la fiche du joueur de la deuxième carte.
  if (shot.get('player')) {
    const n = Math.max(1, Number(shot.get('player')) || 1);
    await until(() => pdoc.querySelectorAll('.tc button[data-player]').length >= n);
    pdoc.querySelectorAll('.tc button[data-player]')[n - 1]?.click();
    // `ftab=gone` : ses bundles qu'il n'a plus ; `pscroll=420` : fait défiler la fiche.
    if (shot.get('ftab') || shot.get('pscroll')) {
      await until(() => pdoc.querySelector('#p-body [data-ftab]'));
      if (shot.get('ftab')) pdoc.querySelector(`#p-body [data-ftab="${shot.get('ftab')}"]`)?.click();
      if (shot.get('pscroll')) pdoc.getElementById('p-body').scrollTop = Number(shot.get('pscroll'));
    }
  }
}
