import { B } from '../common/shim.js';
import {
  fmtNum, fmtPct, fmtFull, fmtSigned, fmtDate, timeAgo, timeUntil, toneOf, escapeHtml, clamp
} from '../common/utils.js';
import { DEMAND_LABEL, TREND_LABEL } from '../common/roli.js';
import { t, p as plural, locale } from '../common/i18n.js';
import { ic, fillIcons } from '../common/icons.js';
import { partnerTimeline, partnerStats, accountAge, YOUNG_ACCOUNT_DAYS } from '../common/player.js';
import { withDefaults, withStateDefaults } from '../common/state.js';
import { $, send, ask, applyLang as applyPageLang, onStoredChange, factHtml } from '../common/ui.js';
import { renderCoin, coinKey } from './coinflip.js';
import { recapStats, recapMonths, drawRecap, drawWallet, FLEX_PLOT } from './recap.js';
import { goalHtml, mountGoalEditor } from './goal.js';
import { BACKGROUNDS, loadBackground, compose, thumbnail } from './flexbg.js';
import { GifEncoder } from './gif.js';

const listEl = $('#list');
fillIcons(document);   // les icônes écrites en dur dans popup.html

/* Repères d'un objet : diamant « rare » et Lucky Cat de Rolimon's, dessinés
   par content/item-marks.js comme sur la page Roblox. `lucky` est l'exemplaire
   tiré en ce moment, que le service worker range sous `luckyCat`. */
const MARKS = globalThis.RoNoteMarks;
let lucky = null;
if (MARKS) document.head.append(Object.assign(document.createElement('style'), { textContent: MARKS.INLINE_CSS }));
const showsRare = (i) => !!MARKS && data.settings?.showRare !== false && !!i.rare;
const showsLucky = (i) => !!MARKS && data.settings?.showLuckyCat !== false && MARKS.isLucky(lucky, i);
const marksHtml = (i) => (showsLucky(i) ? MARKS.inline.lucky(lucky) : '') + (showsRare(i) ? MARKS.inline.rare() : '');
const marksSig = () => [data.settings?.showRare, data.settings?.showLuckyCat, lucky?.uaid || 0];

let data = { settings: null, state: null, history: [], portfolio: [], report: null };
let tab = 'home';
const cards = { inbound: new Map(), outbound: new Map(), completed: new Map() };
const failures = { inbound: new Map(), outbound: new Map(), completed: new Map() };

/**
 * PAS SEULEMENT LES 25 DERNIERS.
 *
 * La vérification ne relève que le haut de chaque liste (25 trades). La suite
 * se charge page par page en arrivant en bas : `cursor` vaut undefined tant que
 * rien n'est chargé, null une fois au bout. La première page recouvre le
 * relevé ; les doublons sont écartés à l'affichage.
 */
const SNAPSHOT_SIZE = 25;   // trades relevés à chaque vérification (service worker)
const LIST_KINDS = ['inbound', 'outbound', 'completed'];
const freshMore = () => ({ trades: [], cursor: undefined, loading: false, error: '' });
const more = Object.fromEntries(LIST_KINDS.map(k => [k, freshMore()]));

/** La liste complète d'un onglet : le relevé de la vérification, puis la suite chargée. */
function listOf(kind) {
  const snap = data.state?.snapshot?.[kind] || [];
  const extra = more[kind]?.trades;
  // Relevé incomplet : toute la liste y tient, la suite chargée plus tôt est périmée.
  if (!extra?.length || snap.length < SNAPSHOT_SIZE) return snap;
  const seen = new Set(snap.map(x => x.tradeId));
  return snap.concat(extra.filter(x => !seen.has(x.tradeId)));
}

/** Il reste des trades à charger sous cette liste. */
const hasMore = (kind) => (data.state?.snapshot?.[kind] || []).length >= SNAPSHOT_SIZE && more[kind]?.cursor !== null;

/** Un trade refusé ou annulé quitte aussi la suite chargée. */
function forgetTrade(id) {
  for (const k of LIST_KINDS) more[k].trades = more[k].trades.filter(x => x.tradeId !== id);
}
const expanded = new Set();     // trades dont le detail des objets est deplie
const shownCards = new Set();   // cartes deja montrees evaluees : leur arrivee ne se rejoue pas
let zoomed = null;              // trade (ou objet) affiche en grand, ou null

/** Filtre de chaque liste. Il ne regarde que ce popup : « Tous » à chaque ouverture. */
const listFilter = { inbound: 'all', outbound: 'all', completed: 'all', history: 'all' };

const tradeUrl = (id) => `https://www.roblox.com/trades?tradeId=${id}`;

const KIND_ICON = {
  inbound: 'inbox', counter: 'counter', completed: 'check-circle', outbound: 'send',
  outbound_accepted: 'party', outbound_declined: 'x-circle', outbound_countered: 'counter',
  outbound_expired: 'clock', trade_error: 'alert', declined_by_me: 'ban'
};

/** Ce que raconte chaque ligne du journal, et sa couleur. */
const KIND_INFO = {
  inbound:            { label: 'Nouveau trade reçu', tone: 'accent' },
  counter:            { label: 'Contre-offre reçue', tone: 'accent' },
  completed:          { label: 'Trade complété', tone: 'win' },
  outbound_accepted:  { label: 'Ton trade a été accepté', tone: 'win' },
  outbound_declined:  { label: 'Ton trade a été refusé', tone: 'loss' },
  outbound_countered: { label: 'Ton trade a été contré', tone: 'warn' },
  outbound_expired:   { label: 'Ton trade a expiré', tone: 'even' },
  trade_error:        { label: 'Trade rejeté (erreur Roblox)', tone: 'loss' },
  declined_by_me:     { label: 'Refusé ou annulé depuis RoNote', tone: 'even' },
  revalued:           { label: 'Objet réévalué', tone: 'face' }
};

const STATUS_LABEL = {
  Open: 'En attente', Pending: 'En cours', Processing: 'En cours',
  Completed: 'Accepté', Declined: 'Refusé', Countered: 'Contré',
  Expired: 'Expiré', RejectedDueToError: 'Rejeté (erreur)',
  InterventionRequired: 'Intervention Roblox', Unknown: ''
};

const BASIS_SHORT = { value: 'Value', rap: 'RAP', prudent: 'Prudent' };

/**
 * Durées relatives qui avancent seules : le minuteur de fin de fichier réécrit
 * leur texte, sans reconstruire la liste qui les contient.
 */
const msOf = (at) => (typeof at === 'number' ? at : Date.parse(at) || 0);
const agoHtml = (at) => `<span data-ago="${msOf(at)}">${timeAgo(msOf(at))}</span>`;
const untilHtml = (at) => `<span data-until="${msOf(at)}">${timeUntil(msOf(at))}</span>`;

/* ================================ entête ================================ */

function renderHeader() {
  const { settings, state } = data;
  // Mode anonyme : le pseudo disparaît aussi (partage d'écran, stream).
  if (wallet.hidden && state?.userName) $('#acct').innerHTML = `${ic('eye-off')} ${t('Mode anonyme')}`;
  else $('#acct').textContent = state?.userName ? '@' + state.userName : t('Non connecté');

  const inb = state?.inboundCount || 0;
  $('#cnt-inbound').textContent = inb || '';
  $('#cnt-inbound').classList.toggle('zero', !inb);

  const trackedCount = Object.keys(state?.tracked || {}).length;
  $('#cnt-tracked').textContent = trackedCount || '';
  $('#cnt-tracked').classList.toggle('zero', !trackedCount);

  const btn = $('#btn-toggle');
  btn.innerHTML = ic(settings?.enabled ? 'pause' : 'play');
  btn.classList.toggle('off', !settings?.enabled);

  const dot = $('#dot'), txt = $('#status-text');
  dot.className = 'dot';
  if (!settings?.enabled) {
    dot.classList.add('warn');
    txt.textContent = t('Surveillance en pause');
  } else if (state?.lastError) {
    dot.classList.add('err');
    txt.textContent = state.lastError.message;
  } else if (state?.lastOkAt) {
    dot.classList.add('ok');
    txt.textContent = t('Actif · vérifié {ago}', { ago: timeAgo(state.lastOkAt) });
  } else {
    txt.textContent = t('Première vérification en cours…');
  }

  // Etat des cotes : combien d'objets connus, et depuis quand. Une table
  // perimee change la lecture de tous les chiffres affiches, ca se dit.
  const cotes = $('#status-cotes');
  if (state?.valueCount) {
    const ago = state.valueTs ? timeAgo(state.valueTs) : '';
    cotes.innerHTML = state.valueStale
      ? ic('clock') + ' ' + escapeHtml(t('cotes {ago}', { ago }))
      : escapeHtml(t('{n} cotes · {ago}', { n: fmtNum(state.valueCount), ago }));
    cotes.style.color = state.valueStale ? 'var(--warn)' : '';
  } else {
    cotes.textContent = '';
  }

  const seeded = state?.snapshot?.at;
  $('#foot-meta').textContent = trackedCount
    ? plural(trackedCount, '{n} trade suivi', '{n} trades suivis')
    : (seeded ? timeAgo(seeded) : '');
}

/* ============================== un objet ================================ */

function itemTitle(i) {
  const bits = [i.name];
  if (i.serial) bits.push(`#${i.serial}`);
  if (i.unknown) {
    bits.push(t('aucune cote — visage récent, objet de bundle ou nouveauté'));
  } else {
    bits.push(t('Value {v}', { v: fmtFull(i.value) }) + (i.noValue ? ' ' + t('(RAP faute de cote)') : ''));
    bits.push(t('RAP {v}', { v: fmtFull(i.rap) }));
    if (i.ratio) bits.push(t('Value = {n}× le RAP', { n: i.ratio.toFixed(1) }));
  }
  if (i.isFace) bits.push(t('visage (bundle DynamicHead)'));
  else if (i.isBundle) bits.push(t('bundle #{id}', { id: i.bundleId }));
  if (i.demandLabel) bits.push(t('Demande : {v}', { v: t(i.demandLabel) }));
  if (i.trendLabel) bits.push(t('Tendance : {v}', { v: t(i.trendLabel) }));
  if (i.rare) bits.push(t('RARE'));
  if (showsLucky(i)) bits.push(t("LUCKY CAT — cet exemplaire donne le RoliBadge de Rolimon's"));
  if (i.speculative) bits.push(t('cote spéculative : très au-dessus des ventes réelles'));
  if (i.moved) {
    bits.push(t('cote révisée : {from} → {to} ({pct})',
      { from: fmtFull(i.moved.from), to: fmtFull(i.moved.to), pct: fmtPct(i.moved.pct) }));
  }
  if (i.projected) bits.push(t('PROJECTED — RAP gonflé artificiellement'));
  if (i.onHold) bits.push(t('en attente (hold Roblox)'));
  return bits.join(' · ');
}

const itemClasses = (i) => [
  i.unknown ? 'unk' : '', i.isFace ? 'face' : '',
  i.speculative ? 'spec' : '', i.projected ? 'proj' : '', i.moved ? 'moved' : ''
].filter(Boolean).join(' ');

const itemIcon = (i) => (i.isFace ? 'face' : i.unknown ? 'help' : 'box');

/**
 * Objet « projected » : son RAP a été gonflé par des rachats entre complices.
 * Un petit triangle ambré le signale partout où l'objet apparaît — discret,
 * mais visible sans avoir à survoler quoi que ce soit.
 */
const PROJ_ICON = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 .9 11.4 10.6H.6Z" fill="currentColor"/>'
  + '<path d="M6 4.3v3.1M6 9v.05" stroke="#1d1405" stroke-width="1.5" stroke-linecap="round"/></svg>';
const projBadge = () =>
  `<i class="proj-ic" title="${escapeHtml(t('PROJECTED — RAP gonflé artificiellement'))}">${PROJ_ICON}</i>`;

/** Étiquettes courtes d'un objet, pour les listes détaillées. */
function itemTags(i) {
  return [
    i.serial ? `#${i.serial}` : '',
    i.isFace ? t('visage') : i.isBundle ? t('bundle') : '',
    i.projected ? t('projected') : '',
    i.rare ? t('rare') : '',
    i.demandLabel ? t('demande {v}', { v: t(i.demandLabel).toLowerCase() }) : ''
  ].filter(Boolean).join(' · ');
}

/* ============================ une carte : pièces ========================= */

/** Le chiffre qui compte, selon la base choisie dans les réglages. */
const mainOf = (side, a) => (a.basis === 'rap' ? side.rap : a.basis === 'prudent' ? side.prudent : side.value);
/** Le verdict en icône : flamme pour un excellent trade, tête de mort pour un très mauvais, point de couleur sinon. */
const verdictIcon = (v) => ic(v?.label === 'Excellent' ? 'flame' : v?.label === 'Très mauvais' ? 'skull'
  : v?.tone === 'unknown' ? 'help' : 'dot');
const cardTone = (a) => (!a ? 'even' : a.incomplete ? 'unknown' : toneOf(a.pctMain, 3));

const partnerName = (c) => escapeHtml(c.partner?.displayName || c.partner?.name || t('Joueur'));
const partnerHandle = (c) => (c.partner?.name && c.partner.name !== c.partner.displayName
  ? ` <span class="s">@${escapeHtml(c.partner.name)}</span>` : '');
const avatarHtml = (c) => (c.headshot
  ? `<img class="av" src="${escapeHtml(c.headshot)}" alt="" data-icon="">`
  : '<div class="av ph"></div>');
/** L'avatar ouvre la fiche du joueur ; sans identifiant connu, il reste une image. */
const avatarBtn = (c, ring) => (Number(c.partner?.id)
  ? `<button class="av-ring av-btn ${ring}" data-player="${Number(c.partner.id)}" title="${escapeHtml(t('Fiche du joueur'))}">${avatarHtml(c)}</button>`
  : `<span class="av-ring ${ring}">${avatarHtml(c)}</span>`);

/** Quatre vignettes au plus par côté : au-delà, la dernière devient « +n ». */
function tilesHtml(side) {
  if (!side.items.length) return `<div class="tc-tiles"><div class="tc-tile empty">—</div></div>`;
  const cut = side.items.length > 4 ? 3 : 4;
  const shown = side.items.slice(0, cut).map(i => {
    const cls = itemClasses(i);
    const title = escapeHtml(itemTitle(i));
    const tile = i.thumb
      ? `<img class="tc-tile ${cls}" src="${escapeHtml(i.thumb)}" alt="" title="${title}" data-icon="${itemIcon(i)}" decoding="async">`
      : `<div class="tc-tile ph ${cls}" title="${title}">${ic(itemIcon(i))}</div>`;
    const marks = marksHtml(i);
    return i.projected || marks
      ? `<span class="tc-tw">${tile}${i.projected ? projBadge() : ''}${marks ? `<span class="tc-mk">${marks}</span>` : ''}</span>`
      : tile;
  }).join('');
  const rest = side.items.slice(cut);
  const more = rest.length
    ? `<div class="tc-tile more" title="${escapeHtml(rest.map(i => i.name).join(', '))}">+${rest.length}</div>`
    : '';
  return `<div class="tc-tiles">${shown}${more}</div>`;
}

/** Un côté du trade : ses objets, son total, puis le RAP, les Robux et les objets sans cote. */
function sideHtml(title, side, a, incoming) {
  // Un côté dont on ne connaît aucun objet ne vaut pas zéro : il vaut
  // « on ne sait pas ». Afficher 0 serait un mensonge par arrondi.
  const blind = side.itemCount > 0 && side.unknownCount === side.itemCount && !side.robux;
  const sub = [];
  if (a.hasValues) sub.push(a.basis === 'rap' ? `Value ${fmtNum(side.value)}` : `RAP ${fmtNum(side.rap)}`);
  if (side.robux > 0) {
    const net = incoming && side.robuxNet !== side.robux;
    sub.push(`<span class="tc-rbx"${net ? ` title="${escapeHtml(t('net de 30 %'))}"` : ''}>R$ ${fmtNum(net ? side.robuxNet : side.robux)}</span>`);
  }
  if (side.unknownCount) {
    sub.push(`<span class="tc-unk" title="${escapeHtml((side.unknownItems || []).join(', '))}">${t('+{n} sans cote', { n: side.unknownCount })}</span>`);
  }
  return `<div class="tc-side ${incoming ? 'get' : 'give'}">
    <div class="tc-side-h">${title}</div>
    ${tilesHtml(side)}
    <div class="tc-amt">${blind ? '<span class="tc-blind">—</span>' : fmtFull(mainOf(side, a))}</div>
    <div class="tc-sub">${sub.join(' · ')}</div>
  </div>`;
}

/**
 * Le verdict du trade : l'écart en grand sur fond vert ou rouge, le
 * pourcentage à côté, le RAP en regard. LE chiffre de la carte.
 */
function balanceHtml(a, { big = false } = {}) {
  const size = big ? ' big' : '';
  if (a.incomplete) {
    return `<div class="tc-bal unknown${size}">
      <span class="tc-bal-l">${t('Écart')}</span>
      <b style="color:var(--face)">${t('non calculable')}</b>
      <span class="tc-bal-a">${plural(a.unknownCount, '{n} objet sans cote', '{n} objets sans cote')}</span>
    </div>`;
  }
  const tone = toneOf(a.pctMain, 3);
  const aside = a.hasValues && a.basis === 'value' ? `RAP ${fmtSigned(a.deltaRap)} (${fmtPct(a.pctRap)})` : '';
  return `<div class="tc-bal ${tone}${size}">
    <span class="tc-bal-l">${t(BASIS_SHORT[a.basis] || 'Value')}</span>
    <b class="${tone}">${fmtSigned(a.deltaMain, true)}</b>
    <span class="tc-bal-p ${tone}">${fmtPct(a.pctMain)}</span>
    ${aside ? `<span class="tc-bal-a">${aside}</span>` : ''}
  </div>`;
}

/**
 * Ce qui doit nuancer la lecture du chiffre. La cote Rolimon's est une cote
 * communautaire : elle bouge, elle peut s'éloigner des ventes réelles, et elle
 * peut contredire le RAP. On le dit au lieu de le masquer derrière un total.
 */
function flagsHtml(a) {
  const chips = [];
  if (a.divergent) {
    chips.push(`<span class="chip mixed" title="${escapeHtml(t("La cote communautaire et les ventes réelles ne vont pas dans le même sens : trancher reviendrait à parier sur l'une des deux."))}">${ic('scale')} ${t('Value {a} vs RAP {b}', { a: fmtPct(a.pctValue), b: fmtPct(a.pctRap) })}</span>`);
  }
  if (a.speculativeIncoming) {
    const worst = a.get.items.filter(i => i.speculative).sort((x, y) => y.ratio - x.ratio)[0];
    chips.push(`<span class="chip spec" title="${escapeHtml(t("Cote très au-dessus des ventes réelles : elle repose sur l'avis de la communauté, pas sur des transactions."))}">${ic('trend-up')} ${t('Spéculatif')}${worst?.ratio ? ` ${worst.ratio.toFixed(1)}× RAP` : ''}</span>`);
  }
  if (a.movedItems?.length) {
    const m = a.movedItems[0];
    const all = a.movedItems.map(x => `${x.name} : ${fmtFull(x.moved.from)} → ${fmtFull(x.moved.to)}`).join(' · ');
    chips.push(`<span class="chip moved" title="${escapeHtml(all)}">${ic('revised')} ${escapeHtml(m.name)} ${fmtPct(m.moved.pct)}</span>`);
  }
  if (a.faceCount) {
    const names = [...a.give.items, ...a.get.items].filter(i => i.isFace).map(i => i.name).join(' · ');
    chips.push(`<span class="chip face" title="${escapeHtml(names)}">${ic('face')} ${plural(a.faceCount, '{n} visage', '{n} visages')}</span>`);
  }
  if (a.projectedIncoming) {
    chips.push(`<span class="chip proj" title="${escapeHtml(t("Le RAP de cet objet a été gonflé par des rachats entre complices : s'y fier est le piège classique."))}"><i class="proj-ic">${PROJ_ICON}</i> ${t('Projected')}</span>`);
  }
  if (a.robuxTaxed) {
    chips.push(`<span class="chip tax" title="${escapeHtml(t('Roblox prélève 30 % sur les Robux reçus dans un trade. Le total ci-dessus compte le net.'))}">${ic('percent')} ${t('−{n} R$ de taxe', { n: fmtNum(a.robuxLost) })}</span>`);
  }
  if (a.valueStale) {
    chips.push(`<span class="chip stale" title="${escapeHtml(t("La table Rolimon's n'a pas pu être rafraîchie : les cotes affichées peuvent avoir été révisées depuis."))}">${ic('clock')} ${t('Cotes non actualisées')}</span>`);
  }
  return chips.length ? `<div class="flags">${chips.join('')}</div>` : '';
}

/* --------------------------- détail des objets -------------------------- */

const itemUrl = (i) => (i.bundleId
  ? `https://www.roblox.com/bundles/${i.bundleId}`
  : `https://www.roblox.com/catalog/${i.assetId}`);

