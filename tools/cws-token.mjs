// Branche la publication automatique sur le Chrome Web Store, en une commande :
//
//     node tools/cws-token.mjs [client_secret_….json]
//
// 1. lit l'ID client et le secret client OAuth dans le JSON téléchargé depuis la
//    Google Cloud Console, ou les demande ;
// 2. ouvre le navigateur : tu te connectes avec le compte du Web Store et tu autorises ;
// 3. récupère le refresh token et enregistre les trois secrets GitHub
//    (CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN) avec `gh secret set` ;
// 4. relance le workflow Release pour la version du manifeste.
//
// Le token n'est jamais affiché ni écrit sur le disque : il va directement de
// Google à `gh`. Voir docs/publication-auto.md.
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import readline from 'node:readline';

const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';

function ask(question, hidden = false) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = s => { if (s.includes(question)) rl.output.write(s); else if (!/[\r\n]/.test(s)) rl.output.write('*'); };
    }
    rl.question(question, answer => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(answer.trim()); });
  });
}

function gh(args, input) {
  const r = spawnSync('gh', args, { input, encoding: 'utf-8', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error(`gh ${args.slice(0, 3).join(' ')} : ${(r.stderr || r.error || '').toString().trim()}`);
  return r.stdout;
}

function openBrowser(url) {
  const [cmd, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref(); } catch { /* l'URL est affichée de toute façon */ }
}

// Attend le retour de Google sur http://127.0.0.1:<port>, et renvoie le code d'autorisation.
function authorize(clientId) {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const state = randomBytes(16).toString('hex');
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/') { res.writeHead(404).end(); return; }
      const ok = u.searchParams.get('state') === state && u.searchParams.get('code');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<meta charset="utf-8"><body style="font:16px system-ui;background:#0b0f19;color:#e8eef8;display:grid;place-items:center;height:90vh">
        <p>${ok ? '✅ RoNote : autorisation reçue. Tu peux fermer cet onglet et revenir au terminal.' : '❌ Autorisation refusée ou invalide. Reviens au terminal.'}</p>`);
      server.close();
      if (ok) resolve({ code: u.searchParams.get('code'), verifier, redirect: server.redirect });
      else reject(new Error(u.searchParams.get('error') || 'réponse invalide de Google'));
    });
    server.listen(0, '127.0.0.1', () => {
      server.redirect = `http://127.0.0.1:${server.address().port}`;
      const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
        client_id: clientId, redirect_uri: server.redirect, response_type: 'code', scope: SCOPE,
        access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256'
      });
      console.log('\nLe navigateur s\'ouvre : connecte-toi avec le compte du Chrome Web Store et autorise l\'accès.');
      console.log(`S'il ne s'ouvre pas, colle cette adresse dans ton navigateur :\n${url}\n`);
      openBrowser(url);
    });
    setTimeout(() => { server.close(); reject(new Error('pas de réponse après 5 minutes')); }, 5 * 60 * 1000).unref();
  });
}

async function main() {
  gh(['auth', 'status']);
  const version = JSON.parse(readFileSync(new URL('../src/manifest.json', import.meta.url), 'utf-8')).version;

  console.log('Publication automatique RoNote → Chrome Web Store\n');
  // Le JSON téléchargé depuis la Google Cloud Console, ou saisie à la main.
  let clientId, clientSecret;
  if (process.argv[2]) {
    const c = JSON.parse(readFileSync(process.argv[2], 'utf-8'));
    ({ client_id: clientId, client_secret: clientSecret } = c.installed || c.web || {});
    clientId = (clientId || '').trim(); clientSecret = (clientSecret || '').trim();
  } else {
    console.log('Google Cloud Console › API et services › Identifiants › ton ID client OAuth (« Application de bureau »).');
    clientId = await ask('ID client : ');
    clientSecret = await ask('Secret client : ', true);
  }
  if (!clientId.endsWith('.apps.googleusercontent.com') || !clientSecret) throw new Error('ID client ou secret client invalide.');

  const { code, verifier, redirect } = await authorize(clientId);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier })
  });
  const tok = await r.json();
  if (!r.ok || !tok.refresh_token) throw new Error(`Google a refusé l'échange : ${tok.error_description || tok.error || r.status}`);
  if (!String(tok.scope || '').includes(SCOPE)) throw new Error("L'accès au Chrome Web Store n'a pas été accordé (case décochée ?).");

  gh(['secret', 'set', 'CWS_CLIENT_ID'], clientId);
  gh(['secret', 'set', 'CWS_CLIENT_SECRET'], clientSecret);
  gh(['secret', 'set', 'CWS_REFRESH_TOKEN'], tok.refresh_token);
  console.log('✅ Secrets GitHub enregistrés : CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN');

  gh(['workflow', 'run', 'release.yml', '-f', `tag=v${version}`]);
  console.log(`🚀 Workflow Release relancé pour v${version} : gh run list --workflow release.yml`);
}

main().catch(e => { console.error(`\n❌ ${e.message}`); process.exit(1); });
