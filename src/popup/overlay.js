/**
 * ==========================================================================
 *  LES SURCOUCHES DU POPUP
 * --------------------------------------------------------------------------
 *  Zoom sur un trade, fiche d'un objet, objectif, cartes a partager : une
 *  seule surcouche a la fois (#zoom), refermee par un clic a cote ou par sa
 *  croix. La fiche d'un joueur, elle, glisse sur le cote mais garde le meme
 *  soin du focus.
 * ==========================================================================
 */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
const focusReturn = [];   // une pile : une fiche peut s'ouvrir par-dessus un zoom

/**
 * Une surcouche prend le focus a l'ouverture, le garde tant qu'elle est la, et
 * le rend a son declencheur en partant. Sans ca, le clavier restait derriere
 * elle, dans une liste toujours tabulable : « Refuser le trade » n'etait
 * atteignable qu'en traversant tout le reste.
 */
export function captureFocus(root, firstSel) {
  focusReturn.push(document.activeElement);
  (root.querySelector(firstSel) || root).focus?.();
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const items = [...root.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement);
    const to = e.shiftKey
      ? (at <= 0 ? items.length - 1 : at - 1)
      : (at < 0 || at === items.length - 1 ? 0 : at + 1);
    items[to].focus();
  });
}

/** Rend le focus a l'element qui avait ouvert la surcouche, s'il est encore la. */
export function releaseFocus() {
  const back = focusReturn.pop();
  if (back?.isConnected) back.focus?.();
}

/**
 * Ouvre la surcouche avec `html`, a la place de celle d'avant s'il y en avait
 * une. Le clic a cote et la croix (.z-close) appellent `onClose`. Le focus
 * part sur la croix ; `focus: false` laisse l'appelant le poser lui-meme,
 * quand le contenu se monte apres coup.
 */
export function openOverlay(html, onClose, { focus = true } = {}) {
  document.getElementById('zoom')?.remove();
  const wrap = document.createElement('div');
  wrap.className = 'zoom';
  wrap.id = 'zoom';
  wrap.innerHTML = html;
  document.body.appendChild(wrap);
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap || e.target.closest('.z-close')) onClose();
  });
  if (focus) captureFocus(wrap, '.z-close');
  return wrap;
}
