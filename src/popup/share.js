/**
 * ==========================================================================
 *  LES CARTES A PARTAGER
 * --------------------------------------------------------------------------
 *  « Mon inventaire » (le graphique du Portefeuille) et « Bilan du mois » (le
 *  journal), dessinees sur un canvas, avec un fond au choix. Un fond anime ou
 *  un GIF donne une carte animee, exportee en GIF.
 *
 *  Le popup fournit ce qu'il sait : la carte du portefeuille deja calculee,
 *  la courbe du compte, les dernieres lignes du journal.
 * ==========================================================================
 */
import { B } from '../common/shim.js';
import { escapeHtml, clamp } from '../common/utils.js';
import { t, locale } from '../common/i18n.js';
import { ic } from '../common/icons.js';
import { send, REDUCED_MOTION } from '../common/ui.js';
import { recapStats, recapMonths, drawRecap, drawWallet } from './recap.js';
import { BACKGROUNDS, loadBackground, compose, thumbnail } from './flexbg.js';
import { GifEncoder } from './gif.js';
import { openOverlay } from './overlay.js';

/**
 * La feuille de partage, dans la surcouche du zoom (Échap et le clic à côté
 * la referment). Deux cartes : « Mon inventaire » (Portefeuille) et « Bilan
 * du mois » (journal complet demandé au service worker : le popup n'en
 * reçoit que les 100 dernières lignes). Sous la carte, le choix du fond :
 * un fond animé ou un GIF donne une carte animée, exportée en GIF.
 */
export async function openShare(mode, { walletCard, series, history: recent, historyLimit, anon, close }) {
  const wrap = openOverlay(`<div class="zoom-card w-sheet" role="dialog" aria-modal="true" aria-label="${t('Flex')}">
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
  </div>`, close);

  const canvas = wrap.querySelector('#rc-card');
  const fg = document.createElement('canvas');        // la carte seule, sur fond transparent
  const note = wrap.querySelector('#rc-note');
  const saveBtn = wrap.querySelector('#rc-save');
  const logo = B.runtime.getURL('icons/icon128.png');
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
      await drawWallet(target, walletCard(anonCard), logo, opts);
      text = anonCard
        ? t("Carte anonyme : aucun montant ni rang, seulement tes variations et ta courbe. Aucun pseudo.")
        : t("Le graphique Rolimon's du Portefeuille, chiffres compris : change la période ou les courbes pour changer la carte. Aucun pseudo n'apparaît dessus.");
    } else {
      if (!history) {
        const res = await send({ type: 'ronote:history' }).catch(() => null);
        history = res?.history || recent || [];
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
      text = oldest > stats.from && history.length >= (historyLimit || 300)
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
  let anonCard = anon;
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
