# Journal des versions

Toutes les versions notables de RoNote : ce qui change du point de vue de
l'utilisateur, pas la liste des commits.

## En préparation

- **Demande** : la ligne sous la value ne passe plus sous « Total Value » quand elle ne déborde que
  de quelques pixels : RoNote regarde ses quatre coins et fait exactement la place qui manque.
- **Nom de l'objet sur une ligne** (« XXL Basketball… », le nom entier au survol) quand la demande
  est affichée : la ligne gagnée accueille la demande sous la value, sans rien pousser.

## v2.16.12 : demande mieux placée

- **Demande** : de nouveau sur sa propre ligne sous la value ; si la carte de Roblox est trop basse,
  RoNote lui fait la place au lieu de la laisser passer sous les totaux. Icône par défaut : les barres
  façon signal (les autres restent au choix). La table Neuronal est revalidée à chaque lecture : un
  changement côté serveur (objets dès 400, comme Kuddle E. Koala ou Ultimate Victory) se voit tout de suite.
- **Mode anonyme** : le pseudo et le portrait du menu de gauche de Roblox sont masqués aussi.

## v2.16.11 : demande des objets

- **Demande des objets** (page de trade) : une note sur 5 sur la ligne de la value Rolimon's de chaque
  objet. C'est la demande publiée par Rolimon's (Terrible = 1 … Amazing = 5) ; pour un objet sans
  demande Rolimon's, avec les Fiches Neuronal, son rang dans le classement Neuronal des objets les plus
  tradés sur 30 jours. N/A pour les projected et les eggs à 200-300. Sous chaque total, la demande
  moyenne du côté, pondérée par la value. L'infobulle dit d'où vient la note.
- **Icône de la demande** (Réglages › Apparence) : flamme, étoile, éclair, losange, cœur, courbe,
  point ou aucune, ou ta propre image.
- **Mode anonyme sur roblox.com** : ton pseudo et ton solde de Robux de la barre du haut sont masqués aussi.

## v2.16.10 : visages et bundles

- **Visages et bundles** : leur image s'affiche dans Deals, Profils et les cartes Neuronal (deux
  lettres à la place jusqu'ici), et leur lien Rolimon's mène à leur page `/bundle/` (fiche d'objet,
  page de l'objet sur Roblox, pastilles de la page de trade).

## v2.16.9 : message d'erreur de connexion

- Premium : une connexion non confirmée (Discord ou Roblox) le dit sans accuser Discord à tort.
  Côté Neuronal, « Se connecter avec Roblox » n'expire plus après « Confirm and Give Access ».

## v2.16.8 : se connecter avec Roblox

- **Se connecter avec Roblox** (Réglages › Premium) : pour vérifier ton compte
  Roblox, la page d'autorisation officielle de Roblox (OAuth 2.0, identifiant et
  pseudo seulement) remplace le code à coller dans la description. Le code reste
  en secours tant que l'application RoNote n'est pas publiée par Roblox.
- Si Roblox confirme un autre compte que celui suivi par RoNote, rien n'est lié.

## v2.16.7 : RoNote premium

- **Premium** (nouveau, Réglages › Premium) : les Fiches Neuronal, les Profils
  et les Deals sont réservés aux abonnés du Discord Neuronal. Tout le reste de
  RoNote reste gratuit.
- **Connecter Discord** en un clic (page de connexion de Discord, portée
  `identify` seulement), ou **J'ai une clé** : la clé reçue en DM à
  l'abonnement, ou avec `/key` sur le Discord.
- Le compte Roblox est **vérifié** : un code de quatre mots à coller dans la
  description du profil, relu par Neuronal sur la page publique. Un compte
  Roblox par abonnement, changeable tous les 7 jours.
- Le verrou est sur le serveur : sans jeton signé par Neuronal, rien n'est
  rendu, et l'abonnement est revérifié à chaque appel. Le jeton (24 h) se
  renouvelle tout seul.
- Dans le popup, une fonction verrouillée dit pourquoi (pas connecté,
  abonnement terminé, compte Roblox à vérifier) avec Débloquer et S'abonner ;
  « Premium » dans le menu du compte.
- Nouvelle permission `identity` (seulement pour Connecter Discord), politique
  de confidentialité mise à jour. La contribution au réseau reste un choix à part.

## v2.16.6 : contre-offre fiable

- **Contre-offre** : un objet n'est plus annoncé « plus dans l'inventaire » à
  tort. Un objet que l'inventaire chargé ne montre pas (bundle, inventaire de
  plus de 500 objets, page perdue sur une limite de débit) est vérifié auprès
  de Roblox ; sans réponse, il reste dans le trade et Roblox tranche à l'envoi.
- Affichage : série de chaque exemplaire, objet non vérifié signalé, Robux
  inclus dans le total, chargement en squelette et bouton Recharger.
- Plus rapide : les inventaires restent une minute en cache, mon inventaire et
  celui du partenaire se chargent en parallèle avec les réglages.

## v2.16.5 : Découvrir, Profils et Deals

- **Deals** (nouveau) : le Deal Sniper de Neuronal dans le popup. Les trade ads
  des 15 dernières minutes notées sur 100 (paliers S, A, B), ce qu'on donne et
  ce qu'on reçoit en vignettes, le gain et les raisons. Une seconde liste,
  **Robux**, montre les joueurs qui vendent contre des Robux, avec le RAP et le
  prix le plus bas du catalogue Roblox. Filtres palier et taille à plusieurs,
  tri meilleurs ou récents, relu chaque minute.
- **Profils** : plusieurs paliers à la fois, et les nouveaux profils entrent en
  haut de la liste en direct.
