/**
 * ==========================================================================
 *  MES ITEMS : LE BEST PRICE DE CE QUE JE POSSÈDE (24 novembre)
 * --------------------------------------------------------------------------
 *  Comme le panneau d'un compte suivi sur Discord : pour chaque item de mon
 *  inventaire, le moins cher en vente au catalogue Roblox (best price) et le
 *  ratio best price / RAP. Un ratio haut = l'item se revend bien au-dessus de
 *  son RAP. Insider et Elite (le serveur refuse les autres : `lockHtml`).
 *
 *  Rapide : une seule liste (`/ext/v1/bestprices`, gardée 60 s par le worker
 *  et le serveur), croisée ici avec l'inventaire du Portefeuille déjà en
 *  mémoire (`report.items`, RAP et vignettes compris). Aucun appel à Roblox.
 * ==========================================================================
 */
import { t } from '../common/i18n.js';
import { ic } from '../common/icons.js';
import { fmtNum, escapeHtml } from '../common/utils.js';
import { send } from '../common/ui.js';
import { discoverSwitch } from './deals.js';
import { lockHtml } from './lock.js';
import { askTwoStepCode } from './twostep.js';

const KEY = 'ronote.myitems';
const MINS = [0, 1.2, 1.5, 2];
const SORTS = [['ratio', 'Ratio'], ['gain', 'Profit'], ['bp', 'Prix'], ['value', 'Value']];
let query = '';            // la recherche par nom (non gardée : on rouvre sur tout l'inventaire)
const pick = () => {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(KEY)) || {}; } catch { /* privé */ }
  return { min: MINS.includes(p.min) ? p.min : 0, sort: SORTS.some(([k]) => k === p.sort) ? p.sort : 'ratio', all: !!p.all };
};
const write = (p) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* privé */ } };

let last = null;          // la dernière réponse du worker
let report = null;        // l'inventaire du Portefeuille

/** Mes items en vente, avec ratio et gain (best price − RAP, par copie). Exposé pour les tests. */
export function rowsOf(items, prices) {
  const rows = [], idle = [];
  for (const i of items || []) {
    // un visage est rangé sous son bundle : son ancien asset est l'id que connaît le catalogue
    const bp = prices[String(i.id)] || (i.faceAssetId && prices[String(i.faceAssetId)]) || 0;
    if (!bp || !(i.rap > 0)) { idle.push({ ...i, bp: 0, ratio: 0, gain: 0 }); continue; }
    rows.push({ ...i, bp, ratio: bp / i.rap, gain: bp - i.rap });
  }
  return { rows, unlisted: idle.length, idle };
}

/** Le bandeau du haut : ce que vaut ce qui se revend, et ce qu'on y gagnerait au best price. */
export function totalsOf(rows) {
  let worth = 0, profit = 0, above = 0;
  for (const r of rows) {
    const n = r.count || 1;
    worth += r.bp * n;
    if (r.gain > 0) { profit += r.gain * n; above += 1; }
  }
  return { worth, profit, above };
}

const matches = (r, q) => !q || String(r.name || '').toLowerCase().includes(q)
  || String(r.acronym || '').toLowerCase() === q || String(r.id) === q;

const chip = (attr, v, label, on) => `<button role="radio" aria-checked="${on}" ${attr}="${v}">${label}</button>`;

