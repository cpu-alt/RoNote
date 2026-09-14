/**
 * ==========================================================================
 *  LES LANGUES
 * --------------------------------------------------------------------------
 *  Le francais est la langue SOURCE : le code, les commentaires et les
 *  gabarits HTML restent lisibles tels quels, et le dictionnaire traduit
 *  depuis la phrase francaise plutot que depuis une cle abstraite.
 *
 *      t('Vous donnez')                    -> "You give"
 *      t('Détail des {n} objets', {n: 5})  -> "5 items in detail"
 *
 *  Pourquoi pas des cles (`card.youGive`) : parce qu'une cle absente du
 *  dictionnaire affiche la cle, donc un texte cassé. Ici, une phrase non
 *  traduite retombe sur le francais — degrade, mais jamais illisible. Et on
 *  peut lire le code sans faire l'aller-retour avec le dictionnaire.
 *
 *  Les pages ecrites en dur (popup.html, options.html) n'ont aucune balise a
 *  annoter : `translateDom` parcourt les textes et les infobulles et remplace
 *  ce qu'il reconnait. Ajouter une langue, c'est ajouter une colonne.
 *
 *  Consequence a garder en tete : les chaines stockees (verdicts, libelles de
 *  statut, journal) le sont EN FRANCAIS, et sont traduites au moment de
 *  l'affichage. Le service worker et le popup peuvent ainsi diverger de langue
 *  sans que rien ne se desynchronise.
 * ==========================================================================
 */

export const LANGS = { fr: 'Français', en: 'English' };
const LOCALES = { fr: 'fr-FR', en: 'en-US' };

/* ------------------------------ dictionnaire ---------------------------- */