- **Découvrir** : Profils et Deals sous une seule icône (radar), avec un
  sélecteur en tête ; le **Journal** passe dans le menu du compte (et reste
  accessible par « Tout le journal » sur l'accueil).
- **Pages de trade** : un petit lien Rolimon's au bout de la pastille de value
  de chaque objet, et un bouton **Send again** à côté de Decline qui ouvre un
  nouveau trade avec le même joueur.
- **Moins de données** : une liste inchangée revient en 304 vide, et les grandes
  listes ne sont plus réécrites dans le stockage du navigateur à chaque lecture.

## v2.16.4 : textes plus propres

- Les tirets cadratins disparaissent des textes de l'extension : phrases
  ponctuées avec « : » ou « , », et les cases vides affichent « N/A ».

## v2.16.3 : Profils plus rapides, filtres par liste et par value

- **Profils** : choix de la liste, *Les deux* (mêlées, les plus récentes d'abord),
  *Classique* ou *Neuronal*, et un filtre **Inventaire** (10k+, 50k+, 100k+,
  500k+, 1M+) en plus du palier. Le nombre de profils trouvés s'affiche.
- **Plus rapide** : chaque liste est lue une seule fois (gardée 2 min), les
  filtres trient dans le popup sans rien redemander, et les fiches s'affichent
  par paquets de 15 à mesure qu'on descend.
- Fiches retravaillées : avatar entouré de la couleur du palier, value de
  l'inventaire en haut à droite, la carte du trade ou l'annonce, puis les actions.
  Chargement en silhouettes animées.

## v2.16.2 : Profils comme sur Discord, trades Neuronal en cartes

- **Profils** : chaque fiche montre ce que montre Discord, le trade qui a révélé
  le joueur (Neuronal) ou son annonce *Propose / Cherche* (classique), avec les
  vignettes et les values, son avatar, et un bouton **Envoyer un trade**
  (plus Roblox et Rolimon's). En-tête compact et collant, paliers sur une ligne.
- **Fiches Neuronal** (joueur et objet) : les derniers trades sont dessinés comme
  sur neuronal.live, les deux côtés en vignettes avec leurs totaux et les Robux.
  Un clic sur un objet ouvre sa page Rolimon's.
- **Objets sans value Rolimon's** : la case Value affiche «, » au lieu du RAP,
  et la fiche, les lignes de trade et le portefeuille disent que le chiffre est
  un RAP.
- Barre d'onglets resserrée : elle ne déborde plus avec l'onglet Profils.

## v2.16.1 : Profils

- **Onglet Profils** (l'icône à droite de Journal, ou menu du compte › Profils) : le Profile discovery de Neuronal
  dans le popup. Deux listes, *Classique* (les joueurs repérés par leurs annonces
  Rolimon's) et *Neuronal* (les joueurs vus en train de trader), avec un filtre
  par palier : ghost, rookie, novice, beginner… Les utilisateurs RoNote portent
  l'étiquette « RoNote user ». Lu sur neuronal.live (`GET /ext/v1/profiles`),
  seulement si les Fiches Neuronal sont actives ; seuls la liste et le palier
  choisis sont envoyés, gardés 2 min.

## v2.16.0 : l'interface Neuronal, le réseau, la barre latérale et les animations

**Une nouvelle interface par défaut dans le style du site Neuronal, la
contribution au réseau Neuronal, RoNote dans une barre sur le côté du
navigateur, et du mouvement qui dit quelque chose.**

- **Contribuer au réseau Neuronal** (Réglages › Valeurs, coupé par défaut, même
  permission que les fiches) : le compte apparaît sur la carte de neuronal.live
  avec le cadre RoNote, et ses trades terminés y sont envoyés tels que Roblox
  les a rendus : exemplaires exacts (userAssetId, série) et Robux de chaque
  côté. Seuls les trades dont le détail est déjà en cache partent : aucune
  requête de plus vers Roblox. Présence au plus toutes les 6 h, chaque trade une
  seule fois, pause de 6 h tant que le site n'a pas ouvert la route.
- **« Rejoindre la carte Neuronal ? »** : une carte en haut de l'accueil, à
  l'installation comme à la mise à jour (`neuronalAsked` manque chez les anciens
  utilisateurs), dit ce qui serait envoyé. « Contribuer » demande la permission
  et active la contribution et les fiches ; « Non merci » ne la montre plus.
  Rien n'est activé sans ce clic. Sur Firefox, qui ferme le popup sur la boîte
  de permission, le worker termine l'activation (`neuronalJoinAt`, 2 min).
- **Fiches Neuronal** : drapeau bleu « Utilise RoNote », Robux des trades du
  réseau, étiquette « RoNote » sur les trades confirmés par un utilisateur.
- Lien vers la future page `neuronal.live/ronote` dans les réglages.
- **La page `neuronal.live/ronote` reconnaît RoNote** : sur Chrome par
  `externally_connectable` (`ronote:hello` → version et état de la
  contribution, `ronote:open` → réglages Neuronal), limité à l'origine
  `https://neuronal.live`. Sur Firefox, un content script qui poste les mêmes
  informations à la page, enregistré seulement quand la permission
  `neuronal.live` est accordée (le déclarer dans le manifeste l'aurait rendue
  obligatoire à l'installation).
- **Interface Neuronal** (popup, barre latérale et réglages) : le style du site
  neuronal.live. Des gris neutres au lieu du bleu-nuit teinté, un seul bleu
  franc, des aplats (plus de dégradés ni de halos), la police Onest servie par
  l'extension, des titres en casse normale au lieu des petites capitales, des
  onglets soulignés, et une surface par carte : les tuiles de l'accueil, du
  portefeuille et de l'état des réglages sont regroupées, séparées d'un filet.
  L'ancien style reste là : Réglages › Apparence › **Interface › Classique**.
- **Barre latérale** : le bouton tout à droite de l'entête ouvre RoNote sur le
  côté du navigateur (side panel de Chrome, sidebar de Firefox), qui reste
  ouvert pendant la navigation. Le choix est retenu : l'icône de RoNote rouvre
  ensuite le même mode. Le même réglage existe dans Réglages › Général.
- **Micro-animations**, inspirées de Fluid Functionalism : une pastille glisse
  d'un bouton, d'un onglet ou d'une ligne à l'autre sous le pointeur ; la
  section lue a la sienne dans le menu des réglages ; les pressions et les
  interrupteurs rebondissent ; l'icône de la barre latérale bascule en fondu
  flou. Tout passe par des ressorts courts, sur transform et opacity. Avec le
  réglage système « moins d'animations », seuls les fondus restent.
- **Thème Neuronal sur Roblox**, nouveau thème par défaut : le bandeau des
  écarts, la colonne des listes et le badge « projected » prennent le vert, le
  rouge et l'ambre du site. Le thème **RoNote** garde les couleurs d'avant. Si
  tu n'avais jamais touché à ces couleurs, elles changent avec la mise à jour.
- **Fiches Neuronal** (Réglages › Valeurs, coupées par défaut) : la fiche d'un
  joueur dit s'il est dans la base Neuronal (repéré depuis quand, trades vus,
  partenaires, bilan, bot de trade ou compte terminé) avec ses cinq derniers
  trades prouvés, objets de chaque côté ; la fiche d'un objet du portefeuille
  montre ses trades dans le réseau et combien de joueurs suivis le détiennent.
  À l'activation, le navigateur demande l'accès à `neuronal.live` (permission
  optionnelle : aucune réapprobation à la mise à jour). Seul l'identifiant du
  joueur ou de l'objet ouvert est envoyé, sans cookie ; la route du site ne
  fait que lire. La politique de confidentialité le dit désormais.
- **Accepter et contre-offre** (trades reçus) : sur chaque carte et dans le détail,
  à côté de Refuser. Accepter se fait en deux clics, le second dans les 5 s :
  accepter transfère des objets et ne se défait pas. Le trade accepté est marqué
  vu (pas d'alerte de ton propre geste), mais un rejet ultérieur de Roblox reste
  signalé. Si Roblox exige une vérification en deux étapes, RoNote ne la
  contourne pas et ouvre le trade sur roblox.com. La politique de
  confidentialité et les README le disent.
- **Contre-offre dans le popup** : l'éditeur reprend le trade reçu (ce que tu
  donnes, ce que tu demandes) et montre les deux inventaires Roblox, exemplaire
  par exemplaire, cotés et illustrés. Un clic ajoute ou retire un objet (quatre
  par côté, les objets en hold grisés), des Robux s'ajoutent de chaque côté, et
  l'écart se recalcule à chaque geste avec les règles des cartes (base de cote,
  Robux reçus nets de taxe) : on simule avant d'envoyer. L'envoi se confirme en
  deux clics ; une vérification exigée par Roblox ouvre le trade sur roblox.com.
- **Cartes allégées** : le « Détail des objets » dépliable sous chaque carte (et
  son réglage) disparaît ; cliquer un objet ouvre sa fiche complète.
- **Entête du compte** : le logo et le nom de RoNote laissent la place à ton
  portrait, ton nom et ton @pseudo (le contour passe à l'ambre en pause). Un clic
  ouvre le menu du compte : les autres comptes déjà vus sur ce navigateur, le mode
  anonyme (H), la pause, pile ou face et ton profil Roblox. RoNote ne garde ni
  cookie ni jeton : la bascule se fait avec le sélecteur de comptes de roblox.com.
  L'entête ne garde que Vérifier, Réglages et Barre latérale ; pile ou face quitte
  la barre d'onglets pour le menu.
- **Changement de compte sans rafale de notifications** : l'identité du compte
  n'était redemandée que toutes les 15 min ; entre-temps, les trades du nouveau
  compte, comparés aux ids vus de l'ancien, passaient tous pour neufs. RoNote
  revérifie désormais l'identité avant de notifier quoi que ce soit, et une page
  roblox.com signale tout de suite le compte qui y est connecté. Le journal
  n'affiche que les entrées du compte suivi.
- **Trades rejetés par Roblox, en entier** : une ligne du journal (ou de la fiche
  d'un joueur) s'ouvre dans le popup avec les deux colonnes d'objets, le
  partenaire et l'issue : pour une erreur Roblox, ce qu'elle veut dire.
- **Le son dit si le trade est bon** (Réglages › Son, actif par défaut) : cinq
  notes, de très mauvais à très bon, pour un trade reçu ou conclu, aux mêmes
  seuils que le verdict. Un trade sans cote garde le son choisi.
- **Portefeuille** : quand le profil Rolimon's ne répond pas (page anti-robot),
  l'inventaire s'affiche quand même, value et RAP additionnés depuis le catalogue
  et marqués « estimé », au lieu d'un « Chargement » sans fin.
- **Discord Neuronal** : un bouton pour rejoindre le serveur (discord.gg/neuronal),
  le même que sur le site, au pied du popup et en haut des réglages.

## v2.15.1 : le Flex du portefeuille, et un vrai mode anonyme

**Le Flex du portefeuille refait, dans le style de Trade Flex, et un mode
anonyme qui ne laisse plus rien passer.**

- **Flex** (Portefeuille, à côté de l'œil) : une carte en paysage, dans le style
  de Trade Flex. Le **gain** en vedette (« GAIN SUR 1 MOIS », +52 370, ▲ +2,9 %),
  la value du compte à côté, le graphique Rolimon's et une barre RAP · Rang ·
  Objets. Plus d'objets sous la carte, et plus de choix Inventaire / Bilan : un
  bouton, une carte. Le bilan du mois reste dans le Journal.
- **Les chiffres de Rolimon's** : la carte prend la courbe publiée par
  Rolimon's, sur la période et avec les courbes choisies dans le Portefeuille.
- **Périodes comptées comme sur Rolimon's** : 1m part du même jour le mois
  précédent (24 août → 24 sept.), 3m / 6m / 1a en mois du calendrier, depuis le
  dernier point de la courbe. Avant, RoNote comptait 30 jours depuis
  maintenant, et la variation ne tombait pas sur celle du site.
- **Mode anonyme** (l'œil de l'entête, ou la touche H) : chaque montant devient
  un faux nombre fixe, flouté : il n'y a plus rien du vrai dans la page, pas
  même son nombre de chiffres. Rang, objectif et pseudo sont masqués aussi ; les
  pourcentages restent lisibles.
- **Carte Flex anonyme** : le % à la place du gain, UP / DOWN / FLAT, variations
  de la value et du RAP, sans un seul montant ni rang.

## v2.15.0 : Roblox à ton image

**RoNote va plus loin sur roblox.com et devient personnalisable.** Les écarts
s'affichent sur les listes de trades, la value apparaît sur la page d'un
limited, et l'apparence se règle d'un coup avec des thèmes, fond compris.

- **Listes de trades** (Reçus, Envoyés, Terminés) : l'écart de RAP et de Value
  de chaque trade à droite de sa ligne, sans l'ouvrir.
- **Page d'un limited** : une rangée « Value » sous « Best Price », avec la
  demande, la tendance et un lien direct vers sa fiche Rolimon's.
- **Ton image en fond de roblox.com**, avec un voile de la couleur de ton thème
  Roblox pour garder le texte lisible, et un flou au choix.
- **Thèmes** : RoNote, Minimal, Néon, Sunset, Océan et Casino règlent d'un coup
  le bandeau, les listes, le badge « projected » et le fond. Un thème s'exporte
  dans un fichier pour être partagé.
- **Flex mon inventaire** (Portefeuille) : une carte avec la value du compte, sa
  courbe et les six plus gros objets, à copier ou télécharger.
- **Bilan du mois** (Journal et Portefeuille) : value gagnée en trade, taux de
  victoire, meilleur trade et évolution du compte, sur une carte à partager.
- **Fonds des cartes Flex** : des images fournies (Néon, Sunset, Océan, Casino),
  des fonds animés (Aurore, Étoiles, Synthwave, Bokeh), ou ton image ou ton GIF.
  Une carte animée se télécharge en **GIF**.
- **La carte Flex suit le graphique** : même période (7 jours… depuis le début)
  et même courbe (Value, RAP ou collectibles) que le Portefeuille.
- **Objectif** (Portefeuille) : une value ou un objet à atteindre, avec ou sans
  date limite. Progression, rythme actuel, rythme nécessaire et date estimée.
- **Tes sons** pour les notifications : importe un MP3, WAV, OGG ou M4A et
  choisis-le pour n'importe quel type d'événement.
- **Pile ou face** (nouvel onglet du popup) : un jeton vert R$ ou orange T pour
  trancher un trade qui fait hésiter.
- **Repères** : un diamant sur les objets « rares » de Rolimon's, un chat doré
  sur l'exemplaire tiré par le Lucky Cat.
- **Réglages refaits** : moins de sections, une recherche (touche /), une
  section Apparence avec aperçus en direct, la sauvegarde des réglages dans un
  fichier, et les réglages sans effet grisés.
- **Plus fluide** : les scripts de trade ne travaillent plus sur les autres
  pages de Roblox (défilement, pages de jeux), et les cotes Rolimon's sont
  relues toutes les 15 minutes au lieu de 3 heures.

## v2.14.0 : les visages, Rolimon's est à jour

**Rolimon's compte enfin les visages correctement.** Depuis sa mise à jour de
septembre 2026, il les compte d'après les bundles réellement possédés : un
visage échangé ne traîne plus dans l'inventaire de son ancien propriétaire, un
visage reçu y apparaît. Vérifié sur des comptes réels : la valeur du profil est
exactement la somme des objets comptés, et chaque visage compté correspond à un
bundle possédé.

La correction que RoNote faisait depuis la v2.1 (valeur Rolimon's − visages
fantômes + visages absents) n'a donc plus lieu d'être. Elle aurait même pris le
simple retard de scan de Rolimon's, juste après un trade, pour une erreur de
comptage.

- **La valeur du compte est celle de Rolimon's**, telle quelle. Le panneau
  « Réconciliation des visages », la ligne « RoNote corrige de… » et le réglage
  « Corriger les visages passés en bundles » disparaissent.
- **Plus léger** : le portefeuille et la fiche joueur ne demandent plus la liste
  des bundles à Roblox (jusqu'à 8 pages). Deux appels à Rolimon's par
  rafraîchissement, aucun à Roblox.
- **Les visages restent reconnus** : Rolimon's les liste toujours sous leur ancien
  identifiant d'asset ; RoNote les rattache à leur bundle, pour la cote, la
  vignette et les alertes de réévaluation.
- **Fiche joueur** : la liste de ses bundles reste, l'onglet « Qu'il n'a plus » et
  la ligne de correction disparaissent.
- **Alertes de réévaluation** : elles ne dépendent plus que du suivi de la valeur
  du compte.
- Le « Quoi de neuf » des réglages et de l'accueil couvre de nouveau les
  dernières versions (il s'arrêtait à la v2.11.1).

**Trade Flex refait.** Carte rendue en 2× (nette une fois partagée), verdict
lumineux, écarts RAP et value côte à côte autour d'un rond ⇄, value étiquetée
sous chaque objet, badge sur les objets projected, date en pied de carte. La
fenêtre gagne des commandes segmentées (fond, résultat mis en avant), un vrai
bouton **Copier** (presse-papiers), et la carte tient entière à l'écran. Le bouton
n'apparaît plus que sur un **trade terminé** : on flexe un trade conclu, pas une
offre en attente ou tombée à l'eau. L'état se lit dans le titre des offres
(« Items you gave » contre « Items you will give »), l'onglet Terminés de l'URL
sert de repli.

**Pages de trade : les boutons ont une place fixe.** Roblox tronque le titre
« Trade with … @pseudo » avec « … » : les boutons #, Rolimon's et Trade Flex,
posés à la suite du pseudo, passaient dessous avec un nom long, et bougeaient à
chaque changement de trade. Ils sont maintenant calés au bord droit du titre,
leur place réservée une fois pour toutes : le « … » de Roblox coupe le nom avant
eux, et ils ne bougent plus. Le bouton Trade Flex (trade terminé seulement) se
place à gauche, sans décaler les deux autres, avec une icône dessinée à la place
de l'emoji. Tout est rendu tel quel en quittant la page.

**Pages de trade : fini le bandeau grisé jusqu'au rafraîchissement.** Quand la
première réponse arrivait incomplète (table des cotes en cours de chargement,
trade réaffiché par Roblox depuis son propre cache sans nouvelle requête), le
calcul n'était redemandé qu'une minute plus tard. Il l'est maintenant après
1,5 s, puis 3, 6, 12 et 25 s, et tout de suite au retour sur l'onglet.

**Pages de trade : chiffres groupés par milliers.** La cote Rolimon's sous chaque
objet, les totaux par offre et les cotes des inventaires s'affichent comme les
chiffres de Roblox : « 14 996 » en français, « 14,996 » en anglais, au lieu de
« 14996 ».

**Fini les « Extension context invalidated » en rafale.** Recharger ou mettre à
jour l'extension laisse l'ancienne copie de ses scripts tourner dans les onglets
Roblox ouverts, coupée de l'extension : chaque vérification (toutes les 2 s,
et à chaque changement de la page) levait une erreur. Cette copie orpheline le
détecte maintenant, retire tout ce qu'elle avait posé sur la page et s'arrête ;
les messages restés sans `.catch` dans `relay.js` et `scrape.js` sont couverts
aussi. Recharger l'onglet réinstalle la nouvelle version.

## v2.13.0 : Trade Flex personnalisable

- Carte inspirée des offres Roblox : grilles de vignettes, donné/reçu, totaux et comparateur central.
- Résultat WIN / LOSS / EVEN, pourcentage et bordure colorée selon le RAP ou la Value sélectionnée.
- Fonds Nuit, Violet ou image personnelle PNG/JPEG/WebP, avec réglage d'assombrissement. Import traité localement, conservé pendant la session de page.
- Export PNG et copie de l'image par clic droit conservés.

## v2.12.1 : Trade Flex

- Bouton trophée après le profil Rolimon’s : génère une image PNG du trade, copiable par clic droit ou téléchargeable.
- Deux colonnes donné/reçu, objets, totaux et écarts RAP / Value. Pseudos et serials omis de l'image.
- Miniatures affichées quand disponibles, avec un symbole de remplacement si leur chargement échoue.

## v2.12.0 : affichage des trades et confidentialité

- Refonte des bandeaux RAP / Value et harmonisation de l'affichage des valeurs sur les pages de trade.
- Valeurs Rolimon’s sous les objets et totaux par offre ; RAP utilisé pour les objets sans cote publiée.
- Raccourci vers le profil Rolimon’s du partenaire et bouton « # » pour flouter les serials.
- Gains RAP / Value séparés par des virgules pour les milliers.
- Liens vers l'historique des exemplaires identifiés par leur serial.

**Limite connue :** le clic sur les étoiles des objets sans serial ne retrouve pas encore systématiquement l'historique. Ce point reste en attente de correction.

## v2.11.1 : les limites de débit, et le refus qui ne partait pas

**Corrigé : le refus en deux clics depuis une carte pouvait ne jamais partir.**
L'état « armé » du bouton vivait dans la page seule : un rafraîchissement de
fond reconstruisait la liste et le remettait au repos sans prévenir, si bien
que le second clic ne faisait que le réarmer. Le trade restait là.

**Les trades suivis se voient enfin, et se retirent.** Le compteur annonçait
« 19 trades suivis » alors que l'onglet Envoyés n'en montrait aucun : ceux qui
ne sont plus dans les 100 derniers envois n'étaient affichés nulle part, donc
impossibles à désépingler. Ils ont maintenant leur bloc en bas de l'onglet, avec
le partenaire, depuis quand ils sont suivis, et de quoi les retirer : un par un
ou tous d'un coup. Un suivi posé automatiquement s'abandonne désormais au bout
d'une semaine, au lieu d'un mois comme une épingle posée à la main.

**Les courbes suivaient avec un train de retard.** À l'accueil comme dans l'onglet
Portefeuille, elles ne montraient que les relevés de Rolimon's, qui ne rescanne un
compte que quelques fois par jour : le solde affiché juste au-dessus avait bougé,
la courbe non. Elles se terminent maintenant sur le dernier relevé de RoNote, et
la note sous celle du portefeuille le dit.

**La cause principale : les trades suivis.** La liste des trades envoyés
s'arrête à 100 entrées. Un trade suivi plus ancien que ces 100-là, mais toujours
ouvert, n'y figure plus : RoNote redemandait alors son détail à chaque
vérification, six par passage, indéfiniment. Avec une vingtaine de trades
suivis, cela suffisait à tenir la limite de débit de Roblox allumée en
permanence. Désormais un même trade suivi n'est plus redemandé avant dix
minutes, et son issue arrive le plus souvent sans aucun appel : les listes
Terminés et Inactifs la portent déjà, et retirent le suivi elles-mêmes : au
passage, plus de risque de double notification.

**Un plafond de cadence, qui s'apprend.** Limiter le nombre d'appels en vol ne
limite pas leur cadence. RoNote se tient maintenant sous un plafond en requêtes
par minute, par service ; chaque refus le divise par deux, et il remonte d'un
cran après dix minutes sans refus. L'extension s'ajuste donc au quota réel de
ton compte au lieu de le découvrir à chaque fois.

**Une seule porte de sortie.** Au plus 5 requêtes Roblox et 3 Rolimon's à la
fois, toutes origines confondues : la vérification de fond, le popup qui défile
et une fiche joueur ouverte respectaient chacune « sa » limite sans rien savoir
des autres, et leurs salves s'additionnaient. Une limite de débit ferme
désormais la porte du service concerné pour tout le monde, au lieu que chaque
appel suivant aille la chercher à son tour. Et la pause s'écarte si la limite
revient : 30 s, puis 60, puis 90, plafonné à 5 min.

**Beaucoup moins de « HTTP 429 ».** RoNote provoquait lui-même la limite de
débit de Roblox : un lot de cent vignettes refusé était rejoué image par image,
toutes en même temps et chacune avec son propre réessai. La limite se
prolongeait toute seule, et c'est la vérification des trades : innocente, qui
récoltait l'erreur et allumait le point rouge.

- plus de reprise une par une sur une limite de débit ; hors limite, quatre à
  la fois au lieu de cent ;
- le délai demandé par Roblox (`Retry-After`) est respecté au lieu d'être
  plafonné à 5 s ;
- les 429 sur le détail d'un trade posent enfin une pause, au lieu d'enchaîner
  dix appels condamnés d'avance ;
- « vérifier maintenant » ne contourne plus la pause d'une limite de débit :   le réflexe devant le point rouge la prolongeait ;
- les appels Rolimon's de la fiche joueur et du portefeuille ont eux aussi un
  réessai et un délai ;
- le message dit ce qui se passe et pour combien de temps, au lieu de
  « HTTP 429 ».

**Les listes ne clignotent plus pendant le chargement.** Elles étaient réécrites
en entier après chaque lot de six évaluations : jusqu'à cinq fois de suite pour
vingt-cinq trades, et autant de fois où toutes les vignettes étaient détruites
puis rechargées. Une carte prête remplace maintenant sa silhouette sur place.

**Le reste du rendu.** L'infobulle des courbes était mesurée après avoir été
écrite, à chaque image du survol ; la fiche d'un joueur recalculait deux fois la
même chronologie et se reconstruisait à chaque réponse reçue.

**Au clavier et au lecteur d'écran.** La barre d'onglets est un vrai `tablist` :
l'onglet actif est annoncé, les flèches gauche et droite le parcourent. Les
fiches et le zoom prennent le focus, le gardent tant qu'ils sont ouverts, et le
rendent en partant : le clavier restait derrière eux. L'attribut `lang` du
document suit la langue choisie.

**Réglages.** Quand le service worker ne répond pas, la page le dit au lieu de
rester figée ; une réponse vide n'écrase plus les réglages affichés.

---

## v2.11.0 : l'onglet Portefeuille refait

**L'onglet Bénéfice devient Portefeuille**, pensé comme une appli de portefeuille :

- **le solde en grand**, avec sa variation sur la période ;
- **des courbes superposables** : value, RAP et nombre de collectibles, seules ou
  empilées sur le même graphique. Au survol, une infobulle donne la valeur de
  chacune au jour pointé ; le plus haut et le plus bas de la période sont marqués ;
- **l'œil masque les montants** (jamais les pourcentages), pratique en partage d'écran ;
- quatre tuiles : l'autre chiffre, le rang, le nombre d'objets et l'effet des
  **réévaluations des 7 derniers jours** ;
- **la répartition** : le poids de tes 5 plus gros objets ;
- **Mes collectibles** : chaque objet avec vignette, quantité, cote, demande,
  tendance, et les marques rare, projected et visage. Recherche, tri, filtres
  (visages, rares, projetés, réévalués), vue liste ou galerie ; un clic ouvre la
  fiche de l'objet, **avec sa propre courbe** (value, RAP, meilleur prix, chaque
  révision de cote marquée) et ses liens Rolimon's et Roblox ;
- la réconciliation des visages reste là, repliée ;
- **tout est fluide** : entrée en cascade, courbes qui se tracent, solde qui défile
  jusqu'à sa valeur, fiche qui monte du bas. Rien ne bouge au rafraîchissement de
  fond, et tout se coupe si le système demande moins d'animations.

La liste suit l'inventaire réel : un visage possédé n'y figure qu'une fois, un
visage fantôme jamais. Elle est préparée par le service worker avec le reste du
portefeuille : ouvrir l'onglet ne déclenche aucun appel. Seule l'ouverture de la
fiche d'un objet charge son historique public chez Rolimon's, gardé 6 heures.

**Tous les onglets refaits dans le même style.**

- **En-tête** en verre et **barre d'onglets en pilules**, dont la pastille glisse
  d'un onglet à l'autre ;
- **Reçus, Envoyés, Terminés** : un bandeau en tête (combien, combien de gagnants
  et de perdants, le meilleur trade ou le bilan), des filtres en pastilles, et des
  cartes refaites : anneau de couleur autour de l'avatar selon le verdict, et
  l'écart toujours en grand sur fond vert ou rouge ;
- **le zoom sur un trade** monte du bas, verdict et écart en grand ;
- **le Journal** se lit comme un relevé : groupé par jour (Aujourd'hui, Hier…),
  une icône de couleur par type d'événement, l'heure, des filtres et le résumé des
  dernières 24 heures ; un clic ouvre le trade ;
- les cartes arrivent en cascade à l'ouverture d'un onglet, et une à une à mesure
  qu'elles sont évaluées : jamais au rafraîchissement de fond.

**Les onglets s'ouvrent plus vite.**

- un trade déjà vu n'est plus redemandé à Roblox toutes les 10 minutes : son
  contenu ne change jamais, il est gardé 7 jours et seule son analyse est refaite
  quand les cotes bougent : sans réseau ;
- les trades encore inconnus se chargent trois à la fois au lieu d'un par un ;
- en ouvrant le popup, les deux autres listes se préparent en arrière-plan : changer
  d'onglet montre des cartes prêtes ;
- l'ouverture lit tout en parallèle, et le rafraîchissement de fond ne redessine
  plus un onglet (et ses vignettes) quand rien n'a changé.

**La page de réglages refaite dans le même style.** Un menu fixe à gauche, avec une
icône par section, qui suit la lecture et y fait défiler en douceur ; l'état de
l'extension en tuiles dans un bandeau en tête ; de vrais interrupteurs à la place des
cases ; « Enregistré » en petit message qui glisse en bas à droite. Sur une fenêtre
étroite, le menu passe en barre horizontale. Le pied de page affiche enfin la vraie
version (il était resté bloqué sur 2.9.0). Aucun réglage ne change.

**Des icônes dessinées pour RoNote à la place des emojis.** Popup et réglages
utilisent désormais un seul jeu d'icônes au trait : même rendu sur Windows, macOS
et Linux, taille calée sur le texte, et couleur du verdict (une flamme verte pour
un excellent trade, une tête de mort rouge pour un très mauvais). Les
notifications du système gardent leurs emojis : Windows n'y affiche que du texte.

**La fiche d'un joueur.** Un clic sur l'avatar d'un partenaire, dans une carte ou
dans le zoom d'un trade, ouvre sa fiche **à côté du popup** : le popup s'élargit
vers la gauche, et la liste reste à droite, utilisable. Un second clic sur le même
avatar, la croix ou Échap la referment :

- la valeur de son inventaire, son RAP et son rang Rolimon's, avec **la courbe de
  son inventaire** : value, RAP et collectibles superposables, d'un mois à tout
  l'historique, comme pour ton portefeuille ;
- l'âge de son compte, **signalé s'il a moins de 30 jours**, et s'il est banni,
  vérifié ou vu en ligne récemment ;
- **entre vous** : les offres qu'il t'a envoyées et les tiennes, les trades conclus
  et leur bilan, et surtout **ce que ses offres te rapportent en moyenne** : un
  habitué des offres perdantes se repère d'un coup d'œil, et l'anneau de son avatar
  en prend la couleur ;
- **ses bundles** : ceux qu'il possède vraiment, y compris ceux que Rolimon's ne
  voit pas : et, dans un second onglet, **ceux qu'il n'a plus** mais que Rolimon's
  lui compte encore, avec sa value corrigée ; la même réconciliation que ton
  portefeuille, faite sur son compte ;
- la liste de vos échanges, du plus récent au plus ancien ; un clic rouvre le trade ;
- ses profils Roblox et Rolimon's, et un bouton pour l'ignorer (ou ne plus
  l'ignorer) sans passer par les réglages.

Ses profils publics ne sont demandés qu'à l'ouverture de la fiche et gardés 30
minutes, son historique 6 heures. Si une source ne répond pas, la fiche dit
laquelle et pourquoi, au lieu d'un simple « indisponible ». La politique de
confidentialité le mentionne.

**L'onglet Accueil.** Le popup s'ouvre désormais sur le résumé du jour :

- ton portefeuille, sa variation sur 24 heures et sa courbe de la semaine ;
- les trades reçus et conclus aujourd'hui (avec leur bilan), les alertes filtrées
  et les réévaluations (avec leur effet) ;
- **à traiter** : les trades en attente et la meilleure offre, l'offre qui expire
  le plus tôt dans les 24 heures, les trades suivis : un clic y mène ;
- les quatre derniers événements du journal.

Rien n'est demandé au réseau : l'accueil lit ce que le popup a déjà.

**Quoi de neuf, dans les réglages.** Chaque version, de la plus récente à la plus
ancienne, en français ou en anglais, la version installée marquée. Après une mise
à jour, un bandeau de l'accueil y mène, une fois.

**Tous tes trades, pas seulement les 25 derniers.** Reçus, Envoyés et Terminés
chargent la suite en arrivant en bas de la liste, 50 trades à la fois, jusqu'au
bout. Pour ne pas bombarder Roblox, un trade de la suite n'est évalué qu'en
approchant de l'écran. Avec un filtre actif (Gagnants, Perdants…), la suite se
charge au clic, et les trades déjà chargés sont tous évalués pour que le filtre
soit juste.

**Plus léger en arrière-plan, et deux bugs corrigés.**

- **Corrigé :** un clic sur une notification pouvait ne rien ouvrir. Sa destination
  était écrasée par la vérification en cours ; elle a maintenant sa propre place.
- **Corrigé :** le cache des trades déjà vus pouvait être effacé au réveil de
  l'extension, et chaque carte redemandée à Roblox à l'ouverture suivante.
- Un refus, un suivi ou une remise à zéro faits pendant une vérification ne sont
  plus écrasés par elle.
- **Beaucoup moins d'appels à Roblox et Rolimon's :**
  - le suivi des trades envoyés vérifie quelques trades par passage, à tour de rôle,
    et abandonne un suivi introuvable depuis un mois ;
  - le relais par un onglet Roblox est gardé pour les vrais échecs ;
  - une limite de débit arrête la vérification tout de suite au lieu de la prolonger ;
  - Rolimon's en panne est réessayé de plus en plus espacé (5 à 30 min) ;
  - la page d'historique n'est relue que quand un nouveau relevé existe ;
  - une erreur passagère n'est plus retenue comme « objet sans cote » pendant des jours.
- Le popup ne redemande plus tout au service worker à chaque vérification, et
  « il y a 3 min » avance sans reconstruire la liste. La page de réglages ne réveille
  plus l'extension toutes les 20 s, et ne remet plus à zéro un champ en cours de saisie.
- Les scripts ne tournent plus que sur www.roblox.com, et seulement sur la page
  des trades pour la lecture de l'écran. Les permissions Rolimon's se limitent aux
  deux adresses réellement utilisées.

**Politique de confidentialité corrigée.** Elle affirmait que Rolimon's ne reçoit
rien te concernant. C'est vrai pour la table des valeurs et les historiques
d'objets, mais le suivi du portefeuille interroge Rolimon's avec ton identifiant
Roblox (public) : c'est désormais écrit.

## v2.10.0 : les alertes de trades reçus réparées, et l'alerte de réévaluation

**Corrigé : les trades reçus ne déclenchaient presque plus d'alerte.** Roblox
numérote ses trades sans ordre, alors que RoNote les croyait croissants : tout
nouveau trade dont le numéro était plus petit que le plus grand déjà vu était
écarté sans un mot. Les trades complétés, suivis autrement, alertaient toujours : d'où une panne difficile à remarquer. RoNote se fie désormais aux trades déjà vus
et à leur date de création. Le suivi automatique des trades envoyés, touché par le
même défaut, est réparé du même coup.

**Nouveau : l'alerte de réévaluation.** Rolimon's révise ses cotes régulièrement,
parfois de plusieurs dizaines de pourcents d'un coup. RoNote te prévient désormais
quand la cote d'un objet de ton inventaire bouge d'au moins 10 % : seuil réglable,
à la hausse comme à la baisse :

- une seule notification par vérification, du plus gros impact au plus petit, avec
  l'ancienne et la nouvelle cote et l'effet sur la valeur de ton compte ;
- une ligne par objet dans le journal, et une sonnerie à part (**Pièces** par
  défaut) ;
- un visage possédé en bundle n'alerte qu'une fois, même quand Rolimon's publie sa
  révision sous ses deux identifiants ;
- aucune avalanche à l'activation : les révisions déjà connues sont ignorées.

**Firefox, prêt pour addons.mozilla.org.** Identifiant définitif
(`ronote@cpu-alt.github.io`) et déclaration « aucune donnée collectée », obligatoire
pour toute nouvelle extension depuis novembre 2025. Guide : `docs/publication-firefox.md`.

**Sous le capot.**

- `hook.js`, le seul script de contenu sans test, est testé avec `relay.js` : le
  jeton CSRF ne vise que l'origine de la page, et le relais refuse tout le reste.
  `check.py` refuse désormais tout `postMessage` vers « * » ;
- les restes de l'ancien panneau sur la page Roblox (retiré en 2.8.0) sont partis :
  traductions orphelines, un paramètre jamais utilisé, des passages de doc ;
- l'export CSV du journal gagne les colonnes des réévaluations.

## v2.9.2 : le nom de l'extension suit la langue du navigateur

Le Chrome Web Store tire le titre et le résumé **du paquet**, pas de la fiche :
une fiche en anglais affichait quand même « RoNote : Alertes de trades Roblox ».
Les deux manifestes passent donc par `_locales/`, avec l'anglais en langue de
repli.

- `src/_locales/en/messages.json` et `src/_locales/fr/messages.json` portent le
  nom, le résumé et l'infobulle du bouton ;
- les manifestes référencent `__MSG_appName__`, `__MSG_appDesc__` et
  `__MSG_actionTitle__`, avec `"default_locale": "en"`.

Un navigateur en français affiche le nom français, tous les autres l'anglais.
L'interface, elle, était déjà bilingue depuis la v2.4.

## v2.9.1 : le jeton CSRF n'est plus diffusé à la cantonade

Correctif d'hygiène, sans changement visible.

- `hook.js` transmettait le détail des trades et le jeton CSRF avec
  `postMessage(..., '*')` : le navigateur les livrait donc quelle que soit
  l'origine. Le message est désormais adressé à `location.origin`, et
  `relay.js` vérifie l'origine en plus de la fenêtre source.

Ça ne bouchait aucune fuite : n'importe quel script de la page peut déjà lire
ce jeton dans `meta[name="csrf-token"]`, et c'est d'ailleurs le repli qu'utilise
`relay.js`. Mais diffuser plus large que nécessaire n'a aucune raison d'être,
surtout dans une extension qui part en revue manuelle.

## v2.9.0 : le son ne se perd plus, et un son par événement

« Des fois je reçois la notification, des fois non. » Quatre causes trouvées,
quatre corrections :

- **le son manquait une fois sur deux.** Chrome ferme de lui-même le document
  audio (offscreen) après 30 s de silence ; RoNote croyait l'avoir encore et
  lui parlait dans le vide. Le service worker demande maintenant au
  navigateur, à chaque son, si le document existe encore : et le recrée sinon,
  avec deux tentatives puis un document neuf ;
- **un cycle de vérification pouvait rester bloqué pour de bon.** Aucun appel
  réseau n'avait de délai : une requête que Roblox ne terminait jamais gardait
  le verrou du cycle, et plus rien ne passait jusqu'au redémarrage du
  navigateur. Tous les appels ont un délai (20 s), et le verrou se périme au
  bout de 2 minutes ;
- **une étape qui échouait avalait ses trades.** Si la lecture d'une page
  réussissait puis que l'étape plantait, les trades tout juste découverts
  étaient déjà marqués « vus » : jamais notifiés. Le flux est remis dans son
  état d'avant, le passage suivant les reprend ;
- **le portrait du partenaire faisait échouer la notification riche.** Chrome
  n'accepte pas une URL du CDN Roblox comme icône ; la notification repartait
  en version dégradée après un délai. Le portrait est téléchargé et embarqué.

Et ce qui se voit :

- **un son par famille d'événement** : trade reçu, trade accepté, refusé /
  contré / expiré, erreur Roblox : chacun avec sa sonnerie, réglable dans la
  page de réglages avec un bouton ▶ pour l'écouter. Deux nouvelles sonneries :
  **Fanfare** (arpège ascendant, par défaut pour un trade accepté) et
  **Descendant** ;
- **« Ton trade a été accepté »** : un trade que tu as envoyé et qui aboutit
  est annoncé comme tel (et joue la fanfare), au lieu d'un neutre « trade
  complété ». Le point de vue de la notification suit : *tu as reçu / tu as
  donné* ;
- le son part **en parallèle** des notifications, plus après ;
- le diagnostic des réglages compte les trades écartés comme « antérieurs au
  suivi », pour repérer un jour un identifiant qui ne serait pas croissant.

Windows, lui, coupe les notifications tout seul en plein écran ou en jeu
(« Ne pas déranger » automatique) : le son de RoNote joue quand même, et la
page de réglages le rappelle.

## v2.8.0 : plus rien sur la page Roblox

L'overlay (bloc d'écart entre les listes, cotes sous les objets, verdicts sur
la liste, fiche au survol, évaluation de l'offre en composition) est
**retiré**, avec tout ce qui ne servait qu'à lui : `content/overlay.js`,
`overlay.css`, `lib.js`, `common/appraise.js`, les quatre messages du service
worker, les deux réglages, l'aperçu `preview-trade.html` et ses tests. Le
popup, les notifications, le portefeuille et le refus depuis le popup sont
inchangés. Ce qui reste sur roblox.com ne fait que LIRE : `hook.js` (capture
du détail du trade que la page reçoit) et `scrape.js` (lecture de la page en
repli quand l'API refuse un trade).

## v2.7.2 : la page ne rame plus

Chaque mutation de la page Roblox (et elle en fait en continu) relançait des
balayages quadratiques. Trois causes, trois corrections :

- **un seul balayage, par les nœuds texte.** Lire `textContent` sur chaque
  élément relisait chaque texte autant de fois qu'il a d'ancêtres. Un
  `TreeWalker` sur les nœuds texte lit chaque texte une fois ; tous les
  repérages (noms du catalogue, objets du trade, lignes `Total`, noms de la
  liste) passent par lui ;
- **plus de `innerText`** pour trouver le pseudo du partenaire : il force un
  calcul de mise en page de toute la page : remplacé par `textContent` ;
- **on n'écoute que `main`** : le tchat, les bandeaux et les menus bougent en
  permanence et n'ont rien à nous dire. La composition balaie le catalogue une
  fois au lieu d'une fois par niveau ; la mesure des vignettes est mémorisée
  le temps d'une passe.

Chaque passe est chronométrée : au-delà de 40 ms, la console l'écrit
(`[RoNote] peinture du trade : 62 ms`). C'est le premier chiffre à regarder
quand « c'est lent ».

## v2.7.1

- **`overlay.js` réécrit de zéro**, même contrat avec le service worker : un
  seul point d'entrée pour décorer un objet (`decorateItem`), idempotent :   il retire d'abord ce que RoNote avait posé dans le bloc, puis pose **une**
  ligne et **une** pastille. Fini les étiquettes *projected* empilées quand
  la page se redessinait. Toute écriture dans la page passe par `paused()`
  (observateur coupé), et chaque cycle a sa signature.
- La ligne de RAP de Roblox est aussi reconnue à son **icône Robux** quand le
  nombre ne colle pas (RAP qui a bougé entre Rolimon's et la page).

## v2.7.0

- **L'écart se calcule pendant qu'on compose un trade**, avant même de
  l'envoyer : les deux offres sont lues à l'écran, le bloc se pose au-dessus
  d'elles et se met à jour à chaque objet ajouté ou retiré. → *Pendant la
  composition*
- **Les inventaires ouverts pour composer** reçoivent la value et la pastille
  *projected* sous chaque objet, comme le trade affiché : et les pages
  `/trades/new`, `/users/{id}/trade` sont couvertes.
- **Plus jamais d'espace dans un nombre** : `1,836,950` partout, comme Roblox
  l'écrit lui-même. Le format français (espaces fines) ressortait avec des
  espaces tantôt larges, tantôt doubles selon la police.
- **La liste, sur la page comme dans le popup** : le pourcentage d'écart en
  badge, et un bouton **✕** pour refuser ou annuler en deux clics, sans ouvrir
  le trade.

## v2.6.0

- **Le bloc d'écart retrouve ses barres** (verdict à gauche, value et RAP à
  droite, zéro au milieu) : la version en cartouches de la 2.5.0 n'a pas
  convaincu. La mention « N visages » disparaît : elle n'apportait rien.
- **Le verdict sur chaque ligne de la liste des trades** : flèche, pourcentage,
  couleur : on sait quels trades valent d'être ouverts avant de les ouvrir.
  → *Sur la liste*
- **La value sous tout objet reconnu, où qu'il soit** : y compris dans les deux
  inventaires quand on compose un trade. → *Partout ailleurs : le catalogue*
- **Une fiche au survol** de chaque cote, à la place de l'infobulle brute :
  value en grand, RAP, ratio, demande, tendance, série, alertes. → *La fiche*
- **Des nombres plus propres** : un pourcentage au-delà de 100 perd sa
  décimale (`+3,482%` plutôt que `+3482.1%`).

## v2.5.0

- **Le bloc d'écart ressemble à celui de Roblox** : deux cartouches côte à
  côte, `▲ +33 RAP (+5%)` et `▲ +33 Value (+5%)`. Plus de barre, plus de
  verdict écrit : la flèche et la couleur disent tout. → *Le panneau sur la
  page Roblox*
- **Plus rien ne flotte.** Le panneau de repli en bas à droite et le rappel
  sur le bord de l'écran sont retirés : ils ressemblaient à des alertes.
  Quand le trade n'est pas identifié, la raison va dans la console, pas dans
  la page.
- **Le journal suit en direct.** Il est écrit avant le rafraîchissement du
  portefeuille (plusieurs secondes) et non après, et le popup écoute le
  stockage au lieu de relire toutes les 15 s : l'entrée apparaît en même temps
  que la notification. → *Le journal suit en direct*
- Le repérage des objets et des totaux dans la page se limite au contenu
  principal (`main`) : moins d'éléments balayés à chaque rendu.

## v2.4.3

- **Les deux totaux sont repris, pas juxtaposés.** Le nombre de Roblox est
  cloné dans un conteneur à nous, le nôtre à côté : l'espacement et
  l'alignement des deux cessent de dépendre d'une marge qu'on ne maîtrise pas.

## v2.4.2

- **L'alignement des deux lignes se fait par la MESURE**, plus par le calcul :
  la ligne est posée, on regarde où notre nombre est tombé par rapport à celui
  de Roblox, et on corrige l'écart. Quelle que soit la façon dont ils écrivent
  leur ligne, les deux nombres commencent au même x.
- **Le verdict passe en tête**, à gauche, avec la base sur laquelle il est pris.

## v2.4.1

- **Le total Rolimon's s'affiche même quand un objet n'est pas reconnu à
  l'écran** : un **visage**, dont le nom affiché ne ressemble pas à celui de
  l'API, privait tout son côté de total.
- **Le panneau ne disparaît plus** dans ce cas : il repart en flottant au lieu
  de rester bloqué par la garde anti-répétition.

## v2.4.0

- **Le gain ou la perte s'affiche entre les deux listes**, sur la page Roblox :
  value et RAP, nombre complet, pourcentage, et une **barre depuis le milieu**.
  Le `rbx-divider` de Roblox lui cède sa place. → *Le panneau sur la page Roblox*
- **Un rappel latéral** quand le bloc sort de l'écran : verdict et deux écarts,
  sur le bord droit, jamais en double.
- **Sous chaque objet, sa value**, accordée à la ligne de RAP de Roblox : même
  police, même taille : avec le **vrai logo Rolimon's** qui ouvre sa fiche.
- **Une pastille sur la vignette** : `!` projected, `?` sans cote, `↑` cote
  spéculative, `~` cote révisée. Aucun emoji, nulle part.
- **Rien à lire dans la page, et ça marche quand même.** La refonte de Roblox a
  supprimé les liens sur les objets : le trade est identifié par l'URL, par la
  réponse que la page reçoit ou par le pseudo (tronqué) du partenaire, puis
  évalué comme dans le popup : sans un appel réseau de plus.

## v2.2.0

- **Zoom sur un trade.** Un clic sur une carte l'ouvre en grand : chaque objet avec
  sa vignette en 44 px, sa série, sa value et son RAP. → *Le zoom*
- **Refuser / annuler un trade** depuis l'extension, en deux clics volontaires.
  → *Refuser ou annuler un trade*
- **Français / English**, au choix ou d'après le navigateur. → *Les langues*

## v2.1.0

- **Les trades contenant un visage s'affichent enfin.** L'API v2 range l'identifiant
  de l'objet dans `itemTarget`, pas à la racine : tous les objets d'un tel trade
  sortaient sans cote ni vignette. → *Trades contenant un bundle : API v2*
- **Les visages ont leur vraie image.** Un pont entre les deux catalogues Rolimon's
  retrouve l'ancien visage de chaque bundle, sans un seul appel réseau.
  → *Visages, bundles et UGC limiteds*
- **Ta valeur réelle, pas celle de Rolimon's.** Les visages échangés qu'ils comptent
  encore sont retirés, ceux que tu possèdes et qu'ils ignorent sont ajoutés, chaque
  ligne détaillée. → *Onglet Bénéfice*
- **Interface refondue** autour de la value, avec le détail objet par objet.
- **Robux comptés nets** des 30 % prélevés par Roblox.
- Build, vérifications et tests **sans Node**.

