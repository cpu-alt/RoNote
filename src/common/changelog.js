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
    version: null,
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
