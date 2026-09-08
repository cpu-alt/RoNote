/**
 * ==========================================================================
 *  LE PORTEFEUILLE, RECONCILIE
 * --------------------------------------------------------------------------
 *  Rolimon's publie LA valeur d'un compte — celle que lit toute la communaute
 *  du trade. On la garde comme base, parce que la recalculer soi-meme
 *  sous-compte : Rolimon's valorise en interne des UGC limiteds qu'il ne
 *  publie pas dans son catalogue public.
 *
 *  Mais depuis la conversion des visages en bundles DynamicHead, cette valeur
 *  est fausse dans les deux sens, et personne ne le corrige :
 *
 *  1. LES FANTOMES.  Un visage echange laisse derriere lui son ancien
 *     exemplaire dans l'inventaire Roblox. Rolimon's continue donc de le
 *     compter alors que le joueur ne l'a plus. Sa valeur est comptee en trop.
 *
 *  2. LES ABSENTS.   Un visage RECU arrive sous forme de bundle. Ni
 *     l'inventaire des collectibles ni Rolimon's ne le voient. Sa valeur
 *     manque au total.
 *
 *  Le juge de paix est le meme dans les deux cas : `catalog/users/{id}/bundles`.
 *  C'est le bundle qui est reellement echange, donc c'est lui qui dit ce que
 *  le joueur possede. On ne compare pas les inventaires en vrac — on compare,
 *  visage par visage, ce que Rolimon's compte et ce que le joueur possede :
 *
 *      valeur corrigee = valeur Rolimon's − fantomes + visages absents
 *
 *  Le pont entre les deux mondes (ancien assetId <-> bundleId) vient de
 *  roli.js. Chaque ligne est rendue a l'interface avec son nom et sa cote :
 *  un chiffre corrige sans le detail de la correction ne serait pas verifiable.
 * ==========================================================================
 */
import * as api from './api.js';
import { readEntry } from './roli.js';

/** Ce que Rolimon's compte, ce que le joueur possede, et l'ecart entre les deux. */
export async function buildPortfolio(userId, cat) {
  const at = Date.now();
  const base = {
    at, userId: Number(userId) || 0,
    ok: false, partial: false, reason: '',
    private: false, terminated: false,
    rolimons: null,
    ghosts: [], extras: [],
    ghostValue: 0, ghostRap: 0, extraValue: 0, extraRap: 0,
    value: 0, rap: 0, rank: 0,
    ownedFaces: 0, countedItems: 0, holds: 0
  };
  if (!base.userId) return { ...base, reason: 'utilisateur inconnu' };

  const [infoR, assetsR, bundlesR] = await Promise.allSettled([
    api.getPlayerInfo(userId),
    api.getPlayerAssets(userId),
    api.getUserBundles(userId)
  ]);

  const info = infoR.status === 'fulfilled' ? infoR.value : null;
  const counted = assetsR.status === 'fulfilled' ? assetsR.value : null;
  const owned = bundlesR.status === 'fulfilled' ? bundlesR.value : null;

  if (!info) {
    return { ...base, reason: String(infoR.reason?.message || "profil Rolimon's injoignable") };
  }
  if (info.terminated) return { ...base, terminated: true, reason: 'compte supprimé' };
  if (info.private || counted?.private) {
    return {
      ...base, private: true, rolimons: info,
      value: info.value, rap: info.rap, rank: info.rank,
      reason: 'inventaire privé — Rolimon\'s ne publie rien'
    };
  }

  const out = {
    ...base,
    ok: true,
    rolimons: info,
    rank: info.rank,
    value: info.value,
    rap: info.rap,
    countedItems: counted ? Object.values(counted.counts).reduce((s, n) => s + n, 0) : 0,
    holds: counted?.holds?.length || 0
  };

  // Sans l'une des deux sources, la reconciliation n'a pas de sens : on rend
  // les chiffres de Rolimon's tels quels plutot qu'une correction a moitie faite.
  if (!counted || !owned) {
    out.partial = true;
    out.reason = !counted ? "inventaire Rolimon's indisponible" : 'bundles Roblox indisponibles';
    return out;
  }

  return reconcile(out, info, counted, owned, cat);
}

