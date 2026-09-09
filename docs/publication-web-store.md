# Publier RoNote sur le Chrome Web Store

Document de travail : tout ce que le formulaire de Google demande, rédigé à l'avance.
Il suffit de copier-coller. Retour au [README](../README.md).

---

## 0. Avant de commencer

| Étape | Détail |
|---|---|
| Compte développeur | 5 $ une fois, sur <https://chrome.google.com/webstore/devconsole> |
| Vérification | Google demande une adresse e-mail vérifiée et une identité |
| Paquet à téléverser | `dist/ronote-chrome-v2.9.0.zip`, produit par `python tools/build.py` |
| URL de confidentialité | voir §4 |

> **Choisis « Non répertorié » (unlisted) au premier envoi.** L'installation se fait
> par lien, les mises à jour sont automatiques, mais l'extension n'apparaît pas dans
> la recherche. Tu pourras passer en « Public » plus tard, sans repasser par la case
> départ.

---

## 1. Fiche du magasin

**Nom** (45 caractères max)

```
RoNote — Alertes de trades Roblox
```

**Description courte** (132 caractères max — reprise du manifeste)

```
Notifications bureau fiables pour vos trades Roblox (reçus, terminés, refusés) avec analyse de valeur, sons et filtres.
```

**Description détaillée**

```
RoNote vous prévient sur votre ordinateur dès que quelque chose bouge dans vos trades Roblox : un trade reçu, un trade complété, une contre-offre, ou un de vos envois accepté, refusé, contré ou expiré.

ZÉRO FAUSSE ALERTE
Le suivi ne repose ni sur le pseudo du joueur, ni sur la position dans la liste, ni sur le nombre de trades — uniquement sur l'identifiant unique du trade. Le bug classique « je refuse un trade et celui du dessous renotifie » n'existe pas ici.

LA VALUE, PAS LE RAP
Chaque trade est évalué objet par objet : value, RAP, et les Robux comptés nets des 30 % prélevés par Roblox. RoNote signale les pièges habituels — objets projected, cotes très au-dessus des ventes réelles, visages et objets de bundle sans cote.

CE QUE VOUS OBTENEZ
• Notifications bureau, avec un son différent par type d'événement
• Analyse de valeur détaillée, objet par objet
• Onglet Bénéfice : l'évolution de la valeur de votre compte dans le temps
• Filtres : seuil de valeur, joueurs ignorés, heures silencieuses
• Français et anglais, détectés automatiquement
• Refuser ou annuler un trade en deux clics volontaires

CE QUE RONOTE NE FAIT PAS
RoNote n'accepte jamais un trade, n'en crée pas et n'en contre pas. Ces actions transfèrent des objets : un clic mal placé y serait irréversible. Refuser ou annuler ne fait que détruire une offre, c'est la seule écriture que RoNote s'autorise.

VIE PRIVÉE
Aucune donnée ne sort de votre navigateur. Pas de serveur, pas de compte à créer, pas de télémétrie, pas de publicité. Les seules requêtes vont vers les API publiques de Roblox et, si vous laissez l'option active, vers Rolimon's pour la table publique des valeurs — qui ne reçoit rien vous concernant.

Le code est ouvert et vérifiable : https://github.com/cpu-alt/RoNote

RoNote est un projet indépendant, ni affilié ni approuvé par Roblox Corporation.
```

**Catégorie** : Outils · **Langue** : Français

---

## 2. Objectif unique (single purpose)

Google exige une phrase décrivant *un seul* objectif.

```
RoNote a un objectif unique : signaler à l'utilisateur les changements survenus dans ses propres trades Roblox, au moyen de notifications bureau, et lui en présenter l'analyse de valeur.
```

---

## 3. Justification des permissions

Le formulaire demande une justification par permission. Elles doivent être **courtes
et concrètes** — les réponses vagues rallongent la revue.

