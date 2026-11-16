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

  const svg = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  const ICON = {
    trade: svg('M7 7h13l-4-4M17 17H4l4 4'),
    roblox: svg('M6.5 3.5 20.5 7 17 20.5 3.5 17zM10.5 9.5l4 1-1 4-4-1z'),
  };
  const roliLogo = (() => { try { return B.runtime.getURL('assets/rolimons-logo.webp'); } catch { return ''; } })();
  ICON.roli = roliLogo ? `<img class="logo" src="${roliLogo}" alt="">` : svg('M4 20V10M10 20V4M16 20v-7M22 20H2');
  const row = (u, later) => {
    const name = u.name || '#' + u.id;
    const base = `https://www.roblox.com/users/${u.id}`;
    const btn = (href, icon, label, ext) =>
      `<a class="b" href="${esc(href)}" title="${esc(label)}" aria-label="${esc(label)}"${ext ? ' target="_blank" rel="noopener"' : ''}>${ICON[icon]}</a>`;
    return `<div class="u${later ? ' later' : ''}">
      <a class="who" href="${esc(later ? base + '/trade' : base + '/profile')}" title="${esc(name)}">
        <span class="av">${u.thumb ? `<img src="${esc(u.thumb)}" alt="" loading="lazy">` : ''}<i>${esc(name.slice(0, 1).toUpperCase())}</i></span>
        <span class="n">${esc(name)}</span></a>
      ${btn(base + '/trade', 'trade', L('Envoyer un trade', 'Send a trade'))}
      ${btn(base + '/profile', 'roblox', L('Profil Roblox', 'Roblox profile'))}
      ${btn(`https://www.rolimons.com/player/${u.id}`, 'roli', "Rolimon's", true)}
    </div>`;
  };

  function html() {
    const part = (title, us, later) => (us.length
      ? `<div class="h">${title}</div>${us.slice(0, MAX).map(u => row(u, later)).join('')}` : '');
    return `<style>
      :host { display: block; margin: 10px 0 6px; padding-top: 10px; border-top: 1px solid #ffffff1f; font-family: inherit; }
      .h { margin: 6px 12px 4px; font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: #ffffff99; }
      .u { display: flex; align-items: center; gap: 2px; padding: 0 6px 0 0; border-radius: 10px; }
      .u:hover { background: #ffffff14; }
      .who { flex: 1; min-width: 0; display: flex; align-items: center; gap: 12px; padding: 6px 4px 6px 12px; color: #fff; text-decoration: none; font-size: 14px; font-weight: 600; }
      .b { flex: none; width: 24px; height: 24px; display: grid; place-items: center; border-radius: 7px; color: #ffffff8c; }
      .b:hover { color: #fff; background: #ffffff1f; }
      .later .b:first-of-type { color: #ffb02e; }
      .b .logo { width: 15px; height: 15px; border-radius: 3px; opacity: .75; }
      .b:hover .logo { opacity: 1; }
      .b svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
      .av { position: relative; flex: none; width: 26px; height: 26px; border-radius: 50%; overflow: hidden; background: #ffffff1f; display: grid; place-items: center; }
      .av img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
      .av i { font-style: normal; font-size: 12px; color: #ffffffb3; }
      .n { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
