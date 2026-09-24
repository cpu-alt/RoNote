import { B } from '../common/shim.js';
import { SOUNDS, DEFAULTS } from '../common/defaults.js';
import { timeAgo, escapeHtml } from '../common/utils.js';
import { t, currentLang, locale } from '../common/i18n.js';
import { ic, fillIcons } from '../common/icons.js';
import { RELEASES } from '../common/changelog.js';
import { $, send, ask, applyLang, onStoredChange } from '../common/ui.js';
import { THEMES, THEME_KEYS, matchTheme, paintBackground, themeFromFile } from './themes.js';

/** Le bandeau de diagnostic sert aussi a annoncer qu'on n'a pas pu repondre. */
function showUnreachable() {
  const el = $('#diag');
  if (el) {
    el.innerHTML = `<div><div class="k">${t('État')}</div><div class="v err">${t('Injoignable')}</div>`
      + `<div class="k">${t("l'extension n'a pas répondu — recharge la page")}</div></div>`;
  }
}

/* Chaque reglage vit dans un champ du meme nom : les interrupteurs, les
   listes (texte ou nombre) et les champs numeriques bornes. */
const BOOLS = ['enabled', 'watchInbound', 'watchCompleted', 'watchOutbound', 'watchRejectedError',
  'autoTrackOutbound', 'autoTrackCounters', 'notifyUntrackedOutbound',
  'desktopNotifications', 'showItems', 'requireInteraction', 'openOnClick', 'badge',
  'sound', 'useRolimons', 'trackPortfolio', 'robuxTax', 'revalAlerts',
  'onlyWins', 'ignoreProjected', 'alwaysNotifyCounters',
  'showRare', 'showLuckyCat', 'showItemDetails', 'pageDelta', 'pageItemValues', 'itemPageValue', 'bannerPct', 'listBadges', 'listLabels'];
const SELECTS = ['lang', 'valueBasis', 'bannerShow', 'bannerFormat', 'bannerStyle', 'bannerSize',
  'listShow', 'listFormat', 'listStyle', 'listSize', 'projectedSize', 'projectedShape', 'projectedCorner'];
const NUM_SELECTS = ['pollSeconds', 'historyLimit', 'pageBgDim', 'pageBgBlur'];
// [min, max, décimales] : une saisie hors bornes est ramenée dedans.
const NUMS = {
  maxNotificationsPerPoll: [1, 20, 0], counterWindowMinutes: [5, 1440, 0],
  minGainPercent: [-100, 500, 0], minTheirValue: [0, 1e9, 0],
  speculativeRatio: [1, 10, 1],
  // En dessous de 3 %, roli.js ne retient meme pas la revision.
  revalMinPercent: [3, 100, 0]
};
const OUTCOME_KEYS = ['accepted', 'declined', 'countered', 'expired', 'error'];
// Ce qui redessine un aperçu dès que ça change, sans attendre la relecture.
const LOOK_KEYS = new Set(['bannerShow', 'bannerFormat', 'bannerStyle', 'bannerSize', 'bannerPct',
  'listShow', 'listFormat', 'listStyle', 'listSize', 'listLabels', 'projectedSize', 'projectedShape', 'projectedCorner', 'showLuckyCat', 'pageBgDim', 'pageBgBlur', ...THEME_KEYS]);

let settings = null;
let state = null;
let counts = {};
let newest = {};
let belowMark = {};

/* ---------------------------- dépendances ----------------------------- */

/**
 * `data-needs="a b"` : la ligne n'a de sens que si les réglages a et b sont
 * actifs. Sinon elle est grisée et ses champs désactivés — on voit pourquoi
 * un réglage est sans effet au lieu de le chercher.
 */
const flag = (k) => (k === 'qh-enabled' ? settings.quietHours?.enabled : settings[k]);
function applyNeeds() {
  for (const row of document.querySelectorAll('[data-needs]')) {
    const off = row.dataset.needs.split(' ').some(k => !flag(k));
    row.classList.toggle('off', off);
    for (const el of row.querySelectorAll('input, select, button, label.btn')) {
      if (el.matches('label.btn')) el.classList.toggle('disabled', off);
      else el.disabled = off;
    }
  }
}

/* ------------------------------- rendu -------------------------------- */

/* Le badge « projected » de la page Roblox : couleur, taille, forme, coin,
   image importée. Le dessin lui-même vient de content/projected-badge.js, le
   même que sur la page : l'aperçu ne peut pas mentir. */