function rowHtml(r) {
  const img = r.thumb ? `<img src="${escapeHtml(r.thumb)}" alt="" width="34" height="34" loading="lazy" decoding="async">`
    : `<span class="nc-ph">${escapeHtml((r.acronym || r.name || '?').slice(0, 2))}</span>`;
  const url = r.kind === 'bundle' ? `https://www.roblox.com/bundles/${r.id}` : `https://www.roblox.com/catalog/${r.id}`;
  const tone = r.ratio >= 1.5 ? 'hot' : r.ratio >= 1 ? 'up' : 'down';
  return `<div class="mi-row">
    <button class="mi-open" data-open="${url}" title="${escapeHtml(t('Ouvrir sur Roblox'))}">
      <span class="mi-img">${img}${r.count > 1 ? `<i class="nc-n">×${r.count}</i>` : ''}</span>
      <span class="mi-id"><b>${escapeHtml(r.name)}</b><small>RAP ${fmtNum(r.rap)}${r.value > 0 && r.value !== r.rap ? ` · Value ${fmtNum(r.value)}` : ''} · ${r.bp
        ? `${t('Meilleur prix')} <b>${fmtNum(r.bp)}</b>` : t('personne ne le vend')}</small></span>
      ${r.bp ? `<span class="mi-num"><b class="mi-ratio ${tone}">x${r.ratio.toFixed(2)}</b><small class="${r.gain >= 0 ? 'win' : 'loss'}">${r.gain >= 0 ? '+' : '−'}${fmtNum(Math.abs(r.gain))}</small></span>`
        : `<span class="mi-num"><b class="mi-ratio solo">${t('Seul')}</b></span>`}
    </button>
    <button class="mi-sell" data-mi-sell="${escapeHtml(r.key)}">${t('Vendre')}</button>
  </div>`;
}

/**
 * La vente (24 nov.) : « confirmation avant de vraiment mettre en vente, parce que ça arrive vite une
 * bêtise ». Le devis d'abord (copies libres, plancher, frais), le prix modifiable avec ce que je touche,
 * un avertissement sous le RAP ou sous le best price (et alors un second clic), puis la 2SV si Roblox la demande.
 */
function sellDialog(r) {
  return new Promise((resolve) => {
    const back = document.activeElement;
    const wrap = document.createElement('div');
    wrap.className = 'tsv-modal';
    wrap.innerHTML = `<div class="tsv-box mi-sd" role="dialog" aria-modal="true" aria-label="${escapeHtml(t('Mettre en vente'))}">
      <div class="tsv-head">${ic('percent')}<div><b></b><span>${t('Chargement…')}</span></div></div>
      <div class="mi-sd-body" hidden>
        <label class="mi-sd-price"><span>${t('Prix')}</span><input type="text" inputmode="numeric" autocomplete="off"><i>R$</i></label>
        <div class="mi-sd-net"></div><div class="mi-sd-warn" role="alert"></div>
      </div>
      <div class="tsv-foot"><span class="tsv-err" role="alert"></span>
        <button class="tsv-link" type="button" data-cancel>${t('Annuler')}</button>
        <button class="tsv-ok" type="button" disabled>${t('Mettre en vente')}</button></div></div>`;
    wrap.querySelector('.tsv-head b').textContent = r.name;
    document.body.appendChild(wrap);
    const $ = (q) => wrap.querySelector(q);
    const input = $('input'), ok = $('.tsv-ok'), err = $('.tsv-err'), sub = $('.tsv-head span');
    let q = null, busy = false, armed = '';
    const done = (res) => { wrap.remove(); if (back?.isConnected) back.focus?.(); resolve(res); };
    const exact = (n) => Number(n).toLocaleString('en-US');   // une confirmation d'argent : jamais « 63k »
    const price = () => Number(input.value.replace(/\D/g, '')) || 0;
    const refresh = () => {
      const p = price();
      const net = Math.max(0, p - Math.max(q.minFee, Math.floor(p * q.fee / 100)));
      $('.mi-sd-net').innerHTML = p ? t('Tu touches {n} R$ (frais Roblox {f} %)', { n: `<b>${exact(net)}</b>`, f: q.fee }) : '';
      const warn = p && p < q.floor ? t('Minimum {n} R$ pour cet item.', { n: exact(q.floor) })
        : p && p < r.rap ? t('Sous le RAP ({n}) : tu vends à perte.', { n: exact(r.rap) })
        : p && r.bp && p < r.bp ? t('Sous le best price ({n}) : tu seras le moins cher.', { n: exact(r.bp) }) : '';
      $('.mi-sd-warn').textContent = warn;
      $('.mi-sd-warn').className = 'mi-sd-warn' + (p && p < r.rap ? ' bad' : '');
      armed = '';
      ok.disabled = busy || !p || p < q.floor;
      ok.textContent = p ? t('Vendre pour {n} R$', { n: exact(p) }) : t('Mettre en vente');
    };
    async function submit() {
      const p = price();
      if (busy || !q || ok.disabled) return;
      // sous le RAP ou le best price : un second clic, on ne vend pas à perte par mégarde
      if ((p < r.rap || (r.bp && p < r.bp)) && armed !== String(p)) { armed = String(p); ok.textContent = t('Sûr ? Clique encore'); return; }
      busy = true; ok.disabled = true; ok.textContent = t('Mise en vente…'); err.textContent = '';
      let res = await send({ type: 'ronote:sell', kind: r.kind, id: r.id, price: p }).catch((e) => ({ error: String(e?.message || e) }));
      if (res?.twoStep) res = await askTwoStepCode(res.twoStep);
      busy = false;
      if (res?.ok) { done(res); return; }
      if (!res?.cancelled) err.textContent = res?.error || t('La mise en vente a échoué.');
      refresh();
    }
    input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, '').slice(0, 10); err.textContent = ''; if (q) refresh(); });
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !busy) { e.stopPropagation(); done({ cancelled: true }); }
      if (e.key === 'Enter' && e.target === input) { e.preventDefault(); submit(); }
    });
    ok.addEventListener('click', submit);
    $('[data-cancel]').addEventListener('click', () => !busy && done({ cancelled: true }));
    send({ type: 'ronote:sell', dry: true, kind: r.kind, id: r.id }).catch((e) => ({ error: String(e?.message || e) })).then((res) => {
      if (!wrap.isConnected) return;
      q = res?.quote;
      if (!q) { sub.textContent = res?.error || t('Impossible de lire tes copies.'); return; }
      if (!q.copy) { sub.textContent = q.held ? t('Toutes tes copies sont en hold.') : q.onSale ? t('Toutes tes copies sont déjà en vente.') : t('Aucune copie à vendre.'); return; }
      sub.textContent = t('{n} copie(s) vendable(s) · une seule part en vente', { n: q.owned - q.held - q.onSale });
      $('.mi-sd-body').hidden = false;
      input.value = String(Math.max(q.floor, r.bp ? r.bp - 1 : r.value || r.rap || 0));
      refresh();
      input.select(); input.focus();
    });
  });
}

