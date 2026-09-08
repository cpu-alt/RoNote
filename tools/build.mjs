// Construit dist/chrome et dist/firefox, puis les zippe.
// Usage : node tools/build.mjs
//
// IMPORTANT : le dossier de sortie n'est JAMAIS supprimé.
// Chrome et Firefox gardent une référence sur le répertoire chargé en mode
// développeur ; le détruire puis le recréer casse l'enregistrement et provoque
// « An unknown error occurred when fetching the script ». On synchronise donc
// le contenu en place : fichiers modifiés réécrits, fichiers obsolètes retirés,
// répertoire conservé.
import {
  mkdirSync, readFileSync, readdirSync, statSync,
  existsSync, rmSync, copyFileSync, rmdirSync
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'src');
const dist = join(root, 'dist');

const version = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8')).version;

/** Chemins relatifs de tous les fichiers d'un dossier. */
function listFiles(dir, base = dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) listFiles(p, base, out);
    else out.push(relative(base, p).split(sep).join('/'));
  }
  return out;
}

function sameContent(a, b) {
  try { return readFileSync(a).equals(readFileSync(b)); } catch { return false; }
}

/** Écrit `files` (rel -> chemin source) dans outDir, sans supprimer outDir. */
function syncInto(files, outDir) {
  mkdirSync(outDir, { recursive: true });
  let written = 0, removed = 0;

  for (const [rel, from] of files) {
    const to = join(outDir, rel);
    if (sameContent(from, to)) continue;      // inchangé : on ne touche pas au fichier
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    written++;
  }

  const wanted = new Set(files.keys());
  for (const rel of listFiles(outDir)) {
    if (wanted.has(rel)) continue;
    rmSync(join(outDir, rel), { force: true });
    removed++;
  }

  // Répertoires devenus vides (ex. offscreen/ retiré de la cible Firefox).
  pruneEmptyDirs(outDir);

  return { written, removed };
}

function pruneEmptyDirs(dir) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (!statSync(p).isDirectory()) continue;
    pruneEmptyDirs(p);
    if (!readdirSync(p).length) rmdirSync(p);
  }
}

const targets = [
  { name: 'chrome', manifest: 'manifest.json', skip: [] },
  // Firefox n'a pas l'API offscreen : le repli audio passe par un onglet.
  { name: 'firefox', manifest: 'manifest.firefox.json', skip: ['offscreen/'] }
];

for (const t of targets) {
  const files = new Map();
  for (const rel of listFiles(src)) {
    if (rel === 'manifest.json' || rel === 'manifest.firefox.json') continue;
    if (t.skip.some(p => rel.startsWith(p))) continue;
    files.set(rel, join(src, rel));
  }
  files.set('manifest.json', join(src, t.manifest));

  const out = join(dist, t.name);
  const { written, removed } = syncInto(files, out);

  const zip = join(dist, `ronote-${t.name}-v${version}.zip`);
  let zipped = false;
  try {
    execFileSync('powershell', ['-NoProfile', '-Command',
      `Compress-Archive -Path '${out}\\*' -DestinationPath '${zip}' -Force`], { stdio: 'ignore' });
    zipped = true;
  } catch { /* zip optionnel */ }

  console.log(`OK  ${t.name.padEnd(8)} ${files.size} fichiers · ${written} mis à jour · ${removed} retirés` +
    (zipped ? `  +  ${relative(root, zip)}` : '  (zip non créé)'));
}

if (!existsSync(join(src, 'icons', 'icon128.png'))) {
  console.warn('\n⚠  Icônes manquantes : powershell -ExecutionPolicy Bypass -File tools/make-icons.ps1');
}

console.log(`
Le dossier dist/ n'a pas été supprimé : l'extension déjà chargée reste valide.

  Chrome/Edge : chrome://extensions -> bouton Actualiser (⟳) sur RoNote
  Firefox     : about:debugging#/runtime/this-firefox -> Actualiser

Première installation :
  Chrome/Edge : Mode développeur -> « Charger l'extension non empaquetée » -> dist/chrome
  Firefox     : « Charger un module temporaire » -> dist/firefox/manifest.json`);
