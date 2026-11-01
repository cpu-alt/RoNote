# Brief pour Neuronal : intégration RoNote (à coller dans un nouveau chat)

Je développe **RoNote**, une extension navigateur (Chrome/Firefox, MV3) qui suit
les trades Roblox d'un joueur. Elle lit déjà ta route `GET /ext/v1/player/{id}`
et `GET /ext/v1/item/{id}` (les « fiches Neuronal »). J'ajoute maintenant une
option **« Contribuer au réseau Neuronal »** (désactivée par défaut, l'utilisateur
l'active lui-même) : l'extension envoie à neuronal.live la présence du compte et
ses **trades terminés exacts, Robux compris**. Il faut faire le côté site :
recevoir ces données, les vérifier, les montrer sur la carte, et créer une page
`neuronal.live/ronote`.

L'extension est déjà codée : **le format ci-dessous est fixe**, adapte le
serveur à lui.

---

## 1. Ce que l'extension envoie

Toutes les requêtes : `https://neuronal.live/ext/v1/…`, `credentials: 'omit'`
(aucun cookie), en-têtes `Content-Type: application/json` et
`X-RoNote: <version de l'extension>` (comme pour les fiches). Elles partent du
service worker de l'extension (origine `chrome-extension://…` ou
`moz-extension://…`) : réponds au préflight CORS `OPTIONS` pour ces origines
avec `Access-Control-Allow-Headers: Content-Type, X-RoNote`.

### `POST /ext/v1/presence`

Au plus une fois toutes les 6 h par compte (et au premier passage après activation).

```json
{
  "user": { "id": 123456, "name": "pseudo", "displayName": "Nom affiché" },
  "version": "2.17.0",
  "value": 154000,
  "rap": 98000
}
```

`value` / `rap` : valeur de l'inventaire selon Rolimon's, `null` si l'utilisateur
n'a pas le suivi du portefeuille.

### `POST /ext/v1/trades`

Les trades **terminés (Completed)** du compte, chacun envoyé **une seule fois**,
par lots de 25 max, tels que l'API Roblox les a rendus.

```json
{
  "reporter": 123456,
  "trades": [
    {
      "id": 987654321,
      "created": 1761825600,
      "seen": 1761912000,
      "partner": { "id": 777, "name": "bob" },
      "gave": {
        "robux": 0,
        "items": [
          { "uaid": 9001, "assetId": 1365767, "bundleId": 0, "serial": 42, "name": "Valkyrie Helm" }
        ]
      },
      "got": {
        "robux": 1200,
        "items": [
          { "uaid": null, "assetId": 0, "bundleId": 5, "serial": null, "name": "Face" }
        ]
      }
    }
  ]
}
```

- `id` : l'identifiant du trade Roblox (unique, sert de clé de dédoublonnage —
  les deux participants peuvent l'envoyer chacun).
- `created` : création du trade (secondes Unix, peut être `null`) ; `seen` :
  moment où l'extension l'a vu terminé (≈ date de conclusion).
- `gave` = ce que `reporter` a donné, `got` = ce qu'il a reçu.
- `robux` : montant **brut** proposé dans le trade (avant la taxe Roblox de 30 %
  pour celui qui reçoit).
- `uaid` : userAssetId de l'exemplaire, `null` quand Roblox ne l'a pas donné
  (API v2 : GUID). `assetId` OU `bundleId` est toujours renseigné.

### Réponses attendues par l'extension

| Code | Ce que fait l'extension |
|---|---|
| `2xx` | OK, trades marqués comme envoyés |
| `400` / `422` / autre `4xx` | Lot refusé, **pas renvoyé** (marqué envoyé) |
| `404` / `503` | Route absente ou coupée : pause de 6 h |
| `429` | Pause de 10 min |
| `5xx` / réseau | Pause de 10 min, réessai |

Le corps de la réponse n'est pas lu (renvoie `{ "ok": true, "accepted": n }`
si tu veux, pour le debug).

---

## 2. Vérifier avant de croire (anti-abus) — important

Il n'y a **aucune authentification** possible (l'extension n'envoie ni cookie
ni jeton Roblox, et ne doit pas). N'importe qui peut donc forger un POST. Règles :

1. **Présence** : un compte n'obtient le statut « RoNote » (cadre bleu) qu'après
   au moins **un trade envoyé et confirmé** (voir 2), ou au minimum marque-le
   comme « non vérifié » jusque-là. Garde `first_seen`, `last_seen`, `version`.