function empty(title, text) {
  return `<div class="empty"><div class="empty-ic">${ic('percent')}</div><b>${t(title)}</b>${text ? `<span>${t(text)}</span>` : ''}</div>`;
}

function paint(root) {
  const p = pick();
  const head = (count) => `<div class="pf-head">${discoverSwitch('myitems', count == null ? '' : `<span class="pf-count">${t('{n} objets', { n: count })}</span>`)}
    <div class="pf-bar"><div class="pf-seg" role="radiogroup" aria-label="${escapeHtml(t('Ratio minimum'))}">${MINS.map(m =>
      chip('data-mi-min', m, m ? 'x' + m + '+' : t('Tous'), m === p.min)).join('')}</div>
      <div class="pf-seg" role="radiogroup" aria-label="${escapeHtml(t('Tri'))}">${SORTS.map(([k, l]) => chip('data-mi-sort', k, t(l), k === p.sort)).join('')}</div></div>
    <div class="pf-bar dl-search"><input type="search" data-mi-q placeholder="${escapeHtml(t('Chercher un item (nom, initiales ou id)'))}"
      value="${escapeHtml(query)}" aria-label="${escapeHtml(t('Chercher un item'))}" autocomplete="off" spellcheck="false">
      <button class="mi-all" role="switch" aria-checked="${p.all}" data-mi-all>${t('Pas en vente aussi')}</button></div></div>`;
  if (!last) { root.innerHTML = head(null) + `<div class="pf-list">${'<div class="pf-skel"></div>'.repeat(4)}</div>`; return; }
  if (last.locked) { root.innerHTML = head(null) + lockHtml(last); return; }
  if (!last.data) {
    root.innerHTML = head(null) + (last.off ? empty('Fiches Neuronal coupées', 'Active « Fiches Neuronal » dans Réglages › Valeurs.')
      : empty('Neuronal est injoignable.', ''));
    return;
  }
  if (!report?.items?.length) { root.innerHTML = head(null) + empty('Inventaire pas encore lu', 'Ouvre le Portefeuille une fois, puis reviens ici.'); return; }
  const { rows, unlisted, idle } = rowsOf(report.items, last.data.prices || {});
  const q = query.trim().toLowerCase();
  const key = { gain: r => r.gain, bp: r => r.bp, value: r => r.value || r.rap, ratio: r => r.ratio }[p.sort];
  const shown = rows.filter(r => r.ratio >= p.min && matches(r, q)).sort((a, b) => key(b) - key(a));
  const solo = p.all && !p.min ? idle.filter(r => matches(r, q)).sort((a, b) => (b.value || b.rap) - (a.value || a.rap)) : [];
  const tot = totalsOf(rows);
  const strip = `<div class="mi-tot">
    <span><small>${t('Revente au best price')}</small><b>${fmtNum(tot.worth)}</b></span>
    <span><small>${t('Profit possible')}</small><b class="win">+${fmtNum(tot.profit)}</b></span>
    <span><small>${t('Au-dessus du RAP')}</small><b>${tot.above}/${rows.length}</b></span></div>`;
  root.innerHTML = head(shown.length + solo.length) + strip + (shown.length + solo.length
    ? `<div class="mi-list">${shown.map(rowHtml).join('')}${solo.length ? `<p class="mi-sep">${t('Personne ne les vend : tu serais le seul')}</p>${solo.map(rowHtml).join('')}` : ''}</div>`
    : empty('Aucun item', q ? 'Aucun item de ton inventaire ne correspond.' : 'Rien de ton inventaire en vente à ce ratio.'))
    + (unlisted && !solo.length ? `<p class="mi-foot">${t('{n} autres items : personne ne les vend en ce moment.', { n: unlisted })}</p>` : '');
}

