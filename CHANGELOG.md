# Journal des versions

Toutes les versions notables de RoNote : ce qui change du point de vue de
l'utilisateur, pas la liste des commits.

## v2.11.1 — les limites de débit, et le refus qui ne partait pas

**Corrigé : le refus en deux clics depuis une carte pouvait ne jamais partir.**
L'état « armé » du bouton vivait dans la page seule : un rafraîchissement de
fond reconstruisait la liste et le remettait au repos sans prévenir, si bien
que le second clic ne faisait que le réarmer. Le trade restait là.

**Les trades suivis se voient enfin, et se retirent.** Le compteur annonçait
« 19 trades suivis » alors que l'onglet Envoyés n'en montrait aucun : ceux qui
ne sont plus dans les 100 derniers envois n'étaient affichés nulle part, donc
impossibles à désépingler. Ils ont maintenant leur bloc en bas de l'onglet, avec
le partenaire, depuis quand ils sont suivis, et de quoi les retirer — un par un
ou tous d'un coup. Un suivi posé automatiquement s'abandonne désormais au bout
d'une semaine, au lieu d'un mois comme une épingle posée à la main.

**Les courbes du portefeuille suivaient avec un train de retard.** Elle ne montrait que
les relevés de Rolimon's, qui ne rescanne un compte que quelques fois par jour :
le solde affiché avait bougé, la courbe non. Elle se termine maintenant sur le
dernier relevé de RoNote.

**La cause principale : les trades suivis.** La liste des trades envoyés
s'arrête à 100 entrées. Un trade suivi plus ancien que ces 100-là, mais toujours
ouvert, n'y figure plus — RoNote redemandait alors son détail à chaque
vérification, six par passage, indéfiniment. Avec une vingtaine de trades
suivis, cela suffisait à tenir la limite de débit de Roblox allumée en
permanence. Désormais un même trade suivi n'est plus redemandé avant dix
minutes, et son issue arrive le plus souvent sans aucun appel : les listes
Terminés et Inactifs la portent déjà, et retirent le suivi elles-mêmes — au
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
prolongeait toute seule, et c'est la vérification des trades — innocente — qui
récoltait l'erreur et allumait le point rouge.

- plus de reprise une par une sur une limite de débit ; hors limite, quatre à
  la fois au lieu de cent ;
- le délai demandé par Roblox (`Retry-After`) est respecté au lieu d'être
  plafonné à 5 s ;
- les 429 sur le détail d'un trade posent enfin une pause, au lieu d'enchaîner
  dix appels condamnés d'avance ;
- « vérifier maintenant » ne contourne plus la pause d'une limite de débit —
  le réflexe devant le point rouge la prolongeait ;
- les appels Rolimon's de la fiche joueur et du portefeuille ont eux aussi un
  réessai et un délai ;
- le message dit ce qui se passe et pour combien de temps, au lieu de
  « HTTP 429 ».

**Les listes ne clignotent plus pendant le chargement.** Elles étaient réécrites
en entier après chaque lot de six évaluations — jusqu'à cinq fois de suite pour
vingt-cinq trades, et autant de fois où toutes les vignettes étaient détruites
puis rechargées. Une carte prête remplace maintenant sa silhouette sur place.

**Le reste du rendu.** L'infobulle des courbes était mesurée après avoir été
écrite, à chaque image du survol ; la fiche d'un joueur recalculait deux fois la
même chronologie et se reconstruisait à chaque réponse reçue.

**Au clavier et au lecteur d'écran.** La barre d'onglets est un vrai `tablist` :
l'onglet actif est annoncé, les flèches gauche et droite le parcourent. Les
fiches et le zoom prennent le focus, le gardent tant qu'ils sont ouverts, et le
rendent en partant — le clavier restait derrière eux. L'attribut `lang` du
document suit la langue choisie.

**Réglages.** Quand le service worker ne répond pas, la page le dit au lieu de
rester figée ; une réponse vide n'écrase plus les réglages affichés.

---

## v2.11.0 — l'onglet Portefeuille refait

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
  cartes refaites — anneau de couleur autour de l'avatar selon le verdict, et
  l'écart toujours en grand sur fond vert ou rouge ;
