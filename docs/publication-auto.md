# Publier une version, automatiquement

Retour au [README](../README.md) · Publication manuelle : [Chrome Web Store](publication-web-store.md), [Firefox](publication-firefox.md).

Deux workflows GitHub Actions font le travail :

| Workflow | Quand | Ce qu'il fait |
|---|---|---|
| `.github/workflows/tests.yml` | chaque push sur `main`, chaque pull request | `check.mjs`, `check.py`, `npm test`, build |
| `.github/workflows/release.yml` | chaque tag `v*` | tests, zips, **Release GitHub**, puis Chrome Web Store et Firefox Add-ons si leurs secrets existent |

---

## 1. Sortir une version

1. Même numéro dans `src/manifest.json`, `src/manifest.firefox.json` et `package.json`.
2. Une section `## vX.Y.Z — titre` en tête de `CHANGELOG.md` : elle devient les notes
   de la Release (le workflow échoue s'il ne la trouve pas).
3. Une entrée `version: 'X.Y.Z'` dans `src/common/changelog.js` (le « Quoi de neuf »).
4. Commit, puis le tag :

```bash
git tag v2.15.0
```

```bash
git push origin main v2.15.0
```

Le workflow vérifie que le tag et les deux manifestes disent la même version, lance
les tests, construit `ronote-chrome-vX.Y.Z.zip` et `ronote-firefox-vX.Y.Z.zip` et crée
la Release avec ces deux fichiers. Sans les secrets ci-dessous, il s'arrête là.

**Republier une version déjà taguée** (par exemple juste après avoir ajouté les
secrets des stores) : onglet *Actions › Release › Run workflow*, avec le tag, ou :

```bash
gh workflow run release.yml -f tag=v2.15.1
```

La Release GitHub existante est laissée telle quelle ; seuls les stores reçoivent la version.

---

## 2. Chrome Web Store (une fois)

La publication automatique ne fait que **mettre à jour** une fiche existante : le
premier envoi se fait à la main, avec [publication-web-store.md](publication-web-store.md).

1. **Identifiants de la fiche** — dans la [console développeur](https://chrome.google.com/webstore/devconsole) :
   l'**ID d'éditeur** est dans l'URL de la console
   (`…/devconsole/<ID d'éditeur>`), l'**ID de l'extension** (32 lettres) dans l'URL de
   sa fiche, une fois le premier envoi fait.
2. **Accès à l'API** — dans la [Google Cloud Console](https://console.cloud.google.com/) :
   un projet, l'API « Chrome Web Store API » activée, un écran de consentement OAuth
   (type Externe, ton adresse en utilisateur de test), puis un identifiant OAuth de
   type « Application de bureau ». Le guide pas à pas, avec la récupération du
   *refresh token* :
   <https://github.com/fregante/chrome-webstore-upload-keys>
   **Raccourci** : `node tools/cws-token.mjs` demande l'ID et le secret client, ouvre
   l'autorisation Google, puis enregistre `CWS_CLIENT_ID`, `CWS_CLIENT_SECRET` et
   `CWS_REFRESH_TOKEN` avec `gh` (sans jamais afficher le token) et relance la Release.
   Mets l'écran de consentement **« En production »** : en mode « Test », Google fait
   expirer le refresh token au bout de 7 jours.
3. **Secrets GitHub** — dans le dépôt : *Settings › Secrets and variables › Actions ›
   New repository secret* :

| Secret | Valeur |
|---|---|
| `CWS_EXTENSION_ID` | l'ID de l'extension |
| `CWS_PUBLISHER_ID` | l'ID d'éditeur |
| `CWS_CLIENT_ID` | l'ID client OAuth |
| `CWS_CLIENT_SECRET` | le secret client OAuth |
| `CWS_REFRESH_TOKEN` | le refresh token |

À chaque tag, le zip Chrome est envoyé et soumis à la review de Google (quelques
heures à quelques jours). La fiche garde sa visibilité (non répertoriée ou publique).

---

## 3. Firefox Add-ons (une fois)

1. Premier envoi à la main sur <https://addons.mozilla.org/developers/>, avec
   [publication-firefox.md](publication-firefox.md) : c'est lui qui crée la fiche
   (description, captures, catégorie).
2. Les clés d'API : <https://addons.mozilla.org/developers/addon/api/key/>.
3. Secrets GitHub :

| Secret | Valeur |
|---|---|
| `AMO_JWT_ISSUER` | « JWT issuer » |
| `AMO_JWT_SECRET` | « JWT secret » |

À chaque tag, `web-ext sign --channel listed` envoie `dist/firefox` pour review sur la
fiche publique. L'extension, signée par Mozilla, s'installe alors normalement et se
met à jour toute seule, fini le module temporaire.

---

## Ne jamais mettre dans le dépôt

Les identifiants ci-dessus ne vont **que** dans les secrets GitHub : jamais dans un
fichier, un commit ou une issue. Un secret exposé se révoque tout de suite (Google
Cloud Console, page des clés AMO), puis se remplace.
