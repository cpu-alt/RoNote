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
  const partnerOf = () => Number(PATH.exec(location.pathname)?.[1]) || 0;

  let enabled = false, timer = null;
  let host = null, shadow = null, data = null, dataFor = 0, asking = false, pending = null;

  /* ------------------------------ réglages ------------------------------ */
  const apply = (s) => {
    const was = enabled;
    enabled = s?.sentHistory === true;
    if (!enabled) { host?.remove(); host = null; data = null; dataFor = 0; }
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
    if (!enabled || !partnerOf() || !e.target?.closest?.('button')) return;
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
    .lbl{flex:none;font-size:10.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;opacity:.5;transition:opacity .2s,color .2s}
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
    .muted{opacity:.5;font-size:11.5px}
    .muted a{color:inherit;text-decoration:underline;text-underline-offset:2px}
    @media(prefers-reduced-motion:reduce){.t,.t::after,.lbl{transition:none}}`;
  const LABEL = L('Récents', 'Recent');

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
      title="${esc(i.name)} · ${esc(compact.format(i.value || 0))}${i.n > 1 ? ' · ×' + i.n : ''}${i.withThem ? ' · ' + esc(L('déjà proposé à ce joueur', 'already offered to them')) : ''}"
      aria-label="${esc(L('Ajouter', 'Add'))} ${esc(i.name)}">${i.thumb && /^https:\/\//.test(i.thumb)
        ? `<img src="${esc(i.thumb)}" alt="" loading="lazy" decoding="async">`
        : `<span class="ph">${esc((i.acronym || i.name || '?').slice(0, 4))}</span>`}${i.n > 1 ? `<span class="n">${i.n}</span>` : ''}</button>`).join('')}</div>`;
  }

  function draw() {
    if (!shadow) return;
    const sig = JSON.stringify([data && (data.locked || data.error || (data.items || []).slice(0, SHOWN).map(i => i.name + i.n + (i.thumb || '')))]);
    if (shadow._sig === sig) return;
    shadow._sig = sig;
    const inner = content();
    host.style.display = inner ? '' : 'none';           // rien à montrer (chargement, erreur) : rien du tout
    shadow.innerHTML = `<style>${CSS}</style><div class="line"><span class="lbl">${LABEL}</span>${inner}</div>`;
    shadow.querySelectorAll('.t').forEach(b => b.addEventListener('click', () => quickAdd(b, data.items[Number(b.dataset.k)])));
  }

  /* ---------------------------- l'ajout rapide --------------------------- */
  // Un clic sur une vignette remet l'objet dans « Your Offer » : on clique pour l'utilisateur sur sa
  // carte dans « Your Inventory » (la page de Roblox fait le reste), puis on vérifie qu'il est arrivé.
  const sameItem = (it) => (x) => it.bundleId ? x.bundleId === it.bundleId : (!!x.assetId && x.assetId === it.assetId);
  const wait = (ms) => new Promise(r => setTimeout(r, ms));
  function offerCount(it) {
    try { return (globalThis.RoNoteDom.readTradePage()?.sides?.find(s => s.role === 'give')?.items || []).filter(sameItem(it)).length; }
    catch { return 0; }
  }
  function myCards(it) {
    const dom = globalThis.RoNoteDom;
    let page = null;
    try { page = dom.readTradePage(); } catch { /* page en chargement */ }
    const baskets = (page?.sides || []).map(s => s.root);
    const all = dom.inventoryItems?.(baskets) || [];
    const theirs = dom.theirInventoryHeading?.();
    return all.filter(x => sameItem(it)(x) && (!theirs || (x.card.compareDocumentPosition(theirs) & Node.DOCUMENT_POSITION_FOLLOWING)));
  }
  // Ce qu'on clique dans la carte : sa vignette hors lien (un lien ouvrirait la fiche de l'objet).
  const clickTarget = (card) => [...card.querySelectorAll('img')].find(img => !img.closest('a'))?.parentElement || card;
  let labelTimer = null;
  function say(cls, text) {
    const lbl = shadow?.querySelector('.lbl');
    if (!lbl) return;
    clearTimeout(labelTimer);
    lbl.className = 'lbl ' + cls; lbl.textContent = text;
    labelTimer = setTimeout(() => { lbl.className = 'lbl'; lbl.textContent = LABEL; }, 1800);
  }
  async function quickAdd(tile, it) {
    if (!it || tile.classList.contains('busy')) return;
    tile.classList.remove('ok', 'miss'); tile.classList.add('busy');
    let ok = false;
    try {
      const avant = offerCount(it);
      for (const x of myCards(it).slice(0, 3)) {         // une copie déjà dans l'offre : la suivante
        clickTarget(x.card).click();
        for (let k = 0; k < 6 && !ok; k++) { await wait(120); ok = offerCount(it) > avant; }
        if (ok) break;
      }
    } catch { /* page en plein changement : on le dit comme un échec */ }
    tile.classList.remove('busy');
    tile.classList.add(ok ? 'ok' : 'miss');
    say(ok ? 'ok' : 'miss', ok ? L('Ajouté', 'Added') : L('Pas sur cette page', 'Not on this page'));
    setTimeout(() => tile.classList.remove('ok', 'miss'), 1600);
  }

  function ask(pid) {
    if (asking || (data && dataFor === pid)) return;
    asking = true; dataFor = pid;
    Promise.resolve(B.runtime.sendMessage({ type: 'ronote:sent-history', partnerId: pid }))
      .then(r => { data = r && !r.off ? r : (r?.off ? null : { error: true }); if (r?.off) enabled = false; },
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
  }
  timer = setInterval(tick, 1200);
})();