- **le zoom sur un trade** monte du bas, verdict et écart en grand ;
- **le Journal** se lit comme un relevé : groupé par jour (Aujourd'hui, Hier…),
  une icône de couleur par type d'événement, l'heure, des filtres et le résumé des
  dernières 24 heures ; un clic ouvre le trade ;
- les cartes arrivent en cascade à l'ouverture d'un onglet, et une à une à mesure
  qu'elles sont évaluées — jamais au rafraîchissement de fond.

**Les onglets s'ouvrent plus vite.**

- un trade déjà vu n'est plus redemandé à Roblox toutes les 10 minutes : son
  contenu ne change jamais, il est gardé 7 jours et seule son analyse est refaite
  quand les cotes bougent — sans réseau ;
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
  son inventaire** — value, RAP et collectibles superposables, d'un mois à tout
  l'historique, comme pour ton portefeuille ;
- l'âge de son compte, **signalé s'il a moins de 30 jours**, et s'il est banni,
  vérifié ou vu en ligne récemment ;
- **entre vous** : les offres qu'il t'a envoyées et les tiennes, les trades conclus
  et leur bilan, et surtout **ce que ses offres te rapportent en moyenne** — un
  habitué des offres perdantes se repère d'un coup d'œil, et l'anneau de son avatar
  en prend la couleur ;
- **ses bundles** : ceux qu'il possède vraiment — y compris ceux que Rolimon's ne
  voit pas — et, dans un second onglet, **ceux qu'il n'a plus** mais que Rolimon's
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
  le plus tôt dans les 24 heures, les trades suivis — un clic y mène ;
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

## v2.10.0 — les alertes de trades reçus réparées, et l'alerte de réévaluation

**Corrigé : les trades reçus ne déclenchaient presque plus d'alerte.** Roblox
numérote ses trades sans ordre, alors que RoNote les croyait croissants : tout
nouveau trade dont le numéro était plus petit que le plus grand déjà vu était
écarté sans un mot. Les trades complétés, suivis autrement, alertaient toujours —
d'où une panne difficile à remarquer. RoNote se fie désormais aux trades déjà vus
et à leur date de création. Le suivi automatique des trades envoyés, touché par le
même défaut, est réparé du même coup.

**Nouveau : l'alerte de réévaluation.** Rolimon's révise ses cotes régulièrement,
parfois de plusieurs dizaines de pourcents d'un coup. RoNote te prévient désormais
quand la cote d'un objet de ton inventaire bouge d'au moins 10 % — seuil réglable,
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

## v2.9.2 — le nom de l'extension suit la langue du navigateur

Le Chrome Web Store tire le titre et le résumé **du paquet**, pas de la fiche :
une fiche en anglais affichait quand même « RoNote — Alertes de trades Roblox ».
Les deux manifestes passent donc par `_locales/`, avec l'anglais en langue de
repli.

- `src/_locales/en/messages.json` et `src/_locales/fr/messages.json` portent le
  nom, le résumé et l'infobulle du bouton ;
- les manifestes référencent `__MSG_appName__`, `__MSG_appDesc__` et
  `__MSG_actionTitle__`, avec `"default_locale": "en"`.

Un navigateur en français affiche le nom français, tous les autres l'anglais.
L'interface, elle, était déjà bilingue depuis la v2.4.

## v2.9.1 — le jeton CSRF n'est plus diffusé à la cantonade

Correctif d'hygiène, sans changement visible.

- `hook.js` transmettait le détail des trades et le jeton CSRF avec
  `postMessage(..., '*')` : le navigateur les livrait donc quelle que soit
  l'origine. Le message est désormais adressé à `location.origin`, et
  `relay.js` vérifie l'origine en plus de la fenêtre source.

Ça ne bouchait aucune fuite — n'importe quel script de la page peut déjà lire
ce jeton dans `meta[name="csrf-token"]`, et c'est d'ailleurs le repli qu'utilise
`relay.js`. Mais diffuser plus large que nécessaire n'a aucune raison d'être,
surtout dans une extension qui part en revue manuelle.

## v2.9.0 — le son ne se perd plus, et un son par événement

« Des fois je reçois la notification, des fois non. » Quatre causes trouvées,
quatre corrections :

- **le son manquait une fois sur deux.** Chrome ferme de lui-même le document
  audio (offscreen) après 30 s de silence ; RoNote croyait l'avoir encore et
  lui parlait dans le vide. Le service worker demande maintenant au
  navigateur, à chaque son, si le document existe encore — et le recrée sinon,
  avec deux tentatives puis un document neuf ;
- **un cycle de vérification pouvait rester bloqué pour de bon.** Aucun appel
  réseau n'avait de délai : une requête que Roblox ne terminait jamais gardait
  le verrou du cycle, et plus rien ne passait jusqu'au redémarrage du
  navigateur. Tous les appels ont un délai (20 s), et le verrou se périme au
  bout de 2 minutes ;
- **une étape qui échouait avalait ses trades.** Si la lecture d'une page
  réussissait puis que l'étape plantait, les trades tout juste découverts
  étaient déjà marqués « vus » — jamais notifiés. Le flux est remis dans son
  état d'avant, le passage suivant les reprend ;
- **le portrait du partenaire faisait échouer la notification riche.** Chrome
  n'accepte pas une URL du CDN Roblox comme icône ; la notification repartait
  en version dégradée après un délai. Le portrait est téléchargé et embarqué.

Et ce qui se voit :

- **un son par famille d'événement** — trade reçu, trade accepté, refusé /
  contré / expiré, erreur Roblox — chacun avec sa sonnerie, réglable dans la
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

## v2.8.0 — plus rien sur la page Roblox

L'overlay (bloc d'écart entre les listes, cotes sous les objets, verdicts sur
la liste, fiche au survol, évaluation de l'offre en composition) est
**retiré**, avec tout ce qui ne servait qu'à lui : `content/overlay.js`,
`overlay.css`, `lib.js`, `common/appraise.js`, les quatre messages du service
worker, les deux réglages, l'aperçu `preview-trade.html` et ses tests. Le
popup, les notifications, le portefeuille et le refus depuis le popup sont
inchangés. Ce qui reste sur roblox.com ne fait que LIRE : `hook.js` (capture
du détail du trade que la page reçoit) et `scrape.js` (lecture de la page en
repli quand l'API refuse un trade).

## v2.7.2 — la page ne rame plus

Chaque mutation de la page Roblox (et elle en fait en continu) relançait des
balayages quadratiques. Trois causes, trois corrections :

- **un seul balayage, par les nœuds texte.** Lire `textContent` sur chaque
  élément relisait chaque texte autant de fois qu'il a d'ancêtres. Un
  `TreeWalker` sur les nœuds texte lit chaque texte une fois ; tous les
  repérages (noms du catalogue, objets du trade, lignes `Total`, noms de la
  liste) passent par lui ;
- **plus de `innerText`** pour trouver le pseudo du partenaire : il force un
  calcul de mise en page de toute la page — remplacé par `textContent` ;
- **on n'écoute que `main`** : le tchat, les bandeaux et les menus bougent en
  permanence et n'ont rien à nous dire. La composition balaie le catalogue une
  fois au lieu d'une fois par niveau ; la mesure des vignettes est mémorisée
  le temps d'une passe.

Chaque passe est chronométrée : au-delà de 40 ms, la console l'écrit
(`[RoNote] peinture du trade : 62 ms`). C'est le premier chiffre à regarder
quand « c'est lent ».

## v2.7.1

- **`overlay.js` réécrit de zéro**, même contrat avec le service worker : un
  seul point d'entrée pour décorer un objet (`decorateItem`), idempotent —
  il retire d'abord ce que RoNote avait posé dans le bloc, puis pose **une**
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
  *projected* sous chaque objet, comme le trade affiché — et les pages
  `/trades/new`, `/users/{id}/trade` sont couvertes.
- **Plus jamais d'espace dans un nombre** : `1,836,950` partout, comme Roblox
  l'écrit lui-même. Le format français (espaces fines) ressortait avec des
  espaces tantôt larges, tantôt doubles selon la police.
- **La liste, sur la page comme dans le popup** : le pourcentage d'écart en
  badge, et un bouton **✕** pour refuser ou annuler en deux clics, sans ouvrir
  le trade.

## v2.6.0

- **Le bloc d'écart retrouve ses barres** (verdict à gauche, value et RAP à
  droite, zéro au milieu) — la version en cartouches de la 2.5.0 n'a pas
  convaincu. La mention « N visages » disparaît : elle n'apportait rien.
- **Le verdict sur chaque ligne de la liste des trades** : flèche, pourcentage,
  couleur — on sait quels trades valent d'être ouverts avant de les ouvrir.
  → *Sur la liste*
- **La value sous tout objet reconnu, où qu'il soit** — y compris dans les deux
  inventaires quand on compose un trade. → *Partout ailleurs : le catalogue*
- **Une fiche au survol** de chaque cote, à la place de l'infobulle brute :
  value en grand, RAP, ratio, demande, tendance, série, alertes. → *La fiche*
- **Des nombres plus propres** : un pourcentage au-delà de 100 perd sa
  décimale (`+3,482%` plutôt que `+3482.1%`).

## v2.5.0

- **Le bloc d'écart ressemble à celui de Roblox** : deux cartouches côte à
  côte, `▲ +33 RAP (+5%)` et `▲ +33 Value (+5%)`. Plus de barre, plus de
  verdict écrit — la flèche et la couleur disent tout. → *Le panneau sur la
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
  l'écran** — un **visage**, dont le nom affiché ne ressemble pas à celui de
  l'API, privait tout son côté de total.
- **Le panneau ne disparaît plus** dans ce cas : il repart en flottant au lieu
  de rester bloqué par la garde anti-répétition.

## v2.4.0

- **Le gain ou la perte s'affiche entre les deux listes**, sur la page Roblox :
  value et RAP, nombre complet, pourcentage, et une **barre depuis le milieu**.
  Le `rbx-divider` de Roblox lui cède sa place. → *Le panneau sur la page Roblox*
- **Un rappel latéral** quand le bloc sort de l'écran : verdict et deux écarts,
  sur le bord droit, jamais en double.
- **Sous chaque objet, sa value**, accordée à la ligne de RAP de Roblox — même
  police, même taille — avec le **vrai logo Rolimon's** qui ouvre sa fiche.
- **Une pastille sur la vignette** : `!` projected, `?` sans cote, `↑` cote
  spéculative, `~` cote révisée. Aucun emoji, nulle part.
- **Rien à lire dans la page, et ça marche quand même.** La refonte de Roblox a
  supprimé les liens sur les objets : le trade est identifié par l'URL, par la
  réponse que la page reçoit ou par le pseudo (tronqué) du partenaire, puis
  évalué comme dans le popup — sans un appel réseau de plus.

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

