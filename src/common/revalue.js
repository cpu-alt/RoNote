/**
 * ==========================================================================
 *  REEVALUATION DES OBJETS POSSEDES
 * --------------------------------------------------------------------------
 *  Rolimon's revise ses cotes regulierement. roli.js compare deja chaque
 *  nouvelle table a la precedente et garde 7 jours de revisions (`changes`),
 *  mais ne s'en servait que pour marquer 🔁 les objets d'un trade. Ici, on
 *  croise ces revisions avec ce que le joueur possede reellement.
 *
 *  Module pur (aucune API navigateur, aucun reseau) : il se teste tel quel.
 *
 *  Deux pieges, regles ici plutot que dans le service worker :
 *
 *  1. LES VISAGES.  Un visage possede est un bundle, que Rolimon's liste sous
 *     son ancien asset ; sa revision peut etre publiee sous l'id du bundle
 *     (`b:`) ou sous l'ancien asset (`a:`). On prend l'une OU l'autre, jamais
 *     les deux : sinon une seule revision donnerait deux alertes.
 *
 *  2. LE REPERE.  Une revision est datee du rafraichissement qui l'a vue. On
 *     n'alerte que sur ce qui est posterieur au repere, et le repere avance
 *     jusqu'a la plus recente revision CONNUE — possedee ou non. Sans ca, un
 *     objet achete apres coup ferait remonter une revision vieille de 6 jours.
 * ==========================================================================
 */
import { readEntry } from './roli.js';

/**
 * Ce que le joueur detient, sous les memes cles que `changes`.
 *
 * Depuis sa mise a jour de septembre 2026, Rolimon's compte les visages
 * d'apres les bundles reellement possedes, mais les liste toujours sous
 * leur ANCIEN assetId. On les range sous leur bundle : c'est la fiche que
 * cote la table v3, et la cle sous laquelle leurs revisions sont publiees.
 *
 * @param counted  ce que Rolimon's compte  { counts: {assetId: n} }  (ou null)
 * @param cat      catalogue (roli.js) : `bundles` et le pont `bundleOf`
 * @returns        { 'a:<assetId>': n, 'b:<bundleId>': n }
 */
export function holdingsOf(counted, cat) {
  const assets = cat?.assets || {};
  const bundles = cat?.bundles || {};
  const bundleOf = cat?.bundleOf || {};
  const out = {};
  for (const [assetId, n] of Object.entries(counted?.counts || {})) {
    const count = Number(n) || 0;
    if (count <= 0) continue;
    const bundleId = bundleOf[assetId];
    // Un bundle limited qui n'est pas un visage (The Jade Catseye) n'a pas
    // d'ancien asset : s'il est liste, c'est sous son propre id de bundle.
    const key = bundleId && bundles[bundleId] ? 'b:' + bundleId
      : !assets[assetId] && bundles[assetId] ? 'b:' + assetId
      : 'a:' + assetId;
    out[key] = (out[key] || 0) + count;
  }
  return out;
}

/** Date de la revision la plus recente connue, possedee ou non (0 si aucune). */
export function newestRevision(changes) {
  let newest = 0;
  for (const c of Object.values(changes || {})) {
    const at = Number(c?.at) || 0;
    if (at > newest) newest = at;
  }
  return newest;
}

/**
 * La revision connue d'un objet detenu : sous sa propre cle, sinon sous celle
 * de son jumeau (un visage peut etre revise sous l'id de son bundle comme sous
 * son ancien asset). `null` si rien n'a bouge.
 */
export function revisionFor(changes, key, cat) {
  const all = changes || {};
  if (all[key]) return all[key];
  const sep = key.indexOf(':');
  const prefix = key.slice(0, sep);
  const id = key.slice(sep + 1);
  const twin = prefix === 'b'
    ? (cat?.faceOf?.[id] ? 'a:' + cat.faceOf[id] : null)
    : (cat?.bundleOf?.[id] ? 'b:' + cat.bundleOf[id] : null);
  return (twin && all[twin]) || null;
}

/**
 * Les revisions qui concernent un objet possede, posterieures au repere.
 *
 * @param changes   revisions de roli.js  { cle: {from, to, pct, at} }
 * @param holdings  rendu de holdingsOf
 * @param cat       catalogue, pour le nom et le pont visage <-> bundle
 * @param since     repere : seules les revisions strictement posterieures comptent
 * @param minPct    variation minimale, en valeur absolue
 * @returns { hits, latest }  hits du plus gros impact au plus petit ; latest = nouveau repere
 */
export function detectRevaluations(changes, holdings, cat, { since = 0, minPct = 10 } = {}) {
  const all = changes || {};
  const mark = Number(since) || 0;
  const threshold = Math.max(0, Number(minPct) || 0);

  const latest = Math.max(mark, newestRevision(all));

  const hits = [];
  for (const [key, n] of Object.entries(holdings || {})) {
    const count = Number(n) || 0;
    const sep = key.indexOf(':');
    const prefix = key.slice(0, sep);
    const id = key.slice(sep + 1);
    if (count <= 0 || !id) continue;

    const change = revisionFor(all, key, cat);
    if (!change || !((Number(change.at) || 0) > mark)) continue;
    if (!Number.isFinite(change.pct) || Math.abs(change.pct) < threshold) continue;

    const entry = prefix === 'b' ? readEntry(cat?.bundles?.[id]) : readEntry(cat?.assets?.[id]);
    hits.push({
      key, kind: prefix === 'b' ? 'bundle' : 'asset', id: Number(id),
      name: entry?.name || '#' + id,
      from: change.from, to: change.to, pct: change.pct, at: change.at,
      count, delta: (change.to - change.from) * count
    });
  }
  hits.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return { hits, latest };
}
