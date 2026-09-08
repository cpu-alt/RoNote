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
  group('Portefeuille reconcilie (donnees reelles anonymisees)');
  const fx = await json('./fixtures/portfolio-sample.json');
  const rep = portfolio.reconcile(
    { ...portfolio.emptyReport(fx.userId), rolimons: { value: fx.playerinfo.value, rap: fx.playerinfo.rap } },
    { value: fx.playerinfo.value, rap: fx.playerinfo.rap },
    { counts: fx.playerassets, holds: [] },
    fx.bundles.filter(b => b.bundleType === 'DynamicHead'),
    cat
  );
  info(`Rolimon's annonce ${fx.playerinfo.value.toLocaleString('fr-FR')}`);
  check('visages fantomes detectes', rep.ghosts.length, fx.expected.ghosts);
  check('valeur retiree', rep.ghostValue, fx.expected.ghostValue);
  check('visages possedes ignores par Rolimon\'s', rep.extras.length, fx.expected.extras);
  check('valeur ajoutee', rep.extraValue, fx.expected.extraValue);
  check('valeur corrigee', rep.value, fx.expected.value);
  for (const g of rep.ghosts) info(`fantome  −${g.total.toLocaleString('fr-FR')}  ${g.name}`);
  for (const e of rep.extras) info(`ajoute   +${e.total.toLocaleString('fr-FR')}  ${e.name}`);
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
  st.inbound = { seen: [3], watermark: 3, seededAt: 1 };
  streams.markSeen(st, 'inbound', [7, 3]);
  check('markSeen : ids uniques, watermark releve',
    [st.inbound.seen, st.inbound.watermark], [[7, 3], 7]);
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

  // Un id sous le watermark est ecarte, mais compte : c'est le seul moyen de
  // voir un jour un identifiant Roblox qui ne serait pas croissant.
  {
    const st2 = { inbound: { seen: [10], watermark: 10, seededAt: 1 } };
    const realFetch2 = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true, status: 200, headers: { get: () => null },
      json: async () => ({ data: [{ id: 12 }, { id: 9 }] })
    });
    let r2 = null;
    try { r2 = await streams.pollStream('inbound', st2); } finally { globalThis.fetch = realFetch2; }
    check('sous le watermark : ecarte mais compte',
      [r2.fresh.map(x => x.id), st2.inbound.belowMark], [[12], 1]);
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
    'Français', 'English', 'bundles', 'Volume', 'Notifications', 'Ping']);
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