const PROJ_COLORS = [
  ['#ffc400', 'Jaune'], ['#ff8a00', 'Orange'], ['#ff3b4a', 'Rouge'], ['#ff4fd8', 'Rose'],
  ['#9b5cff', 'Violet'], ['#1ed6ff', 'Cyan'], ['#2ee06f', 'Vert']
];
const PROJ_MAX_FILE = 8 * 1024 * 1024;    // au-delà, refusé avant même de le lire
const PROJ_GIF_KEEP = 400 * 1024;         // un GIF léger garde son animation
const PROJ_PX = 96;                       // le reste est ramené à 96 px de côté
let projectedIcon = '';
// Ton image en fond de roblox.com (content/page-bg.js), à part des réglages : trop lourde pour eux.
let pageBgImage = '';
const BG_MAX_FILE = 20 * 1024 * 1024;    // au-delà, refusé avant même de le lire
const BG_PX = 1920;                      // plus grand côté, assez pour un écran large
const BG_QUALITY = 0.82;

const GAIN_COLORS = [['#22e57a', 'Vert'], ['#00e0b8', 'Turquoise'], ['#3ea8ff', 'Bleu'], ['#b6ff3b', 'Citron'], ['#ffc400', 'Jaune'], ['#ffffff', 'Blanc']];
const LOSS_COLORS = [['#ff4d5e', 'Rouge'], ['#ff7a1a', 'Orange'], ['#ff3fb4', 'Rose'], ['#b05cff', 'Violet'], ['#ffc400', 'Jaune'], ['#8e9cb3', 'Gris']];
const previewColor = {};                  // couleur en cours de choix dans une roue, par réglage
const live = () => ({ ...settings, ...previewColor });

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
  const pick = (key, color) => {
    delete previewColor[key];
    settings = { ...settings, [key]: color };
    onPreview();
    save({ [key]: color });
  };
  box.addEventListener('click', e => {
    const b = e.target.closest('[data-color]');
    if (b && !b.disabled) pick(b.dataset.key, b.dataset.color);
  });
  box.addEventListener('input', e => {
    if (e.target.type !== 'color') return;
    previewColor[e.target.dataset.key] = e.target.value;
    onPreview();
  });
  box.addEventListener('change', e => {
    if (e.target.type === 'color') pick(e.target.dataset.key, e.target.value);
  });
}

function renderBanner() {
  const lib = globalThis.RoNoteBanner;
  const box = $('#banner-preview');
  if (!lib || !box) return;
  const cur = live();
  const o = lib.normalize(cur);
  if (!box.shadowRoot) {
    const root = box.attachShadow({ mode: 'open' });
    root.innerHTML = `<style></style><div class="row">
      <div class="cell" data-tone="up" data-metric="RAP"><span class="arrow" aria-hidden="true"></span><span></span></div>
      <div class="cell" data-tone="down" data-metric="Value"><span class="arrow down" aria-hidden="true"></span><span></span></div></div>`;
  }
  const root = box.shadowRoot;
  root.querySelector('style').textContent = lib.css(cur);
  const [up, down] = root.querySelectorAll('.cell > span:last-child');
  up.textContent = lib.amount(2480, 35.2, cur);
  down.textContent = lib.amount(-1490, -4.1, cur);
  renderSwatches($('#gain-swatches'), GAIN_COLORS, 'bannerGain', o.gain);
  renderSwatches($('#loss-swatches'), LOSS_COLORS, 'bannerLoss', o.loss);
  for (const [id, v] of [['bannerStyle', o.style], ['bannerSize', o.size], ['bannerShow', o.show], ['bannerFormat', o.format]]) $('#' + id).value = v;
  $('#bannerPct').checked = o.pct;
  // Les couleurs du bandeau sont aussi, par défaut, celles de la colonne des listes.
  renderListLook();
}

/* Deux lignes de liste Roblox, dessinées avec le même code que la vraie page
   (content/list-look.js) : l'aperçu ne peut pas mentir. */
const LIST_DEMO = [
  { name: 'Builderman', status: 'Open · 9/23/2026', a: { deltaRap: 2345, deltaValue: 1809, pctRap: 18.2, pctValue: 12.4 } },
  { name: 'Stickmasterluke', status: 'Completed · 9/22/2026', a: { deltaRap: -980, deltaValue: -1532, pctRap: -8.3, pctValue: -6.1 } }
];
const LIST_PREVIEW_CSS = `
  :host{display:block}
  .list{border-radius:12px;overflow:hidden;background:linear-gradient(145deg,#3a1f66,#2a0f55);border:1px solid rgba(255,255,255,.08);
    font-family:"Builder Sans","Gotham SSm",Arial,sans-serif}
  .tile{display:flex;align-items:center;gap:12px;padding:12px 14px}
  .tile+.tile{border-top:1px solid rgba(255,255,255,.08)}
  .av{width:40px;height:40px;border-radius:50%;background:rgba(255,255,255,.14);flex:none}
  .txt{flex:1;min-width:0;display:flex;flex-direction:column}
  .name{font-weight:700;font-size:15px;line-height:20px;color:#fff}
  .status,.ronote-lb{font-weight:500;font-size:12px;line-height:15px;color:rgb(228,227,233)}`;

