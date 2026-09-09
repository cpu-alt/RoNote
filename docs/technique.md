# RoNote — notes techniques

Pourquoi le code est écrit comme il est. Ces pages formaient la plus grande partie
du README ; elles sont ici pour rester lisibles sans noyer la page d'accueil du
dépôt.

Retour au [README](../README.md) · [Journal des versions](../CHANGELOG.md)

---

## Pourquoi il n'y a plus de fausses notifications

Le bug classique (« je refuse un trade, celui du dessous renotifie ») vient toujours
de la même erreur : comparer la **première ligne** de la liste, le **pseudo** de
l'expéditeur, ou le **nombre** de trades. Dès que la liste bouge, ces trois repères
mentent.

RoNote utilise l'API officielle `trades.roblox.com` et raisonne uniquement sur
`trade.id`, un entier **unique**, **immuable** et **strictement croissant** :

| Mécanisme | Rôle |
|---|---|
| `seen` | Ensemble borné (2000/flux) des ids déjà traités → un trade ne peut jamais alerter deux fois. |
| `watermark` | Plus grand id jamais observé → protège même si le cache est purgé, et évite le flot d'alertes au premier lancement. |
| `seededAt` | Photo initiale silencieuse de l'existant. |

Conséquences concrètes :

- Tu refuses un trade → celui du dessous a un id **déjà connu** → silence.
- Le même joueur t'envoie **2 trades** → 2 ids différents → **2 alertes**.
- Un vieux trade se finalise **après** un plus récent → détecté quand même
  (les flux `Completed` / `Inactive` se fient à `seen`, pas au watermark, justement
  parce que les fins de trade n'arrivent pas dans l'ordre des ids).

---

## Trades refusés par l'API : on lit la page

Certains trades contenant un **bundle** (visage DynamicHead, UGC limited) sont
refusés par l'API — `403` sur le détail, alors que la liste passe et que la page
Roblox les affiche parfaitement.

Puisque la page les affiche, l'information est dans le DOM. Le script
`content/scrape.js` lit donc le trade affiché et en extrait les **identifiants**
des objets depuis leurs liens (`/catalog/{assetId}`, `/bundles/{bundleId}`) — pas
leurs noms : deux objets peuvent porter des noms quasi identiques pour des cotes
très différentes (`Gucci … (1.0)` vaut 5 787, `(3.0)` vaut 3 113). Les cotes
viennent ensuite de Rolimon's, exactement comme pour les autres trades.

Le découpage en deux colonnes ne dépend ni de la langue ni des classes CSS. Il
s'appuie d'abord sur le **propriétaire** : une offre cite toujours son joueur,
donc chaque objet est rattaché au plus proche ancêtre qui cite un profil. Si la
page ne cite aucun profil, on retombe sur la seule **structure** — le plus haut
ancêtre qui ne contient pas tous les liens — mais uniquement si aucune des deux
colonnes obtenues ne cite deux propriétaires : ce cas-là, c'est le trade entier
pris pour une colonne et un inventaire pris pour l'autre. Si le découpage ne
donne pas exactement deux colonnes, la lecture s'abstient plutôt que de deviner.

Cette lecture est dans `content/tradedom.js`, partagée avec le panneau injecté
dans la page (voir *Le panneau sur la page Roblox*) : deux lecteurs qui
divergeraient, ce sont deux totaux qui divergent.

Ordre des replis, du plus fidèle au plus approximatif :
1. l'API (`v1` puis `v2`, avec jeton CSRF et relais par onglet) ;
2. la réponse réseau captée sur la page (`content/hook.js`) ;
3. le trade lu à l'écran (`content/scrape.js`), retrouvé par identifiant ou par
   `@pseudo` du partenaire.

---

## Trades refusés par l'API : interception réseau

Certains trades contenant un **bundle** (visage DynamicHead, UGC limited) sont
refusés par l'API — `403` sur le détail, alors que la liste passe et que la page
Roblox, elle, les affiche parfaitement.

Plutôt que de continuer à deviner l'endpoint et les en-têtes exacts du site,
RoNote **écoute les réponses de la page**. Un script de contenu (`content/hook.js`,
monde MAIN) observe les réponses de détail de trade que la page récupère
elle-même, et les transmet au service worker, qui les conserve (60 derniers).
Quand l'API refuse un trade, ce détail-là prend le relais.

C'est la source la plus fiable possible : c'est exactement ce que l'utilisateur
voit à l'écran. Le script n'intercepte **que** les réponses de détail de trade et
ne modifie rien.

Le même script récupère au passage le **jeton CSRF** de la page (balise `meta`
ou en-tête des requêtes qu'elle émet), ajouté ensuite à nos appels — Roblox
rejette certains GET sans jeton. Un jeton renvoyé par Roblox dans l'en-tête
`x-csrf-token` est capté et rejoué une fois.

Conséquence pratique : **ouvre le trade une fois sur roblox.com** et RoNote saura
l'évaluer, définitivement.

---

## En-têtes : requêtes indistinguables du site

Un `403` sur un `GET` authentifié, alors que la liste passe, pointe vers les
en-têtes : le service worker envoie un `Origin: chrome-extension://…` et pas de
`Referer`, ce que Roblox refuse sur certains endpoints.

RoNote réécrit donc `Origin` et `Referer` en `https://www.roblox.com` sur les
requêtes **émises par l'extension uniquement** (`tabIds: [-1]` = requêtes hors
onglet). Aucun onglet ouvert n'est nécessaire, et la permission
`declarativeNetRequestWithHostAccess` n'ajoute aucun avertissement : elle réutilise
les permissions de site déjà accordées.

> **Attention** : `tabIds` n'est accepté que pour les règles **de session**. Placée
> dans un `rules.json` statique, elle rend le manifeste entier incharcheable
> (« Rule with id 1 specifies a value for "tabIds" … only supported for
> session-scoped rules »). La règle est donc posée à l'exécution via
> `declarativeNetRequest.updateSessionRules()`, et reposée à chaque démarrage du
> service worker puisque les règles de session ne survivent pas au redémarrage du
> navigateur. `npm run check` refuse désormais cette clé dans un ruleset statique.