function detailRow(i, big = false) {
  const img = i.thumb
    ? `<img src="${escapeHtml(i.thumb)}" alt="" data-icon="${itemIcon(i)}">`
    : `<div class="ph">${ic(itemIcon(i))}</div>`;
  const right = i.unknown
    ? `<b style="color:var(--face)">—</b><span>${t('sans cote')}</span>`
    : `<b>${fmtFull(i.value)}</b><span>RAP ${fmtNum(i.rap)}${i.noValue ? ' · ' + t('pas de value') : ''}</span>`;

  return `<a class="det-row${big ? ' big' : ''}" href="${escapeHtml(itemUrl(i))}" target="_blank" rel="noreferrer" title="${escapeHtml(itemTitle(i))}">
    ${img}
    <div class="det-n"><b>${i.projected ? projBadge() + ' ' : ''}${escapeHtml(i.name)}${marksHtml(i) ? ' ' + marksHtml(i) : ''}</b><span>${escapeHtml(itemTags(i))}</span></div>
    <div class="det-v">${right}</div>
  </a>`;
}

function detailHtml(a, outbound) {
  const block = (title, side) => (side.items.length
    ? `<div class="det-h">${title}</div>${side.items.map(i => detailRow(i)).join('')}`
    : '');
  return `<div class="detail">
    ${block(t(outbound ? 'Vous demandez' : 'Vous recevez'), a.get)}
    ${block(t('Vous donnez'), a.give)}
  </div>`;
}

/* ============================== une carte =============================== */

function cardHtml(c, { outbound = false, enter = false } = {}) {
  const a = c.analysis;
  const link = data.state?.links?.[c.tradeId];
  const tracked = !!data.state?.tracked?.[c.tradeId];
  const tone = cardTone(a);
  const isOpen = !c.status || c.status === 'Open' || c.status === 'Unknown' || c.status === 'Pending';

  const pin = outbound
    ? `<button class="tc-btn pin ${tracked ? 'on' : ''}" data-track="${c.tradeId}" data-on="${tracked ? '0' : '1'}"
         title="${escapeHtml(t(tracked ? 'Ne plus suivre ce trade' : 'Suivre ce trade (alerte si accepté, refusé ou contré)'))}">${ic('pin')}</button>`
    : '';
  const nix = a && isOpen && tab !== 'completed'
    ? `<button class="tc-btn nix" data-nix="${c.tradeId}" data-kind="${outbound ? 'outbound' : 'inbound'}"
         title="${escapeHtml(t(outbound ? 'Annuler ce trade' : 'Refuser ce trade'))}">${ic('x')}</button>`
    : '';
  const verdict = a
    ? `<span class="tc-pill ${tone}" title="${escapeHtml(t(c.verdict?.label || ''))}">${verdictIcon(c.verdict)} ${a.incomplete ? escapeHtml(t('sans cote')) : fmtPct(a.pctMain)}</span>`
    : '';
  // Pas de numéro de trade ici : ses 16 chiffres mangeaient le statut. Il
  // reste dans le zoom.
  const meta = [
    c.created ? agoHtml(c.created) : '',
    outbound && c.status && STATUS_LABEL[c.status] ? `<span class="tc-status">${t(STATUS_LABEL[c.status])}</span>` : '',
    tracked ? `<span class="tc-status on">${ic('pin')} ${t('suivi')}</span>` : ''
  ].filter(Boolean).join(' · ');
  const counter = link
    ? `<div class="tc-link">${ic('reply')} ${t('contre-offre sur le trade #{id}', { id: link.counterTo })}${link.round > 2 ? ' ' + t('· {n}ᵉ échange', { n: link.round }) : ''}</div>`
    : '';

  const head = `<div class="tc-head">
      ${avatarBtn(c, tracked ? 'tracked' : tone)}
      <div class="who"><div class="n">${partnerName(c)}${partnerHandle(c)}</div><div class="t">${meta}</div></div>
      ${verdict}${nix}${pin}
    </div>`;
  const cls = `tc${enter ? ' tc-enter' : ''}`;

  if (!a) {
    // La raison est affichée EN CLAIR : une erreur planquée dans une infobulle
    // n'aide personne à comprendre ce qui se passe.
    const why = c.error
      ? `<div class="err-box">
           <div class="err-msg">${ic('alert')} ${escapeHtml(t('Évaluation impossible — {why}', { why: c.error }))}</div>
           <button class="err-retry" data-retry="${c.tradeId}">${t('Réessayer')}</button>
         </div>`
      : '';
    return `<article class="${cls}" data-tone="${tracked ? 'tracked' : 'even'}">
      <div class="tc-body" data-zoom="${c.tradeId}">${head}${counter}${why}</div>
    </article>`;
  }

  const open = expanded.has(c.tradeId);
  const showDetail = data.settings?.showItemDetails !== false;
  const nb = a.give.items.length + a.get.items.length;

  return `<article class="${cls}" data-tone="${tracked ? 'tracked' : tone}">
    <div class="tc-body" data-zoom="${c.tradeId}">
      ${head}
      ${counter}
      <div class="tc-swap">
        ${sideHtml(t('Vous donnez'), a.give, a, false)}
        <div class="tc-mid">${ic('swap')}</div>
        ${sideHtml(t(outbound ? 'Vous demandez' : 'Vous recevez'), a.get, a, true)}
      </div>
      ${balanceHtml(a)}
      ${flagsHtml(a)}
    </div>
    ${showDetail && nb
      ? `<button class="tc-more${open ? ' open' : ''}" data-expand="${c.tradeId}"><span>${open ? t('Masquer le détail') : t('Détail des {n} objets', { n: nb })}</span><i>${ic('chevron')}</i></button>`
      : ''}
    ${showDetail && open ? detailHtml(a, outbound) : ''}
  </article>`;
}

/** Emplacement d'une carte pas encore évaluée : sa silhouette, qui scintille. */
const skeletonHtml = (id) => `<div class="tc-skel" data-id="${id}"><i class="a"></i><i class="l1"></i><i class="l2"></i><i class="b"></i></div>`;

/* ======================== en tête de chaque liste ======================== */

const LIST_FILTERS = {
  inbound: [['all', 'Tous'], ['win', 'Gagnants'], ['loss', 'Perdants'], ['unknown', 'Sans cote']],
  outbound: [['all', 'Tous'], ['tracked', 'Suivis'], ['win', 'Gagnants'], ['loss', 'Perdants']],
  completed: [['all', 'Tous'], ['win', 'Gagnants'], ['loss', 'Perdants']]
};

/** Un trade pas encore évalué ne passe que « Tous » (et « Suivis », qui ne dépend pas de la cote). */
function matchesFilter(kind, item, key = listFilter[kind]) {
  if (key === 'all') return true;
  if (key === 'tracked') return !!data.state?.tracked?.[item.tradeId];
  const a = cards[kind].get(item.tradeId)?.analysis;
  if (!a) return false;
  if (key === 'unknown') return !!a.incomplete;
  return !a.incomplete && toneOf(a.pctMain, 3) === key;
}

function chipsHtml(kind, snap) {
  const chips = LIST_FILTERS[kind].map(([key, label]) => {
    const n = snap.filter(item => matchesFilter(kind, item, key)).length;
    if (!n && key !== 'all' && key !== listFilter[kind]) return '';
    return `<button class="${key === listFilter[kind] ? 'on' : ''}" data-lfilter="${key}">${t(label)} <small>${n}</small></button>`;
  }).join('');
  return `<div class="lchips">${chips}</div>`;
}

/** Combien, et ce que ça vaut, d'un coup d'œil. */
function summaryHtml(kind, snap) {
  const loaded = snap.map(x => cards[kind].get(x.tradeId)).filter(c => c?.analysis);
  const rated = loaded.filter(c => !c.analysis.incomplete);
  const wins = rated.filter(c => toneOf(c.analysis.pctMain, 3) === 'win').length;
  const losses = rated.filter(c => toneOf(c.analysis.pctMain, 3) === 'loss').length;
  const blind = loaded.length - rated.length;
  // « 25+ » : la liste continue au-delà de ce qui est chargé.
  const count = kind === 'inbound' ? (data.state?.inboundCount ?? snap.length) : snap.length + (hasMore(kind) ? '+' : '');
  const label = { inbound: t('En attente'), outbound: t('Envoyés'), completed: t('Terminés récemment') }[kind];

  let aside = '';
  if (kind === 'completed' && rated.length) {
    const net = rated.reduce((s, c) => s + c.analysis.deltaMain, 0);
    aside = `<div class="ls-aside"><span>${t('Bilan')}</span><b class="${toneOf(net)}">${fmtSigned(net)}</b>
      <small>${plural(rated.length, '{n} trade terminé', '{n} trades terminés')}</small></div>`;
  } else if (kind === 'outbound') {
    const tracked = Object.keys(data.state?.tracked || {}).length;
    aside = `<div class="ls-aside"><span>${t('Suivis')}</span><b class="${tracked ? 'warn' : ''}">${tracked}</b>
      <small>${ic('pin')} ${t('pour être prévenu')}</small></div>`;
  } else {
    const best = [...rated].sort((x, y) => y.analysis.pctMain - x.analysis.pctMain)[0];
    if (best && best.analysis.pctMain > 0) {
      aside = `<div class="ls-aside"><span>${t('Meilleur')}</span><b class="win">${fmtPct(best.analysis.pctMain)}</b>
        <small>${partnerName(best)}</small></div>`;
    }
  }

  const stats = [
    wins ? `<span class="win">${ic('caret-up')} ${plural(wins, '{n} gagnant', '{n} gagnants')}</span>` : '',
    losses ? `<span class="loss">${ic('caret-down')} ${plural(losses, '{n} perdant', '{n} perdants')}</span>` : '',
    blind ? `<span class="face">${ic('help')} ${plural(blind, '{n} sans cote', '{n} sans cote')}</span>` : '',
    // La suite se charge au défilement : seul un chargement en cours se signale.
    hydrating.has(kind) ? `<span>${t('Évaluation…')}</span>` : ''
  ].filter(Boolean).join('');

  return `<section class="ls">
    <div class="ls-main">
      <div class="ls-l">${label}</div>
      <div class="ls-n">${count}</div>
      <div class="ls-stats">${stats}</div>
    </div>
    ${aside}
  </section>`;
}

const EMPTY = {
  inbound: ['inbox', 'Aucun trade en attente', "Vous serez notifié dès qu'un nouveau trade arrive."],
  outbound: ['send', 'Aucun trade envoyé', "Vos propositions apparaîtront ici. Épinglez-en une ({pin}) pour être averti dès qu'elle est acceptée, refusée ou contrée."],
  completed: ['check-circle', 'Aucun trade terminé récemment', ''],
  history: ['journal', 'Journal vide', 'Chaque événement détecté (notifié ou filtré) apparaîtra ici.']
};

function emptyHtml(kind) {
  const [icon, title, text] = EMPTY[kind];
  return `<div class="empty"><div class="empty-ic">${ic(icon)}</div><b>${t(title)}</b>${text ? `<span>${t(text, { pin: ic('pin') })}</span>` : ''}</div>`;
}

/* =========================== zoom sur un trade =========================== */

/** Retrouve une carte déjà chargée, quel que soit l'onglet. */
function findCard(tradeId) {
  for (const kind of ['inbound', 'outbound', 'completed']) {
    const c = cards[kind].get(tradeId);
    if (c) return { card: c, kind };
  }
  return null;
}

function zoomSideHtml(title, side, a, incoming) {
  const blind = side.itemCount > 0 && side.unknownCount === side.itemCount && !side.robux;
  const rbx = side.robux > 0
    ? `<div class="z-rbx">R$ ${fmtNum(incoming ? side.robuxNet : side.robux)}${incoming && side.robuxNet !== side.robux ? ` <s>${t('net de 30 %')}</s>` : ''}</div>`
    : '';
  return `<section class="z-side">
    <div class="z-side-h">
      <span>${title}</span>
      <span class="z-tot">${blind ? '—' : fmtFull(mainOf(side, a))}<small>RAP ${fmtNum(side.rap)}</small></span>
    </div>
    ${side.items.map(i => detailRow(i, true)).join('') || `<div class="z-empty">—</div>`}
    ${rbx}
  </section>`;
}

function zoomHtml(c, kind) {
  const a = c.analysis;
  const outbound = kind === 'outbound';
  const tone = cardTone(a);
  const expires = c.expiration ? timeUntil(c.expiration) : '';

  // Refuser un trade reçu et annuler un trade envoyé sont le MÊME appel côté
  // Roblox. Le libellé change, l'action non — et elle est définitive, d'où la
  // confirmation en deux temps portée par le bouton lui-même.
  const canDecline = !!a && (kind === 'outbound' || kind === 'inbound')
    && (!c.status || c.status === 'Open' || c.status === 'Unknown');
  const declineLabel = outbound ? 'Annuler le trade' : 'Refuser le trade';

  return `<div class="zoom-card w-sheet" role="dialog" aria-modal="true">
    <header class="z-head">
      <div class="head">
        ${avatarBtn(c, tone)}
        <div class="who"><div class="n">${partnerName(c)}${partnerHandle(c)}</div>
          <div class="t">#${c.tradeId} · ${timeAgo(c.created)}</div></div>
      </div>
      <button class="z-close" title="${t('Fermer')}">${ic('x')}</button>
    </header>
    <div class="z-body">
      ${a ? `<section class="z-hero" data-tone="${tone}">
        <div class="z-verdict">
          <span class="tc-pill ${tone}">${verdictIcon(c.verdict)} ${escapeHtml(t(c.verdict?.label || ''))}</span>
          ${expires ? `<span class="z-exp">${ic('clock')} ${t('Expire {ago}', { ago: expires })}</span>` : ''}
        </div>
        ${balanceHtml(a, { big: true })}
      </section>` : `<div class="z-empty">${t('Détail indisponible pour ce trade.')}</div>`}
      ${a ? zoomSideHtml(t(outbound ? 'Vous demandez' : 'Vous recevez'), a.get, a, true) : ''}
      ${a ? zoomSideHtml(t('Vous donnez'), a.give, a, false) : ''}
      ${a ? flagsHtml(a) : ''}
    </div>
    <div class="z-msg" hidden></div>
    <footer class="z-foot">
      <button class="z-open">${t('Ouvrir sur Roblox')} ${ic('external')}</button>
      ${canDecline ? `<button class="z-decline" data-kind="${kind}">${t(declineLabel)}</button>` : ''}
    </footer>
  </div>`;
}

/** Échap referme ce qui est au premier plan : le zoom d'abord, puis la fiche d'un joueur. */
document.addEventListener('keydown', (e) => {
  // H : mode anonyme, de n'importe où (sauf en tapant du texte).
  if ((e.key === 'h' || e.key === 'H') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest?.('input, textarea, select')) {
    e.preventDefault(); toggleAnon(); return;
  }
  if (tab === 'coin' && !document.getElementById('zoom') && !document.getElementById('side') && !e.target.closest?.('.tabs')) coinKey(listEl, e);
  if (e.key !== 'Escape') return;
  if (document.getElementById('zoom')) closeZoom();
  else if (document.getElementById('side')) closePlayer();
});

/* --------------------------- focus des surcouches ------------------------ */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
const focusReturn = [];   // une pile : une fiche peut s'ouvrir par-dessus un zoom

/**
 * Une surcouche prend le focus a l'ouverture, le garde tant qu'elle est la, et
 * le rend a son declencheur en partant. Sans ca, le clavier restait derriere
 * elle, dans une liste toujours tabulable : « Refuser le trade » n'etait
 * atteignable qu'en traversant tout le reste.
 */
function captureFocus(root, firstSel) {
  focusReturn.push(document.activeElement);
  (root.querySelector(firstSel) || root).focus?.();
  root.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const items = [...root.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
    if (!items.length) return;
    e.preventDefault();
    const at = items.indexOf(document.activeElement);
    const to = e.shiftKey
      ? (at <= 0 ? items.length - 1 : at - 1)
      : (at < 0 || at === items.length - 1 ? 0 : at + 1);
    items[to].focus();
  });
}

/** Rend le focus a l'element qui avait ouvert la surcouche, s'il est encore la. */
function releaseFocus() {
  const back = focusReturn.pop();
  if (back?.isConnected) back.focus?.();
}

function closeZoom() {
  if (!document.getElementById('zoom')) { zoomed = null; return; }
  zoomed = null;
  // Le compte a rebours du « Confirmer ? » tournerait sur un bouton detache,
  // et rearmerait le bouton suivant a sa place.
  clearTimeout(armTimer);
  document.getElementById('zoom').remove();
  releaseFocus();
}

function openZoom(tradeId) {
  const hit = findCard(tradeId);
  // Trade pas encore évalué : rien à agrandir, on ouvre la page Roblox.
  if (!hit) { B.tabs.create({ url: tradeUrl(tradeId) }); return; }

  document.getElementById('zoom')?.remove();
  zoomed = tradeId;

  const wrap = document.createElement('div');
  wrap.className = 'zoom';
  wrap.id = 'zoom';
  wrap.innerHTML = zoomHtml(hit.card, hit.kind);
  document.body.appendChild(wrap);
  bindImages(wrap);

  wrap.addEventListener('click', (e) => { if (e.target === wrap) closeZoom(); });
  wrap.querySelector('.z-close').addEventListener('click', closeZoom);
  captureFocus(wrap, '.z-close');
  wrap.querySelector('.z-open').addEventListener('click', () => {
    B.tabs.create({ url: hit.card.url || tradeUrl(tradeId) });
  });
  wrap.querySelector('[data-player]')?.addEventListener('click', (e) => openPlayer(Number(e.currentTarget.dataset.player)));
  const dec = wrap.querySelector('.z-decline');
  if (dec) dec.addEventListener('click', () => decline(dec, hit.card, dec.dataset.kind, wrap));
}

/**
 * Refus / annulation. Deux clics : le premier arme le bouton, le second envoie.
 * L'action est définitive côté Roblox — un clic de trop ne doit pas pouvoir
 * détruire une négociation.
 */
let armTimer = null;
async function decline(btn, card, kind, wrap) {
  const outbound = kind === 'outbound';
  const idle = t(outbound ? 'Annuler le trade' : 'Refuser le trade');
  const msg = wrap.querySelector('.z-msg');

  if (btn.dataset.armed !== '1') {
    btn.dataset.armed = '1';
    btn.classList.add('armed');
    btn.textContent = t(outbound ? "Confirmer l'annulation" : 'Confirmer le refus');
    msg.hidden = false;
    msg.className = 'z-msg';
    msg.textContent = t('Cliquer une seconde fois pour confirmer. Action définitive côté Roblox.');
    clearTimeout(armTimer);
    armTimer = setTimeout(() => {
      btn.dataset.armed = '0';
      btn.classList.remove('armed');
      btn.textContent = idle;
      msg.hidden = true;
    }, 5000);
    return;
  }

  clearTimeout(armTimer);
  btn.disabled = true;
  btn.textContent = t('Annulation…');
  const res = await send({
    type: 'ronote:decline',
    tradeId: card.tradeId,
    kind: card.kind || kind,
    partner: card.partner?.displayName || card.partner?.name || '',
    partnerId: card.partner?.id || null
  });

  if (res?.ok) {
    for (const m of Object.values(cards)) m.delete(card.tradeId);
    for (const m of Object.values(failures)) m.delete(card.tradeId);
    forgetTrade(card.tradeId);
    if (res.state) data.state = res.state;
    closeZoom();
    renderHeader();
    renderList();
    return;
  }
  btn.disabled = false;
  btn.dataset.armed = '0';
  btn.classList.remove('armed');
  btn.textContent = idle;
  msg.hidden = false;
  msg.className = 'z-msg err';
  msg.textContent = t('Échec : {why}', { why: res?.error || '?' });
}

/**
 * Annulation depuis la carte : deux clics, le second dans les 5 s.
 *
 * L'etat « arme » ne peut pas vivre dans le seul DOM : une ecriture du service
 * worker reconstruit la liste et remettrait le bouton au repos sans prevenir —
 * le second clic ne ferait que le rearmer, et le trade ne serait jamais refuse.
 * Il vit donc ici, entre dans la signature de la liste, et `bindList` le
 * rappelle sur le bouton refait.
 */
let nixTimer = null;
let armedNix = null;

/** Retour au repos, que le bouton d'origine soit encore a l'ecran ou non. */
function disarmNix(btn) {
  clearTimeout(nixTimer);
  armedNix = null;
  if (!btn?.isConnected) return;
  btn.dataset.armed = '0';
  btn.classList.remove('armed');
  btn.innerHTML = ic('x');
}

async function quickDecline(btn, tradeId, kind) {
  if (btn.dataset.armed !== '1') {
    btn.dataset.armed = '1';
    btn.classList.add('armed');
    btn.textContent = t('Confirmer ?');
    armedNix = tradeId;
    clearTimeout(nixTimer);
    nixTimer = setTimeout(() => disarmNix(btn), 5000);
    return;
  }
  clearTimeout(nixTimer);
  armedNix = null;
  btn.disabled = true;
  btn.textContent = '…';
  const hit = findCard(tradeId);
  const partner = hit?.card?.partner?.displayName || hit?.card?.partner?.name || '';
  const res = await send({ type: 'ronote:decline', tradeId, kind, partner, partnerId: hit?.card?.partner?.id || null });
  if (res?.ok) {
    for (const m of Object.values(cards)) m.delete(tradeId);
    for (const m of Object.values(failures)) m.delete(tradeId);
    forgetTrade(tradeId);
    if (res.state) data.state = res.state;
    renderHeader();
    renderList();
    return;
  }
  btn.disabled = false;
  disarmNix(btn);
  btn.title = t('Échec : {why}', { why: res?.error || '?' });
}

