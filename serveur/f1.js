// Formule 1 : calendrier (Jolpica), sessions du week-end et tracé du circuit
import CIRCUITS from './circuits.js';
import { pourEcran } from './commun.js';
import { JOURS_COURTS, TZ, deux, mural, versUTC } from './temps.js';

// ---------------------------------------------------------------------
//  Titres de Formule 1 : "FORMULA 1 SPONSOR XXX GRAND PRIX 2026 - Race"
//  devient "GP de XXX - Course" (le nom du GP en premier, sans le sponsor)
// ---------------------------------------------------------------------
const GP_F1 = [            // mot-cle -> nom du GP (le dernier mot-cle trouve dans le titre l'emporte)
  [/australi/i, "GP d'Australie"], [/chin/i, 'GP de Chine'], [/japan/i, 'GP du Japon'],
  [/bahrain/i, 'GP de Bahreïn'], [/saudi|arabie/i, "GP d'Arabie saoudite"], [/miami/i, 'GP de Miami'],
  [/canad/i, 'GP du Canada'], [/monaco/i, 'GP de Monaco'], [/barcelon|catalu/i, 'GP de Barcelone'],
  [/spanish|spain|españa|espagne|madrid/i, "GP d'Espagne"], [/austria|österreich|autriche/i, "GP d'Autriche"],
  [/british|britain|grande-bretagne/i, 'GP de Grande-Bretagne'], [/belgi/i, 'GP de Belgique'],
  [/hungar|hongrie/i, 'GP de Hongrie'], [/dutch|netherlands|pays-bas/i, 'GP des Pays-Bas'],
  [/emilia|imola/i, "GP d'Émilie-Romagne"], [/ital/i, "GP d'Italie"], [/azerbai/i, "GP d'Azerbaïdjan"],
  [/singapo/i, 'GP de Singapour'], [/united states|usa|états-unis/i, 'GP des États-Unis'],
  [/las vegas/i, 'GP de Las Vegas'], [/mexic|méxico/i, 'GP de Mexico'], [/s[ãa]o paulo|brazil|brasil/i, 'GP de São Paulo'],
  [/qatar/i, 'GP du Qatar'], [/abu dhabi/i, "GP d'Abu Dhabi"],
];
const SESSIONS_F1 = [
  [/(free )?practice 1|\bfp1\b|essais libres 1/i, 'Essais libres 1'],
  [/(free )?practice 2|\bfp2\b|essais libres 2/i, 'Essais libres 2'],
  [/(free )?practice 3|\bfp3\b|essais libres 3/i, 'Essais libres 3'],
  [/sprint (qualifying|shootout|quali)|qualifications? sprint/i, 'Qualif. sprint'],
  [/sprint/i, 'Sprint'],
  [/qualif/i, 'Qualifications'],
  [/\brace\b|course/i, 'Course'],
];
export function titreF1(t) {
  if (!/formula\s*1|\bf1\b|grand prix|gran premio|grande pr[eê]mio|grosser preis|großer preis/i.test(t)) return t;
  // Le nom du GP = le mot-cle de lieu situe le plus loin dans le titre (les sponsors sont au debut)
  let meilleur = null, pos = -1;
  for (const [re, nom] of GP_F1) {
    const g = new RegExp(re.source, 'gi');
    let m;
    while ((m = g.exec(t))) if (m.index > pos) { pos = m.index; meilleur = nom; }
  }
  if (!meilleur) return t;
  let session = '';
  for (const [re, nom] of SESSIONS_F1) if (re.test(t)) { session = nom; break; }
  return session ? meilleur + ' - ' + session : meilleur;
}
// ---------------------------------------------------------------------
//  Prochain Grand Prix de F1 : calendrier Jolpica (ex-Ergast), trace du circuit integre
// ---------------------------------------------------------------------
// Le calendrier est garde dans le KV et redemande au plus toutes les 12 h : Jolpica limite le nombre
// de requetes par adresse, et les Workers Cloudflare partagent leurs adresses avec beaucoup d'autres
// sites (d'ou des refus "HTTP 429"). Si Jolpica ne repond pas, on garde la derniere copie.
const CLES_GP = ['round', 'raceName', 'date', 'time', 'Circuit', 'FirstPractice', 'SecondPractice', 'ThirdPractice',
  'SprintQualifying', 'SprintShootout', 'Sprint', 'Qualifying'];