## Diagnostic d'un trade

Réglages → **Diagnostic d'un trade** : colle le numéro d'un trade, RoNote teste
v1 et v2, en direct et via un onglet Roblox, et affiche les statuts, la structure
reçue et le nombre d'objets reconnus. Un bouton **Copier** met le rapport dans le
presse-papier.

C'est la sortie de secours quand un trade refuse de s'évaluer : le rapport dit
exactement quelle étape échoue, sans avoir à deviner.

---

## Trades contenant un bundle : API v2

**C'est le bug qui faisait disparaître les aperçus.** Corrigé en v2.1.0.

`GET /v1/trades/{id}` répond **403** sur les trades qui contiennent un bundle
(visage DynamicHead, UGC limited) : `UserAssetResponse`, son seul type d'objet, ne
sait pas décrire un bundle. La liste, elle, passe — d'où des trades bien listés
mais impossibles à évaluer. Roblox expose une **v2** pour ces trades.

Les deux schémas (relevés sur la documentation officielle,
`trades.roblox.com/docs/json/v1` et `/v2`) :

```
v1  { id, user, created, expiration, status,
      offers: [ { user, robux, userAssets: [ { id, assetId, name,
                                               recentAveragePrice, serialNumber } ] } ] }

v2  { tradeId, status,
      participantAOffer / participantBOffer :
        { user, robux, items: [ { collectibleItemInstanceId,
                                  itemTarget: { itemType: "Asset"|"Bundle"|"Unknown",
                                                targetId: "160001924154932" },
                                  itemName, serialNumber,
                                  recentAveragePrice, assetStock, isOnHold } ] } }
```

Trois différences qui cassent tout si on les rate :

1. **L'identifiant de l'objet n'est pas à la racine.** Il est dans
   `itemTarget.targetId`, et son type est annoncé dans `itemTarget.itemType`.
   L'ancien normaliseur cherchait `assetId` / `bundleId` / `id` à la racine :
   aucun n'existe en v2, donc **tous** les objets du trade ressortaient avec un
   identifiant nul — pas de cote, pas de vignette, pour le trade **entier**. C'est
   exactement le symptôme « un visage dans le trade → plus aucun aperçu ».
2. **`id` en v1 est le `userAssetId`**, l'identifiant de l'exemplaire, jamais celui
   de l'objet. Le prendre comme repli produisait des vignettes cassées et des cotes
   fantaisistes. Il n'est plus jamais utilisé comme identifiant d'objet.
3. **La v2 ne renvoie ni date ni expiration.** RoNote les reprend de la liste des
   trades, déjà chargée, et les injecte dans le détail (`getTrade(id, hint)`).

`normalizeTradeDetail` ramène les deux formats à une structure unique et accepte
les variantes de nommage (`userAssets`/`items`, `user.id`/`user.userId`,
`robux`/`robuxAmount`, `id`/`tradeId`). On bascule sur v2 non seulement quand v1
échoue, mais aussi quand v1 répond avec **un trade vide** : un trade sans le moindre
objet ni Robux n'existe pas, c'est le signe que v1 a laissé tomber ce qu'il ne sait
pas décrire.

Si le format reçu n'est toujours pas reconnu, la carte affiche **les clés
réellement reçues** (`format inattendu — racine […] · … · objet […]`) au lieu d'une
carte vide : le normaliseur se corrige alors sans deviner.

---

## Diagnostic d'un trade non évalué

Quand le détail d'un trade ne peut pas être lu, la carte affiche la raison **en
clair** (pas dans une infobulle) et propose un bouton **Réessayer**. Le message est
étiqueté par étape — `détail du trade: HTTP 400`, `analyse: …` — pour savoir
immédiatement où ça casse.

Trois protections entourent cet appel :

- retry automatique sur `429` en respectant le `Retry-After` ;
- **relais par onglet** sur *n'importe quelle* erreur : la requête est rejouée
  depuis un onglet `roblox.com` ouvert, où elle est first-party et passe là où
  celle du service worker échoue ;
- vignettes et avatar rendus non bloquants : ils ne peuvent plus faire perdre une
  carte.

---

## Un trade ne disparaît jamais de la liste

Si le détail d'un trade ne peut pas être récupéré (429 Roblox, objet illisible,
trade modifié pendant la lecture), la carte est affichée en **mode dégradé** —
partenaire, date, lien vers le trade, et la raison de l'échec — au lieu d'être
silencieusement omise. C'est un correctif de fond : auparavant un `catch` vide
faisait disparaître la ligne, et un trade absent est bien pire qu'un trade mal
évalué.

Le popup remonte aussi **25 trades** par onglet (au lieu de 12), chargés par lots
de 6 avec réaffichage entre chaque lot : la liste se remplit progressivement.
Les requêtes Roblox retentent une fois automatiquement sur un `429`.

---

## Visages, bundles et UGC limiteds

Roblox a converti les visages limités en **bundles** (`bundleType: DynamicHead`).
Un joueur qui possède *The Dog Whisperer* ne possède plus l'asset `34764447` : il
possède le bundle `160001924154932`, qui contient trois assets aux identifiants
inédits. L'ancien monde et le nouveau ne partagent aucun identifiant.

### Le pont, sans un seul appel réseau

Rolimon's publie deux catalogues, et l'écart entre les deux est précisément le pont
qu'il faut :

| | `assets` | `bundles` | ce qu'il contient |
|---|---:|---:|---|
| `items/v3/itemdetails` | 2 377 | 160 | la source moderne — **la seule qui cote les bundles** |
| `items/v1/itemdetails` | 2 486 | — | l'ancien monde — cote encore les visages sous leur **ancien** id |

Les **158 assets présents en v1 et absents de v3** sont, par construction, les
visages migrés. Et le bundle a gardé le nom de l'ancien visage, à la cote près :

