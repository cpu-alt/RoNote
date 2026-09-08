import { B } from '../common/shim.js';
import { SOUNDS } from '../common/defaults.js';
import { timeAgo, escapeHtml } from '../common/utils.js';
import { t, setLang, translateDom } from '../common/i18n.js';

const $ = (s) => document.querySelector(s);
const send = (msg) => B.runtime.sendMessage(msg);

const BOOLS = ['enabled', 'watchInbound', 'watchCompleted', 'watchOutbound', 'watchRejectedError',
  'autoTrackOutbound', 'autoTrackCounters', 'notifyUntrackedOutbound',
  'desktopNotifications', 'showItems', 'requireInteraction', 'openOnClick', 'badge',
  'sound', 'useRolimons', 'trackPortfolio', 'reconcilePortfolio', 'robuxTax', 'showItemDetails',
  'onlyWins', 'ignoreProjected', 'alwaysNotifyCounters'];
const NUMS = ['maxNotificationsPerPoll', 'minGainPercent', 'minTheirValue', 'counterWindowMinutes'];
const OUTCOME_KEYS = ['accepted', 'declined', 'countered', 'expired', 'error'];

let settings = null;
let state = null;
let counts = {};
let watermarks = {};
let belowMark = {};

/* ------------------------------- rendu -------------------------------- */

const SOUND_KEYS = ['inbound', 'accepted', 'declined', 'error'];

function fillSounds() {
  const options = Object.entries(SOUNDS)
    .map(([k, v]) => `<option value="${k}">${t(v)}</option>`).join('');
  for (const k of SOUND_KEYS) $('#snd-' + k).innerHTML = options;
}

let domLang = null;   // langue deja appliquee au gabarit HTML

function render() {
  // Le gabarit est ecrit en francais et `translateDom` remplace en place :
  // il n'est jouable qu'une fois. Changer de langue repart d'une page neuve.
  const lang = setLang(settings.lang);
  if (domLang === null) { domLang = lang; translateDom(document); }
  else if (domLang !== lang) { location.reload(); return; }

  $('#lang').value = settings.lang || 'auto';
  $('#valueBasis').value = settings.valueBasis || 'value';
  // Sans cotes communautaires, il n'y a qu'un seul chiffre possible : le RAP.
  $('#valueBasis').disabled = !settings.useRolimons;
  $('#speculativeRatio').disabled = !settings.useRolimons;
  $('#reconcilePortfolio').disabled = !settings.trackPortfolio;
  // Les pastilles font partie du panneau : sans lui, rien n'est injecte.
  $('#speculativeRatio').value = settings.speculativeRatio ?? 1.6;
  for (const k of BOOLS) { const el = $('#' + k); if (el) el.checked = !!settings[k]; }
  for (const k of NUMS) { const el = $('#' + k); if (el) el.value = settings[k] ?? 0; }
  for (const k of OUTCOME_KEYS) { const el = $('#no-' + k); if (el) el.checked = !!settings.notifyOutbound?.[k]; }
  $('#pollSeconds').value = String(settings.pollSeconds);
  for (const k of SOUND_KEYS) $('#snd-' + k).value = settings.sounds?.[k] || 'none';
  $('#volume').value = settings.volume;
  $('#qh-enabled').checked = !!settings.quietHours.enabled;
  $('#qh-start').value = settings.quietHours.start;
  $('#qh-end').value = settings.quietHours.end;
  $('#qh-still').checked = !!settings.quietHours.stillNotify;
  renderIgnored();
  renderDiag();
}

function renderIgnored() {
  const box = $('#ignored');
  if (!settings.ignoredUsers.length) {
    box.innerHTML = `<span class="hint">${t('Aucun utilisateur ignoré.')}</span>`;
    return;
  }
  box.innerHTML = settings.ignoredUsers.map(u =>
    `<span class="chip">${escapeHtml(u.name || ('#' + u.id))}<button data-id="${u.id}" title="${t('Retirer')}">×</button></span>`
  ).join('');
  box.querySelectorAll('button[data-id]').forEach(b => b.addEventListener('click', async () => {
    const r = await send({ type: 'ronote:unmute', userId: Number(b.dataset.id) });
    settings = r.settings; renderIgnored();
  }));
}