/* =========================== fiche d'un joueur =========================== */

/**
 * La fiche d'un partenaire glisse depuis la droite. Elle s'ouvre aussitôt avec
 * ce que le popup sait déjà (ses trades affichés) ; le journal complet et ses
 * profils publics arrivent ensuite du service worker.
 */
const player = {
  id: 0, token: 0, who: null, headshot: null, res: null, chart: null, series: ['v'], range: '1y',
  faces: null, facesAll: false
};

/** Service worker resté sur l'ancienne version : le seul remède est de recharger RoNote. */
const whyText = (why, template) => (/message inconnu/.test(String(why))
  ? t('Recharge RoNote dans chrome://extensions pour activer la fiche.')
  : t(template, { why }));

const isIgnored = (id) => !!data.settings?.ignoredUsers?.some(u => Number(u.id) === id);

/** Les trades de ce joueur que le popup a sous la main, tous onglets confondus. */
function liveTradesWith(id) {
  const out = [];
  for (const kind of ['inbound', 'outbound', 'completed']) {
    for (const item of listOf(kind)) {
      if (Number(item.partner?.id) !== id) continue;
      out.push({ ...item, ...(cards[kind].get(item.tradeId) || {}), kind });
    }
  }
  return out;
}

function ageText(age) {
  if (age.unit === 'year') return plural(age.n, '{n} an', '{n} ans');
  if (age.unit === 'month') return age.n > 1 ? t('{n} mois', { n: age.n }) : t('1 mois');
  return plural(age.n, '{n} jour', '{n} jours');
}

/** Libellé et icône d'une ligne d'échange : son état, pas son premier événement. */
function playerRowInfo(r) {
  if (r.open && r.dir === 'out') return ['Offre envoyée', 'send', 'accent'];
  if (r.open) return r.kind === 'counter' ? ['Contre-offre reçue', 'counter', 'accent'] : ['Offre reçue', 'inbox', 'accent'];
  if (r.done) return ['Trade conclu', 'check-circle', 'win'];
  const info = KIND_INFO[r.kind];
  return [info?.label || '', KIND_ICON[r.kind] || 'dot', info?.tone || 'even'];
}

/** La chronologie des echanges avec ce joueur, reconstruite depuis les listes. */
const playerRows = () => partnerTimeline(player.res?.events || [], liveTradesWith(player.id));

/**
 * `rows` et `s` arrivent du rendu, qui les calcule une fois : la fiche les
 * refaisait deux fois par affichage, et `liveTradesWith` parcourt les trois
 * listes en recopiant chaque trade au passage.
 */
function playerBodyHtml(rows = playerRows(), s = partnerStats(rows)) {
  const res = player.res;
  const roli = res?.roli, prof = res?.profile;
  const age = accountAge(prof?.created);

  // La valeur de son inventaire, en grand — ou pourquoi on ne l'a pas. Faute
  // du profil Rolimon's, le dernier relevé de son historique fait l'affaire.
  const lastPt = player.chart?.points?.[player.chart.points.length - 1];
  const variation = '<span class="w-pill" id="p-var" hidden></span>';
  const chartOn = res ? res.rolimons !== false : data.settings?.useRolimons !== false;
  let hero = `<div class="ls-l">${t("Valeur de l'inventaire")}</div>`;
  if (!res) {
    hero += '<div class="p-skel"></div>';
  } else if (roli && !roli.private && roli.value) {
    hero += `<div class="p-top"><div class="p-amount">${amount(roli.value)}</div>${variation}</div>
      <div class="p-sub">${[t('RAP {v}', { v: amount(roli.rap) }), roli.rank ? t('rang {n}', { n: rankText(roli.rank) }) : ''].filter(Boolean).join(' · ')}</div>`;
  } else if (!roli?.private && lastPt?.v) {
    hero += `<div class="p-top"><div class="p-amount">${amount(lastPt.v)}</div>${variation}</div>
      <div class="p-sub">${t('RAP {v}', { v: amount(lastPt.r) })} · ${t("d'après l'historique Rolimon's")}</div>`;
  } else {
    const why = !res.rolimons ? t("Rolimon's est désactivé dans les réglages")
      : roli?.private ? t('Inventaire privé')
      : roli ? t("Rolimon's n'a pas encore scanné cet inventaire.")
      : res.why ? whyText(res.why, 'Profil public indisponible — {why}.')
      : t('Profil public indisponible.');
    hero += `<div class="p-none">${escapeHtml(why)}</div>`;
  }

  const flags = [
    age ? (age.days < YOUNG_ACCOUNT_DAYS
      ? `<span class="p-flag warn">${ic('alert')} ${t('Compte récent : {age}', { age: ageText(age) })}</span>`
      : `<span class="p-flag">${ic('clock')} ${t('Compte de {age}', { age: ageText(age) })}</span>`) : '',
    prof?.banned || roli?.terminated ? `<span class="p-flag loss">${ic('ban')} ${t('Compte banni')}</span>` : '',
    prof?.verified ? `<span class="p-flag accent">${ic('check-circle')} ${t('Vérifié')}</span>` : '',
    roli?.lastOnline ? `<span class="p-flag">${ic('pulse')} ${t('En ligne {ago}', { ago: timeAgo(roli.lastOnline) })}</span>` : '',
    res?.ignored ? `<span class="p-flag face" title="${escapeHtml(t("Ses trades ne déclenchent plus d'alerte."))}">${ic('user-off')} ${t('Ignoré')}</span>` : ''
  ].filter(Boolean).join('');

  const tile = factHtml;
  const tiles = `<div class="w-facts">
    ${tile(t('Offres reçues'), s.received)}
    ${tile(t('Offres envoyées'), s.sent)}
    ${tile(t('Gain moyen'), s.avgIn == null ? '—' : `<em class="${toneOf(s.avgIn, 3)}">${fmtPct(s.avgIn)}</em>`,
      s.rated ? plural(s.rated, 'sur {n} offre', 'sur {n} offres') : '')}
    ${tile(t('Trades conclus'), s.done,
      s.net != null ? `<em class="${toneOf(s.net)}">${t('bilan {v}', { v: amountSigned(s.net) })}</em>` : '')}
  </div>`;

  // Le verdict de la relation, seulement quand il repose sur plus d'une offre.
  let verdictLine = '';
  if (s.rated >= 2 && s.avgIn <= -10) {
    verdictLine = `<div class="w-rev loss">${ic('trend-down')} ${t('Ses offres te font perdre {pct} en moyenne.', { pct: sharePct(Math.abs(s.avgIn)) })}</div>`;
  } else if (s.rated >= 2 && s.avgIn >= 3) {
    verdictLine = `<div class="w-rev win">${ic('trend-up')} ${t('Ses offres te sont favorables : {pct} en moyenne.', { pct: fmtPct(s.avgIn) })}</div>`;
  }

  const list = rows.length
    ? `<div class="jr-day p-list">${rows.slice(0, 40).map(r => {
        const [label, icon, tone] = playerRowInfo(r);
        const rated = r.pct != null && !r.unknown;
        const sub = [timeAgo(r.at),
          rated && r.get != null && r.give != null ? t('{a} reçu vs {b} donné', { a: fmtNum(r.get), b: fmtNum(r.give) }) : ''
        ].filter(Boolean).join(' · ');
        const pill = rated ? `<span class="jr-pill ${toneOf(r.pct, 3)}">${fmtPct(r.pct)}</span>`
          : r.unknown ? `<span class="jr-pill face">${ic('help')}</span>` : '';
        return `<button class="jr" data-ptrade="${r.tradeId}">
          <span class="jr-ic" data-tone="${tone}">${ic(icon)}</span>
          <span class="jr-m"><span class="jr-t">${label ? t(label) : ''} <span class="jr-x">#${r.tradeId}</span></span>
            ${sub ? `<span class="jr-s">${sub}</span>` : ''}</span>
          <span class="jr-r">${pill}</span>
        </button>`;
      }).join('')}</div>`
    : `<div class="ls-none">${t("Aucun échange avec ce joueur pour l'instant.")}</div>`;

  return `<section class="p-hero">${hero}${flags ? `<div class="p-flags">${flags}</div>` : ''}${chartOn ? '<div class="p-chart" id="p-chart"></div>' : ''}</section>
    <div class="p-h">${t('Entre vous')}</div>
    ${tiles}${verdictLine}
    ${chartOn ? playerFacesHtml() : ''}
    <div class="p-h">${t('Vos échanges')}${rows.length ? ` <small>${rows.length}</small>` : ''}</div>
    ${list}`;
}

/**
 * La courbe de son inventaire, comme celle du portefeuille : value, RAP et
 * collectibles superposables, et la variation de sa value sur la période.
 */
/**
 * Le corps commun des deux graphiques a plages — celui de la fiche joueur et
 * celui de la fiche d'un objet. Ils ne different que par l'etat qui les pilote,
 * les attributs qui les nomment et ce qui se passe une fois traces ; tout le
 * reste (plage, echantillonnage, series disponibles, pastilles, courbe,
 * legende, recablage) etait ecrit deux fois, et divergeait deja.
 *
 * Rend false quand aucune serie n'a de quoi etre tracee : a l'appelant de dire
 * pourquoi, avec ses mots et sa mise en page.
 */
function renderRangedChart({ box, points, series, state, attr, id, defs = null, markers = [], animate = false, redraw, after = null }) {
  const avail = Object.fromEntries(Object.entries(series).filter(([k]) => points.some(p => p[k] > 0)));
  if (!Object.keys(avail).length) return false;

  const range = ITEM_RANGES.find(r => r.key === state.range) || ITEM_RANGES[2];
  const since = range.days ? Date.now() - range.days * 864e5 : 0;
  const pts = downsample(points.filter(p => p.at >= since));
  const keys = orderedSeries(state.series, avail);
  const shown = defs || avail;

  box.innerHTML = `${seriesChips(avail, keys, `data-${attr}series`)}
    ${chartHtml({ id, pts, keys, defs: shown, animate, markers })}
    ${legendHtml(pts, keys, shown)}
    <div class="w-ranges">${ITEM_RANGES.map(r =>
      `<button class="${r.key === range.key ? 'on' : ''}" data-${attr}range="${r.key}">${t(r.label)}</button>`).join('')}</div>`;
  mountChart({ id, pts, keys, defs: shown });

  box.querySelectorAll(`[data-${attr}series]`).forEach(el => el.addEventListener('click', () => {
    state.series = toggleSeries(keys, el.dataset[attr + 'series'], avail);
    redraw(true);
  }));
  box.querySelectorAll(`[data-${attr}range]`).forEach(el => el.addEventListener('click', () => {
    state.range = el.dataset[attr + 'range'];
    redraw(true);
  }));

  after?.(pts, avail);
  return true;
}

function renderPlayerChart(animate = false) {
  const box = document.getElementById('p-chart');
  if (!box) return;
  const ch = player.chart;
  if (!ch) { box.innerHTML = '<div class="p-cskel"></div>'; return; }
  const nochart = (why) => {
    box.innerHTML = `<div class="w-nochart">${escapeHtml(whyText(why, 'Historique indisponible — {why}.'))}</div>`;
  };
  if (!ch.points?.length) { nochart(ch.error || t('réponse vide')); return; }

  // La variation de la periode s'affiche a cote du solde, hors du graphique.
  const pill = (pts, avail) => {
    const varEl = document.getElementById('p-var');
    if (!varEl) return;
    const first = pts.find(p => p.v > 0)?.v || 0;
    const last = pts[pts.length - 1]?.v || 0;
    varEl.hidden = !(avail.v && pts.length >= 2 && first);
    if (!varEl.hidden) {
      varEl.className = `w-pill ${toneOf(last - first)}`;
      varEl.innerHTML = pillText(avail.v, last - first, ((last - first) / first) * 100);
    }
  };

  const drawn = renderRangedChart({
    box, points: ch.points, series: WALLET_SERIES, state: player,
    attr: 'p', id: 'p-plot', animate, redraw: renderPlayerChart, after: pill
  });
  if (!drawn) nochart(t('réponse vide'));
}

/** Une ligne de bundle : vignette, nom, quantité, et ce qu'il pèse. */
function faceRow(l) {
  const href = `https://www.roblox.com/${l.kind === 'bundle' ? 'bundles' : 'catalog'}/${l.id}`;
  const img = l.thumb ? `<img src="${escapeHtml(l.thumb)}" alt="" loading="lazy">` : `<div class="ph">${ic('face')}</div>`;
  return `<a class="rec-row p-face" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">
    ${img}
    <div class="rec-n">${escapeHtml(l.name)}${l.count > 1 ? ` ×${l.count}` : ''}</div>
    <div class="rec-v">${amount(l.total)}</div>
  </a>`;
}

/** Ses bundles cotés, du plus gros au plus petit. */
function playerFacesHtml() {
  const f = player.faces;
  const copies = (list) => list.reduce((s, l) => s + l.count, 0);
  const head = (n) => `<div class="p-h">${t('Ses bundles')}${n ? ` <small>${n}</small>` : ''}</div>`;
  if (!f) return head(0) + '<div class="p-fskel"></div>';
  if (f.error || (!f.ok && !f.partial)) {
    const why = f.private ? t('Inventaire privé')
      : whyText(f.error || t(f.reason || 'réponse vide'), 'Bundles indisponibles — {why}.');
    return head(0) + `<div class="ls-none p-fnone">${escapeHtml(why)}</div>`;
  }

  const lines = f.faces;
  const shown = player.facesAll ? lines : lines.slice(0, 8);
  const rows = shown.length
    ? shown.map(l => faceRow(l)).join('')
    : `<div class="ls-none">${t('Aucun bundle coté.')}</div>`;
  const more = lines.length > shown.length
    ? `<button class="p-more" data-fmore>${plural(lines.length - shown.length, '+ {n} autre', '+ {n} autres')}</button>`
    : '';
  const partial = f.partial
    ? `<div class="note">${escapeHtml(t('Liste incomplète — {why}.', { why: t(f.reason) }))}</div>`
    : '';
  return `${head(copies(f.faces))}<div class="jr-day p-faces">${rows}${more}</div>${partial}`;
}

function playerFootHtml() {
  const ignored = player.res ? !!player.res.ignored : isIgnored(player.id);
  return `<button class="z-open" data-url="https://www.roblox.com/users/${player.id}/profile">${t('Profil Roblox')} ${ic('external')}</button>
    <button class="z-open" data-url="https://www.rolimons.com/player/${player.id}">Rolimon's ${ic('external')}</button>
    <button class="p-mute${ignored ? ' on' : ''}" data-mute>${ic('user-off')} ${t(ignored ? 'Ne plus ignorer' : 'Ignorer')}</button>`;
}

function bindPlayer(root) {
  root.querySelectorAll('button[data-url]').forEach(b => { b.onclick = () => B.tabs.create({ url: b.dataset.url }); });
  root.querySelectorAll('[data-ptrade]').forEach(b => {
    b.onclick = () => {
      const id = Number(b.dataset.ptrade);
      if (findCard(id)) openZoom(id); else B.tabs.create({ url: tradeUrl(id) });
    };
  });
  const mute = root.querySelector('[data-mute]');
  if (mute) mute.onclick = () => toggleMute(mute);
  const more = root.querySelector('[data-fmore]');
  if (more) more.onclick = () => { player.facesAll = true; renderPlayer(); };
}

/**
 * Les trois reponses de la fiche (profil, visages, historique) reviennent
 * souvent coup sur coup, et chacune reconstruisait la fiche entiere sous les
 * yeux de l'utilisateur. Une seule reconstruction par image d'affichage.
 */
let playerFrame = 0, playerAnimPending = false;
function queueRenderPlayer(animateChart = false) {
  playerAnimPending = playerAnimPending || animateChart;
  cancelAnimationFrame(playerFrame);
  playerFrame = requestAnimationFrame(() => {
    const animate = playerAnimPending;
    playerAnimPending = false;
    renderPlayer(animate);
  });
}

function renderPlayer(animateChart = false) {
  const body = document.getElementById('p-body');
  if (!body) return;
  const rows = playerRows();
  const s = partnerStats(rows);
  const top = body.scrollTop;
  body.innerHTML = playerBodyHtml(rows, s);
  renderPlayerChart(animateChart);
  body.scrollTop = top;
  document.getElementById('p-foot').innerHTML = playerFootHtml();
  // L'anneau de l'avatar prend la couleur de la relation : ses offres, en moyenne.
  document.getElementById('p-ring').className = `av-ring p-av ${s.rated ? toneOf(s.avgIn, 3) : ''}`;
  bindImages(body);
  bindPlayer(document.getElementById('side'));
}

/** Ignorer un joueur coupe les alertes de ses trades ; ça se défait d'un clic. */
async function toggleMute(btn) {
  const on = !(player.res ? player.res.ignored : isIgnored(player.id));
  const who = player.who || {};
  btn.disabled = true;
  const res = await send(on
    ? { type: 'ronote:mute', userId: player.id, name: who.displayName || who.name || '' }
    : { type: 'ronote:unmute', userId: player.id });
  if (res?.settings) data.settings = res.settings;
  if (player.res) player.res.ignored = isIgnored(player.id);
  renderPlayer();
}

/** Referme la fiche : elle repart vers le popup, qui reprend ensuite sa largeur. */
function closePlayer() {
  player.token++;   // les réponses encore en route ne redessinent plus rien
  player.id = 0;
  cancelAnimationFrame(playerFrame);
  const side = document.getElementById('side');
  if (!side) return;
  releaseFocus();
  const done = () => {
    side.remove();
    if (!document.getElementById('side')) document.documentElement.classList.remove('side-open');
  };
  if (REDUCED_MOTION) { done(); return; }
  side.removeAttribute('id');   // une autre fiche peut s'ouvrir pendant la sortie
  side.classList.add('out');
  setTimeout(done, 160);
}

function openPlayer(id) {
  if (!id) return;
  // Un second clic sur le même joueur referme sa fiche.
  if (player.id === id && document.getElementById('side')) { closePlayer(); return; }
  const live = liveTradesWith(id);
  const seed = live.find(c => c.headshot) || live[0]
    || Object.values(cards).flatMap(m => [...m.values()]).find(c => Number(c.partner?.id) === id);
  if (!seed) return;
  const token = ++player.token;
  Object.assign(player, {
    id, who: seed.partner || { id }, headshot: seed.headshot || null,
    res: null, chart: null, faces: null, facesAll: false
  });

  // La fiche s'ouvre à côté de la liste, qui reste utilisable : le popup
  // s'élargit pour elle. Changer de joueur remplace son contenu sur place.
  let side = document.getElementById('side');
  const swap = !!side;
  if (!side) {
    side = document.createElement('aside');
    side.className = 'side';
    side.id = 'side';
    document.body.appendChild(side);
    document.documentElement.classList.add('side-open');
  }

  const who = player.who;
  side.innerHTML = `<div class="zoom-card p-sheet${swap ? ' swap' : ''}" role="dialog" aria-label="${escapeHtml(t('Fiche du joueur'))}">
    <header class="z-head">
      <div class="head">
        <span class="av-ring p-av" id="p-ring">${avatarHtml({ headshot: player.headshot })}</span>
        <div class="who"><div class="n">${escapeHtml(who.displayName || who.name || t('Joueur'))}</div>
          <div class="t">${who.name ? '@' + escapeHtml(who.name) : ''}</div></div>
      </div>
      <button class="z-close" title="${t('Fermer')}">${ic('x')}</button>
    </header>
    <div class="z-body" id="p-body">${playerBodyHtml()}</div>
    <footer class="z-foot p-foot" id="p-foot">${playerFootHtml()}</footer>
  </div>`;
  bindImages(side);
  bindPlayer(side);
  renderPlayerChart();
  side.querySelector('.z-close').addEventListener('click', closePlayer);
  captureFocus(side, '.z-close');

  const still = () => player.token === token;
  const failed = (why) => ({ events: [], why, rolimons: data.settings?.useRolimons !== false, ignored: isIgnored(id) });
  // La courbe vient d'une page plus lourde : elle arrive à part, sans retenir le reste.
  if (data.settings?.useRolimons !== false) {
    send({ type: 'ronote:player-history', userId: id }).then((res) => {
      if (!still()) return;
      player.chart = res?.points?.length ? { points: res.points } : { error: res?.error || t('réponse vide') };
      // Sans profil Rolimon's, la valeur affichée vient de cet historique : toute la fiche se redessine.
      if (player.res && !player.res.roli?.value) queueRenderPlayer(true); else renderPlayerChart(true);
    }, () => {
      if (!still()) return;
      player.chart = { error: t('réponse vide') };
      renderPlayerChart();
    });
    // Ses bundles : trois appels (profil, inventaire Rolimon's, bundles Roblox), à part eux aussi.
    send({ type: 'ronote:player-faces', userId: id }).then((res) => {
      if (!still()) return;
      player.faces = res?.faces || { error: res?.error || t('réponse vide') };
      queueRenderPlayer();
    }, () => {
      if (!still()) return;
      player.faces = { error: t('réponse vide') };
      queueRenderPlayer();
    });
  }
  send({ type: 'ronote:player', userId: id, name: who.name || '', displayName: who.displayName || '' }).then((res) => {
    if (!still()) return;
    player.res = res && !res.error ? res : failed(res?.error || t('réponse vide'));
    queueRenderPlayer();
  }, () => {
    if (!still()) return;
    player.res = failed(t('réponse vide'));
    queueRenderPlayer();
  });
}

