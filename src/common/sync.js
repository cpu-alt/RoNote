import { B, safe } from './shim.js';

/*
 * Synchronisation entre appareils (option `syncDevices`), par le stockage
 * synchronise du navigateur (compte Google / Microsoft / Firefox) : aucun
 * serveur de RoNote ni de Neuronal n'est utilise.
 *
 *  - Reglages : copies en morceaux de 7 000 caracteres (8 Ko au plus par cle,
 *    100 Ko en tout). Le dernier appareil qui modifie gagne.
 *  - Notifications : les ids deja notifies ailleurs ne sonnent plus ici, et une
 *    notification fermee ou cliquee sur un appareil disparait des autres.
 *
 * Restent propres a chaque appareil : le consentement Neuronal (la permission
 * est donnee navigateur par navigateur) et l'option de synchro elle-meme.
 */

export const LOCAL_ONLY = ['syncDevices', 'neuronalLookup', 'neuronalShare', 'neuronalAsked', 'neuronalJoinAt'];
const USER_LISTS = ['ignoredUsers', 'favUsers', 'laterUsers'];
const META = 'cfgMeta';
const CHUNK = 7000;
const MAX_CHUNKS = 12;
const NOTIF_KEY = 'notifSync';
const NOTIF_KEEP = 3 * 60 * 60 * 1000;
const NOTIF_CAP = 80;                     // ~70 octets chacun : sous les 8 Ko d'une cle

const area = () => B.storage?.sync || null;

let deviceId = null;
async function myDevice() {
  if (deviceId) return deviceId;
  const { deviceId: id } = await B.storage.local.get('deviceId');
  deviceId = id || Math.random().toString(36).slice(2, 12);
  if (!id) await B.storage.local.set({ deviceId });
  return deviceId;
}

/** La part des reglages qui voyage : sans les cles locales ni les vignettes. */
export function syncablePart(settings) {
  const out = {};
  for (const [k, v] of Object.entries(settings || {})) {
    if (LOCAL_ONLY.includes(k)) continue;
    out[k] = USER_LISTS.includes(k) && Array.isArray(v)
      ? v.map(u => ({ id: u.id, name: u.name, ...(u.at ? { at: u.at } : {}) }))
      : v;
  }
  return out;
}

/** Reglages recus d'un autre appareil, poses sur ceux d'ici (cles locales et vignettes gardees). */
export function mergeIncoming(local, incoming) {
  const next = { ...incoming };
  for (const k of LOCAL_ONLY) if (local && k in local) next[k] = local[k];
  for (const k of USER_LISTS) {
    if (!Array.isArray(next[k])) continue;
    const mine = new Map((local?.[k] || []).map(u => [Number(u.id), u]));
    next[k] = next[k].map(u => {
      const m = mine.get(Number(u.id));
      return m?.thumb ? { ...u, thumb: m.thumb, ...(m.thumbAt ? { thumbAt: m.thumbAt } : {}) } : u;
    });
  }
  return next;
}

export function toChunks(json) {
  const parts = [];
  for (let i = 0; i < json.length; i += CHUNK) parts.push(json.slice(i, i + CHUNK));
  return parts;
}

/** Les reglages tels qu'ils sont dans le nuage : { meta, json } ou null. */
async function readRemote() {
  const s = area();
  if (!s) return null;
  const { [META]: meta } = await s.get(META);
  if (!meta?.n) return null;
  const keys = Array.from({ length: meta.n }, (_, i) => 'cfg' + i);
  const got = await s.get(keys);
  const json = keys.map(k => got[k] || '').join('');
  try { JSON.parse(json); } catch { return null; }   // morceaux d'une ecriture pas encore arrivee
  return { meta, json };
}

/** Publie les reglages d'ici s'ils different de ceux du nuage. */
export async function pushSettings(settings) {
  const s = area();
  if (!s || !settings?.syncDevices) return false;
  // Un appareil qui n'a pas encore lu le nuage n'y ecrit pas : sinon un PC tout
  // juste installe ecraserait les reglages des autres avec ceux par defaut.
  const { syncJoined } = await B.storage.local.get('syncJoined');
  if (!syncJoined) return false;
  const json = JSON.stringify(syncablePart(settings));
  const remote = await safe(readRemote, null);
  if (remote?.json === json) return false;
  const parts = toChunks(json);
  if (parts.length > MAX_CHUNKS) return false;      // ne tient pas dans le quota : on n'envoie rien
  const obj = { [META]: { n: parts.length, at: Date.now(), dev: await myDevice() } };
  parts.forEach((p, i) => { obj['cfg' + i] = p; });
  await s.set(obj);
  const stale = [];
  for (let i = parts.length; i < (remote?.meta?.n || 0); i++) stale.push('cfg' + i);
  if (stale.length) await safe(() => s.remove(stale));
  await B.storage.local.set({ settingsSyncAt: obj[META].at });
  return true;
}

