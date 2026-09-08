#!/usr/bin/env python3
"""
Construit dist/chrome et dist/firefox, puis les zippe.

    python tools/build.py

IMPORTANT : le dossier de sortie n'est JAMAIS supprime.
Chrome et Firefox gardent une reference sur le repertoire charge en mode
developpeur ; le detruire puis le recreer casse l'enregistrement et provoque
« An unknown error occurred when fetching the script ». On synchronise donc le
contenu en place : fichiers modifies reecrits, fichiers obsoletes retires,
repertoire conserve.

Equivalent de tools/build.mjs, pour une machine sans Node.
"""
import json
import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"
DIST = ROOT / "dist"

VERSION = json.loads((SRC / "manifest.json").read_text(encoding="utf-8"))["version"]

TARGETS = [
    {"name": "chrome", "manifest": "manifest.json", "skip": ()},
    # Firefox n'a pas l'API offscreen : le repli audio passe par un onglet.
    {"name": "firefox", "manifest": "manifest.firefox.json", "skip": ("offscreen/",)},
]


def rel_files(root):
    """Chemins relatifs (avec des « / ») de tous les fichiers d'un dossier."""
    if not root.exists():
        return []
    return sorted(p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file())


def same(a: Path, b: Path):
    try:
        return a.read_bytes() == b.read_bytes()
    except OSError:
        return False


def sync_into(files, out_dir: Path):
    """Ecrit `files` (rel -> source) dans out_dir, sans supprimer out_dir."""
    out_dir.mkdir(parents=True, exist_ok=True)
    written = removed = 0

    for rel, src in files.items():
        dst = out_dir / rel
        if dst.exists() and same(src, dst):
            continue                      # inchange : on ne touche pas au fichier
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, dst)
        written += 1

    for rel in rel_files(out_dir):
        if rel not in files:
            (out_dir / rel).unlink()
            removed += 1

    # Repertoires devenus vides (ex. offscreen/ retire de la cible Firefox).
    for d in sorted((p for p in out_dir.rglob("*") if p.is_dir()),
                    key=lambda p: len(p.parts), reverse=True):
        if not any(d.iterdir()):
            d.rmdir()

    return written, removed


def main():
    for t in TARGETS:
        files = {}
        for rel in rel_files(SRC):
            if rel in ("manifest.json", "manifest.firefox.json"):
                continue
            if any(rel.startswith(p) for p in t["skip"]):
                continue
            files[rel] = SRC / rel
        files["manifest.json"] = SRC / t["manifest"]

        out = DIST / t["name"]
        written, removed = sync_into(files, out)

        zip_path = DIST / f"ronote-{t['name']}-v{VERSION}.zip"
        try:
            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
                for rel in rel_files(out):
                    z.write(out / rel, rel)
            zipped = f"  +  {zip_path.relative_to(ROOT)}"
        except OSError as exc:
            zipped = f"  (zip non cree : {exc})"

        print(f"OK  {t['name']:<8} {len(files)} fichiers "
              f"· {written} mis a jour · {removed} retires{zipped}")

    if not (SRC / "icons" / "icon128.png").exists():
        print("\n!  Icones manquantes : "
              "powershell -ExecutionPolicy Bypass -File tools/make-icons.ps1")

    print("""
Le dossier dist/ n'a pas ete supprime : l'extension deja chargee reste valide.

  Chrome/Edge : chrome://extensions -> bouton Actualiser sur RoNote
  Firefox     : about:debugging#/runtime/this-firefox -> Actualiser

Premiere installation :
  Chrome/Edge : Mode developpeur -> « Charger l'extension non empaquetee » -> dist/chrome
  Firefox     : « Charger un module temporaire » -> dist/firefox/manifest.json""")
    return 0


if __name__ == "__main__":
    sys.exit(main())