/* ================================ accueil ================================ */

/**
 * L'accueil : ce qui s'est passé aujourd'hui et ce qui attend une action, d'un
 * coup d'œil. Tout vient de ce que le popup a déjà (journal, listes, série du
 * portefeuille) : ouvrir l'onglet ne déclenche aucun appel.
 */
const VERSION_KEY = 'ronote:seenVersion';
const appVersion = () => B.runtime.getManifest?.().version || '';

/** Une version pas encore vue : l'accueil propose ses nouveautés, une fois. */
function newsPending() {
  const v = appVersion();
  if (!v) return false;
  try { return localStorage.getItem(VERSION_KEY) !== v; } catch { return false; }
}
function markNewsSeen() {
  try { localStorage.setItem(VERSION_KEY, appVersion()); } catch { /* le bandeau reviendra */ }
}

/** Change d'onglet comme un clic sur la barre. */
function selectTab(name) {
  document.querySelector(`.tab[data-tab="${name}"]`)?.click();
}

/**
 * Ce qui change l'accueil. Pas l'heure : les durées avancent seules (voir la
 * fin du fichier). Le jour, si : les tuiles comptent « aujourd'hui ».
 */
function homeSignature() {
  return JSON.stringify(['home', new Date().toDateString(), data.history?.length || 0, data.history?.[0]?.at || 0,
    data.state?.inboundCount, Object.keys(data.state?.tracked || {}), cards.inbound.size,
    (data.state?.snapshot?.inbound || []).map(x => x.tradeId),
    data.state?.portfolioLast?.v, data.state?.portfolioLast?.at,
    data.portfolio?.length || 0, data.portfolio?.[data.portfolio.length - 1]?.at || 0,
    wallet.hidden, newsPending(), marksSig()]);
}

/**
 * La série du portefeuille, prolongée jusqu'à maintenant.
 *
 * Elle vient de Rolimon's, qui ne rescanne un compte que quelques fois par
 * jour : sans ce dernier point, la courbe s'arrête là où le solde affiché, lui,
 * a déjà bougé — c'est ce qui donnait l'impression qu'elle ne suivait pas.
 */
function walletSeries() {
  const scanned = data.portfolio || [];
  const live = data.state?.portfolioLast;
  const v = live?.v || 0;
  const tail = scanned[scanned.length - 1];
  if (!v || !live.at || live.at <= (tail?.at || 0)) return scanned;
  return [...scanned, { at: live.at, v, r: live.r || 0, n: tail?.n || data.state?.collectibles || 0 }];
}

/** Variation de la value sur les dernières 24 h, d'après la série Rolimon's (un relevé par jour environ). */
function dayChange(series) {
  const pts = (series || []).filter(p => p.v > 0);
  if (pts.length < 2) return null;
  const last = pts[pts.length - 1];
  const ref = [...pts].reverse().find(p => p.at <= last.at - 23 * 3600e3);
  if (!ref) return null;
  return { delta: last.v - ref.v, pct: ((last.v - ref.v) / ref.v) * 100 };
}

function renderHome(entering) {
  const st = data.state || {};
  const hist = data.history || [];
  const now = new Date();
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const today = hist.filter(h => h.at >= since);

  const received = today.filter(h => h.kind === 'inbound' || h.kind === 'counter');
  const wins = received.filter(h => h.pct != null && toneOf(h.pct, 3) === 'win').length;
  const done = today.filter(h => h.kind === 'completed' || h.kind === 'outbound_accepted');
  const doneRated = done.filter(h => h.get != null && h.give != null);
  const net = doneRated.reduce((s, h) => s + (h.get - h.give), 0);
  const muted = today.filter(h => h.skipped && h.kind !== 'declined_by_me').length;
  const revals = today.filter(h => h.kind === 'revalued');
  const revalEffect = revals.reduce((s, h) => s + (h.delta || 0), 0);

  // Le portefeuille en tête, avec sa semaine ; sans lui, les trades en attente.
  const series = walletSeries();
  const value = st.portfolioLast?.v || series[series.length - 1]?.v || 0;
  const change = dayChange(series);
  const week = downsample(series.filter(p => p.at >= Date.now() - 7 * 864e5 && p.v > 0));
  const dateLabel = now.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
  const hero = value
    ? `<section class="ls h-hero">
        <div class="ls-l">${escapeHtml(dateLabel)}</div>
        <div class="h-top"><div class="h-amount">${amount(value)}</div>
          ${change ? `<span class="w-pill ${toneOf(change.delta)}">${pillText(WALLET_SERIES.v, change.delta, change.pct)}</span>` : ''}</div>
        <div class="h-sub">${[t('Ton portefeuille'), change ? t('sur 24 h') : '',
          st.portfolioRank ? t('rang #{n}', { n: fmtFull(st.portfolioRank) }) : ''].filter(Boolean).join(' · ')}</div>
        ${week.length >= 2 ? chartHtml({ id: 'h-plot', pts: week, keys: ['v'], defs: WALLET_SERIES, animate: entering }) : ''}
      </section>`
    : `<section class="ls h-hero">
        <div class="ls-l">${escapeHtml(dateLabel)}</div>
        <div class="ls-n">${st.inboundCount || 0}</div>
        <div class="h-sub">${plural(st.inboundCount || 0, '{n} trade en attente', '{n} trades en attente')}</div>
      </section>`;

  const news = newsPending()
    ? `<button class="h-news" data-news>
        <span class="h-news-ic">${ic('sparkle')}</span>
        <span class="jr-m"><span class="jr-t">${t('RoNote {v} est installé', { v: escapeHtml(appVersion()) })}</span>
          <span class="jr-s">${t('Voir les nouveautés')}</span></span>
        <i class="h-go">${ic('chevron')}</i>
      </button>`
    : '';

  const tile = factHtml;
  const tiles = `<section class="w-facts h-tiles">
    ${tile(t("Reçus aujourd'hui"), received.length, wins ? plural(wins, '{n} gagnant', '{n} gagnants') : '')}
    ${tile(t("Conclus aujourd'hui"), done.length,
      doneRated.length ? `<em class="${toneOf(net)}">${t('bilan {v}', { v: amountSigned(net) })}</em>` : '')}
    ${tile(t('Alertes filtrées'), muted)}
    ${tile(t('Réévaluations'), revals.length,
      revals.length ? `<em class="${toneOf(revalEffect)}">${t('effet {v}', { v: amountSigned(revalEffect) })}</em>` : '')}
  </section>`;

  // Ce qui attend une action : un clic y mène.
  const inbound = (st.snapshot?.inbound || []).map(x => ({ x, c: cards.inbound.get(x.tradeId) })).filter(e => e.c);
  const best = inbound.map(e => e.c).filter(c => c.analysis && !c.analysis.incomplete)
    .sort((a, b) => b.analysis.pctMain - a.analysis.pctMain)[0];
  const expiring = inbound
    .map(({ x, c }) => ({ c, exp: msOf(x.expiration || c.expiration) }))
    .filter(e => e.exp > Date.now() && e.exp - Date.now() < 864e5)
    .sort((a, b) => a.exp - b.exp)[0];
  const tracked = Object.keys(st.tracked || {}).length;
  const go = `<i class="h-go">${ic('chevron')}</i>`;
  const todo = [
    st.inboundCount ? `<button class="h-todo" data-go="inbound">
        <span class="jr-ic" data-tone="accent">${ic('inbox')}</span>
        <span class="jr-m"><span class="jr-t">${plural(st.inboundCount, '{n} trade en attente', '{n} trades en attente')}</span>
          ${best && best.analysis.pctMain > 0 ? `<span class="jr-s">${t('meilleure offre : {pct} de {who}', { pct: fmtPct(best.analysis.pctMain), who: partnerName(best) })}</span>` : ''}</span>
        ${go}
      </button>` : '',
    expiring ? `<button class="h-todo" data-zoomid="${expiring.c.tradeId}">
        <span class="jr-ic" data-tone="warn">${ic('clock')}</span>
        <span class="jr-m"><span class="jr-t">${t('Offre de {who}', { who: partnerName(expiring.c) })}</span>
          <span class="jr-s">${t('Expire {ago}', { ago: untilHtml(expiring.exp) })}</span></span>
        ${expiring.c.analysis && !expiring.c.analysis.incomplete
          ? `<span class="jr-pill ${toneOf(expiring.c.analysis.pctMain, 3)}">${fmtPct(expiring.c.analysis.pctMain)}</span>` : go}
      </button>` : '',
    tracked ? `<button class="h-todo" data-go="outbound">
        <span class="jr-ic" data-tone="warn">${ic('pin')}</span>
        <span class="jr-m"><span class="jr-t">${plural(tracked, '{n} trade suivi', '{n} trades suivis')}</span>
          <span class="jr-s">${t('en attente de réponse')}</span></span>
        ${go}
      </button>` : ''
  ].filter(Boolean).join('');
  const todoHtml = `<section class="panel h-panel">
    <div class="panel-h"><span>${t('À traiter')}</span></div>
    ${todo || `<div class="h-none">${ic('check-circle')} ${t("Rien à traiter pour l'instant.")}</div>`}
  </section>`;

  const recent = [...hist].sort((a, b) => b.at - a.at).slice(0, 4);
  const recentHtml = recent.length
    ? `<section class="panel h-panel">
        <div class="panel-h"><span>${t('Derniers événements')}</span>
          <button class="h-link" data-go="history">${t('Tout le journal')} ${ic('chevron')}</button></div>
        <div class="h-events">${recent.map(journalRow).join('')}</div>
      </section>`
    : '';

  listEl.innerHTML = hero + news + tiles + todoHtml + recentHtml;
  if (entering) cascade(listEl.children, 8);
  if (value && week.length >= 2) mountChart({ id: 'h-plot', pts: week, keys: ['v'], defs: WALLET_SERIES });
  bindImages(listEl);
  listEl.querySelectorAll('[data-go]').forEach(el => el.addEventListener('click', () => selectTab(el.dataset.go)));
  listEl.querySelectorAll('[data-zoomid]').forEach(el => el.addEventListener('click', () => openZoom(Number(el.dataset.zoomid))));
  listEl.querySelectorAll('.jr[data-url]').forEach(el => el.addEventListener('click', () => B.tabs.create({ url: el.dataset.url })));
  listEl.querySelector('[data-news]')?.addEventListener('click', () => {
    markNewsSeen();
    B.tabs.create({ url: B.runtime.getURL('options/options.html#s-news') });
    renderList();
  });
}

/* =============================== journal ================================ */

const JOURNAL_FILTERS = [
  ['all', 'Tous', () => true],
  ['inbound', 'Reçus', (h) => h.kind === 'inbound' || h.kind === 'counter'],
  ['done', 'Terminés', (h) => h.kind === 'completed' || h.kind === 'outbound_accepted'],
  ['outbound', 'Envoyés', (h) => ['outbound_declined', 'outbound_countered', 'outbound_expired', 'trade_error', 'declined_by_me'].includes(h.kind)],
  ['revalued', 'Réévaluations', (h) => h.kind === 'revalued'],
  ['muted', 'Filtrés', (h) => !!h.skipped && h.kind !== 'declined_by_me']
];

/** « Aujourd'hui », « Hier », puis la date en toutes lettres. */
function dayLabel(at) {
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(new Date()) - startOf(new Date(at))) / 864e5);
  if (days === 0) return t("Aujourd'hui");
  if (days === 1) return t('Hier');
  return new Date(at).toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long' });
}

const clock = (at) => new Date(at).toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });

function journalRow(h) {
  const info = KIND_INFO[h.kind] || { label: '', tone: 'even' };
  let icon = KIND_ICON[h.kind] || 'dot';
  let title, sub = '', pill = '';

  if (h.kind === 'revalued') {
    // Une réévaluation n'est pas un trade : ni partenaire ni numéro, mais un
    // objet, ses deux cotes et l'impact sur le compte.
    icon = h.pct >= 0 ? 'trend-up' : 'trend-down';
    title = `${escapeHtml(h.name)}${h.count > 1 ? ` <span class="jr-x">×${h.count}</span>` : ''}`;
    sub = t('cote {a} → {b} · impact {c}', { a: fmtNum(h.from), b: fmtNum(h.to), c: fmtSigned(h.delta) });
  } else {
    title = `${escapeHtml(h.partner)} <span class="jr-x">#${h.tradeId}</span>`;
    if (h.kind === 'declined_by_me') sub = escapeHtml(t(h.skipped || ''));
    else if (h.skipped) sub = escapeHtml(t('filtré : {why}', { why: t(h.skipped) }));
    else if (h.counterTo) sub = ic('reply') + ' ' + t('réponse au trade #{id}', { id: h.counterTo });
    else if (h.unknown) sub = `<span class="face">${ic('help')} ${t('{n} objet(s) sans cote', { n: h.unknown })}</span>`;
    else if (h.get != null && h.give != null) sub = t('{a} reçu vs {b} donné', { a: fmtNum(h.get), b: fmtNum(h.give) });
  }
  if (h.pct != null) pill = `<span class="jr-pill ${toneOf(h.pct, 3)}">${fmtPct(h.pct)}</span>`;

  const url = h.kind !== 'revalued' && h.tradeId ? tradeUrl(h.tradeId) : '';
  const tag = url ? 'button' : 'div';
  const muted = !h.notified && h.kind !== 'revalued' ? ' muted' : '';
  return `<${tag} class="jr${muted}"${url ? ` data-url="${escapeHtml(url)}"` : ''}>
    <span class="jr-ic" data-tone="${info.tone}">${ic(icon)}</span>
    <span class="jr-m">
      <span class="jr-k">${info.label ? t(info.label) : ''}</span>
      <span class="jr-t">${title}</span>
      ${sub ? `<span class="jr-s">${sub}</span>` : ''}
    </span>
    <span class="jr-r">${pill}<span class="jr-time">${clock(h.at)}</span></span>
  </${tag}>`;
}

/** Les dernières 24 heures, résumées. */
function journalSummaryHtml(hist) {
  const since = Date.now() - 864e5;
  const recent = hist.filter(h => h.at >= since);
  const alerts = recent.filter(h => h.notified).length;
  const muted = recent.filter(h => h.skipped && h.kind !== 'declined_by_me').length;
  const revals = recent.filter(h => h.kind === 'revalued').length;
  const done = recent.filter(h => (h.kind === 'completed' || h.kind === 'outbound_accepted') && h.get != null && h.give != null);
  const net = done.reduce((s, h) => s + (h.get - h.give), 0);
  const stats = [
    muted ? `<span>${plural(muted, '{n} filtrée', '{n} filtrées')}</span>` : '',
    revals ? `<span class="face">${plural(revals, '{n} réévaluation', '{n} réévaluations')}</span>` : ''
  ].filter(Boolean).join('');
  return `<section class="ls">
    <div class="ls-main">
      <div class="ls-l">${t('Alertes · 24 h')}</div>
      <div class="ls-n">${alerts}</div>
      <div class="ls-stats">${stats}</div>
    </div>
    ${done.length ? `<div class="ls-aside"><span>${t('Bilan')}</span><b class="${toneOf(net)}">${fmtSigned(net)}</b>
      <small>${plural(done.length, '{n} trade terminé', '{n} trades terminés')}</small></div>` : ''}
  </section>
  <button class="rc-open" id="rc-open">${ic('calendar')}<span>${t('Bilan du mois')}</span><small>${t('Une carte à partager')}</small>${ic('chevron')}</button>`;
}

function renderJournal(entering) {
  const hist = data.history || [];
  if (!hist.length) {
    listEl.innerHTML = emptyHtml('history');
    if (entering) cascade(listEl.children);
    return;
  }
  const current = JOURNAL_FILTERS.find(f => f[0] === listFilter.history) || JOURNAL_FILTERS[0];
  const chips = JOURNAL_FILTERS.map(([key, label, test]) => {
    const n = hist.filter(test).length;
    if (!n && key !== 'all' && key !== listFilter.history) return '';
    return `<button class="${key === listFilter.history ? 'on' : ''}" data-lfilter="${key}">${t(label)} <small>${n}</small></button>`;
  }).join('');

  // Du plus récent au plus ancien, quoi qu'il arrive : les jours se regroupent
  // sur cet ordre.
  let body = '', day = '';
  for (const h of hist.filter(current[2]).sort((a, b) => b.at - a.at)) {
    const label = dayLabel(h.at);
    if (label !== day) {
      body += `${day ? '</section>' : ''}<section class="jr-day"><div class="jr-dh">${escapeHtml(label)}</div>`;
      day = label;
    }
    body += journalRow(h);
  }
  if (day) body += '</section>';

  listEl.innerHTML = journalSummaryHtml(hist)
    + `<div class="lchips">${chips}</div>`
    + (body || `<div class="ls-none">${t('Aucun événement dans cette catégorie.')}</div>`);
  if (entering) cascade(listEl.children, 8);

  listEl.querySelectorAll('button[data-lfilter]').forEach(el => el.addEventListener('click', () => {
    listFilter.history = el.dataset.lfilter;
    renderList();
  }));
  listEl.querySelectorAll('.jr[data-url]').forEach(el => el.addEventListener('click', () => {
    B.tabs.create({ url: el.dataset.url });
  }));
  listEl.querySelector('#rc-open')?.addEventListener('click', () => openShare('month'));
}

/* ========================= objectif du Portefeuille ===================== */

let walletGoal = null;
let goalRefreshed = false;

/** Un objectif « objet » suit la cote de l'objet : relue une fois par ouverture du popup. */
async function refreshGoalItem() {
  if (goalRefreshed || walletGoal?.kind !== 'item' || !walletGoal.item) return;
  goalRefreshed = true;
  const { assetId, bundleId } = walletGoal.item;
  const r = await send({ type: 'ronote:catalog-search', ids: [{ assetId, bundleId }] }).catch(() => null);
  const fresh = r?.items?.[0];
  if (!fresh?.value || (fresh.value === walletGoal.item.value && fresh.thumb === walletGoal.item.thumb)) return;
  await B.storage.local.set({ walletGoal: { ...walletGoal, target: fresh.value,
    item: { ...walletGoal.item, value: fresh.value, thumb: fresh.thumb || walletGoal.item.thumb } } }).catch(() => {});
}

/** La fenêtre de l'objectif, dans la surcouche du zoom. */
function openGoal() {
  document.getElementById('zoom')?.remove();
  const wrap = document.createElement('div');
  wrap.className = 'zoom'; wrap.id = 'zoom';
  const card = document.createElement('div');
  card.className = 'zoom-card w-sheet';
  card.setAttribute('role', 'dialog'); card.setAttribute('aria-modal', 'true');
  wrap.append(card);
  document.body.appendChild(wrap);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) closeZoom(); });
  mountGoalEditor(card, {
    goal: walletGoal,
    now: walletView().nowOf.v,
    hidden: wallet.hidden,
    search: (query) => send({ type: 'ronote:catalog-search', query }).then(r => r?.items || []).catch(() => []),
    onSave: async (goal) => { await B.storage.local.set({ walletGoal: goal }).catch(() => {}); closeZoom(); },
    onClose: closeZoom
  });
  fillIcons(card);
  captureFocus(wrap, '.z-close');
}

/* ================== cartes à partager : inventaire, mois ================ */

/**
 * Le début d'une période, compté comme le graphique de Rolimon's (Highcharts) :
 * à rebours depuis SON dernier point, en mois du calendrier (UTC). « 1m » du
 * 24 septembre part donc du 24 août, pas de « 30 jours avant maintenant » —
 * sinon la variation ne tombait pas sur celle du site.
 */
function rolimonsRangeStart(key) {
  const pts = data.portfolio || [];
  const max = pts.length ? pts[pts.length - 1].at : Date.now();
  const d = new Date(max);
  switch (key) {
    case '1w': return max - 7 * 864e5;
    case '1m': d.setUTCMonth(d.getUTCMonth() - 1); return d.getTime();
    case '3m': d.setUTCMonth(d.getUTCMonth() - 3); return d.getTime();
    case '6m': d.setUTCMonth(d.getUTCMonth() - 6); return d.getTime();
    case '1y': d.setUTCFullYear(d.getUTCFullYear() - 1); return d.getTime();
    default: return 0;
  }
}

/**
 * Ce que montre le graphique du Portefeuille : période choisie (1s … Tout),
 * courbe principale (Value, RAP ou collectibles), valeur actuelle et
 * variation sur la période. Le graphique et la carte Flex lisent tous deux
 * ceci : ils ne peuvent pas afficher deux chiffres différents.
 */
