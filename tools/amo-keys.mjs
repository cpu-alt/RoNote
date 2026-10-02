// Branche la publication automatique sur addons.mozilla.org, en une commande :
//
//     node tools/amo-keys.mjs
//
// Demande les deux clés d'API de https://addons.mozilla.org/developers/addon/api/key/
// et les enregistre dans les secrets GitHub (AMO_JWT_ISSUER, AMO_JWT_SECRET) avec
// `gh secret set`. Rien n'est affiché ni écrit sur le disque. À partir de là, chaque
// tag vX.Y.Z envoie aussi la version Firefox. Voir docs/publication-auto.md.
import { spawnSync } from 'node:child_process';
import readline from 'node:readline';

function ask(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = s => { if (s.includes(question)) rl.output.write(s); else if (!/[\r\n]/.test(s)) rl.output.write('*'); };
    rl.question(question, answer => { rl.close(); process.stdout.write('\n'); resolve(answer.trim()); });
  });
}

function gh(args, input) {
  const r = spawnSync('gh', args, { input, encoding: 'utf-8', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error(`gh ${args.slice(0, 3).join(' ')} : ${(r.stderr || r.error || '').toString().trim()}`);
}

async function main() {
  gh(['auth', 'status']);
  console.log('Publication automatique RoNote → Firefox Add-ons\n');
  console.log('Les deux clés sont sur https://addons.mozilla.org/developers/addon/api/key/');
  console.log('(clic droit ou Ctrl+V pour coller ; la saisie s\'affiche en étoiles)\n');
  const issuer = await ask('Émetteur JWT (user:…) : ');
  const secret = await ask('Secret JWT : ');
  if (!/^user:\d+:\d+$/.test(issuer)) throw new Error('L\'émetteur JWT doit ressembler à « user:12345678:123 ».');
  if (secret.length < 32) throw new Error('Le secret JWT est vide ou trop court : le collage n\'est pas passé.');
  gh(['secret', 'set', 'AMO_JWT_ISSUER'], issuer);
  gh(['secret', 'set', 'AMO_JWT_SECRET'], secret);
  console.log('✅ Secrets GitHub enregistrés : AMO_JWT_ISSUER, AMO_JWT_SECRET');
  console.log('Le prochain tag vX.Y.Z enverra aussi la version Firefox.');
}

main().catch(e => { console.error(`\n❌ ${e.message}`); process.exit(1); });
