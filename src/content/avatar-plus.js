/**
 * Sous l'avatar de roblox.com/my/avatar, dans l'espace vide : ce que l'avatar porte
 * (vignettes) et le compte d'accessoires sur 10. Relu à chaque enregistrement de
 * l'éditeur (hook.js prévient). Lecture seule : retirer un item se fait dans l'éditeur,
 * qui garde ainsi ses coches justes.
 */
(() => {
  if (globalThis.__rnAvatarPlus || !/^\/my\/avatar/i.test(location.pathname)) return;
  globalThis.__rnAvatarPlus = true;

  const fr = (document.documentElement.lang || navigator.language || '').toLowerCase().startsWith('fr');
  const L = fr ? { worn: 'Porté', accs: 'accessoires' } : { worn: 'Wearing', accs: 'accessories' };
  const ACC = new Set([8, 41, 42, 43, 44, 45, 46, 47]);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const getJson = (url) => fetch(url, { credentials: 'include' }).then(r => (r.ok ? r.json() : null)).catch(() => null);

  const CSS = `:host{display:block;margin-top:14px;font:13px/1.3 "Builder Sans",system-ui,sans-serif;color:#fff}
    .card{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:10px}
    h4{margin:0 0 8px;font-size:14px;display:flex;justify-content:space-between}
    h4 small{font-weight:500;opacity:.7}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(48px,1fr));gap:6px}
    img{width:100%;aspect-ratio:1;border-radius:6px;background:rgba(255,255,255,.08);display:block}`;

  let host = null, root = null, seq = 0;

  async function refresh() {
    if (!root) return;
    const mine = ++seq;
    const worn = (await getJson('https://avatar.roblox.com/v2/avatar/avatar'))?.assets || [];
    const th = worn.length
      ? await getJson(`https://thumbnails.roblox.com/v1/assets?assetIds=${worn.map(a => a.id).join(',')}&size=110x110&format=Png`)
      : null;
    if (mine !== seq) return;               // un clic plus récent relit déjà
    const src = new Map((th?.data || []).map(t => [t.targetId, t.imageUrl || '']));
    const accs = worn.filter(a => ACC.has(a.assetType?.id)).length;
    root.innerHTML = `<style>${CSS}</style><div class="card"><h4>${L.worn}<small>${accs}/10 ${L.accs}</small></h4>
      <div class="grid">${worn.map(a => `<img alt="${esc(a.name)}" title="${esc(a.name)}"${src.get(a.id) ? ` src="${esc(src.get(a.id))}"` : ''}>`).join('')}</div></div>`;
  }

  const REDRAW_RE = /^(redraw|redessiner|redibujar|neu zeichnen|redesenhar|ridisegna)$/i;
  function mount() {
    if (host?.isConnected) return;
    const link = [...document.querySelectorAll('a, button, span')]
      .find(el => !el.childElementCount && REDRAW_RE.test((el.textContent || '').trim()));
    if (!link?.parentElement) return;
    host = host || document.createElement('div');
    root = root || host.attachShadow({ mode: 'open' });
    link.parentElement.after(host);
    refresh();
  }

  window.addEventListener('message', (e) => {
    if (e.source === window && e.data?.__ronote === 'avatar-changed') refresh();
  });
  new MutationObserver(mount).observe(document.documentElement, { childList: true, subtree: true });
  mount();
})();
