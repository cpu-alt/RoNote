# Publier RoNote sur le Chrome Web Store

Document de travail. Les consignes sont en français, **tous les blocs à copier-coller
sont en anglais** : c'est la langue de la fiche et celle que lisent les reviewers.
Retour au [README](../README.md).

---

## 0. Avant de commencer

| Étape | Détail |
|---|---|
| Compte développeur | 5 $ une fois, sur <https://chrome.google.com/webstore/devconsole> |
| Vérification | Google demande une adresse e-mail vérifiée et une identité |
| Paquet à téléverser | `dist/ronote-chrome-v2.16.0.zip`, produit par `python tools/build.py` |
| URL de confidentialité | `https://cpu-alt.github.io/RoNote/privacy.html` (en ligne) |

> **Choisis « Unlisted » au premier envoi.** L'installation se fait par lien, les mises
> à jour sont automatiques, mais l'extension n'apparaît pas dans la recherche. Tu
> pourras passer en « Public » plus tard, sans repasser par la case départ.

---

## 1. Store listing

> **Le nom et le résumé ne se saisissent pas.** La console les affiche en
> « Titre issu du package » / « Résumé issu du package » : ils viennent du
> manifeste, via `_locales/`. Un navigateur en français verra
> « RoNote : Alertes de trades Roblox », tous les autres
> « RoNote : Roblox Trade Alerts ». Rien à faire ici.

**Detailed description**

```
RoNote tells you the moment anything moves in your Roblox trades: a trade comes in, a trade completes, a counter-offer arrives, or one of your own outbound trades is accepted, declined, countered or expired.

NO FALSE ALERTS
Tracking is based on the unique trade ID : never on the other player's username, never on a position in the list, never on a trade count. The classic bug ("I decline one trade and the one below it notifies again") simply does not happen here.

VALUE, NOT RAP
Every trade is evaluated item by item: value, RAP, and Robux counted net of the 30% Roblox tax. RoNote flags the usual traps : projected items, quotes sitting far above real sales, faces and bundle items with no value. A trade can look like a win on RAP and be a loss on value: RoNote shows you both.

ON ROBLOX TRADE PAGES
Open any trade on roblox.com and RoNote adds:
• The RAP and Value gap between the two offers : green for a win, red for a loss
• Rolimon's value under every item, and a total for each side
• A warning badge on projected items
• A shortcut to the other player's Rolimon's profile, and a button to blur serial numbers
• Trade Flex: turn a completed trade into a shareable WIN / LOSS image, with names and serials left out

WHAT YOU GET
• Desktop notifications, with a different sound per event type
• Home tab: your portfolio's 24-hour move, today's offers and revaluations at a glance
• Portfolio tab: your account value over time, Value, RAP and collectibles on one chart, plus every item with its value, demand and trend
• Player cards: click an avatar to see that player's inventory value and its curve, account age, last time online, and your trades together
• Revaluation alerts: know when Rolimon's revises the value of an item you own
• Filters: value threshold, ignored players, quiet hours
• English and French, detected automatically
• Decline or cancel a trade in two deliberate clicks

WHAT RONOTE WILL NOT DO
RoNote never creates a trade and never counters one: "Counter" opens the trade on roblox.com, where Roblox's own editor composes the reply. Accepting an inbound trade is possible, but only in two deliberate clicks (the second within 5 seconds), because accepting transfers items and cannot be undone. If Roblox asks for two-step verification, RoNote opens the trade on roblox.com instead of getting around it.

PRIVACY
No data leaves your browser. No server, no account to create, no telemetry, no ads. The only requests go to Roblox's public APIs and, if you leave the option on, to Rolimon's: the public value table and item histories, the same for everyone, and public Rolimon's profiles looked up by Roblox user ID : yours for the portfolio, the other player's when you open their player card. Roblox user IDs are already public; nothing else is sent. Trade Flex images, including any background you import, are made on your computer and never uploaded.

The code is open and verifiable: https://github.com/cpu-alt/RoNote

RoNote is an independent project, not affiliated with or endorsed by Roblox Corporation.
```

**Category** : Tools · **Language** : English

---

## 2. Single purpose

Google exige une phrase décrivant *un seul* objectif.

```
RoNote has a single purpose: to alert the user about changes in their own Roblox trades through desktop notifications, and to present the value analysis of those trades. The optional Neuronal features serve that same purpose: a lookup asks the Neuronal network what it knows about the player or the item whose sheet the user opened, and the contribution option : off until the user turns it on, sends that network the user's own completed trades, which is what makes the trade values the extension displays accurate.
```

---

## 3. Justification des permissions

Une justification par permission, **courte et concrète** : les réponses vagues
rallongent la revue.

