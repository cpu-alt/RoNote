# Privacy Policy — RoNote

**Last updated: 9 September 2026 · Version 2.9.2**

*[Version française](PRIVACY.fr.md)*

RoNote is a browser extension that shows desktop notifications about your Roblox
trades. It is built to run **entirely on your own computer**.

## In one sentence

**RoNote does not send any of your data to anyone.** There is no RoNote server, no
account to create, no telemetry, no ads, no analytics, and nothing is ever sold or
shared.

## What RoNote reads

While you are signed in to Roblox, RoNote reads, from within your browser:

- **your trades** — inbound, outbound, completed, declined: IDs, dates, status;
- **the items in those trades** — names, IDs, thumbnails, values;
- **the public profile of the other player** — username, display name, avatar;
- **your own username and Roblox ID**, so it knows which account it is looking at;
- **your inventory**, if you use the Portfolio tab.

## Where that data is stored

Only in your browser's **local storage** (`storage.local`), on your machine. In
practice: your settings, trade tracking state, your account value history, and the
event log.

That storage is **local and never synced**: RoNote deliberately avoids
`storage.sync`, so nothing is uploaded to your Google account or to any other device.

To erase everything: uninstall the extension, or use **Reset** in the settings page.
There is no copy anywhere else to delete.

## The only network connections

RoNote contacts exactly two domains, both declared in its manifest:

| Domain | Why | What is sent |
|---|---|---|
| `*.roblox.com` | Read your trades, items, thumbnails and profiles | Nothing beyond the request itself, using the Roblox session already present in your browser |
| `*.rolimons.com` | Download the public item value table | **Nothing about you** — it is a plain download of the public catalogue, identical for every user |

Rolimon's can be **turned off** in the settings. Without it, RoNote falls back to the
RAP reported by Roblox and contacts nothing but Roblox.

**No request goes to any other domain.** There is no server belonging to RoNote's
author.

## How your Roblox session is used

To read *your* trades, RoNote queries the Roblox API reusing the session already open
in your browser — exactly as roblox.com itself does while you browse.

RoNote **does not read, store or transmit your password**. It does not copy your
session cookie either: the cookie stays managed by the browser, which attaches it to
Roblox requests on its own.

## The only action that changes your account

RoNote can **decline** an inbound trade or **cancel** an outbound one, and only on
your explicit click, in two steps, from the detail view.

RoNote **cannot accept a trade**, create one, or counter one. That is deliberate:
those actions transfer items, and a misplaced click would be irreversible. Declining
or cancelling only destroys an offer.

## The permissions requested, and why

| Permission | What it is for |
|---|---|
| `storage` | Keep your settings and tracking state between browser restarts |
| `alarms` | Trigger the periodic trade check |
| `notifications` | Show the desktop notifications — the extension's whole purpose |
| `scripting` | Read the trade shown on screen when the API does not return its detail |
| `offscreen` | Play the alert sound, since a Chrome service worker cannot produce audio |
| `declarativeNetRequestWithHostAccess` | Fix the `Origin` and `Referer` headers on RoNote's own requests to Roblox, which Roblox would otherwise reject. Applies **only to requests issued by the extension** (outside any tab), never to your browsing |
| `*.roblox.com` | The site whose trades RoNote reads |
| `*.rolimons.com` | The public value table |

## Children and minimum age

RoNote collects no data, and therefore transmits none, whatever the user's age.

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
