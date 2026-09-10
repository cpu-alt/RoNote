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
 * Ici on raisonne sur l'identifiant numerique du trade (trade.id), unique et
 * immuable. Il n'est en revanche PAS croissant : Roblox attribue ses
 * identifiants sans ordre, et un trade recu a 10 h peut porter un id plus
 * petit que celui de 9 h. L'ancien filtre « id > plus grand id vu » ecartait
 * ainsi en silence la plupart des nouveaux trades.
 *
 *  - `seen`      : ensemble borne des ids deja traites (anti-rejeu).
 *  - `newest`    : date de creation la plus recente observee sur le flux.
 *  - `seededAt`  : au tout premier passage on enregistre l'existant EN SILENCE,
 *                  donc aucune notification pour des trades deja presents.
 *
 * Mode "recent" (Inbound / Outbound) : un trade qui apparait sur ces flux
 * vient d'etre cree. Un id jamais vu, cree plus d'une heure avant le plus
 * recent connu, est un ancien trade qui remonte dans la liste (refus en serie,
 * cache tronque) : il est ecarte, mais compte dans `belowMark`.
 * Mode "seen" (Completed / Inactive) : un vieux trade peut se terminer APRES un
 * trade plus recent, sa date de creation ne dit rien de sa fin. On se fie
 * alors uniquement a l'ensemble `seen`.
 */
export const STREAMS = {
  inbound:   { type: 'Inbound',   mode: 'recent' },
  outbound:  { type: 'Outbound',  mode: 'recent' },
  completed: { type: 'Completed', mode: 'seen' },
  inactive:  { type: 'Inactive',  mode: 'seen' }
};

/**
 * Marge sur les dates de creation. Deux trades crees a quelques secondes
 * d'intervalle n'apparaissent pas forcement dans la liste dans cet ordre : un
 * trade legitime peut etre un peu plus vieux que le dernier vu. Mieux vaut
 * une marge large qu'un trade perdu.
 */
export const RECENT_SLACK_MS = 60 * 60 * 1000;

const createdAt = (t) => {
  const ms = Date.parse(t?.created);
  return Number.isFinite(ms) ? ms : 0;
};

/**
 * @param kind     cle de STREAMS
 * @param streams  objet persistant { [kind]: {seen, newest, seededAt, belowMark} }
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
  const newestOnPage = all.reduce((m, t) => Math.max(m, createdAt(t)), 0);

  if (seeding) {
    // Premier contact : on photographie l'existant sans rien notifier.
    streams[kind] = { seen: ids.slice(0, SEEN_CAP), newest: newestOnPage, seededAt: Date.now(), belowMark: 0 };
    return { fresh: [], seeded: true, all };
  }

  const prevSeen = Array.isArray(prev.seen) ? prev.seen : [];
  const seen = new Set(prevSeen);

  // Flux enregistre par une version qui se fiait a l'ordre des ids : pas
  // encore de date de reference. Les trades deja vus de la page la donnent.
  // L'ancien compteur, lui, melangeait vrais anciens et nouveaux trades perdus :
  // il repart de zero.
  const migrating = !Number.isFinite(prev.newest);
  const reference = migrating
    ? all.reduce((m, t) => (seen.has(Number(t.id)) ? Math.max(m, createdAt(t)) : m), 0)
    : prev.newest;

  let belowMark = 0;
  const fresh = all.filter(t => {
    const id = Number(t.id);
    if (!Number.isFinite(id) || seen.has(id)) return false;       // deja vu
    const created = createdAt(t);
    if (cfg.mode === 'recent' && created && reference && created < reference - RECENT_SLACK_MS) {
      belowMark++;                                                 // ancien trade qui remonte
      return false;
    }
    return true;
  }).sort((a, b) => (createdAt(a) - createdAt(b)) || (Number(a.id) - Number(b.id)));

  // Les ids de la page courante passent en tete : on garde toujours la fenetre
  // la plus recente et on evince les plus vieux au-dela du plafond.
  streams[kind] = {
    seen: [...new Set([...ids, ...prevSeen])].slice(0, SEEN_CAP),
    newest: Math.max(reference || 0, newestOnPage),
    seededAt: prev.seededAt,
    belowMark: (migrating ? 0 : (prev.belowMark || 0)) + belowMark
  };

  return { fresh, seeded: false, all };
}

/** Marque des ids comme traites sans notification (filtres, mute, doublons). */
export function markSeen(streams, kind, ids) {
  const s = streams[kind];
  const nums = ids.map(Number).filter(Number.isFinite);
  if (!s || !nums.length) return;
  s.seen = [...new Set([...nums, ...(s.seen || [])])].slice(0, SEEN_CAP);
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
