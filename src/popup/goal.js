/**
 * ==========================================================================
 *  OBJECTIF DU PORTEFEUILLE
 * --------------------------------------------------------------------------
 *  Un but, dans l'onglet Portefeuille : atteindre une value (« 2M »), ou
 *  pouvoir s'offrir un objet (sa value Rolimon's, relue à chaque ouverture),
 *  avec ou sans date limite.
 *
 *  Le rythme se mesure sur la courbe du compte : ce qu'elle a gagné sur les
 *  30 derniers jours, ramené à la journée. De là, le rythme qu'il faudrait
 *  pour tenir la date, et le jour où l'objectif tombera si ça continue.
 *
 *  Rangé sous la clé `walletGoal` :
 *    { kind: 'value' | 'item', target, item?: {assetId, bundleId, name, thumb, value},
 *      deadline: ms | null, createdAt, startValue }
 * ==========================================================================
 */
import { t, locale } from '../common/i18n.js';
import { ic } from '../common/icons.js';
import { escapeHtml, clamp } from '../common/utils.js';

const DAY = 864e5;
const PACE_DAYS = 30;

const full = (n) => new Intl.NumberFormat(locale(), { maximumFractionDigits: 0 }).format(Math.round(n));
const day = (ms) => new Date(ms).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });

/** La cible, en Robux de value. */
export const goalTarget = (g) => (g?.kind === 'item' ? Number(g.item?.value) || 0 : Number(g?.target) || 0);

/**
 * Où en est l'objectif. `series` : la courbe du compte [{at, v}], `now` : la
 * value actuelle.
 */
export function goalProgress(goal, series, now, at = Date.now()) {
  const target = goalTarget(goal);
  const remaining = Math.max(0, target - now);
  const pct = target ? clamp(now / target * 100, 0, 100) : 0;

  // Rythme : la value gagnée sur les 30 derniers jours, par jour.
  const pts = (series || []).filter(p => p.v > 0).sort((a, b) => a.at - b.at);
  const ref = [...pts].reverse().find(p => p.at <= at - PACE_DAYS * DAY) || pts[0];
  const span = ref ? (at - ref.at) / DAY : 0;
  const pace = span >= 1 ? (now - ref.v) / span : null;

  const daysLeft = goal?.deadline ? Math.ceil((goal.deadline - at) / DAY) : null;
  const needed = daysLeft > 0 && remaining > 0 ? remaining / daysLeft : null;
  const eta = remaining > 0 && pace > 0 ? at + remaining / pace * DAY : null;

  let status;
  if (!target) status = 'none';
  else if (!remaining) status = 'done';
  else if (daysLeft !== null && daysLeft <= 0) status = 'late';
  else if (needed !== null) status = pace !== null && pace >= needed ? 'ahead' : 'behind';
  else status = pace > 0 ? 'rising' : 'flat';
  return { target, remaining, pct, pace, daysLeft, needed, eta, status };
}

const STATUS = {
  done: ['win', 'Objectif atteint !'],
  ahead: ['win', 'Dans les temps'],
  rising: ['win', 'En progression'],
  flat: ['warn', 'Pas de progression'],
  behind: ['warn', 'En retard sur le rythme'],
  late: ['loss', 'Date dépassée'],
  none: ['', '']
};

