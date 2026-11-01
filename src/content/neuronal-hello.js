/**
 * ==========================================================================
 *  « RONOTE EST LÀ » POUR LA PAGE neuronal.live/ronote (FIREFOX)
 * --------------------------------------------------------------------------
 *  Chrome répond à la page par sa messagerie externe (voir
 *  background/neuronal.js) ; Firefox ne l'ouvre pas aux pages web. Ce script,
 *  déclaré dans le seul manifeste Firefox, poste donc à la page la version et
 *  l'état de la contribution, vers sa propre origine (jamais « * »).
 *
 *  Firefox ne l'injecte que si la permission optionnelle sur neuronal.live a
 *  été accordée : s'il tourne, elle l'est, et `share` suit l'option.
 * ==========================================================================
 */
(() => {
  const B = globalThis.browser ?? globalThis.chrome;
  if (!B?.runtime?.id || globalThis.__rnNeuronalHello) return;
  globalThis.__rnNeuronalHello = true;

  const hello = async () => {
    let share = false;
    try { share = !!(await B.storage.local.get('settings'))?.settings?.neuronalShare; } catch { /* contexte invalide */ }
    window.postMessage({ source: 'ronote', type: 'hello', version: B.runtime.getManifest().version, share }, location.origin);
  };
  hello();
  // L'option basculée pendant que la page est ouverte : la page suit.
  B.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings
      && !!changes.settings.newValue?.neuronalShare !== !!changes.settings.oldValue?.neuronalShare) hello();
  });
})();
