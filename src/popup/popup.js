import { B } from '../common/shim.js';
import {
  fmtNum, fmtPct, fmtFull, fmtSigned, fmtDate, timeAgo, timeUntil, toneOf, escapeHtml, clamp
} from '../common/utils.js';
import { DEMAND_LABEL, TREND_LABEL } from '../common/roli.js';
import { t, p as plural, setLang, translateDom } from '../common/i18n.js';

const $ = (s) => document.querySelector(s);
const listEl = $('#list');
const send = (msg) => B.runtime.sendMessage(msg);

let data = { settings: null, state: null, history: [], portfolio: [], report: null };
let tab = 'inbound';
const cards = { inbound: new Map(), outbound: new Map(), completed: new Map() };
const failures = { inbound: new Map(), outbound: new Map(), completed: new Map() };
const expanded = new Set();     // trades dont le detail des objets est deplie
let zoomed = null;              // tradeId affiche en grand, ou null

const tradeUrl = (id) => `https://www.roblox.com/trades?tradeId=${id}`;

const KIND_ICON = {
  inbound: '📥', counter: '🔄', completed: '✅', outbound: '📤',
  outbound_accepted: '🎉', outbound_declined: '❌', outbound_countered: '🔄',
  outbound_expired: '⏳', trade_error: '⚠️', declined_by_me: '🚫'
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

const MAX_TILES = 7;

function tilesHtml(side) {
  if (!side.items.length) {
    return `<div class="tiles"><div class="tile">—</div></div>`;
  }
  const shown = side.items.slice(0, MAX_TILES).map(i => {
    const cls = itemClasses(i);
    const title = escapeHtml(itemTitle(i));
    return i.thumb
      ? `<img class="${cls}" src="${escapeHtml(i.thumb)}" alt="" title="${title}">`
      : `<div class="tile ${cls}" title="${title}">${itemIcon(i)}</div>`;
  }).join('');
  const rest = side.items.length - MAX_TILES;
  const more = rest > 0
    ? `<div class="tile more" title="${escapeHtml(side.items.slice(MAX_TILES).map(i => i.name).join(', '))}">+${rest}</div>`
    : '';
  return `<div class="tiles">${shown}${more}</div>`;
}

/** Le total d'un côté : la value en clair, le RAP juste dessous en gris. */
function sideTotalHtml(side, a, incoming) {
  const basis = a.basis;
  const main = basis === 'rap' ? side.rap : basis === 'prudent' ? side.prudent : side.value;
  // Un côté dont on ne connaît aucun objet ne vaut pas zéro : il vaut
  // « on ne sait pas ». Afficher 0 serait un mensonge par arrondi.
  const blind = side.itemCount > 0 && side.unknownCount === side.itemCount && !side.robux;
  const sub = [];
  if (a.hasValues && basis !== 'rap') sub.push(`RAP ${fmtNum(side.rap)}`);
  if (a.hasValues && basis === 'rap') sub.push(`Value ${fmtNum(side.value)}`);

  const rbx = side.robux > 0
    ? (incoming && side.robuxNet !== side.robux
      ? `<div class="rbx">R$ ${fmtNum(side.robuxNet)} <s>${t('net de 30 %')}</s></div>`
      : `<div class="rbx">R$ ${fmtNum(side.robux)}</div>`)
    : '';

  const unk = side.unknownCount
    ? `<div class="side-x" title="${escapeHtml((side.unknownItems || []).join(', '))}">${t('+{n} sans cote', { n: side.unknownCount })}</div>`
    : '';

  return `<div class="side-v">${blind ? `<span style="color:var(--face)">—</span>` : fmtFull(main)}</div>
    ${sub.length ? `<div class="side-r">${sub.join(' · ')}</div>` : ''}${rbx}${unk}`;
}

/** La barre de verdict : LE chiffre de la carte. */
function barHtml(a, big = false) {
  const cls = 'bar' + (big ? ' wide' : '');
  if (a.incomplete) {
    return `<div class="${cls} unknown">
      <span class="lbl">${t('Écart')}</span>
      <span class="big" style="color:var(--face)">${t('non calculable')}</span>
      <span class="aside">${plural(a.unknownCount, '{n} objet sans cote', '{n} objets sans cote')}</span>
    </div>`;
  }
  const tone = toneOf(a.pctMain, 3);
  const aside = a.hasValues && a.basis === 'value'
    ? `RAP ${fmtSigned(a.deltaRap)} (${fmtPct(a.pctRap)})`
    : '';
  return `<div class="${cls} ${tone}">
    <span class="lbl">${t(BASIS_SHORT[a.basis] || 'Value')}</span>
    <span class="big ${tone}">${fmtSigned(a.deltaMain, true)}</span>
    <span class="pct ${tone}">${fmtPct(a.pctMain)}</span>
    ${aside ? `<span class="aside">${aside}</span>` : ''}
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
    chips.push(`<span class="chip proj" title="${escapeHtml(t("Le RAP de cet objet a été gonflé par des rachats entre complices : s'y fier est le piège classique."))}">⚠ ${t('Projected')}</span>`);
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
    ? `<img src="${escapeHtml(i.thumb)}" alt="">`
    : `<div class="ph">${itemIcon(i)}</div>`;
  const right = i.unknown
    ? `<b style="color:var(--face)">—</b><span>${t('sans cote')}</span>`
    : `<b>${fmtFull(i.value)}</b><span>RAP ${fmtNum(i.rap)}${i.noValue ? ' · ' + t('pas de value') : ''}</span>`;

  return `<a class="det-row${big ? ' big' : ''}" href="${escapeHtml(itemUrl(i))}" target="_blank" rel="noreferrer" title="${escapeHtml(itemTitle(i))}">
    ${img}
    <div class="det-n"><b>${escapeHtml(i.name)}</b><span>${escapeHtml(itemTags(i))}</span></div>
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

const partnerName = (c) => escapeHtml(c.partner?.displayName || c.partner?.name || t('Joueur'));

function headHtml(c) {
  const uname = c.partner?.name && c.partner.name !== c.partner.displayName
    ? ` <span class="s">@${escapeHtml(c.partner.name)}</span>` : '';
  const av = c.headshot ? `<img class="av" src="${escapeHtml(c.headshot)}" alt="">` : '<div class="av"></div>';
  return `<div class="head">${av}
    <div class="who"><div class="n">${partnerName(c)}${uname}</div>
      <div class="t">#${c.tradeId} · ${timeAgo(c.created)}</div></div>`;
}

function cardHtml(c, { outbound = false } = {}) {
  const a = c.analysis;
  const link = data.state?.links?.[c.tradeId];
  const chip = link
    ? `<div class="chip-link">${t('↩ contre-offre sur le trade #{id}', { id: link.counterTo })}${link.round > 2 ? ' ' + t('· {n}ᵉ échange', { n: link.round }) : ''}</div>`
    : '';

  const tracked = !!data.state?.tracked?.[c.tradeId];
  const pin = outbound
    ? `<button class="pin ${tracked ? 'on' : ''}" data-track="${c.tradeId}" data-on="${tracked ? '0' : '1'}"
         title="${escapeHtml(t(tracked ? 'Ne plus suivre ce trade' : 'Suivre ce trade (alerte si accepté, refusé ou contré)'))}">📌</button>`
    : '';

  const status = outbound && c.status && STATUS_LABEL[c.status]
    ? `<span class="badge">${t(STATUS_LABEL[c.status])}</span>` : '';

  const isOpen = !c.status || c.status === 'Open' || c.status === 'Unknown' || c.status === 'Pending';
  const nix = a && isOpen && tab !== 'completed'
    ? `<button class="nix" data-nix="${c.tradeId}" data-kind="${outbound ? 'outbound' : 'inbound'}"
         title="${escapeHtml(t(outbound ? 'Annuler ce trade' : 'Refuser ce trade'))}">✕</button>`
    : '';

  if (!a) {
    // La raison est affichée EN CLAIR : une erreur planquée dans une infobulle
    // n'aide personne à comprendre ce qui se passe.
    const why = c.error
      ? `<div class="err-box">
           <div class="err-msg">⚠ ${escapeHtml(t('Évaluation impossible — {why}', { why: c.error }))}</div>
           <button class="err-retry" data-retry="${c.tradeId}">${t('Réessayer')}</button>
         </div>`
      : '';
    return `<article class="card ${tracked ? 'tracked' : 'even'}">
      <div class="body" data-zoom="${c.tradeId}">
        ${headHtml(c)}${status}${pin}</div>${chip}${why}
      </div></article>`;
  }

  const tone = a.incomplete ? 'unknown' : toneOf(a.pctMain, 3);
  const open = expanded.has(c.tradeId);
  const showDetail = data.settings?.showItemDetails !== false;
  const nb = a.give.items.length + a.get.items.length;

  return `<article class="card ${tracked ? 'tracked' : tone}">
    <div class="body" data-zoom="${c.tradeId}">
      ${headHtml(c)}
      ${status || `<span class="badge ${tone}" title="${escapeHtml(t(c.verdict?.label || ''))}">${c.verdict?.icon || ''} ${a.incomplete ? escapeHtml(t('sans cote')) : fmtPct(a.pctMain)}</span>`}
      ${nix}${pin}</div>
      ${chip}
      <div class="swap">
        <div class="side give">
          <div class="side-h">${t('Vous donnez')}</div>
          ${tilesHtml(a.give)}
          ${sideTotalHtml(a.give, a, false)}
        </div>
        <div class="swap-mid">⇄</div>
        <div class="side get">
          <div class="side-h">${t(outbound ? 'Vous demandez' : 'Vous recevez')}</div>
          ${tilesHtml(a.get)}
          ${sideTotalHtml(a.get, a, true)}
        </div>
      </div>
      ${barHtml(a)}
      ${flagsHtml(a)}
    </div>
    ${showDetail && nb
      ? `<button class="more-btn" data-expand="${c.tradeId}">${open ? '▲ ' + t('Masquer le détail') : '▼ ' + t('Détail des {n} objets', { n: nb })}</button>`
      : ''}
    ${showDetail && open ? detailHtml(a, outbound) : ''}
  </article>`;
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
  const basis = a.basis;
  const main = basis === 'rap' ? side.rap : basis === 'prudent' ? side.prudent : side.value;
  const blind = side.itemCount > 0 && side.unknownCount === side.itemCount && !side.robux;
  const rbx = side.robux > 0
    ? `<div class="z-rbx">R$ ${fmtNum(incoming ? side.robuxNet : side.robux)}${incoming && side.robuxNet !== side.robux ? ` <s>${t('net de 30 %')}</s>` : ''}</div>`
    : '';
  return `<section class="z-side">
    <div class="z-side-h">
      <span>${title}</span>
      <span class="z-tot">${blind ? '—' : fmtFull(main)}<small>RAP ${fmtNum(side.rap)}</small></span>
    </div>
    ${side.items.map(i => detailRow(i, true)).join('') || `<div class="z-empty">—</div>`}
    ${rbx}
  </section>`;
}

function zoomHtml(c, kind) {
  const a = c.analysis;
  const outbound = kind === 'outbound';
  const tone = a?.incomplete ? 'unknown' : a ? toneOf(a.pctMain, 3) : 'even';
  const expires = c.expiration ? timeUntil(c.expiration) : '';

  // Refuser un trade reçu et annuler un trade envoyé sont le MÊME appel côté
  // Roblox. Le libellé change, l'action non — et elle est définitive, d'où la
  // confirmation en deux temps portée par le bouton lui-même.
  const canDecline = !!a && (kind === 'outbound' || kind === 'inbound')
    && (!c.status || c.status === 'Open' || c.status === 'Unknown');
  const declineLabel = outbound ? 'Annuler le trade' : 'Refuser le trade';

  return `<div class="zoom-card" role="dialog" aria-modal="true">
    <header class="z-head">
      ${headHtml(c)}
      ${a ? `<span class="badge ${tone}">${c.verdict?.icon || ''} ${escapeHtml(t(c.verdict?.label || ''))}</span>` : ''}
      <button class="z-close" title="${t('Fermer')}">✕</button>
    </header>
    <div class="z-body">
      ${a ? barHtml(a, true) : ''}
      ${expires ? `<div class="z-exp">⏳ ${t('Expire {ago}', { ago: expires })}</div>` : ''}
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

function historyHtml(h) {
  // Une reevaluation n'est pas un trade : ni partenaire ni numero, mais un
  // objet, ses deux cotes et l'impact sur le compte.
  if (h.kind === 'revalued') {
    return `<div class="log">
    <span class="k">${h.pct >= 0 ? '📈' : '📉'}</span>
    <span class="m"><span class="p">${escapeHtml(h.name)}</span>${h.count > 1 ? ` <span class="s">×${h.count}</span>` : ''} <span class="${toneOf(h.pct, 3)}">${fmtPct(h.pct)}</span>
      <div class="s">${t('cote {a} → {b} · impact {c}', { a: fmtNum(h.from), b: fmtNum(h.to), c: fmtSigned(h.delta) })}</div></span>
    <span class="s">${timeAgo(h.at)}</span>
  </div>`;
  }
  const icon = KIND_ICON[h.kind] || '•';
  const pct = (h.pct === null || h.pct === undefined) ? ''
    : ` <span class="${toneOf(h.pct, 3)}">${fmtPct(h.pct)}</span>`;
  const nums = (h.get !== null && h.get !== undefined && h.give !== null && h.give !== undefined)
    ? `<div class="s">${t('{a} reçu vs {b} donné', { a: fmtNum(h.get), b: fmtNum(h.give) })}</div>` : '';
  const unk = h.unknown
    ? `<div class="s" style="color:var(--face)">❔ ${t('{n} objet(s) sans cote', { n: h.unknown })}</div>`
    : nums;
  const link = h.counterTo ? `<div class="s">${t('↩ réponse au trade #{id}', { id: h.counterTo })}</div>` : unk;
  return `<div class="log ${h.notified ? '' : 'muted'}">
    <span class="k">${icon}</span>
    <span class="m"><span class="p">${escapeHtml(h.partner)}</span> <span class="s">#${h.tradeId}</span>${pct}
      ${h.skipped ? `<div class="s">${escapeHtml(t('filtré : {why}', { why: t(h.skipped) }))}</div>` : link}</span>
    <span class="s">${timeAgo(h.at)}</span>
  </div>`;
}

const EMPTY = () => ({
  inbound: `<b>${t('Aucun trade en attente')}</b>${t("Vous serez notifié dès qu'un nouveau trade arrive.")}`,
  outbound: `<b>${t('Aucun trade envoyé')}</b>${t("Vos propositions apparaîtront ici. Épinglez-en une (📌) pour être averti dès qu'elle est acceptée, refusée ou contrée.")}`,
  completed: `<b>${t('Aucun trade terminé récemment')}</b>`
});

/* ============================= portefeuille ============================= */

const RANGES = [
  { key: '1w', label: '1s', days: 7 },
  { key: '1m', label: '1m', days: 30 },
  { key: '3m', label: '3m', days: 90 },
  { key: '6m', label: '6m', days: 182 },
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

/**
 * Préférences d'affichage du portefeuille. Elles ne regardent que ce popup :
 * localStorage suffit. Stockage bloqué ou vidé, on repart des valeurs par
 * défaut sans rien casser. La recherche, elle, ne survit pas à la fermeture.
 */
const WALLET_KEY = 'ronote:wallet';
const WALLET_PREFS = ['range', 'metric', 'hidden', 'view', 'sort', 'filter'];
const wallet = { range: '1m', metric: 'v', hidden: false, view: 'list', sort: 'value', filter: 'all', query: '' };
try {
  const saved = JSON.parse(localStorage.getItem(WALLET_KEY) || '{}');
  for (const k of WALLET_PREFS) if (k in saved) wallet[k] = saved[k];
} catch { /* valeurs par défaut */ }

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
const pillText = (delta, pct) => `${delta > 0 ? '▲' : delta < 0 ? '▼' : '•'} ${amountSigned(delta, true)} · ${fmtPct(pct)}`;

/* ------------------------------ le graphique ----------------------------- */

const CHART = { W: 400, H: 120, PT: 12, PB: 6, MAX: 180 };

/** Au-delà de ~180 points la courbe n'y gagne rien : on échantillonne, premier et dernier compris. */
function downsample(pts) {
  if (pts.length <= CHART.MAX) return pts;
  const step = (pts.length - 1) / (CHART.MAX - 1);
  return Array.from({ length: CHART.MAX }, (_, i) => pts[Math.round(i * step)]);
}

/** Hauteur d'un relevé, en fraction de la hauteur du graphique (0 = en haut). */
const chartY = (v, min, span) =>
  (CHART.PT + (1 - (v - min) / span) * (CHART.H - CHART.PT - CHART.PB)) / CHART.H;

/** Une seule série, lissée, remplie d'un dégradé à la couleur de la tendance. */
function walletChart(pts, key, tone) {
  const vals = pts.map(p => p[key]);
  const min = Math.min(...vals);
  const span = (Math.max(...vals) - min) || 1;
  const xy = pts.map((p, i) => [(i / (pts.length - 1)) * CHART.W, chartY(p[key], min, span) * CHART.H]);
  const f = (n) => n.toFixed(1);

  // Catmull-Rom converti en Bézier : la courbe passe par chaque relevé, sans angle.
  let d = `M${f(xy[0][0])},${f(xy[0][1])}`;
  for (let i = 0; i < xy.length - 1; i++) {
    const p0 = xy[i - 1] || xy[i], p1 = xy[i], p2 = xy[i + 1], p3 = xy[i + 2] || xy[i + 1];
    d += `C${f(p1[0] + (p2[0] - p0[0]) / 6)},${f(p1[1] + (p2[1] - p0[1]) / 6)} `
      + `${f(p2[0] - (p3[0] - p1[0]) / 6)},${f(p2[1] - (p3[1] - p1[1]) / 6)} ${f(p2[0])},${f(p2[1])}`;
  }
  const color = tone === 'loss' ? '#ff5f66' : tone === 'win' ? '#2fd070' : '#4d9fff';
  return `<svg class="w-chart" viewBox="0 0 ${CHART.W} ${CHART.H}" preserveAspectRatio="none" aria-hidden="true">
    <defs><linearGradient id="wg" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity=".32"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <path d="${d}L${CHART.W},${CHART.H}L0,${CHART.H}Z" fill="url(#wg)"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

/**
 * Survol du graphique : le solde affiché devient celui du jour pointé, comme
 * dans une appli de portefeuille. Hors du graphique, tout revient au présent.
 */
function bindChart(pts, key) {
  const plot = document.getElementById('w-plot');
  if (!plot) return;
  const cursor = plot.querySelector('.w-cursor');
  const dot = plot.querySelector('.w-dot');
  const amountEl = document.getElementById('w-amount');
  const pillEl = document.getElementById('w-pill');
  const whenEl = document.getElementById('w-when');
  const present = { amount: amountEl.textContent, pill: pillEl.textContent, cls: pillEl.className, when: whenEl.textContent };
  const vals = pts.map(p => p[key]);
  const min = Math.min(...vals);
  const span = (Math.max(...vals) - min) || 1;
  const base = pts[0][key];

  plot.addEventListener('pointermove', (e) => {
    const box = plot.getBoundingClientRect();
    const idx = Math.round(clamp((e.clientX - box.left) / box.width, 0, 1) * (pts.length - 1));
    const p = pts[idx];
    const delta = p[key] - base;
    cursor.hidden = dot.hidden = false;
    cursor.style.left = dot.style.left = (idx / (pts.length - 1)) * 100 + '%';
    dot.style.top = chartY(p[key], min, span) * 100 + '%';
    amountEl.textContent = amount(p[key]);
    pillEl.textContent = pillText(delta, base ? (delta / base) * 100 : 0);
    pillEl.className = 'w-pill ' + toneOf(delta);
    whenEl.textContent = fmtDate(p.at);
  });
  plot.addEventListener('pointerleave', () => {
    cursor.hidden = dot.hidden = true;
    amountEl.textContent = present.amount;
    pillEl.textContent = present.pill;
    pillEl.className = present.cls;
    whenEl.textContent = present.when;
  });
}

/* -------------------------------- le solde ------------------------------- */

function heroHtml({ key, now, delta, pct, pts, range }) {
  const tone = toneOf(delta);
  return `<section class="w-hero" data-tone="${tone}">
    <div class="w-top">
      <div class="w-seg">
        <button class="${key === 'v' ? 'on' : ''}" data-metric="v">Value</button>
        <button class="${key === 'r' ? 'on' : ''}" data-metric="r">RAP</button>
      </div>
      <button class="w-eye" data-eye title="${wallet.hidden ? t('Afficher les montants') : t('Masquer les montants')}">${wallet.hidden ? '🙈' : '👁'}</button>
    </div>
    <div class="w-label">${key === 'v' ? t('Value réelle') : t('RAP du compte')}</div>
    <div class="w-amount" id="w-amount">${amount(now)}</div>
    <div class="w-change">
      <span class="w-pill ${tone}" id="w-pill">${pillText(delta, pct)}</span>
      <span class="w-when" id="w-when">${t('sur {p}', { p: range.days ? t(range.label) : t("tout l'historique") })}</span>
    </div>
    ${pts.length > 1
      ? `<div class="w-plot" id="w-plot">${walletChart(pts, key, tone)}<div class="w-cursor" hidden></div><div class="w-dot" hidden></div></div>`
      : `<div class="w-nochart">${t('Pas encore assez de points sur cette période.')}</div>`}
    <div class="w-ranges">${RANGES.map(r =>
      `<button class="${r.key === range.key ? 'on' : ''}" data-range="${r.key}">${t(r.label)}</button>`).join('')}</div>
  </section>`;
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
    i.projected ? `<span class="w-tag proj" title="${t('PROJECTED — RAP gonflé artificiellement')}">⚠</span>` : '',
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
function renderItems() {
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
      <div class="w-facts">
        ${fact('Value', amount(i.value) + (i.noValue ? ` <small>${t('(RAP faute de cote)')}</small>` : ''))}
        ${fact('RAP', amount(i.rap))}
        ${fact(t('Demande'), i.demand >= 0 && DEMAND_LABEL[i.demand] ? t(DEMAND_LABEL[i.demand]) : '—')}
        ${fact(t('Tendance'), i.trend >= 0 && TREND_LABEL[i.trend] ? `${TREND_ICON[i.trend]} ${t(TREND_LABEL[i.trend])}` : '—')}
      </div>
      ${ch ? `<div class="w-rev ${toneOf(ch.pct)}">${ch.pct >= 0 ? '📈' : '📉'} ${t('Réévalué {ago} : {from} → {to} ({pct})', { ago: timeAgo(ch.at), from: amount(ch.from), to: amount(ch.to), pct: fmtPct(ch.pct) })}</div>` : ''}
      ${i.projected ? `<div class="w-warn">⚠ ${t('PROJECTED — RAP gonflé artificiellement')}</div>` : ''}
    </div>
    <footer class="z-foot">${links.map(l =>
      `<button class="z-open" data-url="${escapeHtml(l.url)}">${l.label}</button>`).join('')}</footer>
  </div>`;
  document.body.appendChild(wrap);
  bindImages(wrap);

  wrap.addEventListener('click', (e) => { if (e.target === wrap) closeZoom(); });
  wrap.querySelector('.z-close').addEventListener('click', closeZoom);
  wrap.querySelectorAll('button[data-url]').forEach(b => {
    b.addEventListener('click', () => B.tabs.create({ url: b.dataset.url }));
  });
  document.addEventListener('keydown', onZoomKey);
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

  const range = RANGES.find(r => r.key === wallet.range) || RANGES[1];
  const since = range.days ? Date.now() - range.days * 864e5 : 0;
  const key = wallet.metric === 'r' ? 'r' : 'v';
  const inRange = all.filter(p => p.at >= since);
  const pts = downsample(inRange);

  // Le relevé du moment prime sur le dernier point historique, et il est
  // CORRIGÉ : c'est la valeur réelle du compte, pas celle de Rolimon's.
  const cur = last || all[all.length - 1] || { v: 0, r: 0 };
  const head = inRange[0] || all[0];
  const now = cur[key] || 0;
  const delta = head ? now - head[key] : 0;
  const pct = head && head[key] ? (delta / head[key]) * 100 : 0;

  const corrected = rep?.corrected && (rep.ghosts?.length || rep.extras?.length);
  const gap = corrected ? cur.v - (cur.rawV ?? rep.rolimons?.value ?? cur.v) : 0;
  const moved = (items || []).filter(i => i.change);
  const movedImpact = moved.reduce((s, i) => s + (i.change.to - i.change.from) * i.count, 0);
  const owned = items ? items.reduce((s, i) => s + i.count, 0) + (rep.unrated || 0) : (st.collectibles || 0);

  // Un redessin de fond ne doit pas voler le curseur de la recherche.
  const search = document.activeElement?.id === 'w-search' ? document.activeElement : null;
  const caret = search ? [search.selectionStart, search.selectionEnd] : null;

  listEl.innerHTML = `
    ${heroHtml({ key, now, delta, pct, pts, range })}
    <section class="w-tiles">
      <div class="w-tile"><span>${key === 'v' ? 'RAP' : 'Value'}</span><b>${amountShort(cur[key === 'v' ? 'r' : 'v'])}</b></div>
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
  renderItems();
  bindChart(pts, key);
  if (caret) {
    const s = document.getElementById('w-search');
    s?.focus();
    s?.setSelectionRange(...caret);
  }

  const redraw = () => keepScroll(renderStats);
  const pref = (k, v) => { wallet[k] = v; saveWallet(); redraw(); };
  listEl.querySelectorAll('[data-metric]').forEach(el => el.addEventListener('click', () => pref('metric', el.dataset.metric)));
  listEl.querySelectorAll('[data-range]').forEach(el => el.addEventListener('click', () => pref('range', el.dataset.range)));
  listEl.querySelectorAll('[data-filter]').forEach(el => el.addEventListener('click', () => pref('filter', el.dataset.filter)));
  listEl.querySelector('[data-eye]')?.addEventListener('click', () => pref('hidden', !wallet.hidden));
  listEl.querySelector('[data-view]')?.addEventListener('click', () => pref('view', wallet.view === 'grid' ? 'list' : 'grid'));
  listEl.querySelector('#w-sort')?.addEventListener('change', (e) => { wallet.sort = e.target.value; saveWallet(); renderItems(); });
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
 * Le rafraîchissement de fond redessine la liste toutes les 15 s. Sans ça, le
 * défilement remonterait en haut au milieu d'une lecture.
 */
function keepScroll(draw) {
  const top = listEl.scrollTop;
  draw();
  if (top) listEl.scrollTop = top;
}

function renderList() {
  if (tab === 'stats') { keepScroll(renderStats); return; }
  if (tab === 'history') {
    keepScroll(() => {
      listEl.innerHTML = data.history?.length
        ? data.history.map(historyHtml).join('')
        : `<div class="empty"><b>${t('Journal vide')}</b>${t('Chaque événement détecté (notifié ou filtré) apparaîtra ici.')}</div>`;
    });
    return;
  }

  const snap = data.state?.snapshot?.[tab] || [];
  if (!snap.length) {
    listEl.innerHTML = `<div class="empty">${EMPTY()[tab]}</div>`;
    return;
  }

  const outbound = tab === 'outbound';
  const top = listEl.scrollTop;
  listEl.innerHTML = snap.map(item => {
    const c = cards[tab].get(item.tradeId);
    if (c) return cardHtml({ ...item, ...c }, { outbound });
    // Détail illisible : on affiche quand même le trade avec ce qu'on sait.
    // Un échec d'évaluation ne doit jamais escamoter une ligne de la liste.
    const err = failures[tab].get(item.tradeId);
    if (err) return cardHtml({ ...item, analysis: null, url: tradeUrl(item.tradeId), error: err }, { outbound });
    return `<div class="skeleton" data-id="${item.tradeId}"></div>`;
  }).join('');

  if (top) listEl.scrollTop = top;
  bindList();
}

/**
 * Vignette introuvable malgré tous les replis : un emplacement neutre vaut mieux
 * qu'une image cassée — et il doit avoir la taille de l'emplacement qu'il
 * remplace, sinon la ligne saute.
 */
function bindImages(root) {
  root.querySelectorAll('img[src]').forEach(img => {
    img.addEventListener('error', () => {
      const ph = document.createElement('div');
      if (img.classList.contains('av')) ph.className = 'av';
      else if (img.classList.contains('w-img')) {
        ph.className = 'w-img ph';
        ph.textContent = '▫';
      } else if (img.closest('.det-row') || img.closest('.rec-row')) {
        ph.className = 'ph';
        ph.textContent = '🎭';
      } else {
        ph.className = 'tile';
        ph.textContent = '▫';
      }
      ph.title = img.title;
      img.replaceWith(ph);
    }, { once: true });
  });
}

function bindList() {
  listEl.querySelectorAll('.body[data-zoom]').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      openZoom(Number(el.dataset.zoom));
    });
  });
  bindImages(listEl);
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

let hydrating = false;

/**
 * Charge le détail des trades visibles, par lots, en réaffichant entre chaque :
 * la liste se remplit progressivement au lieu d'attendre le dernier.
 */
async function hydrate() {
  if (tab === 'history' || tab === 'stats' || hydrating) return;
  const current = tab;
  const snap = data.state?.snapshot?.[current] || [];
  const todo = snap.map(x => x.tradeId)
    .filter(id => !cards[current].has(id) && !failures[current].has(id));
  if (!todo.length) return;

  hydrating = true;
  try {
    for (let i = 0; i < todo.length; i += 6) {
      if (tab !== current) break;                 // l'utilisateur a changé d'onglet
      const res = await send({ type: 'ronote:hydrate', ids: todo.slice(i, i + 6), kind: current });
      for (const c of res?.cards || []) cards[current].set(c.tradeId, c);
      for (const f of res?.failed || []) failures[current].set(f.tradeId, f.error);
      if (res?.links) data.state.links = res.links;
      if (res?.tracked) data.state.tracked = res.tracked;
      if (tab === current) renderList();
    }
  } finally {
    hydrating = false;
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
  hydrate();
}

/* ============================== événements ============================== */

document.querySelectorAll('.tab').forEach(el => {
  el.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
    el.classList.add('active');
    tab = el.dataset.tab;
    listEl.scrollTop = 0;
    renderList();
    hydrate();
  });
});

$('#btn-refresh').addEventListener('click', async (e) => {
  e.target.textContent = '…';
  await load({ refresh: true });
  e.target.textContent = '⟳';
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
 * 15 s plus tard. Les écritures arrivent en rafale à la fin d'un cycle : on
 * les regroupe (200 ms) pour ne redessiner qu'une fois.
 *
 * Le balayage de fond reste, comme filet, deux fois moins souvent qu'avant.
 * Le zoom n'est jamais redessiné sous les doigts : tant qu'il est ouvert, la
 * liste ne bouge pas.
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
