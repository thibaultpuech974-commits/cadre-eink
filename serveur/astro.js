// Soleil et lune : lever, coucher, durée du jour et phase de la lune, calculés sans service extérieur
import { JOURS_COURTS, deux, mural, versUTC, TZ } from './temps.js';

const RAD = Math.PI / 180;
const sin = d => Math.sin(d * RAD), cos = d => Math.cos(d * RAD);
const tour = d => ((d % 360) + 360) % 360;
const JOUR = 86400e3;
const versJJ = ms => ms / JOUR + 2440587.5;          // jour julien
const depuisJJ = jj => (jj - 2440587.5) * JOUR;

// Lever et coucher du soleil (ms UTC) pour le jour civil y-m-d a cet endroit : "equation du lever
// du soleil", bord superieur du disque et refraction compris (-0,833 degre). Precision : 1 a 2 min.
// Rend null quand le soleil ne se leve ou ne se couche pas ce jour-la (regions polaires).
export function soleil(y, m, d, lat, lon) {
  const n = Math.round(versJJ(Date.UTC(y, m - 1, d, 12))) - 2451545 + 0.0008 - lon / 360;
  const M = tour(357.5291 + 0.98560028 * n);
  const C = 1.9148 * sin(M) + 0.02 * sin(2 * M) + 0.0003 * sin(3 * M);
  const L = tour(M + C + 180 + 102.9372);
  const midi = 2451545 + n + 0.0053 * sin(M) - 0.0069 * sin(2 * L);
  const sinDec = sin(L) * sin(23.4397), cosDec = Math.sqrt(1 - sinDec * sinDec);
  const c = (sin(-0.833) - sin(lat) * sinDec) / (cos(lat) * cosDec);
  if (c < -1 || c > 1) return null;
  const demi = Math.acos(c) / RAD / 360;
  return { lever: depuisJJ(midi - demi), coucher: depuisJJ(midi + demi) };
}

// Ecart entre la lune et le soleil vus de la Terre, en degres : 0 = nouvelle lune, 90 = premier
// quartier, 180 = pleine lune, 270 = dernier quartier. Longitudes moyennes et leurs principales
// corrections : l'instant d'une phase est juste a une heure pres environ.
export function elongation(ms) {
  const d = versJJ(ms) - 2451545;
  const Ms = 357.529 + 0.98560028 * d;                 // anomalie moyenne du soleil
  const Ml = 134.963 + 13.064993 * d;                  // anomalie moyenne de la lune
  const D = 297.850 + 12.190749 * d;                   // ecart moyen
  const F = 93.272 + 13.229350 * d;
  const lune = 218.316 + 13.176396 * d + 6.289 * sin(Ml) + 1.274 * sin(2 * D - Ml) + 0.658 * sin(2 * D)
    + 0.214 * sin(2 * Ml) - 0.186 * sin(Ms) - 0.114 * sin(2 * F);
  const soleilL = 280.460 + 0.9856474 * d + 1.915 * sin(Ms) + 0.020 * sin(2 * Ms);
  return tour(lune - soleilL);
}
// Nom de la phase : les quatre phases principales durent ici environ un jour (6 degres de part et d'autre)
export function nomPhase(e) {
  if (e < 6 || e >= 354) return 'Nouvelle lune';
  if (e < 84) return 'Premier croissant';
  if (e < 96) return 'Premier quartier';
  if (e < 174) return 'Gibbeuse croissante';
  if (e < 186) return 'Pleine lune';
  if (e < 264) return 'Gibbeuse décroissante';
  if (e < 276) return 'Dernier quartier';
  return 'Dernier croissant';
}
// Prochaine nouvelle lune ou pleine lune apres cet instant : { nom, t } (recherche heure par heure)
export function prochaineLune(ms) {
  let avant = elongation(ms);
  for (let t = ms + 3600e3; t < ms + 31 * JOUR; t += 3600e3) {
    const e = elongation(t);
    if (avant < 180 && e >= 180) return { nom: 'Pleine lune', t };
    if (e < avant) return { nom: 'Nouvelle lune', t };
    avant = e;
  }
  return null;
}

const heure = ms => { const w = mural(ms); return deux(w.hh) + ':' + deux(w.mi); };
const minutes = s => (s ? Math.round((s.coucher - s.lever) / 60e3) : null);
// Donnees du bloc. Tout est calcule pour le jour en cours (la lune a midi) : rien ne change d'un
// reveil a l'autre dans la journee, donc l'ecran n'est pas redessine pour ce bloc.
// p = avancement du cycle de la lune en centiemes (0 nouvelle, 50 pleine), ecl = part eclairee en %.
export function soleilEtLune(o, maintenant) {
  const lat = isFinite(o && o.lat) ? o.lat : 43.84, lon = isFinite(o && o.lon) ? o.lon : 4.36;
  const w = mural(maintenant);
  const midi = versUTC({ y: w.y, m: w.m, d: w.d, hh: 12 }, TZ);
  const s = soleil(w.y, w.m, w.d, lat, lon);
  const res = {};
  if (s) {
    const hier = new Date(Date.UTC(w.y, w.m - 1, w.d - 1));
    const min = minutes(s), avant = minutes(soleil(hier.getUTCFullYear(), hier.getUTCMonth() + 1, hier.getUTCDate(), lat, lon));
    res.lever = heure(s.lever); res.coucher = heure(s.coucher);
    res.duree = Math.floor(min / 60) + ' h ' + deux(min % 60);
    if (avant !== null && min !== avant) res.ecart = (min > avant ? '+' : '-') + Math.abs(min - avant) + ' min';
  } else res.duree = lat * (w.m >= 4 && w.m <= 9 ? 1 : -1) > 0 ? 'Jour permanent' : 'Nuit permanente';
  const e = elongation(midi);
  res.lune = nomPhase(e);
  // Hemisphere sud : la lune se voit a l'envers, le croissant est de l'autre cote
  res.p = Math.round((lat < 0 ? 360 - e : e) / 3.6) % 100;
  res.ecl = Math.round((1 - cos(e)) * 50);
  // Le jour meme d'une pleine ou nouvelle lune, on annonce la suivante (l'autre), pas celle du jour
  const pile = Math.min(e % 180, 180 - (e % 180)) < 6;
  const suite = prochaineLune(midi + (pile ? 1.5 * JOUR : 0));
  if (suite) {
    const ws = mural(suite.t), jours = Math.round((Date.UTC(ws.y, ws.m - 1, ws.d) - Date.UTC(w.y, w.m - 1, w.d)) / JOUR);
    res.suite = suite.nom + ' ' + (jours === 0 ? "aujourd'hui" : jours === 1 ? 'demain' : JOURS_COURTS[ws.js].toLowerCase() + '. ' + ws.d);
  }
  return res;
}
