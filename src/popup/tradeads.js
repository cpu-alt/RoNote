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
import { lockHtml } from './lock.js';
import { smartGap, MIN_VALUES, OP_VALUES, RELAY_HOURS, pickAd, onlyAd, tirageAlea, isEgg as eggTest } from '../background/tradeads.js';

const TAGS = ['any', 'demand', 'rares', 'robux', 'upgrade', 'downgrade', 'rap', 'wishlist', 'projecteds', 'adds'];
const INTERVALS = [0, 15, 30, 60, 120];   // 0 = malin (background/tradeads.js `smartGap`)

/**
 * Les modèles d'annonce : un clic choisit les items offerts dans l'inventaire et les tags demandés.
 * Les projected ne sont jamais offerts (personne n'en veut au prix affiché). Exportés pour le test.
 */
export const PRESETS = {
  // Aléatoire (le réglage préféré de MYd) : quatre items tirés au hasard parmi ceux qui valent au moins 1 000
  // (jamais d'œuf ni de projected), retirés à chaque envoi par le worker (`alea`). Pas de seuil relatif au plus gros item.
  random:    { label: 'Aléatoire', hint: '4 items au hasard (value 1 000 et plus), retirés à chaque envoi, contre any, demand, upgrade, downgrade',
    tags: ['any', 'demand', 'upgrade', 'downgrade'], absolu: true, alea: true, pick: (inv, rnd) => tirageAlea(inv, [], rnd) },
  // Smart Upgrade : tes items qui comptent (les trois plus gros, chacun au moins le quart du premier), pas tes miettes.
  upgrade:   { label: 'Smart Upgrade', hint: 'Tes meilleurs items contre un plus gros, sans les miettes', tags: ['upgrade', 'demand'],
    pick: (inv) => inv.filter(i => i.value >= inv[0].value / 4).slice(0, 3) },
  downgrade: { label: 'Downgrade', hint: 'Ton plus gros item contre plusieurs, avec adds', tags: ['downgrade', 'adds'], pick: (inv) => inv.slice(0, 1) },
  demand:    { label: 'Demande', hint: 'Tes items les moins demandés contre des items demandés', tags: ['demand', 'rares'],
    pick: (inv) => [...inv].sort((a, b) => (a.demand ?? 9) - (b.demand ?? 9)).slice(0, 4) },
  robux:     { label: 'Robux', hint: 'Tes deux plus gros items contre des Robux', tags: ['robux'], pick: (inv) => inv.slice(0, 2) },
  any:       { label: 'Tout', hint: 'Tes quatre plus gros items, ouvert à toute offre', tags: ['any'], pick: (inv) => inv.slice(0, 4) }
};
/** L'inventaire offrable, du plus cher au moins cher → { offer, tags, items } du modèle. */
export function presetAd(key, inv, idOf = (i) => i.id, filters = {}, rnd = Math.random) {
  const p = PRESETS[key];
  const all = offerable(inv, { ...filters, noProjected: true, noEggs: true }, idOf).sort((a, b) => b.value - a.value);
  const pool = p?.absolu ? all : all.filter(i => i.value >= all[0].value / 20);   // sinon jamais un item à moins de 5 % du plus gros
  const offer = p && pool.length ? p.pick(pool, rnd).map(idOf) : [];
  return offer.length ? { offer, tags: p.tags, items: [], alea: !!p.alea } : null;
}
/** Les œufs (limiteds de Pâques, « Egg… ») et les petits items n'intéressent personne en trade ad : filtrés au choix. */
export const isEgg = eggTest;
export const offerable = (inv, { noEggs = false, minValue = 0, noProjected = false, exclude = [] } = {}, idOf = (i) => i.id) =>
  inv.filter(i => i.value > 0 && i.value >= minValue && !(noEggs && isEgg(i)) && !(noProjected && i.projected) && !exclude.includes(idOf(i)));
