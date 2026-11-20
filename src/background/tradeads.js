/**
 * ==========================================================================
 *  AUTO-POST DE TRADE ADS (fondations)
 * --------------------------------------------------------------------------
 *  Publie la même annonce (items offerts + items ou tags demandés) sur les
 *  sites de trade ads, à intervalle choisi. Aucune connexion propre : on
 *  réutilise la session que l'utilisateur a ouverte lui-même sur chaque site
 *  (`credentials: 'include'` depuis le worker, grâce aux host_permissions).
 *  L'extension ne voit, ne garde ni ne tape aucun mot de passe, et ne lit
 *  aucun cookie (détail par site : docs/technique.md « Auto-post de trade ads »).
 *
 *  Un adaptateur par site : `status()` (connecté ou non), `post(ad)` → un
 *  code court ('ok' | 'login' | 'cooldown' | 'limit' | 'error'), `cooldown`
 *  et `daily` (limites du site). Deux sites : Rolimon's et RoUtility (MYd, 14 nov.).
 * ==========================================================================
 */
import { B, safe } from '../common/shim.js';
import { getState } from '../common/state.js';
import { premiumGet, premiumHeaders } from './premium.js';

export const ALARM = 'ronote:tradeads';
const KEY = 'tradeads';
const LOG_CAP = 30;
const MIN = 60e3;
export const TAGS = ['any', 'demand', 'rares', 'robux', 'upgrade', 'downgrade', 'rap', 'wishlist', 'projecteds', 'adds'];
export const MIN_VALUES = [0, 1000, 5000, 10000, 50000];
export const MAX_SIDE = 4;              // 4 offerts, 4 demandés (items + tags) : la règle des trois sites

const json = { 'content-type': 'application/json' };

/** Réponse HTTP → code court commun aux adaptateurs. */
const outcome = (status, map) => map[status] || (status >= 200 && status < 300 ? 'ok' : status ? 'error' : 'network');

export const SITES = {
  rolimons: {
    name: "Rolimon's",
    login: 'https://www.rolimons.com/verify',
    // « Verify Using Your Roblox Account » de rolimons.com/verify (relevé le 14 nov.) : Roblox renvoie sur api.rolimons.com,
    // qui pose `_RoliVerification` puis redirige vers www.rolimons.com.
    oauth: 'https://apis.roblox.com/oauth/v1/authorize?client_id=3367241575729602289&redirect_uri=https://api.rolimons.com/auth/v1/robloxoauth&scope=openid%20profile&response_type=code',
    done: (u) => u.hostname === 'www.rolimons.com',
    origin: null,                       // api.rolimons.com est déjà dans host_permissions
    cooldown: 15, daily: 55,
    // Pas de « qui suis-je » connu chez Rolimon's : l'état vient du dernier envoi (422 = vérification à refaire).
    async status(cfg) { return cfg.status?.rolimons || 'unknown'; },
    async post(ad, me) {
      const res = await fetch('https://api.rolimons.com/tradeads/v1/createad', {
        method: 'POST', credentials: 'include', headers: json,
        body: JSON.stringify({ player_id: me, offer_item_ids: ad.offer, request_item_ids: ad.items, request_tags: ad.tags })
      });
      return outcome(res.status, { 201: 'ok', 400: 'cooldown', 422: 'login', 429: 'limit' });
    }
  },
  routility: {
    name: 'RoUtility',
    login: 'https://routility.io/trade-ads/create',
    oauth: 'https://routility.io/api/auth/roblox?next=%2Ftrade-ads%2Fcreate',   // « Sign in with Roblox » du site
    done: (u) => u.hostname === 'routility.io' && !u.pathname.startsWith('/api/'),
    origin: 'https://routility.io/*',   // permission facultative, demandée depuis le popup
    cooldown: 15, daily: 0,
    async status() {
      const res = await fetch('https://routility.io/api/auth/me', { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(6000) });
      const d = res.status === 200 ? await res.json().catch(() => null) : null;
      return d?.roblox_id ? { ok: true, robloxId: Number(d.roblox_id), name: String(d.username || '') } : 'login';
    },
    async post(ad) {
      const res = await fetch('https://routility.io/api/ads/', {
        method: 'POST', credentials: 'include', headers: json,
        body: JSON.stringify({
          offering: ad.offer.map(id => ({ asset_id: String(id) })),
          looking_for: [...ad.items.map(id => ({ asset_id: String(id) })), ...ad.tags.map(tag => ({ type: 'tag', tag }))],
          note: ad.note || '',
          show_as: 'roblox'                 // champ ajouté par la mise à jour du site (20 nov.) : le profil Roblox, pas Discord
        })
      });
      if (res.status >= 200 && res.status < 300) return 'ok';
      // Le site dit maintenant pourquoi : « Wait 12m 3s » (délai), « Not logged in », limite du jour…
      const err = String((await res.json().catch(() => null))?.error || '');
      if (/wait \d+m/i.test(err)) return 'cooldown';
      if (res.status === 401 || /log ?in|sign ?in/i.test(err)) return 'login';
      return outcome(res.status, { 403: 'login', 429: 'limit' });
    },
    // Mode malin : 5 annonces en ligne au plus, alors la plus ancienne part pour laisser la place à la nouvelle
    // (format de /ads/mine relevé dans l'extension RoUtility : { ads: [{ id, created_at }] }).
    async refresh() {
      const res = await fetch('https://routility.io/api/ads/mine', { credentials: 'include', cache: 'no-store' });
      const d = res.status === 200 ? await res.json().catch(() => null) : null;
      const ads = d?.ads;
      // Depuis la mise à jour : `posted_24h` / `daily_limit` → inutile d'envoyer quand le jour est plein.
      if (typeof d?.posted_24h === 'number' && d.daily_limit && d.posted_24h >= d.daily_limit) return 'daily';
      if (!Array.isArray(ads) || ads.length < 5) return;
      const old = [...ads].sort((a, b) => Number(a.created_at) - Number(b.created_at))[0];
      if (/^[\w-]{1,40}$/.test(String(old?.id))) await fetch('https://routility.io/api/ads/' + old.id, { method: 'DELETE', credentials: 'include' });
    }
  }
};

