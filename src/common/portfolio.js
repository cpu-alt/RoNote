/**
 * ==========================================================================
 *  LE PORTEFEUILLE
 * --------------------------------------------------------------------------
 *  Rolimon's publie LA valeur d'un compte — celle que lit toute la communaute
 *  du trade. On la prend telle quelle, parce que la recalculer soi-meme
 *  sous-compte : Rolimon's valorise en interne des UGC limiteds qu'il ne
 *  publie pas dans son catalogue public.
 *
 *  Jusqu'en septembre 2026, cette valeur etait fausse pour les visages
 *  convertis en bundles DynamicHead (visages echanges encore comptes,
 *  visages recus invisibles), et RoNote la corrigeait en croisant les
 *  bundles Roblox du joueur. Rolimon's compte desormais les visages d'apres
 *  les bundles reellement possedes : sa valeur est juste, et la correction
 *  n'a plus lieu d'etre. Il continue de les lister sous leur ANCIEN assetId,
 *  que le pont de roli.js rattache a leur bundle (voir revalue.js).
 *
 *  Deux appels a Rolimon's, aucun a Roblox : le profil (valeur, RAP, rang)
 *  et l'inventaire, qui donne la liste des objets.
 * ==========================================================================
 */
import * as api from './api.js';
import { readEntry } from './roli.js';
import { holdingsOf, revisionFor } from './revalue.js';

/** Les chiffres de Rolimon's et la liste des objets du compte. */
export async function buildPortfolio(userId, cat) {
  const base = emptyReport(userId);
  base.ok = false;
  if (!base.userId) return { ...base, reason: 'utilisateur inconnu' };

  const [infoR, assetsR] = await Promise.allSettled([
    api.getPlayerInfo(userId),
    api.getPlayerAssets(userId)
  ]);
  const info = infoR.status === 'fulfilled' ? infoR.value : null;
  const counted = assetsR.status === 'fulfilled' ? assetsR.value : null;

  if (!info) {
    return { ...base, reason: String(infoR.reason?.message || "profil Rolimon's injoignable") };
  }
  if (info.terminated) return { ...base, terminated: true, reason: 'compte supprimé' };
  if (info.private || counted?.private) {
    return {
      ...base, private: true, rolimons: info,
      value: info.value, rap: info.rap, rank: info.rank,
      reason: "inventaire privé — Rolimon's ne publie rien"
    };
  }
  return fromRolimons(base, info, counted, cat);
}

/**
 * Le rapport, isole du reseau pour pouvoir etre teste sur de vraies donnees.
 *
 * @param out      squelette de rapport (emptyReport)
 * @param info     profil Rolimon's  { value, rap, rank }
 * @param counted  ce que Rolimon's compte  { counts: {assetId: n}, holds, scannedAt }  (ou null)
 * @param cat      catalogue (roli.js) avec le pont faceOf / bundleOf
 */
export function fromRolimons(out, info, counted, cat) {
  const report = {
    ...out,
    ok: true,
    rolimons: info,
    rank: info.rank,
    value: info.value,
    rap: info.rap,
    countedItems: counted ? Object.values(counted.counts).reduce((s, n) => s + n, 0) : 0,
    holds: counted?.holds?.length || 0,
    // Date du dernier releve de la courbe Rolimon's : la page qui la porte
    // n'est relue que si ce releve est plus recent que la serie gardee.
    chartScannedAt: counted?.scannedAt || 0,
    // Ce que le joueur detient, sous les cles des revisions de cote : c'est ce
    // que croise l'alerte de reevaluation. `null` si l'inventaire n'a pas
    // repondu, pour ne pas confondre « rien possede » et « rien su ».
    holdings: counted ? holdingsOf(counted, cat) : null
  };
  // Les memes objets, prets a afficher : la liste de l'onglet Portefeuille.
  Object.assign(report, portfolioItems(report.holdings, cat));
  if (!counted) {
    report.partial = true;
    report.reason = "inventaire Rolimon's indisponible";
  }
  return report;
}

/** Squelette de rapport, expose pour les tests. */
export function emptyReport(userId) {
  return {
    at: Date.now(), userId: Number(userId) || 0,
    ok: true, partial: false, reason: '',
    private: false, terminated: false,
    rolimons: null,
    value: 0, rap: 0, rank: 0,
    countedItems: 0, holds: 0,
    holdings: null,
    items: [], unrated: 0
  };
}

/**
 * Les objets du portefeuille, une ligne par objet : ce que l'onglet
 * Portefeuille liste, trie et filtre. Construit sur `holdings` : un visage
 * y figure sous son bundle, avec l'image plate de son ancien asset.
 *
 * Un objet que le catalogue public de Rolimon's ne cote pas (certains UGC
 * limiteds) n'a ni nom ni cote a montrer : il est compte dans `unrated`.
 *
 * @param holdings  rendu de holdingsOf  { 'a:<assetId>': n, 'b:<bundleId>': n }
 * @param cat       catalogue (roli.js), revisions de cote comprises
 * @returns {{ items: object[], unrated: number }}  items du plus gros total au plus petit
 */
export function portfolioItems(holdings, cat) {
  const assets = cat?.assets || {};
  const bundles = cat?.bundles || {};
  const faceOf = cat?.faceOf || {};
  const bundleOf = cat?.bundleOf || {};
  const items = [];
  let unrated = 0;

  for (const [key, n] of Object.entries(holdings || {})) {
    const count = Number(n) || 0;
    if (count <= 0) continue;
    const bundle = key.startsWith('b:');
    const id = key.slice(2);
    // Ancien asset du visage : c'est son image plate et sa page Rolimon's.
    const face = bundle ? (faceOf[id] || '') : (bundleOf[id] ? id : '');
    const e = bundle
      ? readEntry(bundles[id]) || (face ? readEntry(assets[face]) : null)
      : readEntry(assets[id]);
    if (!e) { unrated += count; continue; }

    items.push({
      key, kind: bundle ? 'bundle' : 'asset', id: Number(id),
      faceAssetId: Number(face) || 0, isFace: !!face,
      name: e.name, acronym: e.acronym,
      value: e.value, rap: e.rap, noValue: e.noValue,
      demand: e.demand, trend: e.trend, projected: e.projected, rare: e.rare,
      count, total: e.value * count, totalRap: e.rap * count,
      change: revisionFor(cat?.changes, key, cat)
    });
  }

  items.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return { items, unrated };
}

/** Toutes les lignes illustrees du rapport, dans un ordre fixe. */
const reportLines = (report) => report?.items || [];

/**
 * Ce qu'il faut demander a thumbs.js pour illustrer le rapport. Pour un visage,
 * l'ancienne image plate passe avant la tete 3D du bundle (voir thumbs.js).
 */
export function portfolioThumbKeys(report) {
  return reportLines(report).map(l => {
    const keys = [];
    if (l.faceAssetId) keys.push('a:' + l.faceAssetId);
    if (l.key) keys.push(l.key);
    return [...new Set(keys)];
  });
}

/** Recolle les URL rendues par `resolveThumbs` sur les lignes du rapport. */
export function attachPortfolioThumbs(report, urls) {
  reportLines(report).forEach((l, i) => { l.thumb = urls[i] || null; });
  return report;
}