| Permission | Justification à coller |
|---|---|
| `storage` | Keep the user's settings and trade tracking state across browser restarts. Local storage only, never synced. |
| `unlimitedStorage` | Hold the portfolio history (one point per day) and the trade log, which outgrow the 5 MB quota of `storage.local` over months of use. Everything stays on the user's machine; nothing is synced. |
| `alarms` | Trigger the periodic trade check. A Manifest V3 service worker is suspended after a few seconds, so `alarms` is the only reliable way to wake it. |
| `notifications` | Display the desktop notifications announcing trade changes. This is the extension's core function. |
| `scripting` | Read the trade displayed in the active tab when the Roblox API does not return its detail (the case for declined trades). The script is injected only on `roblox.com`, and only to read content already visible on screen. |
| `offscreen` | Play the alert sound. A Chrome service worker cannot produce audio; the offscreen document is the API Chrome provides for exactly this. |
| `sidePanel` | Open RoNote in the browser's side panel, as an alternative to the popup, so it stays visible while the user browses roblox.com. The panel loads the extension's own page (`popup/popup.html?panel=1`); no remote page is ever loaded into it. |
| `identity` | Used only for *Connect Discord* (RoNote premium, for subscribers of the Neuronal Discord): `identity.launchWebAuthFlow` opens Discord's own OAuth page (scope `identify`), when the user clicks the button. The resulting token is kept in local storage and sent only to `neuronal.live`, only on the premium requests (Neuronal lookups, Profiles, Deals). |
| `declarativeNetRequestWithHostAccess` | Roblox rejects (403) authenticated requests whose `Origin` header is not its own. A session rule rewrites `Origin` and `Referer` **only for requests issued by the extension itself** (`tabIds: [-1]`, outside any tab), and only towards `roblox.com`. The user's own browsing is never modified. |
| Host access `*.roblox.com` | Read trades, items, thumbnails and public profiles from the Roblox APIs : the extension's data source. |
| Host access `*.rolimons.com` | Download the public item value table and public item price histories, identical for every user. Look up public Rolimon's profiles by Roblox user ID, which is already public: the user's own for portfolio tracking, and another player's when the user opens that player's card. Nothing else is transmitted. This source can be disabled in the settings. |
| Host access `neuronal.live` (optional) | Declared as an **optional** host permission: it is requested at runtime only if the user turns on Neuronal lookups or the Neuronal contribution, both off by default, and it is given back when they turn them off. A lookup sends only the Roblox ID of the player or the item whose sheet is open, with no cookie, and the endpoint only reads. The contribution sends the user's own account presence and their completed trades : declared under Privacy practices below. |
| `externally_connectable` (not a permission, but reviewers ask) | Only `https://neuronal.live/*` may send a message to the extension, and it can ask exactly two things: whether RoNote is installed, with its version and whether the contribution is on, and to open RoNote's Neuronal settings page. No account data, no trade and no setting value is ever returned to the page. |

**Are you using remote code?** → **No**. All scripts ship inside the package; the
extension neither loads nor evaluates any external code.

---

## 4. Privacy practices

**URL de la politique** : l'anglaise est la version par défaut :

```
https://cpu-alt.github.io/RoNote/privacy.html
```

*(la française reste disponible sur `https://cpu-alt.github.io/RoNote/privacy.fr.html`)*

**Data usage** : depuis la 2.16.0, « non partout » est faux : l'option
*Contribuer au réseau Neuronal* transmet. Elle est coupée par défaut, mais le
formulaire se remplit sur ce que l'extension **peut** envoyer, pas sur le réglage
par défaut. Deux cases passent à *oui*, avec la précision à coller dans le champ
de description :

| Question du formulaire | Réponse |
|---|---|
| Personally identifiable information | **Yes** : `Only when the user turns on the Neuronal contribution (off by default): the Roblox user ID, username and display name of their own account, and the Roblox user ID and username of the other player in each completed trade. These are public Roblox account identifiers. No email address, no postal address, no age, no real name.` |
| Health information | No |
| Financial and payment information | No : `Robux amounts in a trade are in-game currency. RoNote never sees a payment method, a card or a real-money transaction.` |
| Authentication information | No : `the Roblox session cookie stays managed by the browser; RoNote never reads, stores or transmits it, and never sees a password.` |
| Personal communications | No |
| Location | No |
| Web history | No |
| User activity (clicks, mouse, keystrokes) | No |
| Website content | **Yes** : `Only when the user turns on the Neuronal contribution (off by default): each completed trade as the Roblox API returned it, item IDs, copy IDs (userAssetId), serial numbers, item names and the Robux on each side. Nothing else from the page or from the user's browsing. With the option off, trade data is read, displayed and kept locally, and never transmitted.` |

**Les trois certifications à cocher** : toutes vraies pour RoNote :

- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

> **La première est celle à relire.** La contribution envoie des données à
> `neuronal.live`, site tenu par l'auteur de RoNote : ce n'est pas une revente, et
> l'envoi sert l'objectif déclaré au §2 (la justesse des values affichées), ce qui
> entre dans les *approved use cases*. C'est pour que cette lecture tienne que le
> §2 mentionne désormais les options Neuronal : si l'objectif unique n'en parle
> pas, la deuxième certification devient fausse.