function renderListLook() {
  const look = globalThis.RoNoteListLook;
  const box = $('#list-preview');
  if (!look || !box || !settings) return;
  const o = look.normalize(live());
  if (!box.shadowRoot) box.attachShadow({ mode: 'open' });
  const root = box.shadowRoot;
  root.innerHTML = `<style>${LIST_PREVIEW_CSS}${look.CSS}</style><div class="list"></div>`;
  for (const d of LIST_DEMO) {
    const tile = document.createElement('div');
    tile.className = 'tile';
    tile.innerHTML = '<span class="av"></span><span class="txt"><span class="name"></span><span class="status"></span></span>';
    tile.querySelector('.name').textContent = d.name;
    tile.querySelector('.status').textContent = d.status;
    const col = look.build(d.a, o);
    col.style.fontSize = 12 * look.SIZES[o.size] + 'px';
    // Comme sur la page : en texte seul et taille normale, chaque ligne est à
    // la hauteur de celle d'en face (pseudo, puis statut).
    if (o.style === 'text' && o.size === 'm') {
      col.children[0].style.height = '20px';
      if (col.children[1]) col.children[1].style.height = '15px';
    }
    tile.append(col);
    root.querySelector('.list').append(tile);
  }
  for (const [id, v] of [['listShow', o.show], ['listFormat', o.format], ['listStyle', o.style], ['listSize', o.size]]) $('#' + id).value = v;
  $('#listLabels').checked = o.labels;
  $('#listColors').value = o.ownColors ? 'own' : 'banner';
  $('#list-own').hidden = !o.ownColors;
  if (o.ownColors) {
    renderSwatches($('#list-gain-swatches'), GAIN_COLORS, 'listGain', o.gain);
    renderSwatches($('#list-loss-swatches'), LOSS_COLORS, 'listLoss', o.loss);
  }
}

function renderProjected() {
  const badge = globalThis.RoNoteBadge;
  const box = $('#proj-preview');
  if (!badge || !box) return;
  const color = previewColor.projectedColor || settings.projectedColor || badge.DEFAULT_COLOR;
  const shape = badge.SHAPES?.[settings.projectedShape] ? settings.projectedShape : 'rounded';
  const corner = settings.projectedCorner === 'right' ? 'right' : 'left';
  if (!box.shadowRoot) box.attachShadow({ mode: 'open' });
  badge.fill(box.shadowRoot, { color, size: settings.projectedSize || 'm', shape, image: projectedIcon });
  box.classList.toggle('right', corner === 'right');

  renderSwatches($('#proj-swatches'), PROJ_COLORS, 'projectedColor', color);
  $('#projectedSize').value = settings.projectedSize || 'm';
  $('#projectedShape').value = shape;
  $('#projectedCorner').value = corner;
  $('#proj-clear').hidden = !projectedIcon;
}

/* Les repères d'un objet (content/item-marks.js), et le tirage en cours. */
let luckyCat = null;
function renderMarks() {
  const marks = globalThis.RoNoteMarks;
  if (!marks) return;
  for (const el of document.querySelectorAll('[data-mark]')) {
    if (!el.childElementCount) el.innerHTML = el.dataset.mark === 'rare' ? marks.inline.rare() : marks.inline.lucky(null);
  }
  const box = $('#lucky-now');
  box.hidden = !luckyCat?.uaid || settings?.showLuckyCat === false;
  if (!box.hidden) {
    box.textContent = t('Tirage en cours : {item}, tiré {ago}.', {
      item: `${luckyCat.name || '?'}${luckyCat.serial ? ' #' + luckyCat.serial : ''}`,
      ago: luckyCat.since ? timeAgo(luckyCat.since) : '—'
    });
  }
}

let shownBg = null;
function renderBg() {
  const box = $('#bg-preview');
  if (!box) return;
  // L'image fait des centaines de Ko : la reposer à chaque redessin des
  // aperçus faisait réanalyser tout ce texte à chaque clic.
  if (shownBg !== pageBgImage) { shownBg = pageBgImage; box.style.setProperty('--bg-img', pageBgImage ? `url("${pageBgImage}")` : 'none'); }
  box.style.setProperty('--bg-dim', pageBgImage ? String((Number(settings.pageBgDim ?? DEFAULTS.pageBgDim) || 0) / 100) : '0');
  // L'aperçu est ~8 fois plus petit que la page : son flou aussi.
  box.style.setProperty('--bg-blur', `${(Number(settings.pageBgBlur ?? DEFAULTS.pageBgBlur) || 0) / 3}px`);
  $('#bg-clear').hidden = !pageBgImage;
}

