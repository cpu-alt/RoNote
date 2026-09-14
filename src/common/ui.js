/**
 * ==========================================================================
 *  LE PEU QUE LE POPUP ET LES REGLAGES PARTAGENT
 * --------------------------------------------------------------------------
 *  Deux pages, deux mises en page, aucun composant commun — mais les memes
 *  trois gestes en tete de fichier : trouver un noeud, parler au service
 *  worker, appliquer la langue au gabarit. Ils vivent ici plutot qu'en double.
 *
 *  Rien de visuel dans ce module : le style de chaque page lui appartient.
 * ==========================================================================
 */
import { B } from './shim.js';
import { setLang, translateDom } from './i18n.js';

export const $ = (sel, root = document) => root.querySelector(sel);

export const send = (msg) => B.runtime.sendMessage(msg);

/**
 * Le service worker MV3 dort entre deux verifications. Un message parti juste
 * avant son reveil revient `undefined`, et la page qui l'attendait restait
 * figee sans un mot. Une relance, puis on rend `null` : a l'appelant de le dire.
 */
export async function ask(msg, tries = 2) {
  for (let n = 0; n < tries; n++) {
    // `send` peut aussi jeter tout de suite (page hors extension, worker
    // detruit) : le meme filet vaut pour les deux cas.
    const res = await Promise.resolve().then(() => send(msg)).catch(() => null);
    if (res) return res;
    await new Promise(done => setTimeout(done, 250));
  }
  return null;
}

/**
 * La langue appliquee au gabarit HTML.
 *
 * Les pages sont ecrites en francais et `translateDom` remplace en place : ce
 * n'est jouable qu'une fois. Changer de langue repart donc d'une page neuve.
 * Rend `false` quand le rechargement est lance — l'appelant s'arrete la.
 */
let domLang = null;
export function applyLang(setting, onFirst = null) {
  const lang = setLang(setting);
  if (domLang === null) {
    domLang = lang;
    translateDom(document);
    onFirst?.();
    return true;
  }
  if (domLang !== lang) {
    location.reload();
    return false;
  }
  return true;
}

/**
 * Le stockage local a change. Les ecritures d'une verification arrivent en
 * rafale : on les regroupe plutot que de redessiner cinq fois de suite.
 */
export function onStoredChange(keys, ms, fn) {
  let timer = null;
  B.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local') return;
    const hit = keys.filter(k => changes[k]);
    if (!hit.length) return;
    clearTimeout(timer);
    const values = {};
    for (const k of hit) values[k] = changes[k].newValue;
    timer = setTimeout(() => fn(values), ms);
  });
}

/** La tuile « un libelle, un chiffre, une precision » des deux pages. */
export const factHtml = (label, value, sub = '') =>
  `<div class="w-fact"><span>${label}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
