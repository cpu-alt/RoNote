/**
 * ==========================================================================
 *  LES VIGNETTES
 * --------------------------------------------------------------------------
 *  Un objet echange peut etre designe de trois facons, et chacune a son
 *  endpoint :
 *
 *    - un asset ordinaire        -> thumbnails/v1/assets
 *    - un bundle (visage, tenue) -> thumbnails/v1/bundles/thumbnails
 *    - un visage migre           -> les DEUX marchent, mais elles ne montrent
 *                                   pas la meme chose.
 *
 *  Pour un visage, le bundle rend une TETE en 3D (« DynamicHeadCostume ») ;
 *  l'ancien asset rend l'image plate du visage, celle que tout le monde
 *  reconnait et celle qu'affiche Rolimon's. On demande donc l'ancienne en
 *  premier, et la tete sert de repli.
 *
 *  D'ou l'interface : chaque objet fournit une LISTE ordonnee de candidats,
 *  et on rend la premiere image que Roblox a reellement rendue.
 *
 * --------------------------------------------------------------------------
 *  CE QUI RATE SILENCIEUSEMENT
 *
 *  Un identifiant inconnu ne provoque pas d'erreur HTTP : Roblox renvoie 200
 *  avec `state: "Error"` et l'URL d'un carre casse. Sans filtrage, cette
 *  image s'affiche comme une vignette normale. Le filtrage est dans api.js
 *  (`readThumbs`), et ici on memorise aussi les ECHECS — sinon les memes
 *  identifiants sont redemandes a chaque ouverture du popup.
 * ==========================================================================
 */
import { B } from './shim.js';
import { fetchAssetThumbs, fetchBundleThumbs } from './api.js';

const KEY = 'thumbs';
const TTL = 7 * 24 * 60 * 60 * 1000;    // les URL du CDN Roblox tournent
const NEG_TTL = 6 * 60 * 60 * 1000;     // un echec peut etre passager
const CAP = 4000;

export const assetKey  = (id) => 'a:' + id;
export const bundleKey = (id) => 'b:' + id;

let cache = null;
let dirty = false;
let loading = null;
let lastWrite = 0;

const WRITE_GAP = 3000;   // le cache complet pese quelques centaines de Ko

async function load() {
  if (cache) return;
  if (!loading) {
    loading = B.storage.local.get(KEY).then(got => { cache = got?.[KEY] || {}; });
  }
  await loading;
  loading = null;
}

/**
 * Ecrit le cache si besoin. Appele une fois par cycle, jamais par vignette.
 * Le popup charge les trades par lots de six : sans l'espacement, ouvrir le
 * popup reecrirait plusieurs centaines de kilo-octets cinq fois de suite. Perdre
 * quelques entrees au passage est sans consequence, elles seront redemandees.
 */
export async function flushThumbs({ force = false } = {}) {
  if (!dirty || !cache) return;
  const now = Date.now();
  if (!force && now - lastWrite < WRITE_GAP) return;
  lastWrite = now;
  dirty = false;
  const kept = Object.entries(cache)
    .sort((a, b) => (b[1].at || 0) - (a[1].at || 0))
    .slice(0, CAP);
  cache = Object.fromEntries(kept);
  await B.storage.local.set({ [KEY]: cache });
}

const fresh = (rec, now) => rec && (now - rec.at) < (rec.u ? TTL : NEG_TTL);

/**
 * @param lists  Array<string[]> — pour chaque objet, ses cles candidates
 *               ordonnees de la plus souhaitable a la moins ('a:123', 'b:456').
 * @returns Array<string|null> — meme longueur, l'URL retenue ou null.
 */
export async function resolveThumbs(lists) {
  await load();
  const now = Date.now();

  // 1) Ce qu'on ne sait pas encore, tous objets confondus.
  const missingAssets = new Set();
  const missingBundles = new Set();
  for (const keys of lists) {
    for (const k of keys || []) {
      if (fresh(cache[k], now)) {
        if (cache[k].u) break;          // deja resolu : les suivants sont inutiles
        continue;                        // echec connu : on essaie le candidat suivant
      }
      const id = Number(k.slice(2));
      if (!id) continue;
      (k[0] === 'b' ? missingBundles : missingAssets).add(id);
    }
  }

  // 2) Un seul aller-retour par type, les deux en parallele.
  if (missingAssets.size || missingBundles.size) {
    const [assets, bundles] = await Promise.all([
      missingAssets.size ? fetchAssetThumbs([...missingAssets]).catch(() => ({})) : {},
      missingBundles.size ? fetchBundleThumbs([...missingBundles]).catch(() => ({})) : {}
    ]);
    for (const id of missingAssets) cache[assetKey(id)] = { u: assets[String(id)] || '', at: now };
    for (const id of missingBundles) cache[bundleKey(id)] = { u: bundles[String(id)] || '', at: now };
    dirty = true;
  }

  // 3) Premier candidat resolu, dans l'ordre demande.
  return lists.map(keys => {
    for (const k of keys || []) {
      const url = cache[k]?.u;
      if (url) return url;
    }
    return null;
  });
}

/** Vide le cache (changement de compte, bouton « recharger les vignettes »). */
export async function clearThumbs() {
  cache = {};
  dirty = false;
  await B.storage.local.set({ [KEY]: {} });
}