const EN = {
  /* --- entête, état ---------------------------------------------------- */
  'Non connecté': 'Not signed in',
  'Injoignable': 'Unreachable',
  "l'extension n'a pas répondu — recharge la page": 'the extension did not answer — reload the page',
  'Trop de requêtes : {who} nous met en pause {n} s.': 'Too many requests: {who} is holding us for {n}s.',
  'Chargement…': 'Loading…',
  'Initialisation…': 'Initialising…',
  'Surveillance en pause': 'Monitoring paused',
  'Actif · vérifié {ago}': 'Active · checked {ago}',
  'Première vérification en cours…': 'Running the first check…',
  '{n} cotes · {ago}': '{n} values · {ago}',
  'cotes {ago}': 'values {ago}',
  'Activer / mettre en pause': 'Enable / pause',
  'Vérifier maintenant': 'Check now',
  'Réglages': 'Settings',
  'Mes trades': 'My trades',
  '{n} trade suivi': '{n} tracked trade',
  '{n} trades suivis': '{n} tracked trades',

  /* --- onglets --------------------------------------------------------- */
  'Reçus': 'Inbound',
  'Envoyés': 'Outbound',
  'Terminés': 'Completed',
  'Portefeuille': 'Portfolio',
  'Journal': 'Log',

  /* --- carte de trade -------------------------------------------------- */
  'Vous donnez': 'You give',
  'Vous recevez': 'You receive',
  'Vous demandez': 'You ask for',
  'Joueur': 'Player',
  'Détail des {n} objets': '{n} items in detail',
  'Masquer le détail': 'Hide details',
  '+{n} sans cote': '+{n} unvalued',
  'non calculable': 'not computable',
  '{n} objet sans cote': '{n} item with no value',
  '{n} objets sans cote': '{n} items with no value',
  'Objet sans cote': 'Item with no value',
  'net de 30 %': 'net of 30% tax',
  'Évaluation impossible — {why}': 'Could not evaluate — {why}',
  'Réessayer': 'Retry',
  'contre-offre sur le trade #{id}': 'counter-offer to trade #{id}',
  'réponse au trade #{id}': 'reply to trade #{id}',
  '· {n}ᵉ échange': '· exchange #{n}',
  'Suivre ce trade (alerte si accepté, refusé ou contré)':
    'Track this trade (alert when accepted, declined or countered)',
  'Ne plus suivre ce trade': 'Stop tracking this trade',
  'filtré : {why}': 'filtered out: {why}',
  '{a} reçu vs {b} donné': '{a} received vs {b} given',
  '{n} objet(s) sans cote': '{n} item(s) with no value',

  /* --- verdicts -------------------------------------------------------- */
  'Excellent': 'Excellent',
  'Bon gain': 'Good win',
  'Gain': 'Win',
  'Équilibré': 'Even',
  'Perte': 'Loss',
  'Mauvais': 'Bad',
  'Très mauvais': 'Very bad',

  /* --- statuts --------------------------------------------------------- */
  'En attente': 'Pending',
  'En cours': 'Processing',
  'Accepté': 'Accepted',
  'Refusé': 'Declined',
  'Contré': 'Countered',
  'Expiré': 'Expired',
  'Rejeté (erreur)': 'Rejected (error)',
  'Intervention Roblox': 'Roblox intervention',

  /* --- pastilles ------------------------------------------------------- */
  'Value {a} vs RAP {b}': 'Value {a} vs RAP {b}',
  "La cote communautaire et les ventes réelles ne vont pas dans le même sens : trancher reviendrait à parier sur l'une des deux.":
    'The community value and real sales disagree: picking one would be a bet on that one.',
  'Spéculatif': 'Speculative',
  "Cote très au-dessus des ventes réelles : elle repose sur l'avis de la communauté, pas sur des transactions.":
    'Value far above real sales: it rests on community opinion, not on transactions.',
  '{n} visage': '{n} face',
  '{n} visages': '{n} faces',
  'Projected': 'Projected',
  'Le RAP de cet objet a été gonflé par des rachats entre complices : s\'y fier est le piège classique.':
    "This item's RAP was inflated by wash trading: trusting it is the classic trap.",
  '−{n} R$ de taxe': '−{n} R$ tax',
  'Roblox prélève 30 % sur les Robux reçus dans un trade. Le total ci-dessus compte le net.':
    'Roblox takes 30% of the Robux received in a trade. The total above counts the net amount.',
  'Cotes non actualisées': 'Values not refreshed',
  "La table Rolimon's n'a pas pu être rafraîchie : les cotes affichées peuvent avoir été révisées depuis.":
    "Rolimon's table could not be refreshed: the values shown may have been revised since.",

  /* --- infobulle d'un objet -------------------------------------------- */
  'aucune cote — visage récent, objet de bundle ou nouveauté':
    'no value — recent face, bundle item or brand-new item',
  'Value {v}': 'Value {v}',
  '(RAP faute de cote)': '(RAP, for lack of a value)',
  'RAP {v}': 'RAP {v}',
  'Value = {n}× le RAP': 'Value = {n}× the RAP',
  'visage (bundle DynamicHead)': 'face (DynamicHead bundle)',
  'bundle #{id}': 'bundle #{id}',
  'Demande : {v}': 'Demand: {v}',
  'Tendance : {v}': 'Trend: {v}',
  'RARE': 'RARE',
  'cote spéculative : très au-dessus des ventes réelles':
    'speculative value: far above real sales',
  'cote révisée : {from} → {to} ({pct})': 'value revised: {from} → {to} ({pct})',
  'PROJECTED — RAP gonflé artificiellement': 'PROJECTED — artificially inflated RAP',
  'en attente (hold Roblox)': 'on hold (Roblox)',
  'sans cote': 'no value',
  'visage': 'face',
  'bundle': 'bundle',
  'projected': 'projected',
  'rare': 'rare',
  'demande {v}': 'demand {v}',
  'pas de value': 'no value',

  /* --- demande / tendance ---------------------------------------------- */
  'Terrible': 'Terrible',
  'Faible': 'Low',
  'Normale': 'Normal',
  'Bonne': 'Good',
  'Élevée': 'High',
  'Très élevée': 'Amazing',
  'En baisse': 'Lowering',
  'Instable': 'Unstable',
  'Stable': 'Stable',
  'En hausse': 'Raising',
  'Fluctuante': 'Fluctuating',

  /* --- listes vides ---------------------------------------------------- */
  'Aucun trade en attente': 'No pending trade',
  'Vous serez notifié dès qu\'un nouveau trade arrive.':
    "You'll be notified as soon as a new trade arrives.",
  'Aucun trade envoyé': 'No outgoing trade',
  "Vos propositions apparaîtront ici. Épinglez-en une ({pin}) pour être averti dès qu'elle est acceptée, refusée ou contrée.":
    'Your offers show up here. Pin one ({pin}) to be alerted as soon as it is accepted, declined or countered.',
  'Aucun trade terminé récemment': 'No recently completed trade',
  'Journal vide': 'Empty log',
  'Chaque événement détecté (notifié ou filtré) apparaîtra ici.':
    'Every detected event (notified or filtered out) shows up here.',

  /* --- zoom sur un trade ----------------------------------------------- */
  'Fermer': 'Close',
  'Ouvrir sur Roblox': 'Open on Roblox',
  'Annuler le trade': 'Cancel trade',
  'Refuser le trade': 'Decline trade',
  'Confirmer l\'annulation': 'Confirm cancellation',
  'Confirmer le refus': 'Confirm decline',
  'Annulation…': 'Cancelling…',
  'Trade refusé': 'Trade declined',
  'Échec : {why}': 'Failed: {why}',
  'Total': 'Total',
  'Écart': 'Difference',
  'Reçu': 'Received',
  'Expire {ago}': 'Expires {ago}',
  'Cliquer une seconde fois pour confirmer. Action définitive côté Roblox.':
    'Click again to confirm. This is final on Roblox.',

  /* --- onglet Portefeuille ---------------------------------------------- */
  'Value réelle': 'Real value',
  'RAP du compte': 'Account RAP',
  'Afficher les montants': 'Show amounts',
  'Masquer les montants': 'Hide amounts',
  'Réévalué · 7 j': 'Revalued · 7 d',
  "Effet des réévaluations Rolimon's des 7 derniers jours sur tes objets":
    "Effect of Rolimon's revaluations over the last 7 days on your items",
  'Répartition': 'Allocation',
  'top 5 · par value': 'top 5 · by value',
  'Autres ({n})': 'Others ({n})',
  'Mes collectibles': 'My collectibles',
  'Rechercher un objet': 'Search an item',
  'Trier': 'Sort',
  'Vue liste': 'List view',
  'Vue galerie': 'Gallery view',
  'Plus grosse value': 'Highest value',
  'Plus gros RAP': 'Highest RAP',
  'Réévaluation 7 j': 'Revaluation 7 d',
  'Quantité': 'Quantity',
  'Nom (A → Z)': 'Name (A → Z)',
  'Tous': 'All',
  'Visages': 'Faces',
  'Rares': 'Rare',
  'Projetés': 'Projected',
  'Réévalués': 'Revalued',
  "+ {n} objet que Rolimon's ne cote pas publiquement": "+ {n} item Rolimon's doesn't value publicly",
  "+ {n} objets que Rolimon's ne cote pas publiquement": "+ {n} items Rolimon's doesn't value publicly",
  'Aucun objet ne correspond à « {q} ».': 'No item matches “{q}”.',
  'Aucun objet dans cette catégorie.': 'No item in this category.',
  'Chargement de tes objets…': 'Loading your items…',
  'Liste des objets indisponible — {why}.': 'Item list unavailable — {why}.',
  '{n} exemplaires × {v}': '{n} copies × {v}',
  '1 exemplaire': '1 copy',
  '{p} de tes objets cotés': '{p} of your valued items',
  'Réévalué {ago} : {from} → {to} ({pct})': 'Revalued {ago}: {from} → {to} ({pct})',
  'calculé {ago}': 'computed {ago}',
  'Collectibles': 'Collectibles',
  'Nombre de collectibles': 'Collectibles count',
  'Meilleur prix': 'Best price',
  'en % depuis le début de la période': 'as % since the start of the period',
  "Rolimon's ne publie pas d'historique pour ce bundle.": "Rolimon's publishes no history for this bundle.",
  'Historique indisponible — {why}.': 'History unavailable — {why}.',
  'réponse vide': 'empty response',
  "Rolimon's est désactivé dans les réglages": "Rolimon's is turned off in the settings",

  /* --- listes, cartes et journal (refonte) ------------------------------ */
  'suivi': 'tracked',
  'Terminés récemment': 'Recently completed',
  'Voir les trades plus anciens': 'Show older trades',
  'Suite indisponible : {why}': 'Could not load more: {why}',
  'Tu es au bout de la liste.': "You've reached the end of the list.",
  'Recharge RoNote dans chrome://extensions.': 'Reload RoNote in chrome://extensions.',
  'Bilan': 'Net',
  'Meilleur': 'Best',
  'Suivis': 'Tracked',
  'pour être prévenu': 'to get alerted',
  '{n} gagnant': '{n} winning',
  '{n} gagnants': '{n} winning',
  '{n} perdant': '{n} losing',
  '{n} perdants': '{n} losing',
  '{n} sans cote': '{n} unvalued',
  'Évaluation…': 'Evaluating…',
  'Gagnants': 'Winning',
  'Perdants': 'Losing',
  'Sans cote': 'Unvalued',
  'Aucun trade dans cette catégorie.': 'No trade in this category.',
  'Refusé ou annulé depuis RoNote': 'Declined or cancelled from RoNote',
  'Réévaluations': 'Revaluations',
  'Filtrés': 'Filtered',
  "Aujourd'hui": 'Today',
  'Hier': 'Yesterday',
  '{n} filtrée': '{n} filtered',
  '{n} filtrées': '{n} filtered',
  '{n} réévaluation': '{n} revaluation',
  '{n} réévaluations': '{n} revaluations',
  '{n} trade terminé': '{n} completed trade',
  '{n} trades terminés': '{n} completed trades',
  'Alertes · 24 h': 'Alerts · 24 h',
  'Aucun événement dans cette catégorie.': 'No event in this category.',
  'Détail indisponible pour ce trade.': 'Details unavailable for this trade.',
  'Rang': 'Rank',
  'Objets': 'Items',
  'sur {p}': 'over {p}',
  'tout l\'historique': 'all of the history',
  'Rolimon\'s affiche {v} — RoNote corrige de {d} pour les visages passés en bundles.':
    "Rolimon's shows {v} — RoNote corrects it by {d} for faces turned into bundles.",
  'Tout': 'All',
  '1s': '1w',
  '1a': '1y',
  'Pas encore assez de points sur cette période.': 'Not enough data points over this period yet.',
  'Courbe telle que Rolimon\'s la publie (une mesure par jour). Le chiffre du haut, lui, est celui de maintenant, corrigé.':
    "The curve is exactly what Rolimon's publishes (one reading a day). The figure at the top is the current one, corrected.",
  "Voir sur Rolimon's": "View on Rolimon's",
  'Réconciliation des visages': 'Face reconciliation',
  '{n} écart': '{n} discrepancy',
  '{n} écarts': '{n} discrepancies',
  'Retiré': 'Removed',
  'Ajouté': 'Added',
  '{n} visage fantôme': '{n} ghost face',
  '{n} visages fantômes': '{n} ghost faces',
  '{n} visage possédé': '{n} owned face',
  '{n} visages possédés': '{n} owned faces',
  "compté par Rolimon's, plus dans ton inventaire": "counted by Rolimon's, no longer in your inventory",
  "dans ton inventaire, ignoré par Rolimon's": "in your inventory, ignored by Rolimon's",
  "Rien à corriger : ce que Rolimon's compte correspond exactement aux bundles que tu possèdes.":
    "Nothing to correct: what Rolimon's counts matches exactly the bundles you own.",
  'Correction indisponible — {why}.': 'Correction unavailable — {why}.',
  'sources incomplètes': 'incomplete sources',
  "Roblox a converti les visages en <b>bundles</b>. Un visage échangé laisse son ancien exemplaire dans l'inventaire — Rolimon's continue de le compter. Un visage reçu arrive en bundle — Rolimon's ne le voit pas. RoNote compare, visage par visage, ce que Rolimon's compte et les bundles que tu possèdes réellement.":
    "Roblox turned faces into <b>bundles</b>. A traded-away face leaves its old copy in your inventory — Rolimon's keeps counting it. A received face arrives as a bundle — Rolimon's never sees it. RoNote compares, face by face, what Rolimon's counts against the bundles you actually own.",
  'Recalculer maintenant': 'Recalculate now',
  'Calcul…': 'Computing…',
  'Inventaire privé': 'Private inventory',
  "Rolimon's ne publie ni value ni RAP pour un inventaire privé. Passe-le en public sur ton profil Roblox pour activer le suivi.":
    "Rolimon's publishes neither value nor RAP for a private inventory. Make yours public in your Roblox profile to enable tracking.",
  "Chargement du profil Rolimon's": "Loading the Rolimon's profile",
  'Les chiffres arrivent à la prochaine vérification.': 'The figures arrive on the next check.',

  /* --- durées ---------------------------------------------------------- */
  'il y a {n}s': '{n}s ago',
  'il y a {n} min': '{n} min ago',
  'il y a {n} h': '{n} h ago',
  'il y a {n} j': '{n} d ago',
  'dans {n} min': 'in {n} min',
  'dans {n} h': 'in {n} h',
  'dans {n} j': 'in {n} d',

  /* --- notifications --------------------------------------------------- */
  'Nouveau trade reçu': 'New trade received',
  'Contre-offre reçue': 'Counter-offer received',
  'Trade complété': 'Trade completed',
  'Ton trade a été accepté': 'Your trade was accepted',
  'Ton trade a été refusé': 'Your trade was declined',
  'Ton trade a été contré': 'Your trade was countered',
  'Ton trade a expiré': 'Your trade expired',
  'Trade rejeté (erreur Roblox)': 'Trade rejected (Roblox error)',
  'Il donne': 'They give',
  'Tu as reçu': 'You received',
  'Tu as donné': 'You gave',
  'Trade #{id} avec {who}': 'Trade #{id} with {who}',
  '↩ En réponse à ton trade #{id}': '↩ In reply to your trade #{id}',
  '↩ {n}ᵉ contre-offre de la négociation (trade #{id})':
    '↩ Counter-offer #{n} in this negotiation (trade #{id})',
  'total incomplet · connu : reçu {a} vs donné {b}':
    'incomplete total · known: received {a} vs given {b}',
  'Ouvrir le trade': 'Open trade',
  'Ignorer {who}': 'Ignore {who}',
  '{n} événements': '{n} events',
  '{n} × « {what} » depuis la dernière vérification.':
    '{n} × “{what}” since the last check.',
  'Joueur inconnu': 'Unknown player',
  'Utilisateur ignoré': 'User ignored',
  '{who} ne déclenchera plus d\'alerte.': '{who} will no longer trigger an alert.',
  'RoNote est installé': 'RoNote is installed',
  'Ouvre roblox.com et connecte-toi : la surveillance démarre toute seule. Les trades déjà présents ne déclencheront aucune alerte.':
    'Open roblox.com and sign in: monitoring starts on its own. Trades already there will not trigger any alert.',
  'RoNote : connexion requise': 'RoNote: sign-in required',
  'Connecte-toi sur roblox.com dans ce navigateur, puis ouvre un onglet Roblox. La surveillance reprendra automatiquement.':
    'Sign in to roblox.com in this browser, then open a Roblox tab. Monitoring resumes automatically.',
  'Notification de test': 'Test notification',
  "Voilà à quoi ressemblera une alerte de trade. Son et affichage OK !":
    'This is what a trade alert looks like. Sound and display are working!',
  'Non connecté à Roblox (cookie de session introuvable).':
    'Not signed in to Roblox (session cookie not found).',

  'Un de tes objets a été réévalué': 'One of your items was revalued',
  '{n} de tes objets ont été réévalués': '{n} of your items were revalued',
  '+{n} autres': '+{n} more',
  'Impact sur ton compte : {v}': 'Impact on your account: {v}',
  'cote {a} → {b} · impact {c}': 'value {a} → {b} · impact {c}',

  /* --- issues d'un trade envoyé ----------------------------------------- */
  'Trade accepté': 'Trade accepted',
  'Trade refusé': 'Trade declined',
  'Trade contré': 'Trade countered',
  'Trade expiré': 'Trade expired',
  'Rejeté suite à une erreur': 'Rejected after an error',
  'Bloqué (intervention Roblox)': 'Blocked (Roblox intervention)',
  '· trade envoyé': '· outgoing trade',
  '· trade reçu': '· incoming trade',
  'cote révisée': 'value revised',
  'refusé depuis RoNote': 'declined from RoNote',
  'annulé depuis RoNote': 'cancelled from RoNote',

  /* --- page de réglages et diagnostic ------------------------------------ */
  'bundles': 'bundles',
  "Extension locale : aucune donnée n'est envoyée ailleurs que vers les API publiques de Roblox et Rolimon's.":
    "Local extension: no data goes anywhere except the public Roblox and Rolimon's APIs.",
  'Surveillance': 'Monitoring',
  'Suivi des envois': 'Outgoing tracking',
  'Diagnostic': 'Diagnostics',
  'Alertes de trades Roblox — déduplication par identifiant de trade.': 'Roblox trade alerts — deduplicated by trade id.',
  'Enregistré': 'Saved',
  'Général': 'General',
  'Langue': 'Language',
  'Automatique (langue du navigateur)': 'Automatic (browser language)',
  'S\'applique au popup, aux réglages et aux notifications.': 'Applies to the popup, the settings and the notifications.',
  'Surveillance active': 'Monitoring on',
  'Coupe complètement les vérifications quand c\'est décoché.': 'Unchecking this stops every check entirely.',
  'Intervalle de vérification': 'Check interval',
  '30 s est le minimum garanti par le navigateur. En dessous, la cadence est « au mieux » tant que le navigateur garde l\'extension éveillée.': '30 s is the minimum the browser guarantees. Below that the pace is best-effort, for as long as the browser keeps the extension awake.',
  '10 secondes (best effort)': '10 seconds (best effort)',
  '15 secondes (best effort)': '15 seconds (best effort)',
  '30 secondes (recommandé)': '30 seconds (recommended)',
  '1 minute': '1 minute',
  '2 minutes': '2 minutes',
  '5 minutes': '5 minutes',
  'Ce que je veux surveiller': 'What to watch',
  'Trades reçus': 'Inbound trades',
  'Onglet « Inbound » — le cas principal, contre-offres comprises.': '“Inbound” tab — the main case, counter-offers included.',
  'Trades complétés': 'Completed trades',
  'Onglet « Completed » — confirmation qu\'un échange est passé.': '“Completed” tab — confirmation that a trade went through.',
  'Mes trades envoyés': 'My outgoing trades',
  'Onglet « Outbound » — nécessaire pour le suivi ci-dessous et pour reconnaître les contre-offres.': '“Outbound” tab — required for the tracking below and to recognise counter-offers.',
  '« Rejected due to an error »': '“Rejected due to an error”',
  'Onglet « Inactive » — trades annulés par une erreur Roblox, dans les deux sens.': '“Inactive” tab — trades cancelled by a Roblox error, in both directions.',
  'Suivi des trades envoyés': 'Tracking outgoing trades',
  'Un trade suivi vous prévient dès qu\'il change d\'état : accepté, refusé, contré, expiré. Épinglez-en un depuis l\'onglet': 'A tracked trade warns you as soon as it changes state: accepted, declined, countered, expired. Pin one from the',
  'du popup (': 'tab in the popup (',
  '), ou laissez RoNote le faire automatiquement.': '), or let RoNote do it for you.',
  'Suivre automatiquement mes contre-offres': 'Auto-track my counter-offers',
  'Quand vous contrez un trade, votre proposition est suivie et vous êtes averti s\'il la re-contre.': 'When you counter a trade, your offer is tracked and you are alerted if they counter back.',
  'Suivre automatiquement tous mes envois': 'Auto-track all my outgoing trades',
  'Sinon, seuls les trades épinglés à la main (et vos contre-offres) sont suivis.': 'Otherwise only hand-pinned trades (and your counter-offers) are tracked.',
  'Alerter aussi pour les envois non suivis': 'Alert for untracked outgoing trades too',
  'Utile si vous envoyez beaucoup de trades sans vouloir les épingler un par un.': 'Useful if you send many trades and would rather not pin each one.',
  'Événements à notifier': 'Events to notify',
  'S\'applique au suivi automatique. Un trade épinglé à la main notifie toujours.': 'Applies to auto-tracking. A hand-pinned trade always notifies.',
  'Fenêtre de rattachement d\'une contre-offre': 'Counter-offer matching window',
  'Délai maximum entre « il a contré » et l\'arrivée de sa contre-offre pour les relier. En minutes.': 'Maximum delay between “they countered” and their counter-offer arriving, for the two to be linked. In minutes.',
  'Notifications': 'Notifications',
  'Notifications bureau': 'Desktop notifications',
  'Notifications système Windows / macOS / Linux.': 'Windows / macOS / Linux system notifications.',
  'Détail des objets': 'Item details',
  'Affiche ce que vous donnez et recevez directement dans la notification.': 'Shows what you give and receive right inside the notification.',
  'Notification persistante': 'Sticky notification',
  'Reste affichée jusqu\'à ce que vous cliquiez (Chrome/Edge).': 'Stays on screen until you click it (Chrome/Edge).',
  'Ouvrir le trade au clic': 'Open the trade on click',
  'Compteur sur l\'icône': 'Badge on the icon',
  'Nombre de trades en attente affiché sur l\'icône de l\'extension.': 'Number of pending trades shown on the extension icon.',
  'Notifications max par vérification': 'Max notifications per check',
  'Au-delà, une seule notification résumé est envoyée par type d\'événement.': 'Beyond that, a single summary notification is sent per event type.',
  'Son': 'Sound',
  'Jouer un son': 'Play a sound',
  "Un son différent par type d'événement. Le bouton": 'A different sound per event type. The',
  'fait écouter la sonnerie choisie.': 'button previews the chosen tone.',
  'Trade reçu / contre-offre': 'Incoming trade / counter-offer',
  'Trade accepté / complété': 'Trade accepted / completed',
  'Refusé, contré, expiré': 'Declined, countered, expired',
  'Erreur Roblox': 'Roblox error',
  'Écouter': 'Preview',
  'Aucun son n\'est parti : vérifie le volume et que le navigateur n\'est pas coupé.':
    'No sound went out: check the volume and that the browser is not muted.',
  'Volume': 'Volume',
  'Test': 'Test',
  'Envoie une notification et joue le son des trades reçus.': 'Sends a notification and plays the incoming-trade sound.',
  'Tester': 'Test it',
  'Carillon': 'Chime',
  'Pièces': 'Coins',
  'Alerte': 'Alert',
  'Fanfare': 'Fanfare',
  'Descendant': 'Descending',
  'Aucun': 'None',
  'Une alerte n\'apparaît pas pendant que tu joues ? Windows coupe les notifications tout seul en plein écran ou en jeu (Paramètres › Système › Notifications › « Ne pas déranger »). Le son de RoNote, lui, joue quand même.':
    'No alert while you play? Windows silences notifications on its own in full screen or during games (Settings › System › Notifications › “Do not disturb”). RoNote\'s sound still plays.',
  '{n} trade(s) plus ancien(s) que le suivi, jamais notifié(s)': '{n} trade(s) older than the tracking start, never notified',
  'Analyse de valeur': 'Value analysis',
  'Utiliser les cotes Rolimon\'s': 'Use Rolimon\'s values',
  'Cotes communautaires + détection des items « projected ». Cache de 3 h.': 'Community values + detection of “projected” items. Cached for 3 h.',
  'Base de calcul': 'Calculation basis',
  'La': 'The',
  'value': 'value',
  'est le chiffre sur lequel se fait un trade : c\'est la cote de référence de toute la communauté. Le RAP vient de Roblox mais ne reflète que l\'historique des ventes, et il se gonfle à coups de rachats entre complices.': 'is the figure a trade is made on: it is the reference the whole community reads. The RAP comes from Roblox but only reflects sales history, and it inflates through wash trading.',
  'Value Rolimon\'s (recommandé)': 'Rolimon\'s value (recommended)',
  'Prudente — le plus bas des deux': 'Careful — the lower of the two',
  'RAP Roblox uniquement': 'Roblox RAP only',
  'Compter les Robux nets de taxe': 'Count Robux net of tax',
  'Roblox prélève 30 % sur les Robux reçus dans un trade. Décoché, RoNote compte le montant brut — donc surévalue ce qu\'on vous propose.': 'Roblox takes 30% of the Robux received in a trade. Unchecked, RoNote counts the gross amount — and so overvalues what you are offered.',
  'Détail des objets dans le popup': 'Item details in the popup',
  'Ajoute sous chaque trade une liste dépliable : nom, série, value et RAP de chaque objet.': 'Adds an expandable list under each trade: name, serial, value and RAP of every item.',
  'Seuil « cote spéculative »': '“Speculative value” threshold',
  'Un objet dont la value dépasse ce multiple de son RAP est signalé': 'An item whose value exceeds this multiple of its RAP is flagged',
  ": sa cote repose sur l'avis de la communauté plus que sur des ventes réelles.": ': its value rests on community opinion more than on real sales.',
  'Suivre la valeur de mon compte': 'Track my account value',
  'Relève la value et le RAP totaux de ton profil Rolimon\'s pour tracer ta progression dans l\'onglet': 'Reads the total value and RAP from your Rolimon\'s profile to chart your progress in the',
  'Corriger les visages passés en bundles': 'Correct faces turned into bundles',
  'Roblox a converti les visages en': 'Roblox turned faces into',
  '. Un visage échangé laisse son ancien exemplaire dans l\'inventaire, que Rolimon\'s continue de compter ; un visage reçu arrive en bundle, que Rolimon\'s ne voit pas. RoNote compare visage par visage ce que Rolimon\'s compte et les bundles réellement possédés, puis affiche le détail de la correction.': '. A traded-away face leaves its old copy in the inventory, which Rolimon\'s keeps counting; a received face arrives as a bundle, which Rolimon\'s never sees. RoNote compares, face by face, what Rolimon\'s counts against the bundles actually owned, then shows the correction in detail.',
  'Quel que soit ce réglage,': 'Whatever this setting,',
  'les deux chiffres restent affichés': 'both figures stay on screen',
  '. Un trade où la value et le RAP se contredisent est marqué': '. A trade where value and RAP disagree is marked',
  '« verdict incertain », une cote révisée récemment est signalée': '(uncertain verdict), a recently revised value is flagged',
  ", et dans ces deux cas la notification n'est jamais supprimée par un filtre.": ', and in both cases the notification is never dropped by a filter.',
  'Objets non cotés (visages, objets de bundle, nouveautés) : RoNote récupère le RAP officiel auprès de Roblox. Si l\'objet reste sans cote, il est signalé': 'Unvalued items (faces, bundle items, brand-new items): RoNote fetches the official RAP from Roblox. If the item still has no value, it is flagged',
  'et exclu des totaux — jamais compté comme 0 — et la notification n\'est jamais supprimée par un filtre dans ce cas.': 'and excluded from the totals — never counted as 0 — and the notification is never dropped by a filter in that case.',

  'Alerter quand un objet que je possède est réévalué': 'Alert me when an item I own is revalued',
  "Rolimon's révise ses cotes régulièrement. À chaque nouvelle table (toutes les 3 h), RoNote la compare à la précédente et te prévient si un objet de ton inventaire a bougé. S'appuie sur l'inventaire relevé pour la correction des visages : les deux réglages précédents doivent rester actifs.":
    "Rolimon's revises its values regularly. With every new table (every 3 h), RoNote compares it with the previous one and alerts you when an item in your inventory has moved. It relies on the inventory read for the face correction: the two settings above must stay on.",
  'Seuil de réévaluation': 'Revaluation threshold',
  'Variation minimale de la cote, à la hausse comme à la baisse, en %.': 'Minimum change in value, up or down, in %.',
  'Objet réévalué': 'Item revalued',

  /* --- popup : zoom, refus, infobulle d'un objet ------------------------ */
  '{n} objet': '{n} item',
  '{n} objets': '{n} items',
  'Total value': 'Total value',
  'Annuler ce trade': 'Cancel this trade',
  'Refuser ce trade': 'Decline this trade',
  'Confirmer ?': 'Confirm?',
  'Demande': 'Demand',
  'Tendance': 'Trend',
  'RAP faute de cote': 'RAP, no value',
  'proj': 'proj',
  'spécu': 'spec',
  'révisé': 'revised',
  'Refuser': 'Decline',
  'Confirmer le refus': 'Confirm decline',
  'Trade refusé': 'Trade declined',
  'Évaluation impossible — {why}': 'Cannot evaluate — {why}',

  'Filtres': 'Filters',
  '(s\'appliquent uniquement aux trades reçus)': '(apply to inbound trades only)',
  'Ne notifier que les trades gagnants': 'Only notify winning trades',
  'Les autres restent visibles dans le popup et le journal, sans alerte. Sans effet sur un trade dont les cotes sont incertaines : il est toujours notifié.': 'The others stay visible in the popup and the log, without an alert. No effect on a trade whose values are uncertain: it is always notified.',
  'Gain minimum': 'Minimum gain',
  'En % sur la base de calcul choisie ci-dessus, appliqué si l\'option précédente est active.': 'In % on the basis chosen above, applied when the previous option is on.',
  'Valeur minimum reçue': 'Minimum value received',
  'Ignore les offres dont le total proposé est inférieur, sur la base de calcul choisie. 0 = désactivé.': 'Ignores offers whose proposed total is lower, on the chosen basis. 0 = off.',
  'Ignorer les trades contenant un item « projected »': 'Ignore trades containing a “projected” item',
  'Les contre-offres passent outre les filtres': 'Counter-offers bypass the filters',
  'Une réponse à votre propre trade vous est toujours notifiée.': 'A reply to your own trade is always notified.',
  'Heures silencieuses': 'Quiet hours',
  'Activer': 'Enable',
  'Aucune notification bureau pendant la plage (le suivi continue, rien n\'est perdu).': 'No desktop notification during the window (tracking continues, nothing is lost).',
  'De': 'From',
  'À': 'To',
  'Notifier quand même': 'Notify anyway',
  'Garde les alertes mais sans son.': 'Keeps the alerts but mutes the sound.',
  'Utilisateurs ignorés': 'Ignored users',
  'Astuce : le bouton « Ignorer » d\'une notification ajoute directement l\'expéditeur ici.': 'Tip: the “Ignore” button on a notification adds the sender here directly.',
  'Aucun utilisateur ignoré.': 'No ignored user.',
  'Retirer': 'Remove',
  'Diagnostic d\'un trade': 'Trade diagnostics',
  'Un trade qui refuse de s\'évaluer ? Colle son numéro (visible sur sa carte dans le popup) : RoNote teste chaque version de l\'API, en direct et via un onglet Roblox, et affiche la réponse brute.': 'A trade that refuses to evaluate? Paste its number (shown on its card in the popup): RoNote tests every API version, directly and through a Roblox tab, and shows the raw response.',
  'Numéro du trade': 'Trade number',
  'Exemple : 2645140139823455': 'Example: 2645140139823455',
  'Lancer le test': 'Run the test',
  'Garde un onglet roblox.com ouvert pour tester aussi le relais.': 'Keep a roblox.com tab open to test the relay too.',
  'Diagnostiquer': 'Diagnose',
  'Copier': 'Copy',
  'Copié': 'Copied',
  'Test en cours…': 'Testing…',
  'Maintenance': 'Maintenance',
  'Réinitialiser le suivi': 'Reset tracking',
  'Reprend une photo de l\'existant et vide les trades suivis. Les trades actuellement présents ne seront pas notifiés.': 'Takes a fresh snapshot and clears tracked trades. Trades currently there will not be notified.',
  'Réinitialiser': 'Reset',
  'Exporter le journal': 'Export the log',
  'Fichier CSV de tous les événements détectés.': 'CSV file of every detected event.',
  'Exporter': 'Export',
  'Vider le journal': 'Clear the log',
  'Vider': 'Clear',
  'Vider le journal ?': 'Clear the log?',
  'Réinitialiser le suivi ?\n\nLes trades actuellement présents seront enregistrés comme « déjà vus » et ne déclencheront aucune notification. Les trades épinglés seront désépinglés.': 'Reset tracking?\n\nTrades currently present will be recorded as already seen and will not trigger any notification. Pinned trades will be unpinned.',
  'État': 'State',
  'Erreur': 'Error',
  'Connecté': 'Signed in',
  'aucune vérification réussie': 'no successful check yet',
  'Dernière vérif.': 'Last check',
  'Trades en attente': 'Pending trades',
  'Trades suivis': 'Tracked trades',
  'aucun': 'none',
  'IDs mémorisés': 'Ids remembered',
  'Cotes Rolimon\'s': 'Rolimon\'s values',
  'aucune': 'none',
  'désactivé': 'disabled',
  'table non actualisée': 'table not refreshed',
  'à jour {ago}': 'up to date {ago}',
  'Dernier trade reçu': 'Last inbound trade',
  'reçus {a} · envoyés {b} · finis {c} · inactifs {d}': 'inbound {a} · outbound {b} · completed {c} · inactive {d}',

  /* --- fiche d'un joueur ------------------------------------------------ */
  'Fiche du joueur': 'Player card',
  "Valeur de l'inventaire": 'Inventory value',
  'rang #{n}': 'rank #{n}',
  "Rolimon's n'a pas encore scanné cet inventaire.": "Rolimon's has not scanned this inventory yet.",
  'Profil public indisponible.': 'Public profile unavailable.',
  'Compte récent : {age}': 'New account: {age}',
  'Compte de {age}': 'Account age: {age}',
  '{n} jour': '{n} day',
  '{n} jours': '{n} days',
  '1 mois': '1 month',
  '{n} mois': '{n} months',
  '{n} an': '{n} year',
  '{n} ans': '{n} years',
  'Compte banni': 'Banned account',
  'Vérifié': 'Verified',
  'En ligne {ago}': 'Online {ago}',
  'Ignoré': 'Ignored',
  "Ses trades ne déclenchent plus d'alerte.": 'Their trades no longer trigger alerts.',
  'Entre vous': 'Between you',
  'Offres reçues': 'Offers received',
  'Offres envoyées': 'Offers sent',
  'Gain moyen': 'Average gain',
  'sur {n} offre': 'over {n} offer',
  'sur {n} offres': 'over {n} offers',
  'Trades conclus': 'Trades completed',
  'bilan {v}': 'net {v}',
  'Ses offres te font perdre {pct} en moyenne.': 'On average, their offers lose you {pct}.',
  'Ses offres te sont favorables : {pct} en moyenne.': 'Their offers favor you: {pct} on average.',
  'Vos échanges': 'Your trades',
  "Aucun échange avec ce joueur pour l'instant.": 'No trade with this player yet.',
  'Offre reçue': 'Offer received',
  'Offre envoyée': 'Offer sent',
  'Trade conclu': 'Trade completed',
  'Profil Roblox': 'Roblox profile',
  'Ignorer': 'Ignore',
  'Ne plus ignorer': 'Stop ignoring',
  'Profil public indisponible — {why}.': 'Public profile unavailable — {why}.',
  'Recharge RoNote dans chrome://extensions pour activer la fiche.': 'Reload RoNote in chrome://extensions to enable player cards.',
  "d'après l'historique Rolimon's": "from Rolimon's history",
  'Ses bundles': 'Their bundles',
  'Possédés': 'Owned',
  "Qu'il n'a plus": 'No longer owned',
  "compté par Rolimon's, plus dans son inventaire": "counted by Rolimon's, no longer in their inventory",
  "ignoré par Rolimon's": "ignored by Rolimon's",
  'Aucun bundle coté.': 'No valued bundle.',
  '+ {n} autre': '+ {n} more',
  '+ {n} autres': '+ {n} more',
  "Rolimon's l'estime à {raw} ; ses vrais bundles le mettent à {value} ({delta}).": "Rolimon's puts it at {raw}; their actual bundles make it {value} ({delta}).",
  'Bundles indisponibles — {why}.': 'Bundles unavailable — {why}.',
  'Liste incomplète — {why}.': 'Incomplete list — {why}.',
  "inventaire privé — Rolimon's ne publie rien": "private inventory — Rolimon's publishes nothing",
  "inventaire Rolimon's indisponible": "Rolimon's inventory unavailable",
  'bundles Roblox indisponibles': 'Roblox bundles unavailable',
  'compte supprimé': 'terminated account',

  /* --- accueil ---------------------------------------------------------- */
  'Accueil': 'Home',
  'Ton portefeuille': 'Your portfolio',
  'sur 24 h': 'over 24 h',
  "Reçus aujourd'hui": 'Received today',
  "Conclus aujourd'hui": 'Completed today',
  'Alertes filtrées': 'Filtered alerts',
  'effet {v}': 'effect {v}',
  'À traiter': 'To handle',
  '{n} trade en attente': '{n} pending trade',
  '{n} trades en attente': '{n} pending trades',
  'meilleure offre : {pct} de {who}': 'best offer: {pct} from {who}',
  'Offre de {who}': 'Offer from {who}',
  'en attente de réponse': 'waiting for a reply',
  "Rien à traiter pour l'instant.": 'Nothing to handle right now.',
  'Derniers événements': 'Latest events',
  'Tout le journal': 'Full log',
  'RoNote {v} est installé': 'RoNote {v} is installed',
  'Voir les nouveautés': "See what's new",

  /* --- quoi de neuf ----------------------------------------------------- */
  'Quoi de neuf': "What's new",
  'Chaque mise à jour de RoNote, de la plus récente à la plus ancienne.': 'Every RoNote update, newest first.',
  'En préparation': 'In progress',
  'Version installée': 'Installed version',
  'Prochaine version': 'Next version',

  /* --- bases de calcul -------------------------------------------------- */
  'Value': 'Value',
  'RAP': 'RAP',
  'Prudent': 'Careful',
  "Value Rolimon's": "Rolimon's value",
  'RAP Roblox': 'Roblox RAP',
  'Base prudente (min des deux)': 'Careful basis (lower of the two)'
};

