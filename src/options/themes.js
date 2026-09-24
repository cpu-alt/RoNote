/**
 * ==========================================================================
 *  LES THÈMES RONOTE
 * --------------------------------------------------------------------------
 *  Un thème règle d'un coup tout ce que RoNote ajoute sur Roblox : couleurs
 *  et style du bandeau des écarts, colonne des listes, badge « projected »,
 *  et fond des pages (image, voile, flou).
 *
 *  Les images de fond des thèmes ne sont pas des fichiers : elles sont
 *  peintes ici, sur un canvas, au moment d'appliquer le thème. L'extension
 *  reste légère et chaque fond est net à 1920 × 1080.
 *
 *  Un thème s'exporte dans un petit fichier JSON (réglages + images) pour
 *  être partagé, et s'importe de la même façon.
 * ==========================================================================
 */
import { DEFAULTS } from '../common/defaults.js';

/** Ce qu'un thème décide. Tout le reste des réglages lui est étranger. */
export const THEME_KEYS = ['bannerGain', 'bannerLoss', 'bannerStyle', 'bannerSize', 'listStyle', 'listGain', 'listLoss',
  'projectedColor', 'projectedShape', 'pageBgDim', 'pageBgBlur'];

const BG_W = 1920, BG_H = 1080;

/* ------------------------------- les fonds ------------------------------- */

function glow(g, x, y, r, color) {
  const h = g.createRadialGradient(x, y, 0, x, y, r);
  h.addColorStop(0, color); h.addColorStop(1, color.slice(0, 7) + '00');
  g.fillStyle = h; g.fillRect(0, 0, BG_W, BG_H);
}

