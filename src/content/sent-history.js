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
  // L'écran de counter d'un trade reçu (18 nov. : « https://www.roblox.com/trades/{id}/counter »).
  const COUNTER = /^(?:\/[a-z]{2}(?:[-_][a-z]{2})?)?\/trades\/(\d+)\/counter\/?$/i;
  const ctrPid = new Map();                    // id du trade -> partenaire (0 : demandé, pas encore connu)
  // Le partenaire : dans l'adresse (« /users/{id}/trade », envoi ou counter), sinon, sur /trades où Roblox
  // ouvre aussi l'écran de counter, lu sur la page. Là, on ne regarde qu'un tour sur trois tant que
  // l'écran n'est pas ouvert, et la réponse est gardée pour l'adresse en cours.
  let trPid = { url: '', pid: 0, at: 0 }, trTick = 0;
  // On compose un trade (envoi ou counter) quand l'inventaire à piocher est affiché : pas sur le simple
  // détail d'un trade reçu, envoyé ou terminé.
  const composing = () => [...document.querySelectorAll('.trade-inventory-panel')].some(e => e.offsetParent !== null) || !!globalThis.RoNoteDom?.myInventoryHeading?.();
  function partnerOf(fresh = false) {
    const m = PATH.exec(location.pathname);
    if (m) return Number(m[1]) || 0;
    const c = COUNTER.exec(location.pathname);
    if (c) {
      // Le partenaire vient du détail du trade que la page charge (le worker l'a déjà) : une question
      // par tour au plus tant qu'il n'est pas connu, puis la réponse est gardée.
      const tid = c[1];
      if (ctrPid.get(tid)) return ctrPid.get(tid);
      if (!ctrPid.has(tid) || fresh || ++trTick % 2 === 0) {
        ctrPid.set(tid, 0);
        Promise.resolve(B.runtime.sendMessage({ type: 'ronote:trade-partner', tradeId: tid }))
          .then(r => { if (Number(r?.partnerId)) { ctrPid.set(tid, Number(r.partnerId)); tick(); } }).catch(() => {});
      }
      // Pendant ce temps, la page elle-même (le @pseudo et son lien) peut suffire.
      try { const p = Number(globalThis.RoNoteDom?.readTradePage?.()?.partnerId) || 0; if (p) { ctrPid.set(tid, p); return p; } } catch { /* chargement */ }
      return 0;
    }
    if (!TRADES.test(location.pathname)) return 0;
    if (!fresh && trPid.url === location.href && (trPid.pid || ++trTick % 3)) return trPid.pid;
    let pid = 0;
    try {
      // Le détail d'un trade reçu porte aussi « Trade with … » : seulement l'écran où l'on compose.
      if (composing() && globalThis.RoNoteDom?.composerTitle?.()) pid = Number(globalThis.RoNoteDom.readTradePage()?.partnerId) || 0;
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
    .t.busy::after{opacity:1;content:"";background:rgba(46,16,101,.35)}
    .t.in{opacity:1;box-shadow:inset 0 0 0 1.5px #3fbf7f}
    .t .q{position:absolute;right:1px;top:1px;z-index:1;min-width:12px;height:12px;padding:0 3px;border-radius:6px;display:none;
      align-items:center;justify-content:center;font:700 8.5px/1 Arial,sans-serif;color:#fff;background:#2f9e6a;box-shadow:0 0 0 1px rgba(0,0,0,.35)}
    .t.in .q{display:flex}
    .t .pj{position:absolute;left:2px;top:2px;z-index:1;width:12px;height:12px;border-radius:3px;display:flex;align-items:center;justify-content:center;
      background:var(--pj);box-shadow:0 0 0 1px rgba(0,0,0,.35)}
    .t .pj svg{width:9px;height:9px}
    .t .rr{position:absolute;left:2px;bottom:2px;z-index:1;font-size:8px;line-height:1;filter:drop-shadow(0 0 1px #000)}
    .tip{font-size:11.5px;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
    .tip b{font-weight:700}.tip .p{color:var(--pj)}
    .muted{opacity:.5;font-size:11.5px}
    .muted a{color:inherit;text-decoration:underline;text-underline-offset:2px}
    .keys{opacity:.45;font-size:10.5px;white-space:nowrap}
    @media(prefers-reduced-motion:reduce){.t,.t::after,.lbl{transition:none}}`;
  const LABEL = L('Récents', 'Recent');
  // Le triangle du badge Projected (projected-badge.js), en miniature.
  const TRI = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8 1.6 21h20.8L12 2.8z" fill="none" stroke="#1a1200" stroke-width="3" stroke-linejoin="round"/><path d="M12 9.6v5" stroke="#1a1200" stroke-width="3" stroke-linecap="round"/><circle cx="12" cy="18" r="1.6" fill="#1a1200"/></svg>';

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
        i.rare ? '<span class="rr">💎</span>' : ''}${i.n > 1 ? `<span class="n">${i.n}</span>` : ''}<span class="q"></span></button>`).join('')}</div>
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
      // Clic : une copie de plus (les clics rapides s'enchaînent). Clic droit ou Maj+clic : une de moins.
      b.addEventListener('click', (e) => enqueue(b, it, e.shiftKey ? 'remove' : 'add'));
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); enqueue(b, it, 'remove'); });
      // Une infobulle sobre dans la ligne elle-même : nom, value, Projected, copies dans l'offre.
      const show = () => { if (!tip) return; tip.hidden = false; const q = inOffer.get(it.name) || 0;
        tip.innerHTML = `<b>${esc(it.name)}</b> · ${esc(compact.format(it.value || 0))}${
        it.projected ? ' · <span class="p">Projected</span>' : ''}${q ? ` · ${q} ${esc(L('dans ton offre', 'in your offer'))}` : ''}
        <span class="keys">· ${esc(L('clic +1 · clic droit −1', 'click +1 · right-click −1'))}</span>`; };
      b._show = show;
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
  // « Your Offer » et « Your Request » portent la même classe (relevé le 18 nov.) : la première est mon offre.
  const myOffer = () => document.querySelector('.trade-request-window-offer');
  const offerCount = () => myOffer()?.querySelectorAll('.trade-request-item .thumbnail-2d-container').length || 0;
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
  // Tout ce qui est posé dans la fenêtre de trade (mon offre ET ma demande) : un ajout d'un côté ou de l'autre le fait monter.
  const windowCount = () => document.querySelectorAll('.trade-request-item .thumbnail-2d-container').length;
  async function addCard(card) {
    const avant = windowCount();
    press(card);
    for (let k = 0; k < 10; k++) { await wait(60); if (windowCount() > avant) return true; }
    return false;
  }
  /**
   * Ajoute UNE copie de `it` depuis `panel` (mon inventaire ou celui du partenaire) : la carte libre
   * affichée, sinon par la recherche de Roblox. Rend 'ok' | 'all' | 'hold' | 'missing'.
   */
  async function addFrom(panel, it, inMine = 0) {
    let card = cardFor(panel, it);
    if (card) return (await addCard(card)) ? 'ok' : 'missing';
    if (!it.name) return 'missing';
    const st = await search(panel, it.name);
    if (!st) return 'missing';
    const shown = () => [...panel.querySelectorAll('.trade-inventory-card')].some(c => (c.textContent || '').includes(it.name));
    const settle = st.changed ? 13 : 1;
    for (let k = 0; k < 40 && !card; k++) { await wait(60); card = cardFor(panel, it); if (!card && k >= settle && shown()) break; }
    const res = card ? ((await addCard(card)) ? 'ok' : 'missing') : inMine > 0 ? 'all' : onHold(panel, it) ? 'hold' : 'missing';
    restoreSearchSoon();
    return res;
  }
  // La recherche reste ouverte un court instant après un ajout : un 2e clic sur le même objet reprend
  // ses résultats au lieu de relancer une recherche (~1 s), puis la liste revient comme avant.
  let searchState = null, restoreTimer = null;
  async function search(panel, name) {
    clearTimeout(restoreTimer);
    let input = panel.querySelector('input[type="search"]');
    if (!input) {
      panel.querySelector('button[aria-label="Search" i], button[aria-label*="search" i], button[aria-label*="recherch" i]')?.click();
      for (let k = 0; k < 10 && !input; k++) { await wait(60); input = panel.querySelector('input[type="search"]'); }
    }
    if (!input) return null;
    if (searchState && searchState.input !== input) {     // une autre recherche (l'autre inventaire) : l'ancienne revient tout de suite
      if (searchState.input.isConnected && searchState.input.value !== searchState.before) setValue(searchState.input, searchState.before);
      searchState = null;
    }
    if (!searchState) searchState = { input, before: input.value };
    searchState.changed = input.value !== name;
    if (searchState.changed) setValue(input, name);
    return searchState;
  }
  function restoreSearchSoon() {
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(() => {
      if (searchState?.input?.isConnected && searchState.input.value !== searchState.before) setValue(searchState.input, searchState.before);
      searchState = null;
    }, 1500);
  }
  // Une copie en hold porte la même classe qu'une copie déjà mise dans l'offre ; seul le texte « Holding » les distingue.
  const onHold = (panel, it) => [...panel.querySelectorAll('.trade-inventory-card.is-unavailable')]
    .some(c => (c.textContent || '').includes(it.name) && /holding|en attente/i.test(c.textContent || ''));

  // Ce qui est déjà dans « Your Offer » : les boutons « Remove <nom> » de Roblox le disent, un par copie.
  // Un observateur sur la seule offre (pas sur la page) remet les compteurs à jour quand elle change.
  const removeButtons = () => [...(myOffer()?.querySelectorAll('button[aria-label]') || [])]
    .filter(b => /^(remove|retirer|supprimer)\b/i.test(b.getAttribute('aria-label') || ''));
  const nameOfRemove = (b) => (b.getAttribute('aria-label') || '').replace(/^(remove|retirer|supprimer)\s+/i, '').trim();
  let inOffer = new Map();
  function markOffer() {
    if (!shadow || !data?.items) return;
    inOffer = new Map();
    for (const b of removeButtons()) { const n = nameOfRemove(b); inOffer.set(n, (inOffer.get(n) || 0) + 1); }
    shadow.querySelectorAll('.t').forEach(b => {
      const q = inOffer.get(data.items[Number(b.dataset.k)]?.name) || 0;
      b.classList.toggle('in', q > 0);
      const el = b.querySelector('.q');
      if (el && el.textContent !== String(q || '')) el.textContent = q ? String(q) : '';
    });
  }
  let offerObs = null, offerEl = null, markTimer = null;
  function watchOffer() {
    const el = document.querySelector('.trade-request-window-offer');
    if (el && el !== offerEl) {
      offerObs?.disconnect();
      offerEl = el;
      offerObs = new MutationObserver(() => { clearTimeout(markTimer); markTimer = setTimeout(markOffer, 60); });
      offerObs.observe(el, { childList: true, subtree: true });
    }
    markOffer();
  }

  // Les clics s'enchaînent dans l'ordre : deux clics rapides = deux copies, sans se marcher dessus.
  let queue = Promise.resolve();
  function enqueue(tile, it, op) {
    if (!it) return;
    tile.classList.add('busy');
    tile._pending = (tile._pending || 0) + 1;
    queue = queue.then(() => (op === 'remove' ? removeOne(tile, it) : addOne(tile, it))).catch(() => {})
      .finally(() => { if (--tile._pending <= 0) { tile._pending = 0; tile.classList.remove('busy'); } markOffer(); tile._show?.(); });
  }
  function removeOne(tile, it) {
    const b = removeButtons().filter(x => nameOfRemove(x) === it.name).pop();
    if (!b) { flash(tile, 'miss'); say('miss', L('Pas dans ton offre', 'Not in your offer')); return; }
    b.click();
    flash(tile, 'ok');
    say('ok', L('Retiré', 'Removed'));
  }
  async function addOne(tile, it) {
    const panel = myPanel();
    const why = panel ? await addFrom(panel, it, inOffer.get(it.name) || 0) : 'missing';
    const ok = why === 'ok';
    flash(tile, ok ? 'ok' : 'miss');
    const q = removeButtons().filter(x => nameOfRemove(x) === it.name).length;
    say(ok ? 'ok' : 'miss', ok ? (q > 1 ? L(`Ajouté · ${q} dans l'offre`, `Added · ${q} in offer`) : L('Ajouté', 'Added'))
      : why === 'all' ? L('Toutes tes copies sont déjà dans l’offre', 'All your copies are already in the offer')
        : why === 'hold' ? L('En attente (hold)', 'On hold') : L('Plus dans ton inventaire', 'Not in your inventory'));
  }
  function flash(tile, cls) {
    tile.classList.remove('ok', 'miss'); void tile.offsetWidth; tile.classList.add(cls);
    clearTimeout(tile._flash); tile._flash = setTimeout(() => tile.classList.remove('ok', 'miss'), 1200);
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
    // Le titre (« Trade with … », « Counter … ») ; sinon, sur un écran dont le titre change (counter),
    // juste au-dessus de « Your Inventory ».
    const title = globalThis.RoNoteDom?.composerTitle?.();
    const inv = title ? null : globalThis.RoNoteDom?.myInventoryHeading?.();
    if (!title && !inv) { misses++; return; }
    misses = 0;
    if (!host) {
      host = document.createElement('div');
      host.setAttribute('data-ronote', 'sent-history');
      shadow = host.attachShadow({ mode: 'closed' });
    }
    if (title) { if (!host.isConnected || host.previousElementSibling !== title) title.insertAdjacentElement('afterend', host); }
    else if (!host.isConnected || host.nextElementSibling !== inv) inv.insertAdjacentElement('beforebegin', host);
    draw();
  }

  /* ------------------------- le trade préparé (popup) ------------------------
   * 18 nov. : « Préparer le trade » sur une fiche Deals ou Profils range ce qu'il faut mettre de chaque
   * côté dans `storage.local.prepTrade` puis ouvre /users/{id}/trade. Ici, sur la page de CE joueur et
   * dans les 3 minutes, on l'ajoute : mes objets depuis mon inventaire, les siens depuis le sien. Une
   * seule fois (la demande est effacée avant de commencer). Indépendant de l'option « Envoi rapide ».
   */
  let prepping = false;
  async function prep(pid) {
    if (prepping || !pid) return;
    let got = null;
    try { got = await B.storage.local.get('prepTrade'); } catch { return; }
    const want = got?.prepTrade;
    if (!want || Number(want.uid) !== pid || Date.now() - (want.at || 0) > 180e3) return;
    const panels = document.querySelectorAll('.trade-inventory-panel');
    if (panels.length < 2) return;                       // la page n'est pas encore prête : au tour suivant
    prepping = true;
    try { await B.storage.local.remove('prepTrade'); } catch { /* ignore */ }
    const conv = (i) => ({ assetId: Number(i.assetId ?? i.id) || 0, bundleId: Number(i.bundleId) || 0, name: i.name || '' });
    let done = 0, total = 0;
    for (const [panel, list] of [[panels[0], want.mine || []], [panels[1], want.theirs || []]]) {
      for (const raw of list.slice(0, 8)) {
        total++;
        if ((await addFrom(panel, conv(raw))) === 'ok') done++;
      }
    }
    toast(done === total ? L(`Trade préparé : ${done} item${done > 1 ? 's' : ''} ajouté${done > 1 ? 's' : ''}`, `Trade ready: ${done} item${done > 1 ? 's' : ''} added`)
      : L(`Trade préparé : ${done}/${total} items (les autres ne sont pas dans l'inventaire)`, `Trade ready: ${done}/${total} items (the others aren't in the inventory)`), done === total);
    prepping = false;
  }
  function toast(text, ok) {
    const el = document.createElement('div');
    el.setAttribute('data-ronote', 'prep-toast');
    const sh = el.attachShadow({ mode: 'closed' });
    sh.innerHTML = `<style>:host{all:initial;position:fixed;z-index:2147483000;left:50%;bottom:24px;transform:translateX(-50%)}
      div{font:600 13px/1.3 "Builder Sans",Arial,sans-serif;color:#fff;padding:9px 14px;border-radius:10px;background:${ok ? '#1f6f4a' : '#7a5a12'};
      box-shadow:0 8px 24px #0008;animation:in .25s ease}@keyframes in{from{opacity:0;transform:translateY(8px)}}</style><div>${esc(text)}</div>`;
    document.body.append(el);
    setTimeout(() => el.remove(), 4000);
  }

  let lastUrl = '';
  function tick() {
    if (!alive()) return;
    if (!prepping && PATH.test(location.pathname)) prep(partnerOf());
    if (!enabled) return;
    const pid = partnerOf();
    if (!pid || !composing()) { if (host?.isConnected) host.remove(); lastUrl = location.href; return; }
    if (location.href !== lastUrl) { lastUrl = location.href; misses = 0; if (dataFor !== pid) { data = null; dataFor = 0; } }
    ask(pid);
    if (!host?.isConnected) place();
    else if (offerEl && !offerEl.isConnected) watchOffer();
  }
  timer = setInterval(tick, 1200);
})();