function renderDiag() {
  const conn = state?.lastError
    ? { v: t('Erreur'), cls: 'err', sub: state.lastError.message }
    : state?.lastOkAt ? { v: t('Connecté'), cls: 'ok', sub: '@' + (state.userName || '?') }
    : { v: t('En attente'), cls: 'warn', sub: t('aucune vérification réussie') };

  const tracked = Object.keys(state?.tracked || {});
  const cell = (k, v, cls = '', sub = '') =>
    `<div><div class="k">${k}</div><div class="v ${cls}">${escapeHtml(v)}</div>${sub ? `<div class="k">${escapeHtml(sub)}</div>` : ''}</div>`;

  $('#diag').innerHTML = [
    cell(t('État'), conn.v, conn.cls, conn.sub),
    cell(t('Dernière vérif.'), state?.lastOkAt ? timeAgo(state.lastOkAt) : '—'),
    cell(t('Trades en attente'), String(state?.inboundCount ?? 0)),
    cell(t('Trades suivis'), String(tracked.length), tracked.length ? 'warn' : '',
      tracked.length ? '#' + tracked.slice(0, 4).join(', #') : t('aucun')),
    cell(t('IDs mémorisés'), String(Object.values(counts).reduce((a, b) => a + b, 0)), '',
      t('reçus {a} · envoyés {b} · finis {c} · inactifs {d}', {
        a: counts.inbound || 0, b: counts.outbound || 0,
        c: counts.completed || 0, d: counts.inactive || 0
      })),
    cell(t("Cotes Rolimon's"),
      state?.valueCount ? String(state.valueCount) : t(settings.useRolimons ? 'aucune' : 'désactivé'),
      settings.useRolimons && !state?.valueCount ? 'err' : (state?.valueStale ? 'warn' : ''),
      state?.valueStale ? t('table non actualisée')
        : state?.valueTs ? t('à jour {ago}', { ago: timeAgo(state.valueTs) }) : ''),
    cell(t('Dernier id reçu'), watermarks.inbound ? '#' + watermarks.inbound : '—',
      belowMark.inbound ? 'warn' : '',
      belowMark.inbound ? t('{n} trade(s) plus ancien(s) que le suivi, jamais notifié(s)', { n: belowMark.inbound }) : '')
  ].join('');
}

/* ------------------------------ sauvegarde ---------------------------- */

let savedTimer = null;
function flashSaved() {
  const el = $('#saved');
  el.classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => el.classList.remove('show'), 1200);
}

async function save(patch) {
  const r = await send({ type: 'ronote:settings', patch });
  settings = r.settings;
  flashSaved();
  renderDiag();
}

