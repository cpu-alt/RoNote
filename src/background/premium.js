/**
 * ==========================================================================
 *  RONOTE PREMIUM : LE JETON DE L'ABONNÉ
 * --------------------------------------------------------------------------
 *  Les fonctions servies par Neuronal (fiches joueur et objet, Profils, Deals)
 *  sont réservées aux abonnés du serveur Discord Neuronal. Le verrou est sur
 *  le SERVEUR : sans jeton signé par Neuronal, ses routes ne rendent rien, et
 *  il revérifie l'abonnement à chaque appel. Ce fichier ne fait qu'obtenir le
 *  jeton, le garder et le renouveler : retirer ce code ne débloque rien.
 *
 *  DEUX FAÇONS DE SE CONNECTER, le même jeton à la fin :
 *   - Connect Discord (`identity.launchWebAuthFlow`) : la page de Discord,
 *     scope `identify` seulement ; Neuronal renvoie le jeton dans le fragment
 *     de l'adresse de retour de l'extension ;
 *   - une clé RN-XXXX-… reçue en DM (ou /key sur Discord).
 *  Ensuite, le compte Roblox est VÉRIFIÉ : un code de quatre mots à coller dans
 *  la description du profil Roblox, que Neuronal relit sur la page publique du
 *  profil. Aucun cookie Roblox ne quitte le navigateur.
 *
 *  LE JETON vit 24 h dans `storage.local` (clé `premium`) ; il est renouvelé
 *  tout seul quand il lui reste moins de 2 h, ou après un refus « expired ».
 *  Rien ne part tant que la permission sur neuronal.live n'est pas accordée.
 * ==========================================================================
 */
import { B } from '../common/shim.js';
import { NEURONAL } from '../common/defaults.js';
import { getState } from '../common/state.js';

const KEY = 'premium';
const RENEW_BEFORE = 2 * 3600;          // secondes
let renewing = null;

export async function premiumGet() {
  const got = await B.storage.local.get(KEY).catch(() => null);
  return got?.[KEY] || {};
}

async function premiumSet(patch) {
  const next = { ...(await premiumGet()), ...patch };
  for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k];
  await B.storage.local.set({ [KEY]: next }).catch(() => {});
  return next;
}

const granted = () => B.permissions?.contains({ origins: NEURONAL.origins }).catch(() => false);

