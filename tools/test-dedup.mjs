// Test d'intégration du moteur anti-doublon (aucune dépendance, aucun réseau).
// Usage : node tools/test-dedup.mjs
import { pollStream } from '../src/background/streams.js';

let pages = {};                    // ce que "l'API" renvoie pour chaque flux
globalThis.fetch = async (url) => {
  const type = /\/trades\/(\w+)\?/.exec(url)?.[1];
  const data = (pages[type] || []).map(t => ({ ...t }));
  return { ok: true, status: 200, json: async () => ({ data }) };
};

const trade = (id, userId, name) => ({ id, user: { id: userId, name, displayName: name }, created: new Date(1700000000000 + id * 1000).toISOString() });

// Trade daté explicitement, en minutes autour de T0 : les ids Roblox ne disent
// rien de l'ordre de création.
const T0 = Date.parse('2026-09-10T08:00:00Z');
const at = (id, minutes, name = 'Dana') => ({ id, user: { id: 3, name, displayName: name }, created: new Date(T0 + minutes * 60000).toISOString() });

let passed = 0, failed = 0;
function check(label, got, expected) {
  const g = JSON.stringify(got), e = JSON.stringify(expected);
  if (g === e) { console.log(`  ✓ ${label}`); passed++; }
  else { console.error(`  ✗ ${label}\n      attendu ${e}\n      obtenu  ${g}`); failed++; }
}

const streams = {};
const poll = async (kind, s = streams) => (await pollStream(kind, s)).fresh.map(t => t.id);

console.log('\nFlux « Reçus » (Inbound)');

// 1. Première exécution : on photographie l'existant, silence total.
pages.Inbound = [trade(102, 7, 'Bob'), trade(101, 5, 'Alice'), trade(100, 5, 'Alice')];
check('1er démarrage : aucune alerte pour les trades déjà présents', await poll('inbound'), []);

// 2. Rien n'a bougé.
check('poll suivant sans changement : rien', await poll('inbound'), []);

// 3. LE BUG CLASSIQUE : je refuse le trade du haut, celui du dessous remonte.
pages.Inbound = [trade(101, 5, 'Alice'), trade(100, 5, 'Alice')];
check('trade refusé : celui du dessous ne re-notifie PAS', await poll('inbound'), []);

// 4. Deuxième refus d'affilée.
pages.Inbound = [trade(100, 5, 'Alice')];
check('2e refus consécutif : toujours rien', await poll('inbound'), []);

// 5. Un vrai nouveau trade, du même utilisateur qui en avait déjà un.
pages.Inbound = [trade(103, 5, 'Alice'), trade(100, 5, 'Alice')];
check('nouveau trade du MÊME utilisateur : détecté', await poll('inbound'), [103]);
check('le même trade n\'est pas renotifié au poll suivant', await poll('inbound'), []);

// 6. Deux trades du même utilisateur arrivés entre deux vérifications.
pages.Inbound = [trade(105, 5, 'Alice'), trade(104, 5, 'Alice'), trade(103, 5, 'Alice'), trade(100, 5, 'Alice')];
check('2 trades du même utilisateur d\'un coup : les 2 détectés, dans l\'ordre', await poll('inbound'), [104, 105]);

// 7. J'accepte tout : la liste se vide, puis un nouveau trade arrive.
pages.Inbound = [];
check('boîte vidée : rien', await poll('inbound'), []);
pages.Inbound = [trade(106, 9, 'Carl')];
check('trade reçu sur boîte vide : détecté', await poll('inbound'), [106]);

// 8. Réapparition d'un ancien id (ne doit jamais alerter).
pages.Inbound = [trade(106, 9, 'Carl'), trade(100, 5, 'Alice')];
check('vieux trade qui réapparaît : ignoré', await poll('inbound'), []);

console.log('\nIdentifiants Roblox sans ordre');