const DICT = { en: EN };

/* -------------------------------- moteur -------------------------------- */

let lang = 'fr';

/** 'auto' suit la langue du navigateur ; tout le reste est explicite. */
export function resolveLang(setting) {
  if (setting && setting !== 'auto' && LANGS[setting]) return setting;
  const nav = String(globalThis.navigator?.language || 'fr').slice(0, 2).toLowerCase();
  return LANGS[nav] ? nav : 'en';
}

export function setLang(setting) {
  lang = resolveLang(setting);
  // Le gabarit est ecrit avec `lang="fr"` en dur : sans cette ligne, un lecteur
  // d'ecran prononce toute l'interface anglaise avec la phonetique francaise.
  // Le service worker, lui, n'a pas de document.
  if (typeof document !== 'undefined') document.documentElement.lang = lang;
  return lang;
}

export const currentLang = () => lang;

/**
 * Le dictionnaire d'une langue, tel quel.
 *
 * Les scripts de contenu ne peuvent RIEN charger sur roblox.com (politique de
 * securite : le scheme `chrome-extension:` n'y est pas autorise). Le service
 * worker leur envoie donc le dictionnaire avec l'evaluation, plutot que d'en
 * laisser une copie trainer dans le panneau. Le francais n'a pas de
 * dictionnaire : c'est la langue source, la phrase est deja la bonne.
 */
