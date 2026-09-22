import { B } from '../common/shim.js';
import { SOUNDS } from '../common/defaults.js';
import { timeAgo, escapeHtml } from '../common/utils.js';
import { t, currentLang, locale } from '../common/i18n.js';
import { ic, fillIcons } from '../common/icons.js';
import { RELEASES } from '../common/changelog.js';
import { $, send, ask, applyLang, onStoredChange } from '../common/ui.js';

/** Le bandeau de diagnostic sert aussi a annoncer qu'on n'a pas pu repondre. */
function showUnreachable() {
  const el = $('#diag');
  if (el) {
    el.innerHTML = `<div><div class="k">${t('État')}</div><div class="v err">${t('Injoignable')}</div>`
      + `<div class="k">${t("l'extension n'a pas répondu — recharge la page")}</div></div>`;
  }
}

const BOOLS = ['enabled', 'watchInbound', 'watchCompleted', 'watchOutbound', 'watchRejectedError',
  'autoTrackOutbound', 'autoTrackCounters', 'notifyUntrackedOutbound',
  'desktopNotifications', 'showItems', 'requireInteraction', 'openOnClick', 'badge',
  'sound', 'useRolimons', 'trackPortfolio', 'robuxTax', 'showItemDetails', 'pageDelta',
  'onlyWins', 'ignoreProjected', 'alwaysNotifyCounters', 'revalAlerts'];
const NUMS = ['maxNotificationsPerPoll', 'minGainPercent', 'minTheirValue', 'counterWindowMinutes'];
const OUTCOME_KEYS = ['accepted', 'declined', 'countered', 'expired', 'error'];

let settings = null;
let state = null;
let counts = {};
let newest = {};
let belowMark = {};

/* ------------------------------- rendu -------------------------------- */

/* Le badge « projected » de la page Roblox : couleur, taille, image importée.
   Le dessin lui-même vient de content/projected-badge.js, le même que sur la
   page : l'aperçu ne peut pas mentir. */
const PROJ_COLORS = [
  ['#ffc400', 'Jaune'], ['#ff8a00', 'Orange'], ['#ff3b4a', 'Rouge'], ['#ff4fd8', 'Rose'],
  ['#9b5cff', 'Violet'], ['#1ed6ff', 'Cyan'], ['#2ee06f', 'Vert']
];
const PROJ_MAX_FILE = 8 * 1024 * 1024;    // au-delà, refusé avant même de le lire
const PROJ_GIF_KEEP = 400 * 1024;         // un GIF léger garde son animation
const PROJ_PX = 96;                       // le reste est ramené à 96 px de côté
let projectedIcon = '';

const BANNER_GAIN = [['#22e57a', 'Vert'], ['#00e0b8', 'Turquoise'], ['#3ea8ff', 'Bleu'], ['#b6ff3b', 'Citron'], ['#ffc400', 'Jaune']];
const BANNER_LOSS = [['#ff4d5e', 'Rouge'], ['#ff7a1a', 'Orange'], ['#ff3fb4', 'Rose'], ['#b05cff', 'Violet'], ['#ffc400', 'Jaune']];
const previewColor = {};                  // couleur en cours de choix dans une roue, par réglage

/** Une rangée de pastilles + une roue « autre couleur », pour le réglage `key`. */
function renderSwatches(box, colors, key, current) {
  if (!box.childElementCount) {
    box.innerHTML = colors.map(([c, name]) =>
      `<button type="button" class="swatch" data-key="${key}" data-color="${c}" style="background:${c}" title="${t(name)}" aria-label="${t(name)}"></button>`).join('') +
      `<label class="swatch custom" title="${t('Autre couleur')}"><input type="color" data-key="${key}" aria-label="${t('Autre couleur')}"></label>`;
  }
  const preset = colors.some(([c]) => c === current);
  for (const b of box.querySelectorAll('[data-color]')) b.setAttribute('aria-pressed', String(b.dataset.color === current));
  const custom = box.querySelector('.swatch.custom');
  custom.setAttribute('aria-pressed', String(!preset));
  custom.style.background = preset ? '' : current;
  const picker = custom.querySelector('input');
  if (document.activeElement !== picker) picker.value = current;
}

/** Clics, roue en direct et roue validée : même câblage pour toutes les rangées. */
function wireSwatches(box, onPreview) {
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-color]');
    if (!b) return;
    delete previewColor[b.dataset.key];
    settings = { ...settings, [b.dataset.key]: b.dataset.color };
    onPreview();
    save({ [b.dataset.key]: b.dataset.color });
  });
  box.addEventListener('input', e => {
    if (e.target.type !== 'color') return;
    previewColor[e.target.dataset.key] = e.target.value;
    onPreview();
  });
  box.addEventListener('change', e => {
    if (e.target.type !== 'color') return;
    delete previewColor[e.target.dataset.key];
    settings = { ...settings, [e.target.dataset.key]: e.target.value };
    onPreview();
    save({ [e.target.dataset.key]: e.target.value });
  });
}

