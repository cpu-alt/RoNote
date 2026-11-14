# Politique de confidentialité : RoNote

**Dernière mise à jour : 6 novembre 2026 · Version 2.16.8**

*[English version](PRIVACY.md)*

RoNote est une extension de navigateur qui affiche des notifications sur les trades
Roblox. Elle est conçue pour fonctionner **entièrement sur ton ordinateur**.

## En une phrase

**RoNote n'envoie aucune de tes données à qui que ce soit.** Il n'y a pas de
serveur RoNote, pas de compte à créer, pas de télémétrie, pas de publicité, pas
d'analyse d'audience, et rien n'est jamais vendu ni partagé.

## Les données auxquelles RoNote accède

Quand tu es connecté à Roblox, RoNote lit, depuis ton navigateur :

- **tes trades** : reçus, envoyés, terminés, refusés : identifiants, dates, statut ;
- **les objets de ces trades** : noms, identifiants, vignettes, valeurs ;
- **le profil public du joueur en face** : pseudo, nom d'affichage, avatar ;
- **ton propre pseudo et ton identifiant Roblox**, pour savoir de quel compte il s'agit ;
- **ton inventaire**, si tu utilises l'onglet Portefeuille ou l'alerte de réévaluation.

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

Par défaut, RoNote ne contacte que deux domaines, tous deux déclarés dans son manifeste :

| Domaine | Pourquoi | Ce qui est envoyé |
|---|---|---|
| `*.roblox.com` | Lire tes trades, les objets, les vignettes, les profils | Rien d'autre que la requête elle-même, avec la session Roblox déjà présente dans ton navigateur |
| `*.rolimons.com` | Télécharger la table publique des valeurs d'objets et, quand tu ouvres un objet, son historique public. Avec le suivi du portefeuille, lire ton profil Rolimon's public. Quand tu ouvres la fiche d'un joueur, lire le sien | Pour la table et les historiques, **rien te concernant** : les mêmes pages publiques pour tous. Pour le suivi du portefeuille, ton **identifiant Roblox**, déjà public, pour trouver ton profil. Pour la fiche d'un joueur, **son** identifiant Roblox, public lui aussi |

Rolimon's est **désactivable** dans les réglages. Sans lui, RoNote se rabat sur le
RAP fourni par Roblox et ne contacte plus que Roblox.

**Option Fiches Neuronal (coupée par défaut).** Si tu l'actives (Réglages ›
Valeurs), le navigateur te demande l'accès à `neuronal.live`, le site du réseau
Neuronal tenu par l'auteur de RoNote. Quand tu ouvres ensuite la fiche d'un
joueur ou d'un objet, RoNote demande à `neuronal.live/ext/v1/` ce que le réseau
en sait : **seul l'identifiant Roblox de ce joueur ou de cet objet** est envoyé,
sans cookie ni rien te concernant. La route ne fait que lire : elle n'ajoute
personne au réseau. Avec cette option, RoNote télécharge aussi, une fois par
heure au plus, la table de demande des objets (`neuronal.live/ext/v1/demand`)
affichée sur les pages de trade : la même liste pour tous, **rien n'est envoyé**
avec. Couper l'option rend la permission.

**Option Contribuer au réseau Neuronal (coupée par défaut).** Si tu l'actives
(Réglages › Valeurs), avec la même permission sur `neuronal.live`, RoNote envoie
à `neuronal.live/ext/v1/` deux choses, et seulement elles : **la présence de ton
compte** (identifiant Roblox, pseudo, nom affiché, version de l'extension et
valeur de ton inventaire si le suivi du portefeuille est actif), au plus toutes
les 6 heures, pour que le réseau te montre sur sa carte comme utilisateur
RoNote ; et **tes trades terminés**, chacun une seule fois, tels que Roblox les
a rendus : les objets de chaque côté (identifiants, exemplaires, numéros de
série), les **Robux** de chaque côté, et l'identifiant et le pseudo Roblox de
ton partenaire. Seuls les trades dont RoNote a déjà lu le détail partent :
l'option n'ajoute aucune requête vers Roblox. Ni cookie, ni jeton, rien de ta
navigation. Couper l'option arrête tout de suite les envois.

