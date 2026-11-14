// Formule 1 : calendrier (Jolpica), sessions du week-end, tracé et météo du circuit
import CIRCUITS from './circuits.js';
import { avecSecours, pourEcran } from './commun.js';
import { directionVent } from './meteo.js';
import { JOURS_COURTS, TZ, dateDuJour, deux, mural, versUTC } from './temps.js';

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
// Calendrier d'une saison : garde 12 h dans le KV. Apres un echec (Jolpica limite les demandes : HTTP 429),
// l'heure de l'echec est notee dans la meme cle et on attend une heure avant de redemander. Sans cela, le
// calendrier etait redemande a chaque reveil du cadre tant que Jolpica refusait.
const VALIDITE_F1 = 12 * 3600e3, REESSAI_F1 = 3600e3;
async function calendrierF1(annee, env) {
  const cle = 'f1-' + annee;
  let memo = null;
  try { memo = JSON.parse((await env.CADRE.get(cle)) || 'null'); } catch (e) { /* pas de copie */ }
  const copie = memo && memo.t > 0 ? memo.courses : null;       // (t = 0 : aucun calendrier recu, seulement un echec note)
  if (copie && Date.now() - memo.t < VALIDITE_F1) return copie;
  if (memo && memo.echec && Date.now() - memo.echec < REESSAI_F1) {
    if (copie) return copie;                // copie plus ancienne : toujours valable pour les horaires
    throw new Error(memo.raison || 'pas de réponse');
  }
  try {
    const r = await fetch('https://api.jolpi.ca/ergast/f1/' + annee + '.json?limit=40',
      { cf: { cacheTtl: 21600, cacheEverything: true }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const courses = ((((await r.json()).MRData || {}).RaceTable || {}).Races || [])
      .map(c => Object.fromEntries(CLES_GP.filter(k => c[k] !== undefined).map(k => [k, c[k]])));
    if (!courses.length && copie && copie.length) throw new Error('calendrier vide');     // on garde celui qu'on a
    try { await env.CADRE.put(cle, JSON.stringify({ t: Date.now(), courses })); } catch (e) { /* limite d'ecriture */ }
    return courses;
  } catch (e) {
    const raison = e.name === 'TimeoutError' ? 'pas de réponse' : e.message;
    console.log('Calendrier F1 ' + annee + ' : ' + raison + (copie ? ', copie gardée' : '') + ' ; nouvel essai dans une heure');
    try {       // une ecriture par heure au plus, tant que la panne dure
      await env.CADRE.put(cle, JSON.stringify({ t: copie ? memo.t : 0, courses: copie || [], echec: Date.now(), raison }));
    } catch (err) { /* limite d'ecriture */ }
    if (copie) return copie;
    throw new Error(raison);
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
    // Pour la meteo du circuit ; n'est pas envoye a la carte
    interne: { lat: parseFloat(loc.lat), lon: parseFloat(loc.long), sessions },
  };
}

// ---------------------------------------------------------------------
//  Meteo du circuit : previsions heure par heure (Open-Meteo) autour des seances qui restent
// ---------------------------------------------------------------------
// Noms ecrits au-dessus du graphique : la place est celle d'une seance d'une heure
const SESSIONS_COURTES = { 'Essais libres 1': 'EL1', 'Essais libres 2': 'EL2', 'Essais libres 3': 'EL3',
  'Qualif. sprint': 'Q. sprint', Qualifications: 'Qualif.' };
// Au-dela, le risque de pluie heure par heure ne vaut pas grand-chose
const AVANCE_METEO = 7;
const HEURE = 3600e3;
// Rend { meteo: [un element par jour de seances], noteMeteo: texte a ecrire s'il n'y a rien a tracer }.
// Un jour : { j, min, max, p, v, d, g } : temperatures, risque de pluie le plus fort, vent le plus fort
// (km/h) et sa direction pendant les seances ; g = graphique de 1 h avant la premiere seance a 1 h apres
// la derniere (h0 = heure du premier point, t en dixiemes de degre, p en %, s = seances
// [debut, fin, nom] en heures depuis le premier point). Les heures sont celles de Paris, comme les horaires.
export async function meteoCircuit(gp, maintenant, env) {
  const { lat, lon, sessions } = (gp && gp.interne) || {};
  if (!sessions || !isFinite(lat) || !isFinite(lon)) return { meteo: [], noteMeteo: 'Météo du circuit indisponible' };
  const jours = [];
  for (const [t, nom, duree] of sessions) {
    const w = mural(t), cle = dateDuJour(w);
    let j = jours.find(x => x.cle === cle);
    if (!j) jours.push(j = { cle, w, seances: [] });
    j.seances.push([t, t + duree, SESSIONS_COURTES[nom] || nom]);
  }
  const restants = jours.filter(j => j.seances.some(s => s[1] > maintenant)).slice(0, 4);
  if (!restants.length) return { meteo: [], noteMeteo: 'Séances terminées' };
  const w1 = restants[0].w;
  if (numJour(w1) - numJour(mural(maintenant)) > AVANCE_METEO) {
    const wd = mural(versUTC({ y: w1.y, m: w1.m, d: w1.d - AVANCE_METEO, hh: 12 }, TZ));
    return { meteo: [], noteMeteo: 'Prévisions à partir du ' + JOURS_COURTS[wd.js].toLowerCase() + '. ' + wd.d };
  }
  for (const j of restants) {
    j.debut = Math.floor((Math.min(...j.seances.map(s => s[0])) - HEURE) / HEURE) * HEURE;
    j.fin = Math.ceil((Math.max(...j.seances.map(s => s[1])) + HEURE) / HEURE) * HEURE;
  }
  // Coordonnees arrondies (1 km) : l'adresse ne change pas d'un appel a l'autre, le cache sert
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat.toFixed(2) + '&longitude=' + lon.toFixed(2) +
    '&hourly=temperature_2m,precipitation_probability,wind_speed_10m,wind_direction_10m' +
    '&timezone=Europe%2FParis&wind_speed_unit=kmh' +
    '&start_date=' + dateDuJour(mural(restants[0].debut)) + '&end_date=' + dateDuJour(mural(restants[restants.length - 1].fin));
  const { texte } = await avecSecours(env, 'secours-meteo-f1', 24 * HEURE, async () => {
    const r = await fetch(url, { cf: { cacheTtl: 1800, cacheEverything: true }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  }, url);
  const H = JSON.parse(texte).hourly || {};
  const rang = new Map((H.time || []).map((t, i) => [t, i]));
  const meteo = [];
  for (const j of restants) {
    const n = (j.fin - j.debut) / HEURE + 1;
    const T = [], P = [], V = [], D = [];
    for (let i = 0; i < n; i++) {
      const w = mural(j.debut + i * HEURE), k = rang.get(dateDuJour(w) + 'T' + deux(w.hh) + ':00');
      const val = nom => (k === undefined || !H[nom] || H[nom][k] === null || H[nom][k] === undefined ? null : +H[nom][k]);
      T.push(val('temperature_2m')); P.push(val('precipitation_probability')); V.push(val('wind_speed_10m')); D.push(val('wind_direction_10m'));
    }
    // Un trou dans les temperatures prend la valeur voisine ; un jour sans aucune temperature est saute
    if (T.every(t => t === null)) continue;
    for (let i = 1; i < n; i++) if (T[i] === null) T[i] = T[i - 1];
    for (let i = n - 2; i >= 0; i--) if (T[i] === null) T[i] = T[i + 1];
    // Resume : seulement les heures ou une voiture est en piste
    let min = Infinity, max = -Infinity, p = 0, v = -1, d = '';
    for (const [a, b] of j.seances) {
      for (let i = Math.floor((a - j.debut) / HEURE); i <= Math.ceil((b - j.debut) / HEURE); i++) {
        min = Math.min(min, T[i]); max = Math.max(max, T[i]); p = Math.max(p, P[i] || 0);
        if (V[i] !== null && V[i] > v) { v = V[i]; d = D[i] === null ? '' : directionVent(D[i]); }
      }
    }
    meteo.push({
      j: JOURS_COURTS[j.w.js] + ' ' + j.w.d, min: Math.round(min), max: Math.round(max), p: Math.round(p), v: Math.max(0, Math.round(v)), d,
      g: { h0: mural(j.debut).hh, t: T.map(t => Math.round(t * 10)), p: P.map(x => Math.round(x || 0)),
        s: j.seances.map(([a, b, nom]) => [+((a - j.debut) / HEURE).toFixed(2), +((b - j.debut) / HEURE).toFixed(2), nom]) },
    });
  }
  return meteo.length ? { meteo } : { meteo, noteMeteo: 'Météo du circuit indisponible' };
}