function renderBanner() {
  const lib = globalThis.RoNoteBanner;
  const box = $('#banner-preview');
  if (!lib || !box) return;
  const live = { ...settings, ...previewColor };
  const o = lib.normalize(live);
  if (!box.shadowRoot) {
    const root = box.attachShadow({ mode: 'open' });
    root.innerHTML = `<style></style><div class="row">
      <div class="cell" data-tone="up"><span class="arrow" aria-hidden="true"></span><span>+2 480 RAP (+35%)</span></div>
      <div class="cell" data-tone="down"><span class="arrow down" aria-hidden="true"></span><span>−149 Value (−4%)</span></div></div>`;
  }
  box.shadowRoot.querySelector('style').textContent = lib.css(live);
  renderSwatches($('#gain-swatches'), BANNER_GAIN, 'bannerGain', o.gain);
  renderSwatches($('#loss-swatches'), BANNER_LOSS, 'bannerLoss', o.loss);
  $('#bannerStyle').value = o.style;
  $('#bannerSize').value = o.size;
}

function renderProjected() {
  const badge = globalThis.RoNoteBadge;
  const box = $('#proj-preview');
  if (!badge || !box) return;
  const color = previewColor.projectedColor || settings.projectedColor || badge.DEFAULT_COLOR;
  if (!box.shadowRoot) box.attachShadow({ mode: 'open' });
  badge.fill(box.shadowRoot, { color, size: settings.projectedSize || 'm', image: projectedIcon });

  renderSwatches($('#proj-swatches'), PROJ_COLORS, 'projectedColor', color);
  $('#projectedSize').value = settings.projectedSize || 'm';
  $('#proj-clear').hidden = !projectedIcon;
}

function projMessage(text, err = false) {
  const el = $('#proj-msg');
  el.textContent = text;
  el.classList.toggle('err', err);
}

const readAsDataUrl = (file) => new Promise((done, fail) => {
  const r = new FileReader();
  r.onload = () => done(String(r.result));
  r.onerror = () => fail(r.error);
  r.readAsDataURL(file);
});

/** L'image importée, prête à stocker : carrée, légère, en data: URL. */
async function toProjectedIcon(file) {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error(t('Format non pris en charge : PNG, JPG, GIF ou WebP.'));
  if (file.size > PROJ_MAX_FILE) throw new Error(t('Image trop lourde (8 Mo maximum).'));
  if (file.type === 'image/gif' && file.size <= PROJ_GIF_KEEP) return readAsDataUrl(file);
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = PROJ_PX;
  // Recadrée au centre, comme la vignette d'un objet.
  canvas.getContext('2d').drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, PROJ_PX, PROJ_PX);
  bmp.close?.();
  return canvas.toDataURL('image/png');
}

const SOUND_KEYS = ['inbound', 'accepted', 'declined', 'error', 'revalued'];

function fillSounds() {
  const options = Object.entries(SOUNDS)
    .map(([k, v]) => `<option value="${k}">${t(v)}</option>`).join('');
  for (const k of SOUND_KEYS) $('#snd-' + k).innerHTML = options;
}

function render() {
  // La langue du gabarit (voir `common/ui.js`) : changer de langue en cours de
  // route repart d'une page neuve, et il n'y a alors plus rien a dessiner.
  if (!applyLang(settings.lang)) return;

  // La page se redessine aussi quand le service worker ecrit : un nombre ou
  // une heure en cours de saisie ne doit pas etre remis a l'ancienne valeur.
  const focused = document.activeElement;
  const typing = focused?.matches?.('input[type=number], input[type=text], input[type=time]') ? focused.value : null;
  try { fill(); } finally { if (typing !== null) focused.value = typing; }
}

function fill() {
  $('#lang').value = settings.lang || 'auto';
  $('#valueBasis').value = settings.valueBasis || 'value';
  // Sans cotes communautaires, il n'y a qu'un seul chiffre possible : le RAP.
  $('#valueBasis').disabled = !settings.useRolimons;
  $('#speculativeRatio').disabled = !settings.useRolimons;
  // L'alerte croise les revisions avec l'inventaire que releve le portefeuille :
  // sans cotes ou sans suivi, elle n'a rien a croiser.
  const revalOk = settings.useRolimons && settings.trackPortfolio;
  $('#revalAlerts').disabled = !revalOk;
  $('#revalMinPercent').disabled = !revalOk;
  $('#revalMinPercent').value = settings.revalMinPercent ?? 10;
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
  renderNews();
  renderProjected();
  renderBanner();
}

