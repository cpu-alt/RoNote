/**
 * ==========================================================================
 *  LA CARTE D'UN PROFIL ROBLOX
 * --------------------------------------------------------------------------
 *  Sur /users/{id}/profile, une carte en tête du profil : value, RAP et rang
 *  Rolimon's, nombre de limiteds, son Discord s'il a choisi de le montrer
 *  (RoNote premium), et un aperçu de ses limiteds les plus chers, dépliable.
 *
 *  Économe : une seule question au service worker par profil (qui garde la
 *  réponse 30 min), un shadow DOM fermé (le CSS de Roblox ne s'y applique pas,
 *  le nôtre ne fuit pas), vignettes en chargement paresseux, et l'observateur
 *  ne fait rien tant que l'URL ne change pas et que la carte est en place.
 * ==========================================================================
 */
(() => {
  const B = globalThis.browser ?? globalThis.chrome;
  if (!B || globalThis.__rnProfileCard) return;
  globalThis.__rnProfileCard = true;

  let dead = false, observer = null, timer = null;
  const alive = () => {
    if (dead) return false;
    try { if (B?.runtime?.id) return true; } catch { /* invalidated */ }
    shutdown();
    return false;
  };
  const assetUrl = (p) => { try { return B.runtime.getURL(p); } catch { return ''; } };
  const fr = (document.documentElement.lang || navigator.language || '').toLowerCase().startsWith('fr');
  const L = (f, e) => fr ? f : e;
  const full = new Intl.NumberFormat(fr ? 'fr-FR' : 'en-US', { maximumFractionDigits: 0 });
  const compact = new Intl.NumberFormat(fr ? 'fr-FR' : 'en-US', { notation: 'compact', maximumFractionDigits: 1 });
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const PREVIEW = 8;

  function pageUser() {
    const m = /^(?:\/[a-z]{2}(?:[-_][a-z]{2})?)?\/users\/(\d+)\/profile\/?$/i.exec(location.pathname);
    return m ? Number(m[1]) : 0;
  }

  let enabled = true, data = null, dataId = 0, asking = false, retryAt = 0, open = false;
  let host = null, shadow = null;

  // Les sous-réglages (Réglages › Profil d'un joueur) : appliqués tout de suite, sans recharger.
  let f = { header: true, panel: true, chart: true, trades: true };
  const flagsOf = (s) => ({ header: s.profileHeader !== false, panel: s.profilePanel !== false,
    chart: s.profileChart !== false, trades: s.profileTrades !== false });
  function redraw() {
    if (host) host._drawn = null;
    if (strip) strip._drawn = null;
    if (seen) seen._drawn = null;
    if (!f.panel) pageMode(false);
    if (!f.header) { strip?.remove(); seen?.remove(); }
    schedule();
  }
  if (alive()) B.storage?.local?.get('settings').then(got => {
    const s = got?.settings || {};
    enabled = s.profileCard !== false && s.useRolimons !== false;
    f = flagsOf(s);
    if (!enabled) remove(); else schedule();
  }).catch(() => {});
  if (alive()) B.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local' || dead || !changes.settings) return;
    const s = changes.settings.newValue || {};
    const next = s.profileCard !== false && s.useRolimons !== false;
    if (next !== enabled) { enabled = next; data = null; dataId = 0; if (!enabled) remove(); else schedule(); return; }
    const nf = flagsOf(s);
    if (JSON.stringify(nf) !== JSON.stringify(f)) { f = nf; redraw(); }
  });

  const CSS = `
    :host{display:block;margin:0 0 24px;color:inherit;contain:content}
    *{box-sizing:border-box}
    .c{position:relative;overflow:hidden;border-radius:16px;padding:16px 18px;
      font:14px/1.35 "Builder Sans","Gotham SSm",system-ui,sans-serif;font-variant-numeric:tabular-nums;
      /* Surface sombre et opaque : lisible sur le thème clair comme sombre de Roblox. */
      color:#f3f0ff;background:linear-gradient(180deg,#211536,#160e26);border:1px solid rgba(255,255,255,.08);
      box-shadow:0 12px 32px rgba(0,0,0,.28)}
    .c::before{content:"";position:absolute;inset:0 0 auto 0;height:1px;
      background:linear-gradient(90deg,transparent,rgba(196,181,253,.6),transparent);pointer-events:none}
    .top{position:relative;display:flex;flex-wrap:wrap;align-items:center;gap:10px 22px}
    .brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:13px;letter-spacing:.1em;
      text-transform:uppercase}
    .brand span{opacity:.8}
    .brand img{width:60px;height:60px;margin:-8px 0;object-fit:contain;filter:drop-shadow(0 3px 8px rgba(0,0,0,.35))}
    .stats{display:flex;flex-wrap:wrap;gap:8px 24px;flex:1 1 auto}
    .s{display:flex;flex-direction:column;min-width:64px}
    .s .k{font-size:11px;letter-spacing:.06em;text-transform:uppercase;opacity:.6}
    .s .v{font-size:20px;font-weight:800;line-height:1.15}
    .s.main .v{font-size:28px;letter-spacing:-.01em}
    .acts{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
    .b{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:999px;border:0;
      color:inherit;font:inherit;font-size:13px;font-weight:600;text-decoration:none;cursor:pointer;
      background:color-mix(in srgb,currentColor 10%,transparent);transition:background .15s,transform .15s}
    .b:hover{background:color-mix(in srgb,currentColor 18%,transparent);transform:translateY(-1px)}
    .b:focus-visible{outline:2px solid #a78bfa;outline-offset:2px}
    .b img,.b svg{width:16px;height:16px;display:block;border-radius:50%}
    .dc{background:rgba(88,101,242,.28)}
    .dc:hover{background:rgba(88,101,242,.45)}
    .tag{display:inline-flex;align-items:center;height:22px;padding:0 8px;border-radius:999px;font-size:11px;
      font-weight:700;letter-spacing:.04em;text-transform:uppercase;background:rgba(239,68,68,.22);color:#fca5a5}
    .inv{position:relative;margin-top:14px}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:10px}
    .it{position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 6px 7px;
      border-radius:12px;color:inherit;text-decoration:none;
      background:color-mix(in srgb,currentColor 6%,transparent);transition:background .15s,transform .15s}
    .it:hover{background:color-mix(in srgb,currentColor 13%,transparent);transform:translateY(-2px)}
    .it img{width:64px;height:64px;object-fit:contain;display:block}
    .it .ph{width:64px;height:64px;border-radius:10px;background:color-mix(in srgb,currentColor 8%,transparent)}
    .it .nm{width:100%;font-size:11px;opacity:.75;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .it .iv{font-size:13px;font-weight:700}
    .it .n{position:absolute;top:5px;right:6px;font-size:10px;font-weight:800;padding:1px 5px;border-radius:999px;
      background:rgba(0,0,0,.45);color:#fff}
    .it.proj .iv{color:#fbbf24}
    .it .rare{position:absolute;top:5px;left:6px;font-size:11px}
    .more{margin-top:10px;width:100%;justify-content:center}
    .note{opacity:.65;font-size:13px;margin-top:10px}
    .sk{height:58px;border-radius:12px;background:linear-gradient(90deg,
      color-mix(in srgb,currentColor 6%,transparent) 25%,color-mix(in srgb,currentColor 12%,transparent) 50%,
      color-mix(in srgb,currentColor 6%,transparent) 75%);background-size:200% 100%;animation:sh 1.2s infinite linear}
    @keyframes sh{to{background-position:-200% 0}}
    /* Abonné Neuronal : les couleurs de son rang, comme sur la carte du site. */
    .c.tier{border:1.5px solid transparent;
      background:linear-gradient(180deg,#211536,#160e26) padding-box,linear-gradient(120deg,var(--rk1),var(--rk2)) border-box}
    .c.tier::before{height:2px;background:linear-gradient(90deg,transparent,var(--rk1),var(--rk2),transparent)}
    .elite{--rk1:#5ce1e6;--rk2:#f5d27a}.insider{--rk1:#ff6b9d;--rk2:#ffc1d6}.tracker{--rk1:#00c2a8;--rk2:#8ff5e4}
    .tb{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 11px 0 9px;border-radius:999px;
      font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#0b0b14;
      background:linear-gradient(110deg,var(--rk1),var(--rk2),var(--rk1));background-size:200% 100%;
      box-shadow:0 0 14px color-mix(in srgb,var(--rk1) 55%,transparent);animation:gl 4s linear infinite}
    .tb svg{width:13px;height:13px}
    @keyframes gl{to{background-position:-200% 0}}
    .meta{position:relative;display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:10px;font-size:12.5px;opacity:.8}
    .meta b{font-weight:700}
    .warn{color:#fbbf24;font-weight:700}
    .good{color:#4ade80}.bad{color:#f87171}
    .ex{position:relative;display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-top:14px}
    .pane{border-radius:14px;padding:12px 14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);min-width:0}
    .ph2{display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase}
    .ph2 .t{opacity:.65}
    .ph2 .ch{font-size:13px;letter-spacing:0;text-transform:none}
    .rg{margin-left:auto;display:flex;gap:2px;padding:2px;border-radius:8px;background:rgba(0,0,0,.25)}
    .rg button{height:22px;padding:0 8px;border:0;border-radius:6px;background:none;color:inherit;font:inherit;font-size:11px;
      font-weight:700;cursor:pointer;opacity:.6}
    .rg button[aria-pressed=true]{opacity:1;background:rgba(255,255,255,.14)}
    .chart{position:relative;height:120px}
    .chart svg{width:100%;height:100%;display:block;overflow:visible}
    .chart .tip{position:absolute;top:-4px;transform:translateX(-50%);pointer-events:none;white-space:nowrap;font-size:11px;
      font-weight:700;padding:3px 7px;border-radius:6px;background:#0d0818;border:1px solid rgba(255,255,255,.12)}
    .chart .tip[hidden]{display:none}
    .lg{display:flex;gap:12px;margin-top:6px;font-size:11px;opacity:.7}
    .lg i{display:inline-block;width:10px;height:3px;border-radius:2px;margin-right:5px;vertical-align:2px}
    .tr{display:flex;flex-direction:column;gap:6px}
    .row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:4px 10px;padding:7px 8px;border-radius:10px;
      background:rgba(255,255,255,.03)}
    .row:hover{background:rgba(255,255,255,.07)}
    .who{font-size:12px;opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .who a{color:inherit;font-weight:700;text-decoration:none}
    .who a:hover{text-decoration:underline}
    .sides{display:flex;align-items:center;gap:6px;grid-column:1/-1}
    .sides .ar{opacity:.5;font-size:12px}
    .th{display:flex;gap:3px}
    .th img,.th .x{width:30px;height:30px;border-radius:7px;background:rgba(255,255,255,.07);object-fit:contain}
    .th .x{display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:800}
    .gain{font-size:12.5px;font-weight:800;white-space:nowrap}
    .lock{display:flex;flex-direction:column;align-items:flex-start;gap:8px;font-size:13px;opacity:.9}
    .lock a{color:#0b0b14;font-weight:800;text-decoration:none;padding:6px 12px;border-radius:999px;
      background:linear-gradient(110deg,#5ce1e6,#f5d27a)}
    .nav{position:relative;display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
    .chip{height:28px;padding:0 12px;border-radius:999px;border:0;cursor:pointer;color:inherit;font:inherit;font-size:12.5px;
      font-weight:700;background:color-mix(in srgb,currentColor 8%,transparent);transition:background .15s,transform .15s}
    .chip:hover{background:linear-gradient(90deg,rgba(167,139,250,.45),rgba(125,211,252,.35));transform:translateY(-1px)}
    .chip:focus-visible{outline:2px solid #a78bfa;outline-offset:2px}
    .q{width:100%;height:34px;margin:0 0 10px;padding:0 12px;border-radius:10px;border:0;color:inherit;font:inherit;
      background:color-mix(in srgb,currentColor 8%,transparent);outline:none}
    .q:focus{box-shadow:inset 0 0 0 1.5px #a78bfa}
    .it[hidden]{display:none}
    @media (prefers-reduced-motion:reduce){.sk,.tb{animation:none}.b,.it{transition:none}}`;

  const ICON_EXT = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4 2h6v6M10 2 3 9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const ICON_DC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.3 4.4A19.6 19.6 0 0 0 15.4 3l-.6 1.3a18 18 0 0 0-5.6 0L8.6 3a19.5 19.5 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18.1a19.7 19.7 0 0 0 6 3l1.3-2.1a12.7 12.7 0 0 1-2-1l.5-.4a14 14 0 0 0 12.2 0l.5.4-2 1 1.3 2.1a19.6 19.6 0 0 0 6-3c.5-5.2-.8-9.7-3.6-13.7ZM8 15.4c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.6 8 10.6s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg>';

  const STAR = '<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="m8 1 2.1 4.6 5 .5-3.8 3.4 1.1 4.9L8 11.9 3.6 14.4l1.1-4.9L.9 6.1l5-.5z"/></svg>';
  const TIERS = { elite: 'Elite', insider: 'Insider', tracker: 'Tracker' };
  const DAY = 864e5;
  function ago(t) {
    const d = Math.floor((Date.now() - t) / DAY);
    if (d < 1) return L("aujourd'hui", 'today');
    if (d < 60) return L(`il y a ${d} j`, `${d}d ago`);
    if (d < 730) return L(`il y a ${Math.round(d / 30)} mois`, `${Math.round(d / 30)}mo ago`);
    return L(`il y a ${Math.floor(d / 365)} ans`, `${Math.floor(d / 365)}y ago`);
  }
  function meta(d) {
    const out = [];
    if (d.self && d.discord && !d.showcase) {
      out.push(`<span title="${esc(L('Réglages RoNote › Premium › Montrer mon Discord sur mon profil Roblox', 'RoNote settings › Premium › Show my Discord on my Roblox profile'))}">🔒 ${L('Ton Discord n’est visible que par toi', 'Only you can see your Discord')}</span>`);
    }
    const m = d.mine;
    if (m) {
      const parts = [];
      if (m.received) parts.push(L(`${m.received} reçu${m.received > 1 ? 's' : ''}`, `${m.received} received`));
      if (m.sent) parts.push(L(`${m.sent} envoyé${m.sent > 1 ? 's' : ''}`, `${m.sent} sent`));
      if (m.done) parts.push(L(`${m.done} conclu${m.done > 1 ? 's' : ''}`, `${m.done} completed`));
      const net = m.net != null && m.net !== 0
        ? ` · <b class="${m.net > 0 ? 'good' : 'bad'}">${m.net > 0 ? '+' : '−'}${esc(compact.format(Math.abs(m.net)))}</b>` : '';
      out.push(`<span>${L('Avec toi', 'With you')} : <b>${parts.join(', ')}</b>${net}</span>`);
    }
    return out.length ? `<div class="meta">${out.join('')}</div>` : '';
  }

  /* ---- Courbe Rolimon's et derniers trades : lus après la carte, à la demande ---- */
  let hist = null, trades = null, range = 30, chartPts = [];
  const RANGES = [[30, L('30 j', '30d')], [90, L('90 j', '90d')], [365, L('1 an', '1y')], [0, L('Tout', 'All')]];
  function chart() {
    if (!hist || hist.id !== dataId) return '';
    const head = (extra = '') => `<div class="ph2"><span class="t">${L('Value', 'Value')}</span>${extra}
      <div class="rg">${RANGES.map(([r, l]) => `<button type="button" data-range="${r}" aria-pressed="${r === range}">${l}</button>`).join('')}</div></div>`;
    if (hist.loading) return `<div class="pane">${head()}<div class="sk" style="height:120px"></div></div>`;
    const all = hist.points || [];
    const since = range ? Date.now() - range * DAY : 0;
    let pts = all.filter(p => p.at >= since && p.v > 0);
    if (pts.length < 2) return `<div class="pane">${head()}<p class="note">${L('Pas assez de relevés Rolimon’s sur cette période.', 'Not enough Rolimon’s scans for this period.')}</p></div>`;
    const step = Math.ceil(pts.length / 160);
    if (step > 1) pts = pts.filter((_, i) => i % step === 0 || i === pts.length - 1);
    const lo = Math.min(...pts.map(p => Math.min(p.v, p.r || p.v))), hi = Math.max(...pts.map(p => Math.max(p.v, p.r || 0)));
    const t0 = pts[0].at, t1 = pts[pts.length - 1].at, W = 600, H = 120, pad = 6;
    const x = (t) => ((t - t0) / Math.max(1, t1 - t0)) * W;
    const y = (v) => H - pad - ((v - lo) / Math.max(1, hi - lo)) * (H - pad * 2);
    chartPts = pts.map(p => ({ ...p, x: x(p.at) / W }));
    const line = (k) => pts.filter(p => p[k] > 0).map((p, i) => `${i ? 'L' : 'M'}${x(p.at).toFixed(1)},${y(p[k]).toFixed(1)}`).join('');
    const v = line('v');
    const first = pts[0].v, last = pts[pts.length - 1].v, pct = first ? (last - first) / first * 100 : 0;
    const ch = `<span class="ch ${pct >= 0 ? 'good' : 'bad'}">${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)} %</span>`;
    return `<div class="pane">${head(ch)}<div class="chart" data-chart>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="rnf" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a78bfa" stop-opacity=".35"/>
          <stop offset="1" stop-color="#a78bfa" stop-opacity="0"/></linearGradient></defs>
        <path d="${v}L${W},${H}L0,${H}Z" fill="url(#rnf)"/>
        <path d="${line('r')}" fill="none" stroke="#7dd3fc" stroke-opacity=".55" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
        <path d="${v}" fill="none" stroke="#c4b5fd" stroke-width="2.2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>
        <line data-cx x1="0" x2="0" y1="0" y2="${H}" stroke="#fff" stroke-opacity="0" vector-effect="non-scaling-stroke"/>
      </svg><span class="tip" hidden></span></div>
      <div class="lg"><span><i style="background:#c4b5fd"></i>Value</span><span><i style="background:#7dd3fc"></i>RAP</span>
        <span style="margin-left:auto">${esc(compact.format(lo))} – ${esc(compact.format(hi))}</span></div></div>`;
  }
  function tradesPane(id) {
    if (!trades || trades.id !== dataId || trades.hidden || trades.unavailable) return '';
    const head = `<div class="ph2"><span class="t">${L('Derniers trades', 'Latest trades')}</span></div>`;
    if (trades.loading) return `<div class="pane">${head}<div class="sk" style="height:120px"></div></div>`;
    if (trades.locked || trades.off) {
      const url = /^https:\/\//.test(trades.subscribeUrl || '') ? trades.subscribeUrl : 'https://discord.gg/neuronal';
      return `<div class="pane">${head}<div class="lock"><span>🔒 ${L('Les trades prouvés de ce joueur, vus par Neuronal : réservé aux abonnés Insider et Elite.', 'This player’s proven trades seen by Neuronal: for Insider and Elite subscribers.')}</span>
        <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${L('Débloquer', 'Unlock')}</a></div></div>`;
    }
    const list = trades.data?.recent || [];
    if (!list.length) return `<div class="pane">${head}<p class="note">${trades.error ? L('Neuronal injoignable.', 'Neuronal unreachable.') : L('Aucun trade prouvé récemment.', 'No proven trade lately.')}</p></div>`;
    const thumbs = (arr, more) => `<span class="th">${arr.slice(0, 3).map(i => i.thumb && /^https:\/\//.test(i.thumb)
      ? `<img src="${esc(i.thumb)}" alt="" title="${esc(i.name)} · ${esc(compact.format(i.value || 0))}" loading="lazy" decoding="async">`
      : `<span class="x" title="${esc(i.name)}">${esc((i.name || '?').slice(0, 2))}</span>`).join('')}${(arr.length > 3 || more) ? `<span class="x">+${arr.length - 3 + (more || 0)}</span>` : ''}</span>`;
    const rows = list.slice(0, 5).map(t => {
      const at = t.at < 1e12 ? t.at * 1000 : t.at;
      const net = (t.got || 0) - (t.gave || 0);
      const pid = Number(t.partner?.id) || 0;
      return `<div class="row"><span class="who">${ago(at)} · ${L('avec', 'with')} ${pid
          ? `<a href="https://www.roblox.com/users/${pid}/profile">${esc(t.partner?.name || '#' + pid)}</a>` : '?'}</span>
        <span class="gain ${net >= 0 ? 'good' : 'bad'}">${net >= 0 ? '+' : '−'}${esc(compact.format(Math.abs(net)))}</span>
        <span class="sides">${thumbs(t.gave_items || [], t.gave_more)}<span class="ar">→</span>${thumbs(t.got_items || [], t.got_more)}</span></div>`;
    }).join('');
    return `<div class="pane">${head}<div class="tr">${rows}</div></div>`;
  }
  async function loadExtras(id) {
    const jobs = [];
    if (f.chart && (!hist || hist.id !== id)) {
      hist = { id, loading: true };
      jobs.push(B.runtime.sendMessage({ type: 'ronote:player-history', userId: id }).then(r => {
        if (hist?.id === id) hist = { id, points: Array.isArray(r?.points) ? r.points : [] };
      }, () => { if (hist?.id === id) hist = { id, points: [] }; }));
    }
    if (f.trades && (!trades || trades.id !== id)) {
      trades = { id, loading: true };
      jobs.push(B.runtime.sendMessage({ type: 'ronote:profile-trades', userId: id }).then(r => {
        if (trades?.id === id) trades = { id, ...(r || { error: true }) };
      }, () => { if (trades?.id === id) trades = { id, error: true }; }));
    }
    if (!jobs.length) return;
    if (host) host._drawn = null;
    place(id);
    // Chaque réponse se dessine dès qu'elle arrive.
    for (const j of jobs) j.then(() => { if (dataId === id && host) { host._drawn = null; place(id); } });
  }

  const stat = (k, v, cls = '') => `<div class="s ${cls}"><span class="k">${k}</span><span class="v">${v}</span></div>`;

  function item(it) {
    const shown = it.value || it.rap;
    return `<a data-k="${esc((it.name + ' ' + it.acro).toLowerCase())}" class="it${it.projected ? ' proj' : ''}" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer"
      title="${esc(it.name)}${it.projected ? ' · Projected' : ''} · Value ${esc(full.format(it.value))} · RAP ${esc(full.format(it.rap))}">
      ${it.thumb ? `<img src="${esc(it.thumb)}" alt="" loading="lazy" decoding="async">` : '<span class="ph"></span>'}
      ${it.n > 1 ? `<span class="n">×${it.n}</span>` : ''}${it.rare ? '<span class="rare">💎</span>' : ''}
      <span class="nm">${esc(it.acro || it.name)}</span><span class="iv">${esc(compact.format(shown))}</span></a>`;
  }

  function draw(id) {
    const logo = assetUrl('icons/icon48.png');
    const brand = `<div class="brand"><img src="${esc(logo)}" alt=""><span>RoNote</span></div>`;
    if (!data) {
      return `<style>${CSS}</style><div class="c"><div class="top">${brand}</div><div class="inv"><div class="sk"></div></div></div>`;
    }
    const d = data;
    const tags = [d.terminated ? `<span class="tag">${L('Banni', 'Terminated')}</span>` : '',
      d.private ? `<span class="tag">${L('Inventaire privé', 'Private inventory')}</span>` : ''].join('');
    const discord = d.discord ? `<button class="b dc" type="button" data-copy="${esc(d.discord.username || d.discord.name)}"
        title="${esc(L('Copier le pseudo Discord', 'Copy Discord username'))}">
        ${d.discord.avatar ? `<img src="${esc(d.discord.avatar)}" alt="" loading="lazy">` : ICON_DC}
        <span>${esc(d.discord.username ? '@' + d.discord.username : d.discord.name)}</span></button>` : '';
    const top = `<div class="top">${brand}<div class="stats">
        ${stat('Limiteds', esc(full.format(d.count)))}${stat(L('Objets différents', 'Unique items'), esc(full.format(d.kinds)))}</div>
      <div class="acts">${tags}
        <a class="b" href="https://www.roblox.com/users/${id}/trade" target="_blank" rel="noopener noreferrer">Trade</a>
        <a class="b" href="https://www.rolimons.com/player/${id}" target="_blank" rel="noopener noreferrer"
          title="${esc(L('Voir sur Rolimon’s', 'View on Rolimon’s'))}"><img src="${esc(assetUrl('assets/rolimons-logo.webp'))}" alt="">Rolimon's${ICON_EXT}</a>
      </div></div>`;
    const items = d.items || [];
    let inv = '';
    if (items.length) {
      const list = open ? items : items.slice(0, PREVIEW);
      const rest = d.kinds - PREVIEW;
      inv = `<div class="inv">${open && items.length > PREVIEW ? `<input class="q" type="search" data-q placeholder="${esc(L('Chercher un objet…', 'Search an item…'))}">` : ''}<div class="grid">${list.map(item).join('')}</div>
        ${rest > 0 ? `<button class="b more" type="button" data-more>${open
          ? L('Réduire', 'Show less')
          : L(`Voir son inventaire (${d.kinds} limiteds)`, `View inventory (${d.kinds} limiteds)`)}</button>` : ''}</div>`;
    } else if (!d.private) {
      inv = `<p class="note">${L('Aucun limited connu de Rolimon’s.', 'No limiteds known to Rolimon’s.')}</p>`;
    }
    const tier = d.tier && TIERS[d.tier] ? ` tier ${d.tier}` : '';
    const secs = sections();
    const nav = secs.length ? `<div class="nav">${secs.map(([k, label]) =>
      `<button class="chip" type="button" data-sec="${k}">${esc(label)}</button>`).join('')}</div>` : '';
    const ex = (f.chart ? chart() : '') + (f.trades ? tradesPane(id) : '');
    return `<style>${CSS}</style><div class="c${tier}">${top}${meta(d)}${f.panel ? nav : ''}${ex ? `<div class="ex">${ex}</div>` : ''}${inv}</div>`;
  }

  const STRIP_CSS = `
    :host{margin-left:auto;display:flex;min-width:0;color:inherit}
    .st{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px;
      font:700 13px/1 "Builder Sans","Gotham SSm",system-ui,sans-serif;font-variant-numeric:tabular-nums}
    .p{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;border-radius:999px;border:0;color:inherit;
      font:inherit;text-decoration:none;background:color-mix(in srgb,currentColor 12%,transparent);white-space:nowrap}
    .p .k{opacity:.6;font-weight:600}
    a.p,button.p{cursor:pointer;transition:background .15s,transform .15s}
    a.p:hover,button.p:hover{background:color-mix(in srgb,currentColor 20%,transparent);transform:translateY(-1px)}
    .p:focus-visible{outline:2px solid #a78bfa;outline-offset:2px}
    .p.v{background:rgba(167,139,250,.2);box-shadow:inset 0 0 0 1.5px rgba(167,139,250,.75)}
    .p.v:hover{background:rgba(167,139,250,.32)!important}
    .p img,.p svg{width:16px;height:16px;display:block;border-radius:50%}
    .dc{background:rgba(88,101,242,.35)}
    .dc:hover{background:rgba(88,101,242,.55)!important}
    .tb{color:#0b0b14;letter-spacing:.06em;text-transform:uppercase;font-size:12px;
      background:linear-gradient(110deg,var(--rk1),var(--rk2),var(--rk1));background-size:200% 100%;
      box-shadow:0 0 14px color-mix(in srgb,var(--rk1) 50%,transparent);animation:gl 4s linear infinite}
    .tb svg{width:13px;height:13px}
    @keyframes gl{to{background-position:-200% 0}}
    .elite{--rk1:#5ce1e6;--rk2:#f5d27a}.insider{--rk1:#ff6b9d;--rk2:#ffc1d6}.tracker{--rk1:#00c2a8;--rk2:#8ff5e4}
    @media (prefers-reduced-motion:reduce){.tb{animation:none}.p{transition:none}}`;

  function drawStrip(id) {
    const d = data;
    if (!d) return '';
    const roli = `https://www.rolimons.com/player/${id}`;
    const tier = d.tier && TIERS[d.tier]
      ? `<span class="p tb ${d.tier}" title="${esc(L('Abonné Neuronal', 'Neuronal subscriber'))}">${STAR}${TIERS[d.tier]}</span>` : '';
    const dc = d.discord ? `<button class="p dc" type="button" data-copy="${esc(d.discord.username || d.discord.name)}"
        title="${esc(L('Copier le pseudo Discord', 'Copy Discord username'))}">
        ${d.discord.avatar ? `<img src="${esc(d.discord.avatar)}" alt="" loading="lazy">` : ICON_DC}
        <span>${esc(d.discord.username ? '@' + d.discord.username : d.discord.name)}</span></button>` : '';
    return `<style>${STRIP_CSS}</style><div class="st">${tier}
      <a class="p v" href="${roli}" target="_blank" rel="noopener noreferrer" title="${esc(L('Voir sur Rolimon’s', 'View on Rolimon’s'))}"><span class="k">Value</span>${esc(full.format(d.value))}</a>
      <span class="p"><span class="k">RAP</span>${esc(full.format(d.rap))}</span>
      ${d.rank ? `<span class="p" title="${esc(L('Rang Rolimon’s', 'Rolimon’s rank'))}">#${esc(full.format(d.rank))}</span>` : ''}
      ${dc}</div>`;
  }

  const SEEN_CSS = `
    :host{display:block;margin-top:4px}
    .s{display:flex;flex-wrap:wrap;align-items:center;gap:4px 10px;font:600 13px/1.3 "Builder Sans","Gotham SSm",system-ui,sans-serif;opacity:.85}
    .d{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:6px;vertical-align:1px}
    .on{background:#22c55e;box-shadow:0 0 8px #22c55e}.recent{background:#f59e0b}.off{background:#9ca3af}
    .sep{opacity:.4}
    .warn{color:#fbbf24;font-weight:800}`;
  let seen = null, seenShadow = null;
  /** Sous le @pseudo : dernière connexion (pastille de couleur) et âge du compte. */
  function placeSeen() {
    const user = document.querySelector('.user-profile-header-info .stylistic-alts-username');
    const d = data;
    if (!user || !d || (!d.lastOnline && !d.created)) { seen?.remove(); return; }
    if (!seen) {
      seen = document.createElement('div');
      seen.dataset.rn = 'profile-seen';
      seenShadow = seen.attachShadow({ mode: 'closed' });
    }
    if (user.nextElementSibling !== seen) user.after(seen);
    if (seen._drawn === d) return;
    seen._drawn = d;
    const parts = [];
    if (d.lastOnline) {
      const h = (Date.now() - d.lastOnline) / 36e5;
      const cls = h < 24 ? 'on' : h < 24 * 7 ? 'recent' : 'off';
      parts.push(`<span><i class="d ${cls}"></i>${L('Vu en ligne', 'Last online')} ${ago(d.lastOnline)}</span>`);
    }
    if (d.created) {
      const young = (Date.now() - d.created) / DAY < 30;
      parts.push(young
        ? `<span class="warn" title="${esc(L('Compte récent : prudence, terrain des arnaques', 'New account: be careful, common for scams'))}">⚠ ${L('Compte créé', 'Account created')} ${ago(d.created)}</span>`
        : `<span>${L('Compte créé', 'Joined')} ${ago(d.created)}</span>`);
    }
    seenShadow.innerHTML = `<style>${SEEN_CSS}</style><div class="s">${parts.join('<span class="sep">·</span>')}</div>`;
  }

  let strip = null, stripShadow = null;
  /** La rangée « Friends · Followers · Following » : elle fait toute la largeur, la droite est libre. */
  function stripRow() {
    return document.querySelector('.user-profile-header > .flex-nowrap');
  }
  function placeStrip(id) {
    const row = stripRow();
    if (!row || !data) { strip?.remove(); return; }
    if (!strip) {
      strip = document.createElement('div');
      strip.dataset.rn = 'profile-strip';
      stripShadow = strip.attachShadow({ mode: 'closed' });
      stripShadow.addEventListener('click', onClick);
    }
    if (strip.parentElement !== row || row.lastElementChild !== strip) row.append(strip);
    if (strip._drawn !== data) { stripShadow.innerHTML = drawStrip(id); strip._drawn = data; }
  }

  function anchor() {
    return document.querySelector('.profile-content') || null;
  }

  function place(id) {
    const a = anchor();
    if (!a) return;
    if (!host) {
      host = document.createElement('div');
      host.dataset.rn = 'profile-card';
      shadow = host.attachShadow({ mode: 'closed' });
      shadow.addEventListener('click', onClick);
      // Survol de la courbe : un trait et la value du relevé le plus proche, sans redessiner.
      shadow.addEventListener('pointermove', (e) => {
        const box = e.target.closest?.('[data-chart]');
        if (!box || !chartPts.length) return;
        const r = box.getBoundingClientRect();
        const fx = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
        let best = chartPts[0];
        for (const p of chartPts) if (Math.abs(p.x - fx) < Math.abs(best.x - fx)) best = p;
        const tip = box.querySelector('.tip'), cx = box.querySelector('[data-cx]');
        tip.hidden = false; tip.style.left = (best.x * 100) + '%';
        tip.textContent = `${new Date(best.at).toLocaleDateString(fr ? 'fr-FR' : 'en-US', { day: 'numeric', month: 'short', year: '2-digit' })} · ${full.format(best.v)}`;
        cx.setAttribute('x1', best.x * 600); cx.setAttribute('x2', best.x * 600); cx.setAttribute('stroke-opacity', '.35');
      });
      shadow.addEventListener('pointerleave', () => {
        shadow.querySelector('.tip')?.setAttribute('hidden', '');
        shadow.querySelector('[data-cx]')?.setAttribute('stroke-opacity', '0');
      }, true);
      // Filtre local, sans redessiner : on masque les tuiles qui ne correspondent pas.
      shadow.addEventListener('input', (e) => {
        if (!e.target.matches('[data-q]')) return;
        const q = e.target.value.trim().toLowerCase();
        for (const a of shadow.querySelectorAll('.it')) a.hidden = !!q && !a.dataset.k.includes(q);
      });
    }
    if (host.parentElement !== a || a.firstElementChild !== host) a.prepend(host);
    const nsec = data ? sections().length : 0;
    if (host._drawn !== data || host._open !== open || host._nsec !== nsec) {
      shadow.innerHTML = draw(id); host._drawn = data; host._open = open; host._nsec = nsec;
    }
    if (f.header) { placeStrip(id); placeSeen(); }
  }

  function onClick(e) {
    const rg = e.target.closest('[data-range]');
    if (rg) { range = Number(rg.dataset.range) || 0; host._drawn = null; place(dataId); return; }
    const sec = e.target.closest('[data-sec]');
    if (sec) { openDrawer(sec.dataset.sec); return; }
    const more = e.target.closest('[data-more]');
    if (more) { open = !open; place(dataId); return; }
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      const span = copy.querySelector('span');
      const was = span.textContent;
      navigator.clipboard?.writeText(copy.dataset.copy).then(() => {
        span.textContent = L('Copié !', 'Copied!');
        setTimeout(() => { span.textContent = was; }, 1200);
      }, () => {});
    }
  }

  /* ---- Les sections du profil : retirées de la page, rouvertes dans un panneau à onglets ----
     Les blocs restent ceux de Roblox (React les tient à jour) : on ne les déplace
     pas, on les marque (data-rn-sec) et seul notre CSS les cache ou pose l'onglet
     ouvert dans le panneau. Fermé, rien ne tourne. */
  // Amis, Favoris, Communautés et Badges restent sur la page : seuls ces blocs passent au panneau.
  const SECTIONS = [
    ['wear', '.profile-currently-wearing', L('Tenue', 'Outfit')],
    ['store', '.profile-store', 'Store'],
    ['games', '.profile-experiences', L('Jeux', 'Games')],
    ['coll', '.profile-collections', 'Collections']
  ];
  const W = 'min(560px,94vw)';
  const ON = 'html.rn-pc.rn-dr [data-rn-sec].rn-on';
  const PAGE_CSS = `
    html.rn-pc [data-rn-sec]{display:none!important}
    ${ON}{display:block!important;position:fixed;top:var(--rn-top,64px);right:0;bottom:0;width:${W};z-index:100002;
      overflow-y:auto;overscroll-behavior:contain;padding:18px 20px 28px;box-sizing:border-box;animation:rnTab .22s ease-out}
    @keyframes rnTab{from{opacity:0;transform:translateY(8px)}}
    ${ON} h2{display:none}
    ${ON} [class*="arouselContainer"],${ON} [class*="carousel"]{overflow:visible!important}
    ${ON} [class*="arouselContainer"]>[class$="-carousel"],${ON} ul,${ON} .hlist{display:grid!important;
      grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:14px!important;transform:none!important;width:auto!important}
    ${ON} [class*="arouselContainer"]>[class$="-carousel"]>*,${ON} ul>li{width:auto!important;min-width:0!important;
      max-width:none!important;margin:0!important}
    ${ON} .scroll-arrow{display:none!important}
    /* Les tuiles de Roblox, habillées en cartes. */
    ${ON} #collection-carousel-item,${ON} ul>li{border-radius:16px;padding:8px;background:rgba(255,255,255,.05);
      box-shadow:inset 0 0 0 1px rgba(255,255,255,.07);transition:transform .18s,background .18s,box-shadow .18s}
    ${ON} #collection-carousel-item:hover,${ON} ul>li:hover{transform:translateY(-3px);background:rgba(255,255,255,.1);
      box-shadow:inset 0 0 0 1px rgba(196,181,253,.45),0 10px 24px rgba(0,0,0,.3)}
    ${ON} .item-card-thumb-container{border-radius:12px;overflow:hidden}
    .rn-dr-panel{position:fixed;top:0;right:0;bottom:0;width:${W};z-index:100001;box-sizing:border-box;color:#fff;
      font:700 13px "Builder Sans","Gotham SSm",system-ui,sans-serif;
      background:radial-gradient(120% 60% at 100% 0,rgba(168,85,247,.35),transparent 60%),
        linear-gradient(165deg,rgba(60,22,120,.98),rgba(18,10,40,.99));backdrop-filter:blur(18px);
      box-shadow:-24px 0 70px rgba(0,0,0,.5);border-left:1px solid rgba(255,255,255,.12);border-radius:24px 0 0 24px;
      animation:rnIn .34s cubic-bezier(.2,.9,.25,1)}
    @keyframes rnIn{from{transform:translateX(105%)}}
    .rn-dr-top{padding:20px 20px 0}
    .rn-dr-head{display:flex;align-items:center;gap:14px;padding-right:44px}
    .rn-dr-av{flex:none;width:68px;height:68px;border-radius:50%;padding:3px;
      background:linear-gradient(135deg,var(--rk1,#a78bfa),var(--rk2,#7dd3fc));box-shadow:0 0 22px color-mix(in srgb,var(--rk1,#a78bfa) 55%,transparent)}
    .rn-dr-av img{width:100%;height:100%;border-radius:50%;display:block;background:#1e1038;object-fit:cover}
    .rn-dr-id{min-width:0;flex:1}
    .rn-dr-name{font-size:20px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .rn-dr-user{font-size:13px;opacity:.6;font-weight:600}
    .rn-dr-stats{display:flex;gap:8px;margin-top:6px;flex-wrap:wrap}
    .rn-dr-stats span{height:24px;display:inline-flex;align-items:center;gap:5px;padding:0 9px;border-radius:999px;
      font-size:12px;background:rgba(255,255,255,.1)}
    .rn-dr-stats b{font-weight:800}
    .rn-dr-stats .tb{color:#0b0b14;background:linear-gradient(100deg,var(--rk1),var(--rk2));text-transform:uppercase;letter-spacing:.05em}
    .elite{--rk1:#5ce1e6;--rk2:#f5d27a}.insider{--rk1:#ff6b9d;--rk2:#ffc1d6}.tracker{--rk1:#00c2a8;--rk2:#8ff5e4}
    .rn-dr-tabs{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:4px;margin-top:18px;padding:4px;border-radius:14px;
      background:rgba(0,0,0,.25);box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}
    .rn-dr-tabs button{display:flex;align-items:center;justify-content:center;gap:6px;height:36px;padding:0 8px;border-radius:10px;
      border:0;cursor:pointer;color:inherit;font:inherit;background:none;opacity:.7;transition:background .15s,opacity .15s}
    .rn-dr-tabs button:hover{opacity:1;background:rgba(255,255,255,.07)}
    .rn-dr-tabs button[aria-selected=true]{opacity:1;color:#0b0b14;background:linear-gradient(90deg,#c4b5fd,#7dd3fc);
      box-shadow:0 4px 14px rgba(125,211,252,.25)}
    .rn-dr-tabs i{font-style:normal;font-size:11px;font-weight:800;min-width:18px;height:18px;padding:0 5px;border-radius:999px;
      display:inline-flex;align-items:center;justify-content:center;background:rgba(255,255,255,.14)}
    .rn-dr-tabs button[aria-selected=true] i{background:rgba(11,11,20,.15)}
    .rn-dr-sep{height:1px;margin:16px -20px 0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.14),transparent)}
    .rn-dr-tabs button:focus-visible,.rn-dr-x:focus-visible{outline:2px solid #c4b5fd;outline-offset:2px}
    .rn-dr-x{position:absolute;top:16px;right:16px;width:36px;height:36px;border-radius:50%;border:0;cursor:pointer;
      background:rgba(255,255,255,.12);color:#fff;font:600 20px/1 system-ui;transition:background .15s,transform .2s}
    .rn-dr-x:hover{transform:rotate(90deg)}
    .rn-dr-body{position:absolute;top:var(--rn-top,64px);left:0;right:0;bottom:0;overflow-y:auto;overscroll-behavior:contain;
      padding:18px 20px 28px;animation:rnTab .22s ease-out}
    .rn-dr-body[hidden]{display:none}
    .rn-st{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
    .rn-st a{display:flex;flex-direction:column;gap:6px;padding:8px;border-radius:16px;color:#fff;text-decoration:none;
      background:rgba(255,255,255,.05);box-shadow:inset 0 0 0 1px rgba(255,255,255,.07);transition:transform .18s,background .18s,box-shadow .18s}
    .rn-st a:hover{transform:translateY(-3px);background:rgba(255,255,255,.1);
      box-shadow:inset 0 0 0 1px rgba(196,181,253,.45),0 10px 24px rgba(0,0,0,.3)}
    .rn-st .th{aspect-ratio:1;border-radius:12px;background:rgba(255,255,255,.08);display:flex;align-items:center;justify-content:center}
    .rn-st img{width:88%;height:88%;object-fit:contain}
    .rn-st .nm{font-size:13px;font-weight:700;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .rn-st .pr{font-size:12.5px;font-weight:600;opacity:.75}
    .rn-st .sk{aspect-ratio:.78;border-radius:16px;background:linear-gradient(90deg,rgba(255,255,255,.05) 25%,rgba(255,255,255,.11) 50%,
      rgba(255,255,255,.05) 75%);background-size:200% 100%;animation:rnSh 1.2s infinite linear}
    @keyframes rnSh{to{background-position:-200% 0}}
    .rn-dr-more{display:flex;justify-content:center;gap:10px;margin-top:18px}
    .rn-dr-more button,.rn-dr-more a{height:36px;padding:0 16px;border-radius:999px;border:0;cursor:pointer;color:#fff;font:inherit;
      text-decoration:none;display:inline-flex;align-items:center;background:rgba(255,255,255,.1);transition:background .15s}
    .rn-dr-more button:hover,.rn-dr-more a:hover{background:rgba(255,255,255,.2)}
    .rn-dr-empty{opacity:.65;text-align:center;padding:40px 0}
    .rn-dr-x:hover{background:rgba(255,255,255,.26)}
    .rn-dr-bg{position:fixed;inset:0;z-index:100000;background:rgba(8,4,20,.45);backdrop-filter:blur(2px);animation:rnFade .25s}
    @keyframes rnFade{from{opacity:0}}
    html.rn-pc .user-profile-header-details-avatar-container{cursor:pointer;transition:transform .2s,filter .2s}
    html.rn-pc .user-profile-header-details-avatar-container:hover{transform:scale(1.04);filter:drop-shadow(0 0 14px rgba(167,139,250,.75))}
    @media (prefers-reduced-motion:reduce){${ON},.rn-dr-panel,.rn-dr-bg{animation:none}}`;
  let pageCss = null, drawer = null, tab = 'wear';
  let store = null;                 // { id, items, next, busy, failed } : la boutique complète, lue à la demande

  /** Marque les sections présentes ; rend [[clé, libellé]] dans l'ordre. */
  function sections() {
    const out = [];
    for (const [k, sel, label] of SECTIONS) {
      const el = document.querySelector(sel);
      if (!el) continue;
      if (el.dataset.rnSec !== k) el.dataset.rnSec = k;
      out.push([k, label]);
    }
    return out;
  }
  function pageMode(on) {
    const root = document.documentElement;
    if (on) {
      if (!pageCss) {
        pageCss = document.createElement('style');
        pageCss.dataset.rn = 'profile-card';
        pageCss.textContent = PAGE_CSS;
      }
      if (!pageCss.isConnected) (document.head || root).append(pageCss);
      root.classList.add('rn-pc');
      sections();
    } else {
      openDrawer(null);
      root.classList.remove('rn-pc');
      pageCss?.remove();
    }
  }
  function showTab(k) {
    tab = k;
    const own = k === 'store';
    for (const el of document.querySelectorAll('[data-rn-sec]')) el.classList.toggle('rn-on', !own && el.dataset.rnSec === k);
    const body = drawer?.panel.querySelector('.rn-dr-body');
    if (body) { body.hidden = !own; if (own) loadStore(body); }
    for (const b of drawer?.panel.querySelectorAll('[data-t]') || []) b.setAttribute('aria-selected', String(b.dataset.t === k));
    const h = drawer?.panel.querySelector('.rn-dr-top')?.offsetHeight;
    if (h) document.documentElement.style.setProperty('--rn-top', h + 'px');
  }
  function drawStore(body) {
    const id = pageUser();
    const user = (document.querySelector('.stylistic-alts-username')?.textContent || '').trim().replace(/^@/, '');
    const all = user ? `https://www.roblox.com/catalog?${new URLSearchParams({ CreatorName: user, CreatorType: 'User' })}` : '';
    if (!store || store.id !== id) return;
    const tiles = store.items.map(i => `<a href="${esc(i.url)}" title="${esc(i.name)}">
        <span class="th">${i.thumb ? `<img src="${esc(i.thumb)}" alt="" loading="lazy" decoding="async">` : ''}</span>
        <span class="nm">${esc(i.name)}</span>
        <span class="pr">${i.offSale ? L('Hors vente', 'Off sale') : i.price ? '⏣ ' + esc(full.format(i.price)) : L('Gratuit', 'Free')}</span></a>`).join('');
    const sk = store.busy ? '<span class="sk"></span>'.repeat(store.items.length ? 3 : 9) : '';
    const empty = !store.busy && !store.items.length
      ? `<p class="rn-dr-empty">${store.failed ? L('Boutique injoignable pour le moment.', 'Store unreachable for now.') : L('Rien en vente.', 'Nothing for sale.')}</p>` : '';
    body.innerHTML = `${empty}<div class="rn-st">${tiles}${sk}</div>
      <div class="rn-dr-more">${store.next && !store.busy ? `<button type="button" data-store-more>${L('Voir plus', 'Load more')}</button>` : ''}
        ${all ? `<a href="${esc(all)}">${L('Tout sur Roblox', 'All on Roblox')} ↗</a>` : ''}</div>`;
  }
  /** Première page à l'ouverture de l'onglet ; `more` : la page suivante. */
  async function loadStore(body, more = false) {
    const id = pageUser();
    if (!store || store.id !== id) store = { id, items: [], next: '', busy: false, failed: false, done: false };
    if (store.busy || (store.done && !more) || (more && !store.next)) { drawStore(body); return; }
    store.busy = true; drawStore(body);
    try {
      const res = await B.runtime.sendMessage({ type: 'ronote:profile-store', userId: id, cursor: more ? store.next : '' });
      if (store.id !== id) return;
      const page = res?.page;
      if (page) { store.items.push(...page.items); store.next = page.next; store.done = true; }
      else store.failed = true;
    } catch { store.failed = true; }
    store.busy = false;
    if (drawer && tab === 'store') drawStore(drawer.panel.querySelector('.rn-dr-body'));
  }
  /** Ouvre le panneau sur l'onglet `k` (null : le ferme). */
  function openDrawer(k) {
    const root = document.documentElement;
    if (!k) {
      root.classList.remove('rn-dr');
      document.querySelectorAll('[data-rn-sec].rn-on').forEach(el => el.classList.remove('rn-on'));
      drawer?.bg.remove(); drawer?.panel.remove(); drawer = null;
      return;
    }
    const list = sections();
    if (!list.length) return;
    if (!list.some(([key]) => key === k)) k = list[0][0];
    if (!drawer) {
      const bg = document.createElement('div'); bg.className = 'rn-dr-bg';
      const panel = document.createElement('div'); panel.className = 'rn-dr-panel';
      panel.setAttribute('role', 'dialog');
      // L'en-tête reprend ce que la page affiche déjà (photo, noms) et la carte (value, rang) : rien à charger.
      const info = document.querySelector('.user-profile-header-info');
      const face = document.querySelector('.user-profile-header-details-avatar-container img')?.src || '';
      const name = info?.querySelector('.text-heading-large')?.textContent.trim() || '';
      const user = info?.querySelector('.stylistic-alts-username')?.textContent.trim() || '';
      const d = data || {};
      const tierOk = d.tier && TIERS[d.tier];
      if (tierOk) panel.classList.add(d.tier);
      const count = (k) => {
        const el = document.querySelector(`[data-rn-sec="${k}"]`);
        return el ? el.querySelectorAll('#collection-carousel-item, ul > li').length : 0;
      };
      panel.innerHTML = `<div class="rn-dr-top">
          <div class="rn-dr-head">
            <div class="rn-dr-av">${/^https:\/\/[a-z0-9.-]+\.rbxcdn\.com\//.test(face) ? `<img src="${esc(face)}" alt="">` : ''}</div>
            <div class="rn-dr-id"><div class="rn-dr-name">${esc(name)}</div><div class="rn-dr-user">${esc(user)}</div>
              <div class="rn-dr-stats">${tierOk ? `<span class="tb">${TIERS[d.tier]}</span>` : ''}
                ${d.value ? `<span>Value <b>${esc(compact.format(d.value))}</b></span>` : ''}
                ${d.rap ? `<span>RAP <b>${esc(compact.format(d.rap))}</b></span>` : ''}
                ${d.discord ? `<span>${esc(d.discord.username ? '@' + d.discord.username : d.discord.name)}</span>` : ''}</div></div>
          </div>
          <div class="rn-dr-tabs" role="tablist">${list.map(([key, label]) => {
            const n = key === 'store' ? 0 : count(key);
            return `<button type="button" role="tab" data-t="${key}">${esc(label)}${n ? `<i>${n}</i>` : ''}</button>`;
          }).join('')}</div>
          <div class="rn-dr-sep"></div>
        </div>
        <div class="rn-dr-body" hidden></div>
        <button class="rn-dr-x" type="button" aria-label="${esc(L('Fermer', 'Close'))}">×</button>`;
      bg.onclick = () => openDrawer(null);
      panel.onclick = (e) => {
        if (e.target.closest('.rn-dr-x')) return openDrawer(null);
        if (e.target.closest('[data-store-more]')) return loadStore(panel.querySelector('.rn-dr-body'), true);
        const b = e.target.closest('[data-t]');
        if (b) showTab(b.dataset.t);
      };
      document.body.append(bg, panel);
      drawer = { bg, panel };
      root.classList.add('rn-dr');
    }
    showTab(k);
  }
  document.addEventListener('click', (e) => {
    if (!enabled || dead || !pageUser()) return;
    if (e.target.closest?.('.user-profile-header-details-avatar-container')) {
      e.preventDefault(); e.stopPropagation(); openDrawer(tab);
    }
  }, true);
  document.addEventListener('keydown', (e) => {
    if (!drawer) return;
    if (e.key === 'Escape') openDrawer(null);
    // Flèches gauche/droite : onglet voisin.
    if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !/input|textarea/i.test(e.target.tagName)) {
      const keys = sections().map(([k]) => k);
      const i = keys.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : -1);
      if (keys[i]) showTab(keys[i]);
    }
  });

  function remove() {
    host?.remove();
    strip?.remove();
    seen?.remove();
    pageMode(false);
  }

  async function run() {
    timer = null;
    if (!alive() || !enabled) return;
    const id = pageUser();
    if (!id) { remove(); return; }
    if (f.panel) pageMode(true);
    if (dataId !== id) { data = null; open = false; }
    if (dataId === id) { place(id); return; }
    if (asking || Date.now() < retryAt) return;
    place(id);                                    // le squelette, le temps de la réponse
    asking = true;
    try {
      const res = await B.runtime.sendMessage({ type: 'ronote:profile-card', userId: id });
      if (res?.off) { enabled = false; remove(); return; }
      if (!res?.card) { retryAt = Date.now() + 15000; if (!data) remove(); return; }
      if (pageUser() !== id) { schedule(); return; }
      data = res.card; dataId = id;
      place(id);
      loadExtras(id);
    } catch {
      if (alive()) retryAt = Date.now() + 8000;
    } finally { asking = false; }
  }

  function schedule() {
    if (dead || timer) return;
    timer = setTimeout(run, 120);
  }

  function shutdown() {
    dead = true;
    observer?.disconnect();
    clearTimeout(timer);
    try { host?.remove(); strip?.remove(); seen?.remove(); pageMode(false); } catch { /* ignore */ }
  }

  // Roblox navigue sans recharger et React redessine le profil : on ne
  // réagit qu'à un changement d'URL ou à la carte décrochée.
  let seenUrl = location.href, onProfile = !!pageUser();
  observer = new MutationObserver(() => {
    if (location.href !== seenUrl) { seenUrl = location.href; onProfile = !!pageUser(); schedule(); return; }
    if (onProfile && enabled && (!host?.isConnected || host.parentElement?.firstElementChild !== host ||
      (data && strip && !strip.isConnected && stripRow()) || (data && seen && !seen.isConnected) ||
      (data && host._nsec < SECTIONS.length))) schedule();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  schedule();
})();
