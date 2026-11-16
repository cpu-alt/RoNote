/**
 * ==========================================================================
 *  LES JOUEURS GARDÉS DANS LA BARRE DE GAUCHE DE ROBLOX
 * --------------------------------------------------------------------------
 *  Sous le dernier lien de la barre (Buy Gift Cards…) : les joueurs « à
 *  envoyer plus tard » puis les favoris (réglages `laterUsers` / `favUsers`),
 *  avatar + pseudo. Un clic ouvre la fenêtre de trade (plus tard) ou le profil.
 *
 *  La barre est repérée par ses liens /trades et /giftcards, pas par ses
 *  classes : Roblox les renomme. Shadow DOM fermé, comme la carte de profil.
 * ==========================================================================
 */
(() => {
  const B = globalThis.browser ?? globalThis.chrome;
  if (!B || globalThis.__rnNavPlayers) return;
  globalThis.__rnNavPlayers = true;

  const fr = (document.documentElement.lang || navigator.language || '').toLowerCase().startsWith('fr');
  const L = (f, e) => (fr ? f : e);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const MAX = 8;   // par liste : la barre n'est pas un carnet d'adresses

  let lists = { later: [], favs: [] };
  let host = null, root = null, timer = null;

  const alive = () => { try { return !!B?.runtime?.id; } catch { return false; } };

  /** Le dernier élément de la barre : l'ancêtre commun des liens Trade et Gift Cards, puis son dernier enfant. */
  function navList() {
    const trade = document.querySelector('a[href*="/trades"]');
    const gift = document.querySelector('a[href*="/giftcards"]') || document.querySelector('a[href*="/upgrades"]');
    if (!trade || !gift) return null;
    let p = trade.parentElement;
    while (p && !p.contains(gift)) p = p.parentElement;
    return p && p !== document.body ? p : null;
  }

  const row = (u, later) => {
    const name = u.name || '#' + u.id;
    const url = later ? `https://www.roblox.com/users/${u.id}/trade` : `https://www.roblox.com/users/${u.id}/profile`;
    return `<a class="u" href="${esc(url)}" title="${esc(name)}">
      <span class="av">${u.thumb ? `<img src="${esc(u.thumb)}" alt="" loading="lazy">` : ''}<i>${esc(name.slice(0, 1).toUpperCase())}</i></span>
      <span class="n">${esc(name)}</span>${later ? `<span class="tag">${L('Trade', 'Trade')}</span>` : ''}</a>`;
  };

  function html() {
    const part = (title, us, later) => (us.length
      ? `<div class="h">${title}</div>${us.slice(0, MAX).map(u => row(u, later)).join('')}` : '');
    return `<style>
      :host { display: block; margin: 10px 0 6px; padding-top: 10px; border-top: 1px solid #ffffff1f; font-family: inherit; }
      .h { margin: 6px 12px 4px; font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: #ffffff99; }
      .u { display: flex; align-items: center; gap: 12px; padding: 6px 12px; border-radius: 10px; color: #fff; text-decoration: none; font-size: 14px; font-weight: 600; }
      .u:hover { background: #ffffff14; }
      .av { position: relative; flex: none; width: 26px; height: 26px; border-radius: 50%; overflow: hidden; background: #ffffff1f; display: grid; place-items: center; }
      .av img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .av i { font-style: normal; font-size: 12px; color: #ffffffb3; }
      .n { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .tag { flex: none; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 6px; background: #ffb02e33; color: #ffb02e; }
      .e { margin: 0 12px; font-size: 12px; color: #ffffff80; line-height: 1.4; }
    </style>${lists.later.length || lists.favs.length
      ? part(L('À envoyer plus tard', 'Send later'), lists.later, true) + part(L('Favoris', 'Favorites'), lists.favs, false)
      : `<div class="h">${L('Joueurs gardés', 'Saved players')}</div><div class="e">${L('Ajoute-les depuis le popup RoNote (⭐ ou 🕒).', 'Add them from the RoNote popup (⭐ or 🕒).')}</div>`}`;
  }

  function place() {
    if (!alive()) { observer.disconnect(); host?.remove(); return; }
    const nav = navList();
    if (!nav) return;
    if (!host) {
      host = document.createElement('div');
      host.id = 'ronote-nav-players';
      root = host.attachShadow({ mode: 'closed' });
    }
    root.innerHTML = html();
    if (host.parentElement !== nav || nav.lastElementChild !== host) nav.appendChild(host);
  }

  const schedule = () => { clearTimeout(timer); timer = setTimeout(place, 250); };

  async function load() {
    try {
      const { settings } = await B.storage.local.get('settings');
      const ok = (a) => (Array.isArray(a) ? a.filter(u => Number(u?.id) > 0) : []);
      lists = { later: ok(settings?.laterUsers), favs: ok(settings?.favUsers) };
    } catch { lists = { later: [], favs: [] }; }
    place();
  }

  // La barre se redessine avec l'application Roblox : on se remet en bas quand on a été délogé.
  const observer = new MutationObserver(() => {
    const nav = host?.parentElement;
    if (!nav || !host.isConnected || nav.lastElementChild !== host) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  B.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.settings && alive()) load(); });
  load();
})();
