/**
 * ==========================================================================
 *  ENCODEUR GIF
 * --------------------------------------------------------------------------
 *  Les navigateurs savent lire un GIF, pas en écrire un. Celui-ci suffit aux
 *  cartes Flex animées : une palette commune de 256 couleurs pour toutes les
 *  images (pas de scintillement d'une image à l'autre), choisie par coupe
 *  médiane sur un échantillon des pixels, puis la compression LZW du format.
 *
 *  Pas de tramage : les cartes sont faites d'aplats et de dégradés doux, où
 *  un tramage ajouterait du bruit et beaucoup de poids.
 *
 *  Usage :
 *    const enc = new GifEncoder(w, h);
 *    enc.palette(frames);                  // ImageData[] (ou un échantillon)
 *    for (const f of frames) await enc.add(f, delayMs);
 *    const blob = enc.finish();
 * ==========================================================================
 */

const BITS = 5;                       // précision de l'histogramme par canal
const SIDE = 1 << BITS;
const binOf = (r, g, b) => ((r >> (8 - BITS)) << (2 * BITS)) | ((g >> (8 - BITS)) << BITS) | (b >> (8 - BITS));

/** Coupe médiane sur l'histogramme : jusqu'à `max` couleurs représentatives. */
function medianCut(hist, max) {
  const bins = [];
  for (let i = 0; i < hist.length; i++) if (hist[i]) bins.push(i);
  if (!bins.length) return [[0, 0, 0]];
  const chan = (bin, c) => (bin >> ((2 - c) * BITS)) & (SIDE - 1);
  let boxes = [bins];
  while (boxes.length < max) {
    // La boîte la plus peuplée, qui peut encore être coupée.
    let bi = -1, best = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      const n = box.reduce((s, b) => s + hist[b], 0);
      if (n > best) { best = n; bi = i; }
    });
    if (bi < 0) break;
    const box = boxes[bi];
    // Le canal le plus étendu.
    let axis = 0, span = -1;
    for (let c = 0; c < 3; c++) {
      let lo = SIDE, hi = -1;
      for (const b of box) { const v = chan(b, c); if (v < lo) lo = v; if (v > hi) hi = v; }
      if (hi - lo > span) { span = hi - lo; axis = c; }
    }
    box.sort((a, b) => chan(a, axis) - chan(b, axis));
    // Coupé à la médiane des pixels, pas des cases.
    let acc = 0, half = best / 2, cut = 1;
    for (let i = 0; i < box.length; i++) { acc += hist[box[i]]; if (acc >= half) { cut = Math.max(1, Math.min(box.length - 1, i)); break; } }
    boxes.splice(bi, 1, box.slice(0, cut), box.slice(cut));
  }
  const scale = 255 / (SIDE - 1);
  return boxes.map(box => {
    let n = 0, r = 0, g = 0, b = 0;
    for (const bin of box) {
      const w = hist[bin]; n += w;
      r += chan(bin, 0) * w; g += chan(bin, 1) * w; b += chan(bin, 2) * w;
    }
    return [Math.round(r / n * scale), Math.round(g / n * scale), Math.round(b / n * scale)];
  });
}

/** Compression LZW du format GIF, codes de longueur variable. */
function lzw(indices, minSize) {
  const clear = 1 << minSize, end = clear + 1;
  const out = [];
  let cur = 0, curBits = 0;
  let size = minSize + 1;
  const emit = (code) => {
    cur |= code << curBits; curBits += size;
    while (curBits >= 8) { out.push(cur & 255); cur >>>= 8; curBits -= 8; }
  };
  let dict = new Map();
  let next = end + 1;
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = prefix * 4096 + k;
    const hit = dict.get(key);
    if (hit !== undefined) { prefix = hit; continue; }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      if (next > (1 << size) && size < 12) size++;
    } else {
      emit(clear);
      dict = new Map(); next = end + 1; size = minSize + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(end);
  if (curBits > 0) out.push(cur & 255);
  return out;
}

export class GifEncoder {
  constructor(width, height) {
    this.w = width; this.h = height;
    this.parts = [];
    this.colors = null;
    this.lookup = new Int16Array(SIDE * SIDE * SIDE).fill(-1);
  }

  /** La palette commune, à partir d'un échantillon des images. */
  palette(frames) {
    const hist = new Uint32Array(SIDE * SIDE * SIDE);
    for (const f of frames) {
      const d = f.data;
      for (let i = 0; i < d.length; i += 4 * 3) hist[binOf(d[i], d[i + 1], d[i + 2])]++;
    }
    this.colors = medianCut(hist, 256);
    while (this.colors.length < 256) this.colors.push([0, 0, 0]);
    this.header();
  }

  /** La couleur de palette la plus proche d'une case de l'histogramme (mémorisée). */
  nearest(bin) {
    const hit = this.lookup[bin];
    if (hit >= 0) return hit;
    const scale = 255 / (SIDE - 1);
    const r = ((bin >> (2 * BITS)) & (SIDE - 1)) * scale, g = ((bin >> BITS) & (SIDE - 1)) * scale, b = (bin & (SIDE - 1)) * scale;
    let best = 0, dist = Infinity;
    for (let i = 0; i < this.colors.length; i++) {
      const c = this.colors[i];
      const d = (c[0] - r) ** 2 * 2 + (c[1] - g) ** 2 * 4 + (c[2] - b) ** 2 * 3;
      if (d < dist) { dist = d; best = i; }
    }
    this.lookup[bin] = best;
    return best;
  }

  header() {
    const { w, h } = this;
    const bytes = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61, w & 255, w >> 8, h & 255, h >> 8, 0xF7, 0, 0];
    for (const c of this.colors) bytes.push(c[0], c[1], c[2]);
    // Boucle infinie (extension NETSCAPE2.0).
    bytes.push(0x21, 0xFF, 0x0B, ...[...'NETSCAPE2.0'].map(ch => ch.charCodeAt(0)), 0x03, 0x01, 0, 0, 0);
    this.parts.push(new Uint8Array(bytes));
  }

  /** Ajoute une image (ImageData à la taille de l'encodeur), affichée `delay` ms. */
  async add(frame, delay) {
    const d = frame.data, n = this.w * this.h;
    const idx = new Uint8Array(n);
    for (let p = 0, i = 0; p < n; p++, i += 4) idx[p] = this.nearest(binOf(d[i], d[i + 1], d[i + 2]));
    const cs = Math.max(2, Math.round(delay / 10));
    const head = [0x21, 0xF9, 0x04, 0x04, cs & 255, cs >> 8, 0, 0,
      0x2C, 0, 0, 0, 0, this.w & 255, this.w >> 8, this.h & 255, this.h >> 8, 0, 8];
    const data = lzw(idx, 8);
    const blocks = [];
    for (let i = 0; i < data.length; i += 255) {
      const len = Math.min(255, data.length - i);
      blocks.push(len, ...data.slice(i, i + len));
    }
    blocks.push(0);
    this.parts.push(new Uint8Array(head), new Uint8Array(blocks));
    // Laisse respirer l'interface entre deux images.
    await new Promise(r => setTimeout(r, 0));
  }

  finish() {
    this.parts.push(new Uint8Array([0x3B]));
    return new Blob(this.parts, { type: 'image/gif' });
  }
}