/**
 * La partie qui compte, isolee du reseau pour pouvoir etre testee sur de
 * vraies donnees.
 *
 * @param out      squelette de rapport deja rempli des chiffres de Rolimon's
 * @param info     profil Rolimon's  { value, rap, ... }
 * @param counted  ce que Rolimon's compte  { counts: {assetId: n}, holds }
 * @param owned    bundles reellement possedes  [{ id, name, bundleType }]
 * @param cat      catalogue (roli.js) avec le pont faceOf / bundleOf
 */
export function reconcile(out, info, counted, owned, cat) {
  const bundles = cat?.bundles || {};
  const assets = cat?.assets || {};
  const faceOf = cat?.faceOf || {};
  const bundleOf = cat?.bundleOf || {};

  // Les bundles COTES que le joueur possede. Les autres (bundles gratuits,
  // tenues sans valeur marchande) ne pesent rien dans un portefeuille.
  const ownedLimited = new Map();
  for (const b of owned) {
    const id = String(b.id);
    if (!bundles[id]) continue;
    ownedLimited.set(id, (ownedLimited.get(id) || 0) + 1);
  }
  out.ownedFaces = [...ownedLimited.values()].reduce((s, n) => s + n, 0);

  // --- 1. les fantomes : comptes par Rolimon's, plus possedes -------------
  for (const [assetId, n] of Object.entries(counted.counts)) {
    const bundleId = bundleOf[assetId];
    if (!bundleId) continue;                       // pas un visage migre : hors sujet
    const have = ownedLimited.get(String(bundleId)) || 0;
    const excess = n - have;
    if (excess <= 0) continue;
    const e = readEntry(assets[assetId]) || readEntry(bundles[String(bundleId)]);
    if (!e) continue;
    out.ghosts.push({
      assetId: Number(assetId), bundleId: Number(bundleId), legacyAssetId: Number(assetId),
      name: e.name, count: excess, value: e.value, rap: e.rap,
      total: e.value * excess
    });
    out.ghostValue += e.value * excess;
    out.ghostRap += e.rap * excess;
  }

  // --- 2. les absents : possedes, invisibles chez Rolimon's ---------------
  for (const [bundleId, have] of ownedLimited) {
    const legacy = faceOf[bundleId] || '';
    const seen = legacy ? (counted.counts[legacy] || 0) : 0;
    const missing = have - seen;
    if (missing <= 0) continue;
    const e = readEntry(bundles[bundleId]) || (legacy ? readEntry(assets[legacy]) : null);
    if (!e) continue;
    out.extras.push({
      bundleId: Number(bundleId), legacyAssetId: Number(legacy) || 0,
      name: e.name, count: missing, value: e.value, rap: e.rap,
      total: e.value * missing
    });
    out.extraValue += e.value * missing;
    out.extraRap += e.rap * missing;
  }

  out.ghosts.sort((a, b) => b.total - a.total);
  out.extras.sort((a, b) => b.total - a.total);

  out.value = Math.max(0, info.value - out.ghostValue + out.extraValue);
  out.rap = Math.max(0, info.rap - out.ghostRap + out.extraRap);
  out.delta = out.value - info.value;
  out.corrected = out.ghosts.length > 0 || out.extras.length > 0;
  return out;
}

/** Squelette de rapport, expose pour les tests. */
export function emptyReport(userId) {
  return {
    at: Date.now(), userId: Number(userId) || 0,
    ok: true, partial: false, reason: '',
    private: false, terminated: false,
    rolimons: null,
    ghosts: [], extras: [],
    ghostValue: 0, ghostRap: 0, extraValue: 0, extraRap: 0,
    value: 0, rap: 0, rank: 0,
    ownedFaces: 0, countedItems: 0, holds: 0
  };
}

/** Ce qu'il faut demander a thumbs.js pour illustrer la reconciliation. */
export function portfolioThumbKeys(report) {
  const lines = [...(report?.ghosts || []), ...(report?.extras || [])];
  return lines.map(l => {
    const keys = [];
    if (l.legacyAssetId) keys.push('a:' + l.legacyAssetId);
    if (l.bundleId) keys.push('b:' + l.bundleId);
    if (l.assetId && l.assetId !== l.legacyAssetId) keys.push('a:' + l.assetId);
    return keys;
  });
}

/** Recolle les URL rendues par `resolveThumbs` sur les lignes du rapport. */
export function attachPortfolioThumbs(report, urls) {
  const lines = [...(report?.ghosts || []), ...(report?.extras || [])];
  lines.forEach((l, i) => { l.thumb = urls[i] || null; });
  return report;
}
