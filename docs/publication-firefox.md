# Publier RoNote pour Firefox (addons.mozilla.org)

Document de travail, sur le modèle de la [fiche Chrome](publication-web-store.md) :
consignes en français, **blocs à copier-coller en anglais**.
Retour au [README](../README.md).

---

## Pourquoi

Aujourd'hui, sous Firefox, RoNote s'installe comme **module temporaire** : il
disparaît à chaque fermeture du navigateur. Mozilla ne laisse une installation
permanente qu'aux extensions **signées**, et la signature est gratuite.

---

## 0. Déjà réglé dans le manifeste

Deux points de `src/manifest.firefox.json` conditionnent l'envoi. Ils sont faits :

| Clé | Valeur | Pourquoi |
|---|---|---|
| `gecko.id` | `ronote@cpu-alt.github.io` | Mozilla exige un identifiant au format adresse (ou GUID) et vérifie qu'il est unique à la première signature. Il **ne doit plus changer ensuite** : l'extension signée y est rattachée. Il reprend le domaine GitHub Pages du projet. |
| `gecko.data_collection_permissions` | `{ "required": ["none"] }` | **Obligatoire pour toute nouvelle extension soumise depuis le 3 novembre 2025.** RoNote ne transmet aucune donnée : c'est la valeur exacte à déclarer. |

La déclaration de collecte n'est prise en charge qu'à partir de **Firefox 140** ; les
versions plus anciennes l'ignorent. Comme RoNote ne collecte rien, aucun écran de
consentement n'est à prévoir pour elles, et `strict_min_version` reste à **128**.

---

## 1. Avant de commencer

| Étape | Détail |
|---|---|
| Compte | Un compte Mozilla, sur <https://addons.mozilla.org/developers/> — à créer toi-même |
| Paquet | `dist/ronote-firefox-vX.Y.Z.zip`, produit par `python tools/build.py` |
| Coût | Aucun |

---

## 2. Où l'extension sera distribuée

Mozilla pose la question dès le téléversement :

| Choix | Ce que ça donne |
|---|---|
| **On this site** | Fiche publique sur addons.mozilla.org, recherche comprise, mises à jour automatiques |
| **On your own** | Mozilla signe le fichier sans le lister ; tu le distribues toi-même (GitHub Releases). Installation permanente, mais **pas de mise à jour automatique** sans `update_url` dans le manifeste |

Même raisonnement que « Unlisted » sur Chrome : **On your own** limite l'exposition
tant que la question des conditions de Roblox n'est pas tranchée. **On this site**
est plus confortable pour les utilisateurs. À toi de choisir.

---

## 3. Questions du formulaire

**Does your add-on use code generators, minifiers, template engines or bundlers?**
→ **No.** `tools/build.py` copie les fichiers de `src/` tels quels, sans aucune
transformation (vérifié : aucun minificateur ni bundler). Mozilla ne demande donc pas
le code source à part.

**License** → **MIT**

**Privacy policy**

```
https://cpu-alt.github.io/RoNote/privacy.html
```

**Support site**

```
https://github.com/cpu-alt/RoNote/issues
```

**Homepage**

```
https://github.com/cpu-alt/RoNote
```

**Category** → *Alerts & Updates*

**Summary** (250 caractères max)

```
Reliable desktop alerts for your Roblox trades (inbound, completed, declined) with value analysis, sounds and filters.
```

**Description** → le bloc *Detailed description* de la
[fiche Chrome](publication-web-store.md#1-store-listing), à l'identique.

---

## 4. Notes pour le reviewer

Le reviewer de Mozilla lit le code. Ce bloc lui épargne de deviner pourquoi RoNote
touche au réseau de la page :

```
RoNote is plain JavaScript: no bundler, no minifier, no remote code. tools/build.py only copies src/ into dist/firefox/ with manifest.firefox.json as manifest.json.

Three things a reviewer may want explained:

1. content/hook.js runs in the page's MAIN world on roblox.com. It wraps fetch and XMLHttpRequest only to READ the page's own trade-detail responses and its x-csrf-token header, and forwards them with window.postMessage targeted at location.origin (never "*"). It never modifies a request or a response. content/relay.js, in the isolated world, forwards those messages to the background script only if they come from the same window and origin.

2. A declarativeNetRequest session rule rewrites the Origin and Referer headers to https://www.roblox.com, only for requests issued by the extension itself (tabIds: [-1]) towards roblox.com, because Roblox rejects authenticated requests carrying a moz-extension:// origin. The user's own browsing is never affected.

3. The only write action is declining an inbound trade or cancelling an outbound one (POST trades.roblox.com/v1/trades/{id}/decline), triggered solely by an explicit two-step click in the popup. The extension never accepts, creates or counters a trade.

No data is collected or transmitted (data_collection_permissions: none). Network access is limited to *.roblox.com and *.rolimons.com (public item value table).

Source and tests: https://github.com/cpu-alt/RoNote
```

---

## 5. Après la signature

- Ajouter le fichier `.xpi` signé à la Release GitHub de la version
- Remplacer, dans le README, la procédure « module temporaire » par l'installation
  depuis le fichier signé (ou le lien addons.mozilla.org)
- Chaque nouvelle version repasse par la signature : `version` doit rester identique
  dans `src/manifest.json`, `src/manifest.firefox.json` et `package.json`
