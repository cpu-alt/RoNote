/**
 * ==========================================================================
 *  LES VISAGES DANS LE TEMPS
 * --------------------------------------------------------------------------
 *  Rolimon's trace la valeur d'un compte jour apres jour, mais il ne voit pas
 *  les visages possedes en bundles, et il compte encore les visages donnes
 *  (les fantomes). portfolio.js mesure cet ecart AUJOURD'HUI ; ici, on le
 *  reconstruit pour chaque jour passe, a partir de l'historique des trades.
 *
 *  Pour chaque bundle cote, l'ecart vaut « bundles possedes − exemplaires que
 *  Rolimon's compte ». Aujourd'hui, la reconciliation le donne. En remontant
 *  le temps, chaque trade termine le fait bouger :
 *
 *      ecart(avant le trade) = ecart(apres) − recus + donnes
 *
 *  Les anciens exemplaires, eux, ne bougent plus depuis la conversion des
 *  visages : seul le bundle s'echange. La correction d'un jour est donc la
 *  somme, bundle par bundle, de son ecart ce jour-la multiplie par sa cote
 *  CE JOUR-LA — un visage recu en mars compte a partir de mars, a sa cote de
 *  mars.
 *
 *  Avant le tout premier mouvement de bundle, les visages n'etaient pas encore
 *  des bundles : l'ecart est nul, Rolimon's comptait juste.
 *
 *  Module pur (aucun reseau) : il se teste tel quel (tools/test-faces.mjs).
 * ==========================================================================
 */
import { readEntry } from './roli.js';

/**
 * Les bundles cotes qui changent de mains dans un trade, vus depuis mon compte.
 *
 * @param detail  detail normalise (api.normalizeTradeDetail)
 * @returns [[bundleId, n]] (n > 0 recu, n < 0 donne), ou `null` si mon cote
 *          du trade est introuvable — on ne devine pas le sens d'un echange.
 */
export function bundleMoves(detail, myId, cat) {
  const offers = Array.isArray(detail?.offers) ? detail.offers : [];
  const me = Number(myId);
  if (!me || !offers.some(o => Number(o?.user?.id) === me)) return null;
  const bundles = cat?.bundles || {};
  const net = new Map();
  for (const offer of offers) {
    const sign = Number(offer?.user?.id) === me ? -1 : 1;
    for (const it of offer?.userAssets || []) {
      let id = Number(it?.bundleId) || 0;
      // Type « Unknown » : l'identifiant a pu atterrir dans assetId.
      if (!id && it?.typeHint !== 'asset' && bundles[String(it?.assetId)]) id = Number(it.assetId);
      if (!id || !bundles[String(id)]) continue;
      net.set(id, (net.get(id) || 0) + sign);
    }
  }
  return [...net].filter(([, n]) => n !== 0);
}

/** L'ecart d'aujourd'hui, bundle par bundle, tire du rapport du portefeuille. */
export function currentGaps(report) {
  const gaps = {};
  for (const l of report?.extras || []) gaps[l.bundleId] = (gaps[l.bundleId] || 0) + (Number(l.count) || 0);
  for (const l of report?.ghosts || []) gaps[l.bundleId] = (gaps[l.bundleId] || 0) - (Number(l.count) || 0);
  return Object.fromEntries(Object.entries(gaps).filter(([, n]) => n));
}

/** Valeur d'une serie a une date : le dernier releve qui la precede (le premier, avant). */
export function seriesAt(hist, key, at) {
  const t = hist?.t;
  const vals = hist?.[key];
  if (!Array.isArray(t) || !t.length || !Array.isArray(vals)) return null;
  if (at < t[0]) return vals[0];
  let lo = 0, hi = t.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (t[mid] <= at) lo = mid; else hi = mid - 1;
  }
  return vals[lo];
}

/**
 * La cote d'un bundle a une date : son historique Rolimon's (celui de l'ancien
 * visage), sinon sa cote actuelle. Sans value publiee ce jour-la, le RAP sert
 * de cote — la convention de tout l'ecosysteme (voir roli.readEntry).
 */
export function priceLookup(histories, cat) {
  return (bundleId, at) => {
    const id = String(bundleId);
    const h = histories?.[id];
    const face = cat?.faceOf?.[id];
    const e = readEntry(cat?.bundles?.[id]) || (face ? readEntry(cat?.assets?.[face]) : null);
    const r = h ? seriesAt(h, 'r', at) : null;
    const v = h ? seriesAt(h, 'v', at) : null;
    return { value: v || r || e?.value || 0, rap: r || e?.rap || 0 };
  };
}

/**
 * La correction de chaque jour, rejouee trade par trade.
 *
 * @param points       serie de Rolimon's [{at}]
 * @param ledger       [{ at, moves: [[bundleId, n]] }] les trades termines avec des bundles
 * @param gaps         ecart d'aujourd'hui { bundleId: n }
 * @param prices       (bundleId, at) => { value, rap }
 * @param coveredFrom  date du plus ancien trade parcouru si le parcours n'est pas fini :
 *                     avant, on ne sait rien et on ne rend rien. `null` = tout parcouru.
 * @returns {{ corrections: [{at, dv, dr, dn}], unexplained: {bundleId: n}, firstMoveAt }}
 *   unexplained : l'ecart qui reste avant le premier mouvement — des bundles
 *   arrives hors trade (achat, cadeau). Ils comptent depuis le premier mouvement.
 */
export function reconstructCorrections({ points, ledger, gaps, prices, coveredFrom = null }) {
  const moves = (ledger || [])
    .flatMap(tr => (tr?.moves || []).map(([b, n]) => ({ at: Number(tr.at) || 0, b: String(b), n: Number(n) || 0 })))
    .sort((x, y) => y.at - x.at);
  const firstMoveAt = moves.length ? moves[moves.length - 1].at : null;

  const gap = {};
  for (const [b, n] of Object.entries(gaps || {})) if (n) gap[String(b)] = Number(n);

  const out = [];
  let k = 0;
  for (const p of [...(points || [])].sort((x, y) => y.at - x.at)) {
    // Un trade posterieur au releve n'avait pas encore eu lieu : on le defait.
    while (k < moves.length && moves[k].at > p.at) {
      const m = moves[k++];
      gap[m.b] = (gap[m.b] || 0) - m.n;
    }
    if (coveredFrom != null && p.at < coveredFrom) break;

    let dv = 0, dr = 0, dn = 0;
    if (firstMoveAt == null || p.at >= firstMoveAt) {
      for (const [b, n] of Object.entries(gap)) {
        if (!n) continue;
        const price = prices(b, p.at) || {};
        dv += n * (price.value || 0);
        dr += n * (price.rap || 0);
        dn += n;
      }
    }
    out.push({ at: p.at, dv: Math.round(dv), dr: Math.round(dr), dn });
  }

  while (k < moves.length) {
    const m = moves[k++];
    gap[m.b] = (gap[m.b] || 0) - m.n;
  }
  const unexplained = coveredFrom == null
    ? Object.fromEntries(Object.entries(gap).filter(([, n]) => n))
    : {};
  return { corrections: out.reverse(), unexplained, firstMoveAt };
}