/** Le modèle Aléatoire : quatre items tirés au hasard parmi ceux qui valent au moins ALEA_MIN, jamais un œuf,
 *  un projected ni un item exclu. Le popup s'en sert au clic, le worker à chaque envoi quand `alea` est allumé. */
export const ALEA_MIN = 1000;
export const isEgg = (i) => /\begg/i.test(i.name || '');
export function tirageAlea(inv, exclude = [], rnd = Math.random) {
  const a = inv.filter(i => i.value >= ALEA_MIN && !i.projected && !isEgg(i) && !exclude.includes(i.id));
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a.slice(0, MAX_SIDE);
}

/**
 * Demande aléatoire (20 nov., MYd) : des items tirés au hasard dont la value totale vaut celle de ce qu'on
 * offre, plus `op` % (l'overpay voulu). `pool` : [{ id, value, … }] du catalogue Rolimon's (jamais un
 * projected, un œuf, un item sans value ni un item qu'on offre). Tolérance ±8 % ; à défaut, le plus proche.
 */
export const OP_VALUES = [0, 5, 10, 15, 20, 30, 50];
export function tirageDemande(pool, offerValue, op = 10, slots = MAX_SIDE, rnd = Math.random) {
  const target = offerValue * (1 + op / 100);
  if (!(target > 0) || slots < 1) return [];
  const a = pool.filter(i => i.value > 0 && i.value <= target * 1.08);
  if (!a.length) return [];
  let best = null, bestGap = Infinity;
  for (let essai = 0; essai < 300; essai++) {
    const n = 1 + Math.floor(rnd() * Math.min(slots, a.length));
    const pris = [], vus = new Set();
    let reste = target;
    for (let k = 0; k < n - 1; k++) {        // les n-1 premiers au hasard, sans dépasser ce qu'il reste
      const ok = a.filter(i => !vus.has(i.id) && i.value < reste * 0.9);
      if (!ok.length) break;
      const i = ok[Math.floor(rnd() * ok.length)];
      pris.push(i); vus.add(i.id); reste -= i.value;
    }
    let fin = null, gapFin = Infinity;        // le dernier : celui qui tombe le plus près du reste
    for (const i of a) if (!vus.has(i.id) && Math.abs(reste - i.value) < gapFin) { gapFin = Math.abs(reste - i.value); fin = i; }
    if (fin) pris.push(fin);
    const gap = Math.abs(pris.reduce((x, i) => x + i.value, 0) - target) / target;
    if (gap < bestGap) { best = pris; bestGap = gap; }
    if (gap <= 0.08 && rnd() < 0.5) break;    // assez près : on garde un peu de hasard entre les tirages
  }
  return best || [];
}