/**
 * Quoi de neuf : chaque version, de la plus récente à la plus ancienne. Les
 * deux premières sont dépliées, la version installée est marquée. Rendu une
 * fois par langue : la page se relit toutes les 20 s, la liste ne change pas.
 */
function renderNews() {
  const box = $('#news');
  if (!box || box.dataset.lang === currentLang()) return;
  box.dataset.lang = currentLang();
  const pick = (s) => (currentLang() === 'en' ? s.en : s.fr);
  const installed = B.runtime.getManifest?.().version || '';
  box.innerHTML = RELEASES.map((r, n) => {
    const tag = !r.version ? `<span class="rel-tag dev">${t('En préparation')}</span>`
      : r.version === installed ? `<span class="rel-tag">${t('Version installée')}</span>` : '';
    const date = r.date
      ? `<span class="rel-date">${new Date(r.date + 'T12:00:00').toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric' })}</span>`
      : '';
    return `<details class="rel"${n < 2 ? ' open' : ''}>
      <summary>
        <span class="rel-v">${r.version ? 'v' + escapeHtml(r.version) : escapeHtml(t('Prochaine version'))}</span>
        <span class="rel-t">${escapeHtml(pick(r.title))}</span>
        ${tag}${date}
        <i class="rel-chev">${ic('chevron')}</i>
      </summary>
      <ul>${r.items.map(i => `<li>${escapeHtml(pick(i))}</li>`).join('')}</ul>
    </details>`;
  }).join('');
}

