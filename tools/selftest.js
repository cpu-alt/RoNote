/**
 * ==========================================================================
 *  AUTO-TESTS — a ouvrir dans un navigateur
 * --------------------------------------------------------------------------
 *      python tools/serve.py        puis  http://127.0.0.1:8777/tools/selftest.html
 *
 *  Charger reellement les modules dans un navigateur verifie d'un coup ce
 *  qu'aucun outil externe n'est installe pour verifier ici : la syntaxe, les
 *  imports, et le comportement. Un module qui ne compile pas fait echouer
 *  l'import, donc le test.
 *
 *  Les jeux d'essai sont de VRAIES reponses d'API, pas des maquettes :
 *  c'est le seul moyen de detecter qu'un renommage de champ cote Roblox ou
 *  Rolimon's casse silencieusement l'evaluation.
 * ==========================================================================
 */

/* --- faux `chrome`, avant tout import : shim.js le lit au chargement ----- */
const store = {};
globalThis.chrome = {
  storage: {
    local: {
      get: async (k) => {
        const keys = k == null ? Object.keys(store) : (Array.isArray(k) ? k : [k]);
        const out = {};
        for (const key of keys) if (key in store) out[key] = store[key];
        return out;
      },
      set: async (obj) => { Object.assign(store, obj); }
    }
  },
  runtime: {
    getURL: (p) => p,
    onMessage: { addListener() {} },
    onInstalled: { addListener() {} },
    onStartup: { addListener() {} },
    sendMessage: async () => ({}),
    getContexts: async () => []
  },
  notifications: {
    create: async () => 'id', clear: async () => {},
    onClicked: { addListener() {} }, onButtonClicked: { addListener() {} },
    onClosed: { addListener() {} }
  },
  alarms: { onAlarm: { addListener() {} }, clear: async () => {}, create: async () => {} },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  tabs: { query: async () => [], create: async () => {}, update: async () => {} },
  scripting: { executeScript: async () => [] },
  declarativeNetRequest: { updateSessionRules: async () => {} }
};

const out = document.getElementById('out');
let pass = 0, fail = 0;

const line = (cls, txt) => {
  const d = document.createElement('div');
  d.className = 'l ' + cls;
  d.textContent = txt;
  out.appendChild(d);
};
const group = (t) => { const h = document.createElement('h2'); h.textContent = t; out.appendChild(h); };
const info = (t) => line('info', '  ' + t);

function check(label, got, expected) {
  const g = JSON.stringify(got), e = JSON.stringify(expected);
  if (g === e) { pass++; line('ok', '✓ ' + label); }
  else { fail++; line('ko', `✗ ${label}\n      attendu ${e}\n      obtenu  ${g}`); }
}
function truthy(label, v) { check(label, !!v, true); }

const json = (p) => fetch(p).then(r => r.json());

/* ======================================================================== */

