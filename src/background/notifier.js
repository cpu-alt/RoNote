import { B, HAS_OFFSCREEN, IS_FIREFOX, safe } from '../common/shim.js';
import { playToneInPage } from '../common/tones.js';
import { SOUND_GROUPS, soundGroupOf } from '../common/defaults.js';
import { fmtNum, fmtPct, inQuietHours, sleep } from '../common/utils.js';
import { verdict } from '../common/analysis.js';
import { getState, setState } from '../common/state.js';
import { TRADE_URL, TAB_URL } from '../common/api.js';
import { BASIS_SHORT } from '../common/roli.js';
import { t, p as plural } from '../common/i18n.js';

const FALLBACK_ICON = B.runtime.getURL('icons/icon128.png');

/* ------------------------------- son ---------------------------------- */

const OFFSCREEN_URL = 'offscreen/offscreen.html';
let creating = null;   // creation en cours : deux sons rapproches ne la doublent pas

/** Le document offscreen existe-t-il ENCORE ? (null = impossible a savoir) */
async function hasOffscreen() {
  try {
    const ctxs = await chrome.runtime.getContexts?.({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    return Array.isArray(ctxs) ? ctxs.length > 0 : null;
  } catch { return null; }
}

/**
 * Chrome FERME de lui-meme un document offscreen ouvert pour de l'audio des
 * qu'il n'a rien joue pendant 30 s. L'ancien drapeau « deja cree » restait
 * vrai apres cette fermeture : le message partait dans le vide, et le son
 * manquait une fois sur deux. On demande donc au navigateur, a chaque fois,
 * si le document est toujours la — et on le recree sinon.
 */
async function ensureOffscreen({ recreate = false } = {}) {
  if (!HAS_OFFSCREEN) return false;
  const present = await hasOffscreen();
  if (present && !recreate) return true;
  if (present) await safe(() => chrome.offscreen.closeDocument());
  if (!creating) {
    creating = chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ['AUDIO_PLAYBACK'],
      justification: "Jouer le son d'alerte lors d'un evenement de trade."
    }).then(
      () => true,
      (e) => String(e?.message || e).includes('Only a single offscreen')
    ).finally(() => { creating = null; });
  }
  return creating;
}

async function playOffscreen(sound, volume) {
  const msg = { type: 'ronote:play-sound', sound, volume };
  for (let attempt = 0; attempt < 3; attempt++) {
    // Dernier essai : on repart d'un document neuf, au cas ou l'existant
    // serait la sans ecouter (script pas charge, page en erreur).
    if (!(await ensureOffscreen({ recreate: attempt === 2 }))) return false;
    const r = await safe(() => B.runtime.sendMessage(msg), null);
    if (r?.ok) return true;
    // Document tout juste cree : son ecouteur n'est pas encore en place.
    await sleep(250 * (attempt + 1));
  }
  return false;
}

/** Repli quand offscreen n'existe pas (Firefox) : on joue le son dans un onglet. */
async function playViaTab(sound, volume) {
  if (!B.tabs?.query || !B.scripting?.executeScript) return false;
  const tabs = await safe(() => B.tabs.query({ url: ['*://*.roblox.com/*', 'http://*/*', 'https://*/*'] }), []);
  const candidates = (tabs || []).filter(t => t.id && !t.discarded).sort((a, b) => {
    const ra = /roblox\.com/.test(a.url || '') ? 0 : 1;
    const rb = /roblox\.com/.test(b.url || '') ? 0 : 1;
    return ra - rb || (b.active ? 1 : 0) - (a.active ? 1 : 0);
  });
  for (const t of candidates.slice(0, 3)) {
    const r = await safe(() => B.scripting.executeScript({
      target: { tabId: t.id }, args: [sound, volume], func: playToneInPage
    }), null);
    if (r?.[0]?.result) return true;
  }
  return false;
}

/**
 * Joue UN son. Sans `name`, celui des trades recus.
 * `force` : jouer meme si le son est desactive (bouton d'ecoute des reglages).
 * @returns true si un son est reellement parti.
 */
export async function playSound(settings, name = null, { force = false } = {}) {
  if (!settings.sound && !force) return false;
  const sound = name || settings.sounds?.inbound || 'chime';
  if (sound === 'none') return false;
  const vol = settings.volume ?? 0.6;
  if (await playOffscreen(sound, vol)) return true;
  return playViaTab(sound, vol);
}

/**
 * Les sons d'un passage : une famille = un son, joues a la suite dans un
 * ordre fixe (recu, accepte, erreur, refuse). Un trade recu et un trade
 * accepte dans le meme passage donnent donc deux sons distincts.
 */
export async function playSoundsFor(kinds, settings) {
  if (!settings.sound) return 0;
  const groups = new Set((kinds || []).map(soundGroupOf));
  let played = 0;
  for (const g of SOUND_GROUPS) {
    if (!groups.has(g)) continue;
    const sound = settings.sounds?.[g] || 'none';
    if (sound === 'none') continue;
    if (played) await sleep(1100);
    if (await playSound(settings, sound)) played++;
  }
  return played;
}

