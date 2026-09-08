/**
 * Suivi des trades ENVOYES (onglet Outbound) et chainage des contre-offres.
 *
 * Roblox ne fournit aucun lien parent/enfant entre un trade et la contre-offre
 * qui en decoule : quand quelqu'un contre votre trade, l'ancien bascule en
 * "Countered" et un trade tout neuf apparait dans vos trades recus. On
 * reconstruit donc le lien localement, par (partenaire + fenetre de temps).
 */

/** Statuts consideres comme "toujours en cours". */
export const OPEN_STATUSES = new Set(['Open', 'Pending', 'Processing', 'Unknown']);

/**
 * Normalise le statut renvoye par l'API. Volontairement tolerant : on ne
 * depend pas de l'orthographe exacte ("RejectedDueToError", "Rejected due to
 * an error", casse differente...).
 */
export function normStatus(raw) {
  const t = String(raw ?? '').toLowerCase().replace(/[^a-z]/g, '');
  if (!t) return 'Unknown';
  if (t.includes('reject')) return 'RejectedDueToError';
  if (t.includes('intervention')) return 'InterventionRequired';
  if (t.includes('counter')) return 'Countered';
  if (t.includes('complet')) return 'Completed';
  if (t.includes('declin')) return 'Declined';
  if (t.includes('expir')) return 'Expired';
  if (t.includes('processing')) return 'Processing';
  if (t.includes('pending')) return 'Pending';
  if (t.includes('open')) return 'Open';
  return 'Unknown';
}

/** Description de chaque issue possible d'un trade envoye. */
export const OUTCOMES = {
  Completed:            { kind: 'outbound_accepted',  icon: '✅', title: 'Trade accepté',              opt: 'accepted' },
  Declined:             { kind: 'outbound_declined',  icon: '❌', title: 'Trade refusé',               opt: 'declined' },
  Countered:            { kind: 'outbound_countered', icon: '🔄', title: 'Trade contré',               opt: 'countered' },
  Expired:              { kind: 'outbound_expired',   icon: '⏳', title: 'Trade expiré',               opt: 'expired'  },
  RejectedDueToError:   { kind: 'trade_error',        icon: '⚠️', title: 'Rejeté suite à une erreur',  opt: 'error'    },
  InterventionRequired: { kind: 'trade_error',        icon: '⚠️', title: 'Bloqué (intervention Roblox)', opt: 'error'  }
};

export const isFinal = (status) => !OPEN_STATUSES.has(status);

/**
 * Determine le sort des trades suivis qui ne sont plus dans la liste Outbound.
 *
 * Point important : la disparition de la liste ne suffit PAS a conclure (la
 * page est limitee a N entrees). On confirme systematiquement via le detail du
 * trade, et un statut encore ouvert laisse le suivi en place.
 *
 * @param tracked     { [tradeId]: meta }
 * @param openIds     Set des ids encore presents dans Outbound
 * @param fetchDetail (id) => Promise<detail>
 * @returns [{ tradeId, status, detail, meta }]
 */
export async function resolveTracked(tracked, openIds, fetchDetail) {
  const out = [];
  for (const key of Object.keys(tracked || {})) {
    const id = Number(key);
    if (!Number.isFinite(id) || openIds.has(id)) continue;
    let detail;
    try {
      detail = await fetchDetail(id);
    } catch {
      continue; // erreur reseau : on retentera au prochain passage
    }
    const status = normStatus(detail?.status);
    if (!isFinal(status)) continue;
    out.push({ tradeId: id, status, detail, meta: tracked[key] || {} });
  }
  return out;
}

/* ------------------------- chainage des contre-offres ------------------- */

/**
 * Enregistre "le partenaire P a contre mon trade #id" : la contre-offre va
 * arriver dans les trades recus, on saura la rattacher.
 */
export function noteCounterFromPartner(hints, partnerId, tradeId, round = 1) {
  if (!partnerId) return hints;
  hints[partnerId] = { fromOutbound: Number(tradeId), at: Date.now(), round, notified: false };
  return hints;
}

/**
 * Enregistre "j'ai contre le trade #id de P" : mon nouveau trade envoye va
 * apparaitre dans Outbound, on saura qu'il faut le suivre automatiquement.
 */
export function noteCounterByMe(mine, partnerId, tradeId, round = 1) {
  if (!partnerId) return mine;
  mine[partnerId] = { fromInbound: Number(tradeId), at: Date.now(), round };
  return mine;
}

/** Recupere un indice encore valide et le retire de la table. */
export function takeHint(map, partnerId, windowMs) {
  const h = map?.[partnerId];
  if (!h) return null;
  if (Date.now() - (h.at || 0) > windowMs) { delete map[partnerId]; return null; }
  delete map[partnerId];
  return h;
}

/** Supprime les indices trop vieux (evite toute accumulation). */
export function purgeHints(map, windowMs) {
  for (const [k, v] of Object.entries(map || {})) {
    if (Date.now() - (v?.at || 0) > windowMs) delete map[k];
  }
  return map;
}