/** Le tri de la liste « Mes items ». */
export const SORTS = {
  value: ['Value', (a, b) => b.value - a.value],
  demand: ['Demande', (a, b) => (b.demand ?? -1) - (a.demand ?? -1) || b.value - a.value],
  name: ['Nom', (a, b) => String(a.name).localeCompare(String(b.name))]
};
/** Un fichier de configuration lu → patch (le worker re-nettoie tout), ou null s'il n'en est pas un. */
export function parseConfigFile(text) {
  let o; try { o = JSON.parse(text); } catch { return null; }
  if (o?.ronote === 'tradeads' && o.ad) o = o.ad;
  const ad = onlyAd(o);
  return Object.keys(ad).length ? ad : null;
}
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
let invSort = 'value';
let showExcluded = false;
const LIST_STEP = 60;         // « Mes items » : 60 lignes dessinées, le reste à la demande (gros inventaires)
let listCap = LIST_STEP;
const askInfo = new Map();   // assetId → { name, acronym, value, thumb } des items demandés (catalogue du worker)
let flash = '';              // message bref (import réussi, copié…)

/** L'id que les sites attendent : l'asset, ou l'ancien asset d'un visage (bundle). */
const tradeId = (i) => (i.kind === 'bundle' ? i.faceAssetId : i.id);
const inventory = () => (report?.items || []).filter(i => tradeId(i) > 0);
const nameOf = (id) => inventory().find(i => tradeId(i) === id)?.name || askInfo.get(id)?.name || found.find(i => i.assetId === id)?.name || '#' + id;
const filtersOf = (cfg) => ({ noEggs: cfg.noEggs, minValue: cfg.minValue, noProjected: cfg.noProjected, exclude: cfg.exclude || [] });
const dots = (d) => (d == null || d < 0 ? '' : `<i class="ta-dem" title="${escapeHtml(t('Demande'))} ${d}/4">${'●'.repeat(Math.min(5, d + 1))}</i>`);

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
  if (!cfg.on) return t('Rien ne part tant que l’interrupteur est éteint.');
  if (cfg.relay) return t('Le serveur Neuronal publie à ta place.');
  const now = Date.now();
  const due = Object.entries(sites).filter(([k, s]) => s.on && cfg.sites[k]).map(([k, s]) => {
    const gap = cfg.interval ? Math.max(s.cooldown, cfg.interval) : smartGap(s);
    return [s.name, Math.max(0, Math.ceil(((cfg.last[k] || 0) + gap * 60e3 - now) / 60e3))];
  });
  if (!due.length) return t('Aucun site coché.');
  return due.map(([n, m]) => (m ? t('{site} dans {n} min', { site: n, n: m }) : t('{site} au prochain passage', { site: n }))).join(' · ');
}

const tagImg = (g) => `https://www.rolimons.com/images/tradetag${encodeURIComponent(g)}-420.png`;   // les vraies vignettes des tags Rolimons
const thumb = (i) => (i?.thumb ? `<img src="${escapeHtml(i.thumb)}" alt="" loading="lazy">` : `<span class="ph">${ic('box')}</span>`);

