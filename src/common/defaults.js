export const DEFAULTS = {
  enabled: true,
  lang: 'auto',               // auto (langue du navigateur) | fr | en

  pollSeconds: 30,            // 30s = cadence fiable (les alarmes MV3 sont limitees a 30s)

  // --- Flux surveilles ---------------------------------------------------
  watchInbound: true,         // nouveaux trades recus
  watchCompleted: true,       // trades finalises
  watchOutbound: true,        // suivi de mes trades envoyes (onglet Outbound)
  watchRejectedError: true,   // "Rejected due to an error" (onglet Inactive)

  // --- Suivi des trades envoyes -----------------------------------------
  autoTrackOutbound: false,   // suivre automatiquement TOUS les trades envoyes
  autoTrackCounters: true,    // suivre automatiquement les trades que JE contre
  notifyUntrackedOutbound: false, // alerter aussi pour les envoyes non suivis
  notifyOutbound: {
    accepted: true,
    declined: true,
    countered: true,
    expired: false,
    error: true
  },
  counterWindowMinutes: 90,   // fenetre de rapprochement d'une contre-offre

  // --- Notifications -----------------------------------------------------
  desktopNotifications: true,
  requireInteraction: false,  // la notif reste a l'ecran jusqu'au clic
  showItems: true,            // detail des objets dans la notif
  openOnClick: true,
  maxNotificationsPerPoll: 5, // au-dela -> une notif resume
  badge: true,

  // --- Son ---------------------------------------------------------------
  sound: true,
  // Un son par famille d'evenement (cle de SOUNDS, `none` = silence).
  // L'ancien reglage unique `soundName` est migre vers `sounds.inbound`.
  sounds: {
    inbound:  'chime',        // trade recu, contre-offre
    accepted: 'success',      // trade accepte / complete
    declined: 'ping',         // refuse, contre, expire
    error:    'alert',        // « Rejected due to an error », intervention Roblox
    revalued: 'coins'         // objet possede reevalue par Rolimon's
  },
  volume: 0.6,

  // --- Valeurs / analyse -------------------------------------------------
  useRolimons: true,          // cotes Rolimon's (repli RAP si indispo)
  valueBasis: 'value',        // base de calcul : value | rap | prudent
  speculativeRatio: 1.6,      // value >= N x RAP -> cote signalee comme speculative
  robuxTax: true,             // compter les Robux recus nets des 30 % preleves par Roblox
  trackPortfolio: true,       // suivre la valeur totale du compte (profil Rolimon's)
  reconcilePortfolio: true,   // corriger la valeur Rolimon's (visages fantomes / absents)
  // Reevaluation des objets possedes : prevenir quand Rolimon's revise la
  // cote d'un objet de l'inventaire d'au moins ce pourcentage.
  revalAlerts: true,
  revalMinPercent: 10,
  showItemDetails: true,      // liste depliable des objets sous chaque trade
  pageDelta: true,            // ecarts RAP / Value et cote des objets sur la page des trades Roblox
  projectedColor: '#ffc400',  // fond du badge « projected » sur la page Roblox
  bannerGain: '#22e57a',      // bandeau des ecarts sur la page Roblox : couleur d'un gain
  bannerLoss: '#ff4d5e',      // ... d'une perte
  bannerStyle: 'soft',        // soft | vivid | neon | solid
  bannerSize: 'm',            // s | m | l
  projectedSize: 'm',         // s | m | l ; l'image importee est a part (cle projectedIcon)

  // --- Filtres (uniquement pour les trades RECUS) ------------------------
  onlyWins: false,            // ne notifier que si gain de valeur
  minGainPercent: 0,          // gain minimum en % pour notifier
  minTheirValue: 0,           // valeur minimum de ce qu'on me propose
  ignoreProjected: false,     // ignorer les trades contenant un item "projected"
  ignoredUsers: [],           // [{id, name}]
  alwaysNotifyCounters: true, // une contre-offre passe outre les filtres

  // --- Heures silencieuses -----------------------------------------------
  quietHours: { enabled: false, start: '23:00', end: '08:00', stillNotify: false },

  historyLimit: 300
};

export const SOUNDS = {
  chime:   'Carillon',
  ping:    'Ping',
  coins:   'Pièces',
  alert:   'Alerte',
  success: 'Fanfare',
  down:    'Descendant',
  none:    'Aucun'
};

/** Familles de son, dans l'ordre ou elles sont jouees quand plusieurs tombent ensemble. */
export const SOUND_GROUPS = ['inbound', 'accepted', 'error', 'declined', 'revalued'];

const GROUP_OF = {
  inbound: 'inbound', counter: 'inbound',
  completed: 'accepted', outbound_accepted: 'accepted',
  outbound_declined: 'declined', outbound_countered: 'declined', outbound_expired: 'declined',
  trade_error: 'error',
  revalued: 'revalued'
};

/** Famille de son d'un type d'evenement (inconnu -> comme un trade recu). */
export const soundGroupOf = (kind) => GROUP_OF[kind] || 'inbound';
