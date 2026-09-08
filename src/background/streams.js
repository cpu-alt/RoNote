import * as api from '../common/api.js';
import { SEEN_CAP } from '../common/state.js';

/**
 * Moteur anti-doublon.
 *
 * Le probleme classique (celui des extensions faites "a la va-vite") : on
 * compare la 1ere ligne de la page, ou le nom d'utilisateur, ou le nombre de
 * trades. Des qu'on refuse un trade, celui du dessous remonte en position 1 et
 * il est re-notifie comme "nouveau". Meme chose si le meme joueur envoie 2
 * trades : le nom ne suffit pas a les distinguer.
 *
 * Ici on ne raisonne QUE sur l'identifiant numerique du trade (trade.id), qui
 * est unique, immuable et strictement croissant cote Roblox :
 *
 *  - `seen`      : ensemble borne des ids deja traites (anti-rejeu).
 *  - `watermark` : plus grand id jamais observe sur le flux (anti-flood si
 *                  `seen` est tronque, et anti-notif au premier demarrage).
 *  - `seededAt`  : au tout premier passage on enregistre l'existant EN SILENCE,
 *                  donc aucune notification pour des trades deja presents.
 *
 * Mode "watermark" (Inbound / Outbound) : un trade qui apparait sur ces flux
 * vient d'etre cree, son id est donc toujours superieur au dernier connu ->
 * `id > watermark` est un filtre sur.
 * Mode "seen" (Completed / Inactive) : un vieux trade peut se terminer APRES un
 * trade plus recent, son id peut donc etre inferieur au watermark. On se fie
 * alors uniquement a l'ensemble `seen`.
 */
export const STREAMS = {
  inbound:   { type: 'Inbound',   mode: 'watermark' },
  outbound:  { type: 'Outbound',  mode: 'watermark' },
  completed: { type: 'Completed', mode: 'seen' },
  inactive:  { type: 'Inactive',  mode: 'seen' }
};

/**
 * @param kind     cle de STREAMS
 * @param streams  objet persistant { [kind]: {seen, watermark, seededAt} }
 * @returns {{fresh: object[], seeded: boolean, all: object[]}}
 *   fresh = trades reellement nouveaux, tries du plus ancien au plus recent.
 */
export async function pollStream(kind, streams, { seedLimit = 100, pageLimit = 25 } = {}) {
  const cfg = STREAMS[kind];
  if (!cfg) throw new Error('Flux inconnu: ' + kind);

  const prev = streams[kind];
  const seeding = !prev || !prev.seededAt;

  const list = await api.listTrades(cfg.type, seeding ? seedLimit : pageLimit);
  const all = Array.isArray(list?.data) ? list.data : [];
  const ids = all.map(t => Number(t.id)).filter(Number.isFinite);
  const maxId = ids.length ? Math.max(...ids) : 0;

  if (seeding) {
    // Premier contact : on photographie l'existant sans rien notifier.
    streams[kind] = { seen: ids.slice(0, SEEN_CAP), watermark: maxId, seededAt: Date.now() };
    return { fresh: [], seeded: true, all };
  }

  const seen = new Set(prev.seen);
  const watermark = Number(prev.watermark) || 0;

  // Un trade jamais vu mais dont l'id est SOUS le watermark est ecarte sans
  // bruit. C'est voulu (anterieur au suivi) — mais si ca arrivait a un trade
  // reellement nouveau, il serait perdu en silence. On les compte donc, et le
  // diagnostic des reglages affiche ce compteur.
  let belowMark = 0;
  const fresh = all.filter(t => {
    const id = Number(t.id);
    if (!Number.isFinite(id)) return false;
    if (seen.has(id)) return false;                                // deja vu
    if (cfg.mode === 'watermark' && id <= watermark) { belowMark++; return false; } // anterieur au suivi
    return true;
  }).sort((a, b) => Number(a.id) - Number(b.id));

  // Les ids de la page courante passent en tete : on garde toujours la fenetre
  // la plus recente et on evince les plus vieux au-dela du plafond.
  streams[kind] = {
    seen: [...new Set([...ids, ...prev.seen])].slice(0, SEEN_CAP),
    watermark: Math.max(watermark, maxId),
    seededAt: prev.seededAt,
    belowMark: (prev.belowMark || 0) + belowMark
  };

  return { fresh, seeded: false, all };
}

/** Marque des ids comme traites sans notification (filtres, mute, doublons). */
export function markSeen(streams, kind, ids) {
  const s = streams[kind];
  const nums = ids.map(Number).filter(Number.isFinite);
  if (!s || !nums.length) return;
  s.seen = [...new Set([...nums, ...s.seen])].slice(0, SEEN_CAP);
  s.watermark = Math.max(s.watermark || 0, ...nums);
}

/**
 * Direction d'un trade deduite de l'historique local, sans appel reseau :
 * un id vu sur le flux Outbound est un trade que J'AI envoye, un id vu sur
 * Inbound est un trade que J'AI recu.
 * @returns 'outbound' | 'inbound' | null (inconnu : anterieur a l'installation)
 */
export function directionOf(streams, tradeId) {
  const id = Number(tradeId);
  if (streams.outbound?.seen?.includes(id)) return 'outbound';
  if (streams.inbound?.seen?.includes(id)) return 'inbound';
  return null;
}
