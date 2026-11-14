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

const TAGS = ['any', 'demand', 'rares', 'robux', 'upgrade', 'downgrade', 'rap', 'wishlist', 'projecteds', 'adds'];
const INTERVALS = [15, 20, 30, 60, 120];
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

/** L'id que les sites attendent : l'asset, ou l'ancien asset d'un visage (bundle). */
const tradeId = (i) => (i.kind === 'bundle' ? i.faceAssetId : i.id);
const inventory = () => (report?.items || []).filter(i => tradeId(i) > 0);
const nameOf = (id) => inventory().find(i => tradeId(i) === id)?.name || found.find(i => i.assetId === id)?.name || '#' + id;

const chip = (attr, value, label, on) =>
  `<button role="checkbox" aria-checked="${on}" ${attr}="${escapeHtml(String(value))}">${label}</button>`;

function siteHtml(k, s) {
  const [tone, label] = STATES[s.state] || STATES.unknown;
  const who = s.account?.name ? ` · @${escapeHtml(s.account.name)}` : '';
  const btn = s.state === 'perm' ? `<button class="pf-send" data-ta-perm="${k}">${t('Autoriser')}</button>`
    : s.state === 'ok' ? '' : `<button data-open="${escapeHtml(s.login)}">${t('Se connecter')}</button>`;
  return `<div class="ta-site">
    <label class="ta-check"><input type="checkbox" data-ta-site="${k}"${s.on ? ' checked' : ''}>
      <b>${escapeHtml(s.name)}</b></label>
    <span class="ta-st ${tone}">${t(label)}${who}</span>${btn}
  </div>`;
}

function paint(root) {
  if (!res?.cfg) { root.innerHTML = `<div class="empty"><b>${t('Chargement…')}</b></div>`; return; }
  const { cfg, sites } = res;
  const inv = inventory();
  const asked = cfg.items.length + cfg.tags.length;
  const ready = cfg.offer.length && asked;
  const scroller = root.closest('main, #list, body') || root, scroll = scroller.scrollTop;   // un clic redessine tout : on reste où on était
  root.innerHTML = `<div class="pf-head">
      <div class="ta-top"><b>${t('Trade ads automatiques')}</b>
        <label class="ta-check"><input type="checkbox" data-ta-on${cfg.on ? ' checked' : ''}${ready ? '' : ' disabled'}> ${t(cfg.on ? 'Activé' : 'Arrêté')}</label></div>
      <div class="pf-seg" role="radiogroup" aria-label="${escapeHtml(t('Intervalle'))}">${INTERVALS.map(m =>
        `<button role="radio" aria-checked="${m === cfg.interval}" data-ta-int="${m}">${m} min</button>`).join('')}</div>
    </div>
    <div class="pf-list">
      <section class="pf-card ta-card"><h3>${t('Sites')}</h3>${Object.entries(sites).map(([k, s]) => siteHtml(k, s)).join('')}</section>
      <section class="pf-card ta-card"><h3>${t('J\'offre')} <small>${cfg.offer.length}/${MAX}</small></h3>
        ${inv.length ? `<div class="ta-grid ta-inv">${inv.map(i => chip('data-ta-offer', tradeId(i),
          `${escapeHtml(i.acronym || i.name)} <small>${fmtNum(i.value)}</small>`, cfg.offer.includes(tradeId(i)))).join('')}</div>`
          : `<p class="ta-why">${t('Ouvre l\'onglet Portefeuille une fois : RoNote y lit ton inventaire.')}</p>`}
      </section>
      <section class="pf-card ta-card"><h3>${t('Je demande')} <small>${asked}/${MAX}</small></h3>
        <div class="ta-grid">${TAGS.map(g => chip('data-ta-tag', g, g, cfg.tags.includes(g))).join('')}</div>
        <div class="ta-grid">${cfg.items.map(id => chip('data-ta-item', id, escapeHtml(nameOf(id)), true)).join('')}</div>
        <input class="ta-q" type="search" data-ta-q placeholder="${escapeHtml(t('Ajouter un item demandé…'))}" value="${escapeHtml(query)}">
        <div class="ta-grid">${found.filter(i => !cfg.items.includes(i.assetId)).map(i =>
          chip('data-ta-item', i.assetId, `${escapeHtml(i.name)} <small>${fmtNum(i.value)}</small>`, false)).join('')}</div>
      </section>
      <section class="pf-card ta-card"><h3>${t('Derniers envois')}</h3>
        ${cfg.log.length ? `<ul class="ta-log">${cfg.log.slice(0, 10).map(l => `<li><b>${escapeHtml(sites[l.site]?.name || l.site)}</b>
          <span class="${l.result === 'ok' ? 'win' : 'loss'}">${t(RESULTS[l.result] || RESULTS.error)}</span><small>${timeAgo(l.at)}</small></li>`).join('')}</ul>`
          : `<p class="ta-why">${t('Rien d\'envoyé pour le moment.')}</p>`}
        <footer class="pf-acts"><button class="pf-send" data-ta-now${ready ? '' : ' disabled'}>${t('Publier maintenant')}</button>
          <small class="ta-why">${t('Jamais plus d\'une annonce par site toutes les 15 min.')}</small></footer>
      </section>
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
      const el = e.target.closest('[data-ta-offer], [data-ta-tag], [data-ta-item], [data-ta-int], [data-ta-perm], [data-ta-now]');
      if (!el) return;
      const { cfg } = res;
      const d = el.dataset;
      if (d.taOffer) {
        const next = toggle(cfg.offer, Number(d.taOffer));
        if (next.length <= MAX) save(listEl, { offer: next });
      } else if (d.taTag) {
        const next = toggle(cfg.tags, d.taTag);
        if (next.length + cfg.items.length <= MAX) save(listEl, { tags: next });
      } else if (d.taItem) {
        const next = toggle(cfg.items, Number(d.taItem));
        if (next.length + cfg.tags.length <= MAX) save(listEl, { items: next });
      } else if (d.taInt) save(listEl, { interval: Number(d.taInt) });
      else if (d.taPerm) {
        // Demandée ici, au clic : Chrome n'accepte la question que sur un geste de l'utilisateur.
        const origin = res.sites[d.taPerm]?.origin;
        if (origin && await B.permissions.request({ origins: [origin] }).catch(() => false)) load(listEl);
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
    });
    listEl.addEventListener('input', (e) => {
      if (listEl.dataset.tab !== 'tradeads' || !('taQ' in (e.target.dataset || {}))) return;
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