function walletView(all = walletSeries()) {
  const st = data.state || {};
  const last = st.portfolioLast;
  const range = RANGES.find(r => r.key === wallet.range) || RANGES[1];
  const since = rolimonsRangeStart(range.key);
  const inRange = all.filter(p => p.at >= since);
  const keys = wallet.series;
  const primary = keys[0];
  const pdef = WALLET_SERIES[primary];
  // Le relevé du moment prime sur le dernier point historique.
  const cur = last || all[all.length - 1] || { v: 0, r: 0 };
  const nowOf = { v: cur.v || 0, r: cur.r || 0, n: all.length ? all[all.length - 1].n || 0 : (st.collectibles || 0) };
  const head = inRange[0] || all[0] || {};
  const now = nowOf[primary];
  const start = Number.isFinite(head[primary]) ? head[primary] : now;
  const delta = now - start;
  const pct = start ? (delta / start) * 100 : 0;
  return { range, inRange, keys, primary, pdef, cur, nowOf, now, start, delta, pct };
}

/** La période du graphique, en toutes lettres, pour la carte. */
const RANGE_LONG = { '1w': '7 jours', '1m': '1 mois', '3m': '3 mois', '6m': '6 mois', '1y': '1 an', all: 'depuis le début' };

/**
 * La carte « Mon inventaire » : le graphique Rolimon's du Portefeuille, et
 * rien d'autre. Chiffres et courbes viennent tous de la courbe que publie
 * Rolimon's (une mesure par jour) — pas du relevé en direct de RoNote — sur
 * la période et avec les courbes choisies dans le Portefeuille. Le tracé est
 * celui du graphique (même modèle, même lissage), agrandi pour la carte.
 */
function walletFlexData(anon = false) {
  const st = data.state || {};
  const roli = (data.portfolio || []).filter(p => p.v > 0).sort((a, b) => a.at - b.at);
  const range = RANGES.find(r => r.key === wallet.range) || RANGES[1];
  const since = rolimonsRangeStart(range.key);
  const inRange = roli.filter(p => p.at >= since);
  const pts = downsample(inRange.length >= 2 ? inRange : roli.slice(-2));
  const keys = wallet.series;
  const primary = keys[0];
  const last = roli[roli.length - 1] || {};
  const head = pts[0] || last;
  const now = last[primary] || 0;
  const delta = now - (head[primary] || now);
  const pct = head[primary] ? delta / head[primary] * 100 : 0;
  const rank = st.portfolioRank || 0;
  const tile = { v: [t('Value'), last.v], r: [t('RAP'), last.r], rank: [t('Rang'), rank, '#'], n: [t('Objets'), last.n] };
  // Carte anonyme : chaque chiffre devient sa variation sur la période, et le rang disparaît.
  const change = (k) => {
    const a = head[k], b = last[k];
    return a ? fmtPct((b - a) / a * 100) : '—';
  };
  const tiles = anon
    ? [[t('Value'), change('v')], [t('RAP'), change('r')], [t('Objets'), last.n]]
    : (primary === 'v' ? ['r', 'rank', 'n'] : primary === 'r' ? ['v', 'rank', 'n'] : ['v', 'r', 'rank']).map(k => tile[k]);

  // Le graphique, avec le modèle du Portefeuille, ramené à la zone de la carte.
  let chart = null;
  if (pts.length >= 2) {
    const m = chartModel(pts, keys, WALLET_SERIES);
    const { x, y, w, h } = FLEX_PLOT;
    const xy = (i, v) => [x + m.xs[i] * w, y + (1 - (v - m.min) / m.span) * h];
    const max = m.min + m.span;
    // Anonyme : les repères du graphique parlent en % depuis le début de la période.
    const base = m.lines[0].base;
    const label = (v) => m.percent ? fmtPct(v) : anon && WALLET_SERIES[primary].money ? fmtPct(base ? (v - base) / base * 100 : 0) : WALLET_SERIES[primary].money ? fmtNum(v) : fmtFull(v);
    chart = {
      lines: m.lines.map(l => {
        const pts2 = l.vals.map((v, i) => xy(i, v));
        return { color: WALLET_SERIES[l.key].color, label: t(WALLET_SERIES[l.key].label), path: smoothPath(pts2), end: pts2[pts2.length - 1], start: pts2[0] };
      }),
      top: label(max), bottom: label(m.min),
      from: fmtDate(pts[0].at), to: fmtDate(pts[pts.length - 1].at),
      box: FLEX_PLOT
    };
  }
  return {
    label: t(HERO_LABEL[primary]),
    value: now,
    anon,
    asOf: last.at || null,
    change: pts.length >= 2 ? { d: delta, pct, label: t(RANGE_LONG[range.key] || '30 jours') } : null,
    chart, tiles
  };
}

/**
 * La feuille de partage, dans la surcouche du zoom (Échap et le clic à côté
 * la referment). Deux cartes : « Mon inventaire » (Portefeuille) et « Bilan
 * du mois » (journal complet demandé au service worker : le popup n'en
 * reçoit que les 100 dernières lignes). Sous la carte, le choix du fond :
 * un fond animé ou un GIF donne une carte animée, exportée en GIF.
 */
async function openShare(mode = 'wallet') {
  document.getElementById('zoom')?.remove();
  const wrap = document.createElement('div');
  wrap.className = 'zoom'; wrap.id = 'zoom';
  wrap.innerHTML = `<div class="zoom-card w-sheet" role="dialog" aria-modal="true" aria-label="${t('Flex')}">
    <header class="z-head">
      <div class="head"><b class="rc-month">${mode === 'wallet' ? `${ic('sparkle')} ${t('Flex mon portefeuille')}` : `${ic('calendar')} ${t('Bilan du mois')}`}</b></div>
      <button class="z-close" title="${t('Fermer')}">${ic('x')}</button>
    </header>
    <div class="z-body rc-body">
      <div class="rc-nav" id="rc-nav">
        <button class="rc-step" data-step="1" title="${t('Mois précédent')}">${ic('chevron')}</button>
        <b class="rc-month" id="rc-month"></b>
        <button class="rc-step next" data-step="-1" title="${t('Mois suivant')}">${ic('chevron')}</button>
      </div>
      <canvas class="rc-card" id="rc-card" width="1080" height="1350"></canvas>
      ${mode === 'wallet' ? `<button class="fx-anon" id="fx-anon" aria-pressed="false">${ic('eye-off')}<span><b>${t('Carte anonyme')}</b><small>${t('Aucun montant : tes variations en % et ta courbe.')}</small></span><i class="fx-switch"></i></button>` : ''}
      <div class="fx-label">${t('Fond')}</div>
      <div class="fx-bgs" id="fx-bgs" role="listbox" aria-label="${t('Fond')}"></div>
      <input type="file" id="fx-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden>
      <div class="rc-actions">
        <button class="rc-btn" id="rc-copy">${ic('copy')}<span>${t('Copier')}</span></button>
        <button class="rc-btn main" id="rc-save">${ic('download')}<span>${t('Télécharger')}</span></button>
      </div>
      <small class="rc-note" id="rc-note"></small>
    </div>
  </div>`;
  document.body.appendChild(wrap);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) closeZoom(); });
  wrap.querySelector('.z-close').addEventListener('click', closeZoom);
  captureFocus(wrap, '.z-close');

  const canvas = wrap.querySelector('#rc-card');
  const fg = document.createElement('canvas');        // la carte seule, sur fond transparent
  const note = wrap.querySelector('#rc-note');
  const saveBtn = wrap.querySelector('#rc-save');
  const logo = B.runtime.getURL('icons/icon128.png');
  const series = walletSeries();   // la courbe du compte (pas `wallet`, les préférences du Portefeuille)
  let history = null, months = null, at = 0, drawing = 0;
  // Le choix ne garde que son nom ; une image importée vit à part (flexBgCustom), une seule fois.
  const stored = await B.storage.local.get(['flexBg', 'flexBgCustom']).catch(() => ({}));
  let choice = { id: stored?.flexBg?.id || 'default' };
  if (choice.id === 'custom') choice = stored?.flexBgCustom ? { id: 'custom', data: stored.flexBgCustom } : { id: 'default' };
  let bg = await loadBackground(choice).catch(() => null);
  let raf = 0, busy = false;

  const stopAnim = () => { cancelAnimationFrame(raf); raf = 0; };
  function animate() {
    stopAnim();
    if (!bg) return;
    if (!bg.animated || REDUCED_MOTION) { compose(canvas, fg, bg, 0); return; }
    const t0 = performance.now();
    let last = 0;
    const tick = (now) => {
      if (!wrap.isConnected) return;
      raf = requestAnimationFrame(tick);
      if (now - last < 33) return;                   // ~30 images/s : largement assez pour un aperçu
      last = now;
      compose(canvas, fg, bg, ((now - t0) / bg.period) % 1);
    };
    raf = requestAnimationFrame(tick);
  }

  async function show() {
    const run = ++drawing;
    wrap.querySelector('#rc-nav').hidden = mode !== 'month';
    saveBtn.querySelector('span').textContent = bg?.animated ? t('Télécharger le GIF') : t('Télécharger');
    const target = bg ? fg : canvas;
    const opts = { clear: !!bg };
    let text;
    if (mode === 'wallet') {
      await drawWallet(target, walletFlexData(anonCard), logo, opts);
      text = anonCard
        ? t("Carte anonyme : aucun montant ni rang, seulement tes variations et ta courbe. Aucun pseudo.")
        : t("Le graphique Rolimon's du Portefeuille, chiffres compris : change la période ou les courbes pour changer la carte. Aucun pseudo n'apparaît dessus.");
    } else {
      if (!history) {
        const res = await send({ type: 'ronote:history' }).catch(() => null);
        history = res?.history || data.history || [];
        months = recapMonths(history, series);
      }
      const [y, m] = months[at];
      const label = new Date(y, m, 1).toLocaleDateString(locale(), { month: 'long', year: 'numeric' });
      wrap.querySelector('#rc-month').textContent = label.charAt(0).toUpperCase() + label.slice(1);
      wrap.querySelector('[data-step="1"]').disabled = at >= months.length - 1;
      wrap.querySelector('[data-step="-1"]').disabled = at <= 0;
      const stats = recapStats(history, series, y, m);
      await drawRecap(target, stats, logo, opts);
      const oldest = history.length ? Math.min(...history.map(h => h.at)) : Date.now();
      text = oldest > stats.from && history.length >= (data.settings?.historyLimit || 300)
        ? t('Ton journal ne remonte pas au début de ce mois : le bilan peut être incomplet. Sa taille se règle dans les réglages.')
        : t("D'après ton journal RoNote. Aucun pseudo n'apparaît sur la carte.");
    }
    if (run !== drawing) return;
    if (bg) { canvas.width = fg.width; canvas.height = fg.height; }
    animate();
    note.textContent = text;
  }

  /* --- le choix du fond ---------------------------------------------------- */
  const tiles = wrap.querySelector('#fx-bgs');
  async function renderTiles() {
    const got = await B.storage.local.get('flexBgCustom').catch(() => ({}));
    const custom = got?.flexBgCustom;
    const list = [...BACKGROUNDS.map(b => ({ ...b, choice: { id: b.id } })),
      ...(custom ? [{ id: 'custom', name: t('Ton image'), animated: /^data:image\/gif/.test(custom), choice: { id: 'custom', data: custom } }] : [])];
    tiles.innerHTML = list.map((b, i) => `<button class="fx-bg" role="option" data-i="${i}" aria-selected="${b.id === choice.id}" title="${escapeHtml(t(b.name))}">
        <img alt=""><span>${escapeHtml(t(b.name))}</span>${b.animated ? '<em>GIF</em>' : ''}</button>`).join('')
      + `<button class="fx-bg fx-add" id="fx-add" title="${t('Importer une image ou un GIF')}">${ic('upload')}<span>${t('Importer')}</span></button>`;
    tiles.querySelectorAll('[data-i]').forEach(async (el) => {
      const b = list[Number(el.dataset.i)];
      el.addEventListener('click', () => pick(b.choice));
      el.querySelector('img').src = await thumbnail(b.choice).catch(() => '');
    });
    tiles.querySelector('#fx-add').addEventListener('click', () => wrap.querySelector('#fx-file').click());
  }
  async function pick(next) {
    choice = next;
    tiles.querySelectorAll('[data-i]').forEach(el => el.setAttribute('aria-selected', 'false'));
    bg = await loadBackground(choice).catch(() => null);
    await B.storage.local.set({ flexBg: { id: choice.id } }).catch(() => {});
    await renderTiles();
    show();
  }
  wrap.querySelector('#fx-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { note.textContent = t('Format non pris en charge : PNG, JPG, GIF ou WebP.'); return; }
    if (file.size > 6 * 1024 * 1024) { note.textContent = t('Image trop lourde (6 Mo maximum).'); return; }
    // Un GIF garde toutes ses images ; une photo est ramenée à la taille de la carte.
    let dataUrl;
    if (file.type === 'image/gif') dataUrl = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.readAsDataURL(file); });
    else {
      const bmp = await createImageBitmap(file).catch(() => null);
      if (!bmp) { note.textContent = t('Image illisible.'); return; }
      const k = Math.min(1, 1350 / Math.max(bmp.width, bmp.height));
      const c = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      dataUrl = c.toDataURL('image/jpeg', 0.88);
    }
    await B.storage.local.set({ flexBgCustom: dataUrl }).catch(() => {});
    pick({ id: 'custom', data: dataUrl });
  });

  /* --- partage ------------------------------------------------------------- */
  // La carte anonyme suit le mode anonyme du popup, et se change ici sans y toucher.
  let anonCard = wallet.hidden;
  const anonBtn = wrap.querySelector('#fx-anon');
  anonBtn?.setAttribute('aria-pressed', String(anonCard));
  anonBtn?.addEventListener('click', () => { anonCard = !anonCard; anonBtn.setAttribute('aria-pressed', String(anonCard)); show(); });
  wrap.querySelectorAll('.rc-step').forEach(b => b.addEventListener('click', () => {
    if (!months) return;
    at = clamp(at + Number(b.dataset.step), 0, months.length - 1); show();
  }));
  const fileName = (ext) => mode === 'wallet'
    ? `ronote-inventaire-${new Date().toISOString().slice(0, 10)}.${ext}`
    : `ronote-bilan-${months[at][0]}-${String(months[at][1] + 1).padStart(2, '0')}.${ext}`;
  const download = (blob, name) => {
    const url = URL.createObjectURL(blob);
    Object.assign(document.createElement('a'), { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  const png = () => new Promise(r => canvas.toBlob(r, 'image/png'));

  /** La carte animée, en GIF : 600 px de large (sa hauteur suit la carte), une image toutes les ~100 ms. */
  async function gif() {
    const w = 600, h = Math.round(600 * fg.height / fg.width);
    const frames = Math.max(8, Math.min(48, Math.round(bg.period / 100)));
    const delay = bg.period / frames;
    const small = Object.assign(document.createElement('canvas'), { width: w, height: h });
    const g = small.getContext('2d', { willReadFrequently: true });
    const label = saveBtn.querySelector('span');
    const shots = [];
    for (let i = 0; i < frames; i++) {
      compose(small, fg, bg, i / frames);
      shots.push(g.getImageData(0, 0, w, h));
      label.textContent = t('Préparation… {p} %', { p: Math.round(i / frames * 40) });
      if (i % 4 === 3) await new Promise(r => setTimeout(r, 0));
    }
    const enc = new GifEncoder(w, h);
    enc.palette(shots.filter((_, i) => i % 3 === 0));
    for (let i = 0; i < shots.length; i++) {
      await enc.add(shots[i], delay);
      label.textContent = t('Préparation… {p} %', { p: 40 + Math.round((i + 1) / shots.length * 60) });
    }
    return enc.finish();
  }

  saveBtn.addEventListener('click', async () => {
    if (busy || (mode === 'month' && !months)) return;
    busy = true;
    saveBtn.disabled = true;
    try {
      if (bg?.animated) download(await gif(), fileName('gif'));
      else download(await png(), fileName('png'));
    } finally {
      busy = false;
      saveBtn.disabled = false;
      saveBtn.querySelector('span').textContent = bg?.animated ? t('Télécharger le GIF') : t('Télécharger');
    }
  });
  wrap.querySelector('#rc-copy').addEventListener('click', async (e) => {
    const label = e.currentTarget.querySelector('span');
    try {
      // Le presse-papiers n'accepte que le PNG : une carte animée y part figée.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png() })]);
      label.textContent = t('Copiée !');
    } catch {
      label.textContent = t('Copie refusée');
    }
    setTimeout(() => { label.textContent = t('Copier'); }, 1800);
  });
  renderTiles();
  await show();
}

/* ============================= portefeuille ============================= */

const RANGES = [
  { key: '1w', label: '1s', days: 7 },
  { key: '1m', label: '1m', days: 30 },
  { key: '3m', label: '3m', days: 90 },
  { key: '6m', label: '6m', days: 182 },
  { key: '1y', label: '1a', days: 365 },
  { key: 'all', label: 'Tout', days: 0 }
];

/** Les courbes du compte, dans l'ordre où elles s'empilent. */
const WALLET_SERIES = {
  v: { label: 'Value', color: '#4d9fff', money: true },
  r: { label: 'RAP', color: '#2fd070', money: true },
  n: { label: 'Collectibles', color: '#c792ea', money: false }
};
const HERO_LABEL = { v: 'Value du compte', r: 'RAP du compte', n: 'Nombre de collectibles' };

/** Les courbes d'un objet, toutes en Robux. */
const ITEM_SERIES = {
  v: { label: 'Value', color: '#4d9fff', money: true },
  r: { label: 'RAP', color: '#2fd070', money: true },
  p: { label: 'Meilleur prix', color: '#ffb02e', money: true }
};
const ITEM_RANGES = [
  { key: '1m', label: '1m', days: 30 },
  { key: '3m', label: '3m', days: 90 },
  { key: '1y', label: '1a', days: 365 },
  { key: 'all', label: 'Tout', days: 0 }
];

const SORTS = [
  { key: 'value', label: 'Plus grosse value' },
  { key: 'rap', label: 'Plus gros RAP' },
  { key: 'change', label: 'Réévaluation 7 j' },
  { key: 'count', label: 'Quantité' },
  { key: 'name', label: 'Nom (A → Z)' }
];

const FILTERS = [
  { key: 'all', label: 'Tous', test: () => true },
  { key: 'face', label: 'Visages', test: (i) => i.isFace },
  { key: 'rare', label: 'Rares', test: (i) => i.rare },
  { key: 'proj', label: 'Projetés', test: (i) => i.projected },
  { key: 'moved', label: 'Réévalués', test: (i) => !!i.change }
];

const TREND_ICON = ['trend-down', 'zigzag', 'trend-flat', 'trend-up', 'wave'];
const SLICE_COLORS = ['#4d9fff', '#2fd070', '#c792ea', '#ffb02e', '#ff7a85', '#3a4458'];
const REDUCED_MOTION = !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

/** Séries valides, dans l'ordre de référence — jamais aucune. */
function orderedSeries(keys, defs) {
  const list = Object.keys(defs).filter(k => Array.isArray(keys) && keys.includes(k));
  return list.length ? list : [Object.keys(defs)[0]];
}

/** Ajoute ou retire une courbe ; la dernière affichée ne se retire pas. */
function toggleSeries(keys, key, defs) {
  const next = keys.includes(key) ? keys.filter(k => k !== key) : [...keys, key];
  return next.length ? orderedSeries(next, defs) : keys;
}

/**
 * Préférences d'affichage du portefeuille. Elles ne regardent que ce popup :
 * localStorage suffit. Stockage bloqué ou vidé, on repart des valeurs par
 * défaut sans rien casser. La recherche, elle, ne survit pas à la fermeture.
 */
const WALLET_KEY = 'ronote:wallet';
const WALLET_PREFS = ['range', 'series', 'hidden', 'view', 'sort', 'filter'];
const wallet = { range: '1m', series: ['v'], hidden: false, view: 'list', sort: 'value', filter: 'all', query: '' };
try {
  const saved = JSON.parse(localStorage.getItem(WALLET_KEY) || '{}');
  for (const k of WALLET_PREFS) if (k in saved) wallet[k] = saved[k];
  // Préférence d'avant les courbes superposables : une seule, value ou RAP.
  if (!('series' in saved) && saved.metric === 'r') wallet.series = ['r'];
} catch { /* valeurs par défaut */ }
wallet.series = orderedSeries(wallet.series, WALLET_SERIES);

/** Le mode anonyme s'applique à tout le popup : classe du document, bouton de l'entête, pseudo. */
function applyAnon() {
  document.body.classList.toggle('anon', wallet.hidden);
  const b = document.getElementById('btn-anon');
  if (b) {
    b.innerHTML = ic(wallet.hidden ? 'eye-off' : 'eye');
    b.title = wallet.hidden ? t('Quitter le mode anonyme (H)') : t('Mode anonyme : masquer montants et pseudo (H)');
    b.setAttribute('aria-pressed', String(wallet.hidden));
  }
}
function toggleAnon() {
  wallet.hidden = !wallet.hidden;
  saveWallet();
  applyAnon();
  if (data.state) renderHeader();
  lastListSig = ''; walletSig = '';
  if (!zoomed && !document.getElementById('zoom')) renderList();
}

function saveWallet() {
  try {
    localStorage.setItem(WALLET_KEY, JSON.stringify(Object.fromEntries(WALLET_PREFS.map(k => [k, wallet[k]]))));
  } catch { /* la préférence dure le temps du popup */ }
}

/**
 * Le mode discret masque les montants, jamais les pourcentages : on garde la
 * tendance sous les yeux sans exposer le solde (partage d'écran, stream).
 */
/**
 * Mode anonyme : un montant masqué devient un faux nombre FIXE, flouté. Il a
 * l'allure d'un chiffre (la mise en page ne bouge pas), mais rien du vrai
 * n'est dans la page — pas même son nombre de chiffres, qui trahirait
 * l'ordre de grandeur. Les pourcentages, eux, restent lisibles.
 */
const masked = (s) => `<span class="amt" aria-label="${t('montant masqué')}">${s}</span>`;
const amount = (n) => (wallet.hidden ? masked(fmtFull(8888888)) : fmtFull(n));
const amountShort = (n) => (wallet.hidden ? masked(fmtNum(8880000)) : fmtNum(n));
const amountSigned = (n, full = false) => (wallet.hidden ? masked(fmtSigned(88888, full)) : fmtSigned(n, full));
const rankText = (r) => (!r ? '' : wallet.hidden ? masked('#' + fmtFull(8888)) : '#' + fmtFull(r));
const sharePct = (p) => (p >= 10 ? String(Math.round(p)) : p.toFixed(1)) + '%';

const seriesText = (def, n) => (def.money ? amount(n) : fmtFull(n));
const seriesShort = (def, n) => (def.money ? amountShort(n) : fmtNum(n));
const seriesSigned = (def, n) => (def.money ? amountSigned(n, true) : fmtSigned(n, true));
const pillText = (def, delta, pct) =>
  `${delta > 0 ? ic('caret-up') : delta < 0 ? ic('caret-down') : '•'} ${wallet.hidden && def.money ? '' : seriesSigned(def, delta) + ' · '}${fmtPct(pct)}`;

/* ------------------------------- le mouvement ---------------------------- */

/**
 * Ce qui s'anime au prochain rendu. Le rafraîchissement de fond redessine
 * l'onglet toutes les 30 s : rejouer les animations à chaque fois serait
 * insupportable. On n'anime donc qu'à l'entrée dans l'onglet ('all'), à un
 * changement de courbe ou de période ('chart'), ou de tri et de vue ('items').
 */
let walletAnimate = 'all';
let heroFrame = 0;

/** Le solde défile jusqu'à sa valeur, comme un compteur. */
function countUp(el, from, to, format, ms = 800) {
  cancelAnimationFrame(heroFrame);
  if (!el) return;
  if (REDUCED_MOTION || wallet.hidden || from === to || !Number.isFinite(from)) { el.innerHTML = format(to); return; }
  const start = performance.now();
  const step = (now) => {
    const k = Math.min(1, (now - start) / ms);
    el.textContent = format(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    if (k < 1) heroFrame = requestAnimationFrame(step);
  };
  heroFrame = requestAnimationFrame(step);
}

/** Entrée en cascade : chaque bloc arrive un peu après le précédent. */
function cascade(elements, max = 20) {
  [...elements].slice(0, max).forEach((el, n) => {
    el.style.setProperty('--i', n);
    el.classList.add('w-in');
  });
}

/* ------------------------------ les courbes ------------------------------ */

const CHART = { W: 400, H: 130, PT: 24, PB: 20, PR: 14, MAX: 220 };
const plotX = (fx) => fx * (CHART.W - CHART.PR);
const plotPct = (fx) => (plotX(fx) / CHART.W) * 100;
const chartY = (v, min, span) =>
  (CHART.PT + (1 - (v - min) / span) * (CHART.H - CHART.PT - CHART.PB)) / CHART.H;

/** Au-delà de ~220 points la courbe n'y gagne rien : on échantillonne, premier et dernier compris. */
function downsample(pts) {
  if (pts.length <= CHART.MAX) return pts;
  const step = (pts.length - 1) / (CHART.MAX - 1);
  return Array.from({ length: CHART.MAX }, (_, i) => pts[Math.round(i * step)]);
}

function nearestIndex(pts, at) {
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].at < at) lo = mid; else hi = mid;
  }
  return at - pts[lo].at <= pts[hi].at - at ? lo : hi;
}