/** L'aperçu de l'annonce, comme une fenêtre de trade : 4 cases de chaque côté, un clic retire. */
function adPreview(cfg, inv) {
  const byId = new Map(inv.map(i => [tradeId(i), i]));
  const give = Array.from({ length: MAX }, (_, n) => {
    const id = cfg.offer[n];
    if (!id) return '<span class="ta-slot empty"></span>';
    const it = byId.get(id) || askInfo.get(id);   // pas (ou plus) dans l'inventaire chargé : le catalogue
    return `<button class="ta-slot" data-ta-offer="${id}" title="${escapeHtml(t('Retirer'))} : ${escapeHtml(it?.name || nameOf(id))}">${thumb(it)}
      <small>${escapeHtml(it?.acronym || it?.name || nameOf(id))}</small></button>`;
  }).join('');
  const asks = [...cfg.items.map(id => ({ item: id })), ...cfg.tags.map(tag => ({ tag }))];
  const get = Array.from({ length: MAX }, (_, n) => {
    const a = asks[n];
    if (!a) return '<span class="ta-slot empty"></span>';
    return a.tag
      ? `<button class="ta-slot" data-ta-tag="${escapeHtml(a.tag)}" title="${escapeHtml(t('Retirer'))}"><img src="${tagImg(a.tag)}" alt=""><small>${escapeHtml(a.tag)}</small></button>`
      : `<button class="ta-slot" data-ta-item="${a.item}" title="${escapeHtml(t('Retirer'))} : ${escapeHtml(nameOf(a.item))}">${askInfo.get(a.item)?.thumb ? thumb(askInfo.get(a.item)) : `<span class="ph">${ic('star')}</span>`}<small>${escapeHtml(askInfo.get(a.item)?.acronym || nameOf(a.item))}</small></button>`;
  }).join('');
  const total = cfg.offer.reduce((sum, id) => sum + (byId.get(id)?.value || 0), 0);
  const want = cfg.items.reduce((sum, id) => sum + (askInfo.get(id)?.value || 0), 0);
  const bal = total && want ? `<div class="ta-bal" title="${escapeHtml(t("Équilibre de l'annonce"))}"><i style="width:${Math.round(100 * total / (total + want))}%"></i></div>
    <small class="ta-why">${want > total ? t('Tu demandes {p} % de plus que ce que tu offres', { p: Math.round(100 * (want - total) / total) })
      : t('Tu offres {p} % de plus que ce que tu demandes', { p: Math.round(100 * (total - want) / want) })}</small>` : '';
  return `<div class="ta-trade">
      <div class="ta-side"><div class="ta-side-h"><span>${t('Tu offres')}</span><small>${total ? fmtNum(total) : `${cfg.offer.length}/${MAX}`}</small></div><div class="ta-slots">${give}</div></div>
      <span class="ta-swap">${ic('swap')}</span>
      <div class="ta-side"><div class="ta-side-h"><span>${t('Tu demandes')}</span><small>${want ? fmtNum(want) : `${asks.length}/${MAX}`}</small></div><div class="ta-slots">${get}</div></div>
    </div>${bal}`;
}

