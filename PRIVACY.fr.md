# Politique de confidentialité — RoNote

**Dernière mise à jour : 9 septembre 2026 · Version 2.9.0**

*[English version](PRIVACY.md)*

RoNote est une extension de navigateur qui affiche des notifications sur les trades
Roblox. Elle est conçue pour fonctionner **entièrement sur ton ordinateur**.

## En une phrase

**RoNote n'envoie aucune de tes données à qui que ce soit.** Il n'y a pas de
serveur RoNote, pas de compte à créer, pas de télémétrie, pas de publicité, pas
d'analyse d'audience, et rien n'est jamais vendu ni partagé.

## Les données auxquelles RoNote accède

Quand tu es connecté à Roblox, RoNote lit, depuis ton navigateur :

- **tes trades** — reçus, envoyés, terminés, refusés : identifiants, dates, statut ;
- **les objets de ces trades** — noms, identifiants, vignettes, valeurs ;
- **le profil public du joueur en face** — pseudo, nom d'affichage, avatar ;
- **ton propre pseudo et ton identifiant Roblox**, pour savoir de quel compte il s'agit ;
- **ton inventaire**, si tu utilises l'onglet Bénéfice.

## Où ces données sont stockées

Uniquement dans le **stockage local** de ton navigateur (`storage.local`), sur ta
machine. Concrètement : tes réglages, l'état de suivi des trades, l'historique de la
valeur de ton compte et le journal des événements.

Ce stockage est **local et non synchronisé** : RoNote n'utilise volontairement pas
`storage.sync`, donc rien ne remonte vers ton compte Google ni vers aucun autre
appareil.

Pour tout effacer : désinstalle l'extension, ou utilise **Réinitialiser** dans les
réglages. Il n'y a aucune copie ailleurs à supprimer.

## Les seules connexions réseau

RoNote ne contacte que deux domaines, tous deux déclarés dans son manifeste :

| Domaine | Pourquoi | Ce qui est envoyé |
|---|---|---|
| `*.roblox.com` | Lire tes trades, les objets, les vignettes, les profils | Rien d'autre que la requête elle-même, avec la session Roblox déjà présente dans ton navigateur |
| `*.rolimons.com` | Télécharger la table publique des valeurs d'objets | **Rien te concernant** — c'est un simple téléchargement du catalogue public, identique pour tous les utilisateurs |

Rolimon's est **désactivable** dans les réglages. Sans lui, RoNote se rabat sur le
RAP fourni par Roblox et ne contacte plus que Roblox.

**Aucune requête ne part vers un autre domaine.** Il n'existe aucun serveur
appartenant à l'auteur de RoNote.

## L'utilisation de ta session Roblox

Pour lire *tes* trades, RoNote interroge l'API de Roblox en réutilisant la session
déjà ouverte dans ton navigateur — exactement comme le fait le site roblox.com quand
tu navigues dessus.

RoNote **ne lit pas ton mot de passe, ne le stocke pas et ne le transmet pas**. Elle
ne copie pas non plus ton cookie de session : celui-ci reste géré par le navigateur,
qui l'attache lui-même aux requêtes vers Roblox.

## La seule action qui modifie ton compte

RoNote peut **refuser** un trade reçu ou **annuler** un trade envoyé, et uniquement
sur ton clic explicite, en deux temps, depuis la vue de détail.

RoNote **ne peut pas accepter un trade**, ni en créer, ni en contrer. C'est un choix
délibéré : ces actions transfèrent des objets, et un clic mal placé serait
irréversible. Refuser ou annuler ne fait que détruire une offre.

## Les permissions demandées, et pourquoi

| Permission | À quoi elle sert |
|---|---|
| `storage` | Conserver tes réglages et l'état de suivi entre deux démarrages |
| `alarms` | Déclencher la vérification périodique des trades |
| `notifications` | Afficher les notifications bureau — la fonction même de l'extension |
| `scripting` | Lire le trade affiché à l'écran quand l'API ne renvoie pas le détail |
| `offscreen` | Jouer le son d'alerte, un service worker Chrome ne pouvant pas produire d'audio |
| `declarativeNetRequestWithHostAccess` | Corriger les en-têtes `Origin` et `Referer` des requêtes de RoNote vers Roblox, que Roblox rejetterait sinon. S'applique **uniquement aux requêtes émises par l'extension** (hors onglet), jamais à ta navigation |
| `*.roblox.com` | Le site dont RoNote lit les trades |
| `*.rolimons.com` | La table publique des valeurs |

## Enfants et âge minimum

RoNote ne collecte aucune donnée, et n'en transmet donc aucune, quel que soit l'âge
de l'utilisateur.

## Absence d'affiliation

RoNote est un projet indépendant. Il **n'est ni affilié, ni approuvé, ni sponsorisé
par Roblox Corporation ni par Rolimon's**. « Roblox » est une marque de Roblox
Corporation.

## Modifications

Toute évolution de cette politique sera publiée sur cette page, avec la date de mise
à jour ci-dessus. Le code étant ouvert, chaque changement de comportement est
vérifiable dans l'historique du dépôt.

## Contact

Une question, ou un doute sur ce document ? Ouvre une
[issue sur GitHub](https://github.com/cpu-alt/RoNote/issues).
