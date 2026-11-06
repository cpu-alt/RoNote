/**
 * ==========================================================================
 *  LA CONTRE-OFFRE, DANS LE POPUP
 * --------------------------------------------------------------------------
 *  Un trade reçu s'ouvre ici comme sur roblox.com : ce que tu donnes, ce que
 *  tu demandes, et les deux inventaires pour composer. Chaque objet ajouté ou
 *  retiré recalcule l'écart avec les mêmes règles qu'une carte (base de
 *  cote, Robux reçus nets de la taxe) : on SIMULE la contre-offre avant de
 *  l'envoyer. L'envoi se confirme en deux clics, comme Accepter.
 *
 *  Les inventaires viennent de Roblox (exemplaires, série, hold) via le
 *  service worker, qui les cote et les illustre. Roblox limite chaque côté à
 *  quatre objets ; le reste (hold, Robux au-delà de la limite), c'est lui qui
 *  le refuse, et son message s'affiche tel quel.
 * ==========================================================================
 */
import { B } from '../common/shim.js';
import { fmtNum, fmtFull, escapeHtml } from '../common/utils.js';
import { t } from '../common/i18n.js';
import { ic } from '../common/icons.js';
import { send } from '../common/ui.js';
import { openOverlay, releaseFocus } from './overlay.js';
import { adopt } from '../common/counter-match.js';

const MAX_ITEMS = 4;              // par côté, limite de Roblox
const ROBUX_TAX = 0.3;            // comme analysis.js : les Robux reçus arrivent nets
const BASIS_FIELD = { value: 'value', rap: 'rap', prudent: 'prudent' };

const tradeUrl = (id) => `https://www.roblox.com/trades?tradeId=${id}`;
const pctOf = (from, to) => (from > 0 ? ((to - from) / from) * 100 : (to > 0 ? 100 : 0));

let ed = null;   // l'éditeur ouvert, ou null

/**
 * @param card  la carte du trade reçu (analysis.give / analysis.get, partner)
 * @param deps  { settings, balanceHtml(a, opts), avatarHtml(card), onSent(res) }
 */
export function openCounterEditor(card, deps) {
  const a = card.analysis;
  const pick = (items) => (items || []).map(i => ({ ...i, uaid: Number(i.uaid) || i.uaid }));
  ed = {
    card, deps,
    give: pick(a?.give?.items), get: pick(a?.get?.items),
    giveRobux: a?.give?.robux || 0, getRobux: a?.get?.robux || 0,
    me: null, them: null, loading: true,
    shelf: 'them', query: '', armed: false, busy: false, msg: null
  };
  ed.original = signature();

  const wrap = openOverlay(sheetHtml(), close);
  ed.wrap = wrap;
  bind(wrap);
  paint();

  load(card);
}

const wanted = (items) => (items || []).map(i => ({
  uaid: i.uaid, assetId: i.assetId, bundleId: i.bundleId, legacyAssetId: i.legacyAssetId,
  serial: i.serial, name: i.name, rap: i.rap
}));

/** Charge (ou recharge, `fresh`) les deux inventaires et y retrouve le trade. */
function load(card, fresh = false) {
  const a = card.analysis;
  ed.loading = true; ed.loadError = null;
  paint();
  send({
    type: 'ronote:counter-load', tradeId: card.tradeId, partnerId: card.partner?.id, fresh,
    give: wanted(a?.give?.items), get: wanted(a?.get?.items)
  }).then((res) => {
    if (!ed || ed.card !== card) return;
    ed.loading = false;
    if (res?.error && !res.me) { ed.loadError = res.error; paint(); return; }
    ed.me = res.me; ed.them = res.them;
    // Ce qui est compose est garde (rechargement) ; la reference reste le
    // trade d'origine, retrouve dans les memes inventaires.
    const cur = { give: ed.give, get: ed.get };
    ed.give = adopt(a?.give?.items, res.me); ed.get = adopt(a?.get?.items, res.them);
    ed.original = signature();
    ed.give = adopt(cur.give, res.me); ed.get = adopt(cur.get, res.them);
    paint();
  }).catch((e) => {
    if (!ed) return;
    ed.loading = false;
    ed.loadError = String(e?.message || e);
    paint();
  });
}

