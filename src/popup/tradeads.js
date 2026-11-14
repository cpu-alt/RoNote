/**
 * ==========================================================================
 *  TRADE ADS : L'AUTO-POST, DANS LE POPUP
 * --------------------------------------------------------------------------
 *  Une seule annonce (4 items offerts au plus, 4 items ou tags demandés),
 *  publiée sur chaque site coché à l'intervalle choisi par le worker
 *  (background/tradeads.js). Ici : l'état de connexion de chaque site, le
 *  choix des items (depuis l'inventaire du portefeuille), l'interrupteur et
 *  le journal des derniers envois. Rien ne part tant que l'interrupteur est
 *  éteint, sauf « Publier maintenant ».
 * ==========================================================================
 */
import { B } from '../common/shim.js';
import { t } from '../common/i18n.js';
import { fmtNum, timeAgo, escapeHtml } from '../common/utils.js';
import { send } from '../common/ui.js';
import { ic } from '../common/icons.js';
import { smartGap, MIN_VALUES } from '../background/tradeads.js';

const TAGS = ['any', 'demand', 'rares', 'robux', 'upgrade', 'downgrade', 'rap', 'wishlist', 'projecteds', 'adds'];
const INTERVALS = [0, 15, 30, 60, 120];   // 0 = malin (background/tradeads.js `smartGap`)

/**
 * Les modèles d'annonce : un clic choisit les items offerts dans l'inventaire et les tags demandés.
 * Les projected ne sont jamais offerts (personne n'en veut au prix affiché). Exportés pour le test.
 */
export const PRESETS = {
  upgrade:   { label: 'Upgrade', hint: 'Plusieurs petits items contre un plus gros', tags: ['upgrade', 'any'], pick: (inv) => inv.slice(-4) },
  downgrade: { label: 'Downgrade', hint: 'Ton plus gros item contre plusieurs, avec adds', tags: ['downgrade', 'adds'], pick: (inv) => inv.slice(0, 1) },
  demand:    { label: 'Demande', hint: 'Tes items les moins demandés contre des items demandés', tags: ['demand', 'rares'],
    pick: (inv) => [...inv].sort((a, b) => (a.demand ?? 9) - (b.demand ?? 9)).slice(0, 4) },
  robux:     { label: 'Robux', hint: 'Tes deux plus gros items contre des Robux', tags: ['robux'], pick: (inv) => inv.slice(0, 2) },
  any:       { label: 'Tout', hint: 'Tes quatre plus gros items, ouvert à toute offre', tags: ['any'], pick: (inv) => inv.slice(0, 4) }
};
/** L'inventaire offrable, du plus cher au moins cher → { offer, tags, items } du modèle. */
export function presetAd(key, inv, idOf = (i) => i.id, filters = {}) {
  const p = PRESETS[key];
  const pool = offerable(inv, filters).filter(i => !i.projected).sort((a, b) => b.value - a.value);
  return p && pool.length ? { offer: p.pick(pool).map(idOf), tags: p.tags, items: [] } : null;
}
/** Les œufs (limiteds de Pâques, « Egg… ») et les petits items n'intéressent personne en trade ad : filtrés au choix. */
export const isEgg = (i) => /\begg/i.test(i.name || '');
export const offerable = (inv, { noEggs = false, minValue = 0 } = {}) =>
  inv.filter(i => i.value > 0 && i.value >= minValue && !(noEggs && isEgg(i)));
const MAX = 4;
const STATES = {
  ok: ['win', 'Connecté'], login: ['loss', 'À connecter'], perm: ['n', 'Autorisation à donner'],
  unknown: ['n', 'Vérifié au premier envoi'], network: ['loss', 'Injoignable']
};
const RESULTS = {
  ok: 'publiée', login: 'connexion à refaire', cooldown: 'délai du site pas écoulé', limit: 'limite du site atteinte',
  daily: 'limite du jour atteinte', perm: 'autorisation manquante', network: 'site injoignable', error: 'refusée'
};

let res = null;            // { cfg, sites }
let report = null;         // le portefeuille (items de l'inventaire)
let found = [];            // la recherche d'items demandés
let query = '';
let pickTab = 'mine';      // le sélecteur d'items : « Mes items » ou « Ce que je demande »
let invQuery = '';