```
v3.bundles[160001924154932] = ["The Dog Whisperer", "DW", 64766, 55000, …]
v1.items  [34764447]        = ["The Dog Whisperer", "DW", 64766, 55000, …]
```

RoNote rapproche donc les deux **par le nom**, en ne cherchant que parmi ces 158
assets : **158 bundles sur 160 trouvent leur ancien visage, zéro ambiguïté** (les
deux restants — *The Jade Catseye*, *Signature Kicks* — n'ont jamais été des
visages). Restreindre la recherche est ce qui évite le piège classique : *Zip It!*
existe en visage (`24126147`) **et** en chapeau (`100931472`) ; comme le chapeau est
toujours coté en v3, il ne peut pas être choisi par erreur.

Ce pont est calculé une fois par rafraîchissement du catalogue (3 h), en mémoire,
sans aucun appel supplémentaire. Il sert à trois endroits :

- **la cote** d'un visage dans un trade ;
- **la vignette** : l'image plate de l'ancien visage passe devant le rendu de tête
  du bundle — c'est celle que tout le monde reconnaît, et celle qu'affiche
  Rolimon's ;
- **le portefeuille** (voir *Onglet Bénéfice*).

### Résolution d'un objet, dans l'ordre

1. l'API annonce un **bundle** → fiche `bundles`, plus l'ancien visage s'il existe ;
2. l'API annonce un **asset coté** → fiche `assets` (et si c'est un visage migré,
   on bascule sur son bundle) ;
3. l'identifiant est en fait un bundle (cas `itemType: "Unknown"`) → on essaie la
   table des bundles avec le même identifiant ;
4. l'asset n'est que le **contenu** d'un bundle → `catalog.roblox.com/v1/assets/{id}/bundles`
   donne le bundle. Résultat mis en cache 30 jours (un asset ne change jamais de
   bundle), les absences comprises ;
5. toujours rien → RAP officiel via `economy/resale-data`, sinon `❔ sans cote`.

Les objets passés par le pont portent le repère `🎭 visage`.

### La value prime

Exemple réel (trade #4166703397429939) :

| | RAP | Value |
|---|---:|---:|
| Donné — *Gucci Saint Francis Cloak* | 5 787 | 5 787 |
| Reçu — *Lord of the Buxeration* | 4 947 | **6 000** |

Au RAP c'est **−14,5 %** (une perte) ; à la value c'est **+213 (+3,7 %)**, un gain.
La base par défaut est la **value**, donc le verdict affiché est *Gain*. Le désaccord
avec le RAP n'est pas masqué pour autant : il apparaît en clair
(`⚖️ Value +3,7 % vs RAP −14,5 %`) et le trade n'est jamais supprimé par un filtre
dans ce cas.

Toute l'interface est construite autour de ce choix : la value est le seul chiffre
en grand et en couleur, le RAP est juste dessous, en gris, toujours visible.

---

## Lecture des cotes Rolimon's

Format d'une entrée — **et les deux versions n'ont pas le même nombre de colonnes** :

```
v1 (10) [nom, acronyme, rap, value, defaultValue, demand, trend, projected, hyped, rare]
v3  (9) [nom, acronyme, rap, value, defaultValue, demand, trend, projected,        rare]
```

v3 a laissé tomber `hyped`. `rare` est donc en position 9 chez v1 et 8 chez v3 : on
lit la **dernière** colonne, ce qui vaut pour les deux. Lire l'indice 9 en dur ferait
passer tous les objets rares pour des objets banals.

Une value à `-1` signifie « non cotée » et retombe sur le RAP — c'est le cas de la
majorité des objets. L'interface le dit (`Value 20 500 (RAP faute de cote)`), parce
que sur un objet **projected** le RAP est justement le chiffre qui a été gonflé.

> **Bug historique, corrigé en v1.2.1 — la table de valeurs était vide depuis le
> début.** Le code lisait `json.item_details` alors que l'API expose les objets sous
> `json.items` : chaque objet était évalué à son RAP, jamais à sa value.
>
> Trois garde-fous depuis : le parsing est une fonction pure (`parseItems`)
> **testée sur des réponses réelles de l'API** (`tools/fixtures/`) ; une table vide
> est traitée comme une **panne** et non comme un résultat ; et le nombre de cotes
> chargées est affiché en permanence dans la barre d'état du popup, donc une table
> morte se voit immédiatement.

---

## Onglet Bénéfice

### La valeur que Rolimon's affiche est fausse, dans les deux sens

C'est la conséquence la moins connue du passage des visages en bundles, et
personne ne la corrige :

| | ce qui se passe | effet sur ta valeur |
|---|---|---|
| **Visage échangé** | l'ancien exemplaire reste dans l'inventaire Roblox ; Rolimon's continue de le compter | **compté en trop** |
| **Visage reçu** | il arrive en bundle ; ni les collectibles ni Rolimon's ne le voient | **manquant** |

Le juge de paix est le même dans les deux cas : `catalog.roblox.com/v1/users/{id}/bundles`.
C'est le **bundle** qui est réellement échangé, donc c'est lui qui dit ce que tu
possèdes. RoNote ne compare pas les inventaires en vrac — il compare, **visage par
visage**, ce que Rolimon's compte (`players/v1/playerassets`) et les bundles cotés
que tu possèdes :

```
valeur corrigée  =  valeur Rolimon's  −  fantômes  +  visages absents
```

Mesuré sur un compte réel :

```
Rolimon's annonce                                 1 836 950
  − Golden Bling Braces  (compté, plus possédé)      −6 762
  − Blue Wistful Wink    (compté, plus possédé)      −4 500
  − Gritty Bombo         (compté, plus possédé)      −3 349
  + The Dog Whisperer    (possédé, non compté)      +55 000
  + Purple Super Happy Joy                          +19 973
  + Fawkes Face                                     +18 687
  + Snowman Face                                    +13 601
  + Blue Goof                                        +1 940
                                                 ──────────
valeur réelle                                     1 931 540   (+94 590)
```

**Pourquoi partir de la valeur de Rolimon's plutôt que tout recalculer ?** Parce
qu'additionner soi-même sous-compte : Rolimon's valorise en interne des UGC limiteds
qu'il ne publie pas dans son catalogue public. On garde donc leur total comme base
et on ne corrige que ce qu'on sait démontrer, ligne par ligne.

Le panneau **Réconciliation des visages** affiche chaque ligne avec sa vignette, son
nom et son montant, en cliquant dessus pour ouvrir l'objet : un chiffre corrigé sans
le détail de la correction ne serait pas vérifiable. Désactivable par « Corriger les
visages passés en bundles » dans les réglages.

### Les indicateurs

| | |
|---|---|
| **Value réelle** | valeur corrigée + variation sur la période, avec l'écart vis-à-vis de Rolimon's |
| **RAP** | RAP total corrigé + variation |
| **Rang** | classement Rolimon's |
| **Objets** | nombre de collectibles, + les visages possédés |

Plages identiques au site : **1s · 1m · 3m · 6m · 1a · Tout**. Courbe Value (bleu,
en aire) et RAP (vert).

La **courbe** reste celle que Rolimon's publie, telle quelle : appliquer la
correction d'aujourd'hui à des points d'il y a six mois serait une invention. Le
chiffre du haut, lui, est celui de maintenant, corrigé — et l'écart entre les deux
est écrit noir sur blanc juste en dessous.

### D'où vient l'historique

Rolimon's ne publie pas de série temporelle par API — `/players/v1/playerchart`
n'existe pas. En revanche, **la page du profil l'embarque** dans une variable
`chart_data` :

```
chart_data = { num_points: 799,
  nominal_scan_time: [...], value: [...], rap: [...], num_limiteds: [...] }
```

RoNote lit donc cette variable dans la page (cache 30 min) : c'est exactement la
donnée du graphique du site, sur toute son ancienneté, disponible dès la première
vérification — sans rien reconstruire.

Trois cadences distinctes, parce que les trois sources ne bougent pas au même
rythme : réconciliation **10 min**, historique **30 min**, catalogue **3 h**.
Reconstruire tout ça à chaque vérification (toutes les 30 s) serait une attaque en
règle sur les API de Rolimon's depuis ton IP. Le bouton **Recalculer maintenant**
force le tout.

---

## Les Robux d'un trade sont taxés

Roblox prélève **30 %** sur les Robux reçus dans un trade. Compter le montant brut
surévalue mécaniquement ce qu'on te propose : 5 000 R$ affichés, 3 500 R$ encaissés.

RoNote compte donc les Robux **reçus** au net et les Robux **donnés** au brut, signale
la ponction (`💸 −1 500 R$ de taxe`) et affiche le net à côté du montant. Décochable
par « Compter les Robux nets de taxe ».

---

## Se passer de Rolimon's

L'extension fonctionne **entièrement sans Rolimon's** : décoche « Utiliser les cotes
Rolimon's » dans les réglages et tout bascule sur le RAP, la donnée officielle de
Roblox. Dans ce mode, l'interface n'affiche plus qu'une seule colonne `RAP` (pas
deux fois le même chiffre), le sélecteur de base est grisé, et les repères qui
dépendent des cotes communautaires (spéculative, révisée, contradiction)
disparaissent. Les filtres, le suivi, les notifications et la détection des
contre-offres sont inchangés.