const PAINT = {
  // Nuit synthwave : lueurs cyan et magenta, grille en perspective.
  neon(g) {
    const sky = g.createLinearGradient(0, 0, 0, BG_H);
    sky.addColorStop(0, '#06021a'); sky.addColorStop(0.6, '#1a0638'); sky.addColorStop(1, '#05010f');
    g.fillStyle = sky; g.fillRect(0, 0, BG_W, BG_H);
    glow(g, 420, 260, 640, '#00e5ff55'); glow(g, 1500, 380, 700, '#ff3d9a55');
    const hy = 640;
    g.strokeStyle = '#ff3d9a88'; g.lineWidth = 2;
    for (let i = -24; i <= 24; i++) { g.beginPath(); g.moveTo(BG_W / 2 + i * 22, hy); g.lineTo(BG_W / 2 + i * 190, BG_H); g.stroke(); }
    for (let k = 0; k < 14; k++) {
      const y = hy + Math.pow(k / 13, 2.2) * (BG_H - hy);
      g.strokeStyle = `rgba(0,229,255,${0.2 + k / 30})`; g.beginPath(); g.moveTo(0, y); g.lineTo(BG_W, y); g.stroke();
    }
    glow(g, BG_W / 2, hy, 900, '#ff3d9a33');
  },
  // Coucher de soleil : dégradé chaud, soleil rayé, montagnes en silhouette.
  sunset(g) {
    const sky = g.createLinearGradient(0, 0, 0, BG_H);
    sky.addColorStop(0, '#2b1055'); sky.addColorStop(0.45, '#d5436a'); sky.addColorStop(0.75, '#ff9f5a'); sky.addColorStop(1, '#ffd89b');
    g.fillStyle = sky; g.fillRect(0, 0, BG_W, BG_H);
    const sun = g.createLinearGradient(0, 380, 0, 780);
    sun.addColorStop(0, '#fff3b0'); sun.addColorStop(1, '#ff7a59');
    g.save(); g.beginPath(); g.arc(1260, 640, 230, 0, Math.PI * 2); g.clip();
    g.fillStyle = sun; g.fillRect(1000, 380, 520, 520);
    g.fillStyle = '#d5436a';
    for (let i = 0; i < 7; i++) g.fillRect(1000, 660 + i * 30, 520, 4 + i * 2.2);
    g.restore();
    const hills = [['#5a1d5e', [0, 820, 260, 640, 540, 760, 820, 600, 1100, 780, 1400, 640, 1700, 740, 1920, 660]],
      ['#2a0d3a', [0, 900, 300, 760, 640, 880, 980, 740, 1300, 900, 1620, 780, 1920, 860]]];
    for (const [color, pts] of hills) {
      g.fillStyle = color; g.beginPath(); g.moveTo(0, BG_H);
      for (let i = 0; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
      g.lineTo(BG_W, BG_H); g.closePath(); g.fill();
    }
  },
  // Océan profond : bleu nuit, rayons de lumière, vagues.
  ocean(g) {
    const sea = g.createLinearGradient(0, 0, 0, BG_H);
    sea.addColorStop(0, '#0b4f7a'); sea.addColorStop(0.5, '#062d52'); sea.addColorStop(1, '#020b1f');
    g.fillStyle = sea; g.fillRect(0, 0, BG_W, BG_H);
    for (let i = 0; i < 7; i++) {
      const x = 200 + i * 260;
      const ray = g.createLinearGradient(x, 0, x + 200, BG_H);
      ray.addColorStop(0, 'rgba(160,230,255,.16)'); ray.addColorStop(1, 'rgba(160,230,255,0)');
      g.fillStyle = ray; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 90, 0); g.lineTo(x + 420, BG_H); g.lineTo(x + 180, BG_H); g.closePath(); g.fill();
    }
    g.strokeStyle = 'rgba(76,201,240,.18)'; g.lineWidth = 3;
    for (let k = 0; k < 9; k++) {
      const y = 560 + k * 60;
      g.beginPath();
      for (let x = 0; x <= BG_W; x += 20) g.lineTo(x, y + Math.sin(x / 140 + k) * 14);
      g.stroke();
    }
    glow(g, 960, -100, 900, '#4cc9f033');
  },
  // Tapis de casino : feutre vert, vignette sombre, losanges dorés.
  casino(g) {
    g.fillStyle = '#0f5a38'; g.fillRect(0, 0, BG_W, BG_H);
    const felt = g.createRadialGradient(BG_W / 2, BG_H / 2, 100, BG_W / 2, BG_H / 2, 1200);
    felt.addColorStop(0, '#1b7a4e'); felt.addColorStop(0.6, '#0e5134'); felt.addColorStop(1, '#03170e');
    g.fillStyle = felt; g.fillRect(0, 0, BG_W, BG_H);
    g.strokeStyle = 'rgba(245,197,66,.10)'; g.lineWidth = 2;
    for (let x = -BG_H; x < BG_W; x += 80) {
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x + BG_H, BG_H); g.stroke();
      g.beginPath(); g.moveTo(x + BG_H, 0); g.lineTo(x, BG_H); g.stroke();
    }
    g.strokeStyle = 'rgba(245,197,66,.35)'; g.lineWidth = 6;
    g.beginPath(); g.ellipse(BG_W / 2, BG_H / 2, 820, 400, 0, 0, Math.PI * 2); g.stroke();
    g.lineWidth = 2; g.beginPath(); g.ellipse(BG_W / 2, BG_H / 2, 790, 375, 0, 0, Math.PI * 2); g.stroke();
  }
};

/** Le fond d'un thème en data: URL JPEG, prêt à ranger sous `pageBgImage`. */
export function paintBackground(kind) {
  const paint = PAINT[kind];
  if (!paint) return '';
  const c = Object.assign(document.createElement('canvas'), { width: BG_W, height: BG_H });
  paint(c.getContext('2d'));
  return c.toDataURL('image/jpeg', 0.86);
}

/* ------------------------------- les thèmes ------------------------------ */

const base = Object.fromEntries(THEME_KEYS.map(k => [k, DEFAULTS[k]]));

/**
 * `bg` : le fond peint (ou null = fond de Roblox). `swatch` : l'aperçu de la tuile.
 * Voile et flou : uniquement les valeurs des listes de la page (0/30/60/80 et 0/4/12).
 */