---

## 5. Éléments graphiques

| Élément | Format | État |
|---|---|---|
| Icône du magasin | 128 × 128 PNG | ✅ `src/icons/icon128.png` |
| Captures d'écran | 1280 × 800, 1 à 5 | ✅ `store-assets/ronote-*.png` (interface en anglais) |
| Petite vignette promo | 440 × 280 | ✅ `store-assets/promo-small-440x280.png` |
| Vignette marquee | 1400 × 560 | ✅ `store-assets/promo-marquee-1400x560.png` |

**Ordre de téléversement des captures** (le Store les affiche dans cet ordre) :

1. `ronote-trades.png` : pages de trade Roblox : win / loss et objet projected
2. `ronote-flex.png` : Trade Flex
3. `ronote-inbound.png` : trades reçus évalués
4. `ronote-stats.png` : onglet Portefeuille
5. `ronote-player.png` : fiche joueur

En réserve, hors limite des 5 : `ronote-home.png` (onglet Accueil).

Pour les régénérer après un changement d'interface :

```bash
python tools/serve.py
```

puis, dans un autre terminal, Chrome en headless (`--window-size=1280,800
--virtual-time-budget=12000 --screenshot=…`) sur :

| Capture | URL (sous `http://127.0.0.1:8777/tools/preview/`) |
|---|---|
| `ronote-trades.png` | `_shot-trades.html?lang=en` (`--virtual-time-budget=14000`) |
| `ronote-flex.png` | `_shot-flex.html?lang=en` |
| `ronote-inbound.png` | `_shot.html?tab=inbound&lang=en&promo=1` |
| `ronote-stats.png` | `_shot.html?tab=stats&lang=en&promo=1&series=v,r,n&scrub=0.72` |
| `ronote-player.png` | `_shot.html?tab=inbound&player=1&lang=en&promo=1` |
| `ronote-home.png` | `_shot.html?tab=home&lang=en&promo=1` |

`promo=1` décale la courbe de démo pour qu'elle finisse en hausse et fait
annoncer la version du manifeste par l'accueil. Les deux vignettes viennent de
`_promo.html?size=small` (440 × 280) et `_promo.html?size=marquee` (1400 × 560) ;
le marquee découpe `ronote-home.png` et `ronote-flex.png`, donc on le
régénère **après** les captures.

> **Anonymise** : aucune capture ne doit montrer ton pseudo, ton identifiant Roblox ni
> ceux d'autres joueurs. Les captures actuelles utilisent le compte fictif
> `@DemoTrader`.

---

## 6. Points de vigilance

**Un envoi accepté, une soumission refusée.** Le 1er novembre 2026, la 2.16.0 a
été téléversée sans problème, puis `publish` a répondu « Your submission does not
meet the requirements to be published in the store. Check the Developer
Dashboard. » : le paquet est en brouillon sur l'item, c'est le dashboard qui
réclame des champs : typiquement les justifications des permissions nouvelles de
la version (ici `sidePanel` et `neuronal.live`) et le formulaire *Data usage*
quand ce qui est transmis change. Une fois le dashboard en règle, **ne pas
relancer le workflow complet** : le store refuse deux fois le même numéro de
version. La relance qui ne refait que la soumission :

```bash
gh workflow run release.yml -f tag=v2.16.0 -f cws_publish_only=true
```

**Délai de revue.** Compte plusieurs jours. Le trio « interception réseau en monde
MAIN + réécriture d'en-têtes + POST authentifié » déclenche généralement une revue
manuelle. Les justifications du §3 sont écrites pour la désamorcer.

**La marque Roblox dans le nom.** `RoNote : Roblox Trade Alerts` utilise une marque
déposée. Usage descriptif, généralement toléré, mais c'est le motif de refus le plus
probable. Repli : `RoNote` tout court, Roblox seulement dans la description.

**Les conditions d'utilisation de Roblox.** Elles interdisent les programmes tiers non
autorisés qui accèdent au service ou automatisent des actions de compte. Refuser un
trade via l'API avec la session de l'utilisateur entre dans cette description. Ce
n'est pas un problème pour Google, mais Roblox peut demander un retrait : et le risque
retombe aussi sur les utilisateurs. C'est la raison principale de commencer en
« Unlisted ».

---

## 7. Après publication

- ✅ README : fait le 1er novembre 2026. Les deux README ouvrent sur « Depuis le
  Chrome Web Store (recommandé) » et son lien d'installation ; la Release reste
  documentée en dessous, pour Firefox et pour une version que le store n'a pas
  encore publiée
- Créer une Release GitHub taguée pour chaque version publiée
- Toute nouvelle version repasse par une revue : incrémenter `version` dans
  `src/manifest.json` **et** dans `package.json`, ils doivent rester synchronisés