export async function renderMyItems(root, inventory) {
  report = inventory;
  if (!root.dataset.miBound) {
    root.dataset.miBound = '1';
    root.addEventListener('click', (e) => {
      if (root.dataset.tab !== 'myitems') return;
      const sell = e.target.closest('[data-mi-sell]');
      if (sell) {
        const all = rowsOf(report?.items, last?.data?.prices || {});
        const r = [...all.rows, ...all.idle].find(x => x.key === sell.dataset.miSell);
        if (r) sellDialog(r).then((res) => {
          if (!res?.ok) return;
          sell.textContent = t('En vente ✓'); sell.disabled = true; sell.classList.add('done');
          sell.title = t('Tu touches {n} R$', { n: fmtNum(res.net) });
        });
        return;
      }
      const el = e.target.closest('[data-mi-min], [data-mi-sort], [data-mi-all]');
      if (!el) return;
      const p = pick();
      if (el.dataset.miAll !== undefined) p.all = !p.all;
      else if (el.dataset.miMin !== undefined) p.min = Number(el.dataset.miMin);
      else p.sort = el.dataset.miSort;
      write(p);
      paint(root);
    });
    root.addEventListener('input', (e) => {
      if (root.dataset.tab !== 'myitems' || !e.target.matches('[data-mi-q]')) return;
      query = e.target.value;
      paint(root);
      const box = root.querySelector('[data-mi-q]');   // la liste est redessinée : on garde le curseur dans la recherche
      box?.focus(); box?.setSelectionRange(box.value.length, box.value.length);
    });
  }
  paint(root);
  last = await send({ type: 'ronote:neuronal-bestprices' }).catch(() => null) || { error: 'empty' };
  if (root.dataset.tab === 'myitems') paint(root);
}
