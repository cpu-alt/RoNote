/**
 * Injecte dans le contexte de la page Roblox (monde MAIN).
 *
 * Pourquoi : l'API refuse (403) le detail des trades contenant un bundle quand
 * la requete vient du service worker. La page, elle, les affiche sans probleme.
 * Plutot que de deviner l'endpoint et les en-tetes qu'elle utilise, on ecoute
 * ses propres reponses et on les transmet a l'extension.
 *
 * On n'intercepte QUE les reponses de detail de trade, et on ne modifie rien.
 */
(() => {
  // N'importe quel service de Roblox qui sert le detail d'un trade : la page
  // des trades a change d'implementation plusieurs fois (trades.roblox.com/v1,
  // /v2, puis apis.roblox.com/...). Ce qui ne change pas, c'est la forme de
  // l'URL : « .../trades/{identifiant} ». On l'attrape quel que soit l'hote,
  // et on verifie ENSUITE que la reponse ressemble bien a un trade — sinon un
  // autre point d'entree finirait pris pour un detail de trade.
  const TRADE_RE = /\/\/[^/]*roblox\.com\/(?:[^?#]*\/)?trades\/(\d+)(?:$|[?#/])/i;

  const looksLikeTrade = (j) => !!j && typeof j === 'object'
    && (Array.isArray(j.offers) || j.participantAOffer || j.participantBOffer
      || Array.isArray(j.participants) || j.tradeStatus || j.status);

  const send = (id, data) => {
    if (!looksLikeTrade(data)) return;
    try {
      window.postMessage({ __ronote: 'trade-detail', tradeId: String(id), detail: data }, location.origin);
    } catch { /* donnee non clonable : on laisse tomber */ }
  };

  const sendToken = (token) => {
    if (token) window.postMessage({ __ronote: 'csrf', token: String(token) }, location.origin);
  };

  // --- fetch ---------------------------------------------------------
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (...args) {
      const res = origFetch.apply(this, args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
        const m = TRADE_RE.exec(url);
        if (m) {
          res.then(r => {
            if (!r?.ok) return;
            r.clone().json().then(j => send(m[1], j)).catch(() => {});
          }).catch(() => {});
        }
        // La page ajoute le jeton CSRF a ses requetes : on le recupere au vol.
        const h = args[1]?.headers;
        if (h) {
          const t = typeof h.get === 'function' ? h.get('x-csrf-token') : (h['x-csrf-token'] || h['X-CSRF-TOKEN']);
          sendToken(t);
        }
      } catch { /* ne jamais casser la page */ }
      return res;
    };
  }

  // --- XMLHttpRequest ------------------------------------------------
  const origOpen = XMLHttpRequest.prototype.open;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try { this.__ronoteUrl = String(url || ''); } catch { /* ignore */ }
    return origOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    try { if (String(name).toLowerCase() === 'x-csrf-token') sendToken(value); } catch { /* ignore */ }
    return origSetHeader.call(this, name, value);
  };

  XMLHttpRequest.prototype.send = (function (origSend) {
    return function (...args) {
      try {
        const m = TRADE_RE.exec(this.__ronoteUrl || '');
        if (m) {
          this.addEventListener('load', () => {
            try {
              if (this.status < 200 || this.status >= 300) return;
              const body = this.responseType === '' || this.responseType === 'text'
                ? JSON.parse(this.responseText) : this.response;
              if (body) send(m[1], body);
            } catch { /* reponse non JSON */ }
          });
        }
      } catch { /* ignore */ }
      return origSend.apply(this, args);
    };
  })(XMLHttpRequest.prototype.send);

  // Jeton present dans le HTML de la page, sans aucune requete.
  try {
    const meta = document.querySelector('meta[name="csrf-token"]');
    if (meta?.content) sendToken(meta.content);
  } catch { /* ignore */ }
})();
