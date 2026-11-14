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

export const ALARM = 'ronote:tradeads';
const KEY = 'tradeads';
const LOG_CAP = 30;
const MIN = 60e3;
export const TAGS = ['any', 'demand', 'rares', 'robux', 'upgrade', 'downgrade', 'rap', 'wishlist', 'projecteds', 'adds'];
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
          note: ''
        })
      });
      // 429 : 15 min entre deux annonces OU déjà 5 annonces en ligne (elles durent 14 jours).
      return outcome(res.status, { 401: 'login', 403: 'login', 429: 'limit' });
    }
  }
};

export const DEFAULTS = {
  on: false, interval: 15,
  offer: [], items: [], tags: [],
  sites: { rolimons: true, routility: false },
  last: {}, sent: {}, status: {}, log: []
};

const ids = (v) => [...new Set((Array.isArray(v) ? v : []).map(Number).filter(n => Number.isInteger(n) && n > 0))];

/** Ce que le popup peut changer, nettoyé : le reste (journal, horodatages) n'appartient qu'au worker. */
export function sanitize(patch, cur = DEFAULTS) {
  const out = { ...cur };
  if ('on' in patch) out.on = !!patch.on;
  if ('interval' in patch) out.interval = Math.min(240, Math.max(15, Math.round(Number(patch.interval) || 15)));
  if ('offer' in patch) out.offer = ids(patch.offer).slice(0, MAX_SIDE);
  if ('tags' in patch) out.tags = [...new Set((patch.tags || []).filter(x => TAGS.includes(x)))].slice(0, MAX_SIDE);
  if ('items' in patch) out.items = ids(patch.items);
  out.items = out.items.slice(0, MAX_SIDE - out.tags.length);
  if (patch.sites && typeof patch.sites === 'object') {
    out.sites = { ...cur.sites };
    for (const k of Object.keys(SITES)) if (k in patch.sites) out.sites[k] = !!patch.sites[k];
  }
  return out;
}

export async function getConfig() {
  const { [KEY]: c } = await B.storage.local.get(KEY);
  return { ...DEFAULTS, ...(c || {}), sites: { ...DEFAULTS.sites, ...(c?.sites || {}) } };
}
const saveConfig = (c) => B.storage.local.set({ [KEY]: c });

const permitted = (site) => !site.origin || safe(() => B.permissions.contains({ origins: [site.origin] }), false);

/** L'état de chaque site pour le popup : connecté, à connecter, permission manquante ou bloqué. */
export async function tradeAdsStatus() {
  const cfg = await getConfig();
  const out = {};
  for (const [k, site] of Object.entries(SITES)) {
    const base = { name: site.name, login: site.login, origin: site.origin, cooldown: site.cooldown || 0, on: !!cfg.sites[k] };
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

/** Une alarme par intervalle choisi ; coupée quand l'auto-post est éteint. */
export async function scheduleTradeAds(cfg) {
  cfg ||= await getConfig();
  await safe(() => B.alarms.clear(ALARM));
  if (cfg.on) await safe(() => B.alarms.create(ALARM, { periodInMinutes: cfg.interval }));
}

/**
 * Un tour d'envoi. `force` (bouton « Publier maintenant ») passe outre
 * l'intervalle choisi, jamais le délai propre au site ni sa limite du jour.
 * `offerable` : les ids encore dans l'inventaire (un item vendu n'est pas offert).
 */
export async function runTradeAds({ me, offerable = null, force = false, now = Date.now() } = {}) {
  const cfg = await getConfig();
  if (!cfg.on && !force) return { skipped: 'off' };
  if (!me) return { skipped: 'me' };
  const offer = offerable ? cfg.offer.filter(id => offerable.has(id)) : cfg.offer;
  if (!offer.length || !(cfg.items.length + cfg.tags.length)) return { skipped: 'empty' };
  const ad = { offer, items: cfg.items, tags: cfg.tags };
  const results = {};
  for (const [k, site] of Object.entries(SITES)) {
    if (!cfg.sites[k]) continue;
    const wait = Math.max(site.cooldown, force ? 0 : cfg.interval) * MIN;
    if (now - (cfg.last[k] || 0) < wait - 30e3) continue;   // l'alarme peut sonner quelques secondes en avance
    const day = (cfg.sent[k] || []).filter(at => now - at < 24 * 60 * MIN);
    if (site.daily && day.length >= site.daily) { results[k] = 'daily'; continue; }
    if (!(await permitted(site))) { results[k] = 'perm'; continue; }
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
