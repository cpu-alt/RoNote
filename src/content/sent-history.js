/**
 * ==========================================================================
 *  L'ENVOI RAPIDE SUR LA PAGE « TRADE WITH … »
 * --------------------------------------------------------------------------
 *  Sous le titre de la page d'envoi (/users/{id}/trade), une ligne discrète :
 *  « Recent » et les vignettes des objets que j'ai mis de mon côté dans mes
 *  derniers envois ; un clic remet l'objet dans « Your Offer ».
 *  RoNote premium Insider / Elite, désactivé par défaut (Réglages › Page d'un
 *  trade › Envoi rapide).
 *
 *  Économe :
 *    - rien ne tourne tant que l'option est coupée (le réglage est écouté) ;
 *    - une seule question au service worker par joueur et par visite, qui
 *      répond depuis ses caches (aucune requête Roblox) ;
 *    - un shadow DOM fermé, vignettes en chargement paresseux ;
 *    - la surveillance de la page est un test d'URL toutes les 1,2 s, qui ne
 *      touche au DOM que si la bande manque.
 *
 *  L'enregistrement d'un envoi : au clic sur un bouton de la page, le panier
 *  « Your Offer » est lu (RoNoteDom.readTradePage) ; quand Roblox répond au
 *  « Make Offer » (hook.js → relay.js), ce panier est gardé avec le numéro
 *  du trade, en local.
 * ==========================================================================
 */