/** Les tuiles des thèmes, avec celui qui correspond aux réglages actuels. */
function renderThemes() {
  const box = $('#themes');
  if (!box) return;
  const active = matchTheme(settings)?.id || '';
  box.innerHTML = THEMES.map(th => {
    const s = th.settings;
    return `<button class="theme" type="button" role="listitem" data-theme="${th.id}" aria-pressed="${th.id === active}">
      <span class="th-sw" style="background:${th.swatch}">
        <span class="th-pill"><b style="color:${s.bannerGain}">+2 480</b><b style="color:${s.bannerLoss}">−310</b></span>
        <i class="th-badge" style="background:${s.projectedColor};border-radius:${s.projectedShape === 'circle' ? '50%' : s.projectedShape === 'square' ? '2px' : '4px'}"></i>
      </span>
      <span class="th-name">${escapeHtml(t(th.name))}${th.id === active ? ic('check') : ''}</span>
      <small>${escapeHtml(t(th.desc))}</small>
    </button>`;
  }).join('') + (active ? '' : `<span class="th-custom">${ic('palette')}${t('Thème perso : tes propres réglages.')}</span>`);
}

let applyingTheme = false;
async function applyTheme(id) {
  const th = THEMES.find(x => x.id === id);
  // Un double clic peindrait deux fonds et enverrait deux fois les réglages.
  if (!th || applyingTheme) return;
  applyingTheme = true;
  try { await applyThemeNow(th); } finally { applyingTheme = false; }
}
async function applyThemeNow(th) {
  message('#theme-msg', t('Application du thème…'));
  // Laisse le message s'afficher avant de peindre le fond (≈ 100 ms de calcul).
  await new Promise(r => setTimeout(r, 30));
  for (const k of THEME_KEYS) delete previewColor[k];
  // Le fond fait partie du thème : peint à la volée, ou retiré pour un thème sans fond.
  pageBgImage = th.bg ? paintBackground(th.bg) : '';
  await B.storage.local.set({ pageBgImage }).catch(() => {});
  await set({ ...th.settings });
  renderLooks();
  message('#theme-msg', t('Thème « {name} » appliqué aux onglets Roblox ouverts.', { name: t(th.name) }));
  flashSaved();
}

function renderLooks() {
  renderThemes();
  renderBg();
  renderMarks();
  renderProjected();
  renderBanner();       // redessine aussi la colonne des listes
}

function message(sel, text, err = false) {
  const el = $(sel);
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
/** L'image de fond, prête à stocker : 1920 px au plus, en JPEG. */
async function toPageBg(file) {
  if (!/^image\/(png|jpeg|gif|webp)$/.test(file.type)) throw new Error(t('Format non pris en charge : PNG, JPG, GIF ou WebP.'));
  if (file.size > BG_MAX_FILE) throw new Error(t('Image trop lourde (20 Mo maximum).'));
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, BG_PX / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * k));
  canvas.height = Math.max(1, Math.round(bmp.height * k));
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return canvas.toDataURL('image/jpeg', BG_QUALITY);
}
const validIcon = (v) => typeof v === 'string' && /^data:image\/(png|jpeg|gif|webp);base64,/.test(v) && v.length < 2e6;

const SOUND_KEYS = ['inbound', 'accepted', 'declined', 'error', 'revalued'];

function fillSounds() {
  const options = Object.entries(SOUNDS)
    .map(([k, v]) => `<option value="${k}">${t(v)}</option>`).join('');
  for (const k of SOUND_KEYS) $('#snd-' + k).innerHTML = options;
}

const showVolume = (v) => { $('#volume-out').textContent = Math.round(Number(v) * 100) + ' %'; };

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
  for (const k of BOOLS) { const el = $('#' + k); if (el) el.checked = !!settings[k]; }
  for (const k of SELECTS) { const el = $('#' + k); if (el) el.value = String(settings[k] ?? DEFAULTS[k]); }
  for (const k of NUM_SELECTS) { const el = $('#' + k); if (el) el.value = String(settings[k] ?? DEFAULTS[k]); }
  for (const k of Object.keys(NUMS)) { const el = $('#' + k); if (el) el.value = settings[k] ?? DEFAULTS[k]; }
  for (const k of OUTCOME_KEYS) { const el = $('#no-' + k); if (el) el.checked = !!settings.notifyOutbound?.[k]; }
  for (const k of SOUND_KEYS) $('#snd-' + k).value = settings.sounds?.[k] || 'none';
  $('#volume').value = settings.volume;
  showVolume(settings.volume);
  $('#qh-enabled').checked = !!settings.quietHours.enabled;
  $('#qh-start').value = settings.quietHours.start;
  $('#qh-end').value = settings.quietHours.end;
  $('#qh-still').checked = !!settings.quietHours.stillNotify;
  renderIgnored();
  renderDiag();
  renderNews();
  renderLooks();
  applyNeeds();
}

