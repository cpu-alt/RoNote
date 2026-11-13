# RoNote

Extension navigateur (Chrome/Edge MV3 + Firefox 128+) qui suit les trades Roblox d'un joueur : alertes
dédupliquées par ID de trade, values Rolimon's, portefeuille, et contribution (optionnelle) au réseau
**Neuronal** (`neuronal.live`, l'autre dépôt `cpu-alt/Neuronal`). JavaScript sans framework ni dépendances.
On répond à l'utilisateur en **français** ; l'extension est en français **et** en anglais.

## Commandes

- Vérifier : `python tools/check.py` (ou `npm run check:node`)
- Tests : `npm test` (les tests utilisent de **vraies réponses d'API** dans `tools/fixtures/`)
- Construire : `python tools/build.py` → `dist/chrome/`, `dist/firefox/` et les `.zip`
- **Le navigateur charge `D:\RoNote\dist\chrome`**, pas le `dist/` d'un worktree : un changement ne se voit
  qu'une fois sur `main` (`git -C D:/RoNote merge --ff-only <branche>`) **et** `python tools/build.py` relancé
  dans `D:\RoNote`. Puis recharger l'extension **et** faire F5 sur l'onglet Roblox (l'ancien script y reste).
- Prévisualiser : `python tools/serve.py`, puis `http://127.0.0.1:8777/tools/preview/popup.html`
  (`options.html`, `item-page.html`, `trade-delta.html`) et `tools/selftest.html`

## Où est quoi

- `src/background/` : service worker (sondage, dédup, notifications, `neuronal.js` = la contribution)
- `src/common/` : modules partagés (API Roblox/Rolimon's, analyse, `i18n.js`, réglages `defaults.js`)
- `src/content/` : scripts injectés sur roblox.com ; `src/popup/`, `src/options/` : les deux pages
- `src/manifest.json` (Chrome) et `src/manifest.firefox.json` : **tout changement de permission va dans les deux**

## Règles

- **Chaque texte visible passe par `src/common/i18n.js`**, en français et en anglais.
- **Sortir une version** (détail dans `docs/publication-auto.md`) : même numéro dans les deux manifestes et
  `package.json`, une section `## vX.Y.Z : titre` en tête de `CHANGELOG.md`, une entrée dans
  `src/common/changelog.js`, puis le tag `vX.Y.Z` (le workflow publie). Ne pas taguer sans qu'on le demande.
- **Vie privée** : rien ne part vers Neuronal sans le consentement explicite de l'utilisateur (carte
  « Rejoindre la carte Neuronal ? »). Toute nouvelle donnée envoyée ou permission ajoutée doit être
  ajoutée dans `PRIVACY.md` **et** `PRIVACY.fr.md`, et justifiée dans `docs/publication-web-store.md`.
- Pas de requête Roblox en plus quand une donnée est déjà en cache : le service worker est économe.
- Ne jamais committer d'identifiants (`client_secret*.json`, clés des stores) : ils vivent dans les secrets GitHub.

## Outils installés (Ponytail, Graphify, Agent Skills, OmniRoute)

- **Ponytail** (plugin, actif d'office) : le plus petit changement complet. Il ne remplace pas les règles
  ci-dessus : i18n, PRIVACY et tests restent obligatoires. `/ponytail-review` avant
  une version, `/ponytail-debt` pour lister les `shortcut:`.
- **Graphify** : pour une question d'architecture (« qui appelle quoi », `src/background` ↔ `src/common`), interroger
  `graphify-out/` s'il existe **avant** de grepper ; sinon `/graphify` une fois pour le créer (ignoré par git).
  Ne pas y mettre `dist/`, `node_modules/` ni `store-assets/`.
- **Agent Skills d'Anthropic** (`document-skills`, `example-skills`) : seulement quand on demande un fichier
  (.docx, .pdf, .xlsx, .pptx) ou un visuel ; jamais pour le code du bot.
- **OmniRoute** : routeur de modèles côté poste, rien à faire dans le dépôt.

## Documentation : lire seulement ce qui sert à la tâche

| Fichier | Quand le lire |
|---|---|
| `docs/technique.md` (~53 Ko) | **par section** : `grep -n '^## ' docs/technique.md` puis la plage utile. Explique la dédup, l'interception réseau, les vignettes, les values, le portefeuille, les langues… |
| `CHANGELOG.md` | les 40 premières lignes pour la version en cours ; le reste est l'historique |
| `docs/publication-auto.md` | sortir une version (tags, GitHub Actions, secrets des stores) |
| `docs/publication-web-store.md`, `docs/publication-firefox.md` | fiches des stores et justification des permissions |
| `docs/brief-neuronal.md`, `docs/prompt-neuronal.md` | ce que RoNote attend de l'API Neuronal |
| `README.md` / `README.fr.md` | page publique du dépôt : mettre les deux à jour ensemble |

## Économiser les tokens

- `docs/technique.md` (53 Ko) et `CHANGELOG.md` (45 Ko) : jamais en entier, toujours par section.
- `.ignore` retire `store-assets/` et les images des recherches (Git n'est pas concerné).
- Tests : `npm test 2>&1 | grep -E "échou|Error"` suffit pour savoir si tout passe.

## En fin de session

Si une fonctionnalité visible change, ajouter une ligne à la section en préparation de `CHANGELOG.md` et
dans `src/common/changelog.js` (`version: null` = en préparation). Un choix technique non évident →
une section dans `docs/technique.md`.