Ce que tu perds, sur de vraies cotes :

| Objet | RAP seul | avec value | écart |
|---|---:|---:|---:|
| `): Red Grind` (visage) | 723 674 | 4 000 000 | **+3 276 326** |
| `Pieface Jellyfreckles` (visage) | 170 494 | 125 000 | −45 494 |
| `The Classic ROBLOX Fedora` | 372 080 | 400 000 | +27 920 |

C'est exactement le problème des visages : sans les cotes, ils sont évalués à leur
RAP, très loin de ce à quoi ils s'échangent. D'où le réglage par défaut :
cotes activées, base « Value Rolimon's », avec les garde-fous décrits plus bas.

---

## La value n'est pas une vérité pour autant

La « value » n'est pas une donnée Roblox : c'est une cote **fixée par une
organisation communautaire**, révisée régulièrement, parfois de plusieurs dizaines
de pourcents d'un coup. Le RAP, lui, vient de Roblox — mais ne reflète que
l'historique des ventes. Aucun des deux ne suffit seul.

RoNote ne choisit donc pas « la » valeur :

**1. Trois bases, toujours calculées.** Value Rolimon's (le réglage par défaut,
parce que c'est le chiffre sur lequel se fait un trade), RAP Roblox, et une base
**prudente** (le plus bas des deux pour chaque objet). Tu choisis celle qui sert de
référence, mais **les deux chiffres restent affichés** sur chaque carte :

```
VOUS DONNEZ              VOUS RECEVEZ
45 000                   60 000
RAP 60k                  RAP 40k

  VALUE  +15 000  +33.3%          RAP −20k (−33.3%)
```

