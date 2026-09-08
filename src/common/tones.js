/**
 * Sons generes a la volee (WebAudio) : aucun fichier binaire dans l'extension.
 * ATTENTION : `playToneInPage` est aussi injectee telle quelle dans un onglet
 * via scripting.executeScript (repli Firefox) -> elle doit rester autonome,
 * sans aucune reference exterieure. Tout ce qui est exporte a cote ne sert
 * qu'aux tests et a la page de reglages.
 */

/** Motifs disponibles, dans l'ordre ou ils sont proposes. */
export const TONE_NAMES = ['chime', 'ping', 'coins', 'alert', 'success', 'down'];

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
      down: () => { beep(659.25, 0, 0.22, 'triangle', 0.6); beep(440, 0.24, 0.45, 'triangle', 0.55); }
    };
    (patterns[name] || patterns.chime)();
    setTimeout(() => { try { ctx.close(); } catch (_) { /* ignore */ } }, 2000);
    return true;
  } catch (_) { return false; }
}
