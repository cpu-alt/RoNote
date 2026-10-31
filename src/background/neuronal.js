/**
 * ==========================================================================
 *  NEURONAL : CE QUE LE RÉSEAU SAIT D'UN JOUEUR OU D'UN OBJET
 * --------------------------------------------------------------------------
 *  Lu à l'ouverture d'une fiche du popup (joueur ou objet), et seulement si
 *  l'option `neuronalLookup` est cochée ET que la permission optionnelle sur
 *  neuronal.live est accordée. Sinon, rien ne part.
 *
 *  La route /ext/v1 du bot (RoliBot, 18qbf) ne fait que LIRE sa base : aucun
 *  joueur n'entre dans le réseau parce qu'on l'a regardé. Seul l'identifiant
 *  demandé voyage, sans cookie (`credentials: 'omit'`). L'en-tête `X-RoNote`
 *  est exigé par la garde du site, qui limite sans jamais bannir.
 *
 *  LE MOINS DE REQUÊTES POSSIBLE
 *  - Une fiche n'est lue qu'au clic, jamais en avance.
 *  - Les réponses sont gardées comme le serveur les garde (10 min pour un
 *    joueur ou un objet connu, 30 min pour un inconnu, 1 min pour un échec),
 *    dans `storage.session` : le service worker s'endort après 30 s sans
 *    rien faire, un cache en mémoire seule repartait vide à chaque réveil.
 *    `storage.session` vit jusqu'à la fermeture du navigateur, sans disque.
 *  - Deux ouvertures de la même fiche pendant la lecture partagent la requête.
 * ==========================================================================
 */
import { B } from '../common/shim.js';
import { NEURONAL } from '../common/defaults.js';

const KNOWN_MS = 10 * 60e3;
const UNKNOWN_MS = 30 * 60e3;
const FAIL_MS = 60e3;
const STORE_KEY = 'neuronalCache';
const STORE_MAX = 300;
const pending = new Map();   // 'player:123' -> Promise de la lecture en cours
let memo = null;             // { 'player:123': { until, value } }, copie de storage.session

async function cache() {
  if (memo) return memo;
  const got = await B.storage.session?.get(STORE_KEY).catch(() => null);
  memo = got?.[STORE_KEY] || {};
  return memo;
}

async function remember(key, value, ttl) {
  const m = await cache();
  m[key] = { until: Date.now() + ttl, value };
  const keys = Object.keys(m);
  if (keys.length > STORE_MAX) {
    const now = Date.now();
    for (const k of keys) if (m[k].until <= now) delete m[k];
    for (const k of Object.keys(m).slice(0, Math.max(0, Object.keys(m).length - STORE_MAX))) delete m[k];
  }
  await B.storage.session?.set({ [STORE_KEY]: m }).catch(() => {});
}

async function fetchOne(kind, id) {
  try {
    const res = await fetch(`${NEURONAL.api}${kind}/${id}`, {
      headers: { 'X-RoNote': B.runtime.getManifest?.().version || '1' },
      credentials: 'omit'
    });
    // 404 : la route n'est pas encore déployée sur le site ; 503 : elle y est, coupée.
    if (res.status === 404 || res.status === 503) return { unavailable: true };
    if (res.status === 429) return { limited: true };
    if (!res.ok) return { error: 'HTTP ' + res.status };
    return { data: await res.json() };
  } catch (e) {
    return { error: String(e?.message || e) };
  }
}

/**
 * `{ data }` (la fiche, `data.known` dit si le réseau la connaît), `{ off }`
 * (option ou permission absente), `{ unavailable }` (route absente ou coupée
 * côté site), `{ limited }` (débit dépassé) ou `{ error }`.
 */
export async function neuronalLookup(kind, id, settings) {
  id = Number(id);
  if ((kind !== 'player' && kind !== 'item') || !(id > 0)) return { error: 'bad request' };
  if (!settings?.neuronalLookup) return { off: true };
  const granted = await B.permissions?.contains({ origins: NEURONAL.origins }).catch(() => false);
  if (!granted) return { off: true, permission: false };

  const key = kind + ':' + id;
  const hit = (await cache())[key];
  if (hit && hit.until > Date.now()) return hit.value;
  if (pending.has(key)) return pending.get(key);

  const run = fetchOne(kind, id).then(async (value) => {
    const ttl = value.data ? (value.data.known ? KNOWN_MS : UNKNOWN_MS) : FAIL_MS;
    await remember(key, value, ttl);
    return value;
  }).finally(() => pending.delete(key));
  pending.set(key, run);
  return run;
}
