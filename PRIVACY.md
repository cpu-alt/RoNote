# Privacy Policy : RoNote

**Last updated: 15 November 2026 · Version 2.17.0**

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

By default that storage is **local and never synced**: nothing is uploaded to your
Google account or to any other device.

**Exception, only if you turn it on: "Sync my devices"** (Settings, off by default, to
enable on each device). RoNote then also writes to your browser's own synced storage
(`storage.sync`), which your browser vendor (Google, Microsoft or Mozilla) carries to
your other devices signed in to the same browser account. What is copied: your
settings (including your Watchlist: item ids, names and target prices), the players you follow, ignore or saved for later (Roblox id and
name, no avatar), and for 3 hours the ids of the trade notifications shown or closed
(`ronote:<kind>:<tradeId>`), so a trade doesn't ring twice. Never copied: your trades'
contents, the portfolio, the log, the Roblox session, imported images or sounds, and
your Neuronal choice (each device asks for its own). No RoNote or Neuronal server is
involved. Turning the option off stops the copies.

To erase everything: uninstall the extension, or use **Reset** in the settings page.
There is no copy anywhere else to delete.

## The only network connections

By default, RoNote contacts exactly two domains, both declared in its manifest:

| Domain | Why | What is sent |
|---|---|---|
| `*.roblox.com` | Read your trades, items, thumbnails and profiles, and the lowest resale price of the items in your Watchlist | Nothing beyond the request itself, using the Roblox session already present in your browser |
| `*.rolimons.com` | Download the public item value table and, when you open an item, its public price history (also on your own Rolimon's player page, for the profit shown under each item). When you open the Rolimon's view of the popup, its public Deals page and deal activity. With portfolio tracking on, read your public Rolimon's profile. When you open a player's card or their Roblox profile, read theirs | For the value table and item histories, **nothing about you** : the same public pages for every user. For portfolio tracking, your **Roblox user ID**, which is already public, to look up your profile. For a player's card, **their** Roblox user ID, public as well |

Rolimon's can be **turned off** in the settings. Without it, RoNote falls back to the
RAP reported by Roblox and contacts nothing but Roblox.

**Neuronal lookups option (off by default).** If you turn it on (Settings ›
Values), the browser asks you for access to `neuronal.live`, the Neuronal
network website run by RoNote's author. When you then open a player's or an
item's sheet, RoNote asks `neuronal.live/ext/v1/` what the network knows about
it: **only that player's or item's Roblox ID** is sent, with no cookie and
nothing about you. The endpoint only reads: it never adds anyone to the
network. With this option on, RoNote also downloads, at most once an hour, the
item demand table (`neuronal.live/ext/v1/demand`) shown on trade pages: the
same list for everyone, **nothing is sent** with it. Turning the option off
gives the permission back.

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

**Show my Discord on my Roblox profile (RoNote premium, off by default).** If you turn it
on, Neuronal lets other RoNote users see your Discord name, username and avatar on your
Roblox profile page. Turning it off removes it at once. When you open someone's Roblox
profile, and only if you already granted access to `neuronal.live`, RoNote sends **their**
public Roblox user ID to Neuronal to ask for their Neuronal subscriber rank and whether they chose to show their Discord (and, if you are an Insider or Elite subscriber, their latest proven trades); the
answer is kept 30 minutes in your browser.

**Share proof (RoNote premium, Neuronal Elite only).** On a completed trade, the proof
mode shield opens a panel on the right that prepares the five lines Rolimons asks for in
its #proofs channel (items, values, sender, receiver, date), which you can edit. Only when
you click *Send to my DMs*, RoNote takes a screenshot of the tab, cuts it to the trade
(and, if you tick it, the trade list with the other usernames hidden by proof mode), and
sends the image and the five lines to `neuronal.live` with your premium token. The
screenshot uses the `activeTab` permission, given by a click on RoNote's icon in that tab,
or the optional screenshot permission if you allowed it once (*Allow screenshots*);
without them, you can take it with Chrome's own tab sharing, which asks you first. Neuronal
posts them back to **you**, in a Discord DM from its bot RoOp Tracker, and does not keep
the image.

**Automatic trade ads (off by default).** If you turn them on (account
menu › Automatic trade ads), RoNote posts the ad you composed (the items you offer, the
items or tags you want) to the sites you ticked, at the interval you chose, never more
than once every 15 minutes per site. It reuses the session **you** opened on each site in
your browser: RoNote never asks for, stores or types a password, and reads no cookie. What
is sent is the ad itself and your Roblox user ID: to `api.rolimons.com` (Rolimon's), and to
`routility.io` (RoUtility) only after you allow that optional permission.

**Continue on server (RoNote premium, off by default).** Only if you click *Continue on
server* and allow the optional `cookies` permission, RoNote reads the cookies your browser
would itself send to `api.rolimons.com` and `routility.io` (your sessions on those two sites,
**never a Roblox cookie**) and sends them to `neuronal.live`, with your ad, its settings and the
items that can be drawn (your tradable items' IDs, names and values; the public value table).
Neuronal stores the sessions **encrypted**, uses them only to post your ad on those sites for
the time you chose, or with no limit until you resume, never shows them back, and **erases them** when you
click *Resume here*, when the time runs out, when a site refuses them, or when your access ends.

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

On `roblox.com/my/avatar`, the RoNote panel can also **change what your avatar
wears** (`avatar.roblox.com`), only when you click: wear or remove an accessory,
put an outfit back on. For this it reads your accessories on `inventory.roblox.com`
and their thumbnails on `thumbnails.roblox.com`. Saved outfits stay on your PC
(`storage.local`); nothing is sent to RoNote or Neuronal.

When you use a **trial key** given by the Neuronal staff, RoNote sends Neuronal the key and the IDs of
the Roblox accounts your RoNote follows. Neuronal keeps them with your Discord account to check that a
key is never used by its creator or one of their accounts, and logs which Roblox account used which key.
The access closes on its own when the trial ends.

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
| `activeTab` | Take the screenshot of *Share proof* (RoNote premium), only of the tab where you clicked RoNote's icon, only when you click *Send* |
| All sites (optional) | Only if you click *Allow screenshots* (Settings › Appearance › Proof mode): lets *Share proof* take its screenshot without a click on RoNote's icon first. Used for nothing else; you can withdraw it in the browser's extension settings |
| `declarativeNetRequestWithHostAccess` | Fix the `Origin` and `Referer` headers on RoNote's own requests to Roblox, which Roblox would otherwise reject. Applies **only to requests issued by the extension** (outside any tab), never to your browsing |
| `*.roblox.com` | The site whose trades RoNote reads |
| `*.rolimons.com` | The public value table, public item histories, the public Rolimon's profile of players whose card you open and, with portfolio tracking, yours |
| `routility.io` (optional) | Only requested if you tick RoUtility in Automatic trade ads: checks that you are signed in there and posts your ad, with the session you opened yourself |
| `cookies` (optional) | Only requested when you click *Continue on server* in Automatic trade ads: reads your Rolimon's and RoUtility session cookies (the ones the browser sends to their trade-ad APIs) to hand them to the Neuronal server, encrypted. Never a Roblox cookie |
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