async function calendrierF1(annee, env) {
  const cle = 'f1-' + annee;
  let memo = null;
  try { memo = JSON.parse((await env.CADRE.get(cle)) || 'null'); } catch (e) { /* pas de copie */ }
  if (memo && Date.now() - memo.t < 12 * 3600e3) return memo.courses;
  try {
    const r = await fetch('https://api.jolpi.ca/ergast/f1/' + annee + '.json?limit=40',
      { cf: { cacheTtl: 21600, cacheEverything: true }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const courses = ((((await r.json()).MRData || {}).RaceTable || {}).Races || [])
      .map(c => Object.fromEntries(CLES_GP.filter(k => c[k] !== undefined).map(k => [k, c[k]])));
    if (courses.length || !memo || !memo.courses.length) {
      try { await env.CADRE.put(cle, JSON.stringify({ t: Date.now(), courses })); } catch (e) { /* limite d'ecriture */ }
    }
    return courses.length || !memo ? courses : memo.courses;
  } catch (e) {
    if (memo) return memo.courses;          // copie plus ancienne : toujours valable pour les horaires
    throw new Error(e.name === 'TimeoutError' ? 'pas de réponse' : e.message);
  }
}
const SESSIONS_JOLPICA = [['FirstPractice', 'Essais libres 1'], ['SecondPractice', 'Essais libres 2'],
  ['ThirdPractice', 'Essais libres 3'], ['SprintQualifying', 'Qualif. sprint'], ['SprintShootout', 'Qualif. sprint'],
  ['Sprint', 'Sprint'], ['Qualifying', 'Qualifications']];
const instantF1 = s => (s && s.date ? Date.parse(s.date + 'T' + (s.time || '12:00:00Z')) : NaN);
// Circuit integre le plus proche des coordonnees donnees par le calendrier
function circuitProche(lat, lon) {
  let meilleur = null, dMin = Infinity;
  for (const id in CIRCUITS) {
    const c = CIRCUITS[id];
    const d = Math.hypot((c.lat - lat) * 111, (c.lon - lon) * 111 * Math.cos(lat * Math.PI / 180));
    if (d < dMin) { dMin = d; meilleur = c; }
  }
  return dMin < 10 ? meilleur : null;          // a moins de 10 km
}
const numJour = w => Date.UTC(w.y, w.m - 1, w.d) / 86400e3;
export async function grandPrix(maintenant, env) {
  const an = mural(maintenant).y;
  // Le GP reste affiche jusqu'a 3 h apres le depart de la course
  let gp = (await calendrierF1(an, env)).find(c => instantF1(c) + 3 * 3600e3 > maintenant);
  if (!gp) { try { gp = (await calendrierF1(an + 1, env))[0]; } catch (e) { /* pas encore publie */ } }
  if (!gp) return { erreur: 'Saison de F1 terminée' };
  const course = instantF1(gp);
  const sessions = SESSIONS_JOLPICA.filter(([k]) => gp[k]).map(([k, n]) => [instantF1(gp[k]), n, 3600e3]);
  sessions.push([course, 'Course', 2 * 3600e3]);
  sessions.sort((a, b) => a[0] - b[0]);
  const auj = numJour(mural(maintenant));
  const ecart = numJour(mural(sessions[0][0])) - auj;
  const ecartCourse = numJour(mural(course)) - auj;
  const quand = ecart > 1 ? 'Dans ' + ecart + ' jours' : ecart === 1 ? 'Demain' : ecartCourse > 0 ? 'Ce week-end' : maintenant < course ? "Aujourd'hui" : 'Terminé';
  const loc = (gp.Circuit && gp.Circuit.Location) || {};
  const c = circuitProche(parseFloat(loc.lat), parseFloat(loc.long));
  const wC = mural(course);
  return {
    gp: pourEcran(titreF1(gp.raceName || '')),
    manche: +gp.round || 0,
    circuit: pourEcran(c ? c.nom : (gp.Circuit || {}).circuitName),
    lieu: pourEcran(loc.locality || ''),
    quand,
    sessions: sessions.map(([t, n, duree]) => {
      const w = mural(t);
      return { j: JOURS_COURTS[w.js] + ' ' + w.d, h: w.hh + 'h' + deux(w.mi), n, f: t + duree < maintenant ? 1 : 0 };
    }),
    trace: c ? { l: c.l, h: c.h, p: c.p } : null,
    // Periodes pour les scenes : semaine (du lundi 0 h) et week-end (du jour de la 1re seance, 0 h)
    // jusqu'a 3 h apres le depart de la course
    periodes: {
      semaine: [versUTC({ y: wC.y, m: wC.m, d: wC.d - (wC.js + 6) % 7 }, TZ), course + 3 * 3600e3],
      weekend: [versUTC(Object.assign({}, mural(sessions[0][0]), { hh: 0, mi: 0, ss: 0 }), TZ), course + 3 * 3600e3],
    },
  };
}
