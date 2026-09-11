/**
 * ==========================================================================
 *  LES ICONES DE RONOTE
 * --------------------------------------------------------------------------
 *  Un seul jeu, dessine pour RoNote : grille de 24, trait de 2, extremites
 *  arrondies, et la couleur du texte qui l'entoure (`currentColor`). Une icone
 *  « perte » dans un texte rouge est rouge, sans rien de plus a ecrire.
 *
 *  Pourquoi pas des emojis : leur dessin change d'un systeme a l'autre (et
 *  d'une version de Windows a l'autre), leur taille ne suit pas le texte, et
 *  ils ne prennent jamais la couleur du verdict.
 *
 *  Les notifications du systeme, elles, restent en texte : Windows n'y
 *  affiche aucune image dans le titre.
 * ==========================================================================
 */

const path = (d, extra = '') => `<path d="${d}"${extra}/>`;
const FILL = ' fill="currentColor" stroke="none"';
const circle = (cx, cy, r, extra = '') => `<circle cx="${cx}" cy="${cy}" r="${r}"${extra}/>`;

export const ICONS = {
  /* --- trades --------------------------------------------------------- */
  inbox: path('M3 13h5l1.5 3h5L16 13h5') + path('M5.5 5h13L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-5z'),
  send: path('M21 3 10.5 13.5') + path('M21 3 14.5 21l-4-7.5L3 9.5z'),
  'check-circle': circle(12, 12, 9) + path('m8 12.3 2.8 2.8 5.2-5.6'),
  party: path('M4 20 8.5 8l7.5 7.5z') + path('M13.5 6.5c.4-1.6 1.8-2.5 3.3-2')
    + path('M17.5 10.5c1.4-.8 3-.4 3.7.8') + path('M15 3.2v.3M20.8 6.8h-.3M19.5 14.5l.3.3'),
  'x-circle': circle(12, 12, 9) + path('m9 9 6 6M15 9l-6 6'),
  counter: path('M20 11.5a8 8 0 0 0-14.2-4.3L4 9') + path('M4 4.5V9h4.5')
    + path('M4 12.5a8 8 0 0 0 14.2 4.3L20 15') + path('M20 19.5V15h-4.5'),
  clock: circle(12, 12, 9) + path('M12 7.5V12l3 2'),
  alert: path('M12 3.5 21.5 20h-19z') + path('M12 10v4M12 17v.2'),
  ban: circle(12, 12, 9) + path('M5.7 5.7l12.6 12.6'),
  pin: path('M9 3.5h6l-1 5.5 3 3.2v2.3H7v-2.3L10 9z') + path('M12 14.5V21'),
  reply: path('M9.5 7.5 4.5 12.5l5 5') + path('M4.5 12.5H14a6 6 0 0 1 6 6'),
  swap: path('M4 8.5h15') + path('m15.5 5 3.5 3.5-3.5 3.5') + path('M20 15.5H5') + path('m8.5 12-3.5 3.5L8.5 19'),

  /* --- verdicts ------------------------------------------------------- */
  flame: path('M12 21c-3.9 0-6.9-2.7-6.9-6.5 0-2.9 1.8-4.8 3.4-6.4.3 1.9 1.4 2.9 2.4 2.9 0-2.9 1-5.8 3.9-7.9.5 3 4.3 5.7 4.3 11C19.1 18 16 21 12 21z'),
  dot: circle(12, 12, 5.5, FILL),
  skull: path('M12 3a8 8 0 0 0-5 14.2v3.3h10v-3.3A8 8 0 0 0 12 3z')
    + circle(9, 11.5, 1.7, FILL) + circle(15, 11.5, 1.7, FILL) + path('M10.5 20.5v-2M13.5 20.5v-2'),
  help: circle(12, 12, 9) + path('M9.3 9.4a2.8 2.8 0 0 1 5.4 1c0 1.9-2.7 2.4-2.7 4.1') + path('M12 17.4v.2'),

  /* --- cotes et tendances --------------------------------------------- */
  'trend-up': path('m3 16.5 6-6 4 4 8-8') + path('M15 6.5h6v6'),
  'trend-down': path('m3 7.5 6 6 4-4 8 8') + path('M15 17.5h6v-6'),
  'trend-flat': path('M3.5 12h16') + path('m15.5 7.5 4.5 4.5-4.5 4.5'),
  zigzag: path('m3 14.5 4-7 4.5 9 4.5-9 5 7'),
  wave: path('M2.5 12c1.8-3.6 3.7-3.6 5.5 0s3.7 3.6 5.5 0 3.7-3.6 5.5 0c.8 1.6 1.7 2.4 2.5 2.4'),
  'caret-up': path('M12 5.5 20.5 18h-17z', FILL),
  'caret-down': path('M12 18.5 3.5 6h17z', FILL),
  scale: path('M12 4v16M8 20h8M5 7.5h14') + path('M5 7.5 2.5 13a2.6 2.6 0 0 0 5 0z') + path('M19 7.5 16.5 13a2.6 2.6 0 0 0 5 0z'),
  revised: path('m16.5 3 3.5 3.5-3.5 3.5') + path('M4 11V9.5a3 3 0 0 1 3-3h13')
    + path('m7.5 21-3.5-3.5L7.5 14') + path('M20 13v1.5a3 3 0 0 1-3 3H4'),
  percent: path('M18.5 5.5l-13 13') + circle(7, 7, 2.3) + circle(17, 17, 2.3),
  face: circle(12, 12, 9) + path('M9 10v.2M15 10v.2') + path('M8.5 14.5a5 5 0 0 0 7 0'),
  star: path('m12 3.2 2.7 5.5 6 .9-4.35 4.25 1 6L12 17l-5.35 2.85 1-6L3.3 9.6l6-.9z', FILL),
  box: '<rect x="5" y="5" width="14" height="14" rx="3"/>',

  /* --- interface ------------------------------------------------------ */
  x: path('M6 6l12 12M18 6 6 18'),
  check: path('m5 12.5 4.5 4.5L19 7.5'),
  chevron: path('m6.5 9.5 5.5 5.5 5.5-5.5'),
  external: path('M14 4h6v6') + path('M20 4l-8.5 8.5') + path('M18.5 13.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6.5a1 1 0 0 1 1-1h5.5'),
  pause: '<rect x="6.5" y="5" width="4" height="14" rx="1.2"' + FILL + '/><rect x="13.5" y="5" width="4" height="14" rx="1.2"' + FILL + '/>',
  play: path('M8 5.2v13.6c0 .8.9 1.3 1.6.8l10-6.8a1 1 0 0 0 0-1.6l-10-6.8C8.9 3.9 8 4.4 8 5.2z', FILL),
  refresh: path('M20 12a8 8 0 1 1-2.6-5.9') + path('M20 4.5v5h-5'),
  settings: path('M4 7h9M17 7h3M4 17h3M11 17h9') + circle(15, 7, 2.2) + circle(9, 17, 2.2),
  eye: path('M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z') + circle(12, 12, 2.8),
  'eye-off': path('M10.6 5.6c.5-.1.9-.1 1.4-.1 6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.8 3.6M6.5 7.2A16 16 0 0 0 2.5 12s3.5 6.5 9.5 6.5c1.7 0 3.2-.5 4.5-1.2')
    + path('M9.9 10a2.8 2.8 0 0 0 4.1 4') + path('M3.5 3.5l17 17'),
  grid: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/>'
    + '<rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>',
  list: path('M9 6.5h11M9 12h11M9 17.5h11') + path('M4.5 6.5v.1M4.5 12v.1M4.5 17.5v.1'),
  journal: '<rect x="5" y="3" width="14" height="18" rx="2.5"/>' + path('M9 8h6M9 12h6M9 16h3.5'),

  /* --- sections des reglages ------------------------------------------ */
  bell: path('M6.5 16.5v-5.5a5.5 5.5 0 0 1 11 0v5.5l1.8 1.5H4.7z') + path('M10 20.5a2.1 2.1 0 0 0 4 0'),
  volume: path('M4 9.5v5h3.5l5 4V5.5l-5 4z') + path('M16 9.2a4 4 0 0 1 0 5.6M18.8 6.5a8 8 0 0 1 0 11'),
  chart: path('M4 20.5h16') + path('M7 17v-6M12 17V6.5M17 17v-9'),
  filter: path('M3.5 5h17l-6.5 7.5v5.5l-4 2.5v-8z'),
  moon: path('M19.5 14.6A7.9 7.9 0 1 1 9.4 4.5a6.4 6.4 0 0 0 10.1 10.1z'),
  'user-off': circle(10, 8, 3.8) + path('M3.5 20.5a6.8 6.8 0 0 1 10.5-5.6') + path('m16.5 15.5 5 5M21.5 15.5l-5 5'),
  pulse: path('M3 12.5h4l2.5-6 5 11.5 2.5-5.5h4'),
  tool: path('M14.7 3.8a5 5 0 0 0-4.1 6.8L3.8 17.4a1.9 1.9 0 0 0 2.8 2.8l6.8-6.8a5 5 0 0 0 6.8-4.1l-3 .9-2.1-2.1z')
};

/** Une icone, prete a inserer en HTML. Nom inconnu : rien. */
export function ic(name, cls = '') {
  const body = ICONS[name];
  if (!body) return '';
  return `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
}

/** Les emplacements ecrits en dur dans une page : `<i data-ic="nom"></i>`. */
export function fillIcons(root = document) {
  root.querySelectorAll('[data-ic]').forEach(el => {
    if (!el.querySelector('svg')) el.innerHTML = ic(el.dataset.ic);
  });
}