/** La carte du Portefeuille. Sans objectif : un bouton pour en fixer un. */
export function goalHtml(goal, series, now, hidden = false) {
  // Mode anonyme : les montants masqués comme ailleurs, la progression en % reste lisible.
  const money = (n) => (hidden ? `<span class="amt">${full(8888888)}</span>` : full(n));
  if (!goal) {
    return `<button class="rc-open g-new" data-goal="edit">${ic('flag')}<span>${t('Fixer un objectif')}</span><small>${t('Une value ou un objet à atteindre')}</small>${ic('chevron')}</button>`;
  }
  const p = goalProgress(goal, series, now);
  const [tone, label] = STATUS[p.status];
  const title = goal.kind === 'item'
    ? `${goal.item?.thumb ? `<img class="g-thumb" src="${escapeHtml(goal.item.thumb)}" alt="">` : ''}<span>${escapeHtml(goal.item?.name || '?')}</span>`
    : `<span>${money(p.target)}</span>`;
  const lines = [];
  if (p.status === 'done') lines.push(t('Tu y es : {v} de value.', { v: money(now) }));
  else {
    lines.push(t('Reste {r}', { r: `<b>${money(p.remaining)}</b>` }) + (p.daysLeft > 0 ? ' · ' + t('{n} jours restants', { n: p.daysLeft }) : ''));
    if (p.needed) lines.push(t('Il faut {x} / jour', { x: `<b>+${money(p.needed)}</b>` }) + (p.pace !== null ? ' · ' + t('ton rythme : {x} / jour', { x: `${p.pace >= 0 ? '+' : '−'}${money(Math.abs(p.pace))}` }) : ''));
    else if (p.pace !== null) lines.push(t('Ton rythme : {x} / jour', { x: `<b>${p.pace >= 0 ? '+' : '−'}${money(Math.abs(p.pace))}</b>` }));
    if (p.eta && p.eta - Date.now() > 3650 * DAY) lines.push(t('À ce rythme : dans plus de 10 ans.'));
    else if (p.eta) lines.push(t('À ce rythme : atteint vers le {d}', { d: day(p.eta) }));
    else if (p.pace !== null && p.pace <= 0) lines.push(t('À ce rythme, la value ne monte pas encore.'));
  }
  return `<section class="panel g-card" data-tone="${tone}">
    <div class="panel-h"><span>${ic('flag')} ${t('Objectif')}</span>
      <span class="g-actions"><button class="g-btn" data-goal="edit" title="${t('Modifier')}">${ic('settings')}</button>
      <button class="g-btn" data-goal="delete" title="${t('Supprimer l\'objectif')}">${ic('x')}</button></span></div>
    <div class="g-title">${title}${goal.deadline ? `<small>${t('avant le {d}', { d: day(goal.deadline) })}</small>` : ''}</div>
    <div class="g-bar"><i style="width:${p.pct.toFixed(1)}%"></i></div>
    <div class="g-row"><span class="g-pct">${p.pct >= 99.95 ? '100' : p.pct.toFixed(1)} %</span>${label ? `<span class="w-pill ${tone}">${t(label)}</span>` : ''}</div>
    <div class="g-lines">${lines.map(l => `<div>${l}</div>`).join('')}</div>
  </section>`;
}

/**
 * La fenêtre pour fixer ou modifier l'objectif. `search(query)` renvoie les
 * objets du catalogue ; `onSave(goal)` enregistre. Rend le HTML et branche
 * ses contrôles dans `card`.
 */