2. **Trades** : un trade rapporté est une **déclaration**. Confirme-le avec ce que
   le réseau voit déjà : les `uaid` donnés par A doivent apparaître chez B (et
   inversement) dans tes scans d'inventaire autour de `seen`. Confirmé →
   remplace/fusionne avec le trade que tu avais déduit, avec le contenu exact.
   Si les **deux** participants envoient le même `id` avec le même contenu, c'est
   confirmé d'office.
3. **Robux** : invérifiables par les inventaires. Ne les affiche que sur un trade
   dont la partie objets est confirmée (ou rapportée identiquement des deux
   côtés). Rejette les montants absurdes (négatifs, non entiers, > 10 000 000).
4. **Limites** : débit par IP et par `reporter` (ex. 60 req/h), taille max du
   corps (ex. 64 Ko), 25 trades max par lot, schéma strict. Ne bannis jamais,
   limite (429).
5. Un `reporter` qui n'est ni `a` ni `b` du trade n'a rien à faire là : refuse.

---

## 3. Ce que la route de lecture doit renvoyer en plus

L'extension affiche déjà ces champs s'ils existent (rien ne casse s'ils manquent) :

- `GET /ext/v1/player/{id}` → ajoute **`"ronote": true`** si le joueur utilise
  RoNote (vérifié). L'extension affiche un drapeau bleu « Utilise RoNote ».
- Dans chaque trade de `recent` (joueur et objet) → ajoute
  **`"gave_robux"`** et **`"got_robux"`** (entiers, 0 si aucun) et
  **`"via_ronote": true`** quand le trade a été confirmé par un utilisateur
  RoNote. L'extension affiche « R$ 1 200 » à côté des objets et une étiquette
  bleue « RoNote ».

Pense à invalider ton cache de lecture (10 min) pour un joueur quand un de ses
trades arrive par RoNote.

---

## 4. La carte (`/network`)

- Les joueurs RoNote vérifiés ont un **cadre bleu** (`#3d8eff`, le bleu du site)
  autour de leur nœud, avec une légende « Utilisateur RoNote ».
- Les liens (trades) confirmés par RoNote : trait plein / plus net que les trades
  déduits, et au survol **les Robux** s'il y en a (« + R$ 1 200 »).
- Un filtre « Afficher seulement les utilisateurs RoNote » serait un plus.

---

## 5. La page `neuronal.live/ronote`

Page de présentation de l'extension, dans le style du site (gris neutres, un
seul bleu `#3d8eff`, aplats, police Onest, titres en casse normale). L'extension
y fait un lien depuis ses réglages (« RoNote sur neuronal.live »). Contenu :

1. **En-tête** : nom RoNote, accroche (« Les alertes de trades Roblox, fiables,
   avec les valeurs Rolimon's »), boutons d'installation Chrome Web Store et
   Firefox Add-ons (je te donnerai les liens, mets des placeholders), bouton
   Discord Neuronal.
2. **Fonctionnalités** : alertes trades reçus / acceptés / refusés / contrés,
   valeur et gain de chaque trade, portefeuille, fiches joueur et objet, écarts
   sur les pages Roblox, barre latérale, interface Neuronal.
3. **Section « RoNote × Neuronal »** : explique la contribution (cadre bleu sur
   la carte, trades exacts avec Robux, aucune requête de plus vers Roblox,
   option désactivée par défaut, se coupe à tout moment).
4. **Compteurs en direct** si possible : nombre d'utilisateurs RoNote vus ces
   7 derniers jours, trades confirmés par RoNote (une petite route publique
   `GET /ext/v1/stats` → `{ "users_7d": n, "trades": n }` suffit).
5. **Confidentialité** : ce qui est envoyé (exactement la liste de la section 1),
   rien d'autre ; lien vers la politique de l'extension.
6. **FAQ** courte : « Pourquoi c'est désactivé par défaut ? », « Comment me
   retirer de la carte ? » (couper l'option ; prévois une suppression des
   données sur demande via Discord ou un formulaire).

---

## 6. Récap des choses à livrer

- [ ] `POST /ext/v1/presence` et `POST /ext/v1/trades` (+ CORS, limites, schéma)
- [ ] Stockage + vérification des trades rapportés (section 2)
- [ ] `ronote`, `gave_robux`, `got_robux`, `via_ronote` dans les routes de lecture
- [ ] Cadre bleu + Robux sur la carte
- [ ] Page `/ronote` (+ `GET /ext/v1/stats` optionnel)
- [ ] Moyen de supprimer ses données sur demande