function renderIgnored() {
  const box = $('#ignored');
  if (!settings.ignoredUsers.length) {
    box.innerHTML = `<span class="hint">${t('Aucun utilisateur ignoré.')}</span>`;
    return;
  }
  box.innerHTML = settings.ignoredUsers.map(u =>
    `<span class="chip">${escapeHtml(u.name || ('#' + u.id))}<button data-id="${u.id}" title="${t('Retirer')}" aria-label="${t('Retirer')}">${ic('x')}</button></span>`
  ).join('');
  box.querySelectorAll('button[data-id]').forEach(b => b.addEventListener('click', async () => {
    const r = await ask({ type: 'ronote:unmute', userId: Number(b.dataset.id) });
    if (!r?.settings) { showUnreachable(); return; }
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
    cell(t('Dernier trade reçu'), newest.inbound ? timeAgo(newest.inbound) : '—',
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
  const r = await ask({ type: 'ronote:settings', patch });
  // Sans reponse, garder les anciens reglages : les ecraser par `undefined`
  // cassait tous les rendus suivants, bien apres l'echec.
  if (!r?.settings) { showUnreachable(); return; }
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
  // En dessous de 3 %, roli.js ne retient meme pas la revision.
  $('#revalMinPercent').addEventListener('change', e => {
    const v = Math.min(100, Math.max(3, Math.round(Number(e.target.value)) || 10));
    e.target.value = v;
    save({ revalMinPercent: v });
  });
  $('#pollSeconds').addEventListener('change', e => save({ pollSeconds: Number(e.target.value) }));

  // Pastilles de couleur : dessinées au premier rendu, d'où la délégation.
  wireSwatches($('#proj-swatches'), renderProjected);
  wireSwatches($('#gain-swatches'), renderBanner);
  wireSwatches($('#loss-swatches'), renderBanner);
  for (const k of ['bannerStyle', 'bannerSize']) {
    $('#' + k).addEventListener('change', e => {
      settings = { ...settings, [k]: e.target.value };
      renderBanner();
      save({ [k]: e.target.value });
    });
  }
  $('#banner-reset').addEventListener('click', () => {
    const d = globalThis.RoNoteBanner?.DEFAULTS;
    if (!d) return;
    const patch = { bannerGain: d.gain, bannerLoss: d.loss, bannerStyle: d.style, bannerSize: d.size };
    for (const k of Object.keys(patch)) delete previewColor[k];
    settings = { ...settings, ...patch };
    renderBanner();
    save(patch);
  });
  $('#projectedSize').addEventListener('change', e => {
    settings = { ...settings, projectedSize: e.target.value };
    renderProjected();
    save({ projectedSize: e.target.value });
  });
  $('label[for="proj-file"]').addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#proj-file').click(); }
  });
  $('#proj-file').addEventListener('change', async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      projMessage(t("Préparation de l'image…"));
      projectedIcon = await toProjectedIcon(file);
      await B.storage.local.set({ projectedIcon });
      renderProjected();
      projMessage(t('Image appliquée aux onglets Roblox ouverts.'));
      flashSaved();
    } catch (err) {
      projMessage(err?.message || t('Image illisible.'), true);
    }
  });
  $('#proj-clear').addEventListener('click', async () => {
    projectedIcon = '';
    // Une valeur vide plutot qu'un remove : les onglets Roblox recoivent le
    // meme evenement de changement, et le triangle revient aussitot.
    await B.storage.local.set({ projectedIcon: '' }).catch(() => {});
    renderProjected();
    projMessage(t('Retour au triangle.'));
    flashSaved();
  });
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
    e.target.innerHTML = ic('check') + ' ' + escapeHtml(t('Copié'));
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

  $('#btn-page-diag').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const { pageDiag } = await B.storage.local.get('pageDiag').catch(() => ({}));
    if (!pageDiag) { btn.textContent = t('Ouvre d\'abord un trade à créer'); return; }
    const text = 'RoNote page diagnostic\n' + JSON.stringify({ ...pageDiag, skeleton: undefined }, null, 1) + '\n\n' + pageDiag.skeleton;
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = t('Copié !');
    } catch {
      btn.textContent = t('Copie refusée');
    }
    setTimeout(() => { btn.textContent = t('Copier'); }, 2500);
  });
  $('#btn-export').addEventListener('click', async () => {
    const history = (await ask({ type: 'ronote:get' }))?.history;
    if (!history) { showUnreachable(); return; }
    const rows = [['date', 'type', 'tradeId', 'statut', 'partenaire', 'partenaireId',
      'valeur_donnee', 'valeur_recue', 'ecart_pct', 'objets_sans_cote', 'reponse_au_trade', 'notifie', 'filtre',
      'objet', 'cote_avant', 'cote_apres', 'quantite', 'impact']];
    for (const h of history || []) {
      rows.push([new Date(h.at).toISOString(), h.kind, h.tradeId ?? '', h.status ?? '', h.partner ?? '', h.partnerId ?? '',
        h.give ?? '', h.get ?? '', h.pct == null ? '' : h.pct.toFixed(2), h.unknown ?? '', h.counterTo ?? '',
        h.notified ? 'oui' : 'non', h.skipped ?? '',
        h.name ?? '', h.from ?? '', h.to ?? '', h.count ?? '', h.delta ?? '']);
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

/* -------------------------------- menu -------------------------------- */

/**
 * Le menu suit la lecture : la section à l'écran est surlignée. Les cartes
 * arrivent en cascade au chargement, pas à chaque relecture des réglages.
 */
function wireNav() {
  const links = [...document.querySelectorAll('#nav a')];
  const sections = [...document.querySelectorAll('main section[id]')];
  sections.forEach((s, i) => s.style.setProperty('--i', i));
  links[0]?.classList.add('on');   // en haut de page, avant tout défilement
  const spy = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const href = '#' + e.target.id;
      links.forEach(a => a.classList.toggle('on', a.getAttribute('href') === href));
    }
  }, { rootMargin: '-10% 0px -75% 0px' });
  sections.forEach(s => spy.observe(s));
  // La version vient du manifeste : le pied de page ne peut plus prendre de retard.
  $('#version').textContent = 'RoNote v' + (B.runtime.getManifest?.().version || '');
}

let hashDone = false;

async function load() {
  const r = await ask({ type: 'ronote:get' });
  if (!r?.settings) { showUnreachable(); return; }
  settings = r.settings;
  state = r.state;
  counts = r.counts || {};
  newest = r.newest || {};
  belowMark = r.belowMark || {};
  render();
  // Le bandeau « nouveautés » du popup ouvre la page sur #s-news : la liste
  // n'existe qu'une fois rendue, le défilement natif est donc passé trop tôt.
  if (!hashDone && location.hash) {
    hashDone = true;
    requestAnimationFrame(() => document.querySelector(location.hash)?.scrollIntoView());
  }
}

fillIcons(document);
fillSounds();
wire();
wireNav();
load();

/**
 * La page se met a jour quand le stockage change, pas toutes les 20 s : la
 * relecture periodique reveillait le service worker tant que l'onglet restait
 * ouvert. Les ecritures d'un passage arrivent en rafale, on les regroupe.
 */
onStoredChange(['settings', 'state', 'streams'], 300, () => load());
B.storage.local.get('projectedIcon').then(got => { projectedIcon = got?.projectedIcon || ''; if (settings) renderProjected(); }).catch(() => {});
onStoredChange(['projectedIcon'], 100, (v) => { projectedIcon = v.projectedIcon || ''; if (settings) renderProjected(); });
// Les « il y a 3 min » du diagnostic avancent sans rien relire.
setInterval(() => { if (!document.hidden && state) renderDiag(); }, 30000);