/* ------------------------------ icones -------------------------------- */

const ICON_CAP = 60;
const iconCache = new Map();   // url -> data: URL (ou null si irrecuperable)

/**
 * Chrome n'accepte pour icone qu'une ressource de l'extension, un blob ou un
 * data: URL. Donner l'URL du portrait sur le CDN Roblox faisait echouer la
 * creation « riche » de la notification, qui repartait alors en version
 * degradee (icone generique, sans boutons) — quand elle ne prenait pas
 * plusieurs secondes a echouer. On telecharge donc le portrait nous-memes.
 */
async function iconData(url) {
  if (!url) return null;
  if (iconCache.has(url)) return iconCache.get(url);
  const data = await safe(async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    try {
      const r = await fetch(url, { signal: ctrl.signal });
      if (!r.ok) return null;
      const buf = new Uint8Array(await r.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 0x8000) {
        bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      }
      return `data:${r.headers.get('content-type') || 'image/png'};base64,${btoa(bin)}`;
    } finally { clearTimeout(timer); }
  }, null);
  if (iconCache.size >= ICON_CAP) iconCache.delete(iconCache.keys().next().value);
  iconCache.set(url, data);
  return data;
}

/* --------------------------- notifications ----------------------------- */

async function create(id, opts) {
  // Firefox refuse les proprietes qu'il ne connait pas : on degrade proprement.
  const base = {
    type: 'basic',
    iconUrl: opts.iconUrl || FALLBACK_ICON,
    title: opts.title,
    message: opts.message
  };
  const rich = IS_FIREFOX ? base : {
    ...base,
    contextMessage: opts.contextMessage,
    requireInteraction: !!opts.requireInteraction,
    silent: true,                 // on gere le son nous-memes
    priority: opts.priority ?? 1,
    buttons: opts.buttons
  };
  try {
    await B.notifications.create(id, rich);
    return true;
  } catch (e) {
    console.debug('[RoNote] notification riche refusée :', e?.message || e);
    try {
      await B.notifications.create(id, { ...base, iconUrl: FALLBACK_ICON });
      return true;
    } catch (e2) {
      console.warn('[RoNote] notification impossible :', e2?.message || e2);
      return false;
    }
  }
}

/**
 * Chaque type d'evenement : icone, titre, et point de vue a afficher.
 * `mine` = ce que je donne, `theirs` = ce que je recois.
 */
export const KIND_META = {
  inbound:            { icon: '📥', title: 'Nouveau trade reçu',      prio: 2 },
  counter:            { icon: '🔄', title: 'Contre-offre reçue',      prio: 2 },
  completed:          { icon: '✅', title: 'Trade complété',          prio: 1 },
  outbound_accepted:  { icon: '🎉', title: 'Ton trade a été accepté', prio: 2 },
  outbound_declined:  { icon: '❌', title: 'Ton trade a été refusé',  prio: 1 },
  outbound_countered: { icon: '🔄', title: 'Ton trade a été contré',  prio: 2 },
  outbound_expired:   { icon: '⏳', title: 'Ton trade a expiré',      prio: 1 },
  trade_error:        { icon: '⚠️', title: 'Trade rejeté (erreur Roblox)', prio: 2 }
};

function itemsLine(side, max = 3) {
  const names = side.items.map(i => i.unknown ? `${i.name} ❔` : i.name);
  const shown = names.slice(0, max).join(', ');
  const rest = names.length > max ? ` +${names.length - max}` : '';
  const rbx = side.robux > 0 ? `${names.length ? ' + ' : ''}R$ ${fmtNum(side.robux)}` : '';
  return (shown + rest + rbx) || '—';
}

/**
 * @param card {kind, tradeId, partner, headshot, analysis, url, counterTo, round}
 */
