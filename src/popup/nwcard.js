/**
 * ==========================================================================
 *  LA CARTE D'UN TRADE NEURONAL
 * --------------------------------------------------------------------------
 *  Un trade du réseau dessiné comme sur neuronal.live : deux côtés, chacun
 *  avec les vignettes de ses objets, leur value, ses Robux et son total. Sert
 *  aux fiches joueur et objet du popup et à l'onglet Profils. Les vignettes
 *  viennent de la réponse de neuronal.live (`thumb`) : aucun appel à Roblox.
 *  Un clic sur un objet ouvre sa page Rolimon's (`data-open`, un seul écouteur dans popup.js).
 *
 *  `tr` : un trade de /ext/v1 (`gave_items`, `got_items`, `gave`, `got`…).
 *  `mine` : vu d'un joueur (« Donné / Reçu » et son gain) ; sinon A → B.
 * ==========================================================================
 */
import { t } from '../common/i18n.js';
import { fmtNum, fmtSigned, timeAgo, escapeHtml, toneOf } from '../common/utils.js';

const who = (p) => escapeHtml(p?.name || (p?.id ? '#' + p.id : '?'));

/** Les objets d'une annonce ou d'un côté de trade, en vignettes. */
export function nwTilesHtml(items, more = 0, robux = 0) {
  const tiles = (items || []).map(it => {
    const img = it.thumb
      ? `<img src="${escapeHtml(it.thumb)}" alt="" loading="lazy">`
      : `<span class="nc-ph">${escapeHtml((it.name || '?').slice(0, 2))}</span>`;
    // `roli` : la page que donne Neuronal (l'ancien id d'une face, /bundle/ pour un autre bundle)
    const roli = /^https:\/\/www\.rolimons\.com\/(item|bundle)\/\d+$/.test(it.roli || '') ? it.roli : `https://www.rolimons.com/item/${Number(it.id)}`;
    // 24 nov. : en trade-hold chez lui (« 1d 4h » restant, ou true si Roblox dit seulement oui)
    // 24 nov. : `gone` = reçu puis déjà reparti de son inventaire
    const hold = it.gone ? ' · ' + t('plus dans son inventaire')
      : it.hold ? ' · ⏳ ' + (it.hold === true ? t('en hold') : t('en hold ({d})', { d: it.hold })) : '';
    return `<button class="nc-it${it.gone ? ' nc-gone' : it.hold ? ' nc-hold' : ''}" data-open="${roli}" title="${escapeHtml((it.name || '#' + it.id) + (it.value ? ' · ' + fmtNum(it.value) : '') + hold)}">
      ${img}${it.n > 1 ? `<i class="nc-n">×${it.n}</i>` : ''}${it.hold && !it.gone ? '<i class="nc-hg" aria-hidden="true">⏳</i>' : ''}<span class="nc-v">${it.value ? fmtNum(it.value) : 'N/A'}</span></button>`;
  });
  if (more > 0) tiles.push(`<span class="nc-more">+${more}</span>`);
  if (robux > 0) tiles.push(`<span class="nc-rbx">R$ ${fmtNum(robux)}</span>`);
  return `<div class="nc-tiles">${tiles.join('') || '<span class="nc-none">N/A</span>'}</div>`;
}

/**
 * La variante compacte (fiches Profils, 18 nov.) : une ligne d'en-tête (avec qui, quand, le gain), puis
 * les deux côtés en petites vignettes séparés d'une flèche, leur total au-dessus. Rien d'autre.
 */
export function nwTradeLine(tr) {
  if (!tr) return '';
  const delta = (tr.got || 0) - (tr.gave || 0);
  const side = (label, cls, items, more, robux, total) => `<div class="ncl-s"><b><small class="pf-adl ${cls}">${t(label)}</small> ${total ? fmtNum(total) : 'N/A'}</b>${nwTilesHtml(items, more, robux)}</div>`;
  return `<div class="ncl">
    <div class="ncl-h"><span class="ncl-k done">✓ ${t('Trade fait')}</span><span class="nc-who">${t('avec {who}', { who: `<b>${who(tr.partner)}</b>` })}</span>
      ${tr.parts > 1 ? `<span class="nw-tag">mass ×${tr.parts}</span>` : ''}
      <span class="nc-ago">${tr.at ? timeAgo(tr.at * 1000) : ''}</span>
      ${tr.got || tr.gave ? `<span class="jr-pill ${toneOf(delta)}">${fmtSigned(delta)}</span>` : ''}</div>
    <div class="ncl-sides">${side('A donné', 'loss', tr.gave_items, tr.gave_more, tr.gave_robux, tr.gave)}<span class="ncl-ar">→</span>${side('A reçu', 'win', tr.got_items, tr.got_more, tr.got_robux, tr.got)}</div>
  </div>`;
}

export function nwTradeCard(tr, mine = false) {
  if (!tr) return '';
  const side = (label, items, more, robux, total) => `<div class="nc-side">
    <div class="nc-lbl"><span>${label}</span><b>${total ? fmtNum(total) : 'N/A'}</b></div>
    ${nwTilesHtml(items, more, robux)}</div>`;
  const delta = (tr.got || 0) - (tr.gave || 0);
  const head = mine
    ? t('avec {who}', { who: `<b>${who(tr.partner)}</b>` })
    : `<b>${who(tr.a)}</b> → <b>${who(tr.b)}</b>`;
  return `<div class="nc">
    <div class="nc-h"><span class="nc-who">${head}</span>
      ${tr.parts > 1 ? `<span class="nw-tag">mass ×${tr.parts}</span>` : ''}
      ${tr.via_ronote ? `<span class="nw-tag nw-tag-ro" title="${escapeHtml(t('Trade confirmé par un utilisateur RoNote'))}">RoNote</span>` : ''}
      <span class="nc-ago">${tr.at ? timeAgo(tr.at * 1000) : ''}</span>
      ${mine && (tr.got || tr.gave) ? `<span class="jr-pill ${toneOf(delta)}">${fmtSigned(delta)}</span>` : ''}</div>
    <div class="nc-sides">
      ${side(mine ? t('Donné') : who(tr.a), tr.gave_items, tr.gave_more, tr.gave_robux, tr.gave)}
      ${side(mine ? t('Reçu') : who(tr.b), tr.got_items, tr.got_more, tr.got_robux, tr.got)}
    </div>
  </div>`;
}
