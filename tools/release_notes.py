#!/usr/bin/env python3
"""
Les notes d'une Release GitHub : la section de CHANGELOG.md de cette version.

    python tools/release_notes.py v2.15.0 > notes.md

Utilise par .github/workflows/release.yml. Sans section pour cette version,
le script echoue plutot que de publier une Release sans notes.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def notes_for(tag: str) -> str:
    version = tag.lstrip("v")
    text = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
    # "## v2.15.0 — titre" jusqu'a la section suivante.
    m = re.search(rf"^## v{re.escape(version)}\b.*?$(.*?)(?=^## v|\Z)", text, re.M | re.S)
    if not m:
        raise SystemExit(f"CHANGELOG.md n'a pas de section pour v{version}")
    title = m.group(0).splitlines()[0].removeprefix("## ").strip()
    body = m.group(1).strip()
    install = ("\n\n---\n\n**Install:** download `ronote-chrome-v{v}.zip` (Chrome, Edge, Brave, Opera) "
               "or `ronote-firefox-v{v}.zip` (Firefox 128+) below, then follow the "
               "[installation steps](https://github.com/cpu-alt/RoNote#installation).").format(v=version)
    return f"# {title}\n\n{body}{install}\n"


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage : python tools/release_notes.py vX.Y.Z")
    sys.stdout.reconfigure(encoding="utf-8")
    print(notes_for(sys.argv[1]), end="")
