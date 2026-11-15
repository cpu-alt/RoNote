// Le proof de plusieurs trades (src/common/proof-merge.js) : les cinq lignes d'un lot.
import assert from 'node:assert/strict';
import { mergeProof, groupLabels, gapNote } from '../src/common/proof-merge.js';

let n = 0;
const check = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };
console.log('Proof de plusieurs trades');

const t1 = { labels: [['Dominus Empyreus (DE)'], ['Valkyrie Helm (VH)', '500 Robux']], values: [100000, 90000], sender: 'bob', receiver: 'wars_choing', date: '11/14/2026' };
const t2 = { labels: [['Dominus Empyreus (DE)', 'Sparkle Time Fedora (STF)'], ['Clockwork Headphones']], values: [50000, 72000], sender: 'alice', receiver: 'wars_choing', date: '11/12/2026' };

check('un même objet compté, les Robux additionnés', () => {
  assert.deepEqual(groupLabels(['A', 'B', 'A', '100 Robux', '50 Robux']), ['A x2', 'B', '150 Robux']);
});
check('Item(s) : tout ce que j\'ai donné / tout ce que j\'ai reçu', () => {
  assert.equal(mergeProof([t1, t2]).items, 'Dominus Empyreus (DE) x2, Sparkle Time Fedora (STF) / Valkyrie Helm (VH), Clockwork Headphones, 500 Robux');
});
check('Values : les totaux et l\'écart', () => {
  assert.equal(mergeProof([t1, t2]).values, '150k vs 162k (12k op)');
  assert.equal(gapNote(10, 10), '');
});
check('un trade sans value : pas de ligne Values', () => {
  assert.equal(mergeProof([t1, { ...t2, values: null }]).values, '');
});
check('Sender / Receiver sans doublon', () => {
  const f = mergeProof([t1, t2]);
  assert.equal(f.sender, 'bob, alice');
  assert.equal(f.receiver, 'wars_choing');
});
check('Date : la première et la dernière, dans l\'ordre', () => {
  assert.equal(mergeProof([t1, t2]).date, '11/12/2026 - 11/14/2026');
  assert.equal(mergeProof([t1, { ...t2, date: '11/14/2026' }]).date, '11/14/2026');
});
check('un seul trade : comme un proof normal', () => {
  const f = mergeProof([t1]);
  assert.equal(f.items, 'Dominus Empyreus (DE) / Valkyrie Helm (VH), 500 Robux');
  assert.equal(f.values, '100k vs 90k (10k lb)');
});
console.log(`\n${n} vérifications, tout est bon.`);
