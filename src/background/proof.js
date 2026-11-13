/**
 * ==========================================================================
 *  SHARE PROOF (Elite) : LE PROOF AU FORMAT ROLIMONS, ENVOYÉ EN MP PAR RoOp Tracker
 * --------------------------------------------------------------------------
 *  Depuis le popup, sur un trade terminé de roblox.com/trades : la page dit ce
 *  qu'elle sait (content/trade-delta.js), le popup fait relire les cinq lignes
 *  que Rolimons demande (Item(s), Values, Sender, Receiver, Date), puis ici :
 *  capture de l'onglet (permission activeTab, donnée par le clic sur l'icône),
 *  découpée sur le trade (et la liste de gauche en mode proof, si demandé),
 *  compressée sous 63 Ko (Caddy refuse plus), envoyée à Neuronal avec le jeton
 *  premium. Neuronal revérifie Elite et la poste en MP au membre.
 *  Rien ne part sans ce clic : ni capture, ni envoi.
 * ==========================================================================
 */
import { B } from '../common/shim.js';
import { NEURONAL } from '../common/defaults.js';
import { getState, getHistory } from '../common/state.js';
import { premiumHeaders, premiumRetry } from './premium.js';

const MAX_BYTES = 63 * 1024;

/** Qui a envoyé ce trade ? Le journal le sait quand RoNote l'a vu passer (accepté par moi = c'est lui). */
async function senderGuess(info) {
  const [state, history] = await Promise.all([getState().catch(() => ({})), getHistory().catch(() => [])]);
  const me = (state.accounts || []).find(a => Number(a.id) === Number(state.userId))?.name || '';
  const id = Number(info.tradeId) || 0;
  const hit = (history || []).find(h => (id && Number(h.tradeId) === id) ||
    (!id && info.partner && String(h.partner || '').toLowerCase() === info.partner.toLowerCase() &&
      (h.kind === 'accepted_by_me' || h.kind === 'outbound_accepted')));
  const iSent = hit ? hit.kind === 'outbound_accepted' : false;
  return { me, sender: iSent ? me : info.partner, receiver: iSent ? info.partner : me };
}

/** Ce que l'onglet ouvert sait du trade terminé, et l'expéditeur deviné. */
export async function proofPrepare(tabId) {
  const info = await B.tabs.sendMessage(tabId, { type: 'ronote:proof-info' }).catch(() => null);
  if (!info?.ok) return { error: 'page' };
  return { ...info, ...(await senderGuess(info)) };
}

/** La capture découpée, en WebP de moins de MAX_BYTES (qualité, puis taille, revues à la baisse). */
async function shrink(dataUrl, frame) {
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const k = bmp.width / frame.vw;                         // pixels de l'image par pixel CSS
  const sx = Math.round(frame.x * k), sy = Math.round(frame.y * k);
  const sw = Math.max(1, Math.round(frame.w * k)), sh = Math.max(1, Math.round(frame.h * k));
  let scale = Math.min(1, 1600 / sw), quality = 0.9;
  for (let tries = 0; tries < 12; tries++) {
    const c = new OffscreenCanvas(Math.round(sw * scale), Math.round(sh * scale));
    c.getContext('2d').drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const blob = await c.convertToBlob({ type: 'image/webp', quality });
    if (blob.size <= MAX_BYTES) return blob;
    if (quality > 0.55) quality -= 0.1; else scale *= 0.85;
  }
  throw new Error('too_large');
}

const b64 = (text) => btoa(Array.from(new TextEncoder().encode(text), c => String.fromCharCode(c)).join(''));

/** Capture, compresse et envoie. `fields` : les cinq lignes relues dans le popup. */
export async function proofShare({ tabId, windowId, fields, list }) {
  const frame = await B.tabs.sendMessage(tabId, { type: 'ronote:proof-frame', list: !!list }).catch(() => null);
  if (!frame?.ok) return { error: 'page' };
  let shot;
  try {
    shot = await B.tabs.captureVisibleTab(windowId, { format: 'png' });
  } catch {
    return { error: 'capture' };
  } finally {
    B.tabs.sendMessage(tabId, { type: 'ronote:proof-restore' }).catch(() => {});
  }
  let image;
  try { image = await shrink(shot, frame); } catch { return { error: 'too_large' }; }
  for (let attempt = 0; attempt < 2; attempt++) {
    const headers = await premiumHeaders();
    if (!headers.Authorization) return { error: 'login' };
    let res;
    try {
      res = await fetch(NEURONAL.api + 'proof', {
        method: 'POST', credentials: 'omit', body: image,
        headers: { ...headers, 'Content-Type': image.type, 'X-RoNote': B.runtime.getManifest?.().version || '1', 'X-Proof': b64(JSON.stringify(fields)) }
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