function pickerHtml(cfg, all) {
  const excl = cfg.exclude || [];
  const shown = offerable(all, filtersOf(cfg), tradeId);
  const hidden = all.length - shown.length;
  const q = invQuery.trim().toLowerCase();
  const base = showExcluded ? all.filter(i => excl.includes(tradeId(i))) : shown;
  const list = (q ? base.filter(i => `${i.name} ${i.acronym || ''}`.toLowerCase().includes(q)) : base).slice().sort(SORTS[invSort][1]);
  const tabs = `<div class="ta-tabs" role="tablist">
      <button role="tab" aria-selected="${pickTab === 'mine'}" data-ta-pick="mine">${t('Mes items')} <small>${cfg.offer.length}/${MAX}</small></button>
      <button role="tab" aria-selected="${pickTab === 'ask'}" data-ta-pick="ask">${t('Ce que je demande')} <small>${cfg.items.length + cfg.tags.length}/${MAX}</small></button></div>`;
  if (pickTab === 'ask') return `${tabs}
      <div class="ta-filters ta-req">
        <label class="ta-chk"><input type="checkbox" data-ta-reqalea${cfg.reqAlea ? ' checked' : ''}>${t('Demande aléatoire')}</label>
        <label class="ta-sel">${t('Overpay')}<select data-ta-op>${OP_VALUES.map(v =>
          `<option value="${v}"${v === cfg.op ? ' selected' : ''}>+${v} %</option>`).join('')}</select></label>
        ${cfg.reqAlea ? `<button class="ta-btn" data-ta-draw>${ic('swap')}${t('Tirer')}</button>` : ''}
      </div>
      ${cfg.reqAlea ? `<small class="ta-why">${t('Des items au hasard qui valent ce que tu offres, plus {p} % : nouveaux à chaque envoi. Choisis un item à la main pour arrêter.', { p: cfg.op })}</small>` : ''}
      <div class="ta-tags">${TAGS.map(g => `<button role="checkbox" aria-checked="${cfg.tags.includes(g)}" data-ta-tag="${g}"><img src="${tagImg(g)}" alt="" class="ta-tag-img">${g}</button>`).join('')}</div>
      <input class="ta-q" type="search" data-ta-q placeholder="${escapeHtml(t('Ajouter un item demandé…'))}" value="${escapeHtml(query)}">
      <div class="ta-items">${found.filter(i => !cfg.items.includes(i.assetId)).map(i =>
        `<button class="ta-item" data-ta-item="${i.assetId}">${i.thumb ? thumb(i) : `<span class="ph">${ic('plus')}</span>`}<span class="ta-item-n">${escapeHtml(i.name)}</span><b>${fmtNum(i.value)}</b></button>`).join('')}</div>`;
  if (!all.length) return `${tabs}<p class="ta-why">${t('Ouvre l\'onglet Portefeuille une fois : RoNote y lit ton inventaire.')}</p>`;
  return `${tabs}
      <div class="ta-filters">
        <input class="ta-q" type="search" data-ta-invq placeholder="${escapeHtml(t('Chercher dans mes items…'))}" value="${escapeHtml(invQuery)}">
        <label class="ta-chk"><input type="checkbox" data-ta-noeggs${cfg.noEggs ? ' checked' : ''}>${t('Sans les œufs')}</label>
        <label class="ta-chk"><input type="checkbox" data-ta-noproj${cfg.noProjected ? ' checked' : ''}>${t('Sans les projected')}</label>
        <label class="ta-sel">${t('Value min.')}<select data-ta-min>${MIN_VALUES.map(v =>
          `<option value="${v}"${v === cfg.minValue ? ' selected' : ''}>${v ? fmtNum(v) : t('aucune')}</option>`).join('')}</select></label>
        <label class="ta-sel">${t('Trier')}<select data-ta-sort>${Object.entries(SORTS).map(([k, [l]]) =>
          `<option value="${k}"${k === invSort ? ' selected' : ''}>${t(l)}</option>`).join('')}</select></label>
      </div>
      ${excl.length ? `<button class="ta-link" data-ta-showx>${showExcluded ? t('← Retour à mes items') : t('{n} items exclus : les voir', { n: excl.length })}</button>` : ''}
      <div class="ta-items">${list.slice(0, listCap).map(i => {
        const id = tradeId(i), on = cfg.offer.includes(id), x = excl.includes(id);
        return `<div class="ta-row"><button class="ta-item${on ? ' on' : ''}" role="checkbox" aria-checked="${on}" ${x ? 'disabled' : `data-ta-offer="${id}"`}>${thumb(i)}
          <span class="ta-item-n">${escapeHtml(i.name)}${i.projected ? ' <em>P</em>' : ''}${dots(i.demand)}</span><b>${fmtNum(i.value)}</b></button>
          <button class="ta-x" data-ta-excl="${id}" title="${escapeHtml(t(x ? 'Remettre dans la liste' : 'Exclure : ne jamais offrir cet item'))}">${ic(x ? 'undo' : 'ban')}</button></div>`;
      }).join('') || `<p class="ta-why">${t('Aucun item ne passe les filtres.')}</p>`}</div>
      ${list.length > listCap ? `<button class="ta-link" data-ta-more>${t('Voir {n} de plus', { n: Math.min(LIST_STEP, list.length - listCap) })}</button>` : ''}
      ${hidden && !showExcluded ? `<small class="ta-why">${t('{n} items cachés par les filtres', { n: hidden })}</small>` : ''}`;
}

