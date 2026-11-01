/**
 * Sons generes a la volee (WebAudio) : aucun fichier binaire dans l'extension.
 * ATTENTION : `playToneInPage` est aussi injectee telle quelle dans un onglet
 * via scripting.executeScript (repli Firefox) -> elle doit rester autonome,
 * sans aucune reference exterieure. Tout ce qui est exporte a cote ne sert
 * qu'aux tests et a la page de reglages.
 */

/** Un son importe ne joue jamais plus longtemps que ca : une alerte, pas un morceau. */
export const CUSTOM_MAX_MS = 8000;

/**
 * Joue un son importe (data: URL). Meme contrainte que playToneInPage : elle
 * est injectee telle quelle dans un onglet sous Firefox, donc autonome.
 */
export function playAudioInPage(data, volume, maxMs) {
  try {
    const a = new Audio(data);
    a.volume = Math.max(0, Math.min(1, Number(volume) || 0.6));
    const p = a.play();
    if (p && p.catch) p.catch(() => {});
    setTimeout(() => { try { a.pause(); } catch (_) { /* ignore */ } }, Number(maxMs) || 8000);
    return true;
  } catch (_) { return false; }
}

/** Motifs disponibles, dans l'ordre ou ils sont proposes. */
export const TONE_NAMES = ['chime', 'ping', 'coins', 'alert', 'success', 'down'];

/**
 * LE SON DIT DEJA SI LE TRADE EST BON.
 *
 * Cinq notes d'une meme famille, de la plus sombre a la plus claire : on sait
 * avant d'avoir lu la notification si l'offre merite qu'on se leve. Les seuils
 * suivent ceux du verdict (analysis.js) : tres mauvais, mauvais, equilibre,
 * bon, tres bon.
 */
export const GRADE_TONES = ['grade-1', 'grade-2', 'grade-3', 'grade-4', 'grade-5'];
export const GRADE_LABELS = ['Très mauvais', 'Mauvais', 'Équilibré', 'Bon', 'Très bon'];

/** 1 (tres mauvais) a 5 (tres bon), ou 0 quand le trade n'est pas chiffrable. */
export function gradeOf(analysis) {
  if (!analysis || analysis.incomplete || !Number.isFinite(analysis.pctMain)) return 0;
  const p = analysis.pctMain;
  if (p >= 25) return 5;
  if (p >= 3) return 4;
  if (p > -3) return 3;
  if (p > -25) return 2;
  return 1;
}

export function playToneInPage(name, volume) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC || name === 'none') return false;
    const ctx = new AC();
    // Un contexte cree hors de tout geste utilisateur peut naitre suspendu :
    // sans ce reveil, tout est planifie... et rien ne sort.
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (_) { /* ignore */ } }
    const vol = Math.max(0, Math.min(1, Number(volume) || 0.6));

    const beep = (freq, start, dur, type, gain) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, ctx.currentTime + start);
      g.gain.setValueAtTime(0.0001, ctx.currentTime + start);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol * (gain ?? 1)), ctx.currentTime + start + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime + start);
      o.stop(ctx.currentTime + start + dur + 0.02);
    };

    const patterns = {
      chime: () => { beep(880, 0, 0.42, 'triangle', 0.7); beep(1174.66, 0.10, 0.42, 'triangle', 0.6); beep(1567.98, 0.20, 0.55, 'triangle', 0.5); },
      ping:  () => { beep(1318.5, 0, 0.16, 'sine', 0.8); beep(1975.5, 0.09, 0.22, 'sine', 0.45); },
      coins: () => { [1046, 1318, 1568, 2093].forEach((f, i) => beep(f, i * 0.055, 0.13, 'square', 0.28)); },
      alert: () => { beep(740, 0, 0.16, 'square', 0.5); beep(740, 0.22, 0.16, 'square', 0.5); beep(988, 0.44, 0.26, 'square', 0.45); },
      // « Trade accepte » : arpege majeur ascendant, derniere note tenue.
      success: () => {
        beep(523.25, 0, 0.18, 'triangle', 0.6);
        beep(659.25, 0.12, 0.18, 'triangle', 0.6);
        beep(783.99, 0.24, 0.18, 'triangle', 0.6);
        beep(1046.5, 0.36, 0.7, 'triangle', 0.7);
        beep(1318.5, 0.36, 0.7, 'sine', 0.25);
      },
      // Refus / erreur : deux notes qui descendent, sans etre agressives.
      down: () => { beep(659.25, 0, 0.22, 'triangle', 0.6); beep(440, 0.24, 0.45, 'triangle', 0.55); },
      // Qualite d'un trade, de 1 (tres mauvais) a 5 (tres bon) : plus c'est
      // bon, plus ca monte et plus c'est clair.
      'grade-1': () => {
        beep(392, 0, 0.2, 'sawtooth', 0.22); beep(311.13, 0.18, 0.22, 'sawtooth', 0.22);
        beep(233.08, 0.38, 0.55, 'triangle', 0.65);
      },
      'grade-2': () => { beep(659.25, 0, 0.2, 'triangle', 0.55); beep(523.25, 0.2, 0.38, 'triangle', 0.55); },
      'grade-3': () => { beep(880, 0, 0.16, 'sine', 0.6); beep(880, 0.2, 0.24, 'sine', 0.45); },
      'grade-4': () => {
        beep(783.99, 0, 0.16, 'triangle', 0.6); beep(987.77, 0.11, 0.16, 'triangle', 0.6);
        beep(1174.66, 0.22, 0.4, 'triangle', 0.6);
      },
      'grade-5': () => {
        [1046.5, 1318.5, 1568, 2093].forEach((f, i) => beep(f, i * 0.085, 0.2, 'triangle', 0.6));
        beep(2093, 0.34, 0.7, 'sine', 0.35); beep(2637, 0.42, 0.6, 'sine', 0.22);
      }
    };
    (patterns[name] || patterns.chime)();
    setTimeout(() => { try { ctx.close(); } catch (_) { /* ignore */ } }, 2000);
    return true;
  } catch (_) { return false; }
}