**La page neuronal.live voit RoNote.** Sur `neuronal.live` (et nulle part
ailleurs), la page peut demander deux choses à RoNote : s'il est installé, avec
sa version et l'état de la contribution (oui ou non), et d'ouvrir ses réglages
Neuronal. Rien d'autre n'est répondu : ni compte, ni trade, ni réglage. Sur
Chrome, la page peut le demander dès que RoNote est installé ; sur Firefox,
seulement une fois l'accès à `neuronal.live` accordé.

**RoNote premium (facultatif, pour les abonnés du Discord Neuronal).** Les Fiches
Neuronal, les Profils et les Deals ne sont servis par `neuronal.live` qu'aux abonnés.
Pour les débloquer (Réglages › Premium), tu choisis **Connecter Discord** ou tu
entres la **clé** reçue du Discord Neuronal. *Connecter Discord* ouvre la page de
connexion de Discord elle-même, par le navigateur (permission `identity`) ; Discord
ne donne à Neuronal que ton **identifiant et ton nom Discord** (portée `identify` :
ni e-mail, ni liste de serveurs, ni messages). Avec une clé, RoNote envoie la clé et
l'identifiant et le pseudo Roblox du compte qu'il suit. Pour prouver que ce compte
Roblox est bien le tien, tu colles un court code dans la description **publique** de
ton profil Roblox, que `neuronal.live` relit sur la page publique du profil ; RoNote
n'envoie jamais ta session ni ton cookie Roblox. À la place du code, tu peux
**te connecter avec Roblox** : la page d'autorisation de Roblox elle-même (OAuth 2.0,
portées `openid` et `profile`) donne à `neuronal.live` ton identifiant et ton pseudo
Roblox, rien d'autre. RoNote garde ensuite un **jeton
signé** (valable 24 h, renouvelé tout seul) dans son stockage local et le joint, avec
l'identifiant Roblox suivi, aux seules requêtes premium. Neuronal garde ton
identifiant Discord, l'identifiant et le pseudo Roblox liés, et tes sessions (des
dates seulement), pour vérifier ton abonnement à chaque requête. *Se déconnecter*
ferme la session sur le serveur et efface le jeton. Le premium est indépendant de la
contribution : se connecter n'envoie rien de tes trades.

**Partager un proof (RoNote premium, Elite Neuronal seulement).** Sur un trade terminé,
le bouclier du mode proof ouvre à droite un panneau qui prépare les cinq lignes que Rolimons
demande dans son salon #proofs (objets, values, expéditeur, destinataire, date), que tu
peux modifier. Seulement quand tu cliques *Envoyer dans mes MP*, RoNote prend une capture de
l'onglet, la découpe sur le trade (et, si tu coches la case, la liste des trades avec les
autres pseudos cachés par le mode proof), et envoie l'image et les cinq lignes à
`neuronal.live` avec ton jeton premium. La capture utilise la permission `activeTab`, donnée
par un clic sur l'icône de RoNote dans cet onglet, ou la permission facultative de capture
si tu l'as accordée une fois (*Autoriser les captures*) ; sans elles, tu peux la prendre avec le
partage d'onglet de Chrome, qui te demande d'abord. Neuronal te les renvoie, **à toi**, en MP
Discord par son bot RoOp Tracker, et ne garde pas l'image.