**2. Les contradictions sont signalées, pas arbitrées.** Quand la value dit
« gagnant » et le RAP dit « perdant » (ou l'inverse), la carte porte
`⚖️ Value +33.3 % vs RAP −33.3 %`. Le verdict reste celui de la base choisie —
masquer un gain réel derrière un « incertain » serait plus trompeur que l'inverse —
mais le désaccord est écrit à côté, et un tel trade n'est jamais supprimé par un
filtre.

**3. Les cotes gonflées sont marquées.** Un objet dont la value dépasse un
multiple de son RAP (1,6× par défaut, réglable) est signalé `📈 cote spéculative
(2.6× le RAP)` : sa cote repose sur l'avis de la communauté plus que sur des
ventes réelles.

**4. Les révisions de cote sont suivies.** RoNote compare chaque rafraîchissement
de la table Rolimon's au précédent et garde 7 jours d'historique. Un objet dont la
cote vient de bouger est marqué `🔁 cote révisée : Nom +41.9%`, avec l'ancienne
et la nouvelle valeur en infobulle.

**5. Une table périmée est annoncée.** Si l'API Rolimon's est injoignable, l'ancien
cache continue de servir mais l'affichage porte `⏳ cotes non actualisées` — et
au-delà de 24 h, les filtres cessent de s'appuyer dessus.

**6. Un filtre ne supprime jamais une alerte sur un chiffre contesté.** Trade
incomplet, contradiction value/RAP, cotes trop vieilles : la notification passe,
avec la raison tracée dans le journal. Seul le blocage explicite d'un joueur
continue de s'appliquer dans tous les cas.

---

## Objets sans cote (visages, objets de bundle, nouveautés)

Rolimon's ne couvre pas tout le catalogue échangeable : depuis les changements
Roblox sur les visages et les objets liés à des bundles, certains objets n'y
figurent pas, et la réponse de l'API des trades ne porte parfois **aucun RAP**
pour eux.

Le piège : compter ces objets **0**. Un trade où l'autre te propose un visage
passait alors pour une perte de 100 %, avec deux conséquences — un verdict faux,
et surtout une **notification supprimée** si le filtre « ne notifier que les
trades gagnants » était actif.

RoNote traite ça en trois temps :

1. **Repêchage** — pour tout objet sans RAP et absent de Rolimon's, le RAP officiel
   est récupéré sur l'API `economy` de Roblox (`resale-data`), puis mis en cache
   12 h. Les échecs sont mis en cache aussi, pour ne pas rappeler l'API en boucle.
2. **Aucune valeur inventée** — si l'objet reste sans cote, il est marqué
   `inconnu` et **exclu des totaux** au lieu d'y entrer pour 0. La carte affiche
   `+1 sans cote`, le verdict devient `❔ Objet sans cote`, et l'écart est
   annoncé comme non calculable plutôt que faux.
3. **Les filtres ne peuvent plus supprimer une alerte sur un total amputé** — un
   trade incomplet est toujours notifié (voir `src/common/filters.js`). Seul le
   blocage explicite d'un joueur continue de s'appliquer.

### Les vignettes ne mentent plus

Deux pièges corrigés en v2.1.0 :

- **Un identifiant inconnu ne provoque pas d'erreur HTTP.** Roblox répond `200`
  avec `state: "Error"` et l'URL d'un carré cassé — qui s'affiche comme une vignette
  normale si on ne la filtre pas. RoNote n'accepte que `state: "Completed"` et rejette
  les URL `/BrokenImage/`.
- **L'URL de vignette historique (`www.roblox.com/asset-thumbnail/image`) est morte**
  (404). Elle servait de dernier repli : chaque objet non résolu produisait donc une
  image cassée. Elle a été retirée au profit d'un emplacement neutre — 🎭 pour un
  visage, ❔ pour un objet sans cote.

Le reste de la chaîne : lots de **100** pour les assets, **30** pour les bundles
(au-delà, Roblox refuse le lot **entier**) ; un lot refusé est **rejoué objet par
objet** plutôt que de laisser tout un trade sans image ; chaque objet fournit une
**liste ordonnée** de candidats (ancien visage → bundle → asset) et on rend la
première image réellement rendue ; le tout mis en cache 7 jours, échecs compris
(6 h), écrit une seule fois par cycle.

---

## Le zoom

Le popup fait 420 × 600 : une carte de liste doit rester compacte, donc les objets
y sont des vignettes de 34 px. Ça suffit pour trancher d'un coup d'œil, pas pour
examiner une offre.

Un clic sur une carte ouvre donc le trade **en grand**, par-dessus la liste :

| | |
|---|---|
| **En-tête** | partenaire, numéro, âge, verdict |
| **Barre de value** | l'écart en 21 px, le RAP en gris à côté |
| **Expiration** | ⏳ le temps qu'il reste, quand le trade est encore ouvert |
| **Chaque côté** | son total, puis **une ligne par objet** — vignette 44 px, nom, série, marqueurs (visage, projected, rare, demande), value et RAP |
| **Pastilles** | les mêmes repères que sur la carte |
| **Pied** | ouvrir sur Roblox, refuser / annuler |

Chaque ligne d'objet est un lien vers sa page Roblox (`/catalog/` ou `/bundles/`
selon le cas). `Échap`, un clic hors du panneau ou la croix referment. Tant que le
zoom est ouvert, **le rafraîchissement de fond ne redessine plus la liste** : rien
ne bouge sous les doigts.

---

## Refuser ou annuler un trade

Roblox n'expose pas de « cancel » : `POST /v1/trades/{id}/decline` sert dans les
**deux sens** — refuser un trade reçu, ou annuler un trade qu'on a envoyé. C'est le
même appel que fait le site. Seul le libellé change dans le zoom.

C'est la première écriture que RoNote fait sur un compte Roblox, et elle est
définitive. Trois garde-fous :

1. **Deux clics volontaires.** Le premier arme le bouton (il devient rouge et
   change de texte), le second envoie. Sans second clic dans les 5 secondes, le
   bouton se désarme tout seul.
2. **Uniquement depuis le zoom**, jamais depuis la liste : aucun bouton destructeur
   à côté d'une zone qu'on parcourt au clic.
3. **Uniquement sur un trade encore ouvert**, et jamais sur un trade dont
   l'évaluation a échoué — on ne détruit pas ce qu'on n'a pas pu afficher.

Côté réseau, l'appel suit le protocole CSRF de Roblox : le premier envoi est refusé
avec un jeton frais dans l'en-tête, on rejoue avec. Si le service worker n'a ni le
cookie ni le bon `Origin`, la requête est **rejouée depuis un onglet roblox.com**
ouvert, où elle est indistinguable de celle du site. Le message d'erreur de Roblox
(« Trade is not active »…) est affiché tel quel plutôt que remplacé par un code HTTP.

Après coup, le service worker fait le ménage : le trade sort des listes, le compteur
baisse, il est marqué « déjà vu » sur les flux `Completed` et `Inactive` — sinon
RoNote s'alerterait lui-même de sa propre annulation — et une ligne part au journal.

