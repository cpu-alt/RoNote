/**
 * ==========================================================================
 *  LE CODE DE VÉRIFICATION EN DEUX ÉTAPES (accepter un trade)
 * --------------------------------------------------------------------------
 *  Roblox peut exiger la 2SV avant d'accepter : le service worker rend alors
 *  `{ twoStep: { key, media } }`. `askTwoStepCode` ouvre une petite fenêtre
 *  par-dessus le popup (le zoom du trade reste derrière), demande le code,
 *  le fait vérifier (`ronote:2sv`) et rend la réponse finale de l'action :
 *  `{ ok }`, une erreur, ou `{ cancelled: true }`.
 *  La contre-offre a son propre panneau, dans l'éditeur (counter.js), avec
 *  les mêmes styles (.tsv-*).
 * ==========================================================================
 */
import { send } from '../common/ui.js';
import { t } from '../common/i18n.js';
import { ic } from '../common/icons.js';
import { escapeHtml } from '../common/utils.js';

const TEXT = {
  authenticator: () => t("Entre le code à 6 chiffres de ton application d'authentification."),
  email: () => t('Roblox vient de t’envoyer un code par e-mail.'),
  sms: () => t('Roblox vient de t’envoyer un code par SMS.')
};

export function askTwoStepCode({ key, media }) {
  return new Promise((resolve) => {
    const back = document.activeElement;
    const wrap = document.createElement('div');
    wrap.className = 'tsv-modal';
    wrap.innerHTML = `<div class="tsv tsv-box" role="dialog" aria-modal="true" aria-label="${escapeHtml(t('Vérification en deux étapes'))}">
      <div class="tsv-head">${ic('lock')}<div><b>${t('Vérification en deux étapes')}</b>
        <span>${escapeHtml((TEXT[media] || TEXT.authenticator)())}</span></div></div>
      <div class="tsv-row">
        <input class="tsv-code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6"
          placeholder="000000" aria-label="${escapeHtml(t('Code de vérification'))}">
        <button class="tsv-ok" type="button">${t('Valider')}</button>
      </div>
      <div class="tsv-foot">
        <span class="tsv-err" role="alert"></span>
        ${media === 'email' || media === 'sms' ? `<button class="tsv-link" type="button" data-resend>${t('Renvoyer le code')}</button>` : ''}
        <button class="tsv-link" type="button" data-cancel>${t('Annuler')}</button>
      </div></div>`;
    document.body.appendChild(wrap);
    const input = wrap.querySelector('.tsv-code'), ok = wrap.querySelector('.tsv-ok'), err = wrap.querySelector('.tsv-err');
    let busy = false;
    const done = (res) => { wrap.remove(); if (back?.isConnected) back.focus?.(); resolve(res); };
    const setBusy = (on) => {
      busy = on;
      input.disabled = on; ok.disabled = on;
      ok.textContent = on ? t('Vérification…') : t('Valider');
      wrap.querySelectorAll('.tsv-link').forEach(b => { b.disabled = on; });
    };
    async function submit() {
      if (busy) return;
      const code = input.value.replace(/\D/g, '');
      if (code.length < 6) { err.textContent = t('Le code fait 6 chiffres.'); return; }
      setBusy(true); err.textContent = '';
      const res = await send({ type: 'ronote:2sv', key, code }).catch((e) => ({ error: String(e?.message || e) }));
      setBusy(false);
      if (res?.badCode) { err.textContent = t('Code incorrect, réessaie.'); input.select(); input.focus(); return; }
      if (res?.error === 'expired') { done({ error: t('La vérification a expiré : recommence.') }); return; }
      done(res);
    }
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 6);
      err.textContent = '';
      if (input.value.length === 6) submit();
    });
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !busy) { e.stopPropagation(); done({ cancelled: true }); }
      if (e.key === 'Enter' && e.target === input) { e.preventDefault(); submit(); }
    });
    ok.addEventListener('click', submit);
    wrap.querySelector('[data-cancel]').addEventListener('click', () => !busy && done({ cancelled: true }));
    wrap.querySelector('[data-resend]')?.addEventListener('click', async (e) => {
      const b = e.currentTarget;
      const res = await send({ type: 'ronote:2sv', key, resend: true }).catch(() => null);
      if (res?.ok) b.textContent = t('Code renvoyé'); else err.textContent = t('Impossible de renvoyer le code.');
    });
    // Un clic à côté ne ferme pas : on ne perd pas un code à moitié tapé.
    input.focus();
  });
}
