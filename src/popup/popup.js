import { B } from '../common/shim.js';
import {
  fmtNum, fmtPct, fmtFull, fmtSigned, fmtDate, timeAgo, timeUntil, toneOf, escapeHtml, clamp
} from '../common/utils.js';
import { DEMAND_LABEL, TREND_LABEL } from '../common/roli.js';
import { t, p as plural, setLang, translateDom, locale } from '../common/i18n.js';

const $ = (s) => document.querySelector(s);
const listEl = $('#list');
const send = (msg) => B.runtime.sendMessage(msg);

let data = { settings: null, state: null, history: [], portfolio: [], report: null };
let tab = 'inbound';
const cards = { inbound: new Map(), outbound: new Map(), completed: new Map() };
const failures = { inbound: new Map(), outbound: new Map(), completed: new Map() };
const expanded = new Set();     // trades dont le detail des objets est deplie
const shownCards = new Set();   // cartes deja montrees evaluees : leur arrivee ne se rejoue pas
let zoomed = null;              // trade (ou objet) affiche en grand, ou null

/** Filtre de chaque liste. Il ne regarde que ce popup : « Tous » à chaque ouverture. */
const listFilter = { inbound: 'all', outbound: 'all', completed: 'all', history: 'all' };

const tradeUrl = (id) => `https://www.roblox.com/trades?tradeId=${id}`;