/** L'id que les sites attendent : l'asset, ou l'ancien asset d'un visage (bundle). */
const tradeId = (i) => (i.kind === 'bundle' ? i.faceAssetId : i.id);
const inventory = () => (report?.items || []).filter(i => tradeId(i) > 0);
const nameOf = (id) => inventory().find(i => tradeId(i) === id)?.name || found.find(i => i.assetId === id)?.name || '#' + id;

const chip = (attr, value, label, on) =>
  `<button role="checkbox" aria-checked="${on}" ${attr}="${escapeHtml(String(value))}">${label}</button>`;

const SITE_MARK = { rolimons: 'R', routility: 'U' };

function siteHtml(k, s) {
  const [tone, label] = STATES[s.state] || STATES.unknown;
  const who = s.account?.name ? `@${escapeHtml(s.account.name)}` : t(label);
  // Un seul bouton : l'autorisation du site si elle manque (même geste), puis le login Roblox du site.
  const btn = s.state === 'ok' ? '' : `<button class="ta-btn primary" data-ta-login="${k}">${t('Se connecter avec Roblox')}</button>`;
  return `<div class="ta-site${s.on ? ' on' : ''}">
    <span class="ta-mark ${k}">${SITE_MARK[k] || '?'}</span>
    <span class="ta-site-id"><b>${escapeHtml(s.name)}</b><small><i class="ta-dot ${tone}"></i>${who}</small></span>
    ${btn}
    <label class="ta-switch" title="${escapeHtml(t('Publier sur ce site'))}"><input type="checkbox" data-ta-site="${k}"${s.on ? ' checked' : ''}><i></i></label>
  </div>`;
}

/** Quand part la prochaine annonce sur chaque site coché (même règle que le worker). */
function nextText(cfg, sites) {
  if (!cfg.on) return t('Arrêté : rien ne part tant que l’interrupteur est éteint.');
  const now = Date.now();
  const due = Object.entries(sites).filter(([k, s]) => s.on && cfg.sites[k]).map(([k, s]) => {
    const gap = cfg.interval ? Math.max(s.cooldown, cfg.interval) : smartGap(s);
    return [s.name, Math.max(0, Math.ceil(((cfg.last[k] || 0) + gap * 60e3 - now) / 60e3))];
  });
  if (!due.length) return t('Aucun site coché.');
  return due.map(([n, m]) => (m ? t('{site} dans {n} min', { site: n, n: m }) : t('{site} au prochain passage', { site: n }))).join(' · ');
}

const thumb = (i) => (i?.thumb ? `<img src="${escapeHtml(i.thumb)}" alt="" loading="lazy">` : `<span class="ph">${ic('box')}</span>`);

/** L'aperçu de l'annonce, comme une fenêtre de trade : 4 cases de chaque côté, un clic retire. */
function adPreview(cfg, inv) {
  const byId = new Map(inv.map(i => [tradeId(i), i]));
  const give = Array.from({ length: MAX }, (_, n) => {
    const id = cfg.offer[n];
    if (!id) return '<span class="ta-slot empty"></span>';
    const it = byId.get(id);
    return `<button class="ta-slot" data-ta-offer="${id}" title="${escapeHtml(t('Retirer'))} : ${escapeHtml(it?.name || nameOf(id))}">${thumb(it)}
      <small>${escapeHtml(it?.acronym || it?.name || nameOf(id))}</small></button>`;
  }).join('');
  const asks = [...cfg.items.map(id => ({ item: id })), ...cfg.tags.map(tag => ({ tag }))];
  const get = Array.from({ length: MAX }, (_, n) => {
    const a = asks[n];
    if (!a) return '<span class="ta-slot empty"></span>';
    return a.tag
      ? `<button class="ta-slot" data-ta-tag="${escapeHtml(a.tag)}" title="${escapeHtml(t('Retirer'))}"><span class="ph tag">#</span><small>${escapeHtml(a.tag)}</small></button>`
      : `<button class="ta-slot" data-ta-item="${a.item}" title="${escapeHtml(t('Retirer'))}"><span class="ph">${ic('star')}</span><small>${escapeHtml(nameOf(a.item))}</small></button>`;
  }).join('');
  const total = cfg.offer.reduce((sum, id) => sum + (byId.get(id)?.value || 0), 0);
  return `<div class="ta-trade">
      <div class="ta-side"><div class="ta-side-h"><span>${t('Tu offres')}</span><small>${total ? fmtNum(total) : `${cfg.offer.length}/${MAX}`}</small></div><div class="ta-slots">${give}</div></div>
      <span class="ta-swap">${ic('swap')}</span>
      <div class="ta-side"><div class="ta-side-h"><span>${t('Tu demandes')}</span><small>${asks.length}/${MAX}</small></div><div class="ta-slots">${get}</div></div>
    </div>`;
}

