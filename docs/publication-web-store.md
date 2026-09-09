# Publier RoNote sur le Chrome Web Store

Document de travail. Les consignes sont en français, **tous les blocs à copier-coller
sont en anglais** — c'est la langue de la fiche et celle que lisent les reviewers.
Retour au [README](../README.md).

---

## 0. Avant de commencer

| Étape | Détail |
|---|---|
| Compte développeur | 5 $ une fois, sur <https://chrome.google.com/webstore/devconsole> |
| Vérification | Google demande une adresse e-mail vérifiée et une identité |
| Paquet à téléverser | `dist/ronote-chrome-v2.9.0.zip`, produit par `python tools/build.py` |
| URL de confidentialité | `https://cpu-alt.github.io/RoNote/privacy.html` (en ligne) |

> **Choisis « Unlisted » au premier envoi.** L'installation se fait par lien, les mises
> à jour sont automatiques, mais l'extension n'apparaît pas dans la recherche. Tu
> pourras passer en « Public » plus tard, sans repasser par la case départ.

---

## 1. Store listing

**Name** (45 caractères max)

```
RoNote — Roblox Trade Alerts
```

**Short description** (132 caractères max)

```
Reliable desktop alerts for your Roblox trades (inbound, completed, declined) with value analysis, sounds and filters.
```

**Detailed description**

```
RoNote tells you the moment anything moves in your Roblox trades: a trade comes in, a trade completes, a counter-offer arrives, or one of your own outbound trades is accepted, declined, countered or expired.

NO FALSE ALERTS
Tracking is based on the unique trade ID — never on the other player's username, never on a position in the list, never on a trade count. The classic bug ("I decline one trade and the one below it notifies again") simply does not happen here.

VALUE, NOT RAP
Every trade is evaluated item by item: value, RAP, and Robux counted net of the 30% Roblox tax. RoNote flags the usual traps — projected items, quotes sitting far above real sales, faces and bundle items with no value.

WHAT YOU GET
• Desktop notifications, with a different sound per event type
• Detailed value analysis, item by item
• Portfolio tab: how your account value moves over time
• Filters: value threshold, ignored players, quiet hours
• English and French, detected automatically
• Decline or cancel a trade in two deliberate clicks

WHAT RONOTE WILL NOT DO
RoNote never accepts a trade, never creates one, and never counters one. Those actions transfer items: a misplaced click would be irreversible. Declining or cancelling only destroys an offer — that is the only write RoNote allows itself.

PRIVACY
No data leaves your browser. No server, no account to create, no telemetry, no ads. The only requests go to Roblox's public APIs and, if you leave the option on, to Rolimon's for the public value table — which receives nothing about you.

The code is open and verifiable: https://github.com/cpu-alt/RoNote

RoNote is an independent project, not affiliated with or endorsed by Roblox Corporation.
```

**Category** : Tools · **Language** : English

---

## 2. Single purpose

Google exige une phrase décrivant *un seul* objectif.

```
RoNote has a single purpose: to alert the user about changes in their own Roblox trades through desktop notifications, and to present the value analysis of those trades.
```

---

## 3. Justification des permissions

Une justification par permission, **courte et concrète** — les réponses vagues
rallongent la revue.

| Permission | Justification à coller |
|---|---|
| `storage` | Keep the user's settings and trade tracking state across browser restarts. Local storage only, never synced. |
| `alarms` | Trigger the periodic trade check. A Manifest V3 service worker is suspended after a few seconds, so `alarms` is the only reliable way to wake it. |
| `notifications` | Display the desktop notifications announcing trade changes. This is the extension's core function. |
| `scripting` | Read the trade displayed in the active tab when the Roblox API does not return its detail (the case for declined trades). The script is injected only on `roblox.com`, and only to read content already visible on screen. |
| `offscreen` | Play the alert sound. A Chrome service worker cannot produce audio; the offscreen document is the API Chrome provides for exactly this. |
| `declarativeNetRequestWithHostAccess` | Roblox rejects (403) authenticated requests whose `Origin` header is not its own. A session rule rewrites `Origin` and `Referer` **only for requests issued by the extension itself** (`tabIds: [-1]`, outside any tab), and only towards `roblox.com`. The user's own browsing is never modified. |
| Host access `*.roblox.com` | Read trades, items, thumbnails and public profiles from the Roblox APIs — the extension's data source. |
| Host access `*.rolimons.com` | Download the public item value table, identical for every user. No user data is transmitted. This source can be disabled in the settings. |

