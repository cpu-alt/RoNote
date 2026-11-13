/**
 * ==========================================================================
 *  SHARE PROOF (Elite) : LE PROOF AU FORMAT ROLIMONS, ENVOYÉ EN MP PAR RoOp Tracker
 * --------------------------------------------------------------------------
 *  Le panneau vient de la page des trades (content/trade-delta.js : le bouclier
 *  du mode proof l'ouvre à droite, la liste de gauche se cache). Ici :
 *   - `proofPrepare` : les cinq lignes que Rolimons demande (Item(s), Values,
 *     Sender, Receiver, Date), les items nommés par le catalogue (acronyme,
 *     sinon nom propre : le texte de la page traîne des séries et des RAP), et
 *     si le membre a la fonction Elite ;
 *   - `proofShare` : la capture de l'onglet (captureVisibleTab, qui demande
 *     `activeTab` : un clic sur l'icône de RoNote dans cet onglet), ou l'image
 *     que la page a prise elle-même (partage d'onglet de Chrome) quand ce n'est
 *     pas possible ; découpée, compressée sous 63 Ko (Caddy refuse plus),
 *     envoyée à Neuronal avec le jeton premium. Neuronal revérifie Elite et la
 *     poste en MP au membre. Rien ne part sans le clic sur Send.
 * ==========================================================================
 */
import { B } from '../common/shim.js';
import { NEURONAL } from '../common/defaults.js';
import { getState, getHistory, getSettings } from '../common/state.js';
import { getCatalog, readEntry } from '../common/roli.js';
import { premiumHeaders, premiumRetry, premiumStatus } from './premium.js';

const MAX_BYTES = 63 * 1024;

/** 62316 → « 62.3k », comme les proofs de Rolimons. */
export function shortValue(n) {
  n = Number(n) || 0;
  for (const [d, s] of [[1e6, 'M'], [1e3, 'k']]) if (n >= d) return (n / d).toFixed(1).replace(/\.0$/, '') + s;
  return String(Math.round(n));
}

/** Le nom d'un objet pour Rolimons : son acronyme, sinon son nom au catalogue, sinon le texte de la page nettoyé. */
export function itemLabel(item, cat) {
  const entry = readEntry(cat?.bundles?.[String(item.bundleId || 0)] || cat?.assets?.[String(item.assetId || 0)]
    || cat?.assets?.[String(item.legacyAssetId || 0)]);
  return entry?.acronym || entry?.name || String(item.name || '').replace(/^(?:#\d+\s*)+/, '').trim() || '?';
}

/** Les cinq champs pré-remplis. `labels` : [ce que je donne, ce que je reçois], déjà nommés. */
export function proofDefaults({ labels, values, sender, receiver, date }) {
  return {
    items: `${labels[0].join(' + ')} for ${labels[1].join(' + ')}`,
    values: values ? `${shortValue(values[0])} vs ${shortValue(values[1])}` : '',
    sender: sender || '', receiver: receiver || '', date: date || ''
  };
}

/** Qui a envoyé ce trade ? Le journal le sait quand RoNote l'a vu passer (accepté par moi = c'est lui). */
async function senderGuess(info) {
  const [state, history] = await Promise.all([getState().catch(() => ({})), getHistory().catch(() => [])]);
  const me = (state.accounts || []).find(a => Number(a.id) === Number(state.userId))?.name || '';
  const id = Number(info.tradeId) || 0;
  const hit = (history || []).find(h => (id && Number(h.tradeId) === id) ||
    (!id && info.partner && String(h.partner || '').toLowerCase() === info.partner.toLowerCase() &&
      (h.kind === 'accepted_by_me' || h.kind === 'outbound_accepted')));
  const iSent = hit ? hit.kind === 'outbound_accepted' : false;
  return { sender: iSent ? me : info.partner, receiver: iSent ? info.partner : me };
}

/** Ce que la page sait du trade terminé (proofInfo de trade-delta.js) → les champs, et l'accès Elite. */
export async function proofPrepare(info) {
  const [status, cat] = await Promise.all([premiumStatus().catch(() => null), getSettings().then(getCatalog).catch(() => null)]);
  const side = (s) => [...s.items.map(i => itemLabel(i, cat)), ...(s.robux ? [`R$${s.robux}`] : [])];
  return {
    elite: !!status?.me?.features?.proof, signedIn: !!status?.signedIn,
    fields: proofDefaults({ labels: [side(info.give), side(info.get)], values: info.values, date: info.date, ...(await senderGuess(info)) })
  };
}

/** La capture découpée, en WebP de moins de MAX_BYTES (qualité, puis taille, revues à la baisse). */
async function shrink(dataUrl, frame) {
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const k = bmp.width / frame.vw;                         // pixels de l'image par pixel CSS
  const sx = Math.round(frame.x * k), sy = Math.round(frame.y * k);
  const sw = Math.max(1, Math.min(bmp.width - sx, Math.round(frame.w * k))), sh = Math.max(1, Math.min(bmp.height - sy, Math.round(frame.h * k)));
  let scale = Math.min(1, 1600 / sw), quality = 0.9;
  for (let tries = 0; tries < 14; tries++) {
    const c = new OffscreenCanvas(Math.round(sw * scale), Math.round(sh * scale));
    c.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const blob = await c.convertToBlob({ type: 'image/webp', quality });
    if (blob.size <= MAX_BYTES) return blob;
    if (quality > 0.55) quality -= 0.1; else scale *= 0.85;
  }
  throw new Error('too_large');
}

const b64 = (text) => btoa(Array.from(new TextEncoder().encode(text), c => String.fromCharCode(c)).join(''));

/**
 * Capture (ou l'image de la page), compresse et envoie. `frame` : la zone, en pixels CSS de l'onglet ;
 * `image` : une capture déjà prise par la page (dataURL), sinon on capture l'onglet de `tab`.
 */
export async function proofShare({ fields, frame, image }, tab) {
  let shot = image;
  if (!shot) {
    try {
      shot = await B.tabs.captureVisibleTab(tab?.windowId, { format: 'png' });
    } catch (e) {
      return { error: 'capture', detail: String(e?.message || e).slice(0, 200) };
    }
  }
  let blob;
  try { blob = await shrink(shot, frame); } catch { return { error: 'too_large' }; }
  for (let attempt = 0; attempt < 2; attempt++) {
    const headers = await premiumHeaders();
    if (!headers.Authorization) return { error: 'login' };
    let res;
    try {
      res = await fetch(NEURONAL.api + 'proof', {
        method: 'POST', credentials: 'omit', body: blob,
        headers: { ...headers, 'Content-Type': blob.type, 'X-RoNote': B.runtime.getManifest?.().version || '1', 'X-Proof': b64(JSON.stringify(fields)) }
      });
    } catch {
      return { error: 'network' };
    }
    if (res.ok) return { ok: true };
    const reason = (await res.json().catch(() => ({})))?.error || 'http_' + res.status;
    if (res.status === 401 && attempt === 0 && await premiumRetry(reason)) continue;
    return { error: reason };
  }
  return { error: 'login' };
}
