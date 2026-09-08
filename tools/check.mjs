// Vérifications rapides avant chargement : manifestes valides, fichiers
// référencés présents, imports ES résolus, syntaxe JS correcte.
// Usage : node tools/check.mjs
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
let errors = 0;
const fail = (m) => { console.error('✗ ' + m); errors++; };
const ok = (m) => console.log('✓ ' + m);

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

for (const mf of ['manifest.json', 'manifest.firefox.json']) {
  const p = join(src, mf);
  let m;
  try { m = JSON.parse(readFileSync(p, 'utf8')); ok(`${mf} : JSON valide`); }
  catch (e) { fail(`${mf} : ${e.message}`); continue; }

  const refs = [
    ...Object.values(m.icons || {}),
    ...Object.values(m.action?.default_icon || {}),
    m.action?.default_popup,
    m.options_ui?.page,
    m.background?.service_worker,
    ...(m.background?.scripts || []),
    ...((m.content_scripts || []).flatMap(cs => [...(cs.js || []), ...(cs.css || [])])),
    // Un module charge a la demande par un script de contenu doit etre
    // accessible depuis la page, sinon l'import echoue en silence.
    ...((m.web_accessible_resources || []).flatMap(w => w.resources || [])),
    ...((m.declarative_net_request?.rule_resources || []).map(r => r.path))
  ].filter(Boolean);

  for (const r of refs) {
    if (!existsSync(join(src, r))) fail(`${mf} : fichier référencé introuvable -> ${r}`);
  }
  ok(`${mf} : ${refs.length} références vérifiées`);
}

// Les cles tabIds/excludedTabIds sont refusees dans un ruleset statique :
// le manifeste entier devient alors incharcheable. On l'attrape ici.
for (const mf of ['manifest.json', 'manifest.firefox.json']) {
  const p = join(src, mf);
  if (!existsSync(p)) continue;
  let m; try { m = JSON.parse(readFileSync(p, 'utf8')); } catch { continue; }
  for (const rr of m.declarative_net_request?.rule_resources || []) {
    const rp = join(src, rr.path);
    if (!existsSync(rp)) continue;
    let rules; try { rules = JSON.parse(readFileSync(rp, 'utf8')); } catch { fail(`${rr.path} : JSON invalide`); continue; }
    for (const rule of rules) {
      for (const k of ['tabIds', 'excludedTabIds']) {
        if (rule?.condition?.[k]) fail(`${rr.path} : règle ${rule.id} utilise « ${k} », réservé aux règles de session`);
      }
    }
  }
}

const jsFiles = walk(src).filter(f => f.endsWith('.js'));
for (const f of jsFiles) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { fail(`syntaxe ${f.replace(src, 'src')} : ${String(e.stderr).split('\n')[2] || ''}`); }

  const code = readFileSync(f, 'utf8');
  for (const m of code.matchAll(/^\s*import\s[^'"]*['"](\.[^'"]+)['"]/gm)) {
    const target = resolve(dirname(f), m[1]);
    if (!existsSync(target)) fail(`import cassé dans ${f.replace(src, 'src')} -> ${m[1]}`);
  }
}
ok(`${jsFiles.length} fichiers JS : syntaxe + imports`);


// Chaque import nommé doit exister comme export dans le module cible.
// Un seul import fantôme empêche le service worker entier de démarrer.
function exportsOf(code) {
  const names = new Set();
  for (const m of code.matchAll(/^\s*export\s+(?:async\s+)?(?:function|class)\s+([A-Za-z0-9_$]+)/gm)) names.add(m[1]);
  for (const m of code.matchAll(/^\s*export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/gm)) names.add(m[1]);
  for (const m of code.matchAll(/^\s*export\s*\{([^}]+)\}/gm)) {
    for (const part of m[1].split(',')) {
      const t = part.trim().split(/\s+as\s+/).pop().trim();
      if (t) names.add(t);
    }
  }
  return names;
}

let namedImports = 0;
for (const f of jsFiles) {
  const code = readFileSync(f, 'utf8');
  for (const m of code.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]/g)) {
    const target = resolve(dirname(f), m[2]);
    if (!existsSync(target)) continue;   // déjà signalé plus haut
    const avail = exportsOf(readFileSync(target, 'utf8'));
    for (const rawName of m[1].split(',')) {
      const name = rawName.trim().split(/\s+as\s+/)[0].trim();
      if (!name) continue;
      namedImports++;
      if (!avail.has(name)) fail(`${f.replace(src, 'src')} importe « ${name} » depuis ${m[2]} — cet export n'existe pas`);
    }
  }
}
ok(`${namedImports} imports nommés résolus vers un export réel`);

// ------------------------------------------------- monde isolé partagé
// Les scripts de contenu d'une même extension partagent le même espace
// global. Un identifiant déclaré AVANT l'enveloppe (l'IIFE) du fichier fuit
// donc dans cet espace : le fichier suivant qui porte le même nom ne
// s'exécutera JAMAIS, sans un mot — c'est ce qui a fait disparaître le
// panneau entier. Toute déclaration hors enveloppe est refusée.
const WRAPPER = /^\(\s*(?:async\s*)?(?:\(\s*\)\s*=>|function)/m;
const DECL = /^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm;

const contentScripts = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8')).content_scripts || [];
const globalNames = new Map();
for (const cs of contentScripts) {
  if (cs.world === 'MAIN') continue;          // autre monde : aucune collision
  for (const rel of cs.js || []) {
    const p = join(src, rel);
    if (!existsSync(p)) continue;
    const code = readFileSync(p, 'utf8');
    const w = WRAPPER.exec(code);
    const head = w ? code.slice(0, w.index) : code;
    for (const [, name] of head.matchAll(DECL)) {
      const other = globalNames.get(name);
      globalNames.set(name, rel);
      if (other) fail(`${rel} : « ${name} » est déjà déclaré par ${other} — même espace global, ce fichier ne s'exécutera pas du tout`);
      else fail(`${rel} : « ${name} » est déclaré hors enveloppe — enveloppe le fichier dans une IIFE, sinon il pollue l'espace global partagé par tous les scripts de contenu`);
    }
  }
}
ok(`scripts de contenu : ${globalNames.size} identifiant(s) hors enveloppe (0 attendu)`);

for (const h of walk(src).filter(f => f.endsWith('.html'))) {
  const code = readFileSync(h, 'utf8');
  for (const m of code.matchAll(/(?:src|href)="([^"#:]+)"/g)) {
    if (!existsSync(resolve(dirname(h), m[1]))) fail(`${h.replace(src, 'src')} : ressource manquante -> ${m[1]}`);
  }
}
ok('références HTML vérifiées');

console.log(errors ? `\n${errors} problème(s).` : '\nTout est bon.');
process.exit(errors ? 1 : 0);