function paint(root) {
  if (!res?.cfg) { root.innerHTML = `<div class="empty"><b>${t('Chargement…')}</b></div>`; return; }
  if (res.locked) { root.innerHTML = `<div class="pf-list ta">${lockHtml(res)}</div>`; return; }
  const { cfg, sites } = res;
  const all = inventory();
  const asked = cfg.items.length + cfg.tags.length;
  const anySite = Object.entries(sites).some(([k, s]) => cfg.sites[k] && s.on);
  const ready = cfg.offer.length && asked && anySite;
  const scroller = root.closest('main, #list, body') || root, scroll = scroller.scrollTop;   // un clic redessine tout : on reste où on était
  const lastOk = cfg.log.find(l => l.result === 'ok');
  const todo = !anySite ? 'Coche au moins un site.' : !cfg.offer.length ? 'Choisis au moins un item à offrir.' : 'Choisis au moins un tag ou un item demandé.';
  const byId = new Map(all.map(i => [tradeId(i), i]));
  const offered = cfg.offer.reduce((sum, id) => sum + (byId.get(id)?.value || 0), 0);
  const today = cfg.log.filter(l => l.result === 'ok' && Date.now() - l.at < 864e5).length;
  const fact = (label, value, sub = '') => `<div class="w-fact"><span>${label}</span><b>${value}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  // Même dessin que la fiche d'un objet : l'état en grand, quatre chiffres, puis l'annonce et ses réglages.
  root.innerHTML = `<div class="pf-list ta">
      <section class="ta-head${cfg.on ? ' live' : ''}">
        <div class="ta-head-top">
          <div class="ta-state"><span class="ta-pulse"></span>${t(cfg.on ? 'En ligne' : 'Arrêté')}</div>
          <label class="ta-switch big" title="${escapeHtml(t(cfg.on ? 'Arrêter' : 'Démarrer'))}"><input type="checkbox" data-ta-on${cfg.on ? ' checked' : ''}${ready || cfg.on ? '' : ' disabled'}><i></i></label>
        </div>
        <small class="ta-head-sub">${escapeHtml(nextText(cfg, sites))}</small>
        <div class="w-facts">
          ${fact(t('Tu offres'), offered ? fmtNum(offered) : '–', t('{n} sur {m} items', { n: cfg.offer.length, m: MAX }))}
          ${fact(t('Tu demandes'), `${asked}/${MAX}`, cfg.tags.length ? cfg.tags.map(g => '#' + escapeHtml(g)).join(' ') : '')}
          ${fact(t("Aujourd'hui"), String(today), t('annonces publiées'))}
          ${fact(t('Dernière'), lastOk ? timeAgo(lastOk.at) : '–', lastOk ? escapeHtml(sites[lastOk.site]?.name || lastOk.site) : '')}
        </div>
        ${ready ? '' : `<div class="w-warn">${ic('alert')} ${t(todo)}</div>`}
        <button class="ta-btn wide" data-ta-now${ready ? '' : ' disabled'}>${ic('send')}${t('Publier maintenant')}</button>
      </section>

      <section class="pf-card ta-card"><h3>${t('Ton annonce')}</h3>
        ${all.length ? `<div class="ta-presets">${Object.entries(PRESETS).map(([k, p]) =>
          `<button data-ta-preset="${k}" title="${escapeHtml(t(p.hint))}"${k === 'random' && cfg.alea ? ' class="on"' : ''}>${escapeHtml(t(p.label))}</button>`).join('')}</div>` : ''}
        ${cfg.alea ? `<small class="ta-why">${t('Aléatoire : 4 nouveaux items (value 1 000 et plus) à chaque envoi. Choisis un autre modèle ou un item pour arrêter.')}</small>` : ''}
        ${adPreview(cfg, all)}
        ${pickerHtml(cfg, all)}
        <label class="ta-note"><span>${t("Message de l'annonce")} <small>(RoUtility)</small></span>
          <input class="ta-q" type="text" maxlength="200" data-ta-note value="${escapeHtml(cfg.note || '')}" placeholder="${escapeHtml(t('Ex. : ouvert aux overpays, pas de lowball'))}"></label>
      </section>

      <section class="pf-card ta-card"><h3>${t('Où publier')}</h3>
        ${Object.entries(sites).map(([k, s]) => siteHtml(k, s)).join('')}</section>

      ${relayHtml(cfg, ready)}

      <section class="pf-card ta-card"><h3>${t('Rythme')}</h3>
        <div class="pf-seg" role="radiogroup" aria-label="${escapeHtml(t('Intervalle'))}">${INTERVALS.map(m =>
          `<button role="radio" aria-checked="${m === cfg.interval}" data-ta-int="${m}">${m ? m + ' min' : t('Malin')}</button>`).join('')}</div>
        <small class="ta-why">${cfg.interval ? t('Une annonce par site à cet intervalle, dans la limite du site.')
          : t("Malin : Rolimon's toutes les 27 min (53 par jour, sans jamais tomber sur la limite de 55), RoUtility toutes les 15 min en remplaçant ta plus vieille annonce.")}</small>
      </section>

      <details class="pf-card ta-card ta-hist"><summary>${ic('download')}<b>${t('Configurations')}</b><small>${(cfg.saved || []).length}</small>${ic('chevron')}</summary>
        ${(cfg.saved || []).length ? `<ul class="ta-saved">${cfg.saved.map((c, n) => `<li>
          <button class="ta-saved-n" data-ta-load="${n}" title="${escapeHtml(t('Charger cette configuration'))}"><b>${escapeHtml(c.name)}</b>
            <small>${t('{o} offerts · {d} demandés', { o: c.ad.offer.length, d: c.ad.items.length + c.ad.tags.length })}</small></button>
          <button class="ta-x" data-ta-del="${n}" title="${escapeHtml(t('Supprimer'))}">${ic('x')}</button></li>`).join('')}</ul>` : ''}
        <div class="ta-cfg-row"><input class="ta-q" type="text" maxlength="40" data-ta-name placeholder="${escapeHtml(t('Nom de la configuration'))}">
          <button class="ta-btn" data-ta-savecfg>${ic('plus')}${t('Enregistrer')}</button></div>
        <div class="ta-cfg-row">
          <button class="ta-btn" data-ta-export>${ic('download')}${t('Exporter')}</button>
          <button class="ta-btn" data-ta-copy>${ic('copy')}${t('Copier')}</button>
          <button class="ta-btn" data-ta-import>${ic('upload')}${t('Importer')}</button>
          <input type="file" accept=".json,application/json" data-ta-file hidden>
        </div>
        <small class="ta-why">${flash ? escapeHtml(flash) : t("Un fichier .json garde l'annonce, les filtres, les exclus et le rythme : à réimporter ou à partager.")}</small>
      </details>

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
  refreshAsk(root);
}