/**
 * Les courbes, prêtes à tracer, placées dans le temps réel (pas au rang du
 * relevé : un historique résumé sur les années anciennes ne doit pas les
 * étirer). Des courbes de même unité partagent l'axe ; dès qu'on mêle Robux
 * et nombre d'objets, chacune passe en variation depuis le début de la
 * période — la seule façon honnête de les empiler.
 */
function chartModel(pts, keys, defs) {
  const t0 = pts[0].at, t1 = pts[pts.length - 1].at;
  const xs = pts.map(p => (t1 > t0 ? (p.at - t0) / (t1 - t0) : 0));
  const percent = keys.length > 1 && new Set(keys.map(k => defs[k].money)).size > 1;
  const lines = keys.map(key => {
    const base = pts.find(p => p[key] > 0)?.[key] || 0;
    const vals = pts.map(p => (percent ? (base ? (((p[key] || 0) - base) / base) * 100 : 0) : (p[key] || 0)));
    return { key, base, vals };
  });
  const all = lines.flatMap(l => l.vals);
  let min = Math.min(...all), max = Math.max(...all);
  if (percent) { min = Math.min(min, 0); max = Math.max(max, 0); }
  return { xs, lines, percent, min, span: (max - min) || 1 };
}

/**
 * Courbe lisse qui ne dépasse jamais les relevés (cubique monotone,
 * Fritsch-Carlson) : une révision de cote reste une marche franche, pas une
 * vague qui inventerait un creux avant la hausse.
 */
function smoothPath(xy) {
  const f = (n) => n.toFixed(1);
  const n = xy.length;
  if (n < 3) return 'M' + xy.map(p => `${f(p[0])},${f(p[1])}`).join('L');
  const dx = [], m = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = (xy[i + 1][0] - xy[i][0]) || 1e-6;
    m[i] = (xy[i + 1][1] - xy[i][1]) / dx[i];
  }
  const tan = [m[0]];
  for (let i = 1; i < n - 1; i++) tan[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  tan[n - 1] = m[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { tan[i] = 0; tan[i + 1] = 0; continue; }
    const a = tan[i] / m[i], b = tan[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); tan[i] = k * a * m[i]; tan[i + 1] = k * b * m[i]; }
  }
  let d = `M${f(xy[0][0])},${f(xy[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += `C${f(xy[i][0] + h)},${f(xy[i][1] + tan[i] * h)} ${f(xy[i + 1][0] - h)},${f(xy[i + 1][1] - tan[i + 1] * h)} ${f(xy[i + 1][0])},${f(xy[i + 1][1])}`;
  }
  return d;
}

/**
 * Le graphique : courbes lissées et remplies, point du moment qui pulse,
 * plus haut et plus bas de la période, révisions de cote. Le survol est
 * branché ensuite par mountChart.
 */
function chartHtml({ id, pts, keys, defs, animate = false, markers = [] }) {
  if (pts.length < 2) return `<div class="w-nochart">${t('Pas encore assez de points sur cette période.')}</div>`;
  const { W, H } = CHART;
  const m = chartModel(pts, keys, defs);
  const yPct = (v) => chartY(v, m.min, m.span) * 100;

  let gradients = '';
  const areas = [], lines = [], ends = [];
  m.lines.forEach((l, n) => {
    const def = defs[l.key];
    const d = smoothPath(l.vals.map((v, i) => [plotX(m.xs[i]), chartY(v, m.min, m.span) * H]));
    const gid = `${id}-g${n}`;
    const solo = m.lines.length === 1;
    gradients += `<linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="${def.color}" stop-opacity="${solo ? 0.36 : 0.15}"/>
      <stop offset="100%" stop-color="${def.color}" stop-opacity="0"/></linearGradient>`;
    // Le remplissage court jusqu'au bord, à plat depuis le dernier relevé :
    // sans ça, il s'arrêtait net sous le point du moment, en arête verticale.
    const lastY = (chartY(l.vals[l.vals.length - 1], m.min, m.span) * H).toFixed(1);
    areas.push(`<path d="${d}L${W},${lastY}L${W},${H}L0,${H}Z" fill="url(#${gid})"/>`);
    lines.push(`<path class="w-line" d="${d}" fill="none" stroke="${def.color}" stroke-width="${n ? 1.7 : 2.3}"
      stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke" style="filter:drop-shadow(0 0 5px ${def.color}55)"/>`);
    ends.push(`<i class="w-end" style="left:${plotPct(1)}%;top:${yPct(l.vals[l.vals.length - 1])}%;--c:${def.color}"></i>`);
  });

  const zeroY = (chartY(0, m.min, m.span) * H).toFixed(1);
  const zero = m.percent ? `<line class="w-zero" x1="0" x2="${W}" y1="${zeroY}" y2="${zeroY}" vector-effect="non-scaling-stroke"/>` : '';

  // Plus haut et plus bas : seulement pour une courbe seule, sinon illisible.
  let extremes = '';
  if (m.lines.length === 1) {
    const vals = m.lines[0].vals;
    let hi = 0, lo = 0;
    vals.forEach((v, i) => { if (v > vals[hi]) hi = i; if (v < vals[lo]) lo = i; });
    if (vals[hi] !== vals[lo]) {
      const tag = (i, cls) => `<span class="w-ext ${cls}" style="left:${clamp(plotPct(m.xs[i]), 10, 88)}%;top:${yPct(vals[i])}%">${seriesShort(defs[keys[0]], vals[i])}</span>`;
      extremes = tag(hi, 'hi') + tag(lo, 'lo');
    }
  }

  // Révisions de la cote, posées sur la courbe de la value. Un objet ancien en
  // compte des dizaines par an : seules les 10 plus fortes de la période.
  const vLine = !m.percent ? m.lines.find(l => l.key === 'v') : null;
  const swing = (c) => Math.abs(c.to - c.from) / (c.from || c.to || 1);
  const marks = vLine
    ? markers.filter(c => c.at >= pts[0].at && c.at <= pts[pts.length - 1].at)
      .sort((a, b) => swing(b) - swing(a)).slice(0, 10).map(c => {
      const i = nearestIndex(pts, c.at);
      return `<i class="w-mark ${c.to >= c.from ? 'up' : 'down'}" style="left:${plotPct(m.xs[i])}%;top:${yPct(vLine.vals[i])}%"></i>`;
    }).join('')
    : '';

  return `<div class="w-plot${animate && !REDUCED_MOTION ? ' reveal' : ''}" id="${id}">
    <svg class="w-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <defs>${gradients}</defs>${zero}${areas.reverse().join('')}${lines.reverse().join('')}
    </svg>
    ${marks}${extremes}${ends.join('')}
    <div class="w-cursor" hidden></div>
    ${keys.map(k => `<i class="w-cdot" style="--c:${defs[k].color}" hidden></i>`).join('')}
    <div class="w-tip" hidden></div>
  </div>`;
}

/** Sous un graphique à plusieurs courbes : la variation de chacune sur la période. */
function legendHtml(pts, keys, defs) {
  if (keys.length < 2 || pts.length < 2) return '';
  const m = chartModel(pts, keys, defs);
  const items = keys.map(k => {
    const def = defs[k];
    const base = pts.find(p => p[k] > 0)?.[k] || 0;
    const last = pts[pts.length - 1][k] || 0;
    const pct = base ? ((last - base) / base) * 100 : 0;
    return `<span><i style="background:${def.color}"></i>${t(def.label)} <em class="${toneOf(pct)}">${fmtPct(pct)}</em></span>`;
  }).join('');
  return `<div class="w-leg">${items}${m.percent ? `<small>${t('en % depuis le début de la période')}</small>` : ''}</div>`;
}

/**
 * Le survol : curseur, un point par courbe, infobulle avec la valeur de
 * chacune au jour pointé. Tout suit la souris image par image.
 */
function mountChart({ id, pts, keys, defs, onScrub = null }) {
  const plot = document.getElementById(id);
  if (!plot || pts.length < 2) return;
  const m = chartModel(pts, keys, defs);
  const cursor = plot.querySelector('.w-cursor');
  const tip = plot.querySelector('.w-tip');
  const dots = [...plot.querySelectorAll('.w-cdot')];
  const t0 = pts[0].at, t1 = pts[pts.length - 1].at;
  let frame = 0;
  // Mesurees une fois : l'infobulle garde la meme forme d'un point a l'autre
  // (une ligne par courbe), et le trace garde sa hauteur. Les lire apres avoir
  // ecrit leur contenu forcait un calcul de mise en page a chaque image du
  // survol — d'ou les saccades.
  let tipH = 0, plotH = 0;

  const show = (clientX) => {
    const box = plot.getBoundingClientRect();
    const fx = clamp((clientX - box.left) / (box.width * (CHART.W - CHART.PR) / CHART.W), 0, 1);
    const i = nearestIndex(pts, t0 + fx * (t1 - t0));
    const x = plotPct(m.xs[i]);
    plot.classList.add('scrub');
    cursor.hidden = tip.hidden = false;
    cursor.style.left = x + '%';
    dots.forEach((dot, n) => {
      dot.hidden = false;
      dot.style.left = x + '%';
      dot.style.top = chartY(m.lines[n].vals[i], m.min, m.span) * 100 + '%';
    });
    tip.innerHTML = `<b>${fmtDate(pts[i].at)}</b>` + keys.map((k, n) => {
      const def = defs[k];
      const pct = m.percent ? `<em>${fmtPct(m.lines[n].vals[i])}</em>` : '';
      return `<span><i style="background:${def.color}"></i>${t(def.label)}<strong>${seriesText(def, pts[i][k] || 0)}</strong>${pct}</span>`;
    }).join('');
    tip.style.left = clamp(x, 21, 79) + '%';
    // L'infobulle ne doit pas cacher le point survolé : quand la courbe passe
    // sous elle, elle descend en bas du graphique.
    const highest = Math.min(...m.lines.map(l => chartY(l.vals[i], m.min, m.span)));
    if (!tipH) tipH = tip.offsetHeight;
    if (!plotH) plotH = plot.clientHeight;
    const low = highest < (tipH + 8) / plotH;
    tip.style.top = low ? 'auto' : '0';
    tip.style.bottom = low ? '0' : 'auto';
    onScrub?.(i);
  };

  plot.addEventListener('pointermove', (e) => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => show(e.clientX));
  });
  plot.addEventListener('pointerleave', () => {
    cancelAnimationFrame(frame);
    plot.classList.remove('scrub');
    cursor.hidden = tip.hidden = true;
    dots.forEach(dot => { dot.hidden = true; });
    onScrub?.(null);
  });
}

function seriesChips(defs, keys, attr) {
  return `<div class="w-series">${Object.entries(defs).map(([k, d]) =>
    `<button class="${keys.includes(k) ? 'on' : ''}" ${attr}="${k}" style="--c:${d.color}"><i></i>${t(d.label)}</button>`).join('')}</div>`;
}

/* ------------------------------ la répartition --------------------------- */

function allocationHtml(items) {
  const rated = items.filter(i => i.total > 0).sort((a, b) => b.total - a.total);
  const sum = rated.reduce((s, i) => s + i.total, 0);
  if (!sum) return '';
  const top = rated.slice(0, 5);
  const rest = sum - top.reduce((s, i) => s + i.total, 0);
  const slices = top.map((i, n) => ({ name: i.name, total: i.total, color: SLICE_COLORS[n] }));
  if (rest > 0) slices.push({ name: t('Autres ({n})', { n: rated.length - top.length }), total: rest, color: SLICE_COLORS[5] });

  return `<section class="panel">
    <div class="panel-h"><span>${t('Répartition')}</span><span>${t('top 5 · par value')}</span></div>
    <div class="w-alloc">${slices.map(s =>
      `<i style="flex:${s.total};background:${s.color}" title="${escapeHtml(s.name)}"></i>`).join('')}</div>
    <div class="w-legend">${slices.map(s =>
      `<div><i style="background:${s.color}"></i><span>${escapeHtml(s.name)}</span><b>${sharePct((s.total / sum) * 100)}</b></div>`).join('')}</div>
  </section>`;
}

/* ------------------------------ les objets ------------------------------- */

function thumbHtml(i) {
  return i.thumb
    ? `<img class="w-img" src="${escapeHtml(i.thumb)}" alt="" loading="lazy" decoding="async">`
    : `<div class="w-img ph">${ic(i.isFace ? 'face' : 'box')}</div>`;
}

function itemBadges(i) {
  return [
    showsRare(i) ? MARKS.inline.rare() : '',
    i.projected ? `<span class="w-tag proj" title="${t('PROJECTED — RAP gonflé artificiellement')}">${PROJ_ICON}</span>` : '',
    i.isFace ? `<span class="w-tag" title="${t('visage (bundle DynamicHead)')}">${ic('face')}</span>` : ''
  ].join('');
}

function itemSub(i) {
  return [
    i.acronym ? escapeHtml(i.acronym) : '',
    i.demand >= 0 && DEMAND_LABEL[i.demand] ? t('demande {v}', { v: t(DEMAND_LABEL[i.demand]).toLowerCase() }) : '',
    i.trend >= 0 && TREND_LABEL[i.trend] ? `${ic(TREND_ICON[i.trend])} ${t(TREND_LABEL[i.trend]).toLowerCase()}` : ''
  ].filter(Boolean).join(' · ');
}

function itemRowHtml(i, sum) {
  const ch = i.change;
  const aside = ch
    ? `<span class="${toneOf(ch.pct)}">${ic(ch.pct >= 0 ? 'trend-up' : 'trend-down')} ${fmtPct(ch.pct)}</span>`
    : `<span>${sum ? sharePct((i.total / sum) * 100) : ''}</span>`;
  return `<button class="w-item" data-item="${escapeHtml(i.key)}">
    <span class="w-thumb">${thumbHtml(i)}${i.count > 1 ? `<em>×${i.count}</em>` : ''}</span>
    <span class="w-name"><span class="w-nl"><b>${escapeHtml(i.name)}</b>${itemBadges(i)}</span><small>${itemSub(i)}</small></span>
    <span class="w-val"><b>${amount(i.total)}</b>${aside}</span>
  </button>`;
}

function itemCardHtml(i) {
  const ch = i.change;
  return `<button class="w-card" data-item="${escapeHtml(i.key)}">
    <span class="w-cthumb">${thumbHtml(i)}${i.count > 1 ? `<em>×${i.count}</em>` : ''}<span class="w-cbadges">${itemBadges(i)}</span></span>
    <b>${escapeHtml(i.name)}</b>
    <span class="w-cval">${amountShort(i.total)}${ch ? ` <span class="${toneOf(ch.pct)}">${fmtPct(ch.pct)}</span>` : ''}</span>
  </button>`;
}

function visibleItems(items) {
  const filter = FILTERS.find(f => f.key === wallet.filter) || FILTERS[0];
  const q = wallet.query.trim().toLowerCase();
  const pct = (i) => (i.change ? i.change.pct : -1e9);
  const order = {
    value: (a, b) => b.total - a.total,
    rap: (a, b) => b.totalRap - a.totalRap,
    change: (a, b) => pct(b) - pct(a) || b.total - a.total,
    count: (a, b) => b.count - a.count || b.total - a.total,
    name: (a, b) => a.name.localeCompare(b.name)
  }[wallet.sort] || ((a, b) => b.total - a.total);
  return items
    .filter(i => filter.test(i) && (!q || i.name.toLowerCase().includes(q) || (i.acronym || '').toLowerCase().includes(q)))
    .sort(order);
}

/** Seule la liste est redessinée pendant la frappe : le champ garde son curseur. */
function renderItems({ animate = false } = {}) {
  const box = document.getElementById('w-items');
  const items = data.report?.items;
  if (!box || !Array.isArray(items)) return;
  const sum = items.reduce((s, i) => s + i.total, 0);
  const list = visibleItems(items);
  box.className = wallet.view === 'grid' ? 'w-grid' : 'w-list';
  const none = wallet.query.trim()
    ? t('Aucun objet ne correspond à « {q} ».', { q: escapeHtml(wallet.query.trim()) })
    : t('Aucun objet dans cette catégorie.');
  box.innerHTML = list.length
    ? list.map(i => (wallet.view === 'grid' ? itemCardHtml(i) : itemRowHtml(i, sum))).join('')
    : `<div class="w-none">${none}</div>`;
  bindImages(box);
  if (animate && !REDUCED_MOTION) cascade(box.children, wallet.view === 'grid' ? 12 : 16);
}