/** Les deux tirages (offre `alea`, demande `reqAlea`) appliqués à `cfg`, sur place. */
export function applyDraws(cfg, { inventaire = null, demandables = null, rnd = Math.random } = {}) {
  if (cfg.alea && inventaire?.length) {
    const tire = tirageAlea(inventaire, cfg.exclude, rnd).map(i => i.id);
    if (tire.length) cfg.offer = tire;           // gardé : le popup montre ce qui vient de partir
  }
  if (cfg.reqAlea && demandables?.length && cfg.offer.length) {
    const val = new Map((inventaire || []).map(i => [i.id, i.value || 0]));
    const offerValue = cfg.offer.reduce((x, id) => x + (val.get(id) || 0), 0);
    const pool = demandables.filter(i => !cfg.offer.includes(i.id));
    const tire = tirageDemande(pool, offerValue, cfg.op, MAX_SIDE - cfg.tags.length, rnd).map(i => i.id);
    if (tire.length) cfg.items = tire;           // gardé aussi : le popup montre la dernière demande
  }
  return cfg;
}

/** Bouton « Tirer » du popup : les tirages tout de suite, enregistrés, sans rien publier. */
export async function drawTradeAds(inputs) {
  const cfg = applyDraws(await getConfig(), inputs);
  await saveConfig(cfg);
  return { cfg };
}

export const DEFAULTS = {
  on: false, interval: 0,             // 0 = malin : la fenêtre de chaque site remplie au mieux
  offer: [], items: [], tags: [],
  alea: false,                        // modèle Aléatoire : 4 items retirés au hasard à chaque envoi
  reqAlea: false, op: 10,             // demande aléatoire : items de value équivalente + op %, retirés à chaque envoi
  noEggs: true, minValue: 0,          // filtres du choix des items (popup) : sans les œufs, sans les petits items
  noProjected: true, exclude: [],     // projected cachés ; items que l'utilisateur ne veut jamais offrir
  note: '',                           // texte de l'annonce (RoUtility ; Rolimon's n'en a pas)
  saved: [],                          // configurations enregistrées : [{ name, ad }]
  sites: { rolimons: true, routility: false },
  last: {}, sent: {}, status: {}, log: []
};

const NOTE_MAX = 200, SAVED_MAX = 12, EXCLUDE_MAX = 1000;
/** Ce qu'une configuration exportée ou enregistrée contient (jamais l'interrupteur ni le journal). */
export const AD_KEYS = ['offer', 'alea', 'reqAlea', 'op', 'items', 'tags', 'interval', 'noEggs', 'minValue', 'noProjected', 'exclude', 'note', 'sites'];
export const pickAd = (cfg) => Object.fromEntries(AD_KEYS.map(k => [k, cfg[k]]));
const ids = (v) => [...new Set((Array.isArray(v) ? v : []).map(Number).filter(n => Number.isInteger(n) && n > 0))];

/** Ce que le popup peut changer, nettoyé : le reste (journal, horodatages) n'appartient qu'au worker. */
export function sanitize(patch, cur = DEFAULTS) {
  const out = { ...cur };
  if ('on' in patch) out.on = !!patch.on;
  if ('noEggs' in patch) out.noEggs = !!patch.noEggs;
  if ('minValue' in patch) out.minValue = MIN_VALUES.includes(Number(patch.minValue)) ? Number(patch.minValue) : 0;
  if ('interval' in patch) out.interval = Number(patch.interval) === 0 ? 0 : Math.min(240, Math.max(15, Math.round(Number(patch.interval) || 15)));
  if ('reqAlea' in patch) out.reqAlea = !!patch.reqAlea;
  if ('op' in patch) out.op = OP_VALUES.includes(Number(patch.op)) ? Number(patch.op) : 10;
  if ('noProjected' in patch) out.noProjected = !!patch.noProjected;
  if ('note' in patch) out.note = String(patch.note || '').replace(/[\u0000-\u001f]/g, ' ').slice(0, NOTE_MAX);
  if ('exclude' in patch) out.exclude = ids(patch.exclude).slice(0, EXCLUDE_MAX);
  if ('offer' in patch) { out.offer = ids(patch.offer).slice(0, MAX_SIDE); out.alea = !!patch.alea; }   // toucher aux items à la main éteint l'aléatoire
  out.offer = out.offer.filter(id => !out.exclude.includes(id));   // un item exclu n'est jamais offert
  if ('tags' in patch) out.tags = [...new Set((patch.tags || []).filter(x => TAGS.includes(x)))].slice(0, MAX_SIDE);
  if ('items' in patch) { out.items = ids(patch.items); if (!('reqAlea' in patch)) out.reqAlea = false; }   // choisir à la main éteint la demande aléatoire
  out.items = out.items.slice(0, MAX_SIDE - out.tags.length);
  if (patch.sites && typeof patch.sites === 'object') {
    out.sites = { ...cur.sites };
    for (const k of Object.keys(SITES)) if (k in patch.sites) out.sites[k] = !!patch.sites[k];
  }
  if (Array.isArray(patch.saved)) {
    out.saved = patch.saved.filter(x => x && typeof x === 'object' && x.ad && typeof x.ad === 'object').slice(0, SAVED_MAX)
      .map(x => ({ name: String(x.name || '').trim().slice(0, 40) || '?', ad: pickAd(sanitize(onlyAd(x.ad), DEFAULTS)) }));
  }
  return out;
}

