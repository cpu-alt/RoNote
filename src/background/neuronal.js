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
import { B, IS_FIREFOX } from '../common/shim.js';
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

async function forget(keys) {
  const m = await cache();
  let hit = false;
  for (const k of keys) if (k in m) { delete m[k]; hit = true; }
  if (hit) await B.storage.session?.set({ [STORE_KEY]: m }).catch(() => {});
}

async function fetchOne(kind, id, path = `${kind}/${id}`) {
  try {
    const res = await fetch(NEURONAL.api + path, {
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

/**
 * Les fiches Profile discovery (onglet Profils du popup) : `kind` = 'classic'
 * (annonces Rolimon's) ou 'neuronal' (joueurs vus trader, palier « ghost »
 * compris), `tier` = un palier ou rien. Mêmes conditions que les fiches ;
 * gardées 2 min, comme le serveur. Rien n'est lu tant que l'onglet est fermé.
 */
const PROFILES_MS = 2 * 60e3;
export async function neuronalProfiles(kind, tier, settings) {
  if (kind !== 'classic' && kind !== 'neuronal') return { error: 'bad request' };
  tier = /^[a-z]{3,12}$/.test(tier || '') ? tier : '';
  if (!settings?.neuronalLookup) return { off: true };
  const granted = await B.permissions?.contains({ origins: NEURONAL.origins }).catch(() => false);
  if (!granted) return { off: true, permission: false };

  const key = `profiles:${kind}:${tier}`;
  const hit = (await cache())[key];
  if (hit && hit.until > Date.now()) return hit.value;
  if (pending.has(key)) return pending.get(key);
  const run = fetchOne('profiles', 0, `profiles?kind=${kind}${tier ? '&tier=' + tier : ''}`).then(async (value) => {
    await remember(key, value, value.data ? PROFILES_MS : FAIL_MS);
    return value;
  }).finally(() => pending.delete(key));
  pending.set(key, run);
  return run;
}

/* ==========================================================================
 *  CONTRIBUER AU RÉSEAU : CE QUE RONOTE ENVOIE DE LUI-MÊME
 * --------------------------------------------------------------------------
 *  Option `neuronalShare`, coupée par défaut, même permission que les fiches.
 *  Deux choses partent, et seulement elles :
 *   - la PRÉSENCE du compte (id, pseudo, version, valeur du portefeuille) :
 *     le site le montre sur sa carte avec le cadre des joueurs RoNote ;
 *   - ses TRADES TERMINÉS, tels que Roblox les a rendus : exemplaires exacts
 *     (userAssetId, série) et Robux de chaque côté. Le réseau les déduit sinon
 *     des inventaires, sans jamais voir les Robux, et se trompe parfois.
 *
 *  AUCUNE REQUÊTE DE PLUS VERS ROBLOX : seuls les trades dont le détail est
 *  déjà en cache (lu pour la notification ou le popup) sont envoyés. Au repos,
 *  rien ne part : la présence toutes les 6 h, les trades une fois chacun.
 * ==========================================================================
 */
const SHARE_KEY = 'neuronalShare';
const PRESENCE_EVERY = 6 * 60 * 60e3;
const SHARE_BATCH = 25;
const SENT_CAP = 500;                 // ids déjà envoyés retenus par compte
const HOLD_FAIL = 10 * 60e3;          // réseau en panne, débit dépassé
const HOLD_ABSENT = 6 * 60 * 60e3;    // route pas encore ouverte (404 / 503)

const side = (o) => ({
  robux: Math.max(0, Math.floor(Number(o?.robux) || 0)),
  items: (o?.userAssets || []).map(it => ({
    uaid: /^[1-9]\d*$/.test(String(it.id ?? '')) ? Number(it.id) : null,
    assetId: Number(it.assetId) || 0,
    bundleId: Number(it.bundleId) || 0,
    serial: Number(it.serialNumber) || null,
    name: it.name || ''
  })).filter(it => it.assetId || it.bundleId)
});

/**
 * Un trade terminé, vu du compte qui l'envoie. null quand le détail ne dit pas
 * qui est qui (trade relu sur la page, sans id du partenaire) : le réseau ne
 * saurait pas où le placer.
 */
export function tradeReport(detail, myId, seenAt = Date.now()) {
  const offers = detail?.offers || [];
  const mine = offers.find(o => Number(o.user?.id) === Number(myId));
  const theirs = offers.find(o => o !== mine);
  const partnerId = Number(theirs?.user?.id) || 0;
  if (!mine || !(partnerId > 0) || !(Number(detail.id) > 0)) return null;
  const gave = side(mine), got = side(theirs);
  if (!gave.items.length && !got.items.length && !gave.robux && !got.robux) return null;
  const created = Date.parse(detail.created || '') || null;
  return {
    id: Number(detail.id),
    created: created ? Math.floor(created / 1000) : null,
    seen: Math.floor(seenAt / 1000),
    partner: { id: partnerId, name: theirs.user?.name || '' },
    gave, got
  };
}

async function post(path, body) {
  try {
    const res = await fetch(NEURONAL.api + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-RoNote': B.runtime.getManifest?.().version || '1' },
      credentials: 'omit',
      body: JSON.stringify(body)
    });
    if (res.ok) return { ok: true };
    if (res.status === 404 || res.status === 503) return { hold: HOLD_ABSENT, why: 'unavailable' };
    if (res.status === 429) return { hold: HOLD_FAIL, why: 'limited' };
    // 400 / 422 : le site refuse ce lot tel quel ; le renvoyer ne changerait rien.
    if (res.status >= 400 && res.status < 500) return { rejected: true, why: 'HTTP ' + res.status };
    return { hold: HOLD_FAIL, why: 'HTTP ' + res.status };
  } catch (e) {
    return { hold: HOLD_FAIL, why: String(e?.message || e) };
  }
}

export async function shareStatus() {
  const got = await B.storage.local.get(SHARE_KEY).catch(() => null);
  return got?.[SHARE_KEY] || {};
}

/**
 * Appelé à la fin de chaque vérification. `completed` : les trades terminés
 * de la liste (ids), `detailOf(id)` : leur détail s'il est déjà en cache.
 */
export async function shareWithNeuronal({ settings, me, completed = [], detailOf, portfolio = null, now = Date.now() }) {
  if (!settings?.neuronalShare || !(Number(me?.id) > 0)) return { off: true };
  const granted = await B.permissions?.contains({ origins: NEURONAL.origins }).catch(() => false);
  if (!granted) return { off: true, permission: false };

  const meta = await shareStatus();
  if (meta.holdUntil > now) return { held: true };
  const uid = String(me.id);
  const sent = new Set(meta.sent?.[uid] || []);
  const save = async (last) => {
    meta.last = { at: now, ...last };
    meta.sent = { [uid]: [...sent].slice(-SENT_CAP) };   // l'ancien compte n'a plus rien à envoyer
    await B.storage.local.set({ [SHARE_KEY]: meta }).catch(() => {});
  };
  const fail = (r) => { if (r.hold) meta.holdUntil = now + r.hold; return save({ ok: false, why: r.why }); };

  if (!(meta.presence?.[uid] > now - PRESENCE_EVERY)) {
    const r = await post('presence', {
      user: { id: Number(me.id), name: me.name || '', displayName: me.displayName || '' },
      version: B.runtime.getManifest?.().version || '',
      value: portfolio?.v || null, rap: portfolio?.r || null
    });
    if (!r.ok && !r.rejected) { await fail(r); return r; }
    meta.presence = { [uid]: now };
  }

  const reports = [];
  for (const id of completed) {
    if (sent.has(Number(id)) || reports.length >= SHARE_BATCH) continue;
    const rep = tradeReport(detailOf(id), me.id, now);
    if (rep) reports.push(rep);
  }
  if (!reports.length) { await save({ ok: true, n: 0, total: sent.size }); return { ok: true, n: 0 }; }

  const r = await post('trades', { reporter: Number(me.id), trades: reports });
  if (!r.ok && !r.rejected) { await fail(r); return r; }
  for (const rep of reports) sent.add(rep.id);
  // Le site vide sa fiche des deux joueurs à l'arrivée d'un trade : la copie
  // gardée ici (10 min) suit, sinon la fiche ouverte juste après restait l'ancienne.
  if (r.ok) await forget(['player:' + me.id, ...reports.map(rep => 'player:' + rep.partner.id)]);
  await save({ ok: !r.rejected, n: reports.length, total: sent.size, why: r.why });
  return { ok: !r.rejected, n: reports.length };
}

/* ==========================================================================
 *  LA PAGE neuronal.live/ronote PARLE À L'EXTENSION
 * --------------------------------------------------------------------------
 *  Chrome seulement (`externally_connectable` dans le manifeste) : la page
 *  demande si RoNote est installé et contribue, ou ouvre ses réglages. Seule
 *  l'origine https://neuronal.live est écoutée ; tout autre message reste sans
 *  réponse. Firefox n'a pas cette messagerie : content/neuronal-hello.js.
 * ==========================================================================
 */
const SITE_ORIGIN = new URL(NEURONAL.api).origin;

const fromSite = (sender) => {
  if (sender?.origin) return sender.origin === SITE_ORIGIN;
  try { return new URL(sender?.url || '').origin === SITE_ORIGIN; } catch { return false; }
};

/** La contribution part-elle vraiment ? L'option ET la permission. */
export async function shareActive(settings) {
  if (!settings?.neuronalShare) return false;
  return !!await B.permissions?.contains({ origins: NEURONAL.origins }).catch(() => false);
}

/**
 * Réponse à un message de la page, ou null pour ne rien répondre.
 * `openSettings(hash)` ouvre la page de réglages sur une section.
 */
export async function neuronalExternal(msg, sender, settings, openSettings) {
  if (!fromSite(sender)) return null;
  if (msg?.type === 'ronote:hello') {
    return { version: B.runtime.getManifest?.().version || '', share: await shareActive(settings) };
  }
  if (msg?.type === 'ronote:open' && msg.section === 'neuronal') {
    await openSettings('s-neuronal');
    return { ok: true };
  }
  return null;
}

/**
 * Firefox : content/neuronal-hello.js n'est déclaré nulle part dans le
 * manifeste — il y rendrait neuronal.live obligatoire à l'installation. Il est
 * enregistré ici quand la permission optionnelle est accordée, retiré quand
 * elle est rendue (au démarrage et à chaque changement de permission).
 */
const HELLO_ID = 'ronote-neuronal-hello';
export async function syncHelloScript() {
  const sc = B.scripting;
  if (!IS_FIREFOX || !sc?.registerContentScripts) return;
  const granted = await B.permissions?.contains({ origins: NEURONAL.origins }).catch(() => false);
  const have = (await sc.getRegisteredContentScripts({ ids: [HELLO_ID] }).catch(() => [])).length > 0;
  if (granted && !have) {
    await sc.registerContentScripts([{
      id: HELLO_ID, matches: ['https://neuronal.live/ronote*'],
      js: ['content/neuronal-hello.js'], runAt: 'document_idle'
    }]).catch(() => {});
  } else if (!granted && have) {
    await sc.unregisterContentScripts({ ids: [HELLO_ID] }).catch(() => {});
  }
}
