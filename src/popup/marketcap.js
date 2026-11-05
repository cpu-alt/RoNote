/**
 * ==========================================================================
 *  MARKET CAP : LA CARTE DE L'ACCUEIL
 * --------------------------------------------------------------------------
 *  Le market cap des limiteds Roblox calculé par Neuronal (le salon
 *  #market-cap du bot) : Σ value × copies encore existantes. Une seule
 *  lecture de /ext/v1/marketcap, gardée 10 min par le worker et le serveur ;
 *  ici on garde la dernière réponse pour redessiner l'accueil sans attendre
 *  ni clignoter. Rien ne s'affiche si les fiches Neuronal sont coupées.
 *
 *  Sobre : un grand chiffre qui monte au premier affichage, la variation sur
 *  24 h, une courbe de 30 jours sans axes, trois chiffres et le top 3.
 * ==========================================================================
 */
import { t } from '../common/i18n.js';
import { fmtNum, fmtFull, escapeHtml } from '../common/utils.js';
import { send } from '../common/ui.js';

let last = null;            // la dernière réponse { data }
let asking = null;
let counted = false;        // le chiffre ne monte qu'une fois par ouverture du popup

// Les milliards en « B » : fmtNum s'arrête au million (« 111 071M » se lit mal).
const big = (n) => (Math.abs(n) >= 1e9 ? (n / 1e9).toLocaleString(undefined, { maximumFractionDigits: Math.abs(n) >= 1e11 ? 1 : 2 }) + 'B' : fmtNum(n));
const pct = (v, sign = true) => (v == null ? '' : (sign && v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(Math.abs(v) < 10 ? 2 : 1) + ' %');
const tone = (v) => (v == null || Math.abs(v) < 0.05 ? 'flat' : v > 0 ? 'win' : 'loss');

function spark(pts) {
  if (!pts || pts.length < 2) return '';
  const W = 300, H = 64, P = 3;
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const X = (x) => P + (x1 > x0 ? (x - x0) / (x1 - x0) : 1) * (W - 2 * P);
  const Y = (y) => H - P - (y1 > y0 ? (y - y0) / (y1 - y0) : 0.5) * (H - 2 * P);
  const line = pts.map((p, i) => (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1)).join('');
  const end = pts[pts.length - 1];
  return `<svg class="mc-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <path class="mc-area" d="${line}L${X(end[0]).toFixed(1)} ${H}L${X(pts[0][0]).toFixed(1)} ${H}Z"/>
    <path class="mc-line" d="${line}" pathLength="1"/>
    <circle class="mc-dot" cx="${X(end[0]).toFixed(1)}" cy="${Y(end[1]).toFixed(1)}" r="3"/>
  </svg>`;
}

function html(d) {
  const ch = d.change || {};
  const periods = [['24h', '24 h'], ['7d', '7 j'], ['30d', '30 j']].filter(([k]) => ch[k] != null);
  const top = (d.top || []).map((x, i) => `<button class="mc-top" data-open="https://www.rolimons.com/item/${Number(x.id)}" title="${escapeHtml(x.name)}">
      <span class="mc-rank">${i + 1}</span>
      ${x.thumb ? `<img src="${escapeHtml(x.thumb)}" alt="" width="22" height="22" loading="lazy" decoding="async">` : '<span class="mc-noimg"></span>'}
      <span class="mc-tn">${escapeHtml(x.name)}</span><b>${big(x.cap)}</b></button>`).join('');
  return `<div class="mc-h"><span class="mc-l">${t('Market cap des limiteds')}</span>
      <span class="mc-live">${t('Neuronal')}</span></div>
    <div class="mc-row">
      <div class="mc-big" data-mc-to="${Number(d.circ) || 0}" title="${escapeHtml(fmtFull(d.circ))} R$">${big(d.circ)}</div>
      ${ch['24h'] != null ? `<span class="mc-pill ${tone(ch['24h'])}">${pct(ch['24h'])}</span>` : ''}
    </div>
    <div class="mc-sub">R$${d.usd ? ` · ≈ $${big(d.usd)}` : ''} · ${t('{n} items', { n: fmtFull(d.items) })}</div>
    ${spark(d.spark)}
    ${periods.length ? `<div class="mc-per">${periods.map(([k, l]) => `<span><small>${l}</small><b class="${tone(ch[k])}">${pct(ch[k])}</b></span>`).join('')}</div>` : ''}
    <div class="mc-facts">
      <span><small>${t('Détruit')}</small><b>${big(d.burned)}</b><em>${pct((d.burned_share || 0) * 100, false)}</em></span>
      <span><small>${t('Jamais détruit')}</small><b>${big(d.total)}</b></span>
      <span><small>${t('Poids du top 10')}</small><b>${pct((d.top10_share || 0) * 100, false)}</b></span>
    </div>
    ${top ? `<div class="mc-tops">${top}</div>` : ''}`;
}

/** Le chiffre qui monte jusqu'à sa valeur (une fois, et pas si on réduit les animations). */
function countUp(el) {
  const to = Number(el.dataset.mcTo) || 0;
  if (counted || !to || matchMedia('(prefers-reduced-motion: reduce)').matches) { counted = true; return; }
  counted = true;
  const t0 = performance.now(), dur = 1100;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    el.textContent = big(to * (1 - Math.pow(1 - k, 3)));
    if (k < 1 && el.isConnected) requestAnimationFrame(step);
    else el.textContent = big(to);
  };
  requestAnimationFrame(step);
}

function fill(box, fresh) {
  if (!box?.isConnected) return;
  if (!last?.data) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = html(last.data);
  box.classList.toggle('mc-anim', fresh);
  const big = box.querySelector('.mc-big');
  if (fresh && big) countUp(big);
}

/** La section à poser dans l'accueil ; `mountMarketcap` la remplit ensuite. */
export const marketcapSlot = () => `<section class="h-mc" id="h-mc"${last?.data ? '' : ' hidden'}></section>`;

export function mountMarketcap(root) {
  const box = root.querySelector('#h-mc');
  if (!box) return;
  const fresh = !counted;
  if (last?.data) fill(box, fresh);
  if (asking) return;
  asking = send({ type: 'ronote:neuronal-marketcap' }).catch(() => null).then((res) => {
    asking = null;
    if (res?.data) {
      const changed = !last?.data || last.data.at !== res.data.at;
      last = res;
      if (changed) fill(root.querySelector('#h-mc'), !counted);
    } else if (!last?.data) fill(root.querySelector('#h-mc'), false);
  });
}
