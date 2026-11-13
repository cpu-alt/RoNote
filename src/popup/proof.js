/**
 * ==========================================================================
 *  SHARE PROOF (Elite) : LA FICHE DU POPUP
 * --------------------------------------------------------------------------
 *  Sur un trade terminé ouvert dans l'onglet : les cinq lignes que Rolimons
 *  demande, pré-remplies depuis la page et modifiables, une case pour mettre
 *  la liste de gauche dans la capture (pseudos cachés par le mode proof), et
 *  l'envoi : capture, Neuronal, MP de RoOp Tracker (background/proof.js).
 * ==========================================================================
 */
import { B } from '../common/shim.js';
import { escapeHtml } from '../common/utils.js';
import { t } from '../common/i18n.js';
import { ic } from '../common/icons.js';
import { send } from '../common/ui.js';
import { openOverlay, releaseFocus } from './overlay.js';

const FIELDS = [['items', 'Item(s)'], ['values', 'Values'], ['sender', 'Sender'], ['receiver', 'Receiver'], ['date', 'Date']];
const ERRORS = {
  page: "Ouvre un trade terminé (Completed) sur roblox.com/trades, puis rouvre RoNote.",
  capture: "Capture impossible : clique l'icône RoNote sur l'onglet du trade, puis réessaie.",
  subscribe: 'Réservé aux membres Elite de Neuronal.',
  login: 'Connecte RoNote à Discord (Réglages › Premium).',
  link: 'Lie ton compte Roblox dans Réglages › Premium.',
  dm_closed: 'Tes MP sont fermés : autorise les messages de RoOp Tracker sur Discord.',
  tracker_offline: 'RoOp Tracker est hors ligne : réessaie dans une minute.',
  too_large: 'Capture trop lourde : réduis la fenêtre ou décoche la liste.',
  rate_limited: 'Trop de proofs cette heure : réessaie plus tard.',
  bad_date: 'Date attendue au format MM/JJ/AAAA.'
};

/** 62316 → « 62.3k », comme les proofs de Rolimons. */
export function shortValue(n) {
  n = Number(n) || 0;
  for (const [d, s] of [[1e6, 'M'], [1e3, 'k']]) if (n >= d) return (n / d).toFixed(1).replace(/\.0$/, '') + s;
  return String(Math.round(n));
}

/** Les cinq champs pré-remplis depuis ce que la page sait. */
export function proofDefaults(info) {
  return {
    items: `${info.give.join(' + ')} for ${info.get.join(' + ')}`,
    values: info.values ? `${shortValue(info.values[0])} vs ${shortValue(info.values[1])}` : '',
    sender: info.sender || '', receiver: info.receiver || '', date: info.date || ''
  };
}

let sheet = null;
function close() { sheet?.remove(); sheet = null; releaseFocus(); }

function shell(body, foot = '') {
  return `<div class="zoom-card w-sheet" role="dialog" aria-modal="true" aria-label="${escapeHtml(t('Partager un proof'))}">
    <header class="z-head"><div class="head"><div class="who"><div class="n">${ic('check-circle')} ${t('Partager un proof')}</div>
      <div class="t">${t('au format de Rolimons, envoyé en MP par RoOp Tracker')}</div></div></div>
      <button class="z-close" title="${t('Fermer')}">${ic('x')}</button></header>
    <div class="z-body pf-body">${body}</div><div class="z-msg" hidden></div>${foot}</div>`;
}

function say(text, err = false) {
  const m = sheet?.querySelector('.z-msg');
  if (!m) return;
  m.hidden = !text; m.textContent = text || ''; m.className = 'z-msg' + (err ? ' err' : '');
}

export async function openProofSheet() {
  sheet = openOverlay(shell(`<p class="pf-note">${t('Lecture du trade…')}</p>`), close);
  const [tab] = await Promise.resolve().then(() => B.tabs.query({ active: true, currentWindow: true })).catch(() => []);
  const status = await send({ type: 'ronote:premium-status' }).catch(() => null);
  if (!sheet) return;
  if (!status?.me?.features?.proof) {
    sheet.querySelector('.pf-body').innerHTML = `<p class="pf-note">${ic('lock')} ${escapeHtml(t(ERRORS[status?.signedIn ? 'subscribe' : 'login']))}</p>`;
    return;
  }
  const info = tab ? await send({ type: 'ronote:proof-prepare', tabId: tab.id }).catch(() => null) : null;
  if (!sheet) return;
  if (!info?.ok) { sheet.querySelector('.pf-body').innerHTML = `<p class="pf-note">${escapeHtml(t(ERRORS.page))}</p>`; return; }
  const v = proofDefaults(info);
  const form = FIELDS.map(([k, label]) => `<label class="pf-row"><span>${label}</span>
      <input data-f="${k}" value="${escapeHtml(v[k])}" maxlength="${k === 'items' ? 300 : 80}" spellcheck="false">
      ${k === 'receiver' ? `<button class="pf-swap" data-swap title="${escapeHtml(t('Inverser Sender et Receiver'))}">${ic('swap')}</button>` : ''}</label>`).join('');
  const body = `${form}
    <label class="pf-check"><input type="checkbox" data-list> ${t('Ajouter la liste des trades (les autres pseudos cachés par le mode proof)')}</label>
    <pre class="pf-preview" aria-label="${escapeHtml(t('Aperçu'))}"></pre>
    <p class="pf-note">${t("La capture montre ce qui est visible dans l'onglet : fais défiler pour que le trade soit en entier.")}</p>`;
  const old = sheet; sheet = null; old.remove();
  sheet = openOverlay(shell(body, `<footer class="z-foot"><button class="z-close">${t('Annuler')}</button>
    <button class="z-accept" data-send>${ic('send')} ${t('Envoyer dans mes MP')}</button></footer>`), close);
  const fields = () => Object.fromEntries(FIELDS.map(([k]) => [k, sheet.querySelector(`[data-f="${k}"]`).value.trim()]));
  const preview = () => { sheet.querySelector('.pf-preview').textContent = FIELDS.map(([k, l]) => `${l}: ${fields()[k]}`).join('\n') + '\n\n<screenshot>'; };
  preview();
  sheet.addEventListener('input', preview);
  sheet.addEventListener('click', async (e) => {
    if (e.target.closest('[data-swap]')) {
      const s = sheet.querySelector('[data-f="sender"]'), r = sheet.querySelector('[data-f="receiver"]');
      [s.value, r.value] = [r.value, s.value]; preview(); return;
    }
    const btn = e.target.closest('[data-send]');
    if (!btn || btn.disabled) return;
    btn.disabled = true; say(t('Capture et envoi…'));
    const res = await send({ type: 'ronote:proof-share', tabId: tab.id, windowId: tab.windowId, fields: fields(),
      list: sheet.querySelector('[data-list]').checked }).catch(() => ({ error: 'network' }));
    if (!sheet) return;
    btn.disabled = false;
    if (res?.ok) say(t('Envoyé : regarde tes MP de RoOp Tracker sur Discord.'));
    else say(t(ERRORS[res?.error] || 'Envoi impossible ({why}).', { why: res?.error || '?' }), true);
  });
}
