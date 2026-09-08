// Tests du suivi des trades envoyés et du chaînage des contre-offres.
// Aucune dépendance, aucun réseau. Usage : node tools/test-tracker.mjs
import { pollStream, directionOf, markSeen } from '../src/background/streams.js';
import {
  normStatus, resolveTracked, isFinal, OUTCOMES,
  noteCounterFromPartner, noteCounterByMe, takeHint, purgeHints
} from '../src/background/tracker.js';

let passed = 0, failed = 0;
function check(label, got, expected) {
  const g = JSON.stringify(got), e = JSON.stringify(expected);
  if (g === e) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}\n      attendu ${e}\n      obtenu  ${g}`); failed++; }
}

const trade = (id, userId, name, status) => ({
  id, user: { id: userId, name, displayName: name },
  created: new Date(1700000000000 + id * 1000).toISOString(), status
});

console.log('\nNormalisation des statuts Roblox');
check('"RejectedDueToError"', normStatus('RejectedDueToError'), 'RejectedDueToError');
check('"Rejected due to an error" (libellé de la page)', normStatus('Rejected due to an error'), 'RejectedDueToError');
check('casse et espaces indifférents', normStatus('  countered '), 'Countered');
check('"Completed"', normStatus('Completed'), 'Completed');
check('"InterventionRequired"', normStatus('InterventionRequired'), 'InterventionRequired');
check('statut vide', normStatus(undefined), 'Unknown');
check('un statut ouvert n\'est pas final', isFinal(normStatus('Open')), false);
check('un rejet est final', isFinal(normStatus('RejectedDueToError')), true);
check('chaque issue a un libellé', Object.keys(OUTCOMES).every(k => !!OUTCOMES[k].title), true);

console.log('\nRésolution des trades suivis');
{
  const tracked = { 10: { auto: false }, 11: { auto: true }, 12: { auto: true }, 13: { auto: true } };
  const open = new Set([10]);                       // #10 est toujours dans Outbound
  const details = {
    11: { id: 11, status: 'Declined' },
    12: { id: 12, status: 'Open' },                 // absent de la page 1 mais toujours actif
    13: { id: 13, status: 'Completed' }
  };
  const res = await resolveTracked(tracked, open, async (id) => {
    if (!details[id]) throw new Error('404');
    return details[id];
  });
  check('trade encore listé : aucun appel, aucune conclusion', res.some(r => r.tradeId === 10), false);
  check('trade refusé : détecté', res.find(r => r.tradeId === 11)?.status, 'Declined');
  check('trade hors page mais encore ouvert : PAS de fausse conclusion', res.some(r => r.tradeId === 12), false);
  check('trade accepté : détecté', res.find(r => r.tradeId === 13)?.status, 'Completed');
}
{
  const res = await resolveTracked({ 20: {} }, new Set(), async () => { throw new Error('réseau'); });
  check('erreur réseau : on ne conclut rien, on retentera', res, []);
}

console.log('\nDirection d\'un trade (sans appel réseau)');
{
  const streams = { inbound: { seen: [100, 101] }, outbound: { seen: [200] } };
  check('id vu dans Outbound = trade envoyé', directionOf(streams, 200), 'outbound');
  check('id vu dans Inbound = trade reçu', directionOf(streams, 100), 'inbound');
  check('id inconnu (antérieur à l\'installation)', directionOf(streams, 999), null);
}

console.log('\nChaînage des contre-offres');
{
  const WINDOW = 90 * 60000;
  const hints = {};
  noteCounterFromPartner(hints, 5, 700, 2);
  const h = takeHint(hints, 5, WINDOW);
  check('la contre-offre est rattachée au trade envoyé', h.fromOutbound, 700);
  check('l\'indice est consommé une seule fois', takeHint(hints, 5, WINDOW), null);

  const old = { 7: { fromOutbound: 1, at: Date.now() - 3 * 3600e3 } };
  check('indice expiré : ignoré', takeHint(old, 7, WINDOW), null);
  check('indice expiré : nettoyé', Object.keys(purgeHints({ 7: { at: 0 } }, WINDOW)).length, 0);

  const mine = {};
  noteCounterByMe(mine, 9, 300, 1);
  check('mon contre est mémorisé pour auto-suivre mon nouvel envoi', takeHint(mine, 9, WINDOW).fromInbound, 300);
}

console.log('\nScénario complet : je contre, il re-contre');
{
  // Le scénario reproduit l'enchaînement réel des flux, dans l'ordre où le
  // service worker les traite : Inactive -> Outbound -> Inbound.
  const WINDOW = 90 * 60000;
  const streams = {};
  const state = { tracked: {}, counterHints: {}, myCounters: {}, links: {} };
  const settings = { autoTrackOutbound: false, autoTrackCounters: true };
  const pages = { Inbound: [], Outbound: [], Inactive: [], Completed: [] };
  globalThis.fetch = async (url) => {
    const type = /\/trades\/(\w+)\?/.exec(url)?.[1];
    return { ok: true, status: 200, json: async () => ({ data: (pages[type] || []).map(t => ({ ...t })) }) };
  };
  const details = {};

  // État initial : Bob (id 5) m'a envoyé le trade #400, je l'ai en boîte.
  pages.Inbound = [trade(400, 5, 'Bob')];
  await pollStream('inbound', streams);
  await pollStream('outbound', streams);
  await pollStream('inactive', streams);

  // --- Je contre le trade #400 : il devient "Countered", mon contre = #401 ---
  pages.Inbound = [];
  pages.Inactive = [trade(400, 5, 'Bob', 'Countered')];
  pages.Outbound = [trade(401, 5, 'Bob', 'Open')];

  // 1) Inactive : le trade #400 est un trade REÇU passé en Countered -> c'est moi qui ai contré.
  for (const t of (await pollStream('inactive', streams)).fresh) {
    if (normStatus(t.status) === 'Countered' && directionOf(streams, t.id) === 'inbound') {
      noteCounterByMe(state.myCounters, t.user.id, t.id, 1);
    }
  }
  check('mon contre est détecté depuis l\'onglet Inactive', !!state.myCounters[5], true);

  // 2) Outbound : mon nouveau trade #401 est auto-suivi car il répond à #400.
  for (const t of (await pollStream('outbound', streams)).fresh) {
    const mine = takeHint(state.myCounters, t.user.id, WINDOW);
    if (settings.autoTrackOutbound || (mine && settings.autoTrackCounters)) {
      state.tracked[t.id] = { at: Date.now(), partner: t.user, auto: true, counterTo: mine?.fromInbound ?? null, round: mine ? 2 : 1 };
    }
  }
  check('mon contre-trade est suivi automatiquement', Object.keys(state.tracked), ['401']);
  check('le lien vers le trade d\'origine est conservé', state.tracked[401].counterTo, 400);

  // --- Bob re-contre : #401 passe en Countered, son nouveau trade #402 arrive ---
  pages.Outbound = [];
  details[401] = { id: 401, status: 'Countered', user: { id: 5, name: 'Bob' } };
  const resolutions = await resolveTracked(state.tracked, new Set(), async (id) => details[id]);
  check('la fin de mon contre-trade est détectée', resolutions[0]?.status, 'Countered');
  for (const r of resolutions) {
    delete state.tracked[r.tradeId];
    markSeen(streams, 'inactive', [r.tradeId]);
    markSeen(streams, 'completed', [r.tradeId]);
    noteCounterFromPartner(state.counterHints, 5, r.tradeId, (r.meta.round || 1) + 1);
  }
  check('le trade résolu est marqué vu (pas de double alerte via Inactive)', streams.inactive.seen.includes(401), true);

  // 3) Inbound : sa contre-offre #402 arrive et se rattache toute seule.
  pages.Inbound = [trade(402, 5, 'Bob')];
  const fresh = (await pollStream('inbound', streams)).fresh;
  const hint = takeHint(state.counterHints, fresh[0].user.id, WINDOW);
  check('la contre-offre entrante est détectée', fresh.map(t => t.id), [402]);
  check('elle est reconnue comme contre-offre, pas comme trade quelconque', !!hint, true);
  check('rattachée au bon trade', hint.fromOutbound, 401);
  check('3ᵉ échange de la négociation', hint.round, 3);
}

console.log('\nErreurs Roblox (onglet Inactive)');
{
  const streams = { inbound: { seen: [800] }, outbound: { seen: [801] } };
  const rows = [trade(800, 5, 'Bob', 'RejectedDueToError'), trade(801, 5, 'Bob', 'Rejected due to an error')];
  const found = rows.map(t => ({ dir: directionOf(streams, t.id), st: normStatus(t.status) }));
  check('rejet sur un trade reçu', found[0], { dir: 'inbound', st: 'RejectedDueToError' });
  check('rejet sur un trade envoyé (autre orthographe)', found[1], { dir: 'outbound', st: 'RejectedDueToError' });
}

console.log(`\n${passed} réussis, ${failed} échoués.`);
process.exit(failed ? 1 : 0);
