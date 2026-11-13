/**
 * La petite fenêtre « Autoriser les captures » (Partager un proof, Elite). Chrome ne laisse demander une
 * permission que depuis une page de l'extension, sur un clic : le panneau proof ouvre donc cette fenêtre.
 * Accordée, elle prévient l'onglet du trade (le panneau renvoie tout seul) et se ferme.
 */
import { B } from '../common/shim.js';

const fr = (navigator.language || '').startsWith('fr');
const TEXT = fr ? {
  title: 'Autoriser les captures', why: 'Une seule fois : RoNote pourra ensuite capturer le trade pour ton proof sans rien demander. Chrome va afficher sa fenêtre de permission : accepte.',
  allow: 'Autoriser', done: 'C’est bon : le proof part, tu peux revenir sur Roblox.', refused: 'Refusé. Tu peux réessayer, ou utiliser le partage d’onglet du panneau.'
} : {
  title: 'Allow screenshots', why: 'Only once: RoNote can then capture the trade for your proof without asking. Chrome will show its permission window: accept it.',
  allow: 'Allow', done: 'Done: the proof is being sent, you can go back to Roblox.', refused: 'Refused. Try again, or use tab sharing in the panel.'
};
const $ = (id) => document.getElementById(id);
// Chargé à vide par tools/selftest.js : rien à faire sans la page.
if ($('allow')) {
  $('title').textContent = TEXT.title;
  $('why').textContent = TEXT.why;
  $('allow').textContent = TEXT.allow;
  const tabId = Number(new URLSearchParams(location.search).get('tab')) || 0;

  $('allow').addEventListener('click', async () => {
    const ok = await B.permissions.request({ origins: ['<all_urls>'] }).catch(() => false);
    $('msg').className = ok ? '' : 'err';
    $('msg').textContent = ok ? TEXT.done : TEXT.refused;
    if (!ok) return;
    if (tabId) B.tabs.sendMessage(tabId, { type: 'ronote:proof-retry' }).catch(() => {});
    setTimeout(() => window.close(), 1200);
  });
}
