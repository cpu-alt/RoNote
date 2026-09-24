/**
 * ==========================================================================
 *  FONDS DES CARTES FLEX
 * --------------------------------------------------------------------------
 *  Derrière la carte « Mon inventaire » ou le bilan du mois : le fond RoNote,
 *  une image fixe (les fonds des thèmes), un fond animé dessiné ici même, ou
 *  l'image / le GIF de l'utilisateur.
 *
 *  Un fond animé est une fonction du temps t ∈ [0, 1[ qui boucle parfaitement
 *  (t = 1 redonne t = 0) : c'est ce qui permet d'en tirer un GIF sans saut.
 *  Les GIF importés sont découpés image par image avec ImageDecoder
 *  (Chrome) ; sans lui (Firefox), seule la première image est gardée.
 *
 *  Choix rangé sous `flexBg` : { id } pour un fond fourni, { id: 'custom',
 *  data } pour une image importée (data: URL).
 * ==========================================================================
 */
import { paintBackground } from '../options/themes.js';

const TAU = Math.PI * 2;

/* ------------------------------ fonds animés ----------------------------- */

// Pseudo-hasard stable : les mêmes étoiles à chaque image, donc une boucle propre.
function seeded(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

const ANIMATED = {
  aurora(g, w, h, t) {
    const bg = g.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#040a1c'); bg.addColorStop(1, '#0a0620');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'lighter';
    const bands = [['#2fd07055', 0], ['#4d9fff55', 1.7], ['#b05cff44', 3.4]];
    for (const [color, phase] of bands) {
      g.beginPath();
      for (let x = 0; x <= w; x += 12) {
        const y = h * 0.42 + Math.sin(x / w * TAU * 1.5 + t * TAU + phase) * h * 0.12 + Math.sin(x / w * TAU * 3 - t * TAU * 2 + phase) * h * 0.04;
        x ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.lineTo(w, h * 0.9); g.lineTo(0, h * 0.9); g.closePath();
      const f = g.createLinearGradient(0, h * 0.25, 0, h * 0.9);
      f.addColorStop(0, color); f.addColorStop(1, color.slice(0, 7) + '00');
      g.fillStyle = f; g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  },
  stars(g, w, h, t) {
    g.fillStyle = '#03050d'; g.fillRect(0, 0, w, h);
    const halo = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.8);
    halo.addColorStop(0, '#1b2a5a66'); halo.addColorStop(1, '#03050d00');
    g.fillStyle = halo; g.fillRect(0, 0, w, h);
    const rnd = seeded(7);
    for (let i = 0; i < 260; i++) {
      // Vitesse entière : chaque étoile fait un nombre entier de trajets par boucle.
      const a = rnd() * TAU, speed = 1 + Math.floor(rnd() * 2);
      const d = ((rnd() + t * speed) % 1);             // distance au centre, en boucle
      const r = Math.pow(d, 1.6) * Math.hypot(w, h) * 0.6;
      const x = w / 2 + Math.cos(a) * r, y = h / 2 + Math.sin(a) * r;
      const size = 0.6 + d * 3.2;
      g.globalAlpha = Math.min(1, d * 3);
      g.fillStyle = i % 9 ? '#e9eef8' : '#8fc2ff';
      g.beginPath(); g.arc(x, y, size, 0, TAU); g.fill();
    }
    g.globalAlpha = 1;
  },
  grid(g, w, h, t) {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#06021a'); sky.addColorStop(0.55, '#1a0638'); sky.addColorStop(1, '#05010f');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    const hy = h * 0.52;
    const sun = g.createLinearGradient(0, hy - w * 0.3, 0, hy);
    sun.addColorStop(0, '#ffd166'); sun.addColorStop(1, '#ff3d9a');
    g.save(); g.beginPath(); g.arc(w / 2, hy, w * 0.26, Math.PI, 0); g.clip();
    g.fillStyle = sun; g.fillRect(0, 0, w, hy);
    g.fillStyle = '#1a0638';
    for (let i = 0; i < 6; i++) g.fillRect(0, hy - 18 - i * 26, w, 3 + i * 1.6);
    g.restore();
    g.strokeStyle = '#ff3d9aaa'; g.lineWidth = 2;
    for (let i = -16; i <= 16; i++) { g.beginPath(); g.moveTo(w / 2 + i * 14, hy); g.lineTo(w / 2 + i * w * 0.14, h); g.stroke(); }
    for (let k = 0; k < 12; k++) {
      const p = ((k + t) / 12);                         // les lignes avancent vers nous, en boucle
      if (p >= 1) continue;                             // sortie par le bas : la suivante a pris sa place
      const y = hy + Math.pow(p, 2.2) * (h - hy);
      g.strokeStyle = `rgba(0,229,255,${p * 0.75})`;   // née invisible à l'horizon : pas de saut à la boucle
      g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
    }
  },
  bokeh(g, w, h, t) {
    const bg = g.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#0d1530'); bg.addColorStop(1, '#05080f');
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    const rnd = seeded(42);
    const colors = ['#4d9fff', '#2fd070', '#c792ea', '#ffcf4d'];
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 26; i++) {
      const x0 = rnd() * w, y0 = rnd() * h, r = w * (0.04 + rnd() * 0.1), ph = rnd() * TAU, amp = h * (0.03 + rnd() * 0.05);
      const x = x0 + Math.cos(t * TAU + ph) * amp, y = y0 + Math.sin(t * TAU + ph) * amp;
      const c = colors[i % colors.length];
      const f = g.createRadialGradient(x, y, 0, x, y, r);
      f.addColorStop(0, c + '55'); f.addColorStop(0.7, c + '22'); f.addColorStop(1, c + '00');
      g.fillStyle = f; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
    }
    g.globalCompositeOperation = 'source-over';
  }
};

/** Les fonds proposés, dans l'ordre de la barre de choix. */
export const BACKGROUNDS = [
  { id: 'default', name: 'RoNote' },
  { id: 'neon', name: 'Néon', still: 'neon' },
  { id: 'sunset', name: 'Sunset', still: 'sunset' },
  { id: 'ocean', name: 'Océan', still: 'ocean' },
  { id: 'casino', name: 'Casino', still: 'casino' },
  { id: 'aurora', name: 'Aurore', animated: true },
  { id: 'stars', name: 'Étoiles', animated: true },
  { id: 'grid', name: 'Synthwave', animated: true },
  { id: 'bokeh', name: 'Bokeh', animated: true }
];

/* --------------------------------- sources ------------------------------- */

const loadImg = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });

/**
 * Une source de fond prête à dessiner :
 *   { animated, period (ms), frames?: [{bitmap, until}], draw(g, w, h, t) }
 * ou null pour le fond RoNote d'origine.
 */
export async function loadBackground(choice) {
  if (!choice || choice.id === 'default') return null;
  const def = BACKGROUNDS.find(b => b.id === choice.id);
  if (def?.animated) {
    const paint = ANIMATED[def.id];
    return { animated: true, period: 3200, draw: (g, w, h, t) => paint(g, w, h, t) };
  }
  if (def?.still) {
    const img = await loadImg(paintBackground(def.still));
    return img ? still(img) : null;
  }
  if (choice.id === 'custom' && typeof choice.data === 'string') {
    if (/^data:image\/gif/.test(choice.data) && 'ImageDecoder' in globalThis) {
      const anim = await decodeGif(choice.data).catch(() => null);
      if (anim) return anim;
    }
    const img = await loadImg(choice.data);
    return img ? still(img) : null;
  }
  return null;
}

function still(img) {
  return { animated: false, period: 0, draw: (g, w, h) => cover(g, img, img.width, img.height, w, h) };
}

function cover(g, src, sw, sh, w, h) {
  const k = Math.max(w / sw, h / sh);
  const dw = sw * k, dh = sh * k;
  g.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/** Les images d'un GIF importé, avec leur durée. Cinq secondes au plus. */
async function decodeGif(dataUrl) {
  const bytes = await (await fetch(dataUrl)).arrayBuffer();
  const dec = new ImageDecoder({ data: bytes, type: 'image/gif' });
  await dec.tracks.ready;
  const count = Math.min(dec.tracks.selectedTrack?.frameCount || 1, 120);
  if (count < 2) return null;
  const frames = [];
  let total = 0;
  for (let i = 0; i < count && total < 5000; i++) {
    const { image } = await dec.decode({ frameIndex: i });
    const ms = Math.max(20, (image.duration || 100000) / 1000);
    const bitmap = await createImageBitmap(image);
    image.close();
    total += ms;
    frames.push({ bitmap, until: total });
  }
  dec.close();
  return {
    animated: true, period: total, frames,
    draw(g, w, h, t) {
      const at = t * total;
      const f = frames.find(x => at < x.until) || frames[frames.length - 1];
      cover(g, f.bitmap, f.bitmap.width, f.bitmap.height, w, h);
    }
  };
}

/* ------------------------------- composition ----------------------------- */

/**
 * Le fond, un voile pour que les chiffres restent lisibles, puis la carte
 * (dessinée sur fond transparent) par-dessus.
 */
export function compose(out, fg, bg, t) {
  const g = out.getContext('2d');
  const w = out.width, h = out.height;
  g.clearRect(0, 0, w, h);
  bg.draw(g, w, h, t);
  const veil = g.createLinearGradient(0, 0, 0, h);
  veil.addColorStop(0, 'rgba(5,8,15,.55)'); veil.addColorStop(0.5, 'rgba(5,8,15,.35)'); veil.addColorStop(1, 'rgba(5,8,15,.6)');
  g.fillStyle = veil; g.fillRect(0, 0, w, h);
  g.drawImage(fg, 0, 0, w, h);
}

/** Une vignette du fond, pour la barre de choix. */
export async function thumbnail(choice, w = 72, h = 90) {
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const g = c.getContext('2d');
  const bg = await loadBackground(choice);
  if (!bg) {
    const f = g.createLinearGradient(0, 0, w, h);
    f.addColorStop(0, '#0d1530'); f.addColorStop(1, '#05080f');
    g.fillStyle = f; g.fillRect(0, 0, w, h);
  } else bg.draw(g, w, h, 0.15);
  return c.toDataURL('image/jpeg', 0.8);
}