async function call(path, { method = 'GET', body, token } = {}) {
  const headers = { 'X-RoNote': B.runtime.getManifest?.().version || '1' };
  if (body) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
  try {
    const res = await fetch(NEURONAL.api + path, {
      method, headers, credentials: 'omit', body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch { /* corps vide */ }
    return { status: res.status, data: data || {} };
  } catch (e) {
    return { status: 0, data: { error: 'network', detail: String(e?.message || e) } };
  }
}

/** Le compte Roblox suivi par RoNote en ce moment : { id, name } ou null. */
async function robloxMe() {
  const st = await getState().catch(() => null);
  const id = Number(st?.userId) || 0;
  if (!(id > 0)) return null;
  const acct = (st.accounts || []).find(a => Number(a.id) === id) || {};
  return { id, name: acct.name || '' };
}

/** Une réponse avec jeton : on garde le jeton et ce que la carte affiche. */
async function keep(data) {
  if (!data?.token) return premiumGet();
  const { token, ...me } = data;
  return premiumSet({ token, exp: Number(me.exp) || 0, me, pending: undefined, error: undefined, at: Date.now() });
}

/** L'état pour la carte Premium : connecté ou non, ce qui est ouvert, un code en attente. */
export async function premiumStatus({ fresh = false } = {}) {
  const p = await premiumGet();
  const roblox = await robloxMe();
  if (p.token && fresh && await granted()) {
    const r = await call('auth/me', { token: p.token });
    if (r.status === 200) {
      await premiumSet({ me: { ...r.data, exp: p.exp } });
    } else if (r.status === 401) {
      await renew(true);
    }
  }
  const now = await premiumGet();
  return {
    signedIn: !!now.token, me: now.me || null, pending: now.pending || null,
    error: now.error || null, roblox, permission: await granted()
  };
}

/** Renouvelle le jeton s'il est près d'expirer (ou tout de suite, `force`). */
async function renew(force = false) {
  const p = await premiumGet();
  if (!p.token) return p;
  if (!force && p.exp - Date.now() / 1000 > RENEW_BEFORE) return p;
  if (renewing) return renewing;
  renewing = (async () => {
    const r = await call('auth/refresh', { method: 'POST', token: p.token });
    if (r.status === 200) return keep(r.data);
    // Session fermée (déconnexion ailleurs, clé renouvelée, accès expiré) : on oublie le jeton.
    if (r.status === 401) return premiumSet({ token: undefined, exp: 0, me: undefined, error: r.data.error || 'revoked' });
    return p;                                   // réseau en panne : le jeton actuel reste
  })().finally(() => { renewing = null; });
  return renewing;
}

/**
 * Les en-têtes d'un appel premium (Authorization et le compte Roblox suivi),
 * le jeton renouvelé au besoin. {} sans session.
 */
export async function premiumHeaders() {
  const p = await renew();
  if (!p.token) return {};
  const roblox = await robloxMe();
  return { Authorization: 'Bearer ' + p.token, ...(roblox ? { 'X-RoNote-User': String(roblox.id) } : {}) };
}

/** Un refus 401 « expired » d'une route premium : un renouvellement, une fois. */
export async function premiumRetry(reason) {
  if (reason !== 'expired') return false;
  const p = await renew(true);
  return !!p.token;
}

/* ------------------------------ connexion ------------------------------- */

function fragment(url) {
  const out = {};
  const hash = String(url || '').split('#')[1] || '';
  for (const [k, v] of new URLSearchParams(hash)) out[k] = v;
  return out;
}

/** Connect Discord. Rend { ok } ou { error }. */
export async function premiumConnect() {
  if (!await granted()) return { error: 'permission' };
  if (!B.identity?.launchWebAuthFlow) return { error: 'unsupported' };
  const redirect = B.identity.getRedirectURL('premium');
  const url = NEURONAL.api + 'auth/discord?redirect=' + encodeURIComponent(redirect);
  let back;
  try {
    back = await B.identity.launchWebAuthFlow({ url, interactive: true });
  } catch (e) {
    return { error: 'cancelled' };
  }
  const f = fragment(back);
  if (!f.token) return { error: f.error || 'failed', invite: f.invite || '' };
  // Le fragment n'a que le jeton : la carte demande le reste au serveur.
  await premiumSet({ token: f.token, exp: Number(f.exp) || 0, pending: undefined, error: undefined });
  await premiumStatus({ fresh: true });
  return { ok: true };
}

/** « I have a key » : la clé et le compte Roblox suivi. Rend { code } à mettre dans la bio, ou { error }. */
export async function premiumKey(key) {
  if (!await granted()) return { error: 'permission' };
  const roblox = await robloxMe();
  if (!roblox) return { error: 'no_roblox' };
  const r = await call('auth/key', { method: 'POST', body: { key: String(key || '').trim(), roblox_id: roblox.id, name: roblox.name } });
  return pendingFrom(r, roblox, 'key');
}

/** Connecté par Discord, sans compte Roblox lié (ou pour en changer) : un code pour la bio. */
export async function premiumLink() {
  if (!await granted()) return { error: 'permission' };
  const roblox = await robloxMe();
  if (!roblox) return { error: 'no_roblox' };
  const p = await renew();
  if (!p.token) return { error: 'login' };
  const r = await call('auth/link', { method: 'POST', token: p.token, body: { roblox_id: roblox.id, name: roblox.name } });
  return pendingFrom(r, roblox, 'link');
}

async function pendingFrom(r, roblox, kind) {
  if (r.status !== 200) return { error: r.data.error || 'HTTP ' + r.status, ...r.data };
  const pending = { ticket: r.data.ticket, code: r.data.code, kind, roblox, oauth: !!r.data.roblox_oauth,
    until: Date.now() + (Number(r.data.expires_in) || 900) * 1000 };
  await premiumSet({ pending });
  return { ok: true, pending };
}

/** « I added it » : Neuronal relit la bio. Rend { ok } ou { error } (`code_missing` : pas encore vu). */
export async function premiumVerify() {
  const p = await premiumGet();
  if (!p.pending?.ticket) return { error: 'expired' };
  const r = await call('auth/verify', { method: 'POST', body: { ticket: p.pending.ticket } });
  if (r.status === 200) { await keep(r.data); return { ok: true }; }
  if (r.status === 410) await premiumSet({ pending: undefined });
  return { error: r.data.error || 'HTTP ' + r.status };
}

/**
 * « Se connecter avec Roblox » (2.16.8) : la page d'autorisation officielle de Roblox
 * (OAuth 2.0, scopes openid profile) prouve le compte à la place du code dans la bio.
 * Neuronal vérifie que Roblox a confirmé LE compte du défi, puis rend le jeton dans le
 * fragment, comme Connect Discord. Rend { ok } ou { error } (`other_account` : Roblox a
 * confirmé un autre compte que celui suivi par RoNote).
 */
export async function premiumRobloxOAuth() {
  const p = await premiumGet();
  if (!p.pending?.ticket) return { error: 'expired' };
  if (!B.identity?.launchWebAuthFlow) return { error: 'unsupported' };
  const redirect = B.identity.getRedirectURL('roblox');
  const r = await call('auth/roblox/start', { method: 'POST', body: { ticket: p.pending.ticket, redirect } });
  if (r.status !== 200) return { error: r.data.error || 'HTTP ' + r.status };
  let back;
  try {
    back = await B.identity.launchWebAuthFlow({ url: r.data.url, interactive: true });
  } catch (e) {
    return { error: 'cancelled' };
  }
  const f = fragment(back);
  if (!f.token) return { error: f.error || 'failed', name: f.name || '' };
  await premiumSet({ token: f.token, exp: Number(f.exp) || 0, pending: undefined, error: undefined });
  await premiumStatus({ fresh: true });
  return { ok: true };
}

export async function premiumCancel() {
  await premiumSet({ pending: undefined });
  return { ok: true };
}

export async function premiumLogout() {
  const p = await premiumGet();
  if (p.token) await call('auth/logout', { method: 'POST', token: p.token });
  await B.storage.local.set({ [KEY]: {} }).catch(() => {});
  return { ok: true };
}