function wire() {
  for (const k of BOOLS) $('#' + k)?.addEventListener('change', e => save({ [k]: e.target.checked }));
  for (const k of NUMS) $('#' + k)?.addEventListener('change', e => save({ [k]: Number(e.target.value) || 0 }));
  for (const k of OUTCOME_KEYS) {
    $('#no-' + k)?.addEventListener('change', e => save({ notifyOutbound: { [k]: e.target.checked } }));
  }
  $('#lang').addEventListener('change', e => save({ lang: e.target.value }));
  $('#valueBasis').addEventListener('change', e => save({ valueBasis: e.target.value }));
  $('#speculativeRatio').addEventListener('change', e => {
    const v = Math.min(10, Math.max(1, Number(e.target.value) || 1.6));
    e.target.value = v;
    save({ speculativeRatio: v });
  });
  $('#pollSeconds').addEventListener('change', e => save({ pollSeconds: Number(e.target.value) }));
  for (const k of SOUND_KEYS) {
    $('#snd-' + k).addEventListener('change', e => save({ sounds: { [k]: e.target.value } }));
  }
  // Ecouter une sonnerie avant de la choisir : le service worker la joue par
  // le meme chemin qu'une vraie alerte, ce qui teste aussi ce chemin.
  document.querySelectorAll('button[data-play]').forEach(b => b.addEventListener('click', async () => {
    const sound = $('#snd-' + b.dataset.play).value;
    b.disabled = true;
    const r = await send({ type: 'ronote:play', sound });
    b.disabled = false;
    b.title = r?.ok ? t('Écouter') : t('Aucun son n\'est parti : vérifie le volume et que le navigateur n\'est pas coupé.');
  }));
  $('#volume').addEventListener('change', e => save({ volume: Number(e.target.value) }));

  const qh = () => save({
    quietHours: {
      enabled: $('#qh-enabled').checked,
      start: $('#qh-start').value || '23:00',
      end: $('#qh-end').value || '08:00',
      stillNotify: $('#qh-still').checked
    }
  });
  ['#qh-enabled', '#qh-start', '#qh-end', '#qh-still'].forEach(s => $(s).addEventListener('change', qh));

  $('#btn-test').addEventListener('click', () => send({ type: 'ronote:test' }));

  $('#btn-diag').addEventListener('click', async (e) => {
    const id = ($('#diag-id').value || '').replace(/[^0-9]/g, '');
    if (!id) { $('#diag-id').focus(); return; }
    const out = $('#diag-out');
    e.target.textContent = '…';
    out.hidden = false;
    out.textContent = t('Test en cours…');
    const r = await send({ type: 'ronote:diagnose', tradeId: id });
    const NL = String.fromCharCode(10);
    out.textContent = `Trade #${id}` + NL + NL + (r?.report || [])
      .map(l => Object.entries(l).map(([k, v]) => `  ${k}: ${v}`).join(NL))
      .join(NL + NL);
    e.target.textContent = t('Diagnostiquer');
    $('#btn-diag-copy').hidden = false;
  });

  $('#btn-diag-copy').addEventListener('click', async (e) => {
    await navigator.clipboard.writeText($('#diag-out').textContent);
    e.target.textContent = t('Copié ✓');
    setTimeout(() => { e.target.textContent = t('Copier'); }, 1500);
  });

  $('#btn-reset').addEventListener('click', async (e) => {
    if (!confirm(t("Réinitialiser le suivi ?\n\nLes trades actuellement présents seront enregistrés comme « déjà vus » et ne déclencheront aucune notification. Les trades épinglés seront désépinglés."))) return;
    e.target.textContent = '…';
    await send({ type: 'ronote:reset-dedup' });
    await load();
    e.target.textContent = t('Réinitialiser');
  });

  $('#btn-clear').addEventListener('click', async () => {
    if (!confirm(t('Vider le journal ?'))) return;
    await send({ type: 'ronote:history-clear' });
    flashSaved();
  });

  $('#btn-export').addEventListener('click', async () => {
    const { history } = await send({ type: 'ronote:get' });
    const rows = [['date', 'type', 'tradeId', 'statut', 'partenaire', 'partenaireId',
      'valeur_donnee', 'valeur_recue', 'ecart_pct', 'objets_sans_cote', 'reponse_au_trade', 'notifie', 'filtre']];
    for (const h of history || []) {
      rows.push([new Date(h.at).toISOString(), h.kind, h.tradeId, h.status ?? '', h.partner, h.partnerId ?? '',
        h.give ?? '', h.get ?? '', h.pct == null ? '' : h.pct.toFixed(2), h.unknown ?? '', h.counterTo ?? '',
        h.notified ? 'oui' : 'non', h.skipped ?? '']);
    }
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `ronote-journal-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  });
}

async function load() {
  const r = await send({ type: 'ronote:get' });
  settings = r.settings;
  state = r.state;
  counts = r.counts || {};
  watermarks = r.watermarks || {};
  belowMark = r.belowMark || {};
  render();
}

fillSounds();
wire();
load();
setInterval(load, 20000);
