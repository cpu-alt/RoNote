/**
 * Decide si un trade doit declencher une notification.
 * Module volontairement pur (aucune API navigateur) pour etre testable.
 *
 * Principe : on ne supprime JAMAIS une alerte sur la base d'un chiffre dont on
 * sait qu'il est incertain. Mieux vaut une notification de trop qu'un bon trade
 * rate a cause d'une cote manquante, perimee ou contestee.
 */
export function passesFilters(card, settings) {
  // Une reponse a notre propre proposition : on la veut toujours.
  if (card.kind === 'counter' && settings.alwaysNotifyCounters) return { ok: true };
  if (card.kind !== 'inbound' && card.kind !== 'counter') return { ok: true };

  const pid = card.partner?.id;
  if (pid && settings.ignoredUsers?.some(u => Number(u.id) === Number(pid))) {
    return { ok: false, why: 'utilisateur ignore' };
  }

  const a = card.analysis;
  if (!a) return { ok: true };

  if (settings.ignoreProjected && a.projectedIncoming) {
    return { ok: false, why: 'item projected' };
  }

  // --- garde-fous : cas ou les totaux ne sont pas dignes de confiance ------

  // Un objet sans aucune cote (visage, objet de bundle) ampute les totaux.
  if (a.incomplete) return { ok: true, note: `${a.unknownCount} objet(s) sans cote` };

  // La value communautaire et le RAP se contredisent franchement : trancher
  // reviendrait a parier sur l'une des deux.
  if (a.divergent) return { ok: true, note: 'value et RAP en désaccord' };

  // Table Rolimon's injoignable depuis trop longtemps : les cotes ont pu etre
  // revisees sans qu'on le sache.
  if (a.valueVeryStale && a.basis !== 'rap') return { ok: true, note: 'cotes non actualisées' };

  // --- filtres normaux, sur la base choisie par l'utilisateur --------------

  if (settings.minTheirValue > 0 && a.mainGet < settings.minTheirValue) {
    return { ok: false, why: 'valeur recue < ' + settings.minTheirValue };
  }
  if (settings.onlyWins && a.pctMain < (settings.minGainPercent || 0)) {
    return { ok: false, why: 'gain ' + a.pctMain.toFixed(1) + '% < ' + (settings.minGainPercent || 0) + '%' };
  }
  return { ok: true };
}