/** Vignette, nom et value des items demandés : le catalogue déjà en cache du worker, une fois par item. */
async function refreshAsk(root) {
  const inInv = new Set(inventory().map(tradeId));
  const miss = [...(res?.cfg?.items || []), ...(res?.cfg?.offer || []).filter(id => !inInv.has(id))].filter(id => !askInfo.has(id));
  if (!miss.length) return;
  const r = await send({ type: 'ronote:catalog-search', ids: miss.map(assetId => ({ assetId })) }).catch(() => null);
  for (const i of r?.items || []) askInfo.set(i.assetId, i);
  if (r?.items?.length && root.dataset.tab === 'tradeads') paint(root);
}

async function save(root, patch) {
  const r = await send({ type: 'ronote:tradeads-save', patch }).catch(() => null);
  if (r?.cfg) res = { ...res, cfg: r.cfg, sites: Object.fromEntries(Object.entries(res.sites || {}).map(([k, s]) => [k, { ...s, on: !!r.cfg.sites[k] }])) };
  paint(root);
  refreshAsk(root);
}
function say(root, msg) {
  flash = msg;
  paint(root);
  setTimeout(() => { if (flash !== msg) return; flash = ''; if (root.dataset.tab === 'tradeads') paint(root); }, 4000);
}
const exportText = (cfg) => JSON.stringify({ ronote: 'tradeads', v: 1, ad: pickAd(cfg) }, null, 2);

const toggle = (arr, v) => (arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]);
let searchTimer = 0, invTimer = 0;
let relayHours = 0;   // par défaut : jusqu'à la reprise
const RELAY_ERR = {
  permission: "Autorisation refusée : RoNote ne peut pas lire tes sessions.",
  no_session: 'Connecte-toi d’abord aux sites cochés (bouton « Se connecter avec Roblox »).',
  premium: 'Réservé aux abonnés, comme l’auto-post.', empty_ad: 'Ton annonce est vide.',
  network: 'Serveur Neuronal injoignable, réessaie.'
};