try {
  const roli = await import('../src/common/roli.js');
  const apiMod = await import('../src/common/api.js');
  const analysis = await import('../src/common/analysis.js');
  const portfolio = await import('../src/common/portfolio.js');
  const filters = await import('../src/common/filters.js');
  const thumbs = await import('../src/common/thumbs.js');
  const streams = await import('../src/background/streams.js');
  const tracker = await import('../src/background/tracker.js');
  const utils = await import('../src/common/utils.js');
  await import('../src/common/defaults.js');
  await import('../src/common/state.js');
  await import('../src/common/filters.js');
  await import('../src/common/tones.js');
  await import('../src/background/notifier.js');
  // Charges pour leur seule syntaxe : une apostrophe mal echappee dans l'un
  // d'eux tue la page qui l'importe, et rien d'autre ne le verrait. La liste
  // est tenue a jour par tools/check.py, qui refuse un module absent d'ici.
  await import('../src/common/shim.js');
  await import('../src/common/ui.js');
  await import('../src/common/icons.js');
  await import('../src/common/player.js');
  await import('../src/common/changelog.js');
  await import('../src/common/revalue.js');

  group('Modules');
  line('ok', '✓ tous les modules se chargent (syntaxe + imports)');
  pass++;

  /* ------------------------- catalogue Rolimon's ------------------------ */
  group("Catalogue Rolimon's");
  const rawV3 = await json('./fixtures/rolimons-v3-itemdetails.json');
  const rawV1 = await json('./fixtures/rolimons-itemdetails.json');
  const v3 = roli.parseItems(rawV3);
  const v1 = roli.parseItems(rawV1);

  truthy('v3 : assets lus', Object.keys(v3.assets).length > 2000);
  truthy('v3 : bundles lus', Object.keys(v3.bundles).length > 100);
  truthy('v1 : items lus', Object.keys(v1.assets).length > 2000);
  info(`${Object.keys(v3.assets).length} assets, ${Object.keys(v3.bundles).length} bundles, ${Object.keys(v1.assets).length} en v1`);

  // v3 a laisse tomber la colonne « hyped » : `rare` est la DERNIERE colonne,
  // pas l'indice 9. Se tromper la-dessus fait passer un objet rare pour banal.
  const dc3 = roli.readEntry(v3.assets['1031429']);   // Domino Crown
  const dc1 = roli.readEntry(v1.assets['1031429']);
  check('Domino Crown : value identique v1/v3', dc3.value, dc1.value);
  check('Domino Crown : rare detecte en v3 (9 colonnes)', dc3.rare, true);
  check('Domino Crown : rare detecte en v1 (10 colonnes)', dc1.rare, true);
  const jc = roli.readEntry(v3.assets['1037673']);    // Jester's Cap
  check("Jester's Cap : projected", jc.projected, true);
  check("Jester's Cap : pas de value publiee -> retombe sur le RAP", [jc.noValue, jc.value], [true, jc.rap]);

  /* ---------------------------- pont visages ---------------------------- */
  group('Pont visage ↔ bundle');
  const cat = roli.mergeSources(v3, v1);
  const bridged = Object.keys(cat.faceOf).length;
  truthy(`${bridged} bundles rapproches de leur ancien visage`, bridged >= 150);
  check('The Dog Whisperer : bundle -> ancien asset',
    cat.faceOf['160001924154932'], '34764447');
  check('The Dog Whisperer : ancien asset -> bundle',
    cat.bundleOf['34764447'], '160001924154932');
  // « Zip It! » existe en visage (24126147) ET en chapeau (100931472).
  // Restreindre la recherche aux assets que v3 a retires evite le faux positif.
  check('Zip It! : rapproche du VISAGE, pas du chapeau',
    cat.faceOf['265775141751850'], '24126147');
  // Un bundle qui n'a jamais ete un visage ne doit etre rapproche de rien.
  check('The Jade Catseye : aucun ancien visage', cat.faceOf['939596'], undefined);
  check('le bundle reste cote malgre tout',
    roli.readEntry(cat.bundles['939596']).value > 0, true);

  /* --------------------- normalisation d'un trade v2 -------------------- */
  group('Detail de trade — schema v2 (bundles)');
  // Reponse conforme au schema officiel de trades.roblox.com v2 : c'est celui
  // que Roblox sert des qu'un trade contient un bundle, donc un visage.
  const rawTrade = {
    tradeId: 2645140139823455,
    status: 'Open',
    participantAOffer: {
      user: { id: 1, name: 'Moi', displayName: 'Moi' },
      robux: 0,
      items: [{
        collectibleItemInstanceId: 'a1b2',
        itemTarget: { itemType: 'Asset', targetId: '1031429' },
        itemName: 'Domino Crown', serialNumber: null, recentAveragePrice: 5726071
      }]
    },
    participantBOffer: {
      user: { id: 2, name: 'Bob', displayName: 'Bob' },
      robux: 1000,
      items: [{
        collectibleItemInstanceId: 'c3d4',
        itemTarget: { itemType: 'Bundle', targetId: '160001924154932' },
        itemName: 'The Dog Whisperer', serialNumber: 12, recentAveragePrice: 64766
      }]
    }
  };
  const d2 = apiMod.normalizeTradeDetail(rawTrade, { created: '2026-01-01T00:00:00Z' });
  check('deux offres reconnues', d2.offers.length, 2);
  check('un asset garde son assetId',
    [d2.offers[0].userAssets[0].assetId, d2.offers[0].userAssets[0].bundleId], [1031429, 0]);
  // LE bug corrige : sans lecture de `itemTarget`, ces deux nombres valaient 0
  // et TOUS les objets du trade perdaient leur cote et leur vignette.
  check('un bundle est reconnu comme bundle',
    [d2.offers[1].userAssets[0].assetId, d2.offers[1].userAssets[0].bundleId],
    [0, 160001924154932]);
  check('serie conservee', d2.offers[1].userAssets[0].serialNumber, 12);
  check("l'identifiant d'exemplaire n'est jamais pris pour un assetId",
    d2.offers[1].userAssets[0].id, 'c3d4');
  check('date reprise de la liste des trades', d2.created, '2026-01-01T00:00:00Z');

  // v1 : `id` est le userAssetId. Le prendre pour un assetId cassait tout.
  const d1 = apiMod.normalizeTradeDetail({
    id: 42, created: 'x', status: 'Open',
    offers: [
      { user: { id: 1 }, robux: 0, userAssets: [{ id: 99999, assetId: 1031429, name: 'Domino Crown', recentAveragePrice: 100 }] },
      { user: { id: 2 }, robux: 0, userAssets: [] }
    ]
  });
  check('v1 : assetId lu, id ignore',
    [d1.offers[0].userAssets[0].assetId, d1.offers[0].userAssets[0].id], [1031429, 99999]);

  /* ------------------------ resolution d'un objet ----------------------- */
  group("Resolution d'un objet");
  const ctx = { ...cat, ratio: 1.6, changes: {}, ready: true };
  const face = analysis.resolveItem(d2.offers[1].userAssets[0], ctx);
  check('visage : reconnu comme visage', [face.isFace, face.isBundle], [true, true]);
  check('visage : ancien asset retrouve', face.legacyAssetId, 34764447);
  truthy('visage : cote trouvee', face.value > 0);
  check('visage : cote issue du bundle', face.source, 'bundle');
  check('visage : vignette = ancienne image plate en premier',
    analysis.thumbKeysFor(face)[0], 'a:34764447');

  // Un identifiant de bundle arrivant dans le champ assetId (v2 « Unknown »)
  // doit quand meme etre reconnu.
  const viaAsset = analysis.resolveItem(
    { assetId: 160001924154932, name: '', recentAveragePrice: 0 }, ctx);
  check('bundle glisse dans assetId : reconnu quand meme', viaAsset.isFace, true);

  // Et l'ancien asset d'un visage (pages, vieux caches) doit mener au bundle.
  const legacy = analysis.resolveItem({ assetId: 34764447, name: '' }, ctx);
  check('ancien asset de visage -> bundle', legacy.bundleId, 160001924154932);

  const hat = analysis.resolveItem({ assetId: 1031429, name: '', recentAveragePrice: 5726071 }, ctx);
  check('chapeau ordinaire : pas un visage', hat.isFace, false);
  check('chapeau : value Rolimon\'s prioritaire sur le RAP', hat.value, 24000000);

  const nobody = analysis.resolveItem({ assetId: 999999999, name: 'Inconnu' }, ctx);
  check('objet inconnu : marque sans cote, jamais valorise a 0',
    [nobody.unknown, nobody.value], [true, 0]);

  /* ----------------------------- analyse -------------------------------- */
  group('Analyse du trade');
  const a = analysis.analyze(d2, 1, ctx, null, null, { valueBasis: 'value', robuxTax: true });
  check('base = value', a.basis, 'value');
  check('visages comptes', a.faceCount, 1);
  // Robux recus : 1000 bruts, 700 nets des 30 % preleves par Roblox.
  check('Robux recus comptes nets de taxe', a.get.robuxNet, 700);
  check('taxe signalee', [a.robuxTaxed, a.robuxLost], [true, 300]);
  check('total donne = value du Domino Crown', a.give.value, 24000000);
  check('total recu = value du visage + Robux nets', a.get.value, 55000 + 700);
  truthy('verdict tres defavorable', analysis.verdict(a).tone === 'loss');

  // Un objet sans cote ne doit jamais valoir zero en silence.
  const dPart = apiMod.normalizeTradeDetail({
    id: 7, status: 'Open',
    offers: [
      { user: { id: 1 }, robux: 0, userAssets: [{ assetId: 1031429, name: 'DC', recentAveragePrice: 5726071 }] },
      { user: { id: 2 }, robux: 0, userAssets: [{ assetId: 999999999, name: 'Nouveaute', recentAveragePrice: 0 }] }
    ]
  });
  const aPart = analysis.analyze(dPart, 1, ctx, null, null, { valueBasis: 'value' });
  check('objet sans cote -> ecart non calculable', [aPart.incomplete, aPart.unknownCount], [true, 1]);
  check('verdict = sans cote', analysis.verdict(aPart).tone, 'unknown');
  check("un trade incomplet n'est jamais filtre",
    filters.passesFilters({ kind: 'inbound', analysis: aPart, partner: { id: 2 } },
      { onlyWins: true, minGainPercent: 50, ignoredUsers: [] }).ok, true);

  check('assets a resoudre par le catalogue', analysis.unresolvedAssetIds(dPart, ctx), [999999999]);
  check('assets a completer par le RAP officiel',
    analysis.missingValueAssetIds(dPart, ctx), [999999999]);

  /* ---------------------------- portefeuille ---------------------------- */
  group('Portefeuille (donnees reelles anonymisees)');
  const fx = await json('./fixtures/portfolio-sample.json');
  const rep = portfolio.fromRolimons(portfolio.emptyReport(fx.userId), fx.playerinfo,
    { counts: fx.playerassets, holds: [] }, cat);
  info(`Rolimon's annonce ${fx.playerinfo.value.toLocaleString('fr-FR')}`);
  check("valeur : celle de Rolimon's, sans correction", rep.value, fx.expected.value);
  check('chaque visage liste une fois, sous son bundle',
    rep.items.filter(i => i.isFace).reduce((s, i) => s + i.count, 0), fx.expected.faces);
  check('aucun ancien exemplaire de visage liste en plus',
    Object.keys(rep.holdings).filter(k => k.startsWith('a:') && cat.bundleOf?.[k.slice(2)]).length, 0);
  check('chaque ligne sait quelle vignette demander',
    portfolio.portfolioThumbKeys(rep).every(k => k.length > 0), true);

  /* ------------------------------ vignettes ----------------------------- */
  group('Vignettes');
  check('cle asset / bundle', [thumbs.assetKey(12), thumbs.bundleKey(12)], ['a:12', 'b:12']);
  check('objet sans identifiant : aucune cle', analysis.thumbKeysFor({}), []);

  /* --------------------------- anti-doublon ----------------------------- */
  group('Anti-doublon et suivi');
  const st = {};
  streams.markSeen(st, 'inbound', [5]);
  check('markSeen sur un flux inexistant ne casse rien', st.inbound, undefined);
  st.inbound = { seen: [3], seededAt: 1 };
  streams.markSeen(st, 'inbound', [7, 3]);
  check('markSeen : ids uniques, les derniers marques en tete', st.inbound.seen, [7, 3]);
  check('statut normalise', ['Rejected due to an error', 'countered', 'COMPLETED'].map(tracker.normStatus),
    ['RejectedDueToError', 'Countered', 'Completed']);

  /* --------------------------- sons et reglages -------------------------- */
  group('Sons');
  const tones = await import('../src/common/tones.js');
  const defaults = await import('../src/common/defaults.js');
  const stateMod = await import('../src/common/state.js');
  check('chaque sonnerie proposee a un motif',
    Object.keys(defaults.SOUNDS).filter(k => k !== 'none' && !tones.TONE_NAMES.includes(k)), []);
  check('chaque famille d\'evenement a un son par defaut',
    Object.keys(defaults.DEFAULTS.sounds).sort(), [...defaults.SOUND_GROUPS].sort());
  check('trade complete / accepte -> famille « accepte »',
    ['completed', 'outbound_accepted'].map(defaults.soundGroupOf), ['accepted', 'accepted']);
  check('refuse, contre, expire -> une seule famille',
    ['outbound_declined', 'outbound_countered', 'outbound_expired'].map(defaults.soundGroupOf),
    ['declined', 'declined', 'declined']);
  check('erreur Roblox -> famille « erreur »', defaults.soundGroupOf('trade_error'), 'error');
  check('objet reevalue -> sa propre famille', defaults.soundGroupOf('revalued'), 'revalued');
  check('type inconnu -> comme un trade recu', defaults.soundGroupOf('zzz'), 'inbound');
  // Migration : l'ancienne sonnerie unique devient celle des trades recus.
  store.settings = { soundName: 'coins' };
  const migrated = await stateMod.getSettings();
  check('migration soundName -> sounds.inbound', [migrated.sounds.inbound, migrated.sounds.accepted], ['coins', 'success']);
  await stateMod.saveSettings({ sounds: { error: 'down' } });
  const patched = await stateMod.getSettings();
  check('un son modifie ne touche pas les autres',
    [patched.sounds.inbound, patched.sounds.error], ['coins', 'down']);
  delete store.settings;

  // Les ids Roblox ne sont pas croissants : un id plus petit que tous les
  // autres peut etre un trade tout neuf. Seul un trade cree bien avant le plus
  // recent connu est ecarte — et compte, pour le diagnostic.
  {
    const T = Date.parse('2026-09-10T10:00:00Z');
    const iso = (min) => new Date(T + min * 60000).toISOString();
    const st2 = { inbound: { seen: [10], newest: T, seededAt: 1 } };
    const realFetch2 = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true, status: 200, headers: { get: () => null },
      json: async () => ({ data: [{ id: 3, created: iso(2) }, { id: 10, created: iso(0) }, { id: 1, created: iso(-180) }] })
    });
    let r2 = null;
    try { r2 = await streams.pollStream('inbound', st2); } finally { globalThis.fetch = realFetch2; }
    check('id plus petit mais trade recent : detecte ; ancien trade qui remonte : ecarte mais compte',
      [r2.fresh.map(x => x.id), st2.inbound.belowMark], [[3], 1]);
  }

  /* -------------------------------- langues ----------------------------- */
  group('Langues');
  const i18n = await import('../src/common/i18n.js');

  i18n.setLang('fr');
  check('francais : la phrase source passe telle quelle',
    i18n.t('Vous donnez'), 'Vous donnez');
  check('substitution', i18n.t('Détail des {n} objets', { n: 5 }), 'Détail des 5 objets');

  i18n.setLang('en');
  check('anglais : traduit', i18n.t('Vous donnez'), 'You give');
  check('anglais : substitution', i18n.t('Détail des {n} objets', { n: 5 }), '5 items in detail');
  check('pluriel', [i18n.p(1, '{n} visage', '{n} visages'), i18n.p(3, '{n} visage', '{n} visages')],
    ['1 face', '3 faces']);
  // Une phrase absente du dictionnaire retombe sur le francais : degrade,
  // jamais illisible — c'est tout l'interet de ne pas utiliser de cles.
  check('phrase inconnue : repli sur le francais',
    i18n.t('Une phrase jamais traduite'), 'Une phrase jamais traduite');
  check('resolveLang', [i18n.resolveLang('fr'), i18n.resolveLang('en'), i18n.resolveLang('zz')],
    ['fr', 'en', i18n.resolveLang('auto')]);
  i18n.setLang('fr');

  /* Couverture : toute phrase passee a t() doit exister en anglais, sinon
     l'interface se retrouve a moitie traduite sans que personne ne le voie. */
  const SOURCES = [
    '../src/popup/popup.js', '../src/options/options.js',
    '../src/background/notifier.js', '../src/background/service-worker.js',
    '../src/common/utils.js'
  ];
  const CALL = /\bt\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/g;
  const unwrap = (raw) => raw.replace(/\\(['"\\])/g, '$1').replace(/\\n/g, '\n');
  const missingT = new Set();
  let calls = 0;
  for (const src of SOURCES) {
    const code = await fetch(src).then(r => r.text());
    for (const m of code.matchAll(CALL)) {
      const fr = unwrap(m[1] ?? m[2] ?? '');
      if (!fr || !/[A-Za-zÀ-ÿ]/.test(fr)) continue;
      calls++;
      i18n.setLang('en');
      if (i18n.t(fr) === fr && fr !== i18n.t(fr, null)) continue;
      if (i18n.t(fr) === fr) missingT.add(fr);
    }
  }
  i18n.setLang('fr');
  // Quelques mots sont identiques dans les deux langues : ils sont bien dans
  // le dictionnaire, la comparaison ne peut simplement pas les distinguer.
  // Certaines phrases sont identiques dans les deux langues : elles SONT dans
  // le dictionnaire, la comparaison ne peut simplement pas les distinguer.
  const SAME = new Set(['Value', 'RAP', 'Prudent', 'Excellent', 'Projected', 'RARE',
    'projected', 'rare', 'bundle', 'value', 'Notifications', 'Maintenance', 'Test',
    'Volume', 'Ping', '1 minute', '2 minutes', '5 minutes',
    'Value {v}', 'RAP {v}', 'bundle #{id}', 'Value {a} vs RAP {b}', 'Total value', 'proj',
    'Français', 'English', 'bundles', 'Volume', 'Notifications', 'Ping', 'Flex', 'Popup', 'Format', 'Style']);
  const reallyMissing = [...missingT].filter(x => !SAME.has(x));
  check(`${calls} appels a t() : tous traduits en anglais`, reallyMissing, []);

  /* Meme controle sur les pages ecrites en dur, que traduit translateDom. */
  const PAGES = ['../src/options/options.html', '../src/popup/popup.html'];
  const IGNORE = /^(RoNote|×|—|↗|✕|⇄|⟳|⏸|▶|⚙|📌|\d[\d\s.,:%+-]*)$/;
  const missingDom = [];
  for (const page of PAGES) {
    const html = await fetch(page).then(r => r.text());
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const w = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const key = n.nodeValue.trim();
      if (!key || IGNORE.test(key) || !/[A-Za-zÀ-ÿ]/.test(key)) continue;
      i18n.setLang('en');
      if (i18n.t(key) === key && !SAME.has(key)) missingDom.push(page.split('/').pop() + ' → ' + key);
    }
  }
  i18n.setLang('fr');
  check('textes des pages HTML : tous traduits', missingDom, []);

  /* --------------------- refus / annulation d'un trade ------------------ */
  group("Agir sur un trade");
  check('declineTrade est exporte', typeof apiMod.declineTrade, 'function');
  // Le meme endpoint sert dans les deux sens : Roblox n'expose pas de « cancel ».
  let rejected = null;
  try { await apiMod.declineTrade('abc'); } catch (e) { rejected = e.message; }
  check('identifiant invalide refuse avant tout appel reseau',
    rejected, 'identifiant de trade invalide');

  /* --------------------------- trades suivis ---------------------------- */
  group('Trades suivis');
  {
    // Le cas qui tenait la limite de debit allumee : des trades suivis tombes
    // hors de la page Outbound (100 entrees) mais toujours ouverts. Ils
    // redevenaient « a verifier » a chaque passage, six par six, sans fin.
    const tracked = {};
    for (let i = 1; i <= 19; i++) tracked[String(1000 + i)] = { at: Date.now(), auto: true };
    let calls = 0;
    const open = async () => { calls++; return { status: 'Open' }; };

    await tracker.resolveTracked(tracked, new Set(), open);
    check('premier passage : six details au plus', calls, 6);

    calls = 0;
    await tracker.resolveTracked(tracked, new Set(), open);
    check('passage suivant : les six deja vus ne sont pas redemandes', calls, 6);

    calls = 0;
    await tracker.resolveTracked(tracked, new Set(), open);
    await tracker.resolveTracked(tracked, new Set(), open);
    check('les dix-neuf finissent par passer, puis plus rien', calls, 7);

    calls = 0;
    await tracker.resolveTracked(tracked, new Set(), open);
    check('tant que le delai court, aucun appel', calls, 0);

    // Dix minutes plus tard, le tour reprend.
    const later = Date.now() + tracker.TRACK_RECHECK + 1000;
    calls = 0;
    await tracker.resolveTracked(tracked, new Set(), open, { now: later });
    check('le delai passe, la verification reprend', calls, 6);

    // Un suivi pose tout seul s'abandonne au bout d'une semaine ; une epingle
    // posee a la main garde son mois.
    const vieux = {
      4001: { at: Date.now() - 8 * 864e5, auto: true },
      4002: { at: Date.now() - 8 * 864e5, auto: false },
      4003: { at: Date.now() - 40 * 864e5, auto: false }
    };
    await tracker.resolveTracked(vieux, new Set(), async () => ({ status: 'Open' }));
    check('un suivi automatique de huit jours est abandonne', Object.keys(vieux).sort(), ['4002']);

    // Une issue definitive remonte telle quelle : c'est l'appelant qui retire
    // le suivi et notifie.
    const one = { 2001: { at: Date.now(), auto: true } };
    const res = await tracker.resolveTracked(one, new Set(), async () => ({ status: 'Declined' }));
    check('une issue definitive est rendue', res.map(r => r.status), ['Declined']);
    // Un trade encore dans la liste Outbound n'est jamais interroge.
    let asked = 0;
    await tracker.resolveTracked({ 3001: { at: Date.now() } }, new Set([3001]),
      async () => { asked++; return { status: 'Open' }; });
    check('un trade encore dans la liste ne coute aucun appel', asked, 0);
  }

  /* ------------------------ garde-fou de debit -------------------------- */
  group('Garde-fou de debit');
  // Roblox compte par IP : ce qui sort passe par une porte, une par hote. Un
  // 429 la ferme pour tout le monde, sinon chaque appel suivant va le chercher.
  {
    const realFetch = globalThis.fetch;
    let running = 0, peak = 0;
    globalThis.fetch = async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise(r => setTimeout(r, 15));
      running--;
      return new Response(JSON.stringify({ success: true, name: 'x' }), { status: 200 });
    };
    try {
      await Promise.all(Array.from({ length: 10 }, (_, i) => apiMod.getPlayerInfo(1000 + i)));
      check("Rolimon's : jamais plus de 3 appels en meme temps", peak, 3);

      globalThis.fetch = async () => new Response('{}', { status: 429, headers: { 'retry-after': '30' } });
      let first = null;
      try { await apiMod.getPlayerInfo(2001); } catch (e) { first = e; }
      check('429 : le service refusant est nomme', first?.source, "Rolimon's");
      check('429 : le delai demande est conserve', first?.retryAfter, 30);
      check("429 : la porte de Rolimon's est fermee", apiMod.rateHolds()['rolimons.com'] > 25000, true);
      // Le plafond de cadence apprend du refus : divise par deux, jamais sous
      // son plancher. C'est ce qui evite d'y retourner au meme rythme.
      check('429 : le plafond de cadence est divise par deux', apiMod.rateLimits()['rolimons.com'], 15);
      check("429 : celle de Roblox reste ouverte", apiMod.rateHolds()['roblox.com'] || 0, 0);

      let calls = 0;
      globalThis.fetch = async () => { calls++; return new Response('{}', { status: 200 }); };
      let second = null;
      try { await apiMod.getPlayerInfo(2002); } catch (e) { second = e; }
      check('pendant la pause : refus immediat', second?.status, 429);
      check('pendant la pause : aucun appel reseau de plus', calls, 0);
    } finally {
      globalThis.fetch = realFetch;
      apiMod.clearRateHolds();
    }
    check('les portes se rouvrent', apiMod.rateHolds()['rolimons.com'], 0);
    check('le plafond de cadence repart de son maximum', apiMod.rateLimits()['rolimons.com'], 30);
  }

  /* --------------------- demarrage du service worker -------------------- */
  group('Service worker');
  // L'importer le fait vraiment demarrer : c'est le seul moyen de verifier
  // que le graphe de modules complet s'evalue sans exception. Le reseau est
  // coupe pendant l'import pour ne rien appeler chez Roblox.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('reseau coupe pendant le test'); };
  try {
    await import('../src/background/service-worker.js');
    pass++; line('ok', '✓ le service worker demarre sans exception');
  } catch (e) {
    fail++; line('ko', '✗ le service worker refuse de demarrer : ' + (e?.message || e));
  } finally {
    globalThis.fetch = realFetch;
  }

  /* -------------------- lecture de la page des trades -------------------- */
  group('Lecture de la page des trades');
  // `content/tradedom.js` n'est PAS un module : sur roblox.com, la politique
  // de securite interdit a un script de contenu de charger quoi que ce soit
  // (voir l'entete du fichier). On le charge donc comme le navigateur le fait,
  // en script classique, puis on lit le point de rendez-vous qu'il installe.
  await new Promise((ok, ko) => {
    const el = document.createElement('script');
    el.src = '../src/content/tradedom.js';
    el.onload = ok;
    el.onerror = () => ko(new Error('content/tradedom.js introuvable'));
    document.head.appendChild(el);
  });
  const dom = globalThis.RoNoteDom;

  // Un vrai DOM, hors ecran : c'est le seul moyen de verifier un lecteur de
  // page. Il n'imite pas les classes de Roblox — justement parce que le
  // lecteur ne doit s'appuyer sur aucune.
  const stage = document.createElement('div');
  stage.style.cssText = 'position:absolute;left:-9999px;top:0;width:800px';
  document.body.appendChild(stage);

  const objet = (id) => `<div class="c"><a href="/catalog/${id}/objet">objet ${id}</a></div>`;
  const colonne = (uid, ids, robux = '') => `<div class="offer">
      <a href="/users/${uid}/profile">@joueur${uid}</a>
      <div class="items">${ids.map(objet).join('')}</div>
      ${robux ? `<div class="robux-amount">${robux}</div>` : ''}
    </div>`;

  stage.innerHTML = `<div class="trade">${colonne(7, [11, 12], '1 500')}${colonne(9, [21])}</div>`;
  let page = dom.readTradePage();
  check('deux colonnes lues', [page.ok, page.sides.length], [true, 2]);
  check('les objets de chaque colonne',
    page.sides.map(s => s.items.map(i => i.assetId)), [[11, 12], [21]]);
  check('le proprietaire de chaque colonne', page.sides.map(s => s.userIds), [[7], [9]]);
  check('les Robux affiches sont releves tels quels', page.sides[0].robuxText, '1 500');

  // Le piege : un inventaire ouvert a cote du trade. Prendre le trade entier
  // pour une colonne et l'inventaire pour l'autre donnerait un « gain »
  // calcule sur des objets qui ne sont pas dans l'echange.
  const inventaire = document.createElement('div');
  inventaire.innerHTML = [31, 32, 33].map(objet).join('');
  stage.appendChild(inventaire);
  check('inventaire ouvert : on renonce au lieu de melanger',
    dom.readTradePage().ok, false);
  inventaire.remove();
  check('inventaire referme : la lecture repart', dom.readTradePage().ok, true);

  // Mise en page degradee : aucun profil cite. La structure seule doit encore
  // separer les deux colonnes, sinon le panneau disparait pour rien.
  stage.innerHTML = `<div class="trade">
    <div class="offer"><div class="items">${[11, 12].map(objet).join('')}</div></div>
    <div class="offer"><div class="items">${objet(21)}</div></div></div>`;
  check('sans profil cite, la structure suffit',
    dom.readTradePage().sides.map(s => s.items.length), [2, 1]);

  // Ce que RoNote ecrit sous un objet ne doit jamais devenir son nom.
  stage.innerHTML = `<div class="trade">${colonne(7, [11])}${colonne(9, [21])}</div>`;
  const avant = dom.readTradePage();
  const ajout = document.createElement('div');
  ajout.dataset.rn = '1';
  ajout.textContent = '400 000 RAP 372k';
  avant.sides[0].items[0].link.appendChild(ajout);
  const apres = dom.readTradePage();
  check('le nom lu ignore ce que RoNote a ajoute',
    apres.sides[0].items[0].name, avant.sides[0].items[0].name);
  check('la signature ne bouge pas non plus',
    dom.signatureOf(apres), dom.signatureOf(avant));

  group('Bandeaux : page sans profils, montants du site');
  stage.innerHTML = await (await fetch('./fixtures/trade-page.html')).text();
  const live = dom.readTradePage();
  check('les titres identifient les offres sans profils', live.sides.map(s => s.role), ['give', 'get']);
  check('liens image et nom : un seul exemplaire par carte', live.sides.map(s => s.items.length), [3, 3]);
  check('RAP des six cartes lu sur la page', live.sides.map(s => s.items.map(i => i.rap)), [[1423,3930,1758],[466,7942,560]]);
  check('totaux de la capture lus sur le site', live.sides.map(s => s.rapTotal), [7111,9591]);
  check('436 Robux deja nets, pas le RAP du premier objet', [live.sides[1].robux, live.sides[1].robuxNet], [436,true]);
  const instant = dom.visibleAnalysis(live);
  check('RAP immediat sans service worker : +2480', instant.get.rap - instant.give.rap, 2480);
  const pageTools = await import('../src/common/page-trade.js');
  const flat = dom.plain(live);
  const pd = pageTools.pageDetail(flat, null);
  check('analyse possible sans liens de profil ni compte en cache', !!pd, true);
  const catalog = {ready:true, assets: Object.fromEntries([101,102,103,201,202,203].map((id,i) =>
    [id, ['test','',100,[1500,4000,1800,500,8000,600][i],0,0,0,0]]))};
  const calculated = pageTools.analyzePage(flat, pd, catalog);
  check('RAP du site prioritaire sur un RAP catalogue different', calculated.deltaRap, 2480);
  check('Value enrichie par catalogue + Robux nets une seule fois', calculated.deltaValue, 2236);
  check('RAP reste disponible si Rolimons est indisponible', pageTools.analyzePage(flat,pd,null).rapAvailable, true);
  const beforeAmount = dom.signatureOf(live);
  stage.querySelector('#get-total').textContent = '10,000';
  check('changer seulement un montant invalide la signature', dom.signatureOf(dom.readTradePage()) !== beforeAmount, true);
  stage.querySelector('#give-offer h3').textContent = 'Items you would have given';
  stage.querySelector('#get-offer h3').textContent = 'Items you would have received';
  const inactive = dom.readTradePage();
  check('Closed / Inactive : les titres conditionnels identifient les offres', inactive.sides.map(s=>s.role), ['give','get']);
  check('Closed / Inactive : evaluation sans profils', !!pageTools.pageDetail(dom.plain(inactive),null), true);
  check('Value par carte conserve l’ordre des IDs du DOM', calculated.pageItems.map(s=>s.map(i=>[i.assetId,i.value])),
    [[[101,1500],[102,4000],[103,1800]],[[201,500],[202,8000],[203,600]]]);
  const unvalued = pageTools.analyzePage(flat,pd,{ready:true,assets:{}});
  check('pas de RAP presente comme Value sous un objet non cote', unvalued.pageItems.flat().every(i=>i.value===null), true);
  const blind = JSON.parse(JSON.stringify(flat));
  blind.sides[1].items[0].rap = null;                  // RAP illisible sur la page
  const blindCat = { ...catalog, assets: { ...catalog.assets } };
  delete blindCat.assets[201];                          // absent de Rolimon's (UGC)
  const blindDetail = pageTools.pageDetail(blind, null);
  const noRap = pageTools.analyzePage(blind, blindDetail, blindCat);
  check('objet sans cote ni RAP lisible : Value absente, et on dit lequel',
    [noRap.valueAvailable, noRap.valueMissing, noRap.missingNames.length], [false, 'items', 1]);
  const rescued = pageTools.analyzePage(blind, blindDetail, blindCat, null, { extra: { 201: 466 } });
  check('le RAP economy de Roblox comble le trou : Value affichee', [rescued.valueAvailable, rescued.deltaValue], [true, 2236 - 500 + 466]);
  // Un trade deja releve par les listes : reconnu a ses objets, sans titres.
  const known = { id: 77, offers: [
    { user: { id: 1234567890 }, robux: 0, userAssets: [101, 102, 103].map(assetId => ({ assetId, recentAveragePrice: 1000 })) },
    { user: { id: 42 }, robux: 0, userAssets: [201, 202, 203].map(assetId => ({ assetId, recentAveragePrice: 2000 })) }
  ] };
  const untitled = JSON.parse(JSON.stringify(blind));
  for (const side of untitled.sides) side.role = '';
  check('sans titres ni profils, pas de sens : aucune analyse', pageTools.pageDetail(untitled, 1234567890), null);
  const reversed = { ...known, offers: [...known.offers].reverse() };
  const recognized = pageTools.capturedForPage(untitled, reversed, 1234567890);
  check('trade connu reconnu a ses objets, dans le bon sens', recognized?.sides.map(s => s.role), ['give', 'get']);
  const viaKnown = pageTools.analyzePage(recognized, pageTools.pageDetail(recognized, 1234567890), blindCat, reversed);
  check('son RAP comble l objet illisible et absent de Rolimons', viaKnown.valueAvailable, true);
  const projCat = { ready: true, assets: { ...catalog.assets, 202: [...catalog.assets[202]] } };
  projCat.assets[202][6] = 1;                          // PROJ
  const proj = pageTools.analyzePage(flat, pd, projCat);
  check('objet projected signale sous sa carte, et lui seul',
    proj.pageItems.flat().filter(i => i.projected).map(i => i.assetId), [202]);
  check('sans table Rolimons, aucun projected invente',
    pageTools.analyzePage(flat, pd, null).pageItems.flat().every(i => i.projected === null), true);
  group('Page de creation d\'un trade');
  const liveMarkup = stage.innerHTML;
  stage.innerHTML = await (await fetch('./fixtures/trade-new-page.html')).text();
  const draft = dom.readTradePage();
  check('les paniers, pas les inventaires', [draft.ok, draft.composer, draft.sides.map(s => s.role)], [true, true, ['give', 'get']]);
  check('un objet par panier, lu dans le panier', draft.sides.map(s => s.items.map(i => i.assetId)), [[101], [201]]);
  check('totaux des paniers', draft.sides.map(s => s.rapTotal), [3814, 3003]);
  const draftPd = pageTools.pageDetail(dom.plain(draft), null);
  check('analyse du trade en preparation', pageTools.analyzePage(dom.plain(draft), draftPd, null).deltaRap, 3003 - 3814);
  stage.querySelector('#request-basket .slots').innerHTML = '';
  stage.querySelector('#request-total').textContent = '0';
  check('panier encore vide : RAP quand meme calculable',
    !!pageTools.pageDetail(dom.plain(dom.readTradePage()), null), true);
  // Paniers en lignes (nom + montant), sans lien vers le catalogue.
  stage.innerHTML = await (await fetch('./fixtures/trade-new-rows.html')).text();
  const rows = dom.readTradePage();
  check('lignes sans lien : objets lus par leur nom',
    rows.sides.map(s => s.items.map(i => [i.name, i.rap])),
    [[['Signature Kicks', 657]], [['Snow Leopard Fedora', 1485], ['Snow Leopard Fedora', 1485]]]);
  check('champ Robux vide : 0, totaux lus', [rows.sides.map(s => s.robux), rows.sides.map(s => s.rapTotal)], [[0, 0], [657, 2970]]);
  const nameCat = { ready: true, ts: 1, assets: {
    111: ['Signature Kicks', '', 657, 800, 0, 0, 0, 0],
    222: ['Snow Leopard Fedora', '', 1485, 1600, 0, 0, 1, 0],
    333: ['Perfectly Legitimate Business Hat', '', 3814, 4000, 0, 0, 0, 0]
  } };
  const named = pageTools.resolveNames(dom.plain(rows), nameCat);
  check('noms rapproches de la table Rolimons', named.sides.map(s => s.items.map(i => i.assetId)), [[111], [222, 222]]);
  const namedA = pageTools.analyzePage(named, pageTools.pageDetail(named, null), nameCat);
  check('Value du trade en preparation, doublon compte deux fois', [namedA.valueAvailable, namedA.deltaValue], [true, 3200 - 800]);
  check('projected reconnu sur un objet lu par son nom', namedA.pageItems[1].map(i => [i.name, i.projected]),
    [['Snow Leopard Fedora', true], ['Snow Leopard Fedora', true]]);
  const cutName = pageTools.resolveNames({ composer: true, sides: [{ items: [{ name: 'Perfectly Legitimate…' }] }] }, nameCat);
  check('nom tronque : reconnu s il est seul a commencer ainsi', cutName.sides[0].items[0].assetId, 333);
  const stranger = JSON.parse(JSON.stringify(dom.plain(rows)));
  stranger.sides[0].items[0].name = 'Objet Inconnu';
  stranger.sides[0].items[0].names = ['Objet Inconnu'];
  const strangerR = pageTools.resolveNames(stranger, nameCat);
  const strangerA = pageTools.analyzePage(strangerR, pageTools.pageDetail(strangerR, null), nameCat);
  check('objet absent de Rolimons (UGC) : compte a son RAP, sans Value affichee sous lui',
    [strangerA.valueAvailable, strangerA.deltaValue, strangerA.pageItems[0][0].value], [true, 3200 - 657, null]);
  // Au plus proche des captures : grille, cartes a hauteur fixe, deux images, aucun lien.
  stage.innerHTML = await (await fetch('./fixtures/trade-new-real.html')).text();
  const real = dom.readTradePage();
  check('page reelle : les deux paniers', [real.ok, real.composer, real.sides.map(s => s.items.map(i => i.name))],
    [true, true, [['Signature Kicks'], ['Snow Leopard Fedora']]]);
  check('page reelle : les deux lignes Total Value sont reperees', real.sides.map(s => !!s.totalLabel), [true, true]);
  check('page reelle : inventaires reperes', !!real.inventories, true);
  check('page reelle : joueur et titre identifies pour le raccourci Rolimons',
    [real.partnerId, !!real.tradeHeading], [123456789, true]);
  const realInv = dom.inventoryItems(real.sides.map(s => s.root));
  check('inventaires : une carte par objet, malgre deux images par carte',
    realInv.map(i => i.name), ['Signature Kicks', 'Camoface', 'Snow Leopard Fedora', 'Snow Leopard Fedora', 'Goldrow', 'White Ninja Headband of t…']);
  check('inventaires : « Holding » jamais pris pour un nom, RAP et son element lus',
    realInv.map(i => [i.rap, !!i.priceEl && i.priceEl.textContent]), [[657, '657'], [7563, '7563'], [1496, '1496'], [1496, '1496'], [293, '293'], [1742, '1742']]);
  stage.innerHTML = liveMarkup;

  const hidden = document.createElement('div');
  hidden.style.display = 'none'; hidden.innerHTML = stage.innerHTML; stage.prepend(hidden);
  check('un autre onglet masque ne fausse pas le decoupage des offres',dom.readTradePage().sides.map(s=>s.items.length),[3,3]);
  stage.remove();

  /* ------------------------------- format ------------------------------- */
  group('Formats');
  // Les nombres s'ecrivent comme Roblox, dans les deux langues : virgule pour
  // les milliers, point pour la decimale, jamais d'espace. Et un pourcentage
  // au-dela de 100 perd sa decimale.
  for (const lang of ['fr', 'en']) {
    i18n.setLang(lang);
    check(`nombres compacts (${lang})`, [utils.fmtNum(1500), utils.fmtNum(2400000), utils.fmtNum(24000)], ['1.5k', '2.4M', '24k']);
    check(`nombres complets (${lang})`, [utils.fmtFull(1836950), utils.fmtSigned(-23330000, true)], ['1,836,950', '\u221223,330,000']);
    check(`pourcentages (${lang})`, [utils.fmtPct(12.96), utils.fmtPct(-93.4), utils.fmtPct(3482.14), utils.fmtPct(0)],
      ['+13%', '\u221293.4%', '+3,482%', '0%']);
  }
  i18n.setLang('fr');
  check('ecart signe', utils.fmtSigned(-1500), '−1.5k');
  check('heures silencieuses a cheval sur minuit',
    utils.inQuietHours({ enabled: true, start: '23:00', end: '08:00' }, new Date(2026, 0, 1, 2, 0)), true);

  // Le popup charge ses trades trois par trois : jamais plus, et aucun oublie.
  {
    let running = 0, peak = 0;
    const done = [];
    await utils.eachLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise(r => setTimeout(r, 5));
      done.push(n);
      running--;
    });
    check('chargement en parallele : jamais plus de 3 a la fois', peak, 3);
    check('chargement en parallele : chaque trade traite une fois', done.sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7]);
  }

  // --- Bilan du mois : un trade vu deux fois ne compte qu'une fois, et un
  //     écart de moins de 1 % est un trade égal.
  {
    const recap = await import('../src/popup/recap.js');
    const at = (d) => new Date(2026, 8, d, 12).getTime();   // septembre 2026
    const history = [
      { at: at(2), kind: 'completed', tradeId: 1, give: 1000, get: 1500, pct: 50 },
      { at: at(2), kind: 'outbound_accepted', tradeId: 1, give: 1000, get: 1500, pct: 50 },
      { at: at(5), kind: 'completed', tradeId: 2, give: 2000, get: 1600, pct: -20 },
      { at: at(9), kind: 'outbound_accepted', tradeId: 3, give: 1000, get: 1005, pct: 0.5 },
      { at: at(9), kind: 'inbound', tradeId: 4 },
      { at: at(10), kind: 'revalued' },
      { at: new Date(2026, 7, 30).getTime(), kind: 'completed', tradeId: 5, give: 1, get: 999, pct: 99800 }
    ];
    const wallet = [{ at: new Date(2026, 7, 31).getTime(), v: 100000 }, { at: at(20), v: 110000 }];
    const s = recap.recapStats(history, wallet, 2026, 8);
    check('bilan : trades du mois, sans doublon', [s.trades, s.wins, s.losses, s.evens], [3, 1, 1, 1]);
    check('bilan : value gagnée et meilleur trade', [s.net, s.best?.net, s.winRate], [105, 500, 33]);
    check('bilan : offres, réévaluations, value du compte', [s.received, s.revals, s.walletStart, s.walletEnd], [1, 1, 100000, 110000]);
    const months = recap.recapMonths(history, wallet);
    check('bilan : mois proposés, du plus récent au plus ancien', months[months.length - 1], [2026, 7]);
  }

  // --- Thèmes : chaque thème se reconnaît, et un fichier importé ne règle
  //     que l'apparence.
  {
    const themes = await import('../src/options/themes.js');
    check('thèmes : chacun est reconnu d\'après ses réglages',
      themes.THEMES.map(th => themes.matchTheme(th.settings)?.id), themes.THEMES.map(th => th.id));
    const file = themes.themeFromFile({ kind: 'ronote-theme', name: 'Test', settings: { bannerGain: '#00ff00', enabled: false, bannerSize: 3 },
      pageBgImage: 'javascript:alert(1)' });
    check('thèmes : import limité à l\'apparence, image refusée', [file.settings, file.pageBgImage], [{ bannerGain: '#00ff00' }, '']);
    check('thèmes : un autre fichier est refusé', themes.themeFromFile({ settings: {} }), null);
    check('thèmes : les fonds sont peints en JPEG', /^data:image\/jpeg;base64,/.test(themes.paintBackground('ocean')), true);
    await import('../src/popup/coinflip.js');
  }

  // --- Objectif : progression, rythme sur 30 jours, et verdict.
  {
    const goals = await import('../src/popup/goal.js');
    const now = new Date(2026, 8, 24).getTime(), day = 864e5;
    const series = [{ at: now - 60 * day, v: 900000 }, { at: now - 30 * day, v: 1000000 }, { at: now, v: 1300000 }];
    const p = goals.goalProgress({ kind: 'value', target: 2000000, deadline: now + 50 * day }, series, 1300000, now);
    check('objectif : progression et reste', [Math.round(p.pct), p.remaining, p.daysLeft], [65, 700000, 50]);
    check('objectif : rythme sur 30 j et rythme nécessaire', [Math.round(p.pace), Math.round(p.needed), p.status], [10000, 14000, 'behind']);
    const item = goals.goalProgress({ kind: 'item', item: { value: 1000000 } }, series, 1300000, now);
    check('objectif : un objet déjà à portée est atteint', [item.status, item.pct, item.remaining], ['done', 100, 0]);
    const late = goals.goalProgress({ kind: 'value', target: 2e6, deadline: now - day }, series, 1300000, now);
    check('objectif : date dépassée', late.status, 'late');
  }

  // --- GIF : ce que l'encodeur écrit, le navigateur le relit.
  {
    const { GifEncoder } = await import('../src/popup/gif.js');
    const c = Object.assign(document.createElement('canvas'), { width: 40, height: 30 });
    const g = c.getContext('2d', { willReadFrequently: true });
    const frames = ['#ff0000', '#00c000', '#2050ff'].map(col => { g.fillStyle = col; g.fillRect(0, 0, 40, 30); return g.getImageData(0, 0, 40, 30); });
    const enc = new GifEncoder(40, 30);
    enc.palette(frames);
    for (const f of frames) await enc.add(f, 120);
    const bytes = new Uint8Array(await enc.finish().arrayBuffer());
    check('gif : en-tête et fin de fichier', [String.fromCharCode(...bytes.slice(0, 6)), bytes[bytes.length - 1]], ['GIF89a', 0x3B]);
    const img = new Image();
    // `load` plutôt que decode() : dans un onglet en arrière-plan, decode() peut attendre indéfiniment.
    await new Promise((ok, ko) => {
      img.onload = ok; img.onerror = () => ko(new Error('gif illisible'));
      setTimeout(() => ko(new Error('gif : chargement trop long')), 5000);
      img.src = URL.createObjectURL(new Blob([bytes], { type: 'image/gif' }));
    });
    g.clearRect(0, 0, 40, 30); g.drawImage(img, 0, 0);
    const px = [...g.getImageData(20, 15, 1, 1).data].slice(0, 3).map(v => Math.round(v / 32));
    check('gif : relu par le navigateur, première image rouge', [img.width, img.height, px], [40, 30, [8, 0, 0]]);
    if ('ImageDecoder' in globalThis) {
      const dec = new ImageDecoder({ data: bytes, type: 'image/gif' });
      await dec.tracks.ready;
      check('gif : trois images', dec.tracks.selectedTrack.frameCount, 3);
    }
  }

  // --- Fonds animés : t = 1 redonne t = 0, sinon le GIF sauterait à chaque tour.
  {
    const fb = await import('../src/popup/flexbg.js');
    const fg = Object.assign(document.createElement('canvas'), { width: 60, height: 75 });
    const a = Object.assign(document.createElement('canvas'), { width: 60, height: 75 });
    const b = Object.assign(document.createElement('canvas'), { width: 60, height: 75 });
    const same = [];
    for (const def of fb.BACKGROUNDS.filter(x => x.animated)) {
      const bg = await fb.loadBackground({ id: def.id });
      fb.compose(a, fg, bg, 0); fb.compose(b, fg, bg, 1);
      const da = a.getContext('2d').getImageData(0, 0, 60, 75).data, db = b.getContext('2d').getImageData(0, 0, 60, 75).data;
      let diff = 0;
      for (let i = 0; i < da.length; i++) diff = Math.max(diff, Math.abs(da[i] - db[i]));
      same.push(diff <= 2);
    }
    check('fonds animés : chacun boucle sans saut', same, same.map(() => true));
  }
} catch (e) {
  fail++;
  const pre = document.createElement('pre');
  pre.textContent = 'ERREUR FATALE\n' + (e?.stack || e);
  out.appendChild(pre);
}

const sum = document.getElementById('sum');
sum.textContent = fail ? `${fail} ECHEC(S) · ${pass} ok` : `TOUT PASSE · ${pass} tests`;
sum.style.color = fail ? '#ff5f66' : '#2fd070';
document.title = (fail ? `KO ${fail}` : `OK ${pass}`) + ' — RoNote';