function close() {
  ed?.wrap?.remove();
  ed = null;
  releaseFocus();
}

const signature = () => JSON.stringify([
  ed.give.map(i => i.uaid).sort(), ed.get.map(i => i.uaid).sort(), ed.giveRobux, ed.getRobux
]);

/* ------------------------------ la simulation ------------------------------ */

/** Un objet analysis-like : ce que balanceHtml de popup.js sait afficher. */
function simulate() {
  const settings = ed.deps.settings || {};
  const tax = settings.robuxTax !== false;
  const sum = (items, f) => items.reduce((s, i) => s + (i.unknown ? 0 : Number(i[f]) || 0), 0);
  const all = [...ed.give, ...ed.get];
  const hasValues = all.some(i => !i.unknown && !i.noValue);
  let basis = BASIS_FIELD[settings.valueBasis] ? settings.valueBasis : 'value';
  if (!hasValues) basis = 'rap';
  const gotRobux = tax ? Math.floor(ed.getRobux * (1 - ROBUX_TAX)) : ed.getRobux;
  const side = (items, robux) => ({
    value: sum(items, 'value') + robux, rap: sum(items, 'rap') + robux, prudent: sum(items, 'prudent') + robux
  });
  const give = side(ed.give, ed.giveRobux), get = side(ed.get, gotRobux);
  const unknownCount = all.filter(i => i.unknown).length;
  const pct = { value: pctOf(give.value, get.value), rap: pctOf(give.rap, get.rap), prudent: pctOf(give.prudent, get.prudent) };
  return {
    basis, hasValues, give, get,
    mainGive: give[basis], mainGet: get[basis],
    deltaMain: get[basis] - give[basis], pctMain: pct[basis],
    deltaRap: get.rap - give.rap, pctRap: pct.rap,
    unknownCount, incomplete: unknownCount > 0
  };
}

/* -------------------------------- l'affichage ------------------------------ */

function sheetHtml() {
  const c = ed.card;
  const who = escapeHtml(c.partner?.displayName || c.partner?.name || '?');
  return `<div class="zoom-card w-sheet ctr-sheet" role="dialog" aria-modal="true" aria-label="${escapeHtml(t('Contre-offre'))}">
    <header class="z-head">
      <div class="head">
        <span class="av-ring">${ed.deps.avatarHtml(c)}</span>
        <div class="who"><div class="n">${t('Contre-offre à {who}', { who })}</div>
          <div class="t">${t('simulation · rien ne part avant ta confirmation')}</div></div>
      </div>
      <button class="z-close" title="${t('Fermer')}">${ic('x')}</button>
    </header>
    <div class="z-body ctr-body">
      <section class="ctr-sim" data-part="sim"></section>
      <section class="ctr-side" data-part="give"></section>
      <section class="ctr-side" data-part="get"></section>
      <section class="ctr-shelf">
        <div class="ctr-shelf-h">
          <div class="ctr-seg" role="tablist">
            <button data-shelf="them" role="tab">${t('Son inventaire')}</button>
            <button data-shelf="me" role="tab">${t('Ton inventaire')}</button>
          </div>
          <button class="ctr-reload" data-reload title="${escapeHtml(t('Recharger les inventaires'))}">${ic('refresh')}</button>
          <label class="ctr-search">${ic('search')}<input type="search" placeholder="${escapeHtml(t('Chercher un objet'))}" aria-label="${escapeHtml(t('Chercher un objet'))}"></label>
        </div>
        <div class="ctr-grid" data-part="shelf"></div>
      </section>
    </div>
    <div class="z-msg" hidden></div>
    <footer class="z-foot">
      <button class="z-open" data-roblox>${t('Sur Roblox')} ${ic('external')}</button>
      <button class="z-reset" data-reset>${ic('undo')} ${t('Rétablir')}</button>
      <button class="z-accept" data-send></button>
    </footer>
  </div>`;
}

const thumbHtml = (i) => (i.thumb
  ? `<img src="${escapeHtml(i.thumb)}" alt="" loading="lazy">`
  : `<span class="ph">${ic(i.isFace ? 'face' : 'box')}</span>`);
const priceText = (i) => (i.unknown ? t('sans cote') : fmtNum(i.value));