/** La carte « Pendant que tu dors » : envoyer l'auto-post sur le serveur, ou le reprendre ici. */
function relayHtml(cfg, ready) {
  if (cfg.relay) {
    return `<section class="pf-card ta-card ta-relay on"><h3>${ic('moon')}${t('Sur le serveur')}</h3>
      <p class="ta-why">${cfg.relay.until
        ? t("Le serveur Neuronal publie ton annonce jusqu'à {h}. Tu peux éteindre ton PC.", { h: new Date(cfg.relay.until).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }) })
        : t('Le serveur Neuronal publie ton annonce jusqu’à ce que tu reprennes ici ou que le site te déconnecte. Tu peux éteindre ton PC.')}</p>
      <button class="ta-btn wide primary" data-ta-resume>${ic('download')}${t('Reprendre ici')}</button>
      <small class="ta-why">${flash ? escapeHtml(flash) : t('Le journal et les derniers tirages reviennent ici ; le serveur efface tes sessions.')}</small></section>`;
  }
  return `<section class="pf-card ta-card ta-relay"><h3>${ic('moon')}${t('Pendant que tu dors')}</h3>
    <p class="ta-why">${t('Continue l’auto-post sur le serveur Neuronal quand ton PC est éteint, avec les mêmes règles.')}</p>
    <div class="pf-seg" role="radiogroup" aria-label="${escapeHtml(t('Durée'))}">${RELAY_HOURS.map(h =>
      `<button role="radio" aria-checked="${h === relayHours}" data-ta-hours="${h}">${h ? h + ' h' : t('Sans limite')}</button>`).join('')}</div>
    <button class="ta-btn wide" data-ta-relay${ready ? '' : ' disabled'}>${ic('upload')}${t('Continuer sur le serveur')}</button>
    <small class="ta-why">${flash ? escapeHtml(flash) : t('Tes sessions Rolimon’s et RoUtility (pas Roblox) partent chiffrées, et sont effacées à la reprise, à l’échéance ou au premier refus du site.')}</small></section>`;
}

/** « Tirer » : le worker refait les tirages (offre et demande aléatoires) sans rien publier. */
async function drawNow(listEl) {
  await send({ type: 'ronote:tradeads-draw' }).catch(() => null);
  await load(listEl);
}

