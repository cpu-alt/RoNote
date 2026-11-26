/**
 * Injecte dans le contexte de la page Roblox (monde MAIN).
 *
 * Pourquoi : l'API refuse (403) le detail des trades contenant un bundle quand
 * la requete vient du service worker. La page, elle, les affiche sans probleme.
 * Plutot que de deviner l'endpoint et les en-tetes qu'elle utilise, on ecoute
 * ses propres reponses et on les transmet a l'extension.
 *
 * On n'intercepte QUE les reponses de detail de trade, et on ne les modifie pas.
 * Seule exception : l'enregistrement de l'editeur d'avatar, pour empiler les
 * accessoires (reglage avatarPlus, active par content/avatar-plus.js).
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
    try { this.__ronoteUrl = String(url || ''); this.__ronoteMethod = String(method || '').toUpperCase(); } catch { /* ignore */ }
    return origOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    try { if (String(name).toLowerCase() === 'x-csrf-token') sendToken(value); } catch { /* ignore */ }
    return origSetHeader.call(this, name, value);
  };

  // L'éditeur d'avatar envoie sa liste complète (PATCH v4/avatar) et y retire de lui-même un
  // accessoire au-delà de sa limite (3 chapeaux, 1 par autre type) : le serveur en accepte 10.
  // On remet ce qu'il a retiré pour faire de la place, et ce qu'on avait déjà remis (il l'ignore).
  const ACC_TYPES = new Set([8, 41, 42, 43, 44, 45, 46, 47]);
  const AVATAR_RE = /\/\/avatar\.roblox\.com\/v\d+\/avatar(?:$|[?#])/i;
  const kept = new Set();
  let stackOn = false;
  const stackBack = (before, ids) => {
    const added = [...ids].filter(id => !before.some(b => b.id === id)).length;
    const gone = before.filter(b => !ids.has(b.id) && ACC_TYPES.has(b.assetType?.id));
    const evicted = gone.filter(b => !kept.has(b.id));
    const back = [...gone.filter(b => kept.has(b.id)), ...(added && evicted.length <= added ? evicted : [])];
    const acc = before.filter(b => ids.has(b.id) && ACC_TYPES.has(b.assetType?.id)).length + added;
    return back.slice(0, Math.max(0, 10 - acc));
  };
  async function stackSend(xhr, origSend, body) {
    let out = body;
    try {
      const j = JSON.parse(body);
      const list = j?.avatarDefinition?.updateAvatarModel?.assets;
      if (Array.isArray(list)) {
        const before = (await origFetch('https://avatar.roblox.com/v2/avatar/avatar', { credentials: 'include' }).then(r => r.json())).assets || [];
        const back = stackBack(before, new Set(list.map(a => Number(a.id))));
        if (back.length) {
          back.forEach(b => kept.add(b.id));
          list.push(...back.map(b => (b.meta ? { id: b.id, meta: b.meta } : { id: b.id })));
          out = JSON.stringify(j);
          xhr.addEventListener('load', () => window.postMessage({ __ronote: 'avatar-stacked' }, location.origin));
        }
      }
    } catch { /* lecture impossible : la requête part telle quelle */ }
    origSend.call(xhr, out);
  }
  window.addEventListener?.('message', (e) => {
    if (e.source === window && e.origin === location.origin && e.data?.__ronote === 'avatar-stack') stackOn = !!e.data.on;
  });

  XMLHttpRequest.prototype.send = (function (origSend) {
    return function (...args) {
      if (stackOn && this.__ronoteMethod === 'PATCH' && AVATAR_RE.test(this.__ronoteUrl || '')
          && typeof args[0] === 'string' && args[0].includes('UpdateAssets')) {
        stackSend(this, origSend, args[0]);
        return;
      }
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
