/**
 * ==========================================================================
 *  L'HISTORIQUE D'ENVOI SUR LA PAGE « TRADE WITH … »
 * --------------------------------------------------------------------------
 *  Sous le titre de la page d'envoi (/users/{id}/trade), une bande repliable :
 *  les objets donnés dans mes derniers trades envoyés, ceux faits avec ce
 *  joueur en tête, avec leur issue (ouvert, accepté, refusé, contré, expiré).
 *  RoNote premium Insider / Elite, désactivé par défaut (Réglages › Page d'un
 *  trade › Historique d'envoi).
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

  let enabled = false, open = true, tab = 'items', timer = null;
  let host = null, shadow = null, data = null, dataFor = 0, asking = false, pending = null;

  /* ------------------------------ réglages ------------------------------ */
  const apply = (s) => {
    const was = enabled;
    enabled = s?.sentHistory === true;
    if (!enabled) { host?.remove(); host = null; data = null; dataFor = 0; }
    if (enabled && !was) { data = null; dataFor = 0; tick(); }
  };
  try {
    B.storage?.local?.get(['settings', 'sentHistoryOpen', 'sentHistoryTab']).then(got => {
      open = got?.sentHistoryOpen !== false;
      tab = got?.sentHistoryTab === 'trades' ? 'trades' : 'items';
      apply(got?.settings);
    }).catch(() => {});
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
  const CSS = `
    :host{all:initial;display:block;width:100%;flex:0 0 100%;margin:10px 0 14px;color-scheme:dark}
    *{box-sizing:border-box}
    .box{font:500 13px/1.35 "Builder Sans","Gotham SSm",Arial,sans-serif;color:#eef0f6;border-radius:14px;
      background:linear-gradient(145deg,rgba(22,18,40,.72),rgba(12,10,24,.72));border:1px solid rgba(196,181,253,.18);
      box-shadow:inset 0 1px 0 rgba(255,255,255,.04),0 6px 18px rgba(0,0,0,.18);backdrop-filter:blur(6px);overflow:hidden}
    .hd{display:flex;align-items:center;gap:8px;width:100%;padding:9px 12px;background:none;border:0;color:inherit;font:inherit;cursor:pointer;text-align:left}
    .hd:hover{background:rgba(255,255,255,.03)}
    .ttl{font-weight:700;letter-spacing:.01em}
    .sub{opacity:.6;font-size:12px}
    .badge{margin-left:auto;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:2px 7px;border-radius:999px;
      background:linear-gradient(90deg,#7c3aed,#c026d3);color:#fff}
    .chev{width:8px;height:8px;border-right:2px solid currentColor;border-bottom:2px solid currentColor;transform:rotate(45deg);opacity:.6;margin:0 2px 3px 6px;transition:transform .2s}
    .closed .chev{transform:rotate(-45deg);margin-bottom:0}
    .closed>:not(.hd){display:none}
    .bd{display:flex;gap:8px;overflow-x:auto;padding:2px 12px 12px;scrollbar-width:thin;scroll-snap-type:x proximity}
    .tr{flex:none;scroll-snap-align:start;min-width:150px;max-width:260px;padding:8px 9px;border-radius:11px;
      background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07)}
    .tr.me{border-color:rgba(167,139,250,.55);background:rgba(124,58,237,.12)}
    .top{display:flex;align-items:center;gap:6px;font-size:11.5px;opacity:.85;white-space:nowrap}
    .top a{color:inherit;text-decoration:none;overflow:hidden;text-overflow:ellipsis;max-width:110px}
    .top a:hover{text-decoration:underline}
    .st{margin-left:auto;font-size:10px;font-weight:700;padding:1px 6px;border-radius:999px;background:rgba(255,255,255,.08)}
    .st.accepted{background:rgba(63,191,127,.22);color:#8af0bd}.st.declined,.st.expired{background:rgba(240,86,94,.18);color:#ffa3a8}
    .st.countered{background:rgba(250,204,21,.18);color:#fde68a}.st.open{background:rgba(125,211,252,.16);color:#bae6fd}
    .its{display:flex;gap:5px;margin-top:7px}
    .it{position:relative;width:40px;height:40px;flex:none;border-radius:9px;background:rgba(255,255,255,.06);overflow:hidden}
    .it img{width:100%;height:100%;object-fit:cover;display:block}
    .it .ph{display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:10px;opacity:.7}
    .more{display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:9px;background:rgba(255,255,255,.06);font-size:11px;opacity:.8}
    .tot{margin-top:6px;font-size:12px;font-weight:700;font-variant-numeric:tabular-nums}
    .tot small{font-weight:500;opacity:.6}
    .note{padding:2px 12px 12px;opacity:.7;font-size:12.5px}
    .lock{display:flex;align-items:center;gap:10px;padding:2px 12px 12px;font-size:12.5px;opacity:.9}
    .lock a{margin-left:auto;color:#fff;text-decoration:none;font-weight:700;padding:5px 10px;border-radius:8px;background:linear-gradient(90deg,#7c3aed,#c026d3)}
    .sk{height:72px;margin:2px 12px 12px;border-radius:11px;background:linear-gradient(90deg,rgba(255,255,255,.04),rgba(255,255,255,.09),rgba(255,255,255,.04));background-size:200% 100%;animation:sh 1.2s linear infinite}
    .tabs{display:inline-flex;gap:2px;padding:2px;border-radius:9px;background:rgba(255,255,255,.06);margin-left:4px}
    .tab{border:0;background:none;color:inherit;font:600 11.5px/1 inherit;font-family:inherit;padding:5px 9px;border-radius:7px;cursor:pointer;opacity:.65}
    .tab[aria-selected="true"]{background:rgba(167,139,250,.28);opacity:1}
    .grid{display:flex;gap:8px;overflow-x:auto;padding:2px 12px 12px;scrollbar-width:thin}
    .tile{position:relative;flex:none;width:68px;padding:5px 5px 6px;border-radius:11px;border:1px solid rgba(255,255,255,.08);
      background:rgba(255,255,255,.04);color:inherit;font:inherit;cursor:pointer;text-align:center;transition:border-color .15s,background .15s,transform .15s}
    .tile:hover,.tile:focus-visible{border-color:rgba(167,139,250,.7);background:rgba(124,58,237,.16);outline:none;transform:translateY(-1px)}
    .tile .pic{position:relative;display:block;width:56px;height:56px;margin:0 auto;border-radius:8px;overflow:hidden;background:rgba(255,255,255,.06)}
    .tile img{width:100%;height:100%;object-fit:cover;display:block}
    .tile .ph{display:flex;align-items:center;justify-content:center;width:100%;height:100%;font-size:11px;opacity:.75}
    .tile .plus{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;
      background:rgba(76,29,149,.55);opacity:0;transition:opacity .15s}
    .tile:hover .plus,.tile:focus-visible .plus{opacity:1}
    .tile .v{display:block;margin-top:4px;font-size:11.5px;font-weight:700;font-variant-numeric:tabular-nums}
    .tile .nm{display:block;font-size:10px;opacity:.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .tile .n{position:absolute;top:3px;right:3px;z-index:1;font-size:9.5px;font-weight:700;padding:1px 4px;border-radius:6px;background:rgba(0,0,0,.6)}
    .tile .dot{position:absolute;top:4px;left:4px;z-index:1;width:7px;height:7px;border-radius:50%;background:#c4b5fd;box-shadow:0 0 0 2px rgba(0,0,0,.4)}
    .tile.ok{border-color:#3fbf7f;background:rgba(63,191,127,.16)}
    .tile.miss{border-color:#f5a524;background:rgba(245,165,36,.12)}
    .tile.busy{opacity:.6;pointer-events:none}
    .hint{padding:0 12px 10px;font-size:11.5px;opacity:.75}
    .hint:empty{display:none}
    @keyframes sh{to{background-position:-200% 0}}
    @media(prefers-reduced-motion:reduce){.sk{animation:none}.chev,.tile,.tile .plus{transition:none}}`;

  const STATUS = { open: L('En cours', 'Open'), accepted: L('Accepté', 'Accepted'), declined: L('Refusé', 'Declined'),
    countered: L('Contré', 'Countered'), expired: L('Expiré', 'Expired') };
  function ago(at) {
    const m = Math.max(0, Math.round((Date.now() - at) / 60e3));
    if (m < 60) return L(`il y a ${m} min`, `${m}m ago`);
    const h = Math.round(m / 60);
    if (h < 48) return L(`il y a ${h} h`, `${h}h ago`);
    return L(`il y a ${Math.round(h / 24)} j`, `${Math.round(h / 24)}d ago`);
  }

  function body(pid) {
    if (!data || asking) return '<div class="sk"></div>';
    if (data.locked) {
      return `<div class="lock"><span>🔒 ${data.locked === 'login'
        ? L('Connecte RoNote premium pour voir ton historique d’envoi.', 'Sign in to RoNote premium to see your send history.')
        : L('Ton historique d’envoi : réservé aux abonnés Insider et Elite.', 'Your send history: for Insider and Elite subscribers.')}</span>
        <a href="https://discord.gg/neuronal" target="_blank" rel="noopener noreferrer">${L('Débloquer', 'Unlock')}</a></div>`;
    }
    const rows = data.rows || [];
    if (tab === 'items' && data.items?.length) {
      return `<div class="grid">${data.items.map((i, k) => `<button class="tile" type="button" data-k="${k}"
          title="${esc(i.name)} · ${esc(compact.format(i.value || 0))} · ${esc(L(`mis ${i.n} fois`, `offered ${i.n}×`))}${i.withThem ? ' · ' + esc(L('déjà proposé à ce joueur', 'already offered to this player')) : ''}">
        ${i.withThem ? '<span class="dot"></span>' : ''}${i.n > 1 ? `<span class="n">×${i.n}</span>` : ''}
        <span class="pic">${i.thumb && /^https:\/\//.test(i.thumb) ? `<img src="${esc(i.thumb)}" alt="" loading="lazy" decoding="async">`
          : `<span class="ph">${esc((i.acronym || i.name || '?').slice(0, 4))}</span>`}<span class="plus">+</span></span>
        <span class="v">${esc(compact.format(i.value || 0))}</span><span class="nm">${esc(i.acronym || i.name)}</span></button>`).join('')}</div>
        <div class="hint"></div>`;
    }
    if (!rows.length) {
      return `<div class="note">${data.error ? L('Historique indisponible pour l’instant.', 'History unavailable right now.')
        : L('Rien encore : chaque trade envoyé depuis cette page s’ajoutera ici.', 'Nothing yet: every trade you send from this page will show up here.')}</div>`;
    }
    return `<div class="bd">${rows.map(r => {
      const who = r.partnerId === pid ? L('avec lui', 'with them')
        : r.partnerId ? `<a href="https://www.roblox.com/users/${r.partnerId}/trade" title="${esc(r.handle)}">@${esc(r.handle || r.partnerId)}</a>` : '';
      const items = r.give.slice(0, 4).map(i => `<span class="it" title="${esc(i.name)} · ${esc(compact.format(i.value || 0))}">${
        i.thumb && /^https:\/\//.test(i.thumb) ? `<img src="${esc(i.thumb)}" alt="" loading="lazy" decoding="async">`
          : `<span class="ph">${esc((i.acronym || i.name || '?').slice(0, 3))}</span>`}</span>`).join('');
      const more = r.give.length > 4 ? `<span class="more">+${r.give.length - 4}</span>` : '';
      const robux = r.robux ? ` <small>+ R$ ${esc(compact.format(r.robux))}</small>` : '';
      return `<div class="tr${r.partnerId === pid ? ' me' : ''}"><div class="top"><span>${esc(ago(r.at))}</span>${who ? '<span>·</span>' : ''}${who ? (who.startsWith('<a') ? who : `<span>${who}</span>`) : ''}
        ${r.status ? `<span class="st ${esc(r.status)}">${esc(STATUS[r.status] || r.status)}</span>` : ''}</div>
        <div class="its">${items}${more}</div><div class="tot">${esc(compact.format(r.value || 0))} <small>value</small>${robux}</div></div>`;
    }).join('')}</div>`;
  }

  function draw(pid) {
    if (!shadow) return;
    const n = data?.rows?.length || 0;
    const mine = (data?.rows || []).filter(r => r.partnerId === pid).length;
    const sig = JSON.stringify([open, tab, asking, data && (data.locked || data.error || data.rows?.map(r => r.id + r.status + (r.give[0]?.thumb || '')))]);
    if (shadow._sig === sig) return;
    shadow._sig = sig;
    shadow.innerHTML = `<style>${CSS}</style><div class="box${open ? '' : ' closed'}">
      <div class="hd" role="button" tabindex="0" aria-expanded="${open}"><span class="ttl">↗ ${L('Envoi rapide', 'Quick add')}</span>
        ${data && !data.locked && n ? `<span class="tabs" role="tablist">
          <button class="tab" role="tab" data-tab="items" aria-selected="${tab === 'items'}">${L('Mes objets récents', 'My recent items')}</button>
          <button class="tab" role="tab" data-tab="trades" aria-selected="${tab === 'trades'}">${L('Trades', 'Trades')} · ${n}${mine ? ` (${mine} ${L('avec lui', 'w/ them')})` : ''}</button></span>` : ''}
        <span class="badge">RoNote</span><span class="chev"></span></div>${body(pid)}</div>`;
    const hd = shadow.querySelector('.hd');
    const toggle = () => {
      open = !open;
      try { B.storage.local.set({ sentHistoryOpen: open }); } catch { /* ignore */ }
      draw(pid);
    };
    hd.addEventListener('click', (e) => {
      const t = e.target.closest?.('[data-tab]');
      if (!t) return toggle();
      e.stopPropagation();
      tab = t.dataset.tab; open = true;
      try { B.storage.local.set({ sentHistoryTab: tab, sentHistoryOpen: true }); } catch { /* ignore */ }
      draw(pid);
    });
    hd.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === hd) { e.preventDefault(); toggle(); } });
    shadow.querySelectorAll('.tile').forEach(b => b.addEventListener('click', () => quickAdd(b, data.items[Number(b.dataset.k)])));
  }

  /* ---------------------------- l'ajout rapide --------------------------- */
  // Un clic sur une tuile remet l'objet dans « Your Offer » : on clique pour l'utilisateur sur sa
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
  async function quickAdd(tile, it) {
    if (!it || tile.classList.contains('busy')) return;
    const hint = shadow.querySelector('.hint');
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
    if (hint) hint.textContent = ok ? L(`${it.name} ajouté à ton offre.`, `${it.name} added to your offer.`)
      : L(`${it.name} n’est pas sur cette page de ton inventaire (ou n’y est plus) : change de page ou cherche-le.`,
        `${it.name} isn’t on this page of your inventory (or not anymore): turn the page or search for it.`);
    setTimeout(() => tile.classList.remove('ok', 'miss'), 1600);
  }

  function ask(pid) {
    if (asking || (data && dataFor === pid)) return;
    asking = true; dataFor = pid;
    Promise.resolve(B.runtime.sendMessage({ type: 'ronote:sent-history', partnerId: pid }))
      .then(r => { data = r && !r.off ? r : (r?.off ? null : { error: true }); if (r?.off) enabled = false; },
        () => { data = { error: true }; })
      .finally(() => { asking = false; if (enabled) place(pid); else host?.remove(); });
  }

  // Titre introuvable (page en chargement, mise en page changée) : on cherche de moins en moins
  // souvent, pour ne pas parcourir la page toutes les 1,2 s pour rien.
  let misses = 0, ticks = 0;
  function place(pid) {
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
    draw(pid);
  }

  let lastUrl = '';
  function tick() {
    if (!enabled || !alive()) return;
    const pid = partnerOf();
    if (!pid) { if (host?.isConnected) host.remove(); lastUrl = location.href; return; }
    if (location.href !== lastUrl) { lastUrl = location.href; misses = 0; if (dataFor !== pid) { data = null; dataFor = 0; } }
    ask(pid);
    if (!host?.isConnected) place(pid);
  }
  timer = setInterval(tick, 1200);
})();
