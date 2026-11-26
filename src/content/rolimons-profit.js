/**
 * ==========================================================================
 *  MON PROFIT PAR ITEM, SUR MA PAGE ROLIMON'S (26 novembre)
 * --------------------------------------------------------------------------
 *  Sur rolimons.com/player/<moi> seulement : sous chaque item, ce qu'il a pris
 *  (ou perdu) depuis que je l'ai. La date vient de Rolimon's lui-même
 *  (`scanned_player_assets` de la page : [uaid, serial, créé, possédé depuis]),
 *  la value et le RAP de ce jour-là de l'historique de l'item (même lecture que
 *  la fiche d'un objet, gardée en cache par le worker : `ronote:item-history`).
 *
 *  Économe : les historiques ne sont lus que pour les cartes visibles, deux à
 *  la fois. Réglage `rolimonsProfit` (actif d'office).
 * ==========================================================================
 */
(() => {
  const B = globalThis.browser ?? globalThis.chrome;
  if (!B || globalThis.__rnRoliProfit) return;
  globalThis.__rnRoliProfit = true;

  const pageId = Number((/^\/player\/(\d+)/.exec(location.pathname) || [])[1]);
  if (!pageId) return;

  const fr = (navigator.language || '').toLowerCase().startsWith('fr');
  const L = fr
    ? { profit: 'Mon profit', from: 'Profit depuis', since: 'depuis le', unknown: 'avant l\'historique', rap: 'RAP', noData: 'historique indisponible' }
    : { profit: 'My profit', from: 'Profit since', since: 'since', unknown: 'before the history', rap: 'RAP', noData: 'history unavailable' };
  const MARK = 'data-rn-profit';

  /** Les dates de possession, lues dans le script de la page : { itemId: [ownedSince ms, …] }. */
  function ownedSince() {
    for (const s of document.scripts) {
      const txt = s.textContent;
      const i = txt.indexOf('scanned_player_assets');
      if (i < 0) continue;
      const m = /scanned_player_assets\s*=\s*(\{[\s\S]*?\});/.exec(txt.slice(i - 10));
      if (!m) continue;
      try {
        const raw = JSON.parse(m[1]), out = {};
        for (const [id, copies] of Object.entries(raw)) {
          out[id] = (copies || []).map(c => Number(c?.[3] || c?.[2]) || 0).filter(Boolean);
        }
        return out;
      } catch { return null; }
    }
    return null;
  }

  /** Value et RAP à une date, d'après un historique { t, v, r } (avant le premier relevé : le premier). */
  function priceAt(h, at) {
    if (!h?.t?.length) return null;
    let i = 0;
    while (i + 1 < h.t.length && h.t[i + 1] <= at) i++;
    return { v: h.v[i] || 0, r: h.r[i] || 0, before: at < h.t[0] };
  }

  const short = (n) => {
    const a = Math.abs(n);
    const s = a >= 1e6 ? (a / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M' : a >= 1e3 ? (a / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k' : String(Math.round(a));
    return (n > 0 ? '+' : n < 0 ? '−' : '') + s;
  };
  const day = (ms) => new Date(ms).toLocaleDateString(fr ? 'fr-FR' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' });

  const cache = new Map();          // itemId -> Promise<historique|null>
  let running = 0;
  const waiting = [];
  function history(id) {
    if (!cache.has(id)) {
      cache.set(id, new Promise((resolve) => {
        waiting.push(() => B.runtime.sendMessage({ type: 'ronote:item-history', itemId: id })
          .then(r => resolve(r?.history || null), () => resolve(null)));
        pump();
      }));
    }
    return cache.get(id);
  }
  function pump() {
    while (running < 2 && waiting.length) {
      const job = waiting.shift();
      running++;
      job().finally(() => { running--; pump(); });
    }
  }

  let owned = null;

  async function decorate(card) {
    if (card.hasAttribute(MARK)) return;
    card.setAttribute(MARK, '1');
    const id = Number((/\/item\/(\d+)/.exec(card.querySelector('a[href*="/item/"]')?.getAttribute('href') || '') || [])[1]);
    const dates = owned?.[id];
    const box = card.querySelector('.item_card_details_container');
    if (!id || !dates?.length || !box) return;
    const line = document.createElement('div');
    line.className = 'rn-profit';
    line.textContent = '…';
    box.appendChild(line);
    const h = await history(id);
    const now = h?.t?.length ? { v: h.v[h.v.length - 1], r: h.r[h.r.length - 1] } : null;
    if (!now) { line.textContent = L.noData; line.classList.add('na'); return; }
    let dv = 0, dr = 0, cost = 0, before = false;
    for (const at of dates) {
      const then = priceAt(h, at);
      const base = then.v || then.r, cur = now.v || now.r;
      dv += cur - base; dr += now.r - then.r; cost += base;
      before = before || then.before;
    }
    const pct = cost > 0 ? Math.round(dv / cost * 100) : null;
    line.innerHTML = '';
    const head = document.createElement('span');
    // Possédé avant le premier relevé de Rolimon's : le profit part de ce relevé, et on le dit.
    head.textContent = before ? `${L.from} ${new Date(h.t[0]).getFullYear()}` : L.profit;
    const val = document.createElement('b');
    val.className = dv > 0 ? 'up' : dv < 0 ? 'down' : '';
    val.textContent = short(dv) + (pct == null ? '' : ` (${pct > 0 ? '+' : ''}${pct} %)`);
    line.append(head, val);
    line.title = `${L.since} ${day(Math.min(...dates))}${before ? ` (${L.unknown})` : ''} · ${L.rap} ${short(dr)}`;
  }

  let io = null, mo = null;
  function scan() {
    for (const c of document.querySelectorAll(`.mix_item:not([${MARK}])`)) io.observe(c);
  }

  function start() {
    owned = ownedSince();
    if (!owned) return;
    const css = document.createElement('style');
    css.textContent = `.rn-profit{display:flex;justify-content:space-between;gap:6px;margin-top:3px;padding-top:3px;border-top:1px solid #ffffff14;font-size:12px;color:#9aa4b2}
      .rn-profit b{font-weight:700;color:#cfd6df}.rn-profit b.up{color:#3fbf7f}.rn-profit b.down{color:#f0565e}.rn-profit.na{opacity:.6;font-size:11px}`;
    document.head.appendChild(css);
    io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { io.unobserve(e.target); decorate(e.target); }
    }, { rootMargin: '200px' });
    let t = 0;
    // Rolimon's redessine la grille à chaque page, tri ou recherche : on relève les nouvelles cartes, groupées.
    mo = new MutationObserver(() => { clearTimeout(t); t = setTimeout(scan, 150); });
    mo.observe(document.body, { childList: true, subtree: true });
    scan();
  }

  B.storage.local.get(['state', 'settings']).then(({ state, settings }) => {
    if (settings?.rolimonsProfit === false || settings?.useRolimons === false) return;
    if (Number(state?.userId) !== pageId) return;          // seulement MA page
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }).catch(() => {});
})();