let pushTimer = null;
/** Ecritures groupees : un curseur deplace ecrit une fois, pas cinquante (quota de 120 / min). */
export function schedulePush(settings) {
  if (!area() || !settings?.syncDevices) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { safe(() => pushSettings(settings)); }, 1500);
}

/**
 * Reglages a adopter, venus d'un autre appareil et plus recents que la derniere
 * modification d'ici. @returns les reglages fusionnes (non sanitizes) ou null.
 */
export async function pullSettings(local) {
  if (!area() || !local?.syncDevices) return null;
  const remote = await safe(readRemote, null);
  const { settingsSyncAt = 0, syncJoined } = await B.storage.local.get(['settingsSyncAt', 'syncJoined']);
  if (!syncJoined) {
    // Premiere lecture de cet appareil : ce qui est dans le nuage gagne, toujours.
    await B.storage.local.set({ syncJoined: true });
    if (!remote) { await pushSettings(local); return null; }
  } else {
    if (!remote || remote.meta.dev === await myDevice()) return null;
    if (remote.meta.at <= settingsSyncAt) return null;
  }
  if (JSON.stringify(syncablePart(local)) === remote.json) {
    await B.storage.local.set({ settingsSyncAt: remote.meta.at });
    return null;
  }
  await B.storage.local.set({ settingsSyncAt: remote.meta.at });
  return mergeIncoming(local, JSON.parse(remote.json));
}

/** Synchro coupee : a la reactivation, cet appareil relira d'abord le nuage. */
export function leaveSync() {
  return safe(() => B.storage.local.remove('syncJoined'));
}

/** Une modification faite ici : elle passe devant celles du nuage plus anciennes. */
export function touchLocal() {
  return safe(() => B.storage.local.set({ settingsSyncAt: Date.now() }));
}

export const isSettingsChange = (changes, areaName) => areaName === 'sync' && !!changes[META];

/* ---------------------------- notifications ---------------------------- */

function trimNotifs(map, now = Date.now()) {
  const kept = Object.entries(map || {}).filter(([, v]) => now - (v?.at || 0) < NOTIF_KEEP)
    .sort((a, b) => b[1].at - a[1].at).slice(0, NOTIF_CAP);
  return Object.fromEntries(kept);
}

async function readNotifs() {
  const s = area();
  if (!s) return {};
  const { [NOTIF_KEY]: m } = await s.get(NOTIF_KEY);
  return m && typeof m === 'object' ? m : {};
}

/** Les ids de notification deja montres par un AUTRE appareil. */
export async function notifiedElsewhere(settings) {
  if (!settings?.syncDevices) return new Set();
  const map = await safe(readNotifs, {});
  const me = await myDevice();
  return new Set(Object.entries(map).filter(([, v]) => v.dev !== me).map(([k]) => k));
}

/** Note des notifications montrees (done = fermees ou cliquees) pour les autres appareils. */
export async function shareNotifs(ids, settings, done = false) {
  const s = area();
  if (!s || !settings?.syncDevices || !ids.length) return;
  const map = await safe(readNotifs, {});
  const dev = await myDevice();
  const now = Date.now();
  for (const id of ids) map[id] = { at: now, dev: done ? map[id]?.dev || dev : dev, ...(done ? { done: 1, by: dev } : {}) };
  await safe(() => s.set({ [NOTIF_KEY]: trimNotifs(map, now) }));
}

/** Ids fermes ailleurs depuis le dernier changement : a retirer de l'ecran d'ici. */
export async function closedElsewhere(changes, areaName) {
  if (areaName !== 'sync' || !changes[NOTIF_KEY]) return [];
  const me = await myDevice();
  const before = changes[NOTIF_KEY].oldValue || {};
  return Object.entries(changes[NOTIF_KEY].newValue || {})
    .filter(([k, v]) => v.done && v.by !== me && !before[k]?.done).map(([k]) => k);
}
