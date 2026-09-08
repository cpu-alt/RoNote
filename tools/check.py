#!/usr/bin/env python3
"""
Verifications statiques avant chargement de l'extension.
Equivalent de tools/check.mjs, pour une machine sans Node.

    python tools/check.py

Ce qui est verifie :
  - les deux manifestes sont du JSON valide ;
  - tout fichier reference par un manifeste ou une page HTML existe ;
  - tout import relatif pointe sur un fichier reel ;
  - tout import nomme correspond a un export reel du module cible
    (un seul import fantome empeche le service worker entier de demarrer) ;
  - aucune regle statique n'utilise `tabIds`, reserve aux regles de session.

La SYNTAXE JavaScript, elle, est verifiee par tools/selftest.html, qui charge
reellement chaque module dans un navigateur : c'est plus sur qu'un parseur
approximatif ecrit ici.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "src"

errors = []


def fail(msg):
    errors.append(msg)
    print("x " + msg)


def ok(msg):
    print("- " + msg)


def walk(suffix):
    return sorted(p for p in SRC.rglob("*" + suffix) if p.is_file())


# --------------------------------------------------------------- manifestes
for name in ("manifest.json", "manifest.firefox.json"):
    path = SRC / name
    try:
        m = json.loads(path.read_text(encoding="utf-8"))
        ok(f"{name} : JSON valide")
    except Exception as exc:                                  # noqa: BLE001
        fail(f"{name} : {exc}")
        continue

    refs = []
    refs += list((m.get("icons") or {}).values())
    refs += list(((m.get("action") or {}).get("default_icon") or {}).values())
    for key, sub in (("action", "default_popup"), ("options_ui", "page"),
                     ("background", "service_worker")):
        v = (m.get(key) or {}).get(sub)
        if v:
            refs.append(v)
    refs += (m.get("background") or {}).get("scripts") or []
    for cs in m.get("content_scripts") or []:
        refs += cs.get("js") or []
        refs += cs.get("css") or []
    # Un module charge a la demande par un script de contenu doit etre
    # accessible depuis la page, sinon l'import echoue en silence.
    for war in m.get("web_accessible_resources") or []:
        refs += war.get("resources") or []
    for rr in (m.get("declarative_net_request") or {}).get("rule_resources") or []:
        refs.append(rr.get("path"))

    for r in filter(None, refs):
        if not (SRC / r).exists():
            fail(f"{name} : fichier reference introuvable -> {r}")
    ok(f"{name} : {len(list(filter(None, refs)))} references verifiees")

    # `tabIds` fait rejeter le manifeste entier dans un ruleset statique.
    for rr in (m.get("declarative_net_request") or {}).get("rule_resources") or []:
        rp = SRC / (rr.get("path") or "")
        if not rp.exists():
            continue
        try:
            rules = json.loads(rp.read_text(encoding="utf-8"))
        except Exception:                                     # noqa: BLE001
            fail(f"{rr.get('path')} : JSON invalide")
            continue
        for rule in rules:
            for k in ("tabIds", "excludedTabIds"):
                if (rule.get("condition") or {}).get(k):
                    fail(f"{rr.get('path')} : regle {rule.get('id')} utilise "
                         f"« {k} », reserve aux regles de session")


content_scripts = json.loads((SRC / "manifest.json").read_text(encoding="utf-8")).get("content_scripts") or []


# ------------------------------------------------- monde isole partage
# Les scripts de contenu d'une meme extension partagent le meme espace
# global. Un identifiant declare AVANT l'enveloppe (l'IIFE) du fichier fuit
# donc dans cet espace : le fichier suivant qui porte le meme nom ne
# s'executera JAMAIS, sans un mot. C'est ce qui a fait disparaitre le
# panneau entier. Ici on refuse toute declaration hors enveloppe.
WRAPPER = re.compile(r"^\(\s*(?:async\s*)?(?:\(\s*\)\s*=>|function)", re.M)
DECL = re.compile(r"^(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)", re.M)

seen_names = {}
for cs in content_scripts:
    if cs.get("world") == "MAIN":
        continue                       # autre monde : aucune collision possible
    for rel in cs.get("js") or []:
        path = SRC / rel
        if not path.exists():
            continue
        code = path.read_text(encoding="utf-8")
        w = WRAPPER.search(code)
        head = code[: w.start()] if w else code
        for name in DECL.findall(head):
            other = seen_names.get(name)
            seen_names[name] = rel
            # La collision est fatale ; la fuite seule ne l'est pas encore,
            # mais c'est elle qui la prepare. On refuse les deux.
            if other:
                fail(f"{rel} : « {name} » est deja declare par {other} — meme "
                     f"espace global, ce fichier ne s'executera pas du tout")
            else:
                fail(f"{rel} : « {name} » est declare hors enveloppe — enveloppe "
                     f"le fichier dans une IIFE, sinon il pollue l'espace global "
                     f"partage par tous les scripts de contenu")
ok(f"scripts de contenu : {len(seen_names)} identifiant(s) hors enveloppe (0 attendu)")

# ------------------------------------------- caracteres invisibles
# Un caractere de controle glisse dans une source ne se voit nulle part : ni a
# la relecture, ni dans un diff, ni dans un message d erreur. Il a suffi d un
# echappement rate dans une expression reguliere  devenu un vrai caractere
# backspace  pour qu elle ne corresponde plus jamais a rien, en silence.
CTRL = re.compile(chr(91) + chr(92) + "x00-" + chr(92) + "x08" + chr(92) + "x0b-" + chr(92) + "x1f" + chr(92) + "x7f" + chr(93))
invisibles = 0
for path in walk(".js") + walk(".json") + walk(".css") + walk(".html"):
    text = path.read_text(encoding="utf-8")
    for m in CTRL.finditer(text):
        line = text.count(chr(10), 0, m.start()) + 1
        fail(f"{path.relative_to(SRC)} ligne {line} : caractere de controle "
             f"U+{ord(m.group()):04X}  invisible, et il casse ce qu il touche")
        invisibles += 1
ok(f"aucun caractere invisible dans les sources")

# ------------------------------------------------------------------ imports
IMPORT_PATH = re.compile(r"^\s*import\s[^'\"]*['\"](\.[^'\"]+)['\"]", re.M)
NAMED_IMPORT = re.compile(r"import\s*\{([^}]+)\}\s*from\s*['\"](\.[^'\"]+)['\"]")

EXPORT_PATTERNS = (
    re.compile(r"^\s*export\s+(?:async\s+)?(?:function|class)\s+([A-Za-z0-9_$]+)", re.M),
    re.compile(r"^\s*export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)", re.M),
)
EXPORT_LIST = re.compile(r"^\s*export\s*\{([^}]+)\}", re.M)
# `export const A = 0, B = 1;` — les declarations groupees comptent aussi.
EXPORT_MULTI = re.compile(r"^\s*export\s+(?:const|let|var)\s+(.+?);", re.M | re.S)


def exports_of(code):
    names = set()
    for pat in EXPORT_PATTERNS:
        names |= set(pat.findall(code))
    for block in EXPORT_LIST.findall(code):
        for part in block.split(","):
            t = part.strip().split(" as ")[-1].strip()
            if t:
                names.add(t)
    for decl in EXPORT_MULTI.findall(code):
        depth = 0
        current = ""
        for ch in decl:
            if ch in "([{":
                depth += 1
            elif ch in ")]}":
                depth -= 1
            if ch == "," and depth == 0:
                names.add(current.split("=")[0].strip())
                current = ""
            else:
                current += ch
        if current:
            names.add(current.split("=")[0].strip())
    return {n for n in names if re.fullmatch(r"[A-Za-z0-9_$]+", n or "")}


js_files = walk(".js")
named = 0
for f in js_files:
    code = f.read_text(encoding="utf-8")
    for rel in IMPORT_PATH.findall(code):
        if not (f.parent / rel).resolve().exists():
            fail(f"import casse dans {f.relative_to(ROOT)} -> {rel}")
    for block, rel in NAMED_IMPORT.findall(code):
        target = (f.parent / rel).resolve()
        if not target.exists():
            continue
        avail = exports_of(target.read_text(encoding="utf-8"))
        for raw in block.split(","):
            name = raw.strip().split(" as ")[0].strip()
            if not name:
                continue
            named += 1
            if name not in avail:
                fail(f"{f.relative_to(ROOT)} importe « {name} » depuis {rel} "
                     f"— cet export n'existe pas")
ok(f"{len(js_files)} fichiers JS : imports relatifs resolus")
ok(f"{named} imports nommes resolus vers un export reel")

# --------------------------------------------------------------------- HTML
HTML_REF = re.compile(r'(?:src|href)="([^"#:]+)"')
for h in walk(".html"):
    for rel in HTML_REF.findall(h.read_text(encoding="utf-8")):
        if not (h.parent / rel).exists():
            fail(f"{h.relative_to(ROOT)} : ressource manquante -> {rel}")
ok("references HTML verifiees")

print()
print(f"{len(errors)} probleme(s)." if errors else "Tout est bon.")
sys.exit(1 if errors else 0)