function collectionHtml(rep, items, owned) {
  const head = `<div class="panel-h"><span>${t('Mes collectibles')}</span><span>${owned ? plural(owned, '{n} objet', '{n} objets') : ''}</span></div>`;
  if (!items) {
    return `<section class="panel">${head}<div class="w-none">${walletFetching
      ? t('Chargement de tes objets…')
      : escapeHtml(t('Liste des objets indisponible — {why}.', { why: t(rep?.reason || 'sources incomplètes') }))}</div></section>`;
  }
  const chips = FILTERS.map(f => {
    const n = items.filter(f.test).length;
    if (!n && f.key !== 'all' && f.key !== wallet.filter) return '';
    return `<button class="${f.key === wallet.filter ? 'on' : ''}" data-filter="${f.key}">${t(f.label)} <small>${n}</small></button>`;
  }).join('');

  return `<section class="panel">
    ${head}
    <div class="w-tools">
      <input id="w-search" type="search" placeholder="${escapeHtml(t('Rechercher un objet'))}" value="${escapeHtml(wallet.query)}" autocomplete="off" spellcheck="false">
      <select id="w-sort" title="${escapeHtml(t('Trier'))}">${SORTS.map(s =>
        `<option value="${s.key}"${s.key === wallet.sort ? ' selected' : ''}>${t(s.label)}</option>`).join('')}</select>
      <button class="w-view" data-view title="${wallet.view === 'grid' ? t('Vue liste') : t('Vue galerie')}">${ic(wallet.view === 'grid' ? 'list' : 'grid')}</button>
    </div>
    <div class="w-chips">${chips}</div>
    <div id="w-items"></div>
    ${rep?.unrated ? `<div class="note">${plural(rep.unrated, "+ {n} objet que Rolimon's ne cote pas publiquement", "+ {n} objets que Rolimon's ne cote pas publiquement")}</div>` : ''}
  </section>`;
}

/* ---------------------------- fiche d'un objet --------------------------- */

/** La fiche ouverte : son historique arrive après coup, depuis le service worker. */
const sheet = { key: null, roliId: 0, data: null, changes: [], error: '', series: ['v', 'r'], range: '1y' };

function renderSheetChart(animate = false) {
  const box = document.getElementById('w-sh-chart');
  if (!box) return;
  if (!sheet.roliId) {
    box.innerHTML = `<div class="w-none">${t("Rolimon's ne publie pas d'historique pour ce bundle.")}</div>`;
    return;
  }
  if (sheet.error) {
    box.innerHTML = `<div class="w-none">${escapeHtml(t('Historique indisponible — {why}.', { why: sheet.error }))}</div>`;
    return;
  }
  if (!sheet.data) {
    box.innerHTML = `<div class="w-skel"></div>`;
    return;
  }

  const drawn = renderRangedChart({
    box, points: sheet.data, series: ITEM_SERIES, state: sheet, attr: 's',
    id: 'w-sh-plot', defs: ITEM_SERIES, markers: sheet.changes || [], animate, redraw: renderSheetChart
  });
  if (!drawn) {
    box.innerHTML = `<div class="w-none">${escapeHtml(t('Historique indisponible — {why}.', { why: t('réponse vide') }))}</div>`;
  }
}

function openItemSheet(key) {
  const items = data.report?.items || [];
  const i = items.find(x => x.key === key);
  if (!i) return;
  const sum = items.reduce((s, x) => s + x.total, 0);
  const roliId = i.kind === 'asset' ? i.id : i.faceAssetId;
  const links = [
    roliId ? { label: "Rolimon's", url: `https://www.rolimons.com/item/${roliId}` } : null,
    { label: 'Roblox', url: i.kind === 'bundle' ? `https://www.roblox.com/bundles/${i.id}` : `https://www.roblox.com/catalog/${i.id}` }
  ].filter(Boolean);
  const ch = i.change;
  const fact = factHtml;
  const kind = i.isFace ? t('visage') : i.kind === 'bundle' ? t('bundle') : '';

  document.getElementById('zoom')?.remove();
  zoomed = 'item:' + key;   // le rafraîchissement de fond attend la fermeture
  Object.assign(sheet, { key, roliId, data: null, changes: [], error: '' });

  const wrap = document.createElement('div');
  wrap.className = 'zoom';
  wrap.id = 'zoom';
  wrap.innerHTML = `<div class="zoom-card w-sheet" role="dialog" aria-modal="true">
    <header class="z-head">
      <div class="w-sh-head">
        <span class="w-sh-thumb">${thumbHtml(i)}</span>
        <div class="w-sh-name"><b>${escapeHtml(i.name)}</b>
          <small>${[i.acronym ? escapeHtml(i.acronym) : '', kind].filter(Boolean).join(' · ')} ${itemBadges(i)}</small></div>
      </div>
      <button class="z-close" title="${t('Fermer')}">${ic('x')}</button>
    </header>
    <div class="z-body">
      <div class="w-sh-amount">${amount(i.total)}</div>
      <div class="w-sh-sub">${i.count > 1 ? t('{n} exemplaires × {v}', { n: i.count, v: amount(i.value) }) : t('1 exemplaire')}${sum ? ' · ' + t('{p} de tes objets cotés', { p: sharePct((i.total / sum) * 100) }) : ''}</div>
      <div class="w-sh-chart" id="w-sh-chart"></div>
      <div class="w-facts">
        ${fact('Value', amount(i.value) + (i.noValue ? ` <small>${t('(RAP faute de cote)')}</small>` : ''))}
        ${fact('RAP', amount(i.rap))}
        ${fact(t('Demande'), i.demand >= 0 && DEMAND_LABEL[i.demand] ? t(DEMAND_LABEL[i.demand]) : '—')}
        ${fact(t('Tendance'), i.trend >= 0 && TREND_LABEL[i.trend] ? `${ic(TREND_ICON[i.trend])} ${t(TREND_LABEL[i.trend])}` : '—')}
      </div>
      ${ch ? `<div class="w-rev ${toneOf(ch.pct)}">${ic(ch.pct >= 0 ? 'trend-up' : 'trend-down')} ${t('Réévalué {ago} : {from} → {to} ({pct})', { ago: timeAgo(ch.at), from: amount(ch.from), to: amount(ch.to), pct: fmtPct(ch.pct) })}</div>` : ''}
      ${i.projected ? `<div class="w-warn"><i class="proj-ic">${PROJ_ICON}</i> ${t('PROJECTED — RAP gonflé artificiellement')}</div>` : ''}
    </div>
    <footer class="z-foot">${links.map(l =>
      `<button class="z-open" data-url="${escapeHtml(l.url)}">${l.label} ${ic('external')}</button>`).join('')}</footer>
  </div>`;
  document.body.appendChild(wrap);
  bindImages(wrap);
  renderSheetChart();

  wrap.addEventListener('click', (e) => { if (e.target === wrap) closeZoom(); });
  wrap.querySelector('.z-close').addEventListener('click', closeZoom);
  captureFocus(wrap, '.z-close');
  wrap.querySelectorAll('button[data-url]').forEach(b => {
    b.addEventListener('click', () => B.tabs.create({ url: b.dataset.url }));
  });

  if (!roliId) return;
  const still = () => zoomed === 'item:' + key;
  send({ type: 'ronote:item-history', itemId: roliId }).then((res) => {
    if (!still()) return;
    const h = res?.history;
    if (h?.t?.length) {
      sheet.data = h.t.map((at, n) => ({ at, v: h.v[n], r: h.r[n], p: h.p[n] }));
      sheet.changes = (h.changes || []).map(([at, from, to]) => ({ at, from, to }));
    } else {
      sheet.error = res?.error || t('réponse vide');
    }
    renderSheetChart(true);
  }, () => {
    if (!still()) return;
    sheet.error = t('réponse vide');
    renderSheetChart();
  });
}

/* -------------------------------- l'onglet ------------------------------- */

let walletFetching = false;
let walletAutoTried = false;
let walletSig = '';   // dernier rendu de l'onglet, pour sauter les redessins inutiles

async function recomputePortfolio(btn = null) {
  if (walletFetching) return;
  walletFetching = true;
  if (btn) btn.textContent = t('Calcul…');
  try {
    const res = await send({ type: 'ronote:portfolio' });
    if (res?.state) data.state = res.state;
    if (res?.portfolio) data.portfolio = res.portfolio;
    if (res?.report) data.report = res.report;
  } catch { /* le prochain passage du service worker s'en chargera */ }
  walletFetching = false;
  if (tab === 'stats' && !zoomed) keepScroll(renderStats);
}

function renderStats() {
  const st = data.state || {};
  const rep = data.report;
  const profil = st.userId ? `https://www.rolimons.com/player/${st.userId}` : null;
  const lien = profil ? `<a class="link" href="${profil}" target="_blank" rel="noreferrer">${t("Voir sur Rolimon's")} ${ic('external')}</a>` : '';

  if (st.portfolioPrivate) {
    listEl.innerHTML = `<div class="empty"><b>${t('Inventaire privé')}</b>
      ${t("Rolimon's ne publie ni value ni RAP pour un inventaire privé. Passe-le en public sur ton profil Roblox pour activer le suivi.")}<br>${lien}</div>`;
    return;
  }

  const all = walletSeries();
  const last = st.portfolioLast;
  if (!all.length && !last) {
    listEl.innerHTML = `<div class="empty"><b>${t("Chargement du profil Rolimon's")}</b>
      ${t('Les chiffres arrivent à la prochaine vérification.')}<br>${lien}</div>`;
    return;
  }

  // Rapport écrit par une version sans liste d'objets : on la demande une
  // fois, plutôt que d'attendre le prochain calcul du service worker (10 min).
  const items = Array.isArray(rep?.items) ? rep.items : null;
  if (!items && !walletAutoTried) { walletAutoTried = true; recomputePortfolio(); }

  // Entrée dans l'onglet : tout s'anime. Redessin de fond : rien ne bouge.
  const mode = REDUCED_MOTION ? null : (listEl.querySelector('.w-hero') ? walletAnimate : 'all');
  walletAnimate = null;

  // Redessin de fond sans rien de neuf : l'onglet reste tel quel, avec ses
  // vignettes et sa courbe, au lieu d'être reconstruit toutes les 30 s.
  const sig = JSON.stringify([
    rep?.at, rep?.items?.length, all.length, all[all.length - 1]?.at, last?.v, last?.r, last?.at,
    st.portfolioRank, walletFetching, WALLET_PREFS.map(k => wallet[k]), walletGoal
  ]);
  if (listEl.querySelector('.w-hero') && sig === walletSig) return;
  walletSig = sig;

  const { range, inRange, keys, primary, pdef, cur, nowOf, now, start, delta, pct } = walletView(all);
  const pts = downsample(inRange);
  const tone = toneOf(delta);
  const whenText = t('sur {p}', { p: range.days ? t(range.label) : t("tout l'historique") });

  const moved = (items || []).filter(i => i.change);
  const movedImpact = moved.reduce((s, i) => s + (i.change.to - i.change.from) * i.count, 0);
  const owned = items ? items.reduce((s, i) => s + i.count, 0) + (rep.unrated || 0) : (st.collectibles || 0);
  const other = primary === 'r' ? 'v' : 'r';

  // Un redessin de fond ne doit pas voler le curseur de la recherche.
  const search = document.activeElement?.id === 'w-search' ? document.activeElement : null;
  const caret = search ? [search.selectionStart, search.selectionEnd] : null;

  listEl.innerHTML = `
    <section class="w-hero" data-tone="${tone}">
      <div class="w-top">
        ${seriesChips(WALLET_SERIES, keys, 'data-series')}
        <span class="w-tools">
          <button class="w-flex" data-share="wallet" title="${t('Partager une carte de ton portefeuille')}">${ic('sparkle')}${t('Flex')}</button>
          <button class="w-eye" data-eye title="${wallet.hidden ? t('Quitter le mode anonyme (H)') : t('Mode anonyme : masquer montants et pseudo (H)')}">${ic(wallet.hidden ? 'eye-off' : 'eye')}</button>
        </span>
      </div>
      <div class="w-label">${t(HERO_LABEL[primary])}</div>
      <div class="w-amount" id="w-amount">${seriesText(pdef, now)}</div>
      <div class="w-change">
        <span class="w-pill ${tone}" id="w-pill">${pillText(pdef, delta, pct)}</span>
        <span class="w-when" id="w-when">${whenText}</span>
      </div>
      ${chartHtml({ id: 'w-plot', pts, keys, defs: WALLET_SERIES, animate: mode === 'all' || mode === 'chart' })}
      ${legendHtml(pts, keys, WALLET_SERIES)}
      <div class="w-ranges">${RANGES.map(r =>
        `<button class="${r.key === range.key ? 'on' : ''}" data-range="${r.key}">${t(r.label)}</button>`).join('')}</div>
    </section>
    <section class="w-tiles">
      <div class="w-tile"><span>${WALLET_SERIES[other].label}</span><b>${amountShort(cur[other])}</b></div>
      <div class="w-tile"><span>${t('Rang')}</span><b>${rankText(st.portfolioRank) || '—'}</b></div>
      <div class="w-tile"><span>${t('Objets')}</span><b>${owned ? fmtFull(owned) : '—'}</b></div>
      <div class="w-tile" title="${escapeHtml(t('Effet des réévaluations Rolimon\'s des 7 derniers jours sur tes objets'))}"><span>${t('Réévalué · 7 j')}</span>
        <b class="${moved.length ? toneOf(movedImpact) : ''}">${moved.length ? amountSigned(movedImpact) : '—'}</b></div>
    </section>
    ${goalHtml(walletGoal, all, nowOf.v, wallet.hidden)}
    ${items ? allocationHtml(items) : ''}
    ${collectionHtml(rep, items, owned)}
    <div class="w-foot">
      ${lien}
      <span>${rep?.at ? t('calculé {ago}', { ago: agoHtml(rep.at) }) : ''}</span>
      <button class="w-btn" id="btn-recompute">${walletFetching ? t('Calcul…') : t('Recalculer maintenant')}</button>
    </div>
    <div class="w-note">${t("Courbe telle que Rolimon's la publie (une mesure par jour), prolongée jusqu'au dernier relevé de RoNote. Le chiffre du haut, lui, est celui de maintenant.")}</div>`;

  bindImages(listEl);
  renderItems({ animate: mode === 'all' || mode === 'items' });
  if (mode === 'all') cascade(listEl.children, 8);

  const amountEl = document.getElementById('w-amount');
  const pillEl = document.getElementById('w-pill');
  const whenEl = document.getElementById('w-when');
  mountChart({
    id: 'w-plot', pts, keys, defs: WALLET_SERIES,
    // Survol : le solde affiché devient celui du jour pointé.
    onScrub: (i) => {
      cancelAnimationFrame(heroFrame);
      if (i === null) {
        amountEl.innerHTML = seriesText(pdef, now);
        pillEl.innerHTML = pillText(pdef, delta, pct);
        pillEl.className = `w-pill ${tone}`;
        whenEl.textContent = whenText;
        return;
      }
      const base = pts[0][primary] || 0;
      const value = pts[i][primary] || 0;
      amountEl.innerHTML = seriesText(pdef, value);
      pillEl.innerHTML = pillText(pdef, value - base, base ? ((value - base) / base) * 100 : 0);
      pillEl.className = 'w-pill ' + toneOf(value - base);
      whenEl.textContent = fmtDate(pts[i].at);
    }
  });
  if (mode === 'all' || mode === 'chart') countUp(amountEl, start, now, (x) => seriesText(pdef, x));

  if (caret) {
    const s = document.getElementById('w-search');
    s?.focus();
    s?.setSelectionRange(...caret);
  }

  const redraw = (anim) => { walletAnimate = anim; keepScroll(renderStats); };
  const pref = (k, v, anim) => { wallet[k] = v; saveWallet(); redraw(anim); };
  listEl.querySelectorAll('[data-series]').forEach(el => el.addEventListener('click', () =>
    pref('series', toggleSeries(wallet.series, el.dataset.series, WALLET_SERIES), 'chart')));
  listEl.querySelectorAll('[data-range]').forEach(el => el.addEventListener('click', () => pref('range', el.dataset.range, 'chart')));
  listEl.querySelectorAll('[data-filter]').forEach(el => el.addEventListener('click', () => pref('filter', el.dataset.filter, 'items')));
  listEl.querySelector('[data-eye]')?.addEventListener('click', toggleAnon);
  listEl.querySelector('[data-view]')?.addEventListener('click', () => pref('view', wallet.view === 'grid' ? 'list' : 'grid', 'items'));
  listEl.querySelector('#w-sort')?.addEventListener('change', (e) => { wallet.sort = e.target.value; saveWallet(); renderItems({ animate: true }); });
  // La frappe rapide ne refiltre et ne redessine qu'une fois la main levée.
  let searchTimer = null;
  listEl.querySelector('#w-search')?.addEventListener('input', (e) => {
    wallet.query = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderItems, 120);
  });
  listEl.querySelector('#w-items')?.addEventListener('click', (e) => {
    const row = e.target.closest('[data-item]');
    if (row) openItemSheet(row.dataset.item);
  });
  const recompute = listEl.querySelector('#btn-recompute');
  recompute?.addEventListener('click', () => recomputePortfolio(recompute));
  listEl.querySelectorAll('[data-share]').forEach(b => b.addEventListener('click', () => openShare(b.dataset.share)));
  listEl.querySelectorAll('[data-goal]').forEach(b => b.addEventListener('click', async () => {
    if (b.dataset.goal === 'edit') { openGoal(); return; }
    if (confirm(t('Supprimer cet objectif ?'))) await B.storage.local.set({ walletGoal: null }).catch(() => {});
  }));
}

/* =============================== la liste =============================== */

/**
 * Le rafraîchissement de fond redessine la liste toutes les 30 s. Sans ça, le
 * défilement remonterait en haut au milieu d'une lecture.
 */
function keepScroll(draw) {
  const top = listEl.scrollTop;
  draw();
  if (top) listEl.scrollTop = top;
}

/**
 * Entrée dans un onglet : tout arrive en cascade. Redessin de fond : rien ne
 * bouge, sauf une carte qui vient d'être évaluée et remplace sa silhouette.
 */
/** Tout ce qui change le rendu de la liste affichée, en une chaîne. */
let lastListSig = '';
function listSignature(snap) {
  // Pas l'heure : les « il y a 3 min » avancent seuls, sans reconstruire la
  // liste (voir la fin du fichier). Le journal range ses lignes par jour.
  if (tab === 'history') {
    return JSON.stringify([tab, listFilter.history, new Date().toDateString(), data.history?.length || 0, data.history?.[0]?.at || 0]);
  }
  return JSON.stringify([
    tab, listFilter[tab], data.settings?.showItemDetails, data.state?.inboundCount,
    Object.keys(data.state?.tracked || {}), Object.keys(data.state?.links || {}).length,
    snap.map(x => [x.tradeId, x.status, cards[tab].has(x.tradeId), failures[tab].get(x.tradeId) || '', expanded.has(x.tradeId)]),
    armedNix, marksSig(),
    [more[tab]?.loading, more[tab]?.error, hasMore(tab), hydrating.has(tab)]
  ]);
}

/**
 * Une ligne de liste : la carte si elle est prete, l'erreur si l'evaluation a
 * echoue, la silhouette a defaut. Un echec ne doit jamais escamoter un trade.
 */
function rowHtml(kind, item, { entering = false } = {}) {
  const outbound = kind === 'outbound';
  const c = cards[kind].get(item.tradeId);
  if (c) {
    const key = kind + ':' + item.tradeId;
    const enter = !entering && !shownCards.has(key) && !REDUCED_MOTION;
    shownCards.add(key);
    // La fiche vient du cache ; le statut et l'expiration, eux, viennent de la
    // liste, relue à chaque vérification.
    return cardHtml({ ...item, ...c, status: item.status || c.status, expiration: item.expiration || c.expiration },
      { outbound, enter });
  }
  const err = failures[kind].get(item.tradeId);
  if (err) return cardHtml({ ...item, analysis: null, url: tradeUrl(item.tradeId), error: err }, { outbound });
  return skeletonHtml(item.tradeId);
}

function renderList() {
  const entering = listEl.dataset.tab !== tab;
  listEl.dataset.tab = tab;
  if (tab === 'stats') { lastListSig = ''; keepScroll(renderStats); return; }
  // La pièce ne se redessine qu'en arrivant sur l'onglet : un rafraîchissement
  // de fond couperait un lancer en plein vol.
  if (tab === 'coin') { lastListSig = ''; if (entering) renderCoin(listEl); return; }
  if (tab === 'home') {
    const sig = homeSignature();
    if (!entering && sig === lastListSig) return;
    lastListSig = sig;
    keepScroll(() => renderHome(entering));
    return;
  }

  // Le rafraîchissement de fond repasse toutes les 10 à 30 s. Rien de neuf :
  // on garde la liste telle quelle au lieu de recréer cartes et vignettes.
  const snap = tab === 'history' ? [] : listOf(tab);
  const sig = listSignature(snap);
  if (!entering && sig === lastListSig) return;
  lastListSig = sig;

  if (tab === 'history') { keepScroll(() => renderJournal(entering)); return; }
  if (!snap.length) {
    listEl.innerHTML = emptyHtml(tab);
    if (entering) cascade(listEl.children);
    return;
  }

  // Un filtre sur la cote ne voit que les trades évalués : ceux déjà chargés
  // le sont donc tous, pas seulement ceux qui passent à l'écran.
  if (listFilter[tab] !== 'all' && listFilter[tab] !== 'tracked') queueHydrate(tab, snap.map(x => x.tradeId));

  const top = listEl.scrollTop;
  const rows = snap.filter(item => matchesFilter(tab, item)).map(item => rowHtml(tab, item, { entering }));

  listEl.innerHTML = summaryHtml(tab, snap) + chipsHtml(tab, snap)
    + (rows.length ? rows.join('') : `<div class="ls-none">${t('Aucun trade dans cette catégorie.')}</div>`)
    + moreHtml(tab)
    + (tab === 'outbound' ? ghostHtml(ghostTracked()) : '');
  if (top) listEl.scrollTop = top;
  if (entering) cascade(listEl.children, 8);
  bindList();
  watchList();
}

