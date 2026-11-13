// Contre-offre : un objet du trade n'est déclaré « plus là » que si c'est sûr.
// Usage : node tools/test-counter.mjs
import { adopt } from '../src/common/counter-match.js';

let passed = 0, failed = 0;
const check = (label, ok) => { if (ok) { passed++; console.log('  ✓ ' + label); } else { failed++; console.error('  ✗ ' + label); } };

console.log('\nRetrouver le trade dans l\'inventaire');
{
  const inv = [{ uaid: 11, assetId: 100, serial: 5 }, { uaid: 12, assetId: 100, serial: 9 }, { uaid: 13, assetId: 200 }];
  // Le bug : inventaire tronqué (plus de 500 objets) ou bundle absent de l'API
  // des collectibles : l'objet était déclaré parti alors qu'il était là.
  const r = adopt([{ uaid: 99, assetId: 300, name: 'Dominus' }], { items: inv, complete: false });
  check('inventaire incomplet : non retrouvé ≠ parti', !r[0].gone && r[0].unsure);
  // Inventaire v2 : les visages (bundles) y sont, sous leur identifiant d'exemplaire UUID.
  const face = { uaid: '0e07e2fe-1919-4200-a856-7b85e5591d35', assetId: 0, bundleId: 77, serial: null };
  check('visage (bundle) retrouvé par son exemplaire v2', adopt([{ ...face, uaid: '0e07e2fe-1919-4200-a856-7b85e5591d35' }], { items: [...inv, face], complete: true })[0] === face);
  check('visage d’un trade v1 retrouvé par son bundle', adopt([{ uaid: 5, assetId: 0, bundleId: 77 }], { items: [...inv, face], complete: true })[0] === face);
  check('visage absent d’une liste complète : parti', adopt([{ uaid: 'x', bundleId: 77 }], { items: inv, complete: true })[0].gone === true);
  const twoFaces = adopt([{ uaid: 1, bundleId: 77 }, { uaid: 2, bundleId: 77 }],
    { items: [face, { ...face, uaid: 'aaaaaaaa-1919-4200-a856-7b85e5591d35' }], complete: true });
  check('deux exemplaires du même visage : deux objets distincts', twoFaces[0].uaid !== twoFaces[1].uaid && !twoFaces.some(f => f.gone));
  check('inventaire complet et Roblox confirme l\'absence : parti',
    adopt([{ uaid: 99, assetId: 300 }], { items: inv, complete: true, absent: ['a300'] })[0].gone === true);
  check('inventaire complet sans l\'objet : parti', adopt([{ uaid: 99, assetId: 300 }], { items: inv, complete: true })[0].gone === true);
  check('série en texte (v2) contre série en nombre', adopt([{ uaid: 'x', assetId: 100, serial: '9' }], { items: inv })[0].uaid === 12);
  check('assetId en texte retrouvé', adopt([{ uaid: 'x', assetId: '200' }], { items: inv })[0].uaid === 13);
  check('uaid en texte retrouvé exactement', adopt([{ uaid: '11', assetId: 100 }], { items: inv })[0].uaid === 11);
  const two = adopt([{ uaid: 'v2a', assetId: 100 }, { uaid: 12, assetId: 100 }], { items: inv });
  check('un doublon ne vole pas l\'exemplaire exact de l\'autre', two[0].uaid === 11 && two[1].uaid === 12);
  check('ancien format (tableau) toujours accepté', adopt([{ uaid: 13, assetId: 200 }], inv)[0].uaid === 13);
  check('inventaire vide et non vérifié : rien ne change', !adopt([{ uaid: 1, assetId: 1 }], { items: [] })[0].gone);
  const again = adopt(adopt([{ uaid: 99, assetId: 300 }], { items: inv }), { items: [...inv, { uaid: 99, assetId: 300 }] });
  check('rechargé : l\'état « non vérifié » s\'efface', again[0].uaid === 99 && !again[0].unsure);
}

console.log(`\n${passed} ok, ${failed} échec(s)`);
if (failed) process.exit(1);