// LA PANNE DE 2.9.x : Roblox numérote ses trades sans ordre. Un nouveau trade
// dont l'id est plus petit que le plus grand déjà vu était écarté en silence.
const rnd = {};
pages.Inbound = [at(4501633519175397, 0), at(2210708244976924, -5)];
await poll('inbound', rnd);
pages.Inbound = [at(399109840311814, 3), at(4501633519175397, 0), at(2210708244976924, -5)];
check('nouveau trade à l\'id plus petit que tous les autres : détecté', await poll('inbound', rnd), [399109840311814]);
check('rien n\'est compté comme ancien', rnd.inbound.belowMark, 0);

pages.Inbound = [at(1000, 10), at(3000000000000000, 8), ...pages.Inbound];
check('2 nouveaux trades : dans l\'ordre de création, pas des ids', await poll('inbound', rnd), [3000000000000000, 1000]);

pages.Inbound = [at(77, 4), ...pages.Inbound];
check('trade apparu en retard (créé avant le dernier vu) : détecté', await poll('inbound', rnd), [77]);

console.log('\nMise à jour depuis 2.9.x');

// Flux enregistré par l'ancienne version : un watermark, pas de date, et un
// compteur qui mélangeait anciens trades et nouveaux trades perdus.
const old = { inbound: { seen: [4501633519175397, 2210708244976924], watermark: 4501633519175397, seededAt: 1, belowMark: 26 } };
pages.Inbound = [at(399109840311814, 3), at(4501633519175397, 0), at(2210708244976924, -5), at(55, -300)];
check('premier passage : le nouveau trade alerte, l\'ancien jamais vu non', await poll('inbound', old), [399109840311814]);
check('compteur des anciens remis à zéro puis compté juste', old.inbound.belowMark, 1);
check('date de référence posée, watermark oublié', [old.inbound.newest, 'watermark' in old.inbound], [T0 + 3 * 60000, false]);

console.log('\nFlux « Complétés » (Completed)');

// Photographie initiale.
pages.Completed = [trade(500, 5, 'Alice'), trade(499, 7, 'Bob')];
check('1er démarrage : silence', await poll('completed'), []);

// Un trade ANCIEN (id 300) se finalise APRÈS un plus récent : un simple
// « plus grand id vu » l'aurait raté. L'ensemble des ids vus le rattrape.
pages.Completed = [trade(500, 5, 'Alice'), trade(499, 7, 'Bob'), trade(300, 9, 'Carl')];
check('trade ancien complété hors ordre : détecté quand même', await poll('completed'), [300]);
check('pas de doublon au poll suivant', await poll('completed'), []);

// Deux finalisations du même partenaire en même temps.
pages.Completed = [trade(502, 5, 'Alice'), trade(501, 5, 'Alice'), trade(500, 5, 'Alice'), trade(499, 7, 'Bob'), trade(300, 9, 'Carl')];
check('2 trades complétés du même utilisateur : les 2 détectés', await poll('completed'), [501, 502]);

// Un trade créé il y a une semaine qui se termine aujourd'hui : sa date de
// création ne doit pas le faire écarter.
pages.Completed = [at(12, -7 * 24 * 60), ...pages.Completed];
check('trade créé il y a une semaine, complété maintenant : détecté', await poll('completed'), [12]);

console.log('\nRobustesse');

// Le plafond d'ids mémorisés ne doit pas provoquer de re-notification.
const big = {};
pages.Inbound = Array.from({ length: 100 }, (_, i) => at(10000 - i, -i));
await pollStream('inbound', big);
check('date de référence : la création la plus récente vue', big.inbound.newest, T0);
big.inbound.seen = [];  // simulation d'une purge complète du cache
pages.Inbound = [at(9990, -600), at(9989, -601)];
check('cache purgé : les anciens trades qui remontent n\'alertent pas', await poll('inbound', big), []);
check('… mais ils sont comptés', big.inbound.belowMark, 2);

// Une réponse vide/malformée ne doit jamais générer d'alerte.
globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
check('réponse API vide : aucune alerte', await poll('inbound'), []);

console.log(`\n${passed} réussis, ${failed} échoués.`);
process.exit(failed ? 1 : 0);
