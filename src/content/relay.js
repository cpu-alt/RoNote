/**
 * Pont entre le monde de la page (hook.js) et le service worker.
 * Ne fait que transmettre : aucune logique, aucune modification de la page.
 *
 * TOUT EST DANS UNE FONCTION, ET CE N'EST PAS COSMETIQUE : les scripts de
 * contenu d'une meme extension partagent le meme espace global dans le monde
 * isole. Deux fichiers qui declarent `const B` au niveau superieur, et le
 * second ne s'execute JAMAIS : « Identifier 'B' has already been declared »,
 * le fichier entier est perdu avant sa premiere ligne. Le seul canal entre
 * fichiers reste `globalThis.RoNote*`, pose explicitement.
 */
(() => {
const B = globalThis.browser ?? globalThis.chrome;

window.addEventListener('message', (e) => {
  if (e.source !== window || e.origin !== location.origin) return;
  const d = e.data;
  if (!d || typeof d !== 'object') return;

  try {
    if (d.__ronote === 'trade-detail' && d.tradeId && d.detail) {
      Promise.resolve(B.runtime.sendMessage({ type: 'ronote:captured-trade', tradeId: d.tradeId, detail: d.detail }))
        .then(() => { if (typeof globalThis.dispatchEvent === 'function') globalThis.dispatchEvent(new Event('ronote:detail-ready')); })
        .catch(() => {});
    } else if (d.__ronote === 'csrf' && d.token) {
      Promise.resolve(B.runtime.sendMessage({ type: 'ronote:csrf', token: d.token })).catch(() => {});
    }
  } catch { /* extension rechargee : le message est simplement perdu */ }
});

// Lit aussi le jeton present dans la page. Ce script demarre avant que le
// <head> soit lu : la balise n'existe qu'une fois le document analyse.
const readMeta = () => {
  try {
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta?.content) Promise.resolve(B.runtime.sendMessage({ type: 'ronote:csrf', token: meta.content })).catch(() => {});
    // Le compte connecte sur cette page : RoNote s'apercoit tout de suite d'un
    // changement de compte, au lieu d'attendre de redemander son identite.
    const user = document.querySelector('meta[name="user-data"]');
    const uid = Number(user?.dataset?.userid);
    if (uid) Promise.resolve(B.runtime.sendMessage({ type: 'ronote:page-user', userId: uid })).catch(() => {});
  } catch { /* ignore */ }
};
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', readMeta, { once: true });
else readMeta();
})();