/** Une configuration venue d'ailleurs (fichier importé, config enregistrée) : seulement les clés d'annonce. */
export const onlyAd = (o) => Object.fromEntries(AD_KEYS.filter(k => o && k in o).map(k => [k, o[k]]));

export async function getConfig() {
  const { [KEY]: c } = await B.storage.local.get(KEY);
  return { ...DEFAULTS, ...(c || {}), sites: { ...DEFAULTS.sites, ...(c?.sites || {}) } };
}
const saveConfig = (c) => B.storage.local.set({ [KEY]: c });

const permitted = (site) => !site.origin || safe(() => B.permissions.contains({ origins: [site.origin] }), false);

/**
 * Premium (14 nov., MYd) : l'auto-post va avec la clé. null si ouvert, sinon la raison au format de
 * popup/lock.js. Le jeton signé par Neuronal dit les fonctions ; il est renouvelé au besoin (une
 * session fermée sur le serveur l'efface, et l'auto-post s'arrête au tour suivant).
 */
export async function tradeAdsLocked(me) {
  await safe(() => premiumHeaders());
  const p = await premiumGet();
  if (!p.token) return 'login';
  if (!p.me?.features?.tradeads) return 'subscribe';
  if (!p.me.roblox) return 'link';
  if (me && Number(p.me.roblox.id) !== Number(me)) return 'other_account';
  return null;
}

/** L'état de chaque site pour le popup : connecté, à connecter, permission manquante ou bloqué. */
export async function tradeAdsStatus() {
  const cfg = await getConfig();
  const locked = await tradeAdsLocked(Number((await safe(() => getState(), {}))?.userId) || 0);
  if (locked) return { cfg, sites: {}, locked, subscribeUrl: (await premiumGet()).me?.subscribe_url || '' };
  const out = {};
  for (const [k, site] of Object.entries(SITES)) {
    const base = { name: site.name, login: site.login, origin: site.origin, cooldown: site.cooldown || 0, daily: site.daily || 0, on: !!cfg.sites[k] };
    if (!(await permitted(site))) { out[k] = { ...base, state: 'perm' }; continue; }
    const st = await safe(() => site.status(cfg), 'network');
    out[k] = typeof st === 'object' ? { ...base, state: 'ok', account: st } : { ...base, state: st };
  }
  return { cfg, sites: out };
}

/**
 * « Se connecter avec Roblox » : le login OAuth du site dans une petite fenêtre. Le popup se ferme dès qu'elle
 * s'ouvre, donc le worker suit l'onglet (`onTradeAdsTab`) et referme la fenêtre quand le site a repris la main.
 */
const LOGIN_KEY = 'tradeadsLogin';
export async function tradeAdsLogin(k) {
  const site = SITES[k];
  if (!site?.oauth) return { ok: false };
  const win = await B.windows.create({ url: site.oauth, type: 'popup', width: 520, height: 720, focused: true }).catch(() => null);
  const tabId = win?.tabs?.[0]?.id;
  if (tabId == null) { await B.tabs.create({ url: site.oauth }); return { ok: true }; }
  await B.storage.local.set({ [LOGIN_KEY]: { site: k, tabId, windowId: win.id, at: Date.now() } });
  return { ok: true };
}

