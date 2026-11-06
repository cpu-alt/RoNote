# Privacy Policy : RoNote

**Last updated: 6 November 2026 · Version 2.16.8**

*[Version française](PRIVACY.fr.md)*

RoNote is a browser extension that shows desktop notifications about your Roblox
trades. It is built to run **entirely on your own computer**.

## In one sentence

**RoNote does not send any of your data to anyone.** There is no RoNote server, no
account to create, no telemetry, no ads, no analytics, and nothing is ever sold or
shared.

## What RoNote reads

While you are signed in to Roblox, RoNote reads, from within your browser:

- **your trades** : inbound, outbound, completed, declined: IDs, dates, status;
- **the items in those trades** : names, IDs, thumbnails, values;
- **the public profile of the other player** : username, display name, avatar;
- **your own username and Roblox ID**, so it knows which account it is looking at;
- **your inventory**, if you use the Portfolio tab or the revaluation alerts.

## Where that data is stored

Only in your browser's **local storage** (`storage.local`), on your machine. In
practice: your settings, trade tracking state, your account value history, and the
event log.

That storage is **local and never synced**: RoNote deliberately avoids
`storage.sync`, so nothing is uploaded to your Google account or to any other device.

To erase everything: uninstall the extension, or use **Reset** in the settings page.
There is no copy anywhere else to delete.

## The only network connections

By default, RoNote contacts exactly two domains, both declared in its manifest:

| Domain | Why | What is sent |
|---|---|---|
| `*.roblox.com` | Read your trades, items, thumbnails and profiles | Nothing beyond the request itself, using the Roblox session already present in your browser |
| `*.rolimons.com` | Download the public item value table and, when you open an item, its public price history. With portfolio tracking on, read your public Rolimon's profile. When you open a player's card, read theirs | For the value table and item histories, **nothing about you** : the same public pages for every user. For portfolio tracking, your **Roblox user ID**, which is already public, to look up your profile. For a player's card, **their** Roblox user ID, public as well |

Rolimon's can be **turned off** in the settings. Without it, RoNote falls back to the
RAP reported by Roblox and contacts nothing but Roblox.

**Neuronal lookups option (off by default).** If you turn it on (Settings ›
Values), the browser asks you for access to `neuronal.live`, the Neuronal
network website run by RoNote's author. When you then open a player's or an
item's sheet, RoNote asks `neuronal.live/ext/v1/` what the network knows about
it: **only that player's or item's Roblox ID** is sent, with no cookie and
nothing about you. The endpoint only reads: it never adds anyone to the
network. Turning the option off gives the permission back.

**Contribute to the Neuronal network option (off by default).** If you turn it
on (Settings › Values), with the same `neuronal.live` permission, RoNote sends
`neuronal.live/ext/v1/` two things, and only these: **your account's presence**
(Roblox user ID, username, display name, extension version and the value of
your inventory if portfolio tracking is on), at most every 6 hours, so the
network can show you on its map as a RoNote user; and **your completed trades**,
each sent once, exactly as Roblox returned them: the items on each side (item
IDs, copy IDs, serial numbers), the **Robux** on each side, and your trade
partner's Roblox user ID and username. Only trades whose detail RoNote has
already read are sent: this option never adds a request to Roblox. No cookie,
no token, nothing from your browsing. Turning the option off stops it at once.

**The neuronal.live page can see RoNote.** On `neuronal.live` (and nowhere
else), the page can ask RoNote two things: whether it is installed, with its
version and whether the contribution is on (yes or no), and to open RoNote's
Neuronal settings. Nothing else is answered: no account, no trade, no setting.
On Chrome the page can ask this as soon as RoNote is installed; on Firefox only
once you have granted access to `neuronal.live`.

