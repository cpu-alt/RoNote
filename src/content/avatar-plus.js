/**
 * ==========================================================================
 *  L'ÉDITEUR D'AVATAR AUGMENTÉ (roblox.com/my/avatar, 26 novembre)
 * --------------------------------------------------------------------------
 *  Dans l'espace vide sous « Redraw », un panneau RoNote :
 *   - Porté : ce que l'avatar porte, avec × pour retirer un objet ;
 *   - Ajouter : tes accessoires (inventaire), cherchables ; un clic les porte
 *     SANS la limite de 3 par type de l'éditeur de Roblox (limite de l'interface
 *     seulement : le serveur accepte jusqu'à 10 accessoires au total) ;
 *   - Tenues RoNote : la tenue actuelle enregistrée sur ce PC, remise en un clic.
 *  Tout passe par les API de Roblox (avatar, inventory, thumbnails), avec ta
 *  session ; rien ne part vers RoNote ni Neuronal. Tenues : storage.local
 *  (`avatarOutfits`). Réglage `avatarPlus` (actif d'office).
 * ==========================================================================
 */
(() => {
  const B = globalThis.browser ?? globalThis.chrome;
  if (!B || globalThis.__rnAvatarPlus) return;
  globalThis.__rnAvatarPlus = true;

  const fr = (document.documentElement.lang || navigator.language || '').toLowerCase().startsWith('fr');
  const L = fr ? {
    title: 'RoNote · Avatar', worn: 'Porté', add: 'Ajouter un accessoire', search: 'Chercher dans mes accessoires',
    outfits: 'Mes tenues RoNote', save: 'Enregistrer la tenue', name: 'Nom de la tenue', remove: 'Retirer', wear: 'Porter',
    del: 'Supprimer', max: 'Maximum 10 accessoires portés en même temps (règle de Roblox).', reload: 'Recharger',
    stale: 'Avatar changé. Recharge la page pour que l’éditeur de Roblox le voie.', fail: 'Roblox a refusé : ',
    none: 'Aucun accessoire trouvé.', empty: 'Aucune tenue enregistrée.', loading: 'Chargement…', accs: 'accessoires',
    hint: 'Sans limite de 3 par type : jusqu’à 10 accessoires.'
  } : {
    title: 'RoNote · Avatar', worn: 'Wearing', add: 'Add an accessory', search: 'Search my accessories',
    outfits: 'My RoNote outfits', save: 'Save outfit', name: 'Outfit name', remove: 'Remove', wear: 'Wear',
    del: 'Delete', max: 'At most 10 accessories worn at once (Roblox rule).', reload: 'Reload',
    stale: 'Avatar changed. Reload the page so Roblox’s editor sees it.', fail: 'Roblox refused: ',
    none: 'No accessory found.', empty: 'No saved outfit.', loading: 'Loading…', accs: 'accessories',
    hint: 'No 3-per-type limit: up to 10 accessories.'
  };
  // Types d'accessoires (rigides et layered) : ce que la limite de 10 compte.
  const ACC = { 8: 'Hat', 41: 'HairAccessory', 42: 'FaceAccessory', 43: 'NeckAccessory', 44: 'ShoulderAccessory',
    45: 'FrontAccessory', 46: 'BackAccessory', 47: 'WaistAccessory' };
  const MAX_ACC = 10;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const me = () => Number(document.querySelector('meta[name="user-data"]')?.dataset.userid) || 0;
  let csrf = document.querySelector('meta[name="csrf-token"]')?.dataset.token || '';

  async function api(url, body) {
    const go = () => fetch(url, body === undefined ? { credentials: 'include' } : {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'X-CSRF-TOKEN': csrf }, body: JSON.stringify(body)
    });
    let r = await go();
    if (r.status === 403 && r.headers.get('x-csrf-token')) { csrf = r.headers.get('x-csrf-token'); r = await go(); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.errors?.[0]?.message || 'HTTP ' + r.status);
    return j;
  }

  const thumbs = new Map();
  async function loadThumbs(ids) {
    const want = [...new Set(ids)].filter(id => !thumbs.has(id));
    for (let i = 0; i < want.length; i += 100) {
      const part = want.slice(i, i + 100);
      part.forEach(id => thumbs.set(id, ''));
      const r = await api(`https://thumbnails.roblox.com/v1/assets?assetIds=${part.join(',')}&size=110x110&format=Png`).catch(() => null);
      for (const t of r?.data || []) thumbs.set(t.targetId, t.imageUrl || '');
    }
  }

  let worn = [], inv = null, outfits = [], query = '', msg = '', stale = false, busy = false;
  let host = null, root = null;

  const isAcc = (a) => !!ACC[a.assetType?.id ?? a.assetTypeId];
  const accCount = () => worn.filter(isAcc).length;

  async function loadWorn() {
    const a = await api('https://avatar.roblox.com/v2/avatar/avatar');
    worn = a.assets || [];
    await loadThumbs(worn.map(x => x.id));
  }
  async function loadInv() {
    const uid = me();
    if (!uid) { inv = []; return; }
    const out = [];
    let cursor = '';
    for (let n = 0; n < 10; n++) {
      const r = await api(`https://inventory.roblox.com/v2/users/${uid}/inventory?assetTypes=${Object.values(ACC).join(',')}&limit=100&sortOrder=Desc${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`);
      for (const x of r.data || []) out.push({ id: x.assetId, name: x.assetName || x.name || '', typeId: x.assetType });
      cursor = r.nextPageCursor;
      if (!cursor) break;
    }
    const seen = new Set();
    inv = out.filter(x => x.id && !seen.has(x.id) && seen.add(x.id));
  }

  async function setWorn(assets) {
    busy = true; msg = ''; paint();
    try {
      await api('https://avatar.roblox.com/v2/avatar/set-wearing-assets', { assets: assets.map(a => a.meta ? { id: a.id, meta: a.meta } : { id: a.id }) });
      await api('https://avatar.roblox.com/v1/avatar/redraw-thumbnail', {}).catch(() => {});
      await loadWorn();
      stale = true;
      redrawPreview();
    } catch (e) { msg = L.fail + (e.message || ''); }
    busy = false; paint();
  }
  // Le lien « Redraw » de Roblox relit la vignette : on le déclenche pour voir le changement tout de suite.
  function redrawPreview() { anchorLink()?.click(); }

  function wear(item) {
    if (worn.some(w => w.id === item.id)) return;
    if (accCount() >= MAX_ACC) { msg = L.max; paint(); return; }
    setWorn([...worn, { id: item.id }]);
  }
  const unwear = (id) => setWorn(worn.filter(w => w.id !== id));

  async function loadOutfits() {
    const g = await B.storage.local.get('avatarOutfits').catch(() => ({}));
    outfits = Array.isArray(g.avatarOutfits) ? g.avatarOutfits : [];
  }
  async function saveOutfit(name) {
    outfits = [{ name: (name || '').trim().slice(0, 40) || `#${outfits.length + 1}`, at: Date.now(),
      assets: worn.map(w => w.meta ? { id: w.id, meta: w.meta } : { id: w.id }) }, ...outfits].slice(0, 30);
    await B.storage.local.set({ avatarOutfits: outfits });
    paint();
  }
  async function dropOutfit(i) { outfits.splice(i, 1); await B.storage.local.set({ avatarOutfits: outfits }); paint(); }

  const CSS = `:host{display:block;margin-top:16px;font:14px/1.35 "Builder Sans",system-ui,sans-serif;color:#fff}
    .card{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);border-radius:10px;padding:12px;margin-bottom:12px}
    h4{margin:0 0 8px;font-size:15px;font-weight:700;display:flex;justify-content:space-between;align-items:center;gap:8px}
    h4 small{font-weight:500;opacity:.7;font-size:12px}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:8px;max-height:260px;overflow:auto}
    .it{position:relative;background:rgba(255,255,255,.08);border:0;border-radius:8px;padding:4px;color:#fff;cursor:pointer;text-align:center;font:inherit;font-size:11px}
    .it:hover{background:rgba(255,255,255,.16)} .it img{width:100%;aspect-ratio:1;display:block}
    .it span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .it.on{outline:2px solid #3fcf6e} .x{position:absolute;top:2px;right:2px;width:18px;height:18px;border-radius:50%;background:#f0565e;color:#fff;font-size:12px;line-height:18px}
    input{box-sizing:border-box;width:100%;margin-bottom:8px;padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.15);background:rgba(0,0,0,.25);color:#fff;font:inherit}
    .btn{border:0;border-radius:8px;padding:8px 12px;background:rgba(255,255,255,.12);color:#fff;font:inherit;font-weight:700;cursor:pointer}
    .btn:hover{background:rgba(255,255,255,.2)} .row{display:flex;gap:8px;align-items:center}
    .of{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-top:1px solid rgba(255,255,255,.08)}
    .of b{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap} .of small{opacity:.6}
    .msg{margin:0 0 10px;padding:8px 10px;border-radius:8px;background:rgba(240,86,94,.18)} .msg.ok{background:rgba(63,207,110,.16)}
    .dim{opacity:.65;font-size:12px;margin:4px 0 0} .busy{opacity:.55;pointer-events:none}`;

  function tile(id, name, extra) {
    const src = thumbs.get(id);
    return `<button class="it ${extra.cls || ''}" data-${extra.act}="${id}" title="${esc(name)} · ${extra.label}">
      ${src ? `<img src="${esc(src)}" alt="" loading="lazy">` : '<img alt="">'}<span>${esc(name)}</span>${extra.x ? '<i class="x">×</i>' : ''}</button>`;
  }

  function paint() {
    if (!root) return;
    const q = query.trim().toLowerCase();
    const wornIds = new Set(worn.map(w => w.id));
    const list = inv ? inv.filter(x => !q || x.name.toLowerCase().includes(q) || String(x.id) === q) : null;
    const typing = root.activeElement?.matches?.('[data-q]') ? root.activeElement.selectionStart : null;
    root.innerHTML = `<style>${CSS}</style><div class="${busy ? 'busy' : ''}">
      ${msg ? `<p class="msg">${esc(msg)}</p>` : ''}
      ${stale ? `<p class="msg ok row" style="justify-content:space-between">${L.stale}<button class="btn" data-reload>${L.reload}</button></p>` : ''}
      <div class="card"><h4>${L.worn}<small>${accCount()}/${MAX_ACC} ${L.accs}</small></h4>
        <div class="grid">${worn.map(w => tile(w.id, w.name, { act: 'off', label: L.remove, x: true })).join('')}</div></div>
      <div class="card"><h4>${L.add}</h4><p class="dim" style="margin:0 0 8px">${L.hint}</p>
        <input type="search" data-q placeholder="${esc(L.search)}" value="${esc(query)}" autocomplete="off" spellcheck="false">
        <div class="grid">${!list ? `<p class="dim">${L.loading}</p>` : list.length
          ? list.slice(0, 120).map(x => tile(x.id, x.name, { act: 'on', label: L.wear, cls: wornIds.has(x.id) ? 'on' : '' })).join('')
          : `<p class="dim">${L.none}</p>`}</div></div>
      <div class="card"><h4>${L.outfits}</h4>
        <div class="row"><input data-name placeholder="${esc(L.name)}" maxlength="40" style="margin:0"><button class="btn" data-save>${L.save}</button></div>
        ${outfits.length ? outfits.map((o, i) => `<div class="of"><b>${esc(o.name)}</b><small>${o.assets.length}</small>
          <button class="btn" data-apply="${i}">${L.wear}</button><button class="btn" data-del="${i}" title="${L.del}">×</button></div>`).join('')
          : `<p class="dim">${L.empty}</p>`}</div></div>`;
    if (typing !== null) { const b = root.querySelector('[data-q]'); b.focus(); b.setSelectionRange(typing, typing); }
    if (list) loadThumbs(list.slice(0, 120).map(x => x.id)).then(() => {
      for (const img of root.querySelectorAll('.it img:not([src])')) {
        const id = Number(img.parentElement.dataset.on || img.parentElement.dataset.off);
        if (thumbs.get(id)) img.src = thumbs.get(id);
      }
    });
  }

  function bind() {
    root.addEventListener('click', (e) => {
      const el = e.target.closest('button');
      if (!el || busy) return;
      e.preventDefault();
      if (el.dataset.off) unwear(Number(el.dataset.off));
      else if (el.dataset.on) { const it = inv?.find(x => x.id === Number(el.dataset.on)); if (it) worn.some(w => w.id === it.id) ? unwear(it.id) : wear(it); }
      else if ('save' in el.dataset) saveOutfit(root.querySelector('[data-name]')?.value);
      else if (el.dataset.apply) { const o = outfits[Number(el.dataset.apply)]; if (o) setWorn(o.assets); }
      else if (el.dataset.del) dropOutfit(Number(el.dataset.del));
      else if ('reload' in el.dataset) location.reload();
    });
    root.addEventListener('input', (e) => { if (e.target.matches('[data-q]')) { query = e.target.value; paint(); } });
  }

  const REDRAW_RE = /^(redraw|redessiner|redibujar|neu zeichnen|redesenhar|ridisegna)$/i;
  function anchorLink() {
    for (const el of document.querySelectorAll('a, button, span')) {
      if (!el.childElementCount && REDRAW_RE.test((el.textContent || '').trim()) && !el.closest('.rn-avatar')) return el;
    }
    return null;
  }

  async function mount() {
    const link = anchorLink();
    const block = link?.parentElement;
    if (!block) return;
    if (host?.isConnected && host.previousElementSibling === block) return;
    if (!host) {
      host = document.createElement('div');
      host.className = 'rn-avatar';
      root = host.attachShadow({ mode: 'open' });
      bind();
      paint();
      Promise.all([loadWorn().catch(e => { msg = L.fail + e.message; }), loadOutfits()]).then(paint);
      loadInv().catch(() => { inv = []; }).then(paint);
    }
    block.after(host);
  }

  const onPage = () => /^\/my\/avatar/i.test(location.pathname);
  let enabled = true, t = 0;
  const obs = new MutationObserver(() => { clearTimeout(t); t = setTimeout(() => { if (enabled && onPage()) mount(); }, 200); });
  function sync() {
    if (!enabled || !onPage()) { host?.remove(); return; }
    mount();
  }
  if (globalThis.RoNoteRoute) globalThis.RoNoteRoute.watch(obs, () => enabled && onPage(), { childList: true, subtree: true }, sync);
  else if (onPage()) obs.observe(document.documentElement, { childList: true, subtree: true });

  B.storage?.local?.get('settings').then(g => { enabled = g?.settings?.avatarPlus !== false; globalThis.RoNoteRoute?.recheck?.(); sync(); }).catch(() => {});
  B.storage?.onChanged?.addListener((c, area) => {
    if (area === 'local' && c.settings) { enabled = c.settings.newValue?.avatarPlus !== false; globalThis.RoNoteRoute?.recheck?.(); sync(); }
  });
})();
