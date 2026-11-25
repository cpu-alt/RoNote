/**
 * ==========================================================================
 *  LE BOUTON ▶ DES VIGNETTES DE JEUX
 * --------------------------------------------------------------------------
 *  Sur roblox.com (accueil « Continue », Charts, recherche…), un petit bouton
 *  Play dans le coin de chaque vignette de jeu : il lance le jeu tout de suite,
 *  sans passer par sa page. Le lancement est celui du bouton Play de Roblox
 *  (`Roblox.GameLauncher`, monde de la page : content/hook.js), demandé par un
 *  postMessage vers location.origin. Rien ne passe par RoNote.
 *  Réglage `gamePlayButton` (actif d'office).
 * ==========================================================================
 */
(() => {
  const B = globalThis.browser ?? globalThis.chrome;
  if (!B || globalThis.__rnPlayButton) return;
  globalThis.__rnPlayButton = true;

  const fr = (document.documentElement.lang || navigator.language || '').toLowerCase().startsWith('fr');
  const LABEL = fr ? 'Jouer' : 'Play';
  const MARK = 'data-rn-play';
  let on = true;
  let obs = null;

  const placeOf = (a) => {
    try {
      const u = new URL(a.href, location.href);
      const id = u.searchParams.get('placeId') || (/\/games\/(\d+)/.exec(u.pathname) || [])[1];
      return /^\d{1,20}$/.test(id || '') ? id : '';
    } catch { return ''; }
  };

  const CSS = `:host{position:absolute;right:6px;bottom:6px;z-index:3}
    button{width:34px;height:34px;display:grid;place-items:center;border:0;border-radius:50%;cursor:pointer;color:#fff;
      background:#00b06f;box-shadow:0 2px 8px rgba(0,0,0,.45);opacity:.92;transition:transform .15s,opacity .15s,background .15s}
    button:hover{opacity:1;transform:scale(1.1);background:#00c77d}
    button:active{transform:scale(.95)}
    svg{width:16px;height:16px;margin-left:2px}`;

  function add(a) {
    if (a.hasAttribute(MARK)) return;
    const thumb = a.querySelector('.game-card-thumb-container');
    const id = placeOf(a);
    if (!thumb || !id) return;
    a.setAttribute(MARK, id);
    if (getComputedStyle(thumb).position === 'static') thumb.style.position = 'relative';
    const host = document.createElement('span');
    host.className = 'rn-play';
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>${CSS}</style><button type="button" title="${LABEL}" aria-label="${LABEL}">
      <svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M3 1.8v12.4c0 .6.7 1 1.2.6l9.6-6.2a.7.7 0 0 0 0-1.2L4.2 1.2C3.7.8 3 1.2 3 1.8z"/></svg></button>`;
    root.querySelector('button').addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();                          // la vignette est un lien : ne pas ouvrir la page du jeu
      window.postMessage({ __ronote: 'play', placeId: a.getAttribute(MARK) }, location.origin);
    });
    thumb.appendChild(host);
  }

  const scan = () => document.querySelectorAll(`a.game-card-link:not([${MARK}])`).forEach(add);
  const clear = () => {
    document.querySelectorAll('.rn-play').forEach(n => n.remove());
    document.querySelectorAll(`[${MARK}]`).forEach(n => n.removeAttribute(MARK));
  };

  function apply(next) {
    on = next;
    if (on && !obs) {
      let queued = false;
      obs = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; scan(); });
      });
      obs.observe(document.body, { childList: true, subtree: true });
      scan();
    } else if (!on && obs) {
      obs.disconnect();
      obs = null;
      clear();
    }
  }

  B.storage?.local?.get('settings').then(g => apply(g?.settings?.gamePlayButton !== false)).catch(() => apply(true));
  B.storage?.onChanged?.addListener((c, area) => {
    if (area === 'local' && c.settings) apply(c.settings.newValue?.gamePlayButton !== false);
  });
})();
