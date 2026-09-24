/**
 * ==========================================================================
 *  QUOI DE NEUF
 * --------------------------------------------------------------------------
 *  Les nouveautés de chaque version, telles que la page de réglages les
 *  affiche : courtes, du point de vue de l'utilisateur, dans les deux langues.
 *  Le détail complet reste dans CHANGELOG.md.
 *
 *  De la plus récente à la plus ancienne. `version: null` = la version en
 *  préparation : lui donner son numéro au moment de la publier (le test
 *  tools/test-changelog.mjs vérifie que la version du manifeste est là).
 * ==========================================================================
 */

const item = (fr, en) => ({ fr, en });

export const RELEASES = [
  {
    version: '2.15.0',
    title: item('Écarts sur les listes, réglages refaits', 'Differences on the lists, settings redone'),
    items: [
      item("Listes de trades Roblox (Reçus, Envoyés, Terminés) : l'écart de RAP et de Value de chaque trade s'affiche à droite de sa ligne, sans l'ouvrir. La date passe sous le pseudo.",
        "Roblox trade lists (Inbound, Outbound, Completed): each trade's RAP and Value difference shows on the right of its row, without opening it. The date moves under the username."),
      item("Réglages réorganisés en moins de sections, avec une recherche (touche /). Un réglage sans effet, parce qu'il dépend d'un autre qui est coupé, apparaît grisé.",
        'Settings reorganised into fewer sections, with a search box (/ key). A setting that has no effect, because it depends on another one that is off, is greyed out.'),
      item("Nouvelle section Apparence : pour le bandeau, la colonne des listes et le badge « projected », contenu, format, style, taille, couleurs, forme et coin, avec un aperçu en direct.",
        'New Appearance section: content, format, style, size, colours, shape and corner for the banner, the list column and the "projected" badge, with a live preview.'),
      item("Un petit diamant signale les objets que Rolimon's classe « rares », dans le popup et sur les pages de trade Roblox.",
        'A small diamond marks items Rolimon\'s rates as "rare", in the popup and on Roblox trade pages.'),
      item("Page d'un limited sur Roblox : une rangée « Value » sous « Best Price », avec la demande, la tendance et un lien direct vers sa fiche Rolimon's.",
        "A limited's page on Roblox: a \"Value\" row under \"Best Price\", with demand, trend and a direct link to its Rolimon's page."),
      item("Thèmes RoNote (Réglages › Apparence) : RoNote, Minimal, Néon, Sunset, Océan et Casino règlent d'un coup le bandeau, les listes, le badge et le fond de Roblox. Ton thème s'exporte dans un fichier pour le partager.",
        "RoNote themes (Settings › Appearance): RoNote, Minimal, Neon, Sunset, Ocean and Casino set the banner, lists, badge and Roblox background in one go. Your theme can be exported to a file to share it."),
      item("Bilan du mois (onglets Journal et Portefeuille) : value gagnée, taux de victoire, meilleur trade et évolution du compte, sur une carte à copier ou télécharger.",
        'Monthly recap (Journal and Portfolio tabs): value gained, win rate, best trade and account trend, on a card to copy or download.'),
      item("Pile ou face (onglet pièce du popup) : choisis ton jeton, vert R$ ou orange T, et laisse le hasard trancher un trade qui te fait hésiter.",
        "Coin flip (coin tab in the popup): pick your chip, green R$ or orange T, and let luck settle a trade you can't decide on."),
      item("Flex mon inventaire (onglet Portefeuille) : une carte avec la value de ton compte, sa courbe et tes six plus gros objets, calée sur la période et la courbe du graphique.",
        "Flex my inventory (Portfolio tab): a card with your account value, its curve and your six biggest items, matching the chart's period and curve."),
      item("Fonds des cartes Flex : images fournies, fonds animés, ou ton image ou ton GIF. Une carte animée se télécharge en GIF.",
        "Flex card backgrounds: built-in images, animated backgrounds, or your own image or GIF. An animated card downloads as a GIF."),
      item("Objectif (onglet Portefeuille) : une value ou un objet à atteindre, avec ou sans date limite, et le rythme qu'il te faut.",
        "Goal (Portfolio tab): a value or an item to reach, with or without a deadline, and the pace you need."),
      item("Tes sons : importe un fichier audio et choisis-le pour n'importe quelle notification.",
        "Your sounds: import an audio file and use it for any notification."),
      item("Ton image en fond de roblox.com (Réglages › Apparence), avec un voile de la couleur de ton thème pour garder le texte lisible, et un flou au choix.",
        "Your own image as the roblox.com background (Settings › Appearance), with a veil in your theme's colour to keep text readable, and optional blur."),
      item("Lucky Cat de Rolimon's : l'exemplaire tiré (celui qui donne le RoliBadge) porte un chat doré, dans le popup et sur les pages de trade. Le tirage est relu toutes les 10 minutes.",
        "Rolimon's Lucky Cat: the drawn copy (the one that gives the RoliBadge) wears a golden cat, in the popup and on trade pages. The draw is re-read every 10 minutes."),
      item("La cote Rolimon's sous chaque objet peut être masquée, sans couper le bandeau des écarts.",
        "The Rolimon's value under each item can be hidden, without turning off the difference banner."),
      item("Sauvegarde : exporte tes réglages dans un fichier, importe-les ailleurs, ou remets tout par défaut en un clic.",
        'Backup: export your settings to a file, import them elsewhere, or reset everything to default in one click.'),
      item("Un joueur peut être ignoré à la main, par son pseudo ou son identifiant.",
        'A player can be ignored by hand, by username or ID.'),
      item("La taille du journal se règle (100 à 1 000 événements), et l'export CSV contient bien tout le journal, plus seulement les 100 derniers événements.",
        'The journal size can be set (100 to 1,000 events), and the CSV export now holds the whole journal, not just the last 100 events.'),
      item("Les cotes Rolimon's sont relues toutes les 15 minutes au lieu de 3 heures, et une nouvelle table met à jour les onglets Roblox ouverts.",
        "Rolimon's values are read every 15 minutes instead of 3 hours, and a new table updates the open Roblox tabs.")
    ]
  },
  {
    version: '2.14.0',
    title: item("Visages : Rolimon's est à jour", "Faces: Rolimon's is up to date"),
    items: [
      item("Rolimon's compte désormais les visages d'après les bundles réellement possédés : plus de visages fantômes, plus de visages reçus oubliés. La valeur de ton compte est celle de Rolimon's, sans correction.",
        "Rolimon's now counts faces from the bundles actually owned: no more ghost faces, no more forgotten received faces. Your account value is Rolimon's own, with no correction."),
      item("Le panneau « Réconciliation des visages » et le réglage qui l'activait disparaissent, devenus inutiles.",
        'The "Face reconciliation" panel and the setting that turned it on are gone, now that they are no longer needed.'),
      item("Portefeuille et fiche joueur plus légers : deux appels à Rolimon's et plus aucun à Roblox à chaque rafraîchissement, au lieu de jusqu'à dix.",
        "Lighter portfolio and player cards: two calls to Rolimon's and none to Roblox on each refresh, instead of up to ten."),
      item("La fiche d'un joueur liste ses bundles tels que Rolimon's les compte ; l'onglet « Qu'il n'a plus » disparaît.",
        "A player's card lists their bundles as Rolimon's counts them; the \"No longer owned\" tab is gone."),
      item("Les alertes de réévaluation ne dépendent plus que du suivi de la valeur du compte.",
        'Revaluation alerts now only depend on account value tracking.'),
      item("Trade Flex refait : une carte plus nette (rendue en haute définition), les écarts RAP et value côte à côte, les objets projected signalés, et un vrai bouton Copier.",
        'Trade Flex redesigned: a sharper card (rendered in high definition), RAP and value gaps side by side, projected items flagged, and a real Copy button.'),
      item("Trade Flex n'est proposé que sur un trade terminé (onglet Terminés) : plus de carte pour une offre encore en attente ou tombée à l'eau.",
        'Trade Flex is only offered on a completed trade (Completed tab): no more card for an offer still pending or one that fell through.'),
      item("Pages de trade : les boutons Trade Flex, # et Rolimon's ont une place fixe, calée à droite du titre. Ils ne bougent plus et ne disparaissent plus derrière les « … » d'un pseudo long.",
        "Trade pages: the Trade Flex, # and Rolimon's buttons have a fixed place at the right of the title. They no longer move, and no longer vanish behind a long username's \"…\"."),
      item("Pages de trade : les écarts RAP et value ne restent plus grisés jusqu'au rafraîchissement de la page. Une réponse incomplète est redemandée après quelques secondes au lieu d'une minute.",
        'Trade pages: the RAP and value gaps no longer stay grey until the page is refreshed. An incomplete answer is asked again after a few seconds instead of a minute.'),
      item("Pages de trade : la cote Rolimon's sous chaque objet et les totaux sont groupés par milliers, comme les chiffres de Roblox (14 996).",
        "Trade pages: the Rolimon's value under each item and the totals are grouped by thousands, like Roblox's own figures (14,996)."),
      item("Après une mise à jour de l'extension, un onglet Roblox resté ouvert n'accumule plus les erreurs « Extension context invalidated » : l'ancienne copie retire ses éléments et s'arrête. Recharge l'onglet pour retrouver RoNote.",
        'After an extension update, a Roblox tab left open no longer piles up "Extension context invalidated" errors: the old copy removes its elements and stops. Reload the tab to get RoNote back.')
    ]
  },
  {
    version: '2.13.0',
    title: item('Trade Flex personnalisable', 'Customizable Trade Flex'),
    items: [
      item("Carte inspirée des offres Roblox : vignettes, donné et reçu, totaux, et résultat WIN, LOSS ou EVEN selon le RAP ou la value.",
        'A card styled like Roblox offers: thumbnails, given and received, totals, and a WIN, LOSS or EVEN result by RAP or value.'),
      item("Fonds Nuit, Violet ou ta propre image, avec un réglage d'assombrissement. L'image importée reste sur ton ordinateur.",
        'Night, Purple or your own image as background, with a dim slider. The imported image stays on your computer.')
    ]
  },
  {
    version: '2.12.1',
    title: item('Trade Flex', 'Trade Flex'),
    items: [
      item("Un bouton trophée sur la page d'un trade en fait une image PNG à partager, copiable par clic droit ou téléchargeable. Pseudos et serials n'y figurent pas.",
        "A trophy button on a trade page turns it into a PNG image to share, copied with a right-click or downloaded. Names and serials are left out.")
    ]
  },
  {
    version: '2.12.0',
    title: item('Pages de trade refaites', 'Redesigned trade pages'),
    items: [
      item("Nouveaux bandeaux RAP et value entre les deux offres, et la cote Rolimon's sous chaque objet avec un total par offre.",
        "New RAP and value banners between the two offers, and Rolimon's value under each item with a total per offer."),
      item("Un raccourci vers le profil Rolimon's de l'autre joueur, et un bouton « # » pour flouter les serials.",
        "A shortcut to the other player's Rolimon's profile, and a # button to blur serial numbers.")
    ]
  },
  {
    version: '2.11.1',
    title: item('Limites de debit et confirmation de refus', 'Rate limits and decline confirmation'),
    items: [
      item("Corrige : le refus en deux clics depuis une carte pouvait ne jamais partir. Un rafraichissement de fond remettait le bouton au repos, et le second clic ne faisait que le rearmer.",
        'Fixed: the two-click decline on a card could never go through. A background refresh reset the button, so the second click only re-armed it.'),
      item("Les trades suivis qui ne sont plus dans les 100 derniers envois apparaissent enfin, en bas de l'onglet Envoyes : avec leur partenaire, depuis quand ils sont suivis, et de quoi les retirer un par un ou tous d'un coup. Le compteur en annoncait sans que rien ne les montre.",
        "Tracked trades that are no longer among the last 100 outbound ones finally show up, at the bottom of the Outbound tab: with their partner, how long they have been tracked, and a way to remove them one by one or all at once. The counter used to include them with nothing on screen."),
      item("Un suivi pose automatiquement s'abandonne au bout d'une semaine, au lieu d'un mois — une epingle posee a la main garde son mois.",
        'A trade tracked automatically is dropped after a week instead of a month — a pin you placed yourself keeps its month.'),
      item("Les courbes de l'accueil et du portefeuille se terminent sur le dernier releve de RoNote, au lieu de s'arreter au dernier scan de Rolimon's : elles ne retardent plus sur le solde affiche juste au-dessus.",
        "The Home and Portfolio curves now end on RoNote's latest reading instead of stopping at Rolimon's last scan: they no longer lag behind the balance shown right above them."),
      item("Corrige la cause principale des « HTTP 429 » : les trades suivis tombes hors de la liste des 100 derniers envois etaient redemandes a chaque verification, sans fin. Un meme trade suivi n'est plus redemande avant dix minutes, et son issue arrive le plus souvent sans aucun appel.",
        'Fixed the main cause of "HTTP 429" errors: tracked trades that fell outside the list of the last 100 outbound trades were re-fetched on every check, endlessly. The same tracked trade is no longer re-fetched within ten minutes, and its outcome usually arrives without any call at all.'),
      item("RoNote se tient sous un plafond de requetes par minute, et l'ajuste tout seul : chaque refus le divise par deux, il remonte apres dix minutes sans refus.",
        'RoNote now keeps under a requests-per-minute ceiling and tunes it by itself: every refusal halves it, and it climbs back after ten minutes without one.'),
      item("Une seule porte de sortie : au plus 5 requetes Roblox et 3 Rolimon's a la fois, toutes origines confondues. Une limite de debit met en pause tout ce qui parle a ce service, et le message dit lequel des deux limite.",
        "A single way out: at most 5 Roblox and 3 Rolimon's requests at a time, from every source combined. A rate limit now pauses everything talking to that service, and the message says which of the two is limiting."),
      item("Beaucoup moins d'erreurs « HTTP 429 » : RoNote provoquait lui-meme la limite de debit de Roblox en reprenant les vignettes une par une. Le message dit maintenant ce qui se passe et pour combien de temps, et « verifier maintenant » n'aggrave plus la pause.",
        "Far fewer 'HTTP 429' errors: RoNote was triggering Roblox's rate limit itself by retrying thumbnails one by one. The message now says what is happening and for how long, and 'check now' no longer makes the pause worse."),
      item('Les listes ne clignotent plus pendant le chargement : une carte evaluee remplace sa silhouette sans redessiner tout le reste.',
        'Lists no longer flicker while loading: an evaluated card replaces its placeholder without redrawing everything else.'),
      item("Survol des courbes plus fluide, et la fiche d'un joueur ne se reconstruit plus trois fois a l'ouverture.",
        'Smoother curve hovering, and a player card no longer rebuilds three times when it opens.'),
      item("Au clavier : les fleches parcourent les onglets, et les fiches gardent le focus tant qu'elles sont ouvertes.",
        'Keyboard: arrow keys move through the tabs, and open cards keep the focus while they are open.'),
      item("Reglages : quand l'extension ne repond pas, la page le dit au lieu de rester figee.",
        "Settings: when the extension does not answer, the page says so instead of freezing.")
    ]
  },
  {
    version: '2.11.0',
    title: item('Accueil, portefeuille refait et fiche joueur', 'Home, redesigned portfolio and player cards'),
    items: [
      item("Nouvel onglet Accueil : le résumé du jour dès l'ouverture — ton portefeuille, l'activité du jour et ce qui attend une action.",
        "New Home tab: today's summary as soon as you open RoNote — your portfolio, today's activity and what needs your attention."),
      item("L'onglet Bénéfice devient Portefeuille : solde en grand, courbes value, RAP et collectibles superposables, et la liste de tes collectibles avec recherche, tri et filtres.",
        'The Profit tab becomes Portfolio: big balance, stackable value, RAP and collectibles curves, and your collectibles list with search, sort and filters.'),
      item('Chaque objet a sa fiche, avec sa propre courbe et ses révisions de cote.',
        'Every item has its own card, with its own curve and value revisions.'),
      item("Un clic sur l'avatar d'un joueur ouvre sa fiche à côté du popup : son inventaire et sa courbe, l'âge de son compte, ce que ses offres te rapportent, ses bundles et ceux qu'il n'a plus.",
        "Clicking a player's avatar opens their card beside the popup: their inventory and its curve, account age, what their offers earn you, their bundles and the ones they no longer own."),
      item('Tous les onglets et la page de réglages refaits dans le même style, avec des icônes dessinées pour RoNote à la place des emojis.',
        'Every tab and the settings page redesigned in the same style, with icons drawn for RoNote instead of emojis.'),
      item("Les onglets s'ouvrent plus vite : un trade déjà vu n'est plus redemandé à Roblox.",
        'Tabs open faster: a trade already seen is no longer fetched again from Roblox.'),
      item('Reçus, Envoyés et Terminés ne s’arrêtent plus aux 25 derniers trades : la suite se charge en faisant défiler la liste.',
        'Inbound, Outbound and Completed no longer stop at the last 25 trades: older ones load as you scroll.'),
      item("Plus léger en arrière-plan : beaucoup moins d'appels à Roblox et Rolimon's. Corrigé : un clic sur une notification pouvait ne rien ouvrir.",
        "Lighter in the background: far fewer calls to Roblox and Rolimon's. Fixed: clicking a notification could open nothing."),
      item('Cette liste des nouveautés, dans les réglages.', 'This list of what is new, in the settings.')
    ]
  },
  {
    version: '2.10.0',
    title: item('Alertes de trades reçus réparées', 'Inbound trade alerts fixed'),
    items: [
      item("Corrigé : la plupart des trades reçus ne déclenchaient plus d'alerte, parce que Roblox ne numérote pas ses trades dans l'ordre.",
        "Fixed: most inbound trades no longer triggered an alert, because Roblox doesn't number its trades in order."),
      item("Nouveau : une alerte quand la cote d'un objet de ton inventaire bouge d'au moins 10 % (seuil réglable).",
        'New: an alert when the value of an item in your inventory moves by at least 10% (adjustable).'),
      item('Firefox : prêt pour addons.mozilla.org.', 'Firefox: ready for addons.mozilla.org.'),
      item("L'export CSV du journal inclut les réévaluations.", 'The log CSV export includes revaluations.')
    ]
  },
  {
    version: '2.9.2',
    date: '2026-09-09',
    title: item("Le nom de l'extension suit la langue du navigateur", 'Extension name follows the browser language'),
    items: [
      item('Nom et description en français dans un navigateur en français, en anglais partout ailleurs.',
        'Name and description in French in a French browser, in English everywhere else.')
    ]
  },
  {
    version: '2.9.1',
    date: '2026-09-09',
    title: item('Correctif de sécurité', 'Security fix'),
    items: [
      item("Le jeton CSRF de Roblox n'est plus transmis qu'à la page Roblox elle-même.",
        "Roblox's CSRF token is now only passed to the Roblox page itself.")
    ]
  },
  {
    version: '2.9.0',
    date: '2026-09-08',
    title: item('Le son ne se perd plus', 'Sound no longer gets lost'),
    items: [
      item("Le son d'alerte ne manque plus une fois sur deux.", 'The alert sound no longer fails every other time.'),
      item('Une vérification bloquée ne fige plus RoNote jusqu\'au redémarrage du navigateur.',
        'A stuck check no longer freezes RoNote until the browser restarts.'),
      item("Un son par type d'événement, à écouter depuis les réglages, et deux nouvelles sonneries.",
        'One sound per event type, previewable from the settings, and two new ringtones.'),
      item('« Ton trade a été accepté » quand un trade que tu as envoyé aboutit.',
        '“Your trade was accepted” when a trade you sent goes through.')
    ]
  },
  {
    version: '2.8.0',
    title: item('Plus rien sur la page Roblox', 'Nothing added to the Roblox page anymore'),
    items: [
      item('Les ajouts sur la page des trades Roblox sont retirés : tout se passe dans le popup et les notifications.',
        'The additions on the Roblox trades page are removed: everything happens in the popup and notifications.')
    ]
  },
  {
    version: '2.7.2',
    title: item('La page Roblox ne rame plus', 'The Roblox page no longer lags'),
    items: [
      item('Fini les ralentissements de la page Roblox causés par RoNote.', 'No more slowdowns of the Roblox page caused by RoNote.')
    ]
  },
  {
    version: '2.7.1',
    title: item('Étiquettes en double corrigées', 'Duplicate labels fixed'),
    items: [
      item('Plus d\'étiquettes « projected » en double quand la page se redessine.',
        'No more duplicated “projected” labels when the page redraws.')
    ]
  },
  {
    version: '2.7.0',
    title: item('Le gain pendant la composition', 'Gain while building a trade'),
    items: [
      item("L'écart se calcule pendant que tu composes un trade, avant même de l'envoyer.",
        'The gain is computed while you build a trade, before you even send it.'),
      item('Les nombres s\'écrivent comme sur Roblox : 1,836,950.', 'Numbers are written the way Roblox does: 1,836,950.'),
      item('Refuser ou annuler un trade en deux clics, depuis la liste.', 'Decline or cancel a trade in two clicks, from the list.')
    ]
  },
  {
    version: '2.6.0',
    title: item('Le verdict sur la liste des trades', 'Verdict on the trade list'),
    items: [
      item('Chaque ligne de la liste des trades affiche son verdict.', 'Every row of the trade list shows its verdict.'),
      item('Une fiche au survol de chaque cote : value, RAP, demande, tendance.',
        'A hover card on every value: value, RAP, demand, trend.')
    ]
  },
  {
    version: '2.5.0',
    title: item('Le journal en direct', 'Live log'),
    items: [
      item('Le journal se met à jour en même temps que la notification.', 'The log updates at the same time as the notification.'),
      item('Plus aucun panneau flottant sur la page Roblox.', 'No more floating panels on the Roblox page.')
    ]
  },
  {
    version: '2.4.3',
    title: item('Le gain affiché sur la page Roblox', 'Gain shown on the Roblox page'),
    items: [
      item('Le gain ou la perte entre les deux listes du trade, et la value sous chaque objet.',
        'The gain or loss between the two sides of the trade, and the value under every item.'),
      item("Corrections d'alignement et des visages non reconnus (2.4.1 à 2.4.3).",
        'Alignment fixes and unrecognized faces fixed (2.4.1 to 2.4.3).')
    ]
  },
  {
    version: '2.2.0',
    title: item('Zoom sur un trade', 'Trade zoom'),
    items: [
      item('Un clic sur une carte ouvre le trade en grand.', 'Clicking a card opens the trade in full.'),
      item("Refuser ou annuler un trade depuis l'extension.", 'Decline or cancel a trade from the extension.'),
      item('Interface en français et en anglais.', 'Interface in French and English.')
    ]
  },
  {
    version: '2.1.0',
    title: item('Les visages enfin reconnus', 'Faces finally recognized'),
    items: [
      item('Les trades contenant des visages s\'affichent, avec leurs vraies images.',
        'Trades with faces are displayed, with their real images.'),
      item('Ta valeur réelle : les visages passés en bundles sont corrigés.',
        'Your real value: faces converted to bundles are corrected.'),
      item('Les Robux sont comptés nets des 30 % de taxe.', 'Robux are counted net of the 30% tax.')
    ]
  }
];