**Accepter et contrer restent hors de portée**, et c'est délibéré : refuser détruit
une offre, accepter **transfère des objets**. Un clic malheureux n'a pas la même
conséquence dans les deux cas.

---

## Les langues

Français et anglais, réglables dans **Réglages → Général → Langue** :
`Automatique` (suit le navigateur), `Français`, `English`. Le choix s'applique au
popup, aux réglages **et aux notifications système**.

Le français est la langue **source**. Le dictionnaire traduit depuis la phrase
française, pas depuis une clé abstraite :

```js
t('Vous donnez')                     // "You give"
t('Détail des {n} objets', {n: 5})   // "5 items in detail"
```

Pourquoi pas des clés (`card.youGive`) : une clé absente du dictionnaire s'affiche
telle quelle, donc un texte cassé. Ici, une phrase non traduite **retombe sur le
français** — dégradé, jamais illisible. Et le code se lit sans aller-retour avec le
dictionnaire.

Les pages écrites en dur (`popup.html`, `options.html`) n'ont **aucune balise à
annoter** : `translateDom` parcourt les nœuds de texte, les `title` et les
`placeholder`, et remplace ce qu'il reconnaît. Ajouter une langue, c'est ajouter une
colonne dans `src/common/i18n.js`.

Deux conséquences assumées :

- Les chaînes **stockées** (verdicts, libellés de statut, journal) le sont en
  français et sont traduites à l'affichage. Le service worker et le popup peuvent
  donc diverger de langue sans que rien ne se désynchronise.
- Les nombres et les dates suivent la locale (`1 931 540` / `1,931,540`).

Un **test de couverture** échoue si une phrase passée à `t()` ou présente dans une
page HTML n'a pas de traduction : une interface à moitié traduite se voit tout de
suite, au lieu d'attendre qu'un utilisateur le signale.

---

## Suivi des trades envoyés (onglet « Envoyés »)

Épingle 📌 un trade dans l'onglet **Envoyés** du popup : RoNote te prévient dès
qu'il change d'état.

| Issue | Alerte |
|---|---|
| `Completed` | 🎉 Ton trade a été accepté |
| `Declined` | ❌ Ton trade a été refusé |
| `Countered` | 🔄 Ton trade a été contré |
| `Expired` | ⏳ Ton trade a expiré |
| `RejectedDueToError` | ⚠️ Rejeté suite à une erreur Roblox |

**Un trade épinglé à la main notifie toujours** ; le suivi automatique respecte les
cases « Événements à notifier » des réglages.

Point important sur la fiabilité : la disparition d'un trade de la liste Outbound ne
suffit **pas** à conclure (la page est limitée). RoNote confirme systématiquement en
relisant le détail du trade — un trade encore `Open` reste suivi au lieu de
déclencher une fausse alerte « refusé ».

---

## Chaînage des contre-offres

Roblox ne relie pas un trade à la contre-offre qui en découle : quand quelqu'un
contre, l'ancien trade bascule en `Countered` et un trade **tout neuf** apparaît
dans tes trades reçus. RoNote reconstruit le lien localement (partenaire + fenêtre
de temps, 90 min par défaut) :

1. **Tu contres** le trade d'un joueur → RoNote le voit passer en `Countered` côté
   *reçus*, et **auto-suit** la proposition que tu viens d'envoyer.
2. **Il re-contre** → ton trade suivi passe en `Countered`, sa nouvelle offre arrive
   dans tes reçus.
3. Les deux événements sont **fusionnés en une seule notification** :
   `🔄 Contre-offre reçue — Bob` avec le détail des objets et
   `↩ 3ᵉ contre-offre de la négociation (trade #401)`.

Si la contre-offre n'arrive pas dans le même passage, tu reçois quand même l'alerte
« Ton trade a été contré », puis la contre-offre sera rattachée à son arrivée.
Le lien est affiché dans le popup et exporté dans le CSV (colonne
`reponse_au_trade`).

Par défaut, **une contre-offre passe outre les filtres** : c'est une réponse à ta
propre proposition, tu veux la voir même si elle est « perdante ».

---

## Le reste

### Dans chaque notification
- Avatar et pseudo du partenaire
- Ce qu'il donne / ce que tu donnes (objets + Robux)
- **Valeur et RAP des deux côtés**, écart en % et verdict (`Gros gain` → `Grosse perte`)
- Alerte ⚠️ si un item entrant est **projected**
- Boutons **Ouvrir le trade** et **Ignorer ce joueur** (Chrome/Edge)

### Le journal suit en direct

Deux raisons faisaient traîner le journal, les deux ont été reprises :

- **il était écrit en dernier.** Le cycle de vérification enchaînait : flux,
  notifications, **rafraîchissement du portefeuille** — quatre appels à
  Rolimon's et une page HTML, soit plusieurs secondes — puis seulement
  l'écriture du journal. Un événement déjà notifié n'y était donc pas encore.
  L'état et le journal sont maintenant écrits **avant** le portefeuille ;
- **le popup relisait toutes les 15 s.** Il écoute désormais `storage.onChanged`
  et se redessine dès que le service worker écrit le journal ou l'état — les
  écritures d'un même cycle regroupées en une seule mise à jour. Le balayage
  de fond ne sert plus que de filet, toutes les 30 s.

### Popup
Cinq onglets : **Reçus**, **Envoyés** (avec les épingles de suivi), **Terminés**,
**Bénéfice**, **Journal**.

Chaque carte est construite autour de la **value** : les deux côtés de l'échange avec
les vignettes, le total de chacun en clair et son RAP en gris juste dessous, puis
l'écart dans une barre colorée — le chiffre le plus gros de la carte. Le RAP y figure
en second plan, pour qu'un désaccord entre les deux saute aux yeux sans jamais voler
la vedette.

En dessous, les pastilles qui doivent nuancer la lecture : `🎭 visages`,
`⚖️ value vs RAP`, `📈 spéculatif`, `🔁 cote révisée`, `⚠ projected`,
`💸 taxe Robux`, `⏳ cotes non actualisées`.