**Trade ads automatiques (désactivées par défaut, en préparation).** Si tu les actives (menu
du compte › Trade ads automatiques), RoNote publie l'annonce que tu as composée (les items
que tu offres, les items ou tags demandés) sur les sites cochés, à l'intervalle choisi, jamais
plus d'une fois toutes les 15 minutes par site. Il réutilise la session que **tu** as ouverte
sur chaque site dans ton navigateur : RoNote ne demande, ne garde ni ne tape aucun mot de
passe, et ne lit aucun cookie. Ce qui part, c'est l'annonce elle-même et ton identifiant
Roblox : vers `api.rolimons.com` (Rolimon's), et vers `routility.io` (RoUtility) seulement
après que tu as accordé cette permission facultative. Rotility n'est pas automatisé
(vérification anti-robot à chaque annonce, et ses conditions l'interdisent).

**Sans ces options, aucune requête ne part vers un autre domaine.**

## L'utilisation de ta session Roblox

Pour lire *tes* trades, RoNote interroge l'API de Roblox en réutilisant la session
déjà ouverte dans ton navigateur : exactement comme le fait le site roblox.com quand
tu navigues dessus.

RoNote **ne lit pas ton mot de passe, ne le stocke pas et ne le transmet pas**. Elle
ne copie pas non plus ton cookie de session : celui-ci reste géré par le navigateur,
qui l'attache lui-même aux requêtes vers Roblox.

## La seule action qui modifie ton compte

RoNote peut **refuser** un trade reçu, **annuler** un trade envoyé et, depuis la
version 2.16.0, **accepter** un trade reçu. Toujours sur ton clic explicite, en deux
temps : un premier clic arme le bouton, un second dans les 5 secondes confirme.
Accepter transfère des objets et ne se défait pas : c'est pour cela que le second
clic est obligatoire. Si Roblox exige une vérification en deux étapes, RoNote ne
la contourne pas : il ouvre le trade sur roblox.com, où tu termines toi-même.

RoNote peut aussi envoyer une **contre-offre** à un trade reçu, composée dans
son éditeur : tu choisis les objets et les Robux de chaque côté, l'écart est simulé,
puis l'envoi se confirme en deux clics, de la même façon. Pour te proposer les
objets, RoNote lit les limiteds des deux joueurs sur `inventory.roblox.com`, au
moment où tu ouvres l'éditeur ; rien n'en est conservé. RoNote **ne crée jamais de
trade de lui-même** : il n'envoie qu'en réponse à un trade reçu, sur ton clic.

## Les permissions demandées, et pourquoi

| Permission | À quoi elle sert |
|---|---|
| `storage` | Conserver tes réglages et l'état de suivi entre deux démarrages |
| `alarms` | Déclencher la vérification périodique des trades |
| `notifications` | Afficher les notifications bureau : la fonction même de l'extension |
| `scripting` | Lire le trade affiché à l'écran quand l'API ne renvoie pas le détail |
| `offscreen` | Jouer le son d'alerte, un service worker Chrome ne pouvant pas produire d'audio |
| `sidePanel` | Ouvrir RoNote dans la barre latérale du navigateur, si tu choisis ce mode |
| `identity` | Ouvrir la page de connexion de Discord pour *Connecter Discord* (RoNote premium), seulement quand tu cliques dessus |
| `activeTab` | Prendre la capture de *Partager un proof* (RoNote premium), seulement de l'onglet où tu as cliqué l'icône de RoNote, seulement quand tu cliques *Envoyer* |
| Tous les sites (facultatif) | Seulement si tu cliques *Autoriser les captures* (Réglages › Apparence › Mode proof) : permet à *Partager un proof* de prendre sa capture sans clic préalable sur l'icône de RoNote. Ne sert à rien d'autre ; tu peux la retirer dans les réglages d'extensions du navigateur |
| `declarativeNetRequestWithHostAccess` | Corriger les en-têtes `Origin` et `Referer` des requêtes de RoNote vers Roblox, que Roblox rejetterait sinon. S'applique **uniquement aux requêtes émises par l'extension** (hors onglet), jamais à ta navigation |
| `*.roblox.com` | Le site dont RoNote lit les trades |
| `*.rolimons.com` | La table publique des valeurs, les historiques publics des objets, le profil Rolimon's public des joueurs dont tu ouvres la fiche et, avec le suivi du portefeuille, le tien |
| `routility.io` (optionnelle) | Demandée seulement si tu coches RoUtility dans les trade ads automatiques : vérifie que tu y es connecté et publie ton annonce, avec la session que tu as ouverte toi-même |
| `neuronal.live` (optionnelle) | Demandée seulement si tu actives les Fiches Neuronal ou la contribution : ce que le réseau sait d'un joueur ou d'un objet dont tu ouvres la fiche ; avec la contribution, la présence de ton compte et tes trades terminés |

## Enfants et âge minimum

RoNote ne collecte aucune donnée te concernant, quel que soit l'âge de
l'utilisateur. Seule l'option Fiches Neuronal, coupée par défaut, envoie
l'identifiant public d'un autre joueur ou d'un objet.

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