(() => {
  const B = globalThis.browser ?? globalThis.chrome;
  if (!B || globalThis.RoNoteSent) return;

  let dead = false;
  const alive = () => {
    if (dead) return false;
    try { if (B?.runtime?.id) return true; } catch { /* extension rechargée */ }
    dead = true; clearInterval(timer); host?.remove();
    return false;
  };
  const fr = (document.documentElement.lang || navigator.language || '').toLowerCase().startsWith('fr');
  const L = (f, e) => fr ? f : e;
  const compact = new Intl.NumberFormat(fr ? 'fr-FR' : 'en-US', { notation: 'compact', maximumFractionDigits: 1 });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const PATH = /^(?:\/[a-z]{2}(?:[-_][a-z]{2})?)?\/users\/(\d+)\/trade\/?$/i;
  const TRADES = /^(?:\/[a-z]{2}(?:[-_][a-z]{2})?)?\/trades\/?$/i;
  // Le partenaire : dans l'adresse (« /users/{id}/trade », envoi ou counter), sinon, sur /trades où Roblox
  // ouvre aussi l'écran de counter, lu sur la page. Là, on ne regarde qu'un tour sur trois tant que
  // l'écran n'est pas ouvert, et la réponse est gardée pour l'adresse en cours.
  let trPid = { url: '', pid: 0, at: 0 }, trTick = 0;
  function partnerOf(fresh = false) {
    const m = PATH.exec(location.pathname);
    if (m) return Number(m[1]) || 0;
    if (!TRADES.test(location.pathname)) return 0;
    if (!fresh && trPid.url === location.href && (trPid.pid || ++trTick % 3)) return trPid.pid;
    let pid = 0;
    try {
      if (globalThis.RoNoteDom?.composerTitle?.()) pid = Number(globalThis.RoNoteDom.readTradePage()?.partnerId) || 0;
    } catch { /* page en chargement */ }
    // Le pseudo seul ne donne pas d'id : sans lui, pas de ligne (on ne devine pas).
    trPid = { url: location.href, pid, at: Date.now() };
    return pid;
  }

  let enabled = false, timer = null, projColor = '#e3b04b';
  let host = null, shadow = null, data = null, dataFor = 0, asking = false, pending = null;

  /* ------------------------------ réglages ------------------------------ */
  const apply = (s) => {
    const was = enabled;
    enabled = s?.sentHistory === true;
    if (/^#[0-9a-f]{6}$/i.test(s?.projectedColor || '')) projColor = s.projectedColor;   // la couleur du badge Projected des réglages
    if (!enabled) { host?.remove(); host = null; data = null; dataFor = 0; offerObs?.disconnect(); offerObs = null; offerEl = null; }
    if (enabled && !was) { data = null; dataFor = 0; tick(); }
  };
  try {
    B.storage?.local?.get('settings').then(got => apply(got?.settings)).catch(() => {});
    B.storage?.onChanged?.addListener((ch, area) => {
      if (area === 'local' && ch.settings && alive()) apply(ch.settings.newValue);
    });
  } catch { /* contexte invalide */ }

  /* --------------------------- l'enregistrement -------------------------- */
  const itemsOf = (side) => (side?.items || []).slice(0, 8).map(i => ({
    assetId: i.assetId || 0, bundleId: i.bundleId || 0, name: i.name || '', rap: i.rap ?? 0,
    thumb: i.card?.querySelector?.('img')?.src || null }));      // déjà affichée : pas de requête pour la retrouver
  function snap() {
    let page = null;
    try { page = globalThis.RoNoteDom?.readTradePage?.(); } catch { return null; }
    if (!page?.composer) return null;
    const give = page.sides.find(s => s.role === 'give'), get = page.sides.find(s => s.role === 'get');
    const s = { at: Date.now(), partnerId: page.partnerId || partnerOf(), handle: page.handle || '',
      give: itemsOf(give), get: itemsOf(get), robux: give?.robux || 0 };
    return s.give.length || s.robux ? s : null;
  }
  // Le panier tel qu'il est au clic : après la réponse de Roblox, la page peut déjà l'avoir vidé.
  document.addEventListener('click', (e) => {
    if (!enabled || !e.target?.closest?.("button") || !partnerOf(true)) return;
    pending = snap() || pending;
  }, true);

  function sent(tradeId) {
    if (!enabled || !alive()) return;
    const s = (pending && Date.now() - pending.at < 120e3) ? pending : snap();
    pending = null;
    if (!s) return;
    Promise.resolve(B.runtime.sendMessage({ type: 'ronote:sent-record', tradeId, ...s })).then(() => {
      data = null; dataFor = 0; tick();                     // la bande montre tout de suite le nouvel envoi
    }).catch(() => {});
  }
  globalThis.RoNoteSent = { sent };

  /* ------------------------------- l'écran ------------------------------- */
  // 18 nov. (MYd : « bien plus discret, plus propre ») : une seule ligne sans cadre, une petite
  // étiquette et des vignettes ; le nom et la value au survol, un « + » pour dire qu'on clique.
  const SHOWN = 16;
  const CSS = `
    :host{all:initial;display:block;width:100%;flex:0 0 100%;margin:4px 0 12px;color-scheme:dark}
    *{box-sizing:border-box}
    .line{display:flex;align-items:center;gap:10px;min-height:36px;font:500 12px/1.3 "Builder Sans","Gotham SSm",Arial,sans-serif;color:#e7e9f0}
    .lbl{flex:none;min-width:44px;font-size:10.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;opacity:.5;transition:opacity .2s,color .2s}
    .lbl.ok{color:#7ee2b0;opacity:.9}.lbl.miss{color:#f8c471;opacity:.9}
    .row{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;padding:2px}
    .row::-webkit-scrollbar{display:none}
    .t{position:relative;flex:none;width:34px;height:34px;padding:0;border:0;border-radius:8px;cursor:pointer;overflow:hidden;
      background:rgba(255,255,255,.06);box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);opacity:.82;
      transition:opacity .15s,transform .15s,box-shadow .15s}
    .t:hover,.t:focus-visible{opacity:1;transform:translateY(-1px);outline:none;box-shadow:inset 0 0 0 1px rgba(196,181,253,.7)}
    .t.them{box-shadow:inset 0 0 0 1px rgba(167,139,250,.45)}
    .t img{width:100%;height:100%;object-fit:cover;display:block}
    .t .ph{display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:9px;color:#e7e9f0;opacity:.7}
    .t .n{position:absolute;right:1px;bottom:1px;font:700 8.5px/1 Arial,sans-serif;color:#fff;padding:1px 2px;border-radius:3px;background:rgba(0,0,0,.55)}
    .t::after{content:"+";position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:700 16px/1 Arial,sans-serif;
      color:#fff;background:rgba(46,16,101,.55);opacity:0;transition:opacity .15s}
    .t:hover::after,.t:focus-visible::after{opacity:1}
    .t.ok{box-shadow:inset 0 0 0 2px #3fbf7f;opacity:1}.t.miss{box-shadow:inset 0 0 0 2px #f5a524;opacity:1}
    .t.busy{pointer-events:none;opacity:.5}
    .t.in{opacity:.38}.t.in::after{content:"−";opacity:0}.t.in:hover{opacity:1}.t.in:hover::after{opacity:1}
    .t .tick{position:absolute;right:2px;top:2px;width:11px;height:11px;border-radius:50%;background:#3fbf7f;display:none;
      align-items:center;justify-content:center}
    .t .tick svg{width:7px;height:7px}
    .t.in .tick{display:flex}
    .t .pj{position:absolute;left:2px;top:2px;z-index:1;width:12px;height:12px;border-radius:3px;display:flex;align-items:center;justify-content:center;
      background:var(--pj);box-shadow:0 0 0 1px rgba(0,0,0,.35)}
    .t .pj svg{width:9px;height:9px}
    .t .rr{position:absolute;left:2px;bottom:2px;z-index:1;font-size:8px;line-height:1;filter:drop-shadow(0 0 1px #000)}
    .tip{font-size:11.5px;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
    .tip b{font-weight:700}.tip .p{color:var(--pj)}
    .muted{opacity:.5;font-size:11.5px}
    .muted a{color:inherit;text-decoration:underline;text-underline-offset:2px}
    @media(prefers-reduced-motion:reduce){.t,.t::after,.lbl{transition:none}}`;
  const LABEL = L('Récents', 'Recent');
  // Le triangle du badge Projected (projected-badge.js), en miniature, et la coche « déjà dans l'offre ».
  const TRI = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8 1.6 21h20.8L12 2.8z" fill="none" stroke="#1a1200" stroke-width="3" stroke-linejoin="round"/><path d="M12 9.6v5" stroke="#1a1200" stroke-width="3" stroke-linecap="round"/><circle cx="12" cy="18" r="1.6" fill="#1a1200"/></svg>';
  const CHECK = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 6.2 5 8.6l4.6-5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  function content() {
    if (!data || data.error) return '';
    if (data.locked) {
      return `<span class="muted">${data.locked === 'login'
        ? L('Connecte RoNote premium pour tes objets récents.', 'Sign in to RoNote premium for your recent items.')
        : L('Objets récents : Insider et Elite.', 'Recent items: Insider and Elite.')}
        <a href="https://discord.gg/neuronal" target="_blank" rel="noopener noreferrer">${L('Débloquer', 'Unlock')}</a></span>`;
    }
    const items = (data.items || []).slice(0, SHOWN);
    if (!items.length) return `<span class="muted">${L('Tes objets apparaîtront ici après ton prochain envoi.', 'Your items will show up here after your next send.')}</span>`;
    return `<div class="row">${items.map((i, k) => `<button class="t${i.withThem ? ' them' : ''}" type="button" data-k="${k}"
      aria-label="${esc(i.name)} · ${esc(compact.format(i.value || 0))}${i.projected ? ' · Projected' : ''}">${i.thumb && /^https:\/\//.test(i.thumb)
        ? `<img src="${esc(i.thumb)}" alt="" loading="lazy" decoding="async">`
        : `<span class="ph">${esc((i.acronym || i.name || '?').slice(0, 4))}</span>`}${i.projected ? `<span class="pj">${TRI}</span>` : ''}${
        i.rare ? '<span class="rr">💎</span>' : ''}${i.n > 1 ? `<span class="n">${i.n}</span>` : ''}<span class="tick">${CHECK}</span></button>`).join('')}</div>
      <span class="tip" hidden></span>`;
  }

  function draw() {
    if (!shadow) return;
    const sig = JSON.stringify([data && (data.locked || data.error || (data.items || []).slice(0, SHOWN).map(i => i.name + i.n + (i.thumb || '')))]);
    if (shadow._sig === sig) return;
    shadow._sig = sig;
    const inner = content();
    host.style.display = inner ? '' : 'none';           // rien à montrer (chargement, erreur) : rien du tout
    shadow.innerHTML = `<style>${CSS}</style><div class="line" style="--pj:${projColor}"><span class="lbl">${LABEL}</span>${inner}</div>`;
    const tip = shadow.querySelector('.tip');
    shadow.querySelectorAll('.t').forEach(b => {
      const it = data.items[Number(b.dataset.k)];
      b.addEventListener('click', () => (b.classList.contains('in') ? removeFromOffer(b, it) : quickAdd(b, it)));
      // Une infobulle sobre dans la ligne elle-même : nom, value, Projected, nombre de fois.
      const show = () => { if (!tip) return; tip.hidden = false; tip.innerHTML = `<b>${esc(it.name)}</b> · ${esc(compact.format(it.value || 0))}${
        it.projected ? ' · <span class="p">Projected</span>' : ''}${it.n > 1 ? ` · ×${it.n}` : ''}${b.classList.contains('in') ? ' · ' + esc(L('dans ton offre', 'in your offer')) : ''}`; };
      const hide = () => { if (tip) tip.hidden = true; };
      b.addEventListener('mouseenter', show); b.addEventListener('focus', show);
      b.addEventListener('mouseleave', hide); b.addEventListener('blur', hide);
    });
    watchOffer();
  }

  /* ---------------------------- l'ajout rapide --------------------------- */
  // Vu sur la vraie page le 18 nov. : chaque objet de « Your Inventory » est un
  // `.trade-inventory-card` (role=button) dont la vignette est DANS un lien vers l'objet ; Roblox
  // l'ajoute à l'offre sur Entrée (onKeyDown) ou sur un vrai clic souris, pas sur un `click()`
  // simulé. L'inventaire est paginé, mais une recherche (bouton « Search », champ type=search)
  // filtre côté serveur en ~1 s : un objet absent de la page affichée passe par elle.
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  const myPanel = () => document.querySelector('.trade-inventory-panel');      // le premier : le mien
  // Les cases vides de l'offre portent la même classe : on compte celles qui ont une vignette (son conteneur :
  // l'image elle-même arrive après).
  const offerCount = () => document.querySelectorAll('.trade-request-window-offer .trade-request-item .thumbnail-2d-container').length;
  function cardFor(panel, it) {
    const re = it.bundleId ? new RegExp(`/bundles/${it.bundleId}(?:/|$)`) : it.assetId ? new RegExp(`/catalog/${it.assetId}(?:/|$)`) : null;
    const cards = [...panel.querySelectorAll('.trade-inventory-card')].filter(c => !c.classList.contains('is-unavailable'));
    return cards.find(c => re && [...c.querySelectorAll('a[href]')].some(a => re.test(a.getAttribute('href'))))
      || cards.find(c => it.name && (c.textContent || '').includes(it.name)) || null;
  }
  const press = (card) => {
    const o = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    card.dispatchEvent(new KeyboardEvent('keydown', o));
    card.dispatchEvent(new KeyboardEvent('keyup', o));
  };
  const setValue = (input, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  async function addCard(card) {
    const avant = offerCount();
    press(card);
    for (let k = 0; k < 8; k++) { await wait(100); if (offerCount() > avant) return true; }
    return false;
  }
  async function search(panel, name) {
    let input = panel.querySelector('input[type="search"]');
    if (!input) {
      panel.querySelector('button[aria-label="Search" i], button[aria-label*="search" i], button[aria-label*="recherch" i]')?.click();
      for (let k = 0; k < 10 && !input; k++) { await wait(80); input = panel.querySelector('input[type="search"]'); }
    }
    if (!input) return null;
    const before = input.value;
    setValue(input, name);
    return { input, before };
  }

  // Ce qui est déjà dans « Your Offer » : les boutons « Remove <nom> » de Roblox le disent. Un
  // observateur sur la seule offre (pas sur la page) remet les coches à jour quand elle change.
  const removeButtons = () => [...document.querySelectorAll('.trade-request-window-offer button[aria-label]')]
    .filter(b => /^(remove|retirer|supprimer)\b/i.test(b.getAttribute('aria-label') || ''));
  const nameOfRemove = (b) => (b.getAttribute('aria-label') || '').replace(/^(remove|retirer|supprimer)\s+/i, '').trim();
  function markOffer() {
    if (!shadow || !data?.items) return;
    const inOffer = new Set(removeButtons().map(nameOfRemove));
    shadow.querySelectorAll('.t').forEach(b => b.classList.toggle('in', inOffer.has(data.items[Number(b.dataset.k)]?.name)));
  }
  let offerObs = null, offerEl = null, markTimer = null;
  function watchOffer() {
    const el = document.querySelector('.trade-request-window-offer');
    if (el && el !== offerEl) {
      offerObs?.disconnect();
      offerEl = el;
      offerObs = new MutationObserver(() => { clearTimeout(markTimer); markTimer = setTimeout(markOffer, 80); });
      offerObs.observe(el, { childList: true, subtree: true });
    }
    markOffer();
  }
  async function removeFromOffer(tile, it) {
    const b = removeButtons().find(x => nameOfRemove(x) === it.name);
    if (!b) return quickAdd(tile, it);
    b.click();
    say('ok', L('Retiré', 'Removed'));
  }

  async function quickAdd(tile, it) {
    if (!it || tile.classList.contains('busy')) return;
    tile.classList.remove('ok', 'miss'); tile.classList.add('busy');
    let ok = false, why = 'missing';
    try {
      const panel = myPanel();
      let card = panel && cardFor(panel, it);
      if (card) ok = await addCard(card);
      else if (panel && it.name) {
        // Pas sur la page affichée : la recherche de Roblox le trouve, on l'ajoute, puis on remet la liste.
        const s = await search(panel, it.name);
        if (s) {
          for (let k = 0; k < 30 && !card; k++) { await wait(100); card = cardFor(panel, it); }
          if (card) ok = await addCard(card);
          else if ([...panel.querySelectorAll('.trade-inventory-card.is-unavailable')].some(c => (c.textContent || '').includes(it.name))) why = 'hold';
          setValue(s.input, s.before);
        }
      }
    } catch { /* page en plein changement : on le dit comme un échec */ }
    tile.classList.remove('busy');
    tile.classList.add(ok ? 'ok' : 'miss');
    say(ok ? 'ok' : 'miss', ok ? L('Ajouté', 'Added')
      : why === 'hold' ? L('En attente (hold)', 'On hold') : L('Plus dans ton inventaire', 'Not in your inventory'));
    setTimeout(() => tile.classList.remove('ok', 'miss'), 1600);
  }
  let labelTimer = null;
  function say(cls, text) {
    const lbl = shadow?.querySelector('.lbl');
    if (!lbl) return;
    clearTimeout(labelTimer);
    lbl.className = 'lbl ' + cls; lbl.textContent = text;
    labelTimer = setTimeout(() => { lbl.className = 'lbl'; lbl.textContent = LABEL; }, 1800);
  }

  function ask(pid) {
    if (asking || (data && dataFor === pid)) return;
    asking = true; dataFor = pid;
    Promise.resolve(B.runtime.sendMessage({ type: 'ronote:sent-history', partnerId: pid }))
      .then(r => {
        data = r && !r.off ? r : (r?.off ? null : { error: true });
        if (r?.off) enabled = false;
        // Le rattrapage des trades déjà envoyés tourne encore : une seule redemande, quand il a dû finir.
        if (r?.refreshing) setTimeout(() => { if (dataFor === pid && data === r) { data = null; dataFor = 0; tick(); } }, 6000);
      },
        () => { data = { error: true }; })
      .finally(() => { asking = false; if (enabled) place(); else host?.remove(); });
  }

  // Titre introuvable (page en chargement, mise en page changée) : on cherche de moins en moins
  // souvent, pour ne pas parcourir la page toutes les 1,2 s pour rien.
  let misses = 0, ticks = 0;
  function place() {
    if (misses > 8 && ++ticks % 5) return;
    const title = globalThis.RoNoteDom?.composerTitle?.();
    if (!title) { misses++; return; }
    misses = 0;
    if (!host) {
      host = document.createElement('div');
      host.setAttribute('data-ronote', 'sent-history');
      shadow = host.attachShadow({ mode: 'closed' });
    }
    if (!host.isConnected || host.previousElementSibling !== title) title.insertAdjacentElement('afterend', host);
    draw();
  }

  let lastUrl = '';
  function tick() {
    if (!enabled || !alive()) return;
    const pid = partnerOf();
    if (!pid) { if (host?.isConnected) host.remove(); lastUrl = location.href; return; }
    if (location.href !== lastUrl) { lastUrl = location.href; misses = 0; if (dataFor !== pid) { data = null; dataFor = 0; } }
    ask(pid);
    if (!host?.isConnected) place();
    else if (offerEl && !offerEl.isConnected) watchOffer();
  }
  timer = setInterval(tick, 1200);
})();