Et un **détail dépliable** : chaque objet avec sa vignette, sa série, sa value, son
RAP, sa demande et sa tendance — cliquable vers sa page Roblox. Survoler une vignette
donne la même chose en infobulle.

La barre d'état affiche en permanence **le nombre de cotes chargées et leur âge** :
une table morte ou périmée se voit tout de suite, au lieu de fausser silencieusement
tous les chiffres.

### Réglages
- Intervalle de vérification (10 s → 5 min)
- Choix des flux surveillés et des événements à notifier
- Suivi auto de tes contre-offres / de tous tes envois / des envois non suivis
- **4 sonneries générées en WebAudio** (aucun fichier son embarqué) + volume + test
- **Base de calcul** : value Rolimon's (défaut), prudente, ou RAP seul + seuil de
  cote spéculative
- **Robux nets de taxe** (30 % prélevés par Roblox sur les Robux reçus)
- **Détail des objets** dépliable sous chaque trade
- **Panneau sur la page Roblox** et **pastilles sur les objets** (voir *Le panneau
  sur la page Roblox*)
- **Correction des visages passés en bundles** dans l'onglet Bénéfice
- **Filtres** : trades gagnants uniquement, gain min en %, valeur min reçue, items
  projected, joueurs ignorés
- **Heures silencieuses** (le suivi continue, rien n'est perdu ; le son est coupé)
- Export **CSV**, réinitialisation du suivi, diagnostic en direct

### Robustesse et coût réseau
- **Repli automatique** : si le service worker n'arrive pas à envoyer le cookie de
  session, la requête est relayée depuis un onglet `roblox.com` ouvert
- **Backoff exponentiel** sur erreur réseau, respect de `Retry-After` sur 429
- Détection de **déconnexion** (une seule alerte) et de **changement de compte**
- Identité en cache 15 min, compteur de trades déduit de la page quand c'est
  possible, détails de trade et vignettes en cache, écriture disque **uniquement
  quand un id change** → environ **3 à 4 requêtes par vérification**
- Direction d'un trade (envoyé/reçu) déduite de l'historique local, **sans appel
  réseau supplémentaire**
- Tout l'état est persisté : redémarrage du navigateur ou mise en veille du service
  worker sans perte ni doublon

---

## Tests

```bash
python tools/serve.py
```

puis <http://127.0.0.1:8777/tools/selftest.html> — **93 tests, sans rien installer.**

Les faire tourner dans un navigateur n'est pas un pis-aller : c'est le seul moyen de
vérifier d'un coup la **syntaxe**, les **imports** et le **comportement**, sur le
même moteur que celui qui exécutera l'extension. Un module qui ne compile pas fait
échouer son import, donc le test. Le dernier test importe carrément le service
worker complet, réseau coupé : s'il ne démarre pas, on le sait avant de charger
l'extension.

Les jeux d'essai sont de **vraies réponses d'API**, pas des maquettes — c'est ce qui
permet de détecter qu'un renommage de champ chez Roblox ou Rolimon's casse
silencieusement l'évaluation :

- les deux catalogues Rolimon's complets (`tools/fixtures/rolimons-*.json`) ;
- une réponse de trade conforme au schéma officiel v2 ;
- l'inventaire réel d'un compte, avec ses 3 visages fantômes et ses 5 bundles
  ignorés par Rolimon's (`tools/fixtures/portfolio-*.json`), dont le test rejoue le
  calcul complet et vérifie le total au robux près.

Couvre aussi : le pont visage↔bundle sur les 160 bundles, le piège *Zip It!*, la
colonne `rare` déplacée entre v1 et v3, le `userAssetId` pris pour un `assetId`, les
Robux taxés, les objets sans cote (un visage ne doit jamais faire passer un trade
pour une perte de 100 %, ni faire sauter la notification), l'anti-doublon, et la
**couverture des traductions** — toute phrase passée à `t()` ou présente dans une
page HTML doit avoir sa version anglaise, sinon le test échoue en la nommant.

La **lecture de la page** y a sa propre section, dans un vrai DOM : deux colonnes
identifiées par leur propriétaire, l'inventaire ouvert qui doit faire renoncer,
la mise en page sans aucun profil qui doit quand même marcher, et le nom d'un
objet qui ne doit jamais absorber ce que RoNote a écrit dessous.

Les deux suites Node héritées restent disponibles si Node est installé :

```bash
npm test    # anti-doublon (17) + envois et contre-offres (33) + panneau (60)
            # + mise en forme identique des deux côtés (518)
            # + scripts de contenu dans un espace global partagé (11)
```

`check.py` refuse aussi tout **caractère de contrôle** dans les sources. Un
caractère invisible ne se voit ni à la relecture, ni dans un diff, ni dans un
message d'erreur : il a suffi d'un échappement raté dans une expression
régulière — devenu un vrai *backspace* — pour qu'elle ne corresponde plus
jamais à rien, sans un mot.

La troisième suite (`tools/test-appraise.mjs`) rejoue le trade de la capture
d'écran, objet par objet : elle vérifie que l'écart de RAP vaut bien 9 017 et
qu'il **s'affiche avec tous ses chiffres**, que le pourcentage garde sa
décimale, qu'un montant abrégé n'entre jamais dans un total, qu'un détail
appartenant à un autre trade est écarté, et qu'un pseudo tronqué retrouve son
trade — sauf quand deux trades concernent le même joueur, auquel cas on renonce.

---

## Ce que l'extension ne fait pas (volontairement)

**Accepter ou contrer un trade.** Ces deux actions **transfèrent des objets** ; un
clic mal placé y serait irréversible et coûteux. Refuser ou annuler, en revanche,
ne fait que détruire une offre — c'est la seule écriture que RoNote s'autorise, et
seulement depuis le zoom, en deux clics volontaires (voir *Refuser ou annuler un
trade*).

---

## Développement

**Sans Node** (Python 3 suffit) :

```bash
python tools/check.py     # manifestes, imports, exports réels, ressources HTML
python tools/build.py     # dist/chrome + dist/firefox + zips
python tools/serve.py     # sert le projet sur 127.0.0.1:8777
```

Puis, dans un navigateur :

| | |
|---|---|
| <http://127.0.0.1:8777/tools/selftest.html> | les 93 tests |
| <http://127.0.0.1:8777/tools/preview.html> | le popup, en vrai (`?lang=en` pour l'anglais) |

`preview.html` ne remaquette rien : il charge **le vrai** `popup.html` /
`popup.css` / `popup.js` dans une iframe, branché sur un faux service worker, avec
les cotes réelles de Rolimon's et les vignettes réelles du CDN Roblox. Une maquette
séparée finirait toujours par mentir sur le rendu réel. On peut donc itérer sur le
CSS sans recharger l'extension.

**Avec Node**, les équivalents historiques : `npm run build:node`,
`npm run check:node`, `npm test`.

### Structure

```
src/
  manifest.json            Chrome / Edge / Brave / Opera (MV3, service worker)
  manifest.firefox.json    Firefox 128+ (MV3, background modules, sans offscreen)
  common/
    shim.js                compat chrome/browser
    defaults.js            réglages par défaut
    utils.js               formatage, heures silencieuses
    api.js                 API Roblox (trades v1+v2, inventaire, bundles, vignettes)
    i18n.js                >> français / anglais, depuis la phrase source
    roli.js                >> catalogue Rolimon's + pont visage↔bundle
    thumbs.js              résolution des vignettes (candidats ordonnés, cache)
    analysis.js            identité d'un objet, évaluation, verdict
    portfolio.js           >> réconciliation de la valeur du compte
    state.js               réglages / état / flux (clés séparées) / journal
    filters.js             décision de notifier (module pur, testé)
    tones.js               sonneries WebAudio (aussi injectées pour Firefox)
  background/
    streams.js             >> moteur anti-doublon (seen + watermark) + direction
    tracker.js             >> suivi des envois + chaînage des contre-offres
    notifier.js            notifications, son, badge
    service-worker.js      orchestration, alarmes, filtres, messages
  offscreen/               lecture audio (Chrome)
  content/
    hook.js                capture les réponses de trade de la page (monde MAIN)
    relay.js               pont page ↔ service worker
    tradedom.js            >> lecture du trade affiché (colonnes, objets, profils)
    scrape.js              repli : envoie le trade lu au service worker
  popup/                   tableau de bord 5 onglets
  options/                 réglages + diagnostic
tools/
  build.py / check.py      build et vérifications, sans Node
  serve.py                 serveur statique pour les deux pages ci-dessous
  selftest.html/.js        93 tests, dans un vrai navigateur
  preview.html/.js         le vrai popup, branché sur un faux service worker
  fixtures/                vraies réponses d'API (catalogues, inventaire réel)
  *.mjs                    équivalents Node historiques
```

### Ordre de traitement (il compte)

`Inactive` → `Outbound` → `Inbound` → `Completed`.

`Inactive` détecte que tu as contré un trade (pour auto-suivre ton envoi) et que
ton envoi a été contré ; `Outbound` résout les trades suivis et alimente les indices
de contre-offre ; `Inbound` les consomme pour fusionner les deux événements en une
seule alerte. Un trade résolu par le tracker est marqué « déjà vu » sur les flux
`Completed` et `Inactive` : jamais deux notifications pour le même événement.

### Cadence de vérification

Le minimum garanti par l'API `alarms` est de **30 secondes**. Les valeurs
inférieures (10 s / 15 s) fonctionnent « au mieux », tant que le navigateur garde le
service worker éveillé — c'est pour ça que 30 s est la valeur recommandée : elle est
**garantie**, y compris après mise en veille de l'extension.

---

---

## Construire depuis les sources, en détail

### 1. Générer les icônes (déjà fait, à refaire seulement si tu les modifies)

```bash
npm run icons
```

### 2. Construire les paquets

```bash
python tools/build.py
```

> Node n'est pas requis. Le build, les vérifications et les tests ont tous une
> version Python ou navigateur (voir **Développement**) ; les scripts `.mjs`
> restent disponibles si Node est installé (`npm run build:node`).

Ça produit `dist/chrome/`, `dist/firefox/` et les `.zip` correspondants.

> **Le numéro de version change à chaque build livré.** C'est la seule chose
> qui permette de vérifier, d'un coup d'œil sur `chrome://extensions`, que le
> rechargement a bien pris — sans lui, « ça n'a rien changé » est
> indiscernable de « le nouveau code n'est pas chargé ».

> **Après un `npm run build`, il suffit de cliquer sur Actualiser (⟳)** dans
> `chrome://extensions` — le dossier `dist/` n'est jamais supprimé, donc
> l'extension déjà chargée reste valide.
>
> Si tu vois « **An unknown error occurred when fetching the script** », c'est que
> l'enregistrement de l'extension a été cassé (le dossier chargé avait été supprimé
> par une ancienne version du build). Retire RoNote de `chrome://extensions` et
> recharge `dist/chrome` une fois : c'est réglé définitivement.

### 3. Charger l'extension

**Chrome / Edge / Brave / Opera**
1. Va sur `chrome://extensions` (ou `edge://extensions`)
2. Active le **Mode développeur** en haut à droite
3. **Charger l'extension non empaquetée** → sélectionne le dossier `dist/chrome`

**Firefox** (128 minimum)
1. Va sur `about:debugging#/runtime/this-firefox`
2. **Charger un module temporaire** → sélectionne `dist/firefox/manifest.json`
3. Dans `about:addons` → RoNote → Permissions, autorise l'accès à `roblox.com`

### 4. Vérifier

Connecte-toi sur `roblox.com`, puis ouvre le popup : tu dois voir
`Actif · vérifié il y a Xs` et ton pseudo. Le bouton **Tester** dans les réglages
envoie une notification de démonstration avec le son.

> Au tout premier démarrage, RoNote photographie silencieusement les trades déjà
> présents : **aucune notification pour l'existant**. Seuls les trades qui arrivent
> après comptent.
