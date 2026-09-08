/**
 * Pont entre le monde de la page (hook.js) et le service worker.
 * Ne fait que transmettre : aucune logique, aucune modification de la page.
 *
 * TOUT EST DANS UNE FONCTION, ET CE N'EST PAS COSMETIQUE : les scripts de
 * contenu d'une meme extension partagent le meme espace global dans le monde
 * isole. Deux fichiers qui declarent `const B` au niveau superieur, et le
 * second ne s'execute JAMAIS — « Identifier 'B' has already been declared »,
 * le fichier entier est perdu avant sa premiere ligne. Le seul canal entre
 * fichiers reste `globalThis.RoNote*`, pose explicitement.
 */
(() => {
const B = globalThis.browser ?? globalThis.chrome;

window.addEventListener('message', (e) => {
  if (e.source !== window) return;
  const d = e.data;
  if (!d || typeof d !== 'object') return;

  try {
    if (d.__ronote === 'trade-detail' && d.tradeId && d.detail) {
      B.runtime.sendMessage({ type: 'ronote:captured-trade', tradeId: d.tradeId, detail: d.detail });
    } else if (d.__ronote === 'csrf' && d.token) {
      B.runtime.sendMessage({ type: 'ronote:csrf', token: d.token });
    }
  } catch { /* extension rechargee : le message est simplement perdu */ }
});

// Lit aussi le jeton present dans la page au chargement.
try {
  const meta = document.querySelector('meta[name="csrf-token"]');
  if (meta?.content) B.runtime.sendMessage({ type: 'ronote:csrf', token: meta.content });
} catch { /* ignore */ }
})();
