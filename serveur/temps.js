// Fuseaux horaires (sans bibliothèque) et noms des jours et des mois

export const TZ = 'Europe/Paris';
export const JOURS_COURTS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
export const JOURS_LONGS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
export const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
  'août', 'septembre', 'octobre', 'novembre', 'décembre'];
// ---------------------------------------------------------------------
//  Fuseaux horaires (sans bibliotheque)
// ---------------------------------------------------------------------
const formats = {};
function formatFuseau(tz) {
  if (!formats[tz]) {
    formats[tz] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  }
  return formats[tz];
}
export function fuseauValide(tz) {
  try { formatFuseau(tz); return tz; } catch (e) { return TZ; }
}
// Heure "murale" (y, m, d, hh, mi, ss, js = jour de semaine) d'un instant UTC dans un fuseau
export function mural(utcMs, tz = TZ) {
  const o = {};
  for (const p of formatFuseau(tz).formatToParts(new Date(utcMs))) o[p.type] = p.value;
  const y = +o.year, m = +o.month, d = +o.day;
  return { y, m, d, hh: +o.hour % 24, mi: +o.minute, ss: +o.second, js: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}
function decalageMin(utcMs, tz) {
  const w = mural(utcMs, tz);
  return (Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mi, w.ss) - Math.floor(utcMs / 1000) * 1000) / 60000;
}
// Heure murale dans un fuseau -> instant UTC
export function versUTC(w, tz) {
  const brut = Date.UTC(w.y, w.m - 1, w.d, w.hh || 0, w.mi || 0, w.ss || 0);
  if (tz === 'UTC') return brut;
  const o1 = decalageMin(brut, tz);
  let utc = brut - o1 * 60000;
  const o2 = decalageMin(utc, tz);
  if (o2 !== o1) utc = brut - o2 * 60000;
  return utc;
}
export const deux = n => String(n).padStart(2, '0');
export const dateDuJour = w => w.y + '-' + deux(w.m) + '-' + deux(w.d);