export const dictFor = (l) => DICT[l] || {};
export const locale = () => LOCALES[lang] || 'fr-FR';

/**
 * @param fr    la phrase francaise, telle quelle
 * @param vars  { n: 3 } remplace « {n} »
 */
export function t(fr, vars) {
  let s = lang === 'fr' ? fr : (DICT[lang]?.[fr] ?? fr);
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.split('{' + k + '}').join(String(v));
  }
  return s;
}

/** Raccourci pluriel : `p(n, 'objet', 'objets')`. */
export const p = (n, one, many) => t(n > 1 ? many : one, { n });

/**
 * Traduit une page deja ecrite en francais : textes, infobulles, placeholders,
 * et les libelles des <option>. Ne touche a rien qu'il ne reconnait pas.
 */
export function translateDom(root = document) {
  if (lang === 'fr') return;
  const dict = DICT[lang];
  if (!dict) return;

  const walker = document.createTreeWalker(root.body || root, NodeFilter.SHOW_TEXT);
  const swaps = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const raw = n.nodeValue;
    const key = raw.trim();
    if (!key || !dict[key]) continue;
    swaps.push([n, raw.replace(key, dict[key])]);
  }
  for (const [n, v] of swaps) n.nodeValue = v;

  for (const el of (root.body || root).querySelectorAll('[title], [placeholder]')) {
    for (const attr of ['title', 'placeholder']) {
      const v = el.getAttribute(attr);
      if (v && dict[v.trim()]) el.setAttribute(attr, dict[v.trim()]);
    }
  }
}
