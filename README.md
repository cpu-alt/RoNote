# RoNote — Alertes de trades Roblox

[![Licence MIT](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-2.9.1-brightgreen.svg)](CHANGELOG.md)

Extension de navigateur (Chrome / Edge / Brave / Opera / Firefox) qui te prévient sur
ton PC pour **tout ce qui bouge dans tes trades Roblox** : un trade qui arrive, un
trade complété, une **contre-offre**, un de tes envois **accepté / refusé / contré /
expiré**, ou un trade annulé par une **erreur Roblox** (« Rejected due to an error »).

Le point central : **zéro fausse alerte.** Le suivi ne se base ni sur le pseudo, ni
sur la position dans la liste, ni sur le nombre de trades — uniquement sur
l'**identifiant unique du trade**.

Et le chiffre qui compte, partout, c'est la **value** — pas le RAP.

---

## Ce que ça fait

- **Notifications bureau fiables**, avec un son différent par type d'événement
- **Analyse de valeur** de chaque trade : value, RAP, Robux comptés **nets** des 30 % de taxe
- **Détection des pièges** : objets *projected*, cotes spéculatives, visages et objets de bundle sans cote
- **Onglet Bénéfice** : l'évolution de la valeur de ton compte dans le temps
- **Filtres** : seuil de valeur, joueurs ignorés, heures silencieuses
- **Français et anglais**, détectés automatiquement
- **Refuser ou annuler** un trade en deux clics volontaires, depuis le détail

RoNote **n'accepte jamais** un trade et n'en crée pas : ces actions transfèrent des
objets, un clic mal placé y serait irréversible.

## Installation

### Depuis une Release (recommandé)

Aucun outil à installer, ni Python ni Node.

1. Va sur la page [Releases](https://github.com/cpu-alt/RoNote/releases) et télécharge
   `ronote-chrome-vX.Y.Z.zip` (ou `ronote-firefox-…` pour Firefox).
2. **Dézippe le fichier** dans un dossier que tu ne supprimeras pas : le navigateur
   charge l'extension *depuis ce dossier*, il ne la copie pas ailleurs.
3. **Chrome / Edge / Brave / Opera** — va sur `chrome://extensions`, active le
   **Mode développeur** (en haut à droite), puis **Charger l'extension non
   empaquetée** et sélectionne le dossier dézippé.
4. **Firefox** (128 minimum) — va sur `about:debugging#/runtime/this-firefox`, puis
   **Charger un module temporaire** et sélectionne `manifest.json` dans le dossier
   dézippé.

> **Pourquoi le mode développeur ?** RoNote n'est pas encore publiée sur le Chrome
> Web Store, et Chrome refuse d'installer une extension venue d'ailleurs sans lui.
> Deux conséquences : un avertissement « Désactivez les extensions en mode
> développeur » à chaque démarrage (tu peux le fermer), et **pas de mise à jour
> automatique** — pour changer de version, retélécharge le zip et remplace le contenu
> du dossier.
>
> Sous Firefox, un module temporaire **disparaît à la fermeture du navigateur**.
> C'est une limite de Mozilla pour les extensions non signées.

### Vérifier que ça marche

Connecte-toi sur `roblox.com`, puis ouvre le popup : tu dois voir
`Actif · vérifié il y a Xs` et ton pseudo. Le bouton **Tester** dans les réglages
envoie une notification de démonstration avec le son.

> Au tout premier démarrage, RoNote photographie silencieusement les trades déjà
> présents : **aucune notification pour l'existant**. Seuls les trades qui arrivent
> ensuite comptent.

## Vie privée

**Aucune donnée ne sort de ton navigateur.** Pas de serveur RoNote, pas de compte,
pas de télémétrie. Les seules requêtes vont vers les API publiques de Roblox et,
si tu laisses l'option active, vers Rolimon's pour la table des valeurs — qui ne
reçoit rien te concernant.

Détail complet : **[Politique de confidentialité](PRIVACY.fr.md)** · *[English](PRIVACY.md)*

## Construire depuis les sources

**Sans Node** (Python 3 suffit) :

```bash
python tools/check.py
```

```bash
python tools/build.py
```

Ça produit `dist/chrome/`, `dist/firefox/` et les `.zip` correspondants. Charge
ensuite `dist/chrome` comme décrit plus haut ; après un rebuild, le bouton
**Actualiser** (⟳) de `chrome://extensions` suffit.

**Avec Node**, les équivalents : `npm run check:node`, `npm run build:node`, `npm test`.
Les icônes se régénèrent avec `npm run icons`, uniquement si tu les modifies.

Procédure complète, dépannage inclus : **[Construire depuis les sources, en détail](docs/technique.md#construire-depuis-les-sources-en-détail)**.

### Tests

```bash
python tools/serve.py
```

Puis, dans un navigateur :

| | |
|---|---|
| <http://127.0.0.1:8777/tools/selftest.html> | les 93 tests |
| <http://127.0.0.1:8777/tools/preview.html> | le vrai popup, branché sur un faux service worker |

Les jeux d'essai sont de **vraies réponses d'API**, pas des maquettes : c'est ce qui
permet de voir qu'un renommage de champ chez Roblox ou Rolimon's casse quelque chose.

## Aller plus loin

- **[Notes techniques](docs/technique.md)** — pourquoi le code est écrit comme il est :
  anti-doublon, interception réseau, résolution des vignettes, lecture des cotes
- **[Journal des versions](CHANGELOG.md)** — ce qui a changé, version par version

## Contribuer

Les issues et les pull requests sont les bienvenues. Avant d'ouvrir une PR, fais
tourner `python tools/check.py` et les 93 tests du navigateur.

## Licence

[MIT](LICENSE) — libre d'utilisation, de modification et de redistribution, en
gardant la mention de copyright.

## Absence d'affiliation

RoNote est un projet indépendant, **ni affilié, ni approuvé, ni sponsorisé par Roblox
Corporation ni par Rolimon's**. « Roblox » est une marque de Roblox Corporation.
