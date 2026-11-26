/**
 * Injecte dans le contexte de la page Roblox (monde MAIN).
 *
 * Pourquoi : l'API refuse (403) le detail des trades contenant un bundle quand
 * la requete vient du service worker. La page, elle, les affiche sans probleme.
 * Plutot que de deviner l'endpoint et les en-tetes qu'elle utilise, on ecoute
 * ses propres reponses et on les transmet a l'extension.
 *
 * On n'intercepte QUE les reponses de detail de trade, et on ne les modifie pas.
 * Seule exception : le script de l'editeur d'avatar, execute avec la limite
 * d'accessoires du serveur (10 au total) pour pouvoir les empiler.
 */
(() => {
  // N'importe quel service de Roblox qui sert le detail d'un trade : la page
  // des trades a change d'implementation plusieurs fois (trades.roblox.com/v1,
  // /v2, puis apis.roblox.com/...). Ce qui ne change pas, c'est la forme de
  // l'URL : « .../trades/{identifiant} ». On l'attrape quel que soit l'hote,
  // et on verifie ENSUITE que la reponse ressemble bien a un trade : sinon un
  // autre point d'entree finirait pris pour un detail de trade.
  const TRADE_RE = /\/\/[^/]*roblox\.com\/(?:[^?#]*\/)?trades\/(\d+)(?:$|[?#/])/i;

  // L'envoi d'un trade (« Make Offer ») : sa reponse porte le numero du trade cree. Seul ce
  // numero part vers l'extension (historique d'envoi, content/sent-history.js).
  // Le counter (« …/trades/{id}/counter ») crée lui aussi un trade envoyé : même traitement.
  const SEND_RE = /\/\/[^/]*roblox\.com\/(?:[^?#]*\/)?trades\/(?:send|\d+\/counter)(?:$|[?#])/i;
  const sent = (j) => {
    const id = j && typeof j === 'object' ? (j.id ?? j.tradeId) : null;
    if (!/^\d+$/.test(String(id ?? ''))) return;
    try { window.postMessage({ __ronote: 'trade-sent', tradeId: String(id) }, location.origin); } catch { /* ignore */ }
  };

  const looksLikeTrade = (j) => !!j && typeof j === 'object'
    && (Array.isArray(j.offers) || j.participantAOffer || j.participantBOffer
      || Array.isArray(j.participants) || j.tradeStatus || j.status);

  const send = (id, data) => {
    if (!looksLikeTrade(data)) return;
    try {
      window.postMessage({ __ronote: 'trade-detail', tradeId: String(id), detail: data }, location.origin);
    } catch { /* donnee non clonable : on laisse tomber */ }
  };

  // La page joint le meme jeton a chacune de ses requetes : seul un jeton
  // nouveau vaut un message, sinon chaque requete reveillerait le service worker.
  let lastToken = '';
  const sendToken = (token) => {
    if (!token || String(token) === lastToken) return;
    lastToken = String(token);
    window.postMessage({ __ronote: 'csrf', token: lastToken }, location.origin);
  };

  // --- fetch ---------------------------------------------------------
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (...args) {
      const res = origFetch.apply(this, args);
      try {
        const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
        const m = SEND_RE.test(url) ? null : TRADE_RE.exec(url);
        if (m) {
          res.then(r => {
            if (!r?.ok) return;
            r.clone().json().then(j => send(m[1], j)).catch(() => {});
          }).catch(() => {});
        } else if (SEND_RE.test(url)) {
          res.then(r => { if (r?.ok) r.clone().json().then(sent).catch(() => {}); }).catch(() => {});
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

  // L'éditeur d'avatar limite chaque type d'accessoire (3 chapeaux, 1 du reste) dans son propre
  // script ; le serveur accepte 10 accessoires au total. On exécute son script avec la règle du
  // serveur (les deux « !x&& » retirés). Script changé chez Roblox : motif absent, on n'y touche pas.
  const AVATAR_JS = /-Avatar\.js(?:$|\?)/;
  const ACC_RULE = /!\w+&&(\w+\(\w+\.name\)\?(?:10|"Accessory"):)/g;
  if (/^\/my\/avatar/i.test(location.pathname)) {
    new MutationObserver((muts, obs) => {
      for (const m of muts) for (const s of m.addedNodes) {
        if (s.tagName !== 'SCRIPT' || !AVATAR_JS.test(s.src || '')) continue;
        obs.disconnect();
        try {
          const x = new XMLHttpRequest();
          x.open('GET', s.src, false);   // synchrone : le script corrigé garde sa place dans l'ordre de la page
          x.send();
          const code = x.status === 200 ? x.responseText : '';
          if ((code.match(ACC_RULE) || []).length !== 2) return;
          s.type = 'javascript/blocked';
          const fixed = document.createElement('script');
          fixed.textContent = code.replace(ACC_RULE, '$1');
          s.after(fixed);
        } catch { /* le script d'origine s'exécute */ }
        return;
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  XMLHttpRequest.prototype.send = (function (origSend) {
    return function (...args) {
      try {
        const isSend = SEND_RE.test(this.__ronoteUrl || '');
        const m = isSend ? null : TRADE_RE.exec(this.__ronoteUrl || '');
        if (isSend) {
          this.addEventListener('load', () => {
            try {
              if (this.status < 200 || this.status >= 300) return;
              sent(this.responseType === '' || this.responseType === 'text' ? JSON.parse(this.responseText) : this.response);
            } catch { /* reponse non JSON */ }
          });
        }
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
  // Le bouton ▶ des vignettes (content/play-button.js) : le même lancement que le bouton Play de Roblox.
  window.addEventListener?.('message', (e) => {
    const d = e.data;
    if (e.source !== window || e.origin !== location.origin || d?.__ronote !== 'play' || !/^\d{1,20}$/.test(String(d.placeId || ''))) return;
    const id = String(d.placeId);
    try {
      const L = window.Roblox?.GameLauncher;
      if (typeof L?.joinMultiplayerGame === 'function') { L.joinMultiplayerGame(Number(id)); return; }
    } catch { /* lanceur indisponible : la page de lancement de Roblox */ }
    location.assign(`/games/start?placeId=${id}`);
  });
})();