/** tabs.onUpdated (service-worker.js) : la fenêtre de login est revenue sur le site → connecté, on ferme. */
export async function onTradeAdsTab(tabId, info) {
  if (!info.url) return;
  const { [LOGIN_KEY]: p } = await B.storage.local.get(LOGIN_KEY);
  if (!p || p.tabId !== tabId) return;
  if (Date.now() - p.at > 10 * MIN) { await B.storage.local.remove(LOGIN_KEY); return; }
  let u; try { u = new URL(info.url); } catch { return; }
  if (!SITES[p.site]?.done(u)) return;
  await B.storage.local.remove(LOGIN_KEY);
  if (p.site === 'rolimons') {   // pas de « qui suis-je » : on le croit connecté, un 422 au prochain envoi dira le contraire
    const cfg = await getConfig();
    cfg.status = { ...cfg.status, rolimons: 'ok' };
    await saveConfig(cfg);
  }
  await safe(() => B.windows.remove(p.windowId));
}

export async function saveTradeAds(patch) {
  const cfg = sanitize(patch || {}, await getConfig());
  await saveConfig(cfg);
  await scheduleTradeAds(cfg);
  return { cfg };
}

/**
 * Mode malin : l'écart qui remplit la limite du jour sans jamais la toucher. Rolimon's : 55 par 24 h glissantes,
 * donc une toutes les 27 min (53 par jour, toujours une place libre) au lieu de 15 min puis des heures bloquées.
 * Sans limite du jour (RoUtility) : le délai du site.
 */
export const smartGap = (site) => Math.max(site.cooldown, site.daily ? Math.ceil(24 * 60 / site.daily) : 0);

/** Une alarme par intervalle choisi (chaque minute en mode malin, les écarts par site font le tri) ; coupée à l'arrêt. */
export async function scheduleTradeAds(cfg) {
  cfg ||= await getConfig();
  await safe(() => B.alarms.clear(ALARM));
  if (cfg.on) await safe(() => B.alarms.create(ALARM, { periodInMinutes: cfg.interval || 1 }));
}

/**
 * Un tour d'envoi. `force` (bouton « Publier maintenant ») passe outre
 * l'intervalle choisi, jamais le délai propre au site ni sa limite du jour.
 * `offerable` : les ids encore dans l'inventaire (un item vendu n'est pas offert).
 * `inventaire` : ces items avec leur value, leur nom et `projected` : le tirage du modèle Aléatoire.
 */
export async function runTradeAds({ me, offerable = null, inventaire = null, demandables = null, force = false, now = Date.now(), rnd = Math.random } = {}) {
  const cfg = await getConfig();
  if (!cfg.on && !force) return { skipped: 'off' };
  if (!me) return { skipped: 'me' };
  const locked = await tradeAdsLocked(me);
  if (locked) return { skipped: 'premium', locked };
  applyDraws(cfg, { inventaire, demandables, rnd });
  const offer = offerable ? cfg.offer.filter(id => offerable.has(id)) : cfg.offer;
  if (!offer.length || !(cfg.items.length + cfg.tags.length)) return { skipped: 'empty' };
  const ad = { offer, items: cfg.items, tags: cfg.tags, note: cfg.note };
  const results = {};
  for (const [k, site] of Object.entries(SITES)) {
    if (!cfg.sites[k]) continue;
    const wait = (force ? site.cooldown : cfg.interval ? Math.max(site.cooldown, cfg.interval) : smartGap(site)) * MIN;
    if (now - (cfg.last[k] || 0) < wait - 30e3) continue;   // l'alarme peut sonner quelques secondes en avance
    const day = (cfg.sent[k] || []).filter(at => now - at < 24 * 60 * MIN);
    if (site.daily && day.length >= site.daily) { results[k] = 'daily'; continue; }
    if (!(await permitted(site))) { results[k] = 'perm'; continue; }
    if (site.refresh && (await site.refresh().catch(() => null)) === 'daily') { results[k] = 'daily'; continue; }
    const r = await site.post(ad, me).catch(() => 'network');
    results[k] = r;
    cfg.last[k] = now;          // même en échec : pas de relance en boucle avant le prochain tour
    if (r === 'ok') cfg.sent[k] = [...day, now];
    cfg.status[k] = r === 'ok' ? 'ok' : r === 'login' ? 'login' : cfg.status[k];
    cfg.log = [{ at: now, site: k, result: r, offer: offer.length }, ...cfg.log].slice(0, LOG_CAP);
  }
  await saveConfig(cfg);
  return { results };
}