| Permission | Justification à coller |
|---|---|
| `storage` | Conserver les réglages de l'utilisateur et l'état de suivi des trades entre deux démarrages du navigateur. Uniquement en stockage local, jamais synchronisé. |
| `alarms` | Déclencher la vérification périodique des trades à intervalle régulier. Un service worker Manifest V3 étant suspendu après quelques secondes, `alarms` est le seul moyen fiable de le réveiller. |
| `notifications` | Afficher les notifications bureau annonçant les changements de trades. C'est la fonction même de l'extension. |
| `scripting` | Lire le trade affiché dans l'onglet actif lorsque l'API Roblox ne renvoie pas son détail (cas des trades refusés). Le script n'est injecté que sur `roblox.com`, et uniquement pour lire le contenu déjà visible à l'écran. |
| `offscreen` | Jouer le son d'alerte. Un service worker Chrome ne peut pas produire d'audio ; le document offscreen est la seule API prévue par Chrome pour cela. |
| `declarativeNetRequestWithHostAccess` | Roblox rejette (403) les requêtes authentifiées dont l'en-tête `Origin` n'est pas le sien. Une règle de session réécrit `Origin` et `Referer` **uniquement pour les requêtes émises par l'extension elle-même** (`tabIds: [-1]`, hors onglet), vers `roblox.com` seulement. La navigation de l'utilisateur n'est jamais modifiée. |
| Accès à `*.roblox.com` | Lire les trades, les objets, les vignettes et les profils publics depuis les API de Roblox — la source de données de l'extension. |
| Accès à `*.rolimons.com` | Télécharger la table publique des valeurs d'objets, identique pour tous les utilisateurs. Aucune donnée utilisateur n'est transmise. Cette source est désactivable dans les réglages. |

**Code exécuté à distance** : répondre **non**. Tous les scripts sont inclus dans le
paquet ; l'extension ne charge et n'évalue aucun code externe.

---

## 4. Confidentialité et usage des données

**URL de la politique** — deux options, les deux valides :

- La plus simple, sans rien configurer :
  `https://github.com/cpu-alt/RoNote/blob/main/PRIVACY.md`
- La plus propre, après avoir activé GitHub Pages (Settings → Pages → source
  `main` / dossier `/docs`) :
  `https://cpu-alt.github.io/RoNote/privacy.html`

**Déclarations d'usage des données** — pour RoNote, la réponse est *non* partout :

| Question du formulaire | Réponse |
|---|---|
| Collecte de données personnelles identifiables | Non |
| Collecte de données de santé, financières, d'authentification | Non |
| Collecte de communications personnelles | Non |
| Collecte de la localisation | Non |
| Collecte de l'historique de navigation | Non |
| Collecte de l'activité utilisateur (clics, souris, frappe) | Non |
| Collecte du contenu de sites web | Non — les données de trade sont lues et affichées localement, jamais transmises |

**Les trois certifications à cocher** — toutes vraies pour RoNote :

- Je ne vends ni ne transfère les données utilisateur à des tiers, hors cas d'usage approuvés
- Je n'utilise ni ne transfère les données utilisateur à des fins étrangères à l'objectif unique de l'extension
- Je n'utilise ni ne transfère les données utilisateur pour évaluer la solvabilité ou accorder des prêts

---

## 5. Éléments graphiques à produire

| Élément | Format | État |
|---|---|---|
| Icône du magasin | 128 × 128 PNG | ✅ déjà dans `src/icons/icon128.png` |
| Captures d'écran | 1280 × 800 (ou 640 × 400), 1 à 5 | ❌ **à faire** |
| Petite vignette promo | 440 × 280 | facultatif |

Pour les captures, `python tools/serve.py` puis
<http://127.0.0.1:8777/tools/preview.html> affiche le vrai popup avec des données
réalistes — plus présentable qu'une capture d'un compte réel, et sans exposer de
pseudo.

> **Anonymise** : aucune capture ne doit montrer ton pseudo, ton identifiant Roblox
> ni ceux d'autres joueurs.

---

## 6. Points de vigilance

**Délai de revue.** Compte plusieurs jours, potentiellement plus. Le trio
« interception réseau en monde MAIN + réécriture d'en-têtes + POST authentifié »
déclenche généralement une revue manuelle. Les justifications du §3 sont écrites pour
la désamorcer : elles disent exactement ce que fait le code et pourquoi.

**La marque Roblox dans le nom.** `RoNote — Alertes de trades Roblox` utilise une
marque déposée. C'est un usage descriptif, généralement toléré, mais c'est le motif
de refus le plus probable. Repli si Google refuse : nommer l'extension `RoNote` tout
court et ne mentionner Roblox que dans la description.

**Les conditions d'utilisation de Roblox.** Elles interdisent les programmes tiers
non autorisés qui accèdent au service ou automatisent des actions de compte. Refuser
un trade via l'API avec la session de l'utilisateur entre dans cette description. Ce
n'est pas un problème pour Google, mais Roblox peut demander un retrait — et le
risque retombe aussi sur les utilisateurs. C'est la raison principale de commencer en
« Non répertorié ».

---

## 7. Après publication

- Mettre à jour le README : remplacer le bloc « Pourquoi le mode développeur ? » par
  le lien d'installation du Web Store
- Créer une Release GitHub taguée pour chaque version publiée
- Toute nouvelle version repasse par une revue : incrémenter `version` dans
  `src/manifest.json` **et** dans `package.json`, ils doivent rester synchronisés
