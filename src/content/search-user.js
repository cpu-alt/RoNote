/**
 * ==========================================================================
 *  LE JOUEUR DANS LA BARRE DE RECHERCHE
 * --------------------------------------------------------------------------
 *  Quand le texte tapé dans la recherche de roblox.com est le pseudo exact
 *  d'un joueur, une fiche apparaît en tête de la liste déroulante : avatar,
 *  nom affiché, ancienneté, value / RAP / rang Rolimon's, liens Profil et Trade.
 *
 *  Économe : attente de 350 ms après la frappe, pseudo valide seulement
 *  (3-20 caractères), le service worker garde la réponse 10 min et la carte
 *  de profil 30 min (la même que sur le profil). Shadow DOM fermé.
 * ==========================================================================
 */
(() => {
  const B = globalThis.browser ?? globalThis.chrome;
  if (!B || globalThis.__rnSearchUser) return;
  globalThis.__rnSearchUser = true;

  const fr = (document.documentElement.lang || navigator.language || '').toLowerCase().startsWith('fr');
  const L = (f, e) => fr ? f : e;
  const full = new Intl.NumberFormat(fr ? 'fr-FR' : 'en-US', { maximumFractionDigits: 0 });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const alive = () => { try { return !!B.runtime?.id; } catch { return false; } };
  const ask = (msg) => alive() ? B.runtime.sendMessage(msg).catch(() => null) : Promise.resolve(null);

  let enabled = true;
  B.storage?.local?.get('settings').then(g => { enabled = g?.settings?.profileCard !== false; }).catch(() => {});
  B.storage?.onChanged?.addListener((c, area) => {
    if (area === 'local' && c.settings) { enabled = c.settings.newValue?.profileCard !== false; if (!enabled) hide(); }
  });

  const CSS = `
    :host{display:block;contain:content}
    *{box-sizing:border-box}
    .c{display:flex;align-items:center;gap:12px;padding:10px 14px;color:#f3f0ff;text-decoration:none;
      font:14px/1.3 "Builder Sans","Gotham SSm",system-ui,sans-serif;font-variant-numeric:tabular-nums;
      background:linear-gradient(90deg,rgba(167,139,250,.22),rgba(125,211,252,.10));border-bottom:1px solid rgba(255,255,255,.1)}
    .av{flex:none;width:48px;height:48px;border-radius:50%;object-fit:cover;background:rgba(255,255,255,.1)}
    .id{min-width:0;flex:1 1 auto}
    .dn{font-weight:800;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .dn svg{width:14px;height:14px;vertical-align:-2px;margin-left:4px}
    .un{opacity:.7;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .st{display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:3px;font-size:12px}
    .st b{font-weight:800}.st .k{opacity:.6}
    .tag{color:#fca5a5;font-weight:800;text-transform:uppercase;font-size:11px}
    .sk{display:inline-block;width:120px;height:10px;border-radius:5px;background:rgba(255,255,255,.12)}
    .acts{display:flex;gap:6px;flex:none}
    .b{display:inline-flex;align-items:center;height:30px;padding:0 12px;border-radius:999px;color:inherit;font-weight:700;
      font-size:12.5px;text-decoration:none;background:rgba(255,255,255,.12);transition:background .15s}
    .b:hover{background:rgba(255,255,255,.22)}
    .b.p{background:rgba(167,139,250,.45)}.b.p:hover{background:rgba(167,139,250,.65)}
    .b:focus-visible{outline:2px solid #a78bfa;outline-offset:2px}
    @media (prefers-reduced-motion:reduce){.b{transition:none}}`;
  const CHECK = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="8" fill="#3b82f6"/><path d="m4.5 8.2 2.3 2.3 4.7-4.8" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  let host = null, shadow = null, input = null, timer = 0, shown = '', seq = 0;

  function age(t) {
    if (!t) return '';
    const y = (Date.now() - t) / (365.25 * 864e5);
    if (y >= 1) return L(`${Math.floor(y)} an${y >= 2 ? 's' : ''}`, `${Math.floor(y)} yr${y >= 2 ? 's' : ''}`);
    const d = Math.floor((Date.now() - t) / 864e5);
    return L(`${d} j`, `${d}d`);
  }

  function draw(u, card) {
    const id = Number(u.id);
    const stats = [];
    if (u.created) stats.push(`<span><span class="k">${L('Compte', 'Account')}</span> <b>${esc(age(u.created))}</b></span>`);
    if (card === undefined) stats.push('<span class="sk"></span>');
    else if (card) {
      stats.push(`<span><span class="k">Value</span> <b>${esc(full.format(card.value || 0))}</b></span>`,
        `<span><span class="k">RAP</span> <b>${esc(full.format(card.rap || 0))}</b></span>`);
      if (card.rank) stats.push(`<span><b>#${esc(full.format(card.rank))}</b></span>`);
      if (card.count) stats.push(`<span><b>${esc(full.format(card.count))}</b> <span class="k">limiteds</span></span>`);
      if (card.private) stats.push(`<span class="tag">${L('Inventaire privé', 'Private inventory')}</span>`);
    }
    if (u.banned) stats.push(`<span class="tag">${L('Banni', 'Terminated')}</span>`);
    const prof = `https://www.roblox.com/users/${id}/profile`;
    return `<style>${CSS}</style><div class="c">
      ${/^https:\/\//.test(u.thumb) ? `<img class="av" src="${esc(u.thumb)}" alt="">` : '<span class="av"></span>'}
      <div class="id"><div class="dn">${esc(u.displayName || u.name)}${u.verified ? CHECK : ''}</div>
        <div class="un">@${esc(u.name)}</div><div class="st">${stats.join('')}</div></div>
      <div class="acts"><a class="b p" href="${prof}">${L('Profil', 'Profile')}</a>
        <a class="b" href="https://www.roblox.com/users/${id}/trade">Trade</a></div></div>`;
  }

  // La liste déroulante de Roblox : on s'y glisse en tête ; sinon, juste sous le champ.
  function mount() {
    if (!host) {
      host = document.createElement('div');
      host.className = 'ronote-search-user';
      shadow = host.attachShadow({ mode: 'closed' });
      // Un clic dans la fiche ne doit pas fermer la liste avant la navigation.
      host.addEventListener('mousedown', e => e.preventDefault());
    }
    const box = input.closest('form, [class*="search" i]')?.parentElement || input.parentElement;
    const list = box?.querySelector('ul[class*="dropdown" i], [role="listbox"], ul');
    if (list) {
      if (host.parentNode !== list || list.firstChild !== host) list.prepend(host);
      host.style.cssText = 'list-style:none';
    } else {
      const r = input.getBoundingClientRect();
      if (host.parentNode !== document.body) document.body.append(host);
      host.style.cssText = `position:fixed;z-index:2147483000;left:${r.left}px;top:${r.bottom + 4}px;width:${Math.max(r.width, 360)}px;border-radius:12px;overflow:hidden;box-shadow:0 12px 32px rgba(0,0,0,.35)`;
    }
  }
  function hide() { host?.remove(); shown = ''; }

  async function lookup(q) {
    const me = ++seq;
    const u = await ask({ type: 'ronote:search-user', query: q });
    if (me !== seq || !input) return;
    if (!u || u.error) { hide(); return; }
    shown = q;
    mount();
    shadow.innerHTML = draw(u, undefined);
    const res = await ask({ type: 'ronote:profile-card', userId: u.id });
    if (me !== seq || shown !== q) return;
    mount();
    shadow.innerHTML = draw(u, res?.card || null);
  }

  function onInput(e) {
    input = e.target;
    clearTimeout(timer);
    const q = input.value.trim().replace(/^@/, '').toLowerCase();
    if (!enabled || !/^[a-z0-9_]{3,20}$/.test(q)) { seq++; hide(); return; }
    if (q === shown) { mount(); return; }
    seq++;
    hide();
    timer = setTimeout(() => lookup(q), 350);
  }

  // Le champ de recherche de la barre du haut (#navbar-search-input, ou ses variantes).
  const isSearch = (t) => t instanceof HTMLInputElement &&
    (t.id === 'navbar-search-input' || (t.closest('#header, nav, [class*="navbar" i]') && /search/i.test(t.id + t.className + t.type + (t.placeholder || ''))));
  document.addEventListener('input', e => { if (isSearch(e.target)) onInput(e); }, true);
  document.addEventListener('focusin', e => { if (isSearch(e.target) && shown) { input = e.target; setTimeout(mount, 50); } }, true);
  document.addEventListener('focusout', e => { if (e.target === input) setTimeout(() => { if (document.activeElement !== input) host?.remove(); }, 150); }, true);
})();
