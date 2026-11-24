/**
 * ==========================================================================
 *  LE MENU « ⋯ » DES CARTES D'AMIS
 * --------------------------------------------------------------------------
 *  Sur les pages Amis / Abonnements / Abonnés de roblox.com, un bouton ⋯ en
 *  haut à droite de chaque carte : envoyer un trade, profil, Rolimon's,
 *  favori RoNote, copier le pseudo ou l'ID, et — sur ta propre liste —
 *  retirer l'ami ; bloquer partout. Les deux actions définitives demandent
 *  une confirmation dans le menu.
 *
 *  Les requêtes partent directement vers Roblox avec ta session, comme le
 *  ferait le site (jeton CSRF de la page) ; rien ne passe par RoNote.
 *  Un seul observateur, actif seulement sur ces pages, et un seul menu
 *  partagé (shadow DOM fermé) au lieu d'un par carte.
 * ==========================================================================
 */
(() => {
  const B = globalThis.browser ?? globalThis.chrome;
  if (!B || globalThis.__rnFriendsMenu) return;
  globalThis.__rnFriendsMenu = true;

  const fr = (document.documentElement.lang || navigator.language || '').toLowerCase().startsWith('fr');
  const L = (f, e) => fr ? f : e;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const alive = () => { try { return !!B.runtime?.id; } catch { return false; } };
  const asset = (p) => { try { return B.runtime.getURL(p); } catch { return ''; } };

  const me = () => Number(document.querySelector('meta[name="user-data"]')?.dataset?.userid) || 0;
  // /users/friends, /users/{id}/friends, avec #!/following, #!/followers…
  const pageOwner = () => {
    const m = /^(?:\/[a-z]{2}(?:[-_][a-z]{2})?)?\/users\/(?:(\d+)\/)?friends\/?$/i.exec(location.pathname);
    return m ? (Number(m[1]) || me() || -1) : 0;
  };
  const ownList = () => pageOwner() === me() && !/follow|request/i.test(location.hash);

  let favs = new Set();
  const readFavs = (s) => { favs = new Set((Array.isArray(s?.favUsers) ? s.favUsers : []).map(u => Number(u?.id))); };
  B.storage?.local?.get('settings').then(g => readFavs(g?.settings)).catch(() => {});
  B.storage?.onChanged?.addListener((c, a) => { if (a === 'local' && c.settings) readFavs(c.settings.newValue); });

  /* ---- Requêtes Roblox : jeton CSRF de la page, renouvelé sur 403 ---- */
  let csrf = '';
  async function post(url) {
    csrf ||= document.querySelector('meta[name="csrf-token"]')?.dataset?.token || document.querySelector('meta[name="csrf-token"]')?.content || '';
    const send = () => fetch(url, { method: 'POST', credentials: 'include', headers: { 'x-csrf-token': csrf, 'Content-Type': 'application/json' }, body: '{}' });
    let r = await send();
    const fresh = r.headers.get('x-csrf-token');
    if (r.status === 403 && fresh) { csrf = fresh; r = await send(); }
    if (!r.ok) throw new Error('HTTP ' + r.status);
  }
  const ACTIONS = {
    unfriend: (id) => post(`https://friends.roblox.com/v1/users/${id}/unfriend`),
    block: (id) => post(`https://accountsettings.roblox.com/v1/users/${id}/block`)
  };

  /* ---- Le bouton ⋯ sur chaque carte ---- */
  const BTN_CSS = `:host{position:absolute;top:6px;right:6px;z-index:3}
    button{width:30px;height:30px;display:grid;place-items:center;border:0;border-radius:50%;cursor:pointer;color:#fff;
      background:rgba(0,0,0,.28);opacity:.55;transition:opacity .15s,background .15s,transform .15s}
    button:hover,button[aria-expanded=true]{opacity:1;background:rgba(167,139,250,.55);transform:scale(1.06)}
    button:focus-visible{opacity:1;outline:2px solid #a78bfa;outline-offset:2px}
    svg{width:16px;height:16px}`;
  const DOTS = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="3" cy="8" r="1.6" fill="currentColor"/><circle cx="8" cy="8" r="1.6" fill="currentColor"/><circle cx="13" cy="8" r="1.6" fill="currentColor"/></svg>';

  function cardOf(link) {
    // La carte : le premier ancêtre qui contient aussi l'avatar, sans englober d'autres profils.
    let el = link;
    for (let i = 0; i < 6 && el.parentElement; i++) {
      const p = el.parentElement;
      if (p.querySelectorAll('a[href*="/profile"]').length > 0 && new Set([...p.querySelectorAll('a[href*="/users/"]')].map(idOf)).size > 1) break;
      el = p;
      if (el.querySelector('img') && el.getBoundingClientRect().width > 160) return el;
    }
    return el.querySelector?.('img') ? el : null;
  }
  const idOf = (a) => Number(/\/users\/(\d+)/.exec(a.getAttribute('href') || '')?.[1]) || 0;

  function decorate() {
    if (!pageOwner() || !alive()) return;
    for (const a of document.querySelectorAll('a[href*="/users/"][href*="/profile"]:not([data-rn-fm])')) {
      a.dataset.rnFm = '1';
      const id = idOf(a);
      if (!id || id === me() || a.closest('#header, nav, header')) continue;
      const card = cardOf(a);
      if (!card || card.querySelector(':scope > .ronote-fm')) continue;
      if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
      const host = document.createElement('div');
      host.className = 'ronote-fm';
      const sh = host.attachShadow({ mode: 'closed' });
      sh.innerHTML = `<style>${BTN_CSS}</style><button type="button" aria-haspopup="menu" aria-expanded="false"
        title="${esc(L('Actions RoNote', 'RoNote actions'))}">${DOTS}</button>`;
      const btn = sh.querySelector('button');
      const name = () => (card.querySelector('[class*="username" i], [class*="handle" i]')?.textContent
        || [...card.querySelectorAll('*')].map(e => e.childNodes.length === 1 && e.textContent.trim()).find(t => t && t.startsWith('@')) || '')
        .trim().replace(/^@/, '');
      const display = () => (a.textContent || '').trim() || name();
      btn.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); toggle(btn, { id, name: name(), display: display(), card }); });
      card.append(host);
    }
  }

  /* ---- Le menu, unique et partagé ---- */
  const MENU_CSS = `
    :host{position:fixed;z-index:2147483000}
    *{box-sizing:border-box}
    .m{min-width:220px;padding:6px;border-radius:14px;color:#f3f0ff;
      font:13.5px/1.3 "Builder Sans","Gotham SSm",system-ui,sans-serif;
      background:linear-gradient(180deg,#2a1747,#1b0f30);border:1px solid rgba(255,255,255,.1);
      box-shadow:0 16px 40px rgba(0,0,0,.45);animation:in .14s ease-out;transform-origin:top right}
    @keyframes in{from{opacity:0;transform:scale(.96) translateY(-4px)}}
    .h{padding:6px 10px 8px;font-size:12px;opacity:.65;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
      border-bottom:1px solid rgba(255,255,255,.08);margin-bottom:4px}
    .h b{opacity:1;color:#fff;font-size:13px}
    button,a{display:flex;align-items:center;gap:10px;width:100%;height:34px;padding:0 10px;border:0;border-radius:9px;
      background:none;color:inherit;font:inherit;text-align:left;text-decoration:none;cursor:pointer}
    button:hover,a:hover,button:focus-visible,a:focus-visible{background:rgba(255,255,255,.09);outline:none}
    .i{width:18px;text-align:center;flex:none;font-size:14px}
    .i img{width:16px;height:16px;border-radius:50%;display:block;margin:auto}
    .sep{height:1px;margin:4px 6px;background:rgba(255,255,255,.08)}
    .danger{color:#fca5a5}.danger:hover{background:rgba(239,68,68,.16)}
    .ask{background:rgba(239,68,68,.22)!important;color:#fff;font-weight:700}
    .ok{color:#86efac}.err{color:#fca5a5}
    .note{padding:8px 10px;font-size:12.5px}
    @media (prefers-reduced-motion:reduce){.m{animation:none}}`;
  let menu = null, msh = null, openFor = null, armed = '';

  function ensureMenu() {
    if (menu) return;
    menu = document.createElement('div');
    msh = menu.attachShadow({ mode: 'closed' });
    msh.addEventListener('click', onMenuClick);
    menu.addEventListener('keydown', e => {
      if (e.key === 'Escape') { close(); openFor?.btn?.focus(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = [...msh.querySelectorAll('button,a')];
        const i = items.indexOf(msh.activeElement);
        items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      }
    });
  }

  function render(status = '') {
    const { id, name, display } = openFor.ctx;
    const fav = favs.has(id), own = ownList();
    const item = (go, icon, label, cls = '') => `<button type="button" data-go="${go}" class="${cls}" role="menuitem"><span class="i">${icon}</span>${label}</button>`;
    const link = (href, icon, label, ext) => `<a href="${href}" role="menuitem"${ext ? ' target="_blank" rel="noopener noreferrer"' : ''}><span class="i">${icon}</span>${label}</a>`;
    msh.innerHTML = `<style>${MENU_CSS}</style><div class="m" role="menu">
      <div class="h"><b>${esc(display)}</b>${name ? ` · @${esc(name)}` : ''}</div>
      ${link(`https://www.roblox.com/users/${id}/trade`, '⇄', L('Envoyer un trade', 'Send a trade'))}
      ${link(`https://www.roblox.com/users/${id}/profile`, '👤', L('Voir le profil', 'View profile'))}
      ${link(`https://www.rolimons.com/player/${id}`, `<img src="${esc(asset('assets/rolimons-logo.webp'))}" alt="">`, "Rolimon's", true)}
      ${item('fav', fav ? '★' : '☆', fav ? L('Retirer des favoris RoNote', 'Remove RoNote favorite') : L('Favori RoNote', 'RoNote favorite'))}
      <div class="sep"></div>
      ${name ? item('copy-name', '⧉', L('Copier le pseudo', 'Copy username')) : ''}
      ${item('copy-id', '#', L('Copier l’ID', 'Copy ID'))}
      <div class="sep"></div>
      ${own ? item('unfriend', '✕', armed === 'unfriend' ? L('Confirmer : retirer l’ami', 'Confirm: unfriend') : L('Retirer des amis', 'Unfriend'), 'danger' + (armed === 'unfriend' ? ' ask' : '')) : ''}
      ${item('block', '⛔', armed === 'block' ? L('Confirmer : bloquer', 'Confirm: block') : L('Bloquer', 'Block'), 'danger' + (armed === 'block' ? ' ask' : ''))}
      ${status ? `<div class="note">${status}</div>` : ''}</div>`;
  }

  function place() {
    const r = openFor.btn.getBoundingClientRect();
    const m = msh.querySelector('.m');
    const w = m.offsetWidth, h = m.offsetHeight;
    const left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8));
    const top = r.bottom + 6 + h > innerHeight - 8 ? Math.max(8, r.top - h - 6) : r.bottom + 6;
    menu.style.cssText = `position:fixed;z-index:2147483000;left:${left}px;top:${top}px`;
  }

  function toggle(btn, ctx) {
    if (openFor?.btn === btn) { close(); return; }
    close();
    ensureMenu();
    openFor = { btn, ctx };
    armed = '';
    btn.setAttribute('aria-expanded', 'true');
    document.body.append(menu);
    render();
    place();
    msh.querySelector('a,button')?.focus({ preventScroll: true });
  }
  function close() {
    if (!openFor) return;
    openFor.btn.setAttribute('aria-expanded', 'false');
    menu?.remove();
    openFor = null;
    armed = '';
  }

  async function onMenuClick(e) {
    const t = e.target.closest('[data-go], a');
    if (!t || !openFor) return;
    if (t.tagName === 'A') { if (!t.target) close(); return; }
    const go = t.dataset.go, { id, name, card } = openFor.ctx;
    if (go === 'copy-name' || go === 'copy-id') {
      try { await navigator.clipboard.writeText(go === 'copy-id' ? String(id) : name); } catch { /* refusé */ }
      render(`<span class="ok">✓ ${L('Copié', 'Copied')}</span>`); place();
      return;
    }
    if (go === 'fav') {
      const on = !favs.has(id);
      on ? favs.add(id) : favs.delete(id);
      if (alive()) B.runtime.sendMessage({ type: 'ronote:keep-user', key: 'favUsers', userId: id, on }).catch(() => {});
      render(); place();
      return;
    }
    if (go === 'unfriend' || go === 'block') {
      if (armed !== go) { armed = go; render(); place(); msh.querySelector(`[data-go="${go}"]`)?.focus(); return; }
      armed = '';
      render(`<span>${L('Un instant…', 'One moment…')}</span>`); place();
      try {
        await ACTIONS[go](id);
        render(`<span class="ok">✓ ${go === 'block' ? L('Bloqué', 'Blocked') : L('Retiré de tes amis', 'Unfriended')}</span>`); place();
        // La carte s'efface : Roblox ne recharge pas sa liste tout seul.
        if (go === 'unfriend' || ownList()) {
          card.style.transition = 'opacity .25s, transform .25s';
          card.style.opacity = '0'; card.style.transform = 'scale(.97)';
          setTimeout(() => { close(); card.style.display = 'none'; }, 700);
        }
      } catch (err) {
        render(`<span class="err">${L('Échec', 'Failed')} (${esc(err?.message || '?')})</span>`); place();
      }
    }
  }

  document.addEventListener('pointerdown', e => { if (openFor && !e.composedPath().some(n => n === menu || n === openFor.btn)) close(); }, true);
  addEventListener('scroll', () => { if (openFor) place(); }, { passive: true, capture: true });
  addEventListener('resize', () => openFor && place());
  addEventListener('hashchange', close);

  // Les cartes arrivent par pages (React) : un passage groupé toutes les 60 ms.
  let queued = false;
  const later = () => { if (queued) return; queued = true; setTimeout(() => { queued = false; decorate(); }, 60); };
  const mo = new MutationObserver(() => { if (pageOwner()) later(); });
  const start = () => { mo.observe(document.body, { childList: true, subtree: true }); later(); };
  if (document.body) start(); else addEventListener('DOMContentLoaded', start, { once: true });
})();