**Are you using remote code?** → **No**. All scripts ship inside the package; the
extension neither loads nor evaluates any external code.

---

## 4. Privacy practices

**URL de la politique** — l'anglaise est la version par défaut :

```
https://cpu-alt.github.io/RoNote/privacy.html
```

*(la française reste disponible sur `https://cpu-alt.github.io/RoNote/privacy.fr.html`)*

**Data usage** — pour RoNote, la réponse est *non* partout :

| Question du formulaire | Réponse |
|---|---|
| Personally identifiable information | No |
| Health, financial, authentication information | No |
| Personal communications | No |
| Location | No |
| Web history | No |
| User activity (clicks, mouse, keystrokes) | No |
| Website content | No — trade data is read and displayed locally, never transmitted |

**Les trois certifications à cocher** — toutes vraies pour RoNote :

- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

---

## 5. Éléments graphiques

| Élément | Format | État |
|---|---|---|
| Icône du magasin | 128 × 128 PNG | ✅ `src/icons/icon128.png` |
| Captures d'écran | 1280 × 800, 1 à 5 | ✅ `store-assets/` (interface en anglais) |
| Petite vignette promo | 440 × 280 | facultatif |

Pour les régénérer après un changement d'interface :

```bash
python tools/serve.py
```

puis, dans un autre terminal, Chrome en headless sur
`tools/_shot.html?tab=<inbound|outbound|stats|history>&lang=en`.

> **Anonymise** : aucune capture ne doit montrer ton pseudo, ton identifiant Roblox ni
> ceux d'autres joueurs. Les captures actuelles utilisent le compte fictif
> `@DemoTrader`.

---

## 6. Points de vigilance

**Le nom de l'extension dans Chrome reste en français.** La fiche est en anglais, mais
`src/manifest.json` déclare `"name": "RoNote — Alertes de trades Roblox"` et une
`description` française : c'est ce qui s'affichera dans `chrome://extensions` et dans
le bandeau du magasin. Pour un vrai bilinguisme il faut passer par `_locales/` et
`default_locale` — un changement dans `src/`, à décider séparément.

**Délai de revue.** Compte plusieurs jours. Le trio « interception réseau en monde
MAIN + réécriture d'en-têtes + POST authentifié » déclenche généralement une revue
manuelle. Les justifications du §3 sont écrites pour la désamorcer.

**La marque Roblox dans le nom.** `RoNote — Roblox Trade Alerts` utilise une marque
déposée. Usage descriptif, généralement toléré, mais c'est le motif de refus le plus
probable. Repli : `RoNote` tout court, Roblox seulement dans la description.

**Les conditions d'utilisation de Roblox.** Elles interdisent les programmes tiers non
autorisés qui accèdent au service ou automatisent des actions de compte. Refuser un
trade via l'API avec la session de l'utilisateur entre dans cette description. Ce
n'est pas un problème pour Google, mais Roblox peut demander un retrait — et le risque
retombe aussi sur les utilisateurs. C'est la raison principale de commencer en
« Unlisted ».

---

## 7. Après publication

- Mettre à jour le README : remplacer le bloc « Pourquoi le mode développeur ? » par
  le lien d'installation du Web Store
- Créer une Release GitHub taguée pour chaque version publiée
- Toute nouvelle version repasse par une revue : incrémenter `version` dans
  `src/manifest.json` **et** dans `package.json`, ils doivent rester synchronisés