export async function notifyTrade(card, settings) {
  if (!settings.desktopNotifications) return null;
  if (inQuietHours(settings.quietHours) && !settings.quietHours.stillNotify) return null;

  const meta = KIND_META[card.kind] || KIND_META.inbound;
  const a = card.analysis;
  const v = a ? verdict(a) : null;
  const partner = card.partner?.displayName || card.partner?.name || t('Joueur inconnu');
  const id = `ronote:${card.kind}:${card.tradeId}`;
  const done = card.kind === 'outbound_accepted' || card.kind === 'completed';

  const lines = [];
  if (a && settings.showItems) {
    const received = t(done ? 'Tu as reçu' : 'Il donne');
    const given = t(done ? 'Tu as donné' : 'Vous donnez');
    lines.push(`${received} : ${itemsLine(a.get)}`);
    lines.push(`${given} : ${itemsLine(a.give)}`);
  } else {
    lines.push(t('Trade #{id} avec {who}', { id: card.tradeId, who: partner }));
  }
  if (card.counterTo) {
    lines.push(card.round > 1
      ? t('↩ {n}ᵉ contre-offre de la négociation (trade #{id})', { n: card.round, id: card.counterTo })
      : t('↩ En réponse à ton trade #{id}', { id: card.counterTo }));
  }

  let contextMessage;
  if (a && a.incomplete) {
    // Une cote manque (visage, objet de bundle...) : on annonce l'incertitude
    // au lieu de presenter un ecart calcule sur des totaux amputes.
    contextMessage = `${v.icon} ${t(v.label)} — ` +
      t('total incomplet · connu : reçu {a} vs donné {b}', { a: fmtNum(a.mainGet), b: fmtNum(a.mainGive) });
  } else if (a && a.divergent) {
    // La cote communautaire et les ventes reelles se contredisent : on montre
    // les deux plutot que d'en choisir une.
    contextMessage = `${v.icon} ${t(v.label)} · ` +
      t('Value {a} vs RAP {b}', { a: fmtPct(a.pctValue), b: fmtPct(a.pctRap) });
  } else if (a) {
    const flags = [
      a.projectedIncoming ? '⚠️ ' + t('projected') : null,
      a.faceCount ? '🎭 ' + plural(a.faceCount, '{n} visage', '{n} visages') : null,
      a.speculativeIncoming ? '📈 ' + t('cote spéculative : très au-dessus des ventes réelles') : null,
      a.movedItems?.length ? '🔁 ' + t('cote révisée') : null,
      a.valueStale ? '⏳ ' + t('Cotes non actualisées') : null
    ].filter(Boolean);
    const rapAside = a.hasValues && a.basis === 'value' ? ` · RAP ${fmtPct(a.pctRap)}` : '';
    contextMessage = `${v.icon} ${t(v.label)} · ${t(BASIS_SHORT[a.basis] || 'Value')} ${fmtNum(a.mainGet)} vs ${fmtNum(a.mainGive)} (${fmtPct(a.pctMain)})${rapAside}`
      + (flags.length ? ' · ' + flags.join(' · ') : '');
  } else {
    contextMessage = card.statusLabel ? t(card.statusLabel) : undefined;
  }

  const buttons = card.kind === 'inbound' || card.kind === 'counter'
    ? [{ title: t('Ouvrir le trade') }, { title: t('Ignorer {who}', { who: partner }) }]
    : [{ title: t('Ouvrir le trade') }];

  // Firefox n'a pas de permission sur rbxcdn : on garde l'icone locale.
  const icon = IS_FIREFOX ? null : await iconData(card.headshot);

  await create(id, {
    title: `${meta.icon} ${t(meta.title)} — ${partner}`,
    message: lines.join('\n'),
    contextMessage,
    iconUrl: icon || FALLBACK_ICON,
    requireInteraction: settings.requireInteraction,
    priority: meta.prio,
    buttons
  });

  const st = await getState();
  st.notifMap = st.notifMap || {};
  st.notifMap[id] = {
    url: card.url || TRADE_URL(card.tradeId),
    userId: card.partner?.id ?? null,
    userName: partner,
    at: Date.now()
  };
  for (const [k, v2] of Object.entries(st.notifMap)) {
    if (Date.now() - (v2.at || 0) > 864e5) delete st.notifMap[k];  // purge > 24 h
  }
  await setState(st);
  return id;
}

const SUMMARY_TAB = {
  inbound: 'Inbound', counter: 'Inbound', completed: 'Completed',
  outbound_accepted: 'Completed', outbound_declined: 'Inactive',
  outbound_countered: 'Inactive', outbound_expired: 'Inactive', trade_error: 'Inactive'
};

export async function notifySummary(kind, count, settings) {
  if (!settings.desktopNotifications) return;
  if (inQuietHours(settings.quietHours) && !settings.quietHours.stillNotify) return;
  const meta = KIND_META[kind] || KIND_META.inbound;
  const id = `ronote:summary:${kind}:${Date.now()}`;
  await create(id, {
    title: `${meta.icon} ` + t('{n} événements', { n: count }),
    message: t('{n} × « {what} » depuis la dernière vérification.',
      { n: count, what: t(meta.title) }),
    iconUrl: FALLBACK_ICON,
    requireInteraction: false,
    priority: 1
  });
  const st = await getState();
  st.notifMap = st.notifMap || {};
  st.notifMap[id] = { url: TAB_URL(SUMMARY_TAB[kind] || 'Inbound'), at: Date.now() };
  await setState(st);
}

export async function notifySystem(title, message, tag = 'sys') {
  await create(`ronote:${tag}:${Date.now()}`, {
    title, message, iconUrl: FALLBACK_ICON, priority: 2, requireInteraction: false
  });
}

/* ------------------------------- badge --------------------------------- */

export async function setBadge(count, settings, error = false) {
  if (!B.action?.setBadgeText) return;
  await safe(() => B.action.setBadgeText({ text: error ? '!' : (settings.badge && count > 0 ? String(count > 99 ? '99+' : count) : '') }));
  await safe(() => B.action.setBadgeBackgroundColor({ color: error ? '#b3261e' : '#00a2ff' }));
  if (B.action.setBadgeTextColor) await safe(() => B.action.setBadgeTextColor({ color: '#ffffff' }));
}