/** Dessine l'onglet dans `listEl` ; les clics sont câblés une seule fois sur lui. */
export function renderTradeAds(listEl, portfolioReport) {
  report = portfolioReport;
  if (!listEl.dataset.taBound) {
    listEl.dataset.taBound = '1';
    listEl.addEventListener('click', async (e) => {
      if (listEl.dataset.tab !== 'tradeads' || !res?.cfg) return;
      const el = e.target.closest('[data-ta-offer], [data-ta-tag], [data-ta-item], [data-ta-int], [data-ta-login], [data-ta-now], [data-ta-preset], [data-ta-pick], [data-ta-excl], [data-ta-showx], [data-ta-load], [data-ta-del], [data-ta-savecfg], [data-ta-export], [data-ta-copy], [data-ta-import], [data-ta-more], [data-ta-draw], [data-ta-hours], [data-ta-relay], [data-ta-resume]');
      if (!el) return;
      const { cfg } = res;
      const d = el.dataset;
      if (d.taHours) { relayHours = Number(d.taHours); paint(listEl); }
      else if ('taRelay' in d) {
        // La permission est demandée ici, au clic (Chrome ne la propose que sur un geste de l'utilisateur).
        if (!(await B.permissions.request({ permissions: ['cookies'] }).catch(() => false))) return say(listEl, t(RELAY_ERR.permission));
        el.disabled = true;
        const r = await send({ type: 'ronote:tradeads-relay', hours: relayHours }).catch(() => null);
        await load(listEl);
        if (!r?.cfg) say(listEl, t(RELAY_ERR[r?.error] || RELAY_ERR.network));
        else say(listEl, t('Le serveur a pris le relais.'));
      } else if ('taResume' in d) {
        el.disabled = true;
        const r = await send({ type: 'ronote:tradeads-resume' }).catch(() => null);
        await load(listEl);
        say(listEl, r?.cfg ? t('Repris ici : le navigateur publie de nouveau.') : t(RELAY_ERR.network));
      } else if ('taMore' in d) { listCap += LIST_STEP; paint(listEl); }
      else if ('taDraw' in d) { el.disabled = true; await drawNow(listEl); }
      else if (d.taPick) { pickTab = d.taPick; paint(listEl); }
      else if (d.taExcl) save(listEl, { exclude: toggle(cfg.exclude || [], Number(d.taExcl)) });
      else if ('taShowx' in d) { showExcluded = !showExcluded; paint(listEl); }
      else if (d.taLoad) { const c = cfg.saved[Number(d.taLoad)]; if (c) { await save(listEl, c.ad); say(listEl, t('« {n} » chargée', { n: c.name })); } }
      else if (d.taDel) save(listEl, { saved: cfg.saved.filter((_, n) => n !== Number(d.taDel)) });
      else if ('taSavecfg' in d) {
        const name = listEl.querySelector('[data-ta-name]')?.value.trim() || t('Config {n}', { n: cfg.saved.length + 1 });
        await save(listEl, { saved: [...cfg.saved.filter(c => c.name !== name), { name, ad: pickAd(cfg) }] });
        say(listEl, t('« {n} » enregistrée', { n: name }));
      } else if ('taExport' in d) {
        const url = URL.createObjectURL(new Blob([exportText(cfg)], { type: 'application/json' }));
        Object.assign(document.createElement('a'), { href: url, download: 'ronote-tradeads.json' }).click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      } else if ('taCopy' in d) {
        const ok = await navigator.clipboard.writeText(exportText(cfg)).then(() => true, () => false);
        say(listEl, ok ? t('Configuration copiée') : t('Copie refusée par le navigateur'));
      } else if ('taImport' in d) listEl.querySelector('[data-ta-file]')?.click();
      else if (d.taOffer) {
        const next = toggle(cfg.offer, Number(d.taOffer));
        if (next.length <= MAX) save(listEl, { offer: next });
      } else if (d.taTag) {
        const next = toggle(cfg.tags, d.taTag);
        if (next.length + cfg.items.length <= MAX) save(listEl, { tags: next });
      } else if (d.taItem) {
        const next = toggle(cfg.items, Number(d.taItem));
        const f = found.find(i => i.assetId === Number(d.taItem));
        if (f) askInfo.set(f.assetId, f);
        if (next.length + cfg.tags.length <= MAX) save(listEl, { items: next });
      } else if (d.taInt) save(listEl, { interval: Number(d.taInt) });
      else if (d.taPreset) { const ad = presetAd(d.taPreset, inventory(), tradeId, filtersOf(cfg)); if (ad) save(listEl, ad); }
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
      else if ('taNoproj' in el.dataset) save(listEl, { noProjected: el.checked });
      else if ('taSort' in el.dataset) { invSort = SORTS[el.value] ? el.value : 'value'; paint(listEl); }
      else if ('taNote' in el.dataset) save(listEl, { note: el.value });
      else if ('taReqalea' in el.dataset) save(listEl, { reqAlea: el.checked }).then(() => el.checked && drawNow(listEl));
      else if ('taOp' in el.dataset) save(listEl, { op: Number(el.value) }).then(() => res?.cfg?.reqAlea && drawNow(listEl));
      else if ('taFile' in el.dataset && el.files?.[0]) {
        el.files[0].text().then(async (txt) => {
          const ad = parseConfigFile(txt);
          if (!ad) return say(listEl, t("Ce fichier n'est pas une configuration RoNote"));
          await save(listEl, ad);
          say(listEl, t('Configuration importée'));
        });
      }
    });
    listEl.addEventListener('input', (e) => {
      if (listEl.dataset.tab !== 'tradeads') return;
      if ('taInvq' in (e.target.dataset || {})) {   // recherche locale dans l'inventaire : redessine sans perdre le curseur
        invQuery = e.target.value;
        listCap = LIST_STEP;
        clearTimeout(invTimer);   // un seul dessin par pause de frappe, pas un par lettre
        invTimer = setTimeout(() => {
          paint(listEl);
          const q = listEl.querySelector('[data-ta-invq]');
          q?.focus();
          q?.setSelectionRange(q.value.length, q.value.length);
        }, 120);
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