function pickerHtml(cfg, all) {
  const shown = offerable(all, { noEggs: cfg.noEggs, minValue: cfg.minValue });
  const hidden = all.length - shown.length;
  const q = invQuery.trim().toLowerCase();
  const list = q ? shown.filter(i => `${i.name} ${i.acronym || ''}`.toLowerCase().includes(q)) : shown;
  const tabs = `<div class="ta-tabs" role="tablist">
      <button role="tab" aria-selected="${pickTab === 'mine'}" data-ta-pick="mine">${t('Mes items')} <small>${cfg.offer.length}/${MAX}</small></button>
      <button role="tab" aria-selected="${pickTab === 'ask'}" data-ta-pick="ask">${t('Ce que je demande')} <small>${cfg.items.length + cfg.tags.length}/${MAX}</small></button></div>`;
  if (pickTab === 'ask') return `${tabs}
      <div class="ta-tags">${TAGS.map(g => `<button role="checkbox" aria-checked="${cfg.tags.includes(g)}" data-ta-tag="${g}">#${g}</button>`).join('')}</div>
      <input class="ta-q" type="search" data-ta-q placeholder="${escapeHtml(t('Ajouter un item demandé…'))}" value="${escapeHtml(query)}">
      <div class="ta-items">${found.filter(i => !cfg.items.includes(i.assetId)).map(i =>
        `<button class="ta-item" data-ta-item="${i.assetId}"><span class="ph">${ic('plus')}</span><span class="ta-item-n">${escapeHtml(i.name)}</span><b>${fmtNum(i.value)}</b></button>`).join('')}</div>`;
  if (!all.length) return `${tabs}<p class="ta-why">${t('Ouvre l\'onglet Portefeuille une fois : RoNote y lit ton inventaire.')}</p>`;
  return `${tabs}
      <div class="ta-filters">
        <input class="ta-q" type="search" data-ta-invq placeholder="${escapeHtml(t('Chercher dans mes items…'))}" value="${escapeHtml(invQuery)}">
        <label class="ta-chk"><input type="checkbox" data-ta-noeggs${cfg.noEggs ? ' checked' : ''}>${t('Sans les œufs')}</label>
        <label class="ta-sel">${t('Value min.')}<select data-ta-min>${MIN_VALUES.map(v =>
          `<option value="${v}"${v === cfg.minValue ? ' selected' : ''}>${v ? fmtNum(v) : t('aucune')}</option>`).join('')}</select></label>
      </div>
      <div class="ta-items">${list.map(i => {
        const on = cfg.offer.includes(tradeId(i));
        return `<button class="ta-item${on ? ' on' : ''}" role="checkbox" aria-checked="${on}" data-ta-offer="${tradeId(i)}">${thumb(i)}
          <span class="ta-item-n">${escapeHtml(i.name)}${i.projected ? ' <em>P</em>' : ''}</span><b>${fmtNum(i.value)}</b></button>`;
      }).join('') || `<p class="ta-why">${t('Aucun item ne passe les filtres.')}</p>`}</div>
      ${hidden ? `<small class="ta-why">${t('{n} items cachés par les filtres', { n: hidden })}</small>` : ''}`;
}

function paint(root) {
  if (!res?.cfg) { root.innerHTML = `<div class="empty"><b>${t('Chargement…')}</b></div>`; return; }
  const { cfg, sites } = res;
  const all = inventory();
  const asked = cfg.items.length + cfg.tags.length;
  const anySite = Object.entries(sites).some(([k, s]) => cfg.sites[k] && s.on);
  const ready = cfg.offer.length && asked && anySite;
  const scroller = root.closest('main, #list, body') || root, scroll = scroller.scrollTop;   // un clic redessine tout : on reste où on était
  const lastOk = cfg.log.find(l => l.result === 'ok');
  const todo = !anySite ? 'Coche au moins un site.' : !cfg.offer.length ? 'Choisis au moins un item à offrir.' : 'Choisis au moins un tag ou un item demandé.';
  root.innerHTML = `<div class="pf-list ta">
      <section class="ta-hero${cfg.on ? ' live' : ''}">
        <div class="ta-hero-top">
          <span class="ta-hero-ic">${ic('send')}</span>
          <span class="ta-hero-id"><b>${t('Trade ads automatiques')}</b><small>${escapeHtml(nextText(cfg, sites))}</small></span>
          <label class="ta-switch big" title="${escapeHtml(t(cfg.on ? 'Arrêter' : 'Démarrer'))}"><input type="checkbox" data-ta-on${cfg.on ? ' checked' : ''}${ready || cfg.on ? '' : ' disabled'}><i></i></label>
        </div>
        ${ready ? '' : `<small class="ta-hero-todo">${ic('alert')} ${t(todo)}</small>`}
        <div class="ta-hero-foot">
          <small>${lastOk ? t('Dernière annonce publiée {t}', { t: timeAgo(lastOk.at) }) : t('Rien d\'envoyé pour le moment.')}</small>
          <button class="ta-btn" data-ta-now${ready ? '' : ' disabled'}>${ic('send')}${t('Publier maintenant')}</button>
        </div>
      </section>

      <section class="pf-card ta-card"><h3><i>1</i>${t('Où publier')}</h3>
        ${Object.entries(sites).map(([k, s]) => siteHtml(k, s)).join('')}</section>

      <section class="pf-card ta-card"><h3><i>2</i>${t('Ton annonce')}</h3>
        ${all.length ? `<div class="ta-presets">${Object.entries(PRESETS).map(([k, p]) =>
          `<button data-ta-preset="${k}"><b>${escapeHtml(t(p.label))}</b><small>${escapeHtml(t(p.hint))}</small></button>`).join('')}</div>` : ''}
        ${adPreview(cfg, all)}
        ${pickerHtml(cfg, all)}
      </section>

      <section class="pf-card ta-card"><h3><i>3</i>${t('Rythme')}</h3>
        <div class="pf-seg" role="radiogroup" aria-label="${escapeHtml(t('Intervalle'))}">${INTERVALS.map(m =>
          `<button role="radio" aria-checked="${m === cfg.interval}" data-ta-int="${m}">${m ? m + ' min' : t('Malin')}</button>`).join('')}</div>
        <small class="ta-why">${cfg.interval ? t('Une annonce par site à cet intervalle, dans la limite du site.')
          : t("Malin : Rolimon's toutes les 27 min (53 par jour, sans jamais tomber sur la limite de 55), RoUtility toutes les 15 min en remplaçant ta plus vieille annonce.")}</small>
      </section>

      <details class="pf-card ta-card ta-hist"><summary>${ic('journal')}<b>${t('Derniers envois')}</b><small>${cfg.log.length}</small>${ic('chevron')}</summary>
        ${cfg.log.length ? `<ul class="ta-log">${cfg.log.slice(0, 15).map(l => `<li><i class="ta-dot ${l.result === 'ok' ? 'win' : 'loss'}"></i><b>${escapeHtml(sites[l.site]?.name || l.site)}</b>
          <span>${t(RESULTS[l.result] || RESULTS.error)}</span><small>${timeAgo(l.at)}</small></li>`).join('')}</ul>`
          : `<p class="ta-why">${t('Rien d\'envoyé pour le moment.')}</p>`}
      </details>
    </div>`;
  scroller.scrollTop = scroll;
}

async function load(root) {
  res = await send({ type: 'ronote:tradeads-get' }).catch(() => null);
  if (root.dataset.tab === 'tradeads') paint(root);
}

async function save(root, patch) {
  const r = await send({ type: 'ronote:tradeads-save', patch }).catch(() => null);
  if (r?.cfg) res = { ...res, cfg: r.cfg };
  paint(root);
}

const toggle = (arr, v) => (arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);
let searchTimer = 0;

/** Dessine l'onglet dans `listEl` ; les clics sont câblés une seule fois sur lui. */
export function renderTradeAds(listEl, portfolioReport) {
  report = portfolioReport;
  if (!listEl.dataset.taBound) {
    listEl.dataset.taBound = '1';
    listEl.addEventListener('click', async (e) => {
      if (listEl.dataset.tab !== 'tradeads' || !res?.cfg) return;
      const el = e.target.closest('[data-ta-offer], [data-ta-tag], [data-ta-item], [data-ta-int], [data-ta-login], [data-ta-now], [data-ta-preset], [data-ta-pick]');
      if (!el) return;
      const { cfg } = res;
      const d = el.dataset;
      if (d.taPick) { pickTab = d.taPick; paint(listEl); }
      else if (d.taOffer) {
        const next = toggle(cfg.offer, Number(d.taOffer));
        if (next.length <= MAX) save(listEl, { offer: next });
      } else if (d.taTag) {
        const next = toggle(cfg.tags, d.taTag);
        if (next.length + cfg.items.length <= MAX) save(listEl, { tags: next });
      } else if (d.taItem) {
        const next = toggle(cfg.items, Number(d.taItem));
        if (next.length + cfg.tags.length <= MAX) save(listEl, { items: next });
      } else if (d.taInt) save(listEl, { interval: Number(d.taInt) });
      else if (d.taPreset) { const ad = presetAd(d.taPreset, inventory(), tradeId, { noEggs: cfg.noEggs, minValue: cfg.minValue }); if (ad) save(listEl, ad); }
      else if (d.taLogin) {
        // L'autorisation est demandée ici, au clic : Chrome n'accepte la question que sur un geste de l'utilisateur.
        const origin = res.sites[d.taLogin]?.origin;
        if (origin && !(await B.permissions.request({ origins: [origin] }).catch(() => false))) return;
        await send({ type: 'ronote:tradeads-login', site: d.taLogin }).catch(() => null);
        load(listEl);   // panneau latéral : il reste ouvert, on relit l'état
      } else if ('taNow' in d) {
        el.disabled = true;
        await send({ type: 'ronote:tradeads-post' }).catch(() => null);
        load(listEl);
      }
    });
    listEl.addEventListener('change', (e) => {
      if (listEl.dataset.tab !== 'tradeads' || !res?.cfg) return;
      const el = e.target;
      if ('taOn' in el.dataset) save(listEl, { on: el.checked });
      else if (el.dataset.taSite) save(listEl, { sites: { [el.dataset.taSite]: el.checked } });
      else if ('taNoeggs' in el.dataset) save(listEl, { noEggs: el.checked });
      else if ('taMin' in el.dataset) save(listEl, { minValue: Number(el.value) });
    });
    listEl.addEventListener('input', (e) => {
      if (listEl.dataset.tab !== 'tradeads') return;
      if ('taInvq' in (e.target.dataset || {})) {   // recherche locale dans l'inventaire : redessine sans perdre le curseur
        invQuery = e.target.value;
        paint(listEl);
        const q = listEl.querySelector('[data-ta-invq]');
        q?.focus();
        q?.setSelectionRange(q.value.length, q.value.length);
        return;
      }
      if (!('taQ' in (e.target.dataset || {}))) return;
      query = e.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(async () => {
        const r = await send({ type: 'ronote:catalog-search', query }).catch(() => null);
        found = (r?.items || []).filter(i => i.assetId > 0);
        paint(listEl);
        const q = listEl.querySelector('[data-ta-q]');
        q?.focus();
        q?.setSelectionRange(q.value.length, q.value.length);
      }, 250);
    });
  }
  paint(listEl);
  load(listEl);
}
