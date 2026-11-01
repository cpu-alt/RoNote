/**
 * ==========================================================================
 *  SURVOL FLUIDE
 * --------------------------------------------------------------------------
 *  Inspire de Fluid Functionalism : au lieu que chaque bouton s'allume dans
 *  son coin, une seule pastille par groupe glisse de l'un a l'autre sous le
 *  pointeur. On voit d'ou l'on vient et ou l'on va.
 *
 *  - Elle ne bouge qu'en `transform` : le compositeur s'en charge, rien
 *    n'est repeint pendant la glissade.
 *  - En entrant dans un groupe, elle apparait sur place (fondu) au lieu de
 *    traverser depuis sa derniere position ; dans un vide, elle s'efface.
 *  - Le clavier la deplace aussi (`:focus-visible`), comme la souris.
 *
 *  Les listes redessinees en `innerHTML` emportent leur pastille : elle est
 *  recreee au premier survol, dans le parent direct de l'element survole.
 * ==========================================================================
 */

/** Branche le survol fluide sur `root`, pour les elements qui repondent a `selector`. */
export function fluidHover(root, selector) {
  if (!root) return;
  const itemOf = (node) => {
    const el = node?.closest?.(selector);
    return el && root.contains(el) ? el : null;
  };

  root.addEventListener('pointerover', (e) => {
    const el = itemOf(e.target);
    if (el) light(el);
  });
  root.addEventListener('pointerout', (e) => {
    const el = itemOf(e.target);
    if (!el || el.contains(e.relatedTarget)) return;
    // Vers un voisin du meme groupe : `pointerover` va la faire glisser. L'eteindre
    // ici la ferait reapparaitre sur place au lieu de glisser.
    const next = itemOf(e.relatedTarget);
    if (next && next.parentElement === el.parentElement) return;
    off(el.parentElement);
  });
  root.addEventListener('focusin', (e) => {
    const el = itemOf(e.target);
    if (el && el.matches(':focus-visible')) light(el);
  });
  root.addEventListener('focusout', (e) => {
    const el = itemOf(e.target);
    if (el) off(el.parentElement);
  });
}

function pad(host) {
  let p = host.querySelector(':scope > .fh');
  if (!p) {
    p = document.createElement('span');
    p.className = 'fh';
    p.setAttribute('aria-hidden', 'true');
    host.prepend(p);
    host.classList.add('fh-host');
  }
  return p;
}

function light(el) {
  const p = pad(el.parentElement);
  const fresh = !p.classList.contains('on');
  // Premiere pose : pas de glissade depuis l'ancienne place, seulement le fondu.
  if (fresh) p.classList.add('snap');
  p.style.width = el.offsetWidth + 'px';
  p.style.height = el.offsetHeight + 'px';
  p.style.transform = `translate(${el.offsetLeft}px, ${el.offsetTop}px)`;
  p.style.borderRadius = getComputedStyle(el).borderRadius;
  if (fresh) {
    void p.offsetWidth;   // la position est posee avant de rendre la transition
    p.classList.remove('snap');
  }
  p.classList.add('on');
}

function off(host) {
  host?.querySelector(':scope > .fh')?.classList.remove('on');
}