/**
 * Quoi de neuf : chaque version, de la plus récente à la plus ancienne. Les
 * deux premières sont dépliées, la version installée est marquée. Rendu une
 * fois par langue : la liste ne change pas d'une relecture à l'autre.
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
    `<span class="chip"><a href="https://www.roblox.com/users/${Number(u.id)}/profile" target="_blank" rel="noopener">${escapeHtml(u.name || ('#' + u.id))}</a>`
    + `<button type="button" data-id="${Number(u.id)}" title="${t('Retirer')}" aria-label="${t('Retirer')}">${ic('x')}</button></span>`
  ).join('');
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

/* ------------------------------ recherche ----------------------------- */

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Filtre les réglages : ne restent que les lignes qui contiennent le texte
 * tapé (sans tenir compte des accents), et les sections qui en ont. Une
 * section dont le titre correspond reste entière.
 */
function runSearch() {
  const q = fold($('#search').value.trim());
  // Chaque mot tapé doit commencer un mot du réglage, et un mot court doit
  // l'être en entier : « son » trouve le son, pas « raison » ni « sont ».
  const words = q.split(/\s+/).filter(Boolean)
    .map(w => new RegExp('(?:^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + (w.length <= 3 ? '(?![a-z0-9])' : '')));
  const matches = (text) => words.every(re => re.test(text));
  $('.main').classList.toggle('searching', !!q);
  let hits = 0;
  for (const sec of document.querySelectorAll('main section.card')) {
    const whole = !q || matches(fold(sec.querySelector('h2').textContent));
    let any = whole;
    for (const row of sec.querySelectorAll('.row')) {
      const hit = whole || matches(fold(row.textContent + ' ' + (row.dataset.keys || '')));
      row.classList.toggle('miss', !hit);
      if (hit) { any = true; if (q) row.closest('details.advanced')?.setAttribute('open', ''); }
    }
    sec.hidden = !any;
    if (any && q) hits++;
    const link = document.querySelector(`#nav a[href="#${sec.id}"]`);
    if (link) link.hidden = !any;
  }
  $('#no-hit').hidden = !q || hits > 0;
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
  applyNeeds();
  renderDiag();
}

/** Un changement local : l'aperçu et les dépendances suivent tout de suite. */
function set(patch) {
  settings = { ...settings, ...patch };
  applyNeeds();
  if (Object.keys(patch).some(k => LOOK_KEYS.has(k))) renderLooks();
  return save(patch);
}

function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
const today = () => new Date().toISOString().slice(0, 10);

/** Réglages remplacés d'un bloc (import, remise à zéro) : tout se redessine. */
async function replaceAll(next, keep, icon) {
  const r = await ask({ type: 'ronote:settings-replace', settings: next, keep });
  if (!r?.settings) { showUnreachable(); return false; }
  if (icon !== undefined) {
    projectedIcon = icon;
    await B.storage.local.set({ projectedIcon: icon }).catch(() => {});
  }
  for (const k of Object.keys(previewColor)) delete previewColor[k];
  settings = r.settings;
  render();
  flashSaved();
  return true;
}

function wire() {
  for (const k of BOOLS) $('#' + k)?.addEventListener('change', e => set({ [k]: e.target.checked }));
  for (const k of SELECTS) $('#' + k)?.addEventListener('change', e => set({ [k]: e.target.value }));
  for (const k of NUM_SELECTS) $('#' + k)?.addEventListener('change', e => set({ [k]: Number(e.target.value) }));
  for (const [k, [min, max, dec]] of Object.entries(NUMS)) {
    $('#' + k)?.addEventListener('change', e => {
      const raw = Number(String(e.target.value).replace(',', '.'));
      const fallback = settings[k] ?? DEFAULTS[k];
      const f = 10 ** dec;
      const v = Number.isFinite(raw) && e.target.value !== '' ? Math.min(max, Math.max(min, Math.round(raw * f) / f)) : fallback;
      e.target.value = v;
      set({ [k]: v });
    });
  }
  for (const k of OUTCOME_KEYS) {
    $('#no-' + k)?.addEventListener('change', e => save({ notifyOutbound: { [k]: e.target.checked } }));
  }

  // --- apparence ---------------------------------------------------------
  wireSwatches($('#proj-swatches'), renderProjected);
  wireSwatches($('#gain-swatches'), renderBanner);
  wireSwatches($('#loss-swatches'), renderBanner);
  wireSwatches($('#list-gain-swatches'), renderListLook);
  wireSwatches($('#list-loss-swatches'), renderListLook);
  $('#listColors').addEventListener('change', e => {
    // Des couleurs propres partent de celles du bandeau : rien ne saute à l'œil.
    const b = globalThis.RoNoteBanner?.normalize(settings);
    const patch = e.target.value === 'own'
      ? { listGain: b?.gain || '#22e57a', listLoss: b?.loss || '#ff4d5e' }
      : { listGain: '', listLoss: '' };
    delete previewColor.listGain; delete previewColor.listLoss;
    set(patch);
    renderListLook();
  });
  const resetter = (id, patch) => $(id).addEventListener('click', () => {
    for (const k of Object.keys(patch)) delete previewColor[k];
    set(patch);
    renderLooks();
  });
  const defaultsOf = (keys) => Object.fromEntries(keys.map(k => [k, DEFAULTS[k]]));
  resetter('#banner-reset', defaultsOf(['bannerGain', 'bannerLoss', 'bannerStyle', 'bannerSize', 'bannerShow', 'bannerFormat', 'bannerPct']));
  resetter('#list-reset', defaultsOf(['listShow', 'listFormat', 'listStyle', 'listSize', 'listLabels', 'listGain', 'listLoss']));
  resetter('#bg-reset', defaultsOf(['pageBgDim', 'pageBgBlur']));
  resetter('#proj-reset', defaultsOf(['projectedColor', 'projectedSize', 'projectedShape', 'projectedCorner']));

  for (const id of ['proj-file', 'bg-file', 'theme-file', 'settings-file']) {
    $(`label[for="${id}"]`).addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('#' + id).click(); }
    });
  }
  $('#proj-file').addEventListener('change', async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      message('#proj-msg', t("Préparation de l'image…"));
      projectedIcon = await toProjectedIcon(file);
      await B.storage.local.set({ projectedIcon });
      renderProjected();
      message('#proj-msg', t('Image appliquée aux onglets Roblox ouverts.'));
      flashSaved();
    } catch (err) {
      message('#proj-msg', err?.message || t('Image illisible.'), true);
    }
  });
  $('#themes').addEventListener('click', e => {
    const b = e.target.closest('button[data-theme]');
    if (b) applyTheme(b.dataset.theme);
  });
  $('#theme-export').addEventListener('click', async () => {
    const got = await B.storage.local.get(['pageBgImage', 'projectedIcon']).catch(() => ({}));
    const file = {
      app: 'RoNote', kind: 'ronote-theme', name: matchTheme(settings)?.name || t('Mon thème'),
      exportedAt: new Date().toISOString(),
      settings: Object.fromEntries(THEME_KEYS.map(k => [k, settings[k] ?? DEFAULTS[k]])),
      pageBgImage: got?.pageBgImage || '',
      projectedIcon: got?.projectedIcon || ''
    };
    download(`ronote-theme-${today()}.json`, new Blob([JSON.stringify(file)], { type: 'application/json' }));
    message('#theme-msg', t('Thème exporté : envoie le fichier à qui tu veux.'));
  });
  $('#theme-file').addEventListener('change', async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    let theme = null;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('size');
      theme = themeFromFile(JSON.parse(await file.text()));
    } catch { theme = null; }
    if (!theme) { message('#theme-msg', t("Ce fichier n'est pas un thème RoNote."), true); return; }
    for (const k of THEME_KEYS) delete previewColor[k];
    if (theme.pageBgImage !== undefined) { pageBgImage = theme.pageBgImage; await B.storage.local.set({ pageBgImage }).catch(() => {}); }
    if (theme.projectedIcon !== undefined) { projectedIcon = theme.projectedIcon; await B.storage.local.set({ projectedIcon }).catch(() => {}); }
    await set(theme.settings);
    renderLooks();
    message('#theme-msg', theme.name ? t('Thème « {name} » importé.', { name: theme.name }) : t('Thème importé.'));
    flashSaved();
  });
  $('#bg-file').addEventListener('change', async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      message('#bg-msg', t("Préparation de l'image…"));
      pageBgImage = await toPageBg(file);
      await B.storage.local.set({ pageBgImage });
      renderBg();
      message('#bg-msg', t('Image appliquée aux onglets Roblox ouverts.'));
      flashSaved();
    } catch (err) {
      message('#bg-msg', err?.message || t('Image illisible.'), true);
    }
  });
  $('#bg-clear').addEventListener('click', async () => {
    pageBgImage = '';
    await B.storage.local.set({ pageBgImage: '' }).catch(() => {});
    renderBg();
    message('#bg-msg', t('Fond de Roblox rétabli.'));
    flashSaved();
  });
  $('#proj-clear').addEventListener('click', async () => {
    projectedIcon = '';
    // Une valeur vide plutot qu'un remove : les onglets Roblox recoivent le
    // meme evenement de changement, et le triangle revient aussitot.
    await B.storage.local.set({ projectedIcon: '' }).catch(() => {});
    renderProjected();
    message('#proj-msg', t('Retour au triangle.'));
    flashSaved();
  });

  // --- son ---------------------------------------------------------------
  for (const k of SOUND_KEYS) {
    $('#snd-' + k).addEventListener('change', e => save({ sounds: { [k]: e.target.value } }));
  }
  // Ecouter une sonnerie avant de la choisir : le service worker la joue par
  // le meme chemin qu'une vraie alerte, ce qui teste aussi ce chemin.
  document.querySelectorAll('button[data-play]').forEach(b => b.addEventListener('click', async () => {
    const sound = $('#snd-' + b.dataset.play).value;
    b.classList.add('busy');
    const r = await send({ type: 'ronote:play', sound }).catch(() => null);
    b.classList.remove('busy');
    b.title = r?.ok ? t('Écouter') : t('Aucun son n\'est parti : vérifie le volume et que le navigateur n\'est pas coupé.');
  }));
  $('#volume').addEventListener('input', e => showVolume(e.target.value));
  $('#volume').addEventListener('change', e => save({ volume: Number(e.target.value) }));

  // --- heures silencieuses ----------------------------------------------
  const qh = () => {
    const quietHours = {
      enabled: $('#qh-enabled').checked,
      start: $('#qh-start').value || '23:00',
      end: $('#qh-end').value || '08:00',
      stillNotify: $('#qh-still').checked
    };
    settings = { ...settings, quietHours };
    applyNeeds();
    save({ quietHours });
  };
  ['#qh-enabled', '#qh-start', '#qh-end', '#qh-still'].forEach(s => $(s).addEventListener('change', qh));

  $('#btn-test').addEventListener('click', () => send({ type: 'ronote:test' }));

  // --- utilisateurs ignorés ---------------------------------------------
  const mute = async () => {
    const input = $('#mute-name');
    const query = input.value.trim();
    if (!query) { input.focus(); return; }
    const btn = $('#btn-mute');
    btn.disabled = true;
    message('#mute-msg', t('Recherche…'));
    const r = await ask({ type: 'ronote:mute', query });
    btn.disabled = false;
    if (r?.settings) {
      settings = r.settings;
      renderIgnored();
      input.value = '';
      message('#mute-msg', '');
      flashSaved();
    } else if (r?.error === 'unknown' || r?.error === 'identifiant invalide') {
      message('#mute-msg', t('Aucun joueur Roblox ne porte ce nom.'), true);
    } else {
      message('#mute-msg', t('Roblox ne répond pas, réessaie dans un instant.'), true);
    }
  };
  $('#btn-mute').addEventListener('click', mute);
  $('#mute-name').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); mute(); } });
  $('#ignored').addEventListener('click', async e => {
    const b = e.target.closest('button[data-id]');
    if (!b) return;
    const r = await ask({ type: 'ronote:unmute', userId: Number(b.dataset.id) });
    if (!r?.settings) { showUnreachable(); return; }
    settings = r.settings;
    renderIgnored();
    flashSaved();
  });

  // --- sauvegarde des réglages ------------------------------------------
  $('#btn-settings-export').addEventListener('click', async () => {
    const got = await B.storage.local.get('projectedIcon').catch(() => ({}));
    const file = {
      app: 'RoNote',
      version: B.runtime.getManifest?.().version || '',
      exportedAt: new Date().toISOString(),
      settings,
      ...(validIcon(got?.projectedIcon) ? { projectedIcon: got.projectedIcon } : {})
    };
    download(`ronote-reglages-${today()}.json`, new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
    message('#backup-msg', t('Réglages exportés.'));
  });
  $('#settings-file').addEventListener('change', async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const bad = () => message('#backup-msg', t("Ce fichier n'est pas un export de réglages RoNote."), true);
    let data;
    try {
      if (file.size > 3 * 1024 * 1024) throw new Error('size');
      data = JSON.parse(await file.text());
    } catch { bad(); return; }
    const next = data?.settings && typeof data.settings === 'object' ? data.settings : data;
    if (!next || typeof next !== 'object' || Array.isArray(next)) { bad(); return; }
    if (!confirm(t('Remplacer tous tes réglages par ceux de ce fichier ?'))) return;
    // Un fichier sans liste d'ignorés ne vide pas la tienne.
    const keep = Array.isArray(next.ignoredUsers) ? [] : ['ignoredUsers'];
    const icon = 'projectedIcon' in data ? (validIcon(data.projectedIcon) ? data.projectedIcon : '') : undefined;
    if (await replaceAll(next, keep, icon)) message('#backup-msg', t('Réglages importés.'));
  });
  $('#btn-settings-reset').addEventListener('click', async () => {
    if (!confirm(t("Remettre tous les réglages par défaut ?\n\nLa langue et les utilisateurs ignorés sont gardés. Les images importées (badge, fond) sont retirées."))) return;
    if (await replaceAll({}, ['lang', 'ignoredUsers'], '')) {
      pageBgImage = '';
      await B.storage.local.set({ pageBgImage: '' }).catch(() => {});
      renderBg();
      message('#backup-msg', t('Réglages remis par défaut.'));
    }
  });

  // --- données ------------------------------------------------------------
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
    const history = (await ask({ type: 'ronote:history' }))?.history;
    if (!history) { showUnreachable(); return; }
    const rows = [['date', 'type', 'tradeId', 'statut', 'partenaire', 'partenaireId',
      'valeur_donnee', 'valeur_recue', 'ecart_pct', 'objets_sans_cote', 'reponse_au_trade', 'notifie', 'filtre',
      'objet', 'cote_avant', 'cote_apres', 'quantite', 'impact']];
    for (const h of history) {
      rows.push([new Date(h.at).toISOString(), h.kind, h.tradeId ?? '', h.status ?? '', h.partner ?? '', h.partnerId ?? '',
        h.give ?? '', h.get ?? '', h.pct == null ? '' : h.pct.toFixed(2), h.unknown ?? '', h.counterTo ?? '',
        h.notified ? 'oui' : 'non', h.skipped ?? '',
        h.name ?? '', h.from ?? '', h.to ?? '', h.count ?? '', h.delta ?? '']);
    }
    const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    download(`ronote-journal-${today()}.csv`, new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  });

  // --- dépannage ----------------------------------------------------------
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

  // --- recherche ----------------------------------------------------------
  $('#search').addEventListener('input', runSearch);
  $('#search').addEventListener('keydown', e => { if (e.key === 'Escape') { e.target.value = ''; runSearch(); } });
  // Ctrl+F reste celui du navigateur ; « / » va droit à la recherche.
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !e.target.matches?.('input, select, textarea')) { e.preventDefault(); $('#search').focus(); }
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
if (globalThis.RoNoteMarks) document.head.append(Object.assign(document.createElement('style'), { textContent: globalThis.RoNoteMarks.INLINE_CSS }));
wire();
wireNav();
load();