const KIND_ICON = {
  inbound: '📥', counter: '🔄', completed: '✅', outbound: '📤',
  outbound_accepted: '🎉', outbound_declined: '❌', outbound_countered: '🔄',
  outbound_expired: '⏳', trade_error: '⚠️', declined_by_me: '🚫'
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

/* ================================ entête ================================ */

function renderHeader() {
  const { settings, state } = data;
  $('#acct').textContent = state?.userName ? '@' + state.userName : t('Non connecté');

  const inb = state?.inboundCount || 0;
  $('#cnt-inbound').textContent = inb || '';
  $('#cnt-inbound').classList.toggle('zero', !inb);

  const trackedCount = Object.keys(state?.tracked || {}).length;
  $('#cnt-tracked').textContent = trackedCount || '';
  $('#cnt-tracked').classList.toggle('zero', !trackedCount);

  const btn = $('#btn-toggle');
  btn.textContent = settings?.enabled ? '⏸' : '▶';
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
    cotes.textContent = state.valueStale
      ? '⏳ ' + t('cotes {ago}', { ago })
      : t('{n} cotes · {ago}', { n: fmtNum(state.valueCount), ago });
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

const itemIcon = (i) => (i.isFace ? '🎭' : i.unknown ? '❔' : '▫');

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
const cardTone = (a) => (!a ? 'even' : a.incomplete ? 'unknown' : toneOf(a.pctMain, 3));

const partnerName = (c) => escapeHtml(c.partner?.displayName || c.partner?.name || t('Joueur'));
const partnerHandle = (c) => (c.partner?.name && c.partner.name !== c.partner.displayName
  ? ` <span class="s">@${escapeHtml(c.partner.name)}</span>` : '');
const avatarHtml = (c) => (c.headshot
  ? `<img class="av" src="${escapeHtml(c.headshot)}" alt="" data-icon="">`
  : '<div class="av ph"></div>');

/** Quatre vignettes au plus par côté : au-delà, la dernière devient « +n ». */
function tilesHtml(side) {
  if (!side.items.length) return `<div class="tc-tiles"><div class="tc-tile empty">—</div></div>`;
  const cut = side.items.length > 4 ? 3 : 4;
  const shown = side.items.slice(0, cut).map(i => {
    const cls = itemClasses(i);
    const title = escapeHtml(itemTitle(i));
    const tile = i.thumb
      ? `<img class="tc-tile ${cls}" src="${escapeHtml(i.thumb)}" alt="" title="${title}" data-icon="${itemIcon(i)}">`
      : `<div class="tc-tile ph ${cls}" title="${title}">${itemIcon(i)}</div>`;
    return i.projected ? `<span class="tc-tw">${tile}${projBadge()}</span>` : tile;
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
    chips.push(`<span class="chip mixed" title="${escapeHtml(t("La cote communautaire et les ventes réelles ne vont pas dans le même sens : trancher reviendrait à parier sur l'une des deux."))}">⚖️ ${t('Value {a} vs RAP {b}', { a: fmtPct(a.pctValue), b: fmtPct(a.pctRap) })}</span>`);
  }
  if (a.speculativeIncoming) {
    const worst = a.get.items.filter(i => i.speculative).sort((x, y) => y.ratio - x.ratio)[0];
    chips.push(`<span class="chip spec" title="${escapeHtml(t("Cote très au-dessus des ventes réelles : elle repose sur l'avis de la communauté, pas sur des transactions."))}">📈 ${t('Spéculatif')}${worst?.ratio ? ` ${worst.ratio.toFixed(1)}× RAP` : ''}</span>`);
  }
  if (a.movedItems?.length) {
    const m = a.movedItems[0];
    const all = a.movedItems.map(x => `${x.name} : ${fmtFull(x.moved.from)} → ${fmtFull(x.moved.to)}`).join(' · ');
    chips.push(`<span class="chip moved" title="${escapeHtml(all)}">🔁 ${escapeHtml(m.name)} ${fmtPct(m.moved.pct)}</span>`);
  }
  if (a.faceCount) {
    const names = [...a.give.items, ...a.get.items].filter(i => i.isFace).map(i => i.name).join(' · ');
    chips.push(`<span class="chip face" title="${escapeHtml(names)}">🎭 ${plural(a.faceCount, '{n} visage', '{n} visages')}</span>`);
  }
  if (a.projectedIncoming) {
    chips.push(`<span class="chip proj" title="${escapeHtml(t("Le RAP de cet objet a été gonflé par des rachats entre complices : s'y fier est le piège classique."))}"><i class="proj-ic">${PROJ_ICON}</i> ${t('Projected')}</span>`);
  }
  if (a.robuxTaxed) {
    chips.push(`<span class="chip tax" title="${escapeHtml(t('Roblox prélève 30 % sur les Robux reçus dans un trade. Le total ci-dessus compte le net.'))}">💸 ${t('−{n} R$ de taxe', { n: fmtNum(a.robuxLost) })}</span>`);
  }
  if (a.valueStale) {
    chips.push(`<span class="chip stale" title="${escapeHtml(t("La table Rolimon's n'a pas pu être rafraîchie : les cotes affichées peuvent avoir été révisées depuis."))}">⏳ ${t('Cotes non actualisées')}</span>`);
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
    : `<div class="ph">${itemIcon(i)}</div>`;
  const right = i.unknown
    ? `<b style="color:var(--face)">—</b><span>${t('sans cote')}</span>`
    : `<b>${fmtFull(i.value)}</b><span>RAP ${fmtNum(i.rap)}${i.noValue ? ' · ' + t('pas de value') : ''}</span>`;

  return `<a class="det-row${big ? ' big' : ''}" href="${escapeHtml(itemUrl(i))}" target="_blank" rel="noreferrer" title="${escapeHtml(itemTitle(i))}">
    ${img}
    <div class="det-n"><b>${i.projected ? projBadge() + ' ' : ''}${escapeHtml(i.name)}</b><span>${escapeHtml(itemTags(i))}</span></div>
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
         title="${escapeHtml(t(tracked ? 'Ne plus suivre ce trade' : 'Suivre ce trade (alerte si accepté, refusé ou contré)'))}">📌</button>`
    : '';
  const nix = a && isOpen && tab !== 'completed'
    ? `<button class="tc-btn nix" data-nix="${c.tradeId}" data-kind="${outbound ? 'outbound' : 'inbound'}"
         title="${escapeHtml(t(outbound ? 'Annuler ce trade' : 'Refuser ce trade'))}">✕</button>`
    : '';
  const verdict = a
    ? `<span class="tc-pill ${tone}" title="${escapeHtml(t(c.verdict?.label || ''))}">${c.verdict?.icon || ''} ${a.incomplete ? escapeHtml(t('sans cote')) : fmtPct(a.pctMain)}</span>`
    : '';
  // Pas de numéro de trade ici : ses 16 chiffres mangeaient le statut. Il
  // reste dans le zoom.
  const meta = [
    timeAgo(c.created),
    outbound && c.status && STATUS_LABEL[c.status] ? `<span class="tc-status">${t(STATUS_LABEL[c.status])}</span>` : '',
    tracked ? `<span class="tc-status on">📌 ${t('suivi')}</span>` : ''
  ].filter(Boolean).join(' · ');
  const counter = link
    ? `<div class="tc-link">${t('↩ contre-offre sur le trade #{id}', { id: link.counterTo })}${link.round > 2 ? ' ' + t('· {n}ᵉ échange', { n: link.round }) : ''}</div>`
    : '';

  const head = `<div class="tc-head">
      <span class="av-ring ${tracked ? 'tracked' : tone}">${avatarHtml(c)}</span>
      <div class="who"><div class="n">${partnerName(c)}${partnerHandle(c)}</div><div class="t">${meta}</div></div>
      ${verdict}${nix}${pin}
    </div>`;
  const cls = `tc${enter ? ' tc-enter' : ''}`;

  if (!a) {
    // La raison est affichée EN CLAIR : une erreur planquée dans une infobulle
    // n'aide personne à comprendre ce qui se passe.
    const why = c.error
      ? `<div class="err-box">
           <div class="err-msg">⚠ ${escapeHtml(t('Évaluation impossible — {why}', { why: c.error }))}</div>
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
        <div class="tc-mid">⇄</div>
        ${sideHtml(t(outbound ? 'Vous demandez' : 'Vous recevez'), a.get, a, true)}
      </div>
      ${balanceHtml(a)}
      ${flagsHtml(a)}
    </div>
    ${showDetail && nb
      ? `<button class="tc-more${open ? ' open' : ''}" data-expand="${c.tradeId}"><span>${open ? t('Masquer le détail') : t('Détail des {n} objets', { n: nb })}</span><i>▾</i></button>`
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
  const count = kind === 'inbound' ? (data.state?.inboundCount ?? snap.length) : snap.length;
  const label = { inbound: t('En attente'), outbound: t('Envoyés'), completed: t('Terminés récemment') }[kind];

  let aside = '';
  if (kind === 'completed' && rated.length) {
    const net = rated.reduce((s, c) => s + c.analysis.deltaMain, 0);
    aside = `<div class="ls-aside"><span>${t('Bilan')}</span><b class="${toneOf(net)}">${fmtSigned(net)}</b>
      <small>${plural(rated.length, '{n} trade terminé', '{n} trades terminés')}</small></div>`;
  } else if (kind === 'outbound') {
    const tracked = Object.keys(data.state?.tracked || {}).length;
    aside = `<div class="ls-aside"><span>${t('Suivis')}</span><b class="${tracked ? 'warn' : ''}">${tracked}</b>
      <small>${t('📌 pour être prévenu')}</small></div>`;
  } else {
    const best = [...rated].sort((x, y) => y.analysis.pctMain - x.analysis.pctMain)[0];
    if (best && best.analysis.pctMain > 0) {
      aside = `<div class="ls-aside"><span>${t('Meilleur')}</span><b class="win">${fmtPct(best.analysis.pctMain)}</b>
        <small>${partnerName(best)}</small></div>`;
    }
  }

  const stats = [
    wins ? `<span class="win">▲ ${plural(wins, '{n} gagnant', '{n} gagnants')}</span>` : '',
    losses ? `<span class="loss">▼ ${plural(losses, '{n} perdant', '{n} perdants')}</span>` : '',
    blind ? `<span class="face">❔ ${plural(blind, '{n} sans cote', '{n} sans cote')}</span>` : '',
    loaded.length < snap.length ? `<span>${t('Évaluation…')}</span>` : ''
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
  inbound: ['📥', 'Aucun trade en attente', "Vous serez notifié dès qu'un nouveau trade arrive."],
  outbound: ['📤', 'Aucun trade envoyé', "Vos propositions apparaîtront ici. Épinglez-en une (📌) pour être averti dès qu'elle est acceptée, refusée ou contrée."],
  completed: ['✅', 'Aucun trade terminé récemment', ''],
  history: ['🗒️', 'Journal vide', 'Chaque événement détecté (notifié ou filtré) apparaîtra ici.']
};

function emptyHtml(kind) {
  const [icon, title, text] = EMPTY[kind];
  return `<div class="empty"><div class="empty-ic">${icon}</div><b>${t(title)}</b>${text ? `<span>${t(text)}</span>` : ''}</div>`;
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
        <span class="av-ring ${tone}">${avatarHtml(c)}</span>
        <div class="who"><div class="n">${partnerName(c)}${partnerHandle(c)}</div>
          <div class="t">#${c.tradeId} · ${timeAgo(c.created)}</div></div>
      </div>
      <button class="z-close" title="${t('Fermer')}">✕</button>
    </header>
    <div class="z-body">
      ${a ? `<section class="z-hero" data-tone="${tone}">
        <div class="z-verdict">
          <span class="tc-pill ${tone}">${c.verdict?.icon || ''} ${escapeHtml(t(c.verdict?.label || ''))}</span>
          ${expires ? `<span class="z-exp">⏳ ${t('Expire {ago}', { ago: expires })}</span>` : ''}
        </div>
        ${balanceHtml(a, { big: true })}
      </section>` : `<div class="z-empty">${t('Détail indisponible pour ce trade.')}</div>`}
      ${a ? zoomSideHtml(t(outbound ? 'Vous demandez' : 'Vous recevez'), a.get, a, true) : ''}
      ${a ? zoomSideHtml(t('Vous donnez'), a.give, a, false) : ''}
      ${a ? flagsHtml(a) : ''}
    </div>
    <div class="z-msg" hidden></div>
    <footer class="z-foot">
      <button class="z-open">${t('Ouvrir sur Roblox ↗')}</button>
      ${canDecline ? `<button class="z-decline" data-kind="${kind}">${t(declineLabel)}</button>` : ''}
    </footer>
  </div>`;
}

function onZoomKey(e) {
  if (e.key === 'Escape') closeZoom();
}

function closeZoom() {
  zoomed = null;
  document.getElementById('zoom')?.remove();
  document.removeEventListener('keydown', onZoomKey);
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
  wrap.querySelector('.z-open').addEventListener('click', () => {
    B.tabs.create({ url: hit.card.url || tradeUrl(tradeId) });
  });
  const dec = wrap.querySelector('.z-decline');
  if (dec) dec.addEventListener('click', () => decline(dec, hit.card, dec.dataset.kind, wrap));
  document.addEventListener('keydown', onZoomKey);
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
    partner: card.partner?.displayName || card.partner?.name || ''
  });

  if (res?.ok) {
    for (const m of Object.values(cards)) m.delete(card.tradeId);
    for (const m of Object.values(failures)) m.delete(card.tradeId);
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

/** Annulation depuis la carte : deux clics, le second dans les 5 s. */
let nixTimer = null;
async function quickDecline(btn, tradeId, kind) {
  if (btn.dataset.armed !== '1') {
    btn.dataset.armed = '1';
    btn.classList.add('armed');
    btn.textContent = t('Confirmer ?');
    clearTimeout(nixTimer);
    nixTimer = setTimeout(() => {
      btn.dataset.armed = '0';
      btn.classList.remove('armed');
      btn.textContent = '✕';
    }, 5000);
    return;
  }
  clearTimeout(nixTimer);
  btn.disabled = true;
  btn.textContent = '…';
  const hit = findCard(tradeId);
  const partner = hit?.card?.partner?.displayName || hit?.card?.partner?.name || '';
  const res = await send({ type: 'ronote:decline', tradeId, kind, partner });
  if (res?.ok) {
    for (const m of Object.values(cards)) m.delete(tradeId);
    for (const m of Object.values(failures)) m.delete(tradeId);
    if (res.state) data.state = res.state;
    renderHeader();
    renderList();
    return;
  }
  btn.disabled = false;
  btn.dataset.armed = '0';
  btn.classList.remove('armed');
  btn.textContent = '✕';
  btn.title = t('Échec : {why}', { why: res?.error || '?' });
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
  let icon = KIND_ICON[h.kind] || '•';
  let title, sub = '', pill = '';

  if (h.kind === 'revalued') {
    // Une réévaluation n'est pas un trade : ni partenaire ni numéro, mais un
    // objet, ses deux cotes et l'impact sur le compte.
    icon = h.pct >= 0 ? '📈' : '📉';
    title = `${escapeHtml(h.name)}${h.count > 1 ? ` <span class="jr-x">×${h.count}</span>` : ''}`;
    sub = t('cote {a} → {b} · impact {c}', { a: fmtNum(h.from), b: fmtNum(h.to), c: fmtSigned(h.delta) });
  } else {
    title = `${escapeHtml(h.partner)} <span class="jr-x">#${h.tradeId}</span>`;
    if (h.kind === 'declined_by_me') sub = escapeHtml(t(h.skipped || ''));
    else if (h.skipped) sub = escapeHtml(t('filtré : {why}', { why: t(h.skipped) }));
    else if (h.counterTo) sub = t('↩ réponse au trade #{id}', { id: h.counterTo });
    else if (h.unknown) sub = `<span class="face">❔ ${t('{n} objet(s) sans cote', { n: h.unknown })}</span>`;
    else if (h.get != null && h.give != null) sub = t('{a} reçu vs {b} donné', { a: fmtNum(h.get), b: fmtNum(h.give) });
  }
  if (h.pct != null) pill = `<span class="jr-pill ${toneOf(h.pct, 3)}">${fmtPct(h.pct)}</span>`;

  const url = h.kind !== 'revalued' && h.tradeId ? tradeUrl(h.tradeId) : '';
  const tag = url ? 'button' : 'div';
  const muted = !h.notified && h.kind !== 'revalued' ? ' muted' : '';
  return `<${tag} class="jr${muted}"${url ? ` data-url="${escapeHtml(url)}"` : ''}>
    <span class="jr-ic" data-tone="${info.tone}">${icon}</span>
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
  </section>`;
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
const HERO_LABEL = { v: 'Value réelle', r: 'RAP du compte', n: 'Nombre de collectibles' };

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

const TREND_ICON = ['↘', '↯', '→', '↗', '↕'];
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

function saveWallet() {
  try {
    localStorage.setItem(WALLET_KEY, JSON.stringify(Object.fromEntries(WALLET_PREFS.map(k => [k, wallet[k]]))));
  } catch { /* la préférence dure le temps du popup */ }
}

/**
 * Le mode discret masque les montants, jamais les pourcentages : on garde la
 * tendance sous les yeux sans exposer le solde (partage d'écran, stream).
 */
const amount = (n) => (wallet.hidden ? '••••••' : fmtFull(n));
const amountShort = (n) => (wallet.hidden ? '•••' : fmtNum(n));
const amountSigned = (n, full = false) => (wallet.hidden ? '•••' : fmtSigned(n, full));
const sharePct = (p) => (p >= 10 ? String(Math.round(p)) : p.toFixed(1)) + '%';

const seriesText = (def, n) => (def.money ? amount(n) : fmtFull(n));
const seriesShort = (def, n) => (def.money ? amountShort(n) : fmtNum(n));
const seriesSigned = (def, n) => (def.money ? amountSigned(n, true) : fmtSigned(n, true));
const pillText = (def, delta, pct) =>
  `${delta > 0 ? '▲' : delta < 0 ? '▼' : '•'} ${seriesSigned(def, delta)} · ${fmtPct(pct)}`;

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
  if (REDUCED_MOTION || wallet.hidden || from === to || !Number.isFinite(from)) { el.textContent = format(to); return; }
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
    const low = highest < (tip.offsetHeight + 8) / plot.clientHeight;
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
    ? `<img class="w-img" src="${escapeHtml(i.thumb)}" alt="" loading="lazy">`
    : `<div class="w-img ph">${i.isFace ? '🎭' : '▫'}</div>`;
}

function itemBadges(i) {
  return [
    i.rare ? `<span class="w-tag rare" title="${t('RARE')}">★</span>` : '',
    i.projected ? `<span class="w-tag proj" title="${t('PROJECTED — RAP gonflé artificiellement')}">${PROJ_ICON}</span>` : '',
    i.isFace ? `<span class="w-tag" title="${t('visage (bundle DynamicHead)')}">🎭</span>` : ''
  ].join('');
}

function itemSub(i) {
  return [
    i.acronym ? escapeHtml(i.acronym) : '',
    i.demand >= 0 && DEMAND_LABEL[i.demand] ? t('demande {v}', { v: t(DEMAND_LABEL[i.demand]).toLowerCase() }) : '',
    i.trend >= 0 && TREND_LABEL[i.trend] ? `${TREND_ICON[i.trend]} ${t(TREND_LABEL[i.trend]).toLowerCase()}` : ''
  ].filter(Boolean).join(' · ');
}

function itemRowHtml(i, sum) {
  const ch = i.change;
  const aside = ch
    ? `<span class="${toneOf(ch.pct)}">${ch.pct >= 0 ? '↗' : '↘'} ${fmtPct(ch.pct)}</span>`
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
      <button class="w-view" data-view title="${wallet.view === 'grid' ? t('Vue liste') : t('Vue galerie')}">${wallet.view === 'grid' ? '☰' : '▦'}</button>
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

  const range = ITEM_RANGES.find(r => r.key === sheet.range) || ITEM_RANGES[2];
  const since = range.days ? Date.now() - range.days * 864e5 : 0;
  const pts = downsample(sheet.data.filter(p => p.at >= since));
  const avail = Object.fromEntries(Object.entries(ITEM_SERIES).filter(([k]) => sheet.data.some(p => p[k] > 0)));
  if (!Object.keys(avail).length) {
    box.innerHTML = `<div class="w-none">${escapeHtml(t('Historique indisponible — {why}.', { why: t('réponse vide') }))}</div>`;
    return;
  }
  const keys = orderedSeries(sheet.series, avail);

  box.innerHTML = `
    ${seriesChips(avail, keys, 'data-sseries')}
    ${chartHtml({ id: 'w-sh-plot', pts, keys, defs: ITEM_SERIES, animate, markers: sheet.changes })}
    ${legendHtml(pts, keys, ITEM_SERIES)}
    <div class="w-ranges">${ITEM_RANGES.map(r =>
      `<button class="${r.key === range.key ? 'on' : ''}" data-srange="${r.key}">${t(r.label)}</button>`).join('')}</div>`;
  mountChart({ id: 'w-sh-plot', pts, keys, defs: ITEM_SERIES });

  box.querySelectorAll('[data-sseries]').forEach(el => el.addEventListener('click', () => {
    sheet.series = toggleSeries(keys, el.dataset.sseries, avail);
    renderSheetChart(true);
  }));
  box.querySelectorAll('[data-srange]').forEach(el => el.addEventListener('click', () => {
    sheet.range = el.dataset.srange;
    renderSheetChart(true);
  }));
}

function openItemSheet(key) {
  const items = data.report?.items || [];
  const i = items.find(x => x.key === key);
  if (!i) return;
  const sum = items.reduce((s, x) => s + x.total, 0);
  const roliId = i.kind === 'asset' ? i.id : i.faceAssetId;
  const links = [
    roliId ? { label: "Rolimon's ↗", url: `https://www.rolimons.com/item/${roliId}` } : null,
    { label: 'Roblox ↗', url: i.kind === 'bundle' ? `https://www.roblox.com/bundles/${i.id}` : `https://www.roblox.com/catalog/${i.id}` }
  ].filter(Boolean);
  const ch = i.change;
  const fact = (label, value) => `<div class="w-fact"><span>${label}</span><b>${value}</b></div>`;
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
      <button class="z-close" title="${t('Fermer')}">✕</button>
    </header>
    <div class="z-body">
      <div class="w-sh-amount">${amount(i.total)}</div>
      <div class="w-sh-sub">${i.count > 1 ? t('{n} exemplaires × {v}', { n: i.count, v: amount(i.value) }) : t('1 exemplaire')}${sum ? ' · ' + t('{p} de tes objets cotés', { p: sharePct((i.total / sum) * 100) }) : ''}</div>
      <div class="w-sh-chart" id="w-sh-chart"></div>
      <div class="w-facts">
        ${fact('Value', amount(i.value) + (i.noValue ? ` <small>${t('(RAP faute de cote)')}</small>` : ''))}
        ${fact('RAP', amount(i.rap))}
        ${fact(t('Demande'), i.demand >= 0 && DEMAND_LABEL[i.demand] ? t(DEMAND_LABEL[i.demand]) : '—')}
        ${fact(t('Tendance'), i.trend >= 0 && TREND_LABEL[i.trend] ? `${TREND_ICON[i.trend]} ${t(TREND_LABEL[i.trend])}` : '—')}
      </div>
      ${ch ? `<div class="w-rev ${toneOf(ch.pct)}">${ch.pct >= 0 ? '📈' : '📉'} ${t('Réévalué {ago} : {from} → {to} ({pct})', { ago: timeAgo(ch.at), from: amount(ch.from), to: amount(ch.to), pct: fmtPct(ch.pct) })}</div>` : ''}
      ${i.projected ? `<div class="w-warn"><i class="proj-ic">${PROJ_ICON}</i> ${t('PROJECTED — RAP gonflé artificiellement')}</div>` : ''}
    </div>
    <footer class="z-foot">${links.map(l =>
      `<button class="z-open" data-url="${escapeHtml(l.url)}">${l.label}</button>`).join('')}</footer>
  </div>`;
  document.body.appendChild(wrap);
  bindImages(wrap);
  renderSheetChart();

  wrap.addEventListener('click', (e) => { if (e.target === wrap) closeZoom(); });
  wrap.querySelector('.z-close').addEventListener('click', closeZoom);
  wrap.querySelectorAll('button[data-url]').forEach(b => {
    b.addEventListener('click', () => B.tabs.create({ url: b.dataset.url }));
  });
  document.addEventListener('keydown', onZoomKey);

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

/* ---------------------------- réconciliation ----------------------------- */

let reconOpen = false;

function reconRow(l, sign) {
  const img = l.thumb ? `<img src="${escapeHtml(l.thumb)}" alt="">` : `<div class="ph">🎭</div>`;
  const href = sign < 0 && l.legacyAssetId
    ? `https://www.roblox.com/catalog/${l.legacyAssetId}`
    : `https://www.roblox.com/bundles/${l.bundleId}`;
  const why = sign < 0
    ? t("compté par Rolimon's, plus dans ton inventaire")
    : t("dans ton inventaire, ignoré par Rolimon's");
  return `<a class="rec-row" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">
    ${img}
    <div class="rec-n">${escapeHtml(l.name)}${l.count > 1 ? ` ×${l.count}` : ''}<small>${why}</small></div>
    <div class="rec-v ${sign < 0 ? 'loss' : 'win'}">${sign < 0 ? '−' : '+'}${amount(l.total)}</div>
  </a>`;
}

/** Repliée par défaut : c'est une explication, pas ce qu'on vient regarder. */
function reconciliationHtml(rep) {
  const g = rep?.ghosts || [], e = rep?.extras || [];
  const n = g.length + e.length;
  const body = !n
    ? `<div class="note">${rep?.ok
      ? t("Rien à corriger : ce que Rolimon's compte correspond exactement aux bundles que tu possèdes.")
      : escapeHtml(t('Correction indisponible — {why}.', { why: rep?.reason || t('sources incomplètes') }))}</div>`
    : `<div class="recon-sum">
        <div class="recon-box">
          <div class="l">${t('Retiré')}</div>
          <div class="v loss">−${amount(rep.ghostValue)}</div>
          <div class="n">${plural(g.length, '{n} visage fantôme', '{n} visages fantômes')}</div>
        </div>
        <div class="recon-box">
          <div class="l">${t('Ajouté')}</div>
          <div class="v win">+${amount(rep.extraValue)}</div>
          <div class="n">${plural(e.length, '{n} visage possédé', '{n} visages possédés')}</div>
        </div>
      </div>
      ${g.map(l => reconRow(l, -1)).join('')}
      ${e.map(l => reconRow(l, +1)).join('')}
      <div class="note">${t("Roblox a converti les visages en <b>bundles</b>. Un visage échangé laisse son ancien exemplaire dans l'inventaire — Rolimon's continue de le compter. Un visage reçu arrive en bundle — Rolimon's ne le voit pas. RoNote compare, visage par visage, ce que Rolimon's compte et les bundles que tu possèdes réellement.")}</div>`;
  return `<details class="panel w-fold" id="w-recon"${reconOpen ? ' open' : ''}>
    <summary class="panel-h"><span>${t('Réconciliation des visages')}</span><span>${n ? plural(n, '{n} écart', '{n} écarts') : '✓'}</span></summary>
    ${body}
  </details>`;
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
  const lien = profil ? `<a class="link" href="${profil}" target="_blank" rel="noreferrer">${t("Voir sur Rolimon's ↗")}</a>` : '';

  if (st.portfolioPrivate) {
    listEl.innerHTML = `<div class="empty"><b>${t('Inventaire privé')}</b>
      ${t("Rolimon's ne publie ni value ni RAP pour un inventaire privé. Passe-le en public sur ton profil Roblox pour activer le suivi.")}<br>${lien}</div>`;
    return;
  }

  const all = data.portfolio || [];
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
    rep?.at, rep?.items?.length, all.length, all[all.length - 1]?.at, last?.v, last?.r,
    st.portfolioRank, walletFetching, WALLET_PREFS.map(k => wallet[k]), Math.floor(Date.now() / 60000)
  ]);
  if (listEl.querySelector('.w-hero') && sig === walletSig) return;
  walletSig = sig;

  const range = RANGES.find(r => r.key === wallet.range) || RANGES[1];
  const since = range.days ? Date.now() - range.days * 864e5 : 0;
  const inRange = all.filter(p => p.at >= since);
  const pts = downsample(inRange);
  const keys = wallet.series;
  const primary = keys[0];
  const pdef = WALLET_SERIES[primary];

  // Le relevé du moment prime sur le dernier point historique, et il est
  // CORRIGÉ : c'est la valeur réelle du compte, pas celle de Rolimon's.
  const cur = last || all[all.length - 1] || { v: 0, r: 0 };
  const nowOf = { v: cur.v || 0, r: cur.r || 0, n: all.length ? all[all.length - 1].n || 0 : (st.collectibles || 0) };
  const head = inRange[0] || all[0] || {};
  const now = nowOf[primary];
  const start = Number.isFinite(head[primary]) ? head[primary] : now;
  const delta = now - start;
  const pct = start ? (delta / start) * 100 : 0;
  const tone = toneOf(delta);
  const whenText = t('sur {p}', { p: range.days ? t(range.label) : t("tout l'historique") });

  const corrected = rep?.corrected && (rep.ghosts?.length || rep.extras?.length);
  const gap = corrected ? cur.v - (cur.rawV ?? rep.rolimons?.value ?? cur.v) : 0;
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
        <button class="w-eye" data-eye title="${wallet.hidden ? t('Afficher les montants') : t('Masquer les montants')}">${wallet.hidden ? '🙈' : '👁'}</button>
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
      <div class="w-tile"><span>${t('Rang')}</span><b>${st.portfolioRank ? '#' + fmtFull(st.portfolioRank) : '—'}</b></div>
      <div class="w-tile"><span>${t('Objets')}</span><b>${owned ? fmtFull(owned) : '—'}</b></div>
      <div class="w-tile" title="${escapeHtml(t('Effet des réévaluations Rolimon\'s des 7 derniers jours sur tes objets'))}"><span>${t('Réévalué · 7 j')}</span>
        <b class="${moved.length ? toneOf(movedImpact) : ''}">${moved.length ? amountSigned(movedImpact) : '—'}</b></div>
    </section>
    ${corrected ? `<div class="w-note">${t("Rolimon's affiche {v} — RoNote corrige de {d} pour les visages passés en bundles.", { v: `<b>${amount(cur.rawV ?? rep.rolimons.value)}</b>`, d: `<b class="${toneOf(gap)}">${amountSigned(gap, true)}</b>` })}</div>` : ''}
    ${items ? allocationHtml(items) : ''}
    ${collectionHtml(rep, items, owned)}
    ${reconciliationHtml(rep)}
    <div class="w-foot">
      ${lien}
      <span>${rep?.at ? t('calculé {ago}', { ago: timeAgo(rep.at) }) : ''}</span>
      <button class="w-btn" id="btn-recompute">${walletFetching ? t('Calcul…') : t('Recalculer maintenant')}</button>
    </div>
    <div class="w-note">${t("Courbe telle que Rolimon's la publie (une mesure par jour). Le chiffre du haut, lui, est celui de maintenant, corrigé.")}</div>`;

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
        amountEl.textContent = seriesText(pdef, now);
        pillEl.textContent = pillText(pdef, delta, pct);
        pillEl.className = `w-pill ${tone}`;
        whenEl.textContent = whenText;
        return;
      }
      const base = pts[0][primary] || 0;
      const value = pts[i][primary] || 0;
      amountEl.textContent = seriesText(pdef, value);
      pillEl.textContent = pillText(pdef, value - base, base ? ((value - base) / base) * 100 : 0);
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
  listEl.querySelector('[data-eye]')?.addEventListener('click', () => pref('hidden', !wallet.hidden, null));
  listEl.querySelector('[data-view]')?.addEventListener('click', () => pref('view', wallet.view === 'grid' ? 'list' : 'grid', 'items'));
  listEl.querySelector('#w-sort')?.addEventListener('change', (e) => { wallet.sort = e.target.value; saveWallet(); renderItems({ animate: true }); });
  listEl.querySelector('#w-search')?.addEventListener('input', (e) => { wallet.query = e.target.value; renderItems(); });
  listEl.querySelector('#w-items')?.addEventListener('click', (e) => {
    const row = e.target.closest('[data-item]');
    if (row) openItemSheet(row.dataset.item);
  });
  listEl.querySelector('#w-recon')?.addEventListener('toggle', (e) => { reconOpen = e.target.open; });
  const recompute = listEl.querySelector('#btn-recompute');
  recompute?.addEventListener('click', () => recomputePortfolio(recompute));
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
  const minute = Math.floor(Date.now() / 60000);   // les « il y a 3 min » avancent
  if (tab === 'history') {
    return JSON.stringify([tab, listFilter.history, minute, data.history?.length || 0, data.history?.[0]?.at || 0]);
  }
  return JSON.stringify([
    tab, listFilter[tab], minute, data.settings?.showItemDetails, data.state?.inboundCount,
    Object.keys(data.state?.tracked || {}), Object.keys(data.state?.links || {}).length,
    snap.map(x => [x.tradeId, x.status, cards[tab].has(x.tradeId), failures[tab].get(x.tradeId) || '', expanded.has(x.tradeId)])
  ]);
}

function renderList() {
  const entering = listEl.dataset.tab !== tab;
  listEl.dataset.tab = tab;
  if (tab === 'stats') { lastListSig = ''; keepScroll(renderStats); return; }

  // Le rafraîchissement de fond repasse toutes les 10 à 30 s. Rien de neuf :
  // on garde la liste telle quelle au lieu de recréer cartes et vignettes.
  const snap = data.state?.snapshot?.[tab] || [];
  const sig = listSignature(snap);
  if (!entering && sig === lastListSig) return;
  lastListSig = sig;

  if (tab === 'history') { keepScroll(() => renderJournal(entering)); return; }
  if (!snap.length) {
    listEl.innerHTML = emptyHtml(tab);
    if (entering) cascade(listEl.children);
    return;
  }

  const outbound = tab === 'outbound';
  const top = listEl.scrollTop;
  const rows = snap.filter(item => matchesFilter(tab, item)).map(item => {
    const c = cards[tab].get(item.tradeId);
    if (c) {
      const key = tab + ':' + item.tradeId;
      const enter = !entering && !shownCards.has(key) && !REDUCED_MOTION;
      shownCards.add(key);
      // La fiche vient du cache ; le statut et l'expiration, eux, viennent de la
      // liste, relue à chaque vérification.
      return cardHtml({ ...item, ...c, status: item.status || c.status, expiration: item.expiration || c.expiration },
        { outbound, enter });
    }
    // Détail illisible : on affiche quand même le trade avec ce qu'on sait.
    // Un échec d'évaluation ne doit jamais escamoter une ligne de la liste.
    const err = failures[tab].get(item.tradeId);
    if (err) return cardHtml({ ...item, analysis: null, url: tradeUrl(item.tradeId), error: err }, { outbound });
    return skeletonHtml(item.tradeId);
  });

  listEl.innerHTML = summaryHtml(tab, snap) + chipsHtml(tab, snap)
    + (rows.length ? rows.join('') : `<div class="ls-none">${t('Aucun trade dans cette catégorie.')}</div>`);
  if (top) listEl.scrollTop = top;
  if (entering) cascade(listEl.children, 8);
  bindList();
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
      ph.textContent = img.dataset.icon ?? (img.closest('.rec-row') ? '🎭' : '▫');
      ph.title = img.title;
      img.replaceWith(ph);
    }, { once: true });
  });
}

function bindList() {
  listEl.querySelectorAll('.tc-body[data-zoom]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      openZoom(Number(el.dataset.zoom));
    });
  });
  bindImages(listEl);
  listEl.querySelectorAll('button[data-lfilter]').forEach(el => {
    el.addEventListener('click', () => {
      listFilter[tab] = el.dataset.lfilter;
      renderList();
    });
  });
  listEl.querySelectorAll('button[data-expand]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = Number(el.dataset.expand);
      if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
      renderList();
    });
  });
  listEl.querySelectorAll('button[data-retry]').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = Number(el.dataset.retry);
      el.textContent = '…';
      failures[tab].delete(id);
      cards[tab].delete(id);
      await hydrate();
    });
  });
  listEl.querySelectorAll('button[data-nix]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      quickDecline(el, Number(el.dataset.nix), el.dataset.kind);
    });
  });
  listEl.querySelectorAll('button[data-track]').forEach(el => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = Number(el.dataset.track);
      const on = el.dataset.on === '1';
      const partner = (data.state.snapshot.outbound || []).find(x => x.tradeId === id)?.partner || null;
      const res = await send({ type: 'ronote:track', tradeId: id, on, partner });
      data.state.tracked = res.tracked || {};
      renderHeader();
      renderList();
    });
  });
}

/* =============================== données ================================ */

const hydrating = new Set();   // listes en cours de chargement

/**
 * Charge le détail des trades d'une liste, par lots, en réaffichant entre
 * chaque : la liste se remplit progressivement au lieu d'attendre le dernier.
 */
async function hydrate(kind = tab) {
  if (!cards[kind] || hydrating.has(kind)) return;
  const snap = data.state?.snapshot?.[kind] || [];
  const todo = snap.map(x => x.tradeId)
    .filter(id => !cards[kind].has(id) && !failures[kind].has(id));
  if (!todo.length) return;

  hydrating.add(kind);
  try {
    for (let i = 0; i < todo.length; i += 6) {
      const res = await send({ type: 'ronote:hydrate', ids: todo.slice(i, i + 6), kind });
      for (const c of res?.cards || []) cards[kind].set(c.tradeId, c);
      for (const f of res?.failed || []) failures[kind].set(f.tradeId, f.error);
      if (res?.links) data.state.links = res.links;
      if (res?.tracked) data.state.tracked = res.tracked;
      if (tab === kind && !zoomed) renderList();
    }
  } finally {
    hydrating.delete(kind);
  }
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

let domLang = null;   // langue déjà appliquée au gabarit HTML

async function load({ refresh = false } = {}) {
  const res = await send({ type: refresh ? 'ronote:refresh' : 'ronote:get' });
  if (res?.settings) data.settings = res.settings;
  if (res?.state) data.state = res.state;
  if (res?.history) data.history = res.history;
  if (res?.portfolio) data.portfolio = res.portfolio;
  if (res?.report !== undefined) data.report = res.report;

  // Le gabarit est écrit en français : `translateDom` remplace en place, donc
  // il n'est jouable qu'une fois. Si la langue change en cours de route (réglage
  // modifié dans l'autre onglet), on repart d'une page neuve.
  const lang = setLang(data.settings?.lang);
  if (domLang === null) {
    domLang = lang;
    translateDom(document);
    moveTabIndicator();
  } else if (domLang !== lang) {
    location.reload();
    return;
  }

  if (refresh) {
    const g = await send({ type: 'ronote:get' });
    data.history = g?.history || data.history;
    data.state = g?.state || data.state;
    data.report = g?.report ?? data.report;
    data.portfolio = g?.portfolio || data.portfolio;
    for (const m of Object.values(cards)) m.clear();
    for (const m of Object.values(failures)) m.clear();
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

document.querySelectorAll('.tab').forEach(el => {
  el.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    el.classList.add('active');
    tab = el.dataset.tab;
    moveTabIndicator();
    listEl.scrollTop = 0;
    renderList();
    hydrate();
  });
});

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
 * Le balayage de fond reste, comme filet. Le zoom n'est jamais redessiné sous
 * les doigts : tant qu'il est ouvert, la liste ne bouge pas.
 */
let refreshTimer = null;
function refreshSoon() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { if (!zoomed) load(); }, 200);
}
B.storage?.onChanged?.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.history || changes.state || changes.portfolioReport || changes.settings) refreshSoon();
});
setInterval(() => { if (!zoomed) load(); }, 30000);
