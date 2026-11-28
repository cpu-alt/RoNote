/**
 * ==========================================================================
 *  LE JOUEUR DANS LA BARRE DE RECHERCHE
 * --------------------------------------------------------------------------
 *  Quand le texte tapé dans la recherche de roblox.com est le pseudo exact
 *  d'un joueur, une ligne riche se glisse en tête des choix de Roblox :
 *  avatar et présence (en ligne, en jeu), nom affiché, rang Neuronal,
 *  ancienneté, value / RAP / rang Rolimon's, tes trades avec lui, favori,
 *  et les liens Profil, Trade, Rolimon's.
 *
 *  Économe : 220 ms après la frappe, pseudo valide seulement (3-20
 *  caractères). Les fiches déjà vues sont redessinées sans message (mémoire
 *  de l'onglet) ; le service worker garde la fiche 10 min (présence 1 min)
 *  et la carte de profil 30 min. Shadow DOM fermé, un seul observateur,
 *  branché seulement pendant qu'une fiche est affichée.
 * ==========================================================================
 */
(() => {
  const B = globalThis.browser ?? globalThis.chrome;
  if (!B || globalThis.__rnSearchUser) return;
  globalThis.__rnSearchUser = true;

  const fr = (document.documentElement.lang || navigator.language || '').toLowerCase().startsWith('fr');
  const L = (f, e) => fr ? f : e;
  const full = new Intl.NumberFormat(fr ? 'fr-FR' : 'en-US', { maximumFractionDigits: 0 });
  const compact = new Intl.NumberFormat(fr ? 'fr-FR' : 'en-US', { notation: 'compact', maximumFractionDigits: 1 });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const alive = () => { try { return !!B.runtime?.id; } catch { return false; } };
  const ask = (msg) => alive() ? B.runtime.sendMessage(msg).catch(() => null) : Promise.resolve(null);
  const asset = (p) => { try { return B.runtime.getURL(p); } catch { return ''; } };

  let enabled = true, favs = new Set();
  const readSettings = (s) => {
    enabled = s?.profileCard !== false;
    favs = new Set((Array.isArray(s?.favUsers) ? s.favUsers : []).map(u => Number(u?.id)));
  };
  B.storage?.local?.get('settings').then(g => readSettings(g?.settings)).catch(() => {});
  B.storage?.onChanged?.addListener((c, area) => {
    if (area !== 'local' || !c.settings) return;
    readSettings(c.settings.newValue);
    if (!enabled) hide(); else if (cur) paint();
  });

  const CSS = `
    :host{display:block;contain:content}
    *{box-sizing:border-box}
    .c{position:relative;display:flex;align-items:center;gap:12px;padding:9px 16px;color:#f3f0ff;cursor:pointer;
      font:14px/1.3 "Builder Sans","Gotham SSm",system-ui,sans-serif;font-variant-numeric:tabular-nums;
      background:linear-gradient(90deg,rgba(167,139,250,.24),rgba(125,211,252,.08) 70%,transparent);
      border-bottom:1px solid rgba(255,255,255,.1);transition:background .15s;animation:in .18s ease-out}
    .c:hover{background:linear-gradient(90deg,rgba(167,139,250,.36),rgba(125,211,252,.14) 70%,rgba(255,255,255,.03))}
    .c::before{content:"";position:absolute;left:0;top:8px;bottom:8px;width:3px;border-radius:0 3px 3px 0;
      background:linear-gradient(#c4b5fd,#7dd3fc)}
    .c.tier::before{background:linear-gradient(var(--rk1),var(--rk2))}
    @keyframes in{from{opacity:0;transform:translateY(-3px)}}
    .pic{position:relative;flex:none;width:46px;height:46px}
    .av{width:46px;height:46px;border-radius:50%;object-fit:cover;display:block;background:rgba(255,255,255,.1)}
    .c.tier .av{box-shadow:0 0 0 2px var(--rk1)}
    .dot{position:absolute;right:-1px;bottom:-1px;width:14px;height:14px;border-radius:50%;border:2.5px solid #2a1050}
    .on1{background:#3b82f6}.on2{background:#22c55e}.on3{background:#f97316}
    .id{min-width:0;flex:1 1 auto}
    .l1{display:flex;align-items:center;gap:6px;min-width:0}
    .dn{font-weight:800;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ck{flex:none;width:14px;height:14px}
    .un{opacity:.65;font-size:12.5px;white-space:nowrap}
    .tb{flex:none;height:18px;padding:0 7px;border-radius:999px;font-size:10px;font-weight:800;letter-spacing:.06em;
      text-transform:uppercase;line-height:18px;color:#0b0b14;background:linear-gradient(110deg,var(--rk1),var(--rk2))}
    .elite{--rk1:#5ce1e6;--rk2:#f5d27a}.insider{--rk1:#ff6b9d;--rk2:#ffc1d6}.tracker{--rk1:#00c2a8;--rk2:#8ff5e4}
    .st{display:flex;flex-wrap:wrap;gap:3px 12px;margin-top:3px;font-size:12px}
    .st b{font-weight:800}.st .k{opacity:.6}
    .st .v b{color:#c4b5fd}
    .good{color:#4ade80}.bad{color:#f87171}
    .tag{color:#fca5a5;font-weight:800;text-transform:uppercase;font-size:11px}
    .sk{display:inline-block;width:150px;height:10px;margin-top:3px;border-radius:5px;background:linear-gradient(90deg,
      rgba(255,255,255,.08) 25%,rgba(255,255,255,.18) 50%,rgba(255,255,255,.08) 75%);background-size:200% 100%;
      animation:sh 1.1s infinite linear}
    @keyframes sh{to{background-position:-200% 0}}
    .acts{display:flex;align-items:center;gap:6px;flex:none}
    .b{display:inline-flex;align-items:center;justify-content:center;gap:5px;height:30px;padding:0 12px;border:0;border-radius:999px;
      color:inherit;font:inherit;font-weight:700;font-size:12.5px;text-decoration:none;cursor:pointer;
      background:rgba(255,255,255,.12);transition:background .15s,transform .15s}
    .b:hover{background:rgba(255,255,255,.22);transform:translateY(-1px)}
    .b.p{background:rgba(167,139,250,.5)}.b.p:hover{background:rgba(167,139,250,.7)}
    .b.i{width:30px;padding:0}
    .b img{width:16px;height:16px;border-radius:50%;display:block}
    .b.fav{font-size:15px;line-height:1}.b.fav.on{color:#ffb02e;background:rgba(255,176,46,.2)}
    .b:focus-visible{outline:2px solid #a78bfa;outline-offset:2px}
    @media (max-width:560px){.hide-s{display:none}}
    @media (prefers-reduced-motion:reduce){.c,.sk{animation:none}.b,.c{transition:none}}`;
  const CHECK = '<svg class="ck" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="8" fill="#3b82f6"/><path d="m4.5 8.2 2.3 2.3 4.7-4.8" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const TIERS = { elite: 'Elite', insider: 'Insider', tracker: 'Tracker' };
  const PRESENCE = [null, ['on1', L('En ligne', 'Online')], ['on2', L('En jeu', 'In game')], ['on3', L('Dans Studio', 'In Studio')]];

  let host = null, shadow = null, input = null, timer = 0, seq = 0;
  let cur = null;                 // { q, u, card } : la fiche affichée
  const memo = new Map();         // pseudo → { u, card, at } : mémoire de l'onglet (2 min)

  function age(t) {
    if (!t) return '';
    const d = (Date.now() - t) / 864e5;
    if (d >= 365) { const y = Math.floor(d / 365.25); return L(`${y} an${y > 1 ? 's' : ''}`, `${y} yr${y > 1 ? 's' : ''}`); }
    if (d >= 60) return L(`${Math.floor(d / 30)} mois`, `${Math.floor(d / 30)} mo`);
    return L(`${Math.floor(d)} j`, `${Math.floor(d)}d`);
  }

  function html({ u, card }) {
    const id = Number(u.id);
    const tier = card?.tier && TIERS[card.tier] ? card.tier : '';
    const pres = PRESENCE[u.presence] || null;
    const st = [];
    if (card === undefined) st.push('<span class="sk"></span>');
    else {
      if (card) {
        st.push(`<span class="v"><span class="k">Value</span> <b>${esc(full.format(card.value || 0))}</b></span>`,
          `<span><span class="k">RAP</span> <b>${esc(full.format(card.rap || 0))}</b></span>`);
        if (card.rank) st.push(`<span title="${esc(L('Rang Rolimon’s', 'Rolimon’s rank'))}"><b>#${esc(full.format(card.rank))}</b></span>`);
        if (card.count) st.push(`<span class="hide-s"><b>${esc(full.format(card.count))}</b> <span class="k">limiteds</span></span>`);
        if (card.private) st.push(`<span class="tag">${L('Inventaire privé', 'Private inventory')}</span>`);
        const m = card.mine;
        if (m && (m.done || m.received || m.sent)) {
          const net = m.net ? ` <b class="${m.net > 0 ? 'good' : 'bad'}">${m.net > 0 ? '+' : '−'}${esc(compact.format(Math.abs(m.net)))}</b>` : '';
          st.push(`<span class="hide-s"><span class="k">${L('Avec toi', 'With you')}</span> <b>${m.done || 0}</b> ${L('conclu' + (m.done > 1 ? 's' : ''), 'done')}${net}</span>`);
        }
      }
      if (u.created) st.push(`<span class="hide-s"><span class="k">${L('Compte', 'Account')}</span> <b>${esc(age(u.created))}</b></span>`);
    }
    if (u.banned) st.push(`<span class="tag">${L('Banni', 'Terminated')}</span>`);
    const fav = favs.has(id);
    return `<div class="c${tier ? ' tier ' + tier : ''}" data-go="profile" role="link" tabindex="-1">
      <span class="pic">${/^https:\/\//.test(u.thumb) ? `<img class="av" src="${esc(u.thumb)}" alt="" decoding="async">` : '<span class="av"></span>'}
        ${pres ? `<span class="dot ${pres[0]}" title="${esc(pres[1])}"></span>` : ''}</span>
      <div class="id"><div class="l1"><span class="dn">${esc(u.displayName || u.name)}</span>${u.verified ? CHECK : ''}
          <span class="un">@${esc(u.name)}</span>${tier ? `<span class="tb ${tier}">${TIERS[tier]}</span>` : ''}</div>
        <div class="st">${st.join('')}</div></div>
      <div class="acts">
        <button class="b i fav${fav ? ' on' : ''}" type="button" data-go="fav" aria-pressed="${fav}"
          title="${esc(fav ? L('Retirer des favoris', 'Remove favorite') : L('Favori RoNote', 'RoNote favorite'))}">${fav ? '★' : '☆'}</button>
        <a class="b i hide-s" href="https://www.rolimons.com/player/${id}" target="_blank" rel="noopener noreferrer" data-go="ext"
          title="Rolimon's"><img src="${esc(asset('assets/rolimons-logo.webp'))}" alt=""></a>
        <a class="b" href="https://www.roblox.com/users/${id}/trade" data-go="trade">Trade</a>
        <a class="b p" href="https://www.roblox.com/users/${id}/profile" data-go="profile">${L('Profil', 'Profile')}</a></div></div>`;
  }

  // Redessine seulement si le rendu change (pas de clignotement des images).
  function paint() {
    if (!cur || !shadow) return;
    const out = html(cur);
    if (shadow._html === out) return;
    shadow._html = out;
    shadow.innerHTML = `<style>${CSS}</style>${out}`;
  }

  function ensureHost() {
    if (host) return;
    host = document.createElement('div');
    host.className = 'ronote-search-user';
    shadow = host.attachShadow({ mode: 'closed' });
    // Un clic dans la fiche ne doit pas fermer la liste (le champ perdrait le focus).
    host.addEventListener('mousedown', e => e.preventDefault());
    shadow.addEventListener('click', e => {
      const t = e.target.closest?.('[data-go]');
      if (!t || !cur) return;
      const id = Number(cur.u.id), go = t.dataset.go;
      if (go === 'ext') return;                         // Rolimon's : nouvel onglet, comportement normal
      e.preventDefault();
      if (go === 'fav') {
        const on = !favs.has(id);
        on ? favs.add(id) : favs.delete(id);
        paint();
        ask({ type: 'ronote:keep-user', key: 'favUsers', userId: id, on });
        return;
      }
      const url = `https://www.roblox.com/users/${id}/${go === 'trade' ? 'trade' : 'profile'}`;
      if (e.ctrlKey || e.metaKey || e.button === 1) window.open(url, '_blank', 'noopener'); else location.assign(url);
    });
  }

  // La ligne « … in People » (lien vers /search/users) : sa liste est celle des choix de Roblox.
  function findList() {
    let row = document.querySelector('a[href*="/search/users" i]');
    while (row && row.parentElement && row.parentElement.children.length < 3) row = row.parentElement;
    return row?.parentElement || null;
  }
  function mount() {
    ensureHost();
    const list = findList();
    if (list) {
      if (list.firstElementChild !== host) list.insertBefore(host, list.firstElementChild);
      host.dataset.row = '1';
      host.style.cssText = 'list-style:none;display:block;width:100%;background:#24103f';   // son propre fond : texte clair lisible aussi sur le Roblox en thème clair
      watch(list);
    } else if (input) {
      const r = input.getBoundingClientRect();
      if (host.parentNode !== document.body) document.body.append(host);
      delete host.dataset.row;
      host.style.cssText = `position:fixed;z-index:2147483000;left:${r.left}px;top:${r.bottom + 4}px;width:${Math.max(r.width, 420)}px;border-radius:12px;overflow:hidden;box-shadow:0 12px 32px rgba(0,0,0,.35);background:#24103f`;
    }
    paint();
  }

  // Roblox redessine sa liste à chaque frappe : on se remet en tête si on en est sorti.
  let mo = null, watched = null;
  function watch(list) {
    if (watched === list) return;
    mo?.disconnect();
    watched = list;
    mo = new MutationObserver(() => { if (cur && list.isConnected && list.firstElementChild !== host) list.insertBefore(host, list.firstElementChild); });
    mo.observe(list, { childList: true });
  }
  function hide() { host?.remove(); cur = null; mo?.disconnect(); mo = null; watched = null; }

  async function lookup(q) {
    const me = ++seq;
    const m = memo.get(q);
    if (m && Date.now() - m.at < 120e3) { cur = { q, u: m.u, card: m.card }; mount(); return; }
    const u = await ask({ type: 'ronote:search-user', query: q });
    if (me !== seq || !input) return;
    if (!u || u.error) { hide(); return; }
    cur = { q, u, card: undefined };
    mount();
    const res = await ask({ type: 'ronote:profile-card', userId: u.id });
    const card = res?.card || null;
    if (memo.size > 50) memo.clear();
    memo.set(q, { u, card, at: Date.now() });
    if (me !== seq || cur?.q !== q) return;
    cur.card = card;
    paint();
  }

  function onInput(e) {
    input = e.target;
    clearTimeout(timer);
    const q = input.value.trim().replace(/^@/, '').toLowerCase();
    if (!enabled || !/^[a-z0-9_]{3,20}$/.test(q)) { seq++; hide(); return; }
    if (cur?.q === q) { mount(); return; }
    seq++;
    hide();
    // Déjà vu dans cet onglet : tout de suite ; sinon après une courte pause de frappe.
    const m = memo.get(q);
    timer = setTimeout(() => lookup(q), m && Date.now() - m.at < 120e3 ? 0 : 220);
  }

  // Le champ de recherche de la barre du haut (#navbar-search-input, ou ses variantes).
  const isSearch = (t) => t instanceof HTMLInputElement &&
    (t.id === 'navbar-search-input' || (!!t.closest('#header, nav, [class*="navbar" i]') && /search/i.test(t.id + t.className + t.type + (t.placeholder || ''))));
  document.addEventListener('input', e => { if (isSearch(e.target)) onInput(e); }, true);
  document.addEventListener('focusin', e => { if (isSearch(e.target) && cur) { input = e.target; setTimeout(mount, 50); } }, true);
  document.addEventListener('focusout', e => {
    if (e.target === input) setTimeout(() => { if (document.activeElement !== input && host) { host.remove(); mo?.disconnect(); mo = null; watched = null; } }, 150);
  }, true);
})();