export const THEMES = [
  { id: 'ronote', name: 'RoNote', desc: 'Le style d’origine.', bg: null,
    swatch: 'linear-gradient(145deg,#1b2440,#0b1020)', settings: { ...base } },
  { id: 'minimal', name: 'Minimal', desc: 'Sobre, sans fond, petits chiffres.', bg: null,
    swatch: 'linear-gradient(145deg,#2a2f38,#15181d)',
    settings: { ...base, bannerGain: '#22c55e', bannerLoss: '#ef4444', bannerStyle: 'soft', bannerSize: 's',
      listStyle: 'text', listGain: '', listLoss: '', projectedColor: '#e5e7eb', projectedShape: 'square' } },
  { id: 'neon', name: 'Néon', desc: 'Nuit synthwave, couleurs électriques.', bg: 'neon',
    swatch: 'radial-gradient(circle at 25% 30%,#00e5ff66,transparent 55%),radial-gradient(circle at 80% 40%,#ff3d9a77,transparent 55%),linear-gradient(#06021a,#1a0638)',
    settings: { ...base, bannerGain: '#39ff9f', bannerLoss: '#ff3d9a', bannerStyle: 'neon', bannerSize: 'm',
      listStyle: 'neon', listGain: '', listLoss: '', projectedColor: '#00e5ff', projectedShape: 'circle', pageBgDim: 30, pageBgBlur: 0 } },
  { id: 'sunset', name: 'Sunset', desc: 'Dégradé chaud et soleil couchant.', bg: 'sunset',
    swatch: 'linear-gradient(#2b1055,#d5436a 55%,#ff9f5a)',
    settings: { ...base, bannerGain: '#ffd166', bannerLoss: '#ff5d73', bannerStyle: 'vivid', bannerSize: 'm',
      listStyle: 'soft', listGain: '', listLoss: '', projectedColor: '#ff9f1c', projectedShape: 'rounded', pageBgDim: 60, pageBgBlur: 0 } },
  { id: 'ocean', name: 'Océan', desc: 'Bleu profond et rayons de lumière.', bg: 'ocean',
    swatch: 'linear-gradient(#0b4f7a,#062d52 55%,#020b1f)',
    settings: { ...base, bannerGain: '#2ee6d6', bannerLoss: '#ff6b8b', bannerStyle: 'soft', bannerSize: 'm',
      listStyle: 'soft', listGain: '', listLoss: '', projectedColor: '#4cc9f0', projectedShape: 'rounded', pageBgDim: 30, pageBgBlur: 4 } },
  { id: 'casino', name: 'Casino', desc: 'Tapis vert et or, comme la pièce.', bg: 'casino',
    swatch: 'radial-gradient(circle,#1b7a4e,#073521)',
    settings: { ...base, bannerGain: '#f5c542', bannerLoss: '#e0314b', bannerStyle: 'solid', bannerSize: 'm',
      listStyle: 'vivid', listGain: '', listLoss: '', projectedColor: '#f5c542', projectedShape: 'circle', pageBgDim: 60, pageBgBlur: 0 } }
];

/** Le thème dont les réglages sont exactement ceux-ci, ou null (thème perso). */
export function matchTheme(settings) {
  return THEMES.find(th => THEME_KEYS.every(k => String(settings?.[k] ?? DEFAULTS[k]) === String(th.settings[k]))) || null;
}

/** Ne garde d'un fichier importé que ce qu'un thème a le droit de régler. */
export function themeFromFile(data) {
  if (!data || typeof data !== 'object' || data.kind !== 'ronote-theme' || typeof data.settings !== 'object') return null;
  const settings = {};
  for (const k of THEME_KEYS) {
    const v = data.settings[k];
    if (v !== undefined && typeof v === typeof DEFAULTS[k]) settings[k] = typeof v === 'string' ? v.slice(0, 40) : v;
  }
  const img = (v, max) => (typeof v === 'string' && /^data:image\/(png|jpeg|gif|webp);base64,/.test(v) && v.length < max ? v : '');
  return {
    name: typeof data.name === 'string' ? data.name.slice(0, 40) : '',
    settings,
    pageBgImage: 'pageBgImage' in data ? img(data.pageBgImage, 6e6) : undefined,
    projectedIcon: 'projectedIcon' in data ? img(data.projectedIcon, 2e6) : undefined
  };
}