/**
 * La page se met a jour quand le stockage change, pas a intervalle fixe : la
 * relecture periodique reveillait le service worker tant que l'onglet restait
 * ouvert. Les ecritures d'un passage arrivent en rafale, on les regroupe.
 */
onStoredChange(['settings', 'state', 'streams'], 300, () => load());
B.storage.local.get('projectedIcon').then(got => { projectedIcon = got?.projectedIcon || ''; if (settings) renderProjected(); }).catch(() => {});
B.storage.local.get('pageBgImage').then(got => { pageBgImage = got?.pageBgImage || ''; if (settings) renderBg(); }).catch(() => {});
onStoredChange(['pageBgImage'], 100, (v) => { pageBgImage = v.pageBgImage || ''; if (settings) renderBg(); });
onStoredChange(['projectedIcon'], 100, (v) => { projectedIcon = v.projectedIcon || ''; if (settings) renderProjected(); });
const setLuckyCat = (v) => { luckyCat = v?.uaid ? v : null; if (settings) renderMarks(); };
B.storage.local.get('luckyCat').then(got => setLuckyCat(got?.luckyCat)).catch(() => {});
send({ type: 'ronote:lucky-cat' }).then(r => { if (r?.luckyCat) setLuckyCat(r.luckyCat); }).catch(() => {});
onStoredChange(['luckyCat'], 100, (v) => setLuckyCat(v.luckyCat));
// Les « il y a 3 min » du diagnostic avancent sans rien relire.
setInterval(() => { if (!document.hidden && state) renderDiag(); }, 30000);