export function mountGoalEditor(card, { goal, now, hidden = false, search, onSave, onClose }) {
  let kind = goal?.kind || 'value';
  let item = goal?.item || null;
  const dateVal = goal?.deadline ? new Date(goal.deadline - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10) : '';
  // En mode anonyme, ni la value actuelle ni une suggestion qui la trahirait.
  const suggested = hidden ? '' : Math.ceil((now * 1.25 || 100000) / 10000) * 10000;
  card.innerHTML = `<header class="z-head">
      <div class="head"><b class="rc-month">${ic('flag')} ${t('Objectif')}</b></div>
      <button class="z-close" title="${t('Fermer')}">${ic('x')}</button>
    </header>
    <div class="z-body g-edit">
      <div class="rc-modes" role="tablist">
        <button data-kind="value" role="tab">${t('Une value')}</button>
        <button data-kind="item" role="tab">${t('Un objet')}</button>
      </div>
      <label class="g-field" data-for="value"><span>${t('Value à atteindre')}</span>
        <input type="number" id="g-target" min="1" step="1000" placeholder="${suggested}" value="${goal?.kind === 'value' && !hidden ? goal.target : ''}">
        ${hidden ? '' : `<small>${t('Aujourd\'hui : {v}', { v: full(now) })}</small>`}</label>
      <div class="g-field" data-for="item"><span>${t('Objet à pouvoir s\'offrir')}</span>
        <input type="search" id="g-q" placeholder="${t('Nom ou acronyme (ex. DE)')}" autocomplete="off" spellcheck="false">
        <div class="g-results" id="g-results"></div>
        <div class="g-picked" id="g-picked"></div></div>
      <label class="g-field"><span>${t('Date limite (facultatif)')}</span>
        <input type="date" id="g-date" value="${dateVal}" min="${new Date().toISOString().slice(0, 10)}"></label>
      <button class="rc-btn main" id="g-save">${ic('check')}<span>${t('Enregistrer')}</span></button>
      <small class="rc-note" id="g-msg"></small>
    </div>`;

  const showKind = () => {
    card.querySelectorAll('[data-kind]').forEach(b => b.classList.toggle('on', b.dataset.kind === kind));
    card.querySelectorAll('[data-for]').forEach(f => { f.hidden = f.dataset.for !== kind; });
  };
  const showPicked = () => {
    card.querySelector('#g-picked').innerHTML = item
      ? `${item.thumb ? `<img src="${escapeHtml(item.thumb)}" alt="">` : ''}<span>${escapeHtml(item.name)}</span><b>${full(item.value)}</b>` : '';
  };
  card.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => { kind = b.dataset.kind; showKind(); }));
  card.querySelector('.z-close').addEventListener('click', onClose);

  let timer = 0, found = [], asked = 0;
  card.querySelector('#g-q').addEventListener('input', (e) => {
    clearTimeout(timer);
    const q = e.target.value;
    timer = setTimeout(async () => {
      const run = ++asked;
      found = q.trim().length >= 2 ? await search(q) : [];
      if (run !== asked) return;
      card.querySelector('#g-results').innerHTML = found.map((i, n) => `<button data-pick="${n}">
        ${i.thumb ? `<img src="${escapeHtml(i.thumb)}" alt="">` : '<i></i>'}<span>${escapeHtml(i.name)}${i.acronym ? ` <small>${escapeHtml(i.acronym)}</small>` : ''}</span><b>${full(i.value)}</b></button>`).join('')
        || (q.trim().length >= 2 ? `<div class="g-none">${t('Aucun objet trouvé.')}</div>` : '');
    }, 220);
  });
  card.querySelector('#g-results').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    item = found[Number(b.dataset.pick)];
    card.querySelector('#g-results').innerHTML = '';
    card.querySelector('#g-q').value = '';
    showPicked();
  });
  card.querySelector('#g-save').addEventListener('click', () => {
    const msg = card.querySelector('#g-msg');
    const date = card.querySelector('#g-date').value;
    // Fin de journée, heure locale : « avant le 31 déc. » inclut le 31.
    const deadline = date ? new Date(date + 'T23:59:59').getTime() : null;
    if (deadline && deadline < Date.now()) { msg.textContent = t('Choisis une date à venir.'); return; }
    let next;
    if (kind === 'value') {
      const target = Math.round(Number(card.querySelector('#g-target').value) || 0);
      if (target <= 0) { msg.textContent = t('Indique la value à atteindre.'); return; }
      next = { kind, target };
    } else {
      if (!item) { msg.textContent = t('Choisis un objet dans la liste.'); return; }
      next = { kind, target: item.value, item: { assetId: item.assetId, bundleId: item.bundleId, name: item.name, thumb: item.thumb, value: item.value } };
    }
    onSave({ ...next, deadline, createdAt: goal?.createdAt || Date.now(), startValue: goal?.startValue ?? now });
  });
  showKind();
  showPicked();
}