function chipHtml(i, sideKey) {
  const state = i.gone ? 'gone' : i.unsure ? 'unsure' : '';
  const tip = i.gone ? t("Plus dans l'inventaire : retire-le")
    : i.unsure ? t("Pas retrouvé dans l'inventaire chargé : Roblox vérifiera à l'envoi")
      : t('Retirer {name}', { name: i.name });
  return `<button class="ctr-chip${state ? ' ' + state : ''}" data-drop="${sideKey}" data-uaid="${escapeHtml(String(i.uaid))}"
      title="${escapeHtml([tip, i.serial ? '#' + i.serial : ''].filter(Boolean).join(' · '))}">
    ${thumbHtml(i)}
    ${i.serial ? `<i class="ctr-serial">#${escapeHtml(String(i.serial))}</i>` : ''}
    ${state ? `<i class="ctr-flag">${ic(i.gone ? 'ban' : 'help')}</i>` : ''}
    <span class="ctr-chip-n">${escapeHtml(i.acronym || i.name)}</span>
    <b>${priceText(i)}</b>
    <i class="ctr-x">${ic('x')}</i>
  </button>`;
}

function sideHtml(sideKey) {
  const give = sideKey === 'give';
  const items = give ? ed.give : ed.get;
  const robux = give ? ed.giveRobux : ed.getRobux;
  const sim = simulate();
  const total = give ? sim.mainGive : sim.mainGet;
  // Les Robux comptes dans le total : nets de la taxe du cote recu.
  const counted = give || ed.deps.settings?.robuxTax === false ? robux : Math.floor(robux * (1 - ROBUX_TAX));
  const empty = Array.from({ length: Math.max(0, MAX_ITEMS - items.length) },
    () => `<button class="ctr-chip empty" data-goshelf="${give ? 'me' : 'them'}" title="${escapeHtml(t('Ajouter un objet'))}">${ic('plus')}</button>`).join('');
  return `<div class="ctr-side-h">
      <span>${t(give ? 'Tu donnes' : 'Tu demandes')} <small>${items.length}/${MAX_ITEMS}</small></span>
      <b>${fmtFull(total)}${counted ? ` <small>${t('dont {n} R$', { n: fmtNum(counted) })}</small>` : ''}</b>
    </div>
    <div class="ctr-chips">${items.map(i => chipHtml(i, sideKey)).join('')}${empty}</div>
    <label class="ctr-rbx"><span>R$</span><input type="number" min="0" step="1" inputmode="numeric" data-robux="${sideKey}" value="${robux || ''}" placeholder="0">
      ${!give && robux ? `<small>${t('{n} nets', { n: fmtNum(Math.floor(robux * (1 - ROBUX_TAX))) })}</small>` : ''}</label>`;
}

function shelfHtml() {
  const inv = ed.shelf === 'me' ? ed.me : ed.them;
  if (ed.loading) return Array.from({ length: 8 }, () => '<span class="ctr-item ctr-skel"></span>').join('');
  if (ed.loadError) return `<div class="ctr-note err">${escapeHtml(t('Inventaires indisponibles : {why}', { why: ed.loadError }))}</div>`;
  if (inv?.private) return `<div class="ctr-note">${ic('eye-off')} ${t('Inventaire privé : Roblox ne le montre pas.')}</div>`;
  if (inv?.error) return `<div class="ctr-note err">${escapeHtml(t('Inventaire indisponible : {why}', { why: inv.error }))}</div>`;
  const chosen = new Set((ed.shelf === 'me' ? ed.give : ed.get).map(i => i.uaid));
  const full = chosen.size >= MAX_ITEMS;
  const q = ed.query.trim().toLowerCase();
  const items = (inv?.items || [])
    .filter(i => !q || i.name.toLowerCase().includes(q) || (i.acronym || '').toLowerCase() === q)
    .sort((x, y) => (y.value || 0) - (x.value || 0));
  if (!items.length) return `<div class="ctr-note">${t(q ? 'Aucun objet ne correspond.' : 'Aucun limited dans cet inventaire.')}</div>`;
  const partial = inv?.partial || inv?.complete === false
    ? `<div class="ctr-note warn">${ic('alert')} ${t('Inventaire chargé en partie ({n} objets) : certains peuvent manquer.', { n: fmtNum(inv.items.length) })}</div>` : '';
  return partial + items.map((i) => {
    const on = chosen.has(i.uaid);
    const off = !on && (i.onHold || full);
    const why = i.onHold ? t('En hold : pas échangeable pour le moment') : full ? t('Quatre objets maximum par côté') : '';
    return `<button class="ctr-item${on ? ' on' : ''}" data-take="${i.uaid}"${off ? ' disabled' : ''} title="${escapeHtml([i.name, i.serial ? '#' + i.serial : '', why].filter(Boolean).join(' · '))}">
      ${thumbHtml(i)}
      ${on ? `<i class="ctr-on">${ic('check')}</i>` : ''}${i.onHold ? `<i class="ctr-hold">${ic('clock')}</i>` : ''}
      <span class="ctr-item-n">${escapeHtml(i.acronym || i.name)}</span>
      <b>${priceText(i)}</b>
    </button>`;
  }).join('');
}

function paint({ shelf = true } = {}) {
  if (!ed) return;
  const w = ed.wrap;
  const sim = simulate();
  w.querySelector('[data-part="sim"]').innerHTML = ed.deps.balanceHtml(sim, { big: true })
    + `<div class="ctr-sim-l">${t('Tu donnes {a} · tu reçois {b}', { a: fmtFull(sim.mainGive), b: fmtFull(sim.mainGet) })}</div>`;
  w.querySelector('[data-part="give"]').innerHTML = sideHtml('give');
  w.querySelector('[data-part="get"]').innerHTML = sideHtml('get');
  w.querySelectorAll('[data-shelf]').forEach(b => {
    const on = b.dataset.shelf === ed.shelf;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  });
  if (shelf) w.querySelector('[data-part="shelf"]').innerHTML = shelfHtml();

  const changed = signature() !== ed.original;
  const chosen = [...ed.give, ...ed.get];
  const gone = chosen.some(i => i.gone);
  // Un identifiant v2 (non numerique) ne peut pas partir : Roblox veut un userAssetId.
  const noId = chosen.some(i => !(Number(i.uaid) > 0));
  const unsure = chosen.some(i => i.unsure);
  const sendable = !ed.loading && !ed.busy && !gone && !noId && changed
    && (ed.give.length || ed.giveRobux) && (ed.get.length || ed.getRobux);
  const btn = w.querySelector('[data-send]');
  btn.disabled = !sendable;
  btn.classList.toggle('armed', ed.armed);
  btn.innerHTML = ed.busy ? t('Envoi…')
    : ed.armed ? t("Confirmer l'envoi")
      : `${ic('counter')} ${t(changed ? 'Envoyer la contre-offre' : 'Modifie le trade pour contrer')}`;
  w.querySelector('[data-reset]').disabled = !changed;

  const msg = w.querySelector('.z-msg');
  const note = ed.msg
    || (gone ? { text: t("Un objet du trade d'origine n'est plus dans l'inventaire : retire-le avant d'envoyer."), err: true }
      : !ed.loading && noId ? { text: t("Un objet n'a pas pu être identifié : recharge les inventaires ou retire-le."), err: true }
        : !ed.loading && unsure ? { text: t("Un objet n'a pas été vérifié (Roblox n'a pas répondu) : il reste dans le trade, Roblox tranchera à l'envoi.") }
          : null);
  msg.hidden = !note;
  if (note) { msg.className = 'z-msg' + (note.err ? ' err' : ''); msg.textContent = note.text; }
}

/* -------------------------------- les gestes ------------------------------- */

let armTimer = null;
function disarm() { clearTimeout(armTimer); ed.armed = false; ed.msg = null; }

function bind(w) {
  w.addEventListener('click', (e) => {
    if (!ed) return;
    const el = e.target.closest('button');
    if (!el || el.disabled) return;
    if (el.dataset.shelf) { ed.shelf = el.dataset.shelf; paint(); return; }
    if (el.dataset.goshelf) { ed.shelf = el.dataset.goshelf; paint(); w.querySelector('.ctr-search input')?.focus(); return; }
    if (el.dataset.drop) {
      const key = el.dataset.drop;
      ed[key] = ed[key].filter(i => String(i.uaid) !== el.dataset.uaid);
      disarm(); paint();
      return;
    }
    if (el.dataset.take) {
      const uaid = Number(el.dataset.take);
      const key = ed.shelf === 'me' ? 'give' : 'get';
      const inv = (ed.shelf === 'me' ? ed.me : ed.them)?.items || [];
      if (ed[key].some(i => i.uaid === uaid)) ed[key] = ed[key].filter(i => i.uaid !== uaid);
      else if (ed[key].length < MAX_ITEMS) { const it = inv.find(i => i.uaid === uaid); if (it) ed[key] = [...ed[key], it]; }
      disarm(); paint();
      return;
    }
    if ('reset' in el.dataset) {
      const a = ed.card.analysis;
      ed.give = adopt(a?.give?.items, ed.me);
      ed.get = adopt(a?.get?.items, ed.them);
      ed.giveRobux = a?.give?.robux || 0; ed.getRobux = a?.get?.robux || 0;
      disarm(); paint();
      return;
    }
    if ('reload' in el.dataset) { if (!ed.loading) load(ed.card, true); return; }
    if ('roblox' in el.dataset) { B.tabs.create({ url: tradeUrl(ed.card.tradeId) }); return; }
    if ('send' in el.dataset) sendCounter();
  });

  w.addEventListener('input', (e) => {
    if (!ed) return;
    if (e.target.matches('.ctr-search input')) {
      ed.query = e.target.value;
      w.querySelector('[data-part="shelf"]').innerHTML = shelfHtml();
      return;
    }
    const key = e.target.dataset.robux;
    if (!key) return;
    const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
    if (key === 'give') ed.giveRobux = n; else ed.getRobux = n;
    disarm();
    // Le champ garde le focus : on ne redessine que la simulation et le bouton.
    const sim = simulate();
    w.querySelector('[data-part="sim"]').innerHTML = ed.deps.balanceHtml(sim, { big: true })
      + `<div class="ctr-sim-l">${t('Tu donnes {a} · tu reçois {b}', { a: fmtFull(sim.mainGive), b: fmtFull(sim.mainGet) })}</div>`;
  });
  // Les Robux validés (sortie du champ) : la ligne entière se met à jour.
  w.addEventListener('change', (e) => { if (ed && e.target.dataset.robux) paint({ shelf: false }); });
}

async function sendCounter() {
  if (!ed.armed) {
    ed.armed = true;
    ed.msg = { text: t('Cliquer une seconde fois pour envoyer. Le trade reçu sera remplacé par ta contre-offre.') };
    paint({ shelf: false });
    clearTimeout(armTimer);
    armTimer = setTimeout(() => { if (ed) { disarm(); paint({ shelf: false }); } }, 5000);
    return;
  }
  clearTimeout(armTimer);
  const card = ed.card;
  const sim = simulate();
  ed.armed = false; ed.busy = true; ed.msg = null;
  paint({ shelf: false });
  const res = await send({
    type: 'ronote:counter', tradeId: card.tradeId, partnerId: card.partner?.id,
    partner: card.partner?.displayName || card.partner?.name || '',
    give: ed.give.map(i => i.uaid), get: ed.get.map(i => i.uaid),
    giveRobux: ed.giveRobux, getRobux: ed.getRobux,
    giveValue: sim.mainGive, getValue: sim.mainGet, pct: sim.incomplete ? null : sim.pctMain
  }).catch((e) => ({ error: String(e?.message || e) }));
  if (!ed || ed.card !== card) return;
  ed.busy = false;
  if (res?.ok) {
    const done = ed.deps.onSent;
    close();
    done?.(res);
    return;
  }
  if (res?.challenge) B.tabs.create({ url: tradeUrl(card.tradeId) });
  ed.msg = {
    err: true,
    text: res?.challenge
      ? t("Roblox demande une vérification : le trade s'est ouvert sur roblox.com, termine la contre-offre là-bas.")
      : t('Échec : {why}', { why: res?.error || '?' })
  };
  paint({ shelf: false });
}

/** Ouvert ? (Échap et le clavier du popup en tiennent compte.) */
export const counterOpen = () => !!ed;
export const closeCounterEditor = close;
