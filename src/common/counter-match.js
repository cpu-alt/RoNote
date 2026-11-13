/**
 * ==========================================================================
 *  RETROUVER LES OBJETS D'UN TRADE DANS UN INVENTAIRE
 * --------------------------------------------------------------------------
 *  L'editeur de contre-offre repart du trade recu et doit retrouver chaque
 *  objet dans l'inventaire charge, pour en avoir l'identifiant d'exemplaire
 *  v2 (seul identifiant que Roblox accepte a l'envoi d'une contre-offre).
 *
 *  L'inventaire est la liste v2 des objets echangeables (`tradableItems`) :
 *  visages, UGC et doublons compris, identifiant d'exemplaire = UUID v2.
 *  Un objet n'est declare « plus la » (`gone`) que si on en est SUR : la liste
 *  est complete et ne le contient pas. Sinon (liste tronquee, limite de debit),
 *  il reste en place, marque `unsure` : c'est Roblox qui tranchera a l'envoi.
 *  (Avec l'ancien inventaire v1, visages et UGC n'y etaient jamais : ils
 *  passaient « plus dans l'inventaire » a tort.)
 * ==========================================================================
 */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Cle d'objet (asset ou bundle) : la meme pour le trade et l'inventaire. */
export function itemKeys(i) {
  const keys = [];
  if (num(i?.assetId)) keys.push('a' + num(i.assetId));
  if (num(i?.legacyAssetId)) keys.push('a' + num(i.legacyAssetId));
  if (num(i?.bundleId)) keys.push('b' + num(i.bundleId));
  return keys;
}

const sameItem = (x, y) => {
  const kx = itemKeys(x);
  return itemKeys(y).some(k => kx.includes(k));
};

/**
 * @param chosen  objets du trade d'origine (uaid peut etre un id v2)
 * @param side    { items, complete, absent: [cle d'objet], checked: [cle] } ou un tableau
 */
export function adopt(chosen, side) {
  const s = Array.isArray(side) ? { items: side } : (side || {});
  const inventory = s.items || [];
  const list = (chosen || []).map(c => ({ ...c, uaid: num(c.uaid) || c.uaid }));
  if (!inventory.length && !s.complete && !s.absent?.length) return list;
  const absent = new Set(s.absent || []);
  const used = new Set();
  // Les exemplaires exacts d'abord, pour ne pas les « voler » a un doublon.
  const exact = list.map(c => {
    const id = c.uaid == null || c.uaid === '' ? '' : String(c.uaid);
    const hit = id && inventory.find(i => String(i.uaid) === id);
    if (hit) used.add(hit.uaid);
    return hit || null;
  });
  return list.map((c, n) => {
    if (exact[n]) return exact[n];
    const free = (i) => !used.has(i.uaid) && sameItem(i, c);
    const serial = num(c.serial);
    const hit = (serial && inventory.find(i => free(i) && num(i.serial) === serial)) || inventory.find(free);
    if (hit) { used.add(hit.uaid); return hit; }
    const sure = itemKeys(c).some(k => absent.has(k)) || !!s.complete;
    const { gone, unsure, ...rest } = c;
    return sure ? { ...rest, gone: true } : { ...rest, unsure: true };
  });
}