**RoNote premium (optional, for Neuronal Discord subscribers).** Neuronal lookups,
Profiles and Deals are served by `neuronal.live` to subscribers only. To unlock
them (Settings › Premium), you either **Connect Discord** or enter the **key** you
received from the Neuronal Discord. *Connect Discord* opens Discord's own sign-in
page through the browser (`identity` permission); Discord only gives Neuronal your
**Discord ID and name** (`identify` scope: no e-mail, no server list, no messages).
With a key, RoNote sends the key and the Roblox user ID and username of the account
RoNote follows. To prove that Roblox account is yours, you paste a short code in
your **public** Roblox profile description, which `neuronal.live` reads on the
public profile page; RoNote never sends your Roblox session or cookie. Instead of the code, you can
**Sign in with Roblox**: Roblox's own authorization page (OAuth 2.0, scopes `openid`
and `profile`) tells `neuronal.live` your Roblox user ID and username, nothing else.
RoNote then
keeps a **signed token** (valid 24 h, renewed automatically) in its local storage
and attaches it, with the Roblox user ID it follows, to premium requests only.
Neuronal stores your Discord ID, the linked Roblox user ID and username, and your
sessions (dates only), to check your subscription on every request. *Sign out*
closes the session on the server and deletes the token. Premium is independent from
the contribution option: signing in sends nothing about your trades.

**Without these options, no request goes to any other domain.**

## How your Roblox session is used

To read *your* trades, RoNote queries the Roblox API reusing the session already open
in your browser : exactly as roblox.com itself does while you browse.

RoNote **does not read, store or transmit your password**. It does not copy your
session cookie either: the cookie stays managed by the browser, which attaches it to
Roblox requests on its own.

## The only action that changes your account

RoNote can **decline** an inbound trade, **cancel** an outbound one and, since
version 2.16.0, **accept** an inbound trade. Always on your explicit click, in two
steps: a first click arms the button, a second one within 5 seconds confirms.
Accepting transfers items and cannot be undone: that is why the second click is
required. If Roblox asks for two-step verification, RoNote does not get around it:
it opens the trade on roblox.com, where you finish yourself.

RoNote can also send a **counter-offer** to an inbound trade, composed in its
editor: you pick the items and Robux on each side, the difference is simulated, and
sending is confirmed with two clicks the same way. To offer you the items, RoNote
reads both players' limiteds from `inventory.roblox.com` when you open the editor;
nothing of it is kept. RoNote **never creates a trade on its own**: it only sends in
reply to an inbound trade, on your click.

## The permissions requested, and why

| Permission | What it is for |
|---|---|
| `storage` | Keep your settings and tracking state between browser restarts |
| `alarms` | Trigger the periodic trade check |
| `notifications` | Show the desktop notifications : the extension's whole purpose |
| `scripting` | Read the trade shown on screen when the API does not return its detail |
| `offscreen` | Play the alert sound, since a Chrome service worker cannot produce audio |
| `sidePanel` | Open RoNote in the browser's sidebar, if you choose that mode |
| `identity` | Open Discord's sign-in page for *Connect Discord* (RoNote premium), only when you click it |
| `declarativeNetRequestWithHostAccess` | Fix the `Origin` and `Referer` headers on RoNote's own requests to Roblox, which Roblox would otherwise reject. Applies **only to requests issued by the extension** (outside any tab), never to your browsing |
| `*.roblox.com` | The site whose trades RoNote reads |
| `*.rolimons.com` | The public value table, public item histories, the public Rolimon's profile of players whose card you open and, with portfolio tracking, yours |
| `neuronal.live` (optional) | Only requested if you turn on Neuronal lookups or the contribution: what the network knows about a player or an item whose sheet you open; with the contribution, your account's presence and your completed trades |

## Children and minimum age

RoNote collects no data about you, whatever the user's age. Only the two Neuronal
options, off by default, send anything: a player's or an item's public ID for
lookups, your account's presence and completed trades for the contribution.

## No affiliation

RoNote is an independent project. It is **not affiliated with, endorsed by, or
sponsored by Roblox Corporation or Rolimon's**. "Roblox" is a trademark of Roblox
Corporation.

## Changes

Any change to this policy will be published on this page, with the updated date
above. The code being open, every behaviour change is verifiable in the repository
history.

## Contact

A question, or a doubt about this document? Open an
[issue on GitHub](https://github.com/cpu-alt/RoNote/issues).