/**
 * Vignette introuvable malgré tous les replis : un emplacement neutre vaut mieux
 * qu'une image cassée — et il garde la forme de l'image qu'il remplace, sinon
 * la ligne saute.
 */
function bindImages(root) {
  root.querySelectorAll('img[src]').forEach(img => {
    img.addEventListener('error', () => {
      const ph = document.createElement('div');
      ph.className = (img.className ? img.className + ' ' : '') + 'ph';
      ph.innerHTML = ic(img.dataset.icon ?? (img.closest('.rec-row') ? 'face' : 'box'));
      ph.title = img.title;
      img.replaceWith(ph);
    }, { once: true });
  });
}

/**
 * Ce qui se cable DANS une carte. Isole de `bindList` pour qu'une carte
 * remplacee seule (voir `patchRows`) retrouve ses gestes sans que la liste
 * entiere soit recablee — ce qui doublerait les ecouteurs des autres cartes.
 */
function bindRow(row) {
  row.querySelectorAll('[data-player]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openPlayer(Number(el.dataset.player));
    });
  });
  row.querySelectorAll('.tc-body[data-zoom]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      openZoom(Number(el.dataset.zoom));
    });
  });
  row.querySelectorAll('button[data-expand]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = Number(el.dataset.expand);
      if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
      renderList();
    });
  });
  row.querySelectorAll('button[data-retry]').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = Number(el.dataset.retry);
      el.textContent = '…';
      failures[tab].delete(id);
      cards[tab].delete(id);
      await queueHydrate(tab, [id]);
    });
  });
  row.querySelectorAll('button[data-nix]').forEach(el => {
    if (Number(el.dataset.nix) === armedNix) {
      el.dataset.armed = '1';
      el.classList.add('armed');
      el.textContent = t('Confirmer ?');
    }
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      quickDecline(el, Number(el.dataset.nix), el.dataset.kind);
    });
  });
  bindTrack(row);
}

/** L'epingle « suivre ce trade », sur une carte ou sur une ligne hors liste. */
function bindTrack(root) {
  root.querySelectorAll('button[data-track]').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = Number(el.dataset.track);
      const on = el.dataset.on === '1';
      const partner = listOf('outbound').find(x => x.tradeId === id)?.partner || null;
      const res = await ask({ type: 'ronote:track', tradeId: id, on, partner });
      // Sans reponse, l'epingle n'a pas bouge cote worker : ne rien ecraser.
      if (!res?.tracked) return;
      data.state.tracked = res.tracked;
      renderHeader();
      renderList();
    });
  });
}

/** Les pastilles de filtre : hors carte, elles survivent a un remplacement. */
/**
 * Les trades suivis absents de la liste. Roblox ne rend que les 100 derniers
 * trades envoyes : un suivi plus ancien n'y figure plus. Le compteur les
 * comptait pourtant, et rien ne les montrait — « 19 trades suivis » sans un
 * seul trade suivi a l'ecran, et aucun moyen de les desepingler.
 */
function ghostTracked() {
  const inList = new Set(listOf('outbound').map(x => x.tradeId));
  return Object.entries(data.state?.tracked || {})
    .map(([id, meta]) => ({ tradeId: Number(id), meta: meta || {} }))
    .filter(g => Number.isFinite(g.tradeId) && !inList.has(g.tradeId))
    .sort((a, b) => (b.meta.at || 0) - (a.meta.at || 0));
}

function ghostHtml(list) {
  if (!list.length) return '';
  const row = (g) => {
    const who = g.meta.partner?.displayName || g.meta.partner?.name || t('joueur inconnu');
    const since = [
      g.meta.at ? t('suivi {ago}', { ago: timeAgo(g.meta.at) }) : '',
      g.meta.auto ? t('suivi automatique') : ''
    ].filter(Boolean).join(' · ');
    return `<div class="jr gh">
      <span class="jr-ic" data-tone="warn">${ic('pin')}</span>
      <span class="jr-m">
        <span class="jr-t">${escapeHtml(who)} <span class="jr-x">#${g.tradeId}</span></span>
        ${since ? `<span class="jr-s">${since}</span>` : ''}
      </span>
      <button class="tc-btn pin on" data-track="${g.tradeId}" data-on="0"
        title="${escapeHtml(t('Ne plus suivre ce trade'))}">${ic('pin')}</button>
    </div>`;
  };
  return `<section class="panel h-panel">
    <div class="panel-h">
      <span>${plural(list.length, '{n} suivi hors liste', '{n} suivis hors liste')}</span>
      <button class="h-link" data-untrack-all>${t('Ne plus les suivre')}</button>
    </div>
    <div class="h-events">${list.map(row).join('')}</div>
    <div class="gh-why">
      ${t("Roblox ne renvoie que les 100 derniers trades envoyés : ceux-là n'y sont plus. RoNote vérifie leur sort toutes les dix minutes et te prévient dès qu'il est connu.")}
      ${list.some(g => g.meta.auto)
        ? ` <button class="h-link" data-settings="s-outbound">${t('Régler le suivi automatique')}</button>` : ''}
    </div>
  </section>`;
}

function bindChips() {
  listEl.querySelectorAll('button[data-lfilter]').forEach(el => {
    el.addEventListener('click', () => {
      listFilter[tab] = el.dataset.lfilter;
      renderList();
    });
  });
}

function bindList() {
  listEl.querySelectorAll('.tc').forEach(bindRow);
  bindImages(listEl);
  bindChips();
  listEl.querySelectorAll('.gh').forEach(bindTrack);
  listEl.querySelectorAll('[data-settings]').forEach(el => el.addEventListener('click', () => {
    B.tabs.create({ url: B.runtime.getURL(`options/options.html#${el.dataset.settings}`) });
  }));
  listEl.querySelector('[data-untrack-all]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const ids = ghostTracked().map(g => g.tradeId);
    if (!ids.length) return;
    btn.disabled = true;
    const res = await ask({ type: 'ronote:track', ids, on: false });
    if (!res?.tracked) { btn.disabled = false; return; }
    data.state.tracked = res.tracked;
    renderHeader();
    renderList();
  });
  listEl.querySelectorAll('button[data-more]').forEach(el => {
    el.addEventListener('click', () => loadMore(el.dataset.more));
  });
}

/**
 * Une carte fraichement evaluee prend la place de sa silhouette, sur place.
 *
 * Reecrire la liste entiere entre chaque lot de six detruisait et rechargeait
 * toutes les vignettes — jusqu'a cinq fois de suite pour vingt-cinq trades —
 * d'ou le clignotement et les sauts pendant le chargement. Rend `false` quand
 * la structure peut avoir bouge : c'est alors au rendu complet de trancher.
 */
function patchRows(kind, ids) {
  if (tab !== kind || zoomed) return false;
  // Sous filtre, une carte evaluee peut entrer ou sortir de la liste : la
  // structure change, le remplacement sur place ne suffit plus.
  if (listFilter[kind] !== 'all') return false;

  const slots = ids
    .map(id => [id, listEl.querySelector(`.tc-skel[data-id="${id}"]`)])
    .filter(([, el]) => el);
  if (!slots.length) return false;

  const snap = listOf(kind);
  for (const [id, slot] of slots) {
    const item = snap.find(x => x.tradeId === id);
    if (!item) return false;
    const tpl = document.createElement('template');
    tpl.innerHTML = rowHtml(kind, item);
    const node = tpl.content.firstElementChild;
    if (!node || node.classList.contains('tc-skel')) continue;   // toujours pas evalue
    slot.replaceWith(node);
    bindRow(node);
    bindImages(node);
  }

  // Le bandeau compte les gagnants, les perdants et le meilleur trade : il
  // suit les cartes. Les pastilles comptent les trades, filtre par filtre.
  const head = listEl.querySelector('section.ls');
  if (head) head.outerHTML = summaryHtml(kind, snap);
  const chips = listEl.querySelector('.lchips');
  if (chips) { chips.outerHTML = chipsHtml(kind, snap); bindChips(); }

  lastListSig = listSignature(snap);
  watchList();
  return true;
}

/* =============================== données ================================ */

const hydrating = new Map();   // liste -> chargement en cours
const hydrateQueue = Object.fromEntries(LIST_KINDS.map(k => [k, new Set()]));
const inflight = new Set();    // `liste:id` dont le détail est déjà demandé

/**
 * Demande le détail de ces trades. Les demandes s'ajoutent à une file que
 * vide un seul chargement par liste, par lots de six, en réaffichant entre
 * chaque : la liste se remplit progressivement au lieu d'attendre le dernier.
 */
function queueHydrate(kind, ids) {
  const q = hydrateQueue[kind];
  if (!q) return Promise.resolve();
  for (const id of ids) {
    if (!cards[kind].has(id) && !failures[kind].has(id) && !inflight.has(kind + ':' + id)) q.add(id);
  }
  if (q.size && !hydrating.has(kind)) {
    hydrating.set(kind, pumpHydrate(kind).finally(() => {
      hydrating.delete(kind);
      if (q.size) queueHydrate(kind, []);
      else if (tab === kind && !zoomed) renderList();   // retire « Évaluation… »
    }));
  }
  return hydrating.get(kind) || Promise.resolve();
}

async function pumpHydrate(kind) {
  const q = hydrateQueue[kind];
  while (q.size) {
    const ids = [...q].slice(0, 6);
    // La v2 du détail ne donne aucune date : la liste les fournit.
    const hints = {};
    for (const id of ids) {
      q.delete(id);
      inflight.add(kind + ':' + id);
      const lite = listOf(kind).find(x => x.tradeId === id);
      if (lite) hints[id] = lite;
    }
    try {
      // Sans reponse — worker endormi, popup en train de se fermer — les
      // trades restaient des silhouettes scintillantes pour toujours, alors
      // que la table des echecs existe justement pour le dire.
      const res = await ask({ type: 'ronote:hydrate', ids, kind, hints });
      if (!res) {
        for (const id of ids) failures[kind].set(id, t('réponse vide'));
      } else {
        for (const c of res.cards || []) cards[kind].set(c.tradeId, c);
        for (const f of res.failed || []) failures[kind].set(f.tradeId, f.error);
        if (res.links) data.state.links = res.links;
        if (res.tracked) data.state.tracked = res.tracked;
      }
    } catch (e) {
      for (const id of ids) failures[kind].set(id, e?.message || t('réponse vide'));
    } finally {
      for (const id of ids) inflight.delete(kind + ':' + id);
    }
    // L'accueil lit aussi les cartes : meilleure offre, offre qui expire.
    if (zoomed) continue;
    if (tab === 'home') renderList();
    else if (tab === kind && !patchRows(kind, ids)) renderList();
  }
}

/** Le relevé de la vérification ; la suite s'évalue en approchant de l'écran. */
function hydrate(kind = tab) {
  return queueHydrate(kind, (data.state?.snapshot?.[kind] || []).map(x => x.tradeId));
}

/** Page suivante d'une liste : un appel, 50 trades. */
async function loadMore(kind) {
  const m = more[kind];
  if (!m || m.loading || !hasMore(kind)) return;
  m.loading = true;
  m.error = '';
  if (tab === kind && !zoomed) renderList();
  try {
    const res = await send({ type: 'ronote:list-more', kind, cursor: m.cursor || '' });
    // « message inconnu » : le service worker tourne encore sur l'ancienne version.
    if (!res || res.error) {
      throw new Error(!res || /message inconnu/.test(res.error) ? t('Recharge RoNote dans chrome://extensions.') : res.error);
    }
    const known = new Set(m.trades.map(x => x.tradeId));
    for (const x of res.trades || []) if (!known.has(x.tradeId)) m.trades.push(x);
    m.cursor = res.cursor || null;
  } catch (e) {
    m.error = String(e?.message || e);
  } finally {
    m.loading = false;
  }
  if (tab === kind && !zoomed) renderList();
}

/** Le bas d'une liste : la suite, qui se charge seule en y arrivant. */
function moreHtml(kind) {
  const m = more[kind];
  if (!m) return '';
  if (!hasMore(kind)) {
    const full = (data.state?.snapshot?.[kind] || []).length >= SNAPSHOT_SIZE;
    return full && m.cursor === null ? `<div class="l-more">${t('Tu es au bout de la liste.')}</div>` : '';
  }
  if (m.loading) return `<div class="l-more">${t('Chargement…')}</div>`;
  if (m.error) {
    return `<div class="l-more err">${escapeHtml(t('Suite indisponible : {why}', { why: m.error }))}
      <button data-more="${kind}">${t('Réessayer')}</button></div>`;
  }
  // Avec un filtre, peu de lignes s'affichent : le bas serait toujours visible
  // et toute la liste se chargerait d'un coup. La suite vient alors au clic.
  const auto = listFilter[kind] === 'all' ? ' data-auto="1"' : '';
  return `<div class="l-more"><button data-more="${kind}"${auto}>${t('Voir les trades plus anciens')}</button></div>`;
}

/**
 * Surveillé au défilement : une silhouette qui approche de l'écran fait
 * évaluer son trade — une page de 50 trades ne coûte pas 50 détails d'un
 * coup — et le bas de la liste fait charger la page suivante.
 */
const listWatch = typeof IntersectionObserver === 'function'
  ? new IntersectionObserver((entries) => {
    const kind = listEl.dataset.tab;
    if (!cards[kind]) return;
    const ids = [];
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      if (e.target.dataset.more) loadMore(kind);
      else ids.push(Number(e.target.dataset.id));
    }
    if (ids.length) queueHydrate(kind, ids);
  }, { root: listEl, rootMargin: '300px 0px' })
  : null;

function watchList() {
  if (!listWatch) return;
  listWatch.disconnect();
  listEl.querySelectorAll('.tc-skel[data-id], .l-more [data-auto]').forEach(el => listWatch.observe(el));
}

/**
 * La liste affichée d'abord, puis les deux autres en arrière-plan : changer
 * d'onglet montre alors des cartes prêtes au lieu de silhouettes.
 */
async function hydrateAll() {
  await hydrate(tab);
  for (const kind of ['inbound', 'outbound', 'completed']) {
    if (kind !== tab) await hydrate(kind);
  }
}


/**
 * La langue du gabarit (voir `common/ui.js`). La pastille des onglets se place
 * une fois la traduction posee : sa largeur depend du texte.
 * @returns false si la page se recharge
 */
const applyLang = () => applyPageLang(data.settings?.lang, moveTabIndicator);

async function load({ refresh = false } = {}) {
  // `lite` : le popup n'affiche pas les compteurs des flux, inutile de relire
  // leurs milliers d'identifiants. La vérification manuelle rend tout d'un coup.
  const res = await send({ type: refresh ? 'ronote:refresh' : 'ronote:get', lite: true });
  if (res?.settings) data.settings = res.settings;
  if (res?.state) data.state = res.state;
  if (res?.history) data.history = res.history;
  if (res?.portfolio) data.portfolio = res.portfolio;
  if (res?.report !== undefined) data.report = res.report;
  if (!applyLang()) return;

  if (refresh) {
    for (const m of Object.values(cards)) m.clear();
    for (const m of Object.values(failures)) m.clear();
    // La suite chargée date d'avant : elle se rechargera en redescendant.
    for (const k of LIST_KINDS) more[k] = freshMore();
  }
  renderHeader();
  renderList();
  hydrateAll();
}

/* ============================== événements ============================== */

/**
 * La pastille de l'onglet actif glisse d'un onglet à l'autre. Première pose
 * sans transition : elle ne doit pas traverser la barre à l'ouverture.
 */
function moveTabIndicator() {
  const ind = document.querySelector('.tab-ind');
  const active = document.querySelector('.tab.active');
  if (!ind || !active) return;
  ind.style.width = active.offsetWidth + 'px';
  ind.style.transform = `translateX(${active.offsetLeft}px)`;
  if (!ind.classList.contains('ready')) requestAnimationFrame(() => ind.classList.add('ready'));
}
document.fonts?.ready?.then(moveTabIndicator);

/**
 * Les fleches parcourent la barre d'onglets : c'est ce qu'un lecteur d'ecran
 * annonce et ce que le clavier attend d'un `role="tablist"`.
 */
document.querySelector('.tabs')?.addEventListener('keydown', (e) => {
  const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
  if (!step) return;
  const tabs = [...document.querySelectorAll('.tab')];
  const at = tabs.indexOf(document.activeElement);
  if (at < 0) return;
  e.preventDefault();
  const next = tabs[(at + step + tabs.length) % tabs.length];
  next.focus();
  next.click();
});

document.querySelectorAll('.tab').forEach(el => {
  el.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => {
      x.classList.remove('active');
      x.setAttribute('aria-selected', 'false');
    });
    el.classList.add('active');
    el.setAttribute('aria-selected', 'true');
    tab = el.dataset.tab;
    moveTabIndicator();
    listEl.scrollTop = 0;
    renderList();
    hydrate();
  });
});

$('#btn-anon').addEventListener('click', toggleAnon);
applyAnon();

$('#btn-refresh').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  if (btn.classList.contains('spin')) return;
  btn.classList.add('spin');
  try { await load({ refresh: true }); } finally { btn.classList.remove('spin'); }
});

$('#btn-toggle').addEventListener('click', async () => {
  const res = await send({ type: 'ronote:settings', patch: { enabled: !data.settings.enabled } });
  data.settings = res.settings;
  renderHeader();
});

$('#btn-options').addEventListener('click', () => B.runtime.openOptionsPage());

load();

/**
 * MISE À JOUR À L'INSTANT, PAS À LA PROCHAINE RELECTURE.
 *
 * Le service worker écrit le journal et l'état dans `storage.local` ; le popup
 * l'apprend par `onChanged` et se redessine aussitôt — un événement notifié
 * apparaît dans le journal en même temps que la notification, pas jusqu'à
 * 30 s plus tard. Les écritures arrivent en rafale à la fin d'un cycle : on
 * les regroupe (200 ms) pour ne redessiner qu'une fois.
 *
 * Les nouvelles valeurs voyagent avec l'événement : on les prend telles
 * quelles. Redemander tout au service worker à chaque vérification relisait
 * aussi les flux et la série complète du portefeuille, toutes les 30 s.
 *
 * Le zoom n'est jamais redessiné sous les doigts : tant qu'il est ouvert, les
 * changements attendent.
 */
const STORED = ['settings', 'state', 'history', 'portfolio', 'portfolioReport'];
const pendingChanges = {};
let refreshTimer = null;

function applyChanges() {
  if (zoomed) { refreshTimer = setTimeout(applyChanges, 1000); return; }
  const got = { ...pendingChanges };
  for (const k of Object.keys(got)) delete pendingChanges[k];
  if ('settings' in got) data.settings = withDefaults(got.settings);
  if ('state' in got) data.state = withStateDefaults(got.state);
  if ('history' in got) data.history = (Array.isArray(got.history) ? got.history : []).slice(0, 100);
  if ('portfolio' in got) data.portfolio = Array.isArray(got.portfolio) ? got.portfolio : [];
  if ('portfolioReport' in got) data.report = got.portfolioReport && typeof got.portfolioReport === 'object' ? got.portfolioReport : null;
  if (!applyLang()) return;
  renderHeader();
  renderList();
  hydrateAll();
}

// Le Lucky Cat change d'exemplaire toutes les quelques heures : lu tout de
// suite, puis redemandé au service worker, qui relit Rolimon's s'il date.
const setLucky = (v) => {
  const next = v?.uaid ? v : null;
  if (next?.uaid === lucky?.uaid) return;
  lucky = next;
  lastListSig = '';
  if (data.settings) renderList();
};
B.storage.local.get('luckyCat').then(got => setLucky(got?.luckyCat)).catch(() => {});
send({ type: 'ronote:lucky-cat' }).then(r => setLucky(r?.luckyCat)).catch(() => {});
onStoredChange(['luckyCat'], 100, (v) => setLucky(v.luckyCat));
const setGoal = (v) => {
  walletGoal = v && typeof v === 'object' ? v : null;
  if (tab === 'stats' && !zoomed) renderList();
  refreshGoalItem();
};
B.storage.local.get('walletGoal').then(got => setGoal(got?.walletGoal)).catch(() => {});
onStoredChange(['walletGoal'], 50, (v) => setGoal(v.walletGoal));

onStoredChange(STORED, 200, (values) => {
  Object.assign(pendingChanges, values);
  applyChanges();
});

// Les « il y a 3 min » avancent seuls : leur texte change, la liste ne se
// redessine pas pour autant.
setInterval(() => {
  for (const el of document.querySelectorAll('[data-ago]')) el.textContent = timeAgo(Number(el.dataset.ago));
  for (const el of document.querySelectorAll('[data-until]')) el.textContent = timeUntil(Number(el.dataset.until));
  if (data.state) renderHeader();
}, 30000);
