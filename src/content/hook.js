/**
 * Injecte dans le contexte de la page Roblox (monde MAIN).
 *
 * Pourquoi : l'API refuse (403) le detail des trades contenant un bundle quand
 * la requete vient du service worker. La page, elle, les affiche sans probleme.
 * Plutot que de deviner l'endpoint et les en-tetes qu'elle utilise, on ecoute
 * ses propres reponses et on les transmet a l'extension.
 *
 * On n'intercepte QUE les reponses de detail de trade, et on ne les modifie pas.
 * Seule exception : les limites d'accessoires lues par l'editeur d'avatar
 * (avatar-rules), relevees a 10 pour pouvoir les empiler.
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

  // L'éditeur d'avatar lit ses limites dans avatar-rules (3 chapeaux, 1 par autre accessoire) ;
  // le serveur accepte 10 accessoires : on lui annonce 10, il empile alors tout seul.
  const RULES_RE = /\/\/avatar\.roblox\.com\/v1\/avatar-rules(?:$|[?#])/i;
  const ACC_TYPES = new Set([8, 41, 42, 43, 44, 45, 46, 47]);
  const textGet = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseText').get;
  const respGet = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'response').get;
  const sansLimite = (rules) => {
    for (const t of rules?.wearableAssetTypes || []) if (ACC_TYPES.has(t.id)) t.maxNumber = 10;
    return rules;
  };
  function liftLimits(xhr) {
    let memo;
    const patched = () => {
      if (memo === undefined && xhr.readyState === 4) {
        try { memo = JSON.stringify(sansLimite(xhr.responseType === 'json' ? respGet.call(xhr) : JSON.parse(textGet.call(xhr)))); } catch { memo = null; }
      }
      return memo;
    };
    Object.defineProperty(xhr, 'responseText', { configurable: true, get() { return patched() ?? textGet.call(this); } });
    Object.defineProperty(xhr, 'response', { configurable: true, get() {
      const t = patched();
      if (t == null) return respGet.call(this);
      return this.responseType === 'json' ? JSON.parse(t) : (this.responseType === '' || this.responseType === 'text') ? t : respGet.call(this);
    } });
  }

  XMLHttpRequest.prototype.send = (function (origSend) {
    return function (...args) {
      try { if (RULES_RE.test(this.__ronoteUrl || '')) liftLimits(this); } catch { /* ignore */ }
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
