/**
 * ==========================================================================
 *  LA FICHE D'UN JOUEUR
 * --------------------------------------------------------------------------
 *  Ce que RoNote sait deja d'un partenaire sans rien demander a personne :
 *  les trades encore affiches dans le popup et les evenements du journal.
 *  Module pur — le profil Roblox et Rolimon's sont lus par le service worker.
 *
 *  Un meme trade laisse souvent plusieurs traces (recu puis refuse depuis
 *  RoNote, envoye puis contre) : il ne compte qu'une fois, sous son dernier
 *  etat connu.
 * ==========================================================================
 */

const IN   = new Set(['inbound', 'counter']);
const OUT  = new Set(['outbound', 'outbound_declined', 'outbound_countered', 'outbound_expired', 'outbound_accepted']);
const DONE = new Set(['completed', 'outbound_accepted']);

/** En dessous, un compte est signale comme recent : le terrain des arnaques. */
export const YOUNG_ACCOUNT_DAYS = 30;

const lower = (s) => String(s || '').trim().toLowerCase();

/**
 * Les evenements du journal qui concernent ce joueur. Les entrees recentes
 * portent son identifiant ; les plus anciennes seulement son nom, qui ne sert
 * donc que faute de mieux.
 */
export function historyFor(history, partner) {
  const id = Number(partner?.id) || 0;
  const names = new Set([partner?.name, partner?.displayName].map(lower).filter(Boolean));
  return (history || []).filter(h => h?.tradeId && h.kind !== 'revalued' && (
    h.partnerId != null ? Number(h.partnerId) === id : names.has(lower(h.partner))
  ));
}

/** Sens d'un trade d'apres une trace : recu, envoye, ou inconnu. */
function dirOf(h) {
  if (IN.has(h.kind)) return 'in';
  if (OUT.has(h.kind)) return 'out';
  if (h.kind === 'declined_by_me') return /annul/.test(h.skipped || '') ? 'out' : 'in';
  return null;
}

/**
 * Une ligne par trade, du plus recent au plus ancien.
 *
 * @param events  historyFor(...)
 * @param live    trades affiches dans le popup :
 *                { tradeId, kind: 'inbound'|'outbound'|'completed', created, analysis? }
 */
export function partnerTimeline(events = [], live = []) {
  const rows = new Map();
  const row = (id) => {
    if (!rows.has(id)) {
      rows.set(id, { tradeId: id, at: 0, kind: '', dir: null, open: false, done: false, pct: null, give: null, get: null, unknown: false });
    }
    return rows.get(id);
  };

  // Du plus ancien au plus recent : le dernier etat ecrase les precedents,
  // le premier sens connu reste.
  for (const h of [...events].sort((a, b) => (a.at || 0) - (b.at || 0))) {
    const r = row(Number(h.tradeId));
    r.at = Math.max(r.at, h.at || 0);
    r.kind = h.kind;
    r.dir = r.dir || dirOf(h);
    if (DONE.has(h.kind)) r.done = true;
    if (h.pct != null) r.pct = h.pct;
    if (h.give != null) r.give = h.give;
    if (h.get != null) r.get = h.get;
    if (h.unknown != null) r.unknown = h.unknown > 0;
  }

  // Ce que le popup affiche est plus frais que le journal : il a le dernier mot.
  for (const c of live) {
    const r = row(Number(c.tradeId));
    if (!r.at) r.at = (typeof c.created === 'number' ? c.created : Date.parse(c.created)) || 0;
    if (c.kind === 'completed') {
      r.kind = DONE.has(r.kind) ? r.kind : 'completed';
      r.done = true;
      r.open = false;
    } else {
      r.dir = c.kind === 'outbound' ? 'out' : 'in';
      r.kind = r.dir === 'in' ? (IN.has(r.kind) ? r.kind : 'inbound') : 'outbound';
      r.open = true;
    }
    const a = c.analysis;
    if (a) {
      r.unknown = !!a.incomplete;
      r.pct = a.incomplete ? null : a.pctMain;
      r.give = a.mainGive ?? r.give;
      r.get = a.mainGet ?? r.get;
    }
  }
  return [...rows.values()].sort((x, y) => y.at - x.at);
}

/** Le bilan de la relation, pour les tuiles de la fiche. */
export function partnerStats(rows = []) {
  const offers = rows.filter(r => r.dir === 'in');
  const rated = offers.filter(r => r.pct != null && !r.unknown);
  const done = rows.filter(r => r.done);
  const doneRated = done.filter(r => r.give != null && r.get != null && !r.unknown);
  return {
    received: offers.length,
    sent: rows.filter(r => r.dir === 'out').length,
    done: done.length,
    rated: rated.length,
    avgIn: rated.length ? rated.reduce((s, r) => s + r.pct, 0) / rated.length : null,
    net: doneRated.length ? doneRated.reduce((s, r) => s + (r.get - r.give), 0) : null,
    last: rows[0]?.at || 0
  };
}

/** Age d'un compte, dans l'unite qui se lit le mieux. */
export function accountAge(created, now = Date.now()) {
  if (!created) return null;
  const days = Math.floor((now - created) / 864e5);
  if (days < 0) return null;
  if (days < 60) return { n: days, unit: 'day', days };
  if (days < 730) return { n: Math.floor(days / 30.44), unit: 'month', days };
  return { n: Math.floor(days / 365.25), unit: 'year', days };
}
