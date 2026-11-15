/**
 * ==========================================================================
 *  PROOF DE PLUSIEURS TRADES : LES CINQ LIGNES D'UN LOT
 * --------------------------------------------------------------------------
 *  Le panneau proof (content/trade-delta.js) peut mettre plusieurs trades
 *  terminés de côté ; background/proof.js prépare chacun, puis on les réunit
 *  ici en un seul proof au format Rolimons :
 *   - Item(s) : tout ce que j'ai donné / tout ce que j'ai reçu, un même objet
 *     compté (« Dominus Empyreus x2 ») ;
 *   - Values : les deux totaux, avec l'écart (« (8k op) ») ;
 *   - Sender / Receiver : les pseudos des trades, sans doublon ;
 *   - Date : la date commune, sinon la première et la dernière.
 *  Pur, sans navigateur : testé par tools/test-proof.mjs.
 * ==========================================================================
 */

/** 62316 → « 62.3k », comme les proofs de Rolimons. */
export function shortValue(n) {
  n = Number(n) || 0;
  for (const [d, s] of [[1e6, 'M'], [1e3, 'k']]) if (n >= d) return (n / d).toFixed(1).replace(/\.0$/, '') + s;
  return String(Math.round(n));
}

/** « (8k op) » quand le second côté vaut plus, « (8k lb) » quand il vaut moins, rien à égalité. */
export function gapNote(a, b) {
  const gap = Math.round((Number(b) || 0) - (Number(a) || 0));
  return gap ? ` (${shortValue(Math.abs(gap))} ${gap > 0 ? 'op' : 'lb'})` : '';
}

/** Les mêmes noms regroupés, dans l'ordre d'apparition : [A, B, A] → [« A x2 », « B »]. Les Robux sont additionnés. */
export function groupLabels(labels) {
  const counts = new Map();
  let robux = 0;
  for (const l of labels) {
    const r = /^(\d+) Robux$/.exec(l);
    if (r) { robux += Number(r[1]); continue; }
    counts.set(l, (counts.get(l) || 0) + 1);
  }
  return [...[...counts].map(([l, n]) => (n > 1 ? `${l} x${n}` : l)), ...(robux ? [`${robux} Robux`] : [])];
}

/** MM/JJ/AAAA → nombre triable (AAAAMMJJ), 0 si la date ne se lit pas. */
const dateKey = (d) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(d || ''); return m ? Number(m[3] + m[1] + m[2]) : 0; };

const uniques = (arr) => [...new Set(arr.map(s => String(s || '').trim()).filter(Boolean))];

/**
 * Les cinq champs d'un proof de plusieurs trades. `trades` : pour chacun
 * { labels: [ce que je donne, ce que je reçois], values: [donné, reçu] | null, sender, receiver, date }.
 */
export function mergeProof(trades) {
  const give = groupLabels(trades.flatMap(t => t.labels[0]));
  const get = groupLabels(trades.flatMap(t => t.labels[1]));
  const valued = trades.every(t => Array.isArray(t.values));
  const sum = (k) => trades.reduce((s, t) => s + (Number(t.values?.[k]) || 0), 0);
  const dates = uniques(trades.map(t => t.date)).sort((a, b) => dateKey(a) - dateKey(b));
  return {
    items: `${give.join(', ')} / ${get.join(', ')}`,
    values: valued ? `${shortValue(sum(0))} vs ${shortValue(sum(1))}${gapNote(sum(0), sum(1))}` : '',
    sender: uniques(trades.map(t => t.sender)).join(', '),
    receiver: uniques(trades.map(t => t.receiver)).join(', '),
    date: dates.length > 1 ? `${dates[0]} - ${dates[dates.length - 1]}` : dates[0] || ''
  };
}
