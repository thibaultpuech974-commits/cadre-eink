// Agenda : calendriers iCloud/ICS (récurrences comprises) et anniversaires
import { avecSecours, empreinte, pourEcran } from './commun.js';
import { JOURS_COURTS, TZ, deux, fuseauValide, mural, versUTC } from './temps.js';
import { titreF1 } from './f1.js';

// ---------------------------------------------------------------------
//  Agenda iCloud (fichiers .ics), y compris les evenements recurrents
// ---------------------------------------------------------------------
export async function agenda(o, maintenant, env) {
  const fin = maintenant + Math.max(1, o.joursMax || 14) * 86400e3;
  // Tous les calendriers en meme temps ; un calendrier qui ne repond pas est remplace par sa
  // derniere copie (jusqu'a 7 jours), ou ignore si les autres repondent
  const lus = await Promise.allSettled(o.urls.map(async brut => {
    const url = brut.replace(/^webcal:\/\//i, 'https://');
    const { texte } = await avecSecours(env, 'secours-ics-' + await empreinte(url), 7 * 86400e3, async () => {
      const r = await fetch(url, { cf: { cacheTtl: 900, cacheEverything: true }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error('Calendrier HTTP ' + r.status);
      return r.text();
    });
    return evenementsICS(texte, maintenant, fin);
  }));
  const reussis = lus.filter(l => l.status === 'fulfilled');
  if (o.urls.length && !reussis.length) throw lus[0].reason;
  let tous = [].concat(...reussis.map(l => l.value));
  tous = tous.concat(anniversaires(o.anniversaires || [], maintenant, fin));
  tous.sort((a, b) => a.debut - b.debut || (b.journee ? 1 : 0) - (a.journee ? 1 : 0));

  const auj = mural(maintenant);
  const demain = mural(maintenant + 86400e3);
  const memeJour = (a, b) => a.y === b.y && a.m === b.m && a.d === b.d;
  return tous.slice(0, Math.max(1, Math.min(14, o.nb || 8))).map(e => {
    const enCours = e.debut < maintenant;
    const w = enCours ? auj : mural(e.debut);
    const j = memeJour(w, auj) ? "Aujourd'hui" : memeJour(w, demain) ? 'Demain' : JOURS_COURTS[w.js] + ' ' + w.d;
    let h = '';
    if (!e.journee) h = enCours ? 'en cours' : deux(w.hh) + ':' + deux(w.mi);
    const f1 = titreF1(e.titre);
    const t = pourEcran(f1 === e.titre ? f1 : sessionCourte(f1));
    // 100 caracteres au plus : la carte met un titre long sur 2 ou 3 lignes quand le bloc a de la place
    const ligne = { j, h, t: t.length > 100 ? t.slice(0, 97) + '...' : t };
    // Pastille de la carte : numero du jour et jour de la semaine (ou "Auj.", "Dem.")
    ligne.n = String(w.d);
    ligne.s = j === "Aujourd'hui" ? 'Auj.' : j === 'Demain' ? 'Dem.' : JOURS_COURTS[w.js];
    // Lieu (salle, adresse...) : affiche apres le titre, sauf s'il y figure deja ou si l'option est decochee
    const l = o.lieu !== false && e.lieu ? pourEcran(e.lieu) : '';
    if (l && !t.toLowerCase().includes(l.toLowerCase())) ligne.l = l.length > 32 ? l.slice(0, 29) + '...' : l;
    return ligne;
  });
}
// Seances de F1 abregees dans l'agenda, pour tenir sur une ligne ("GP de Las Vegas - EL1")
function sessionCourte(t) {
  return t.replace(/Essais libres (\d)$/, 'EL$1').replace(/Qualif\. sprint$/, 'Qualif sprint').replace(/Qualifications$/, 'Qualif');
}
// Prochaine occurrence de chaque anniversaire (evenement "journee entiere")
function anniversaires(liste, maintenant, fin) {
  const auj = mural(maintenant);
  const res = [];
  for (const a of liste) {
    for (const y of [auj.y, auj.y + 1]) {
      let j = a.j;
      const nbJ = new Date(Date.UTC(y, a.m, 0)).getUTCDate();
      if (j > nbJ) j = nbJ;                       // 29 fevrier -> 28 les autres annees
      const passe = a.m < auj.m || (a.m === auj.m && j < auj.d);
      if (y === auj.y && passe) continue;
      const debut = versUTC({ y, m: a.m, d: j }, TZ);
      if (debut < fin) {
        const age = a.a ? y - a.a : 0;
        res.push({ debut, journee: true, titre: 'Anniversaire de ' + a.nom + (age > 0 ? ' (' + age + ' ans)' : '') });
      }
      break;
    }
  }
  return res;
}
function lireDateICS(v, p) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(String(v).trim());
  if (!m) return null;
  const w = { y: +m[1], m: +m[2], d: +m[3], hh: +(m[4] || 0), mi: +(m[5] || 0), ss: +(m[6] || 0) };
  const journee = (p && p.VALUE === 'DATE') || m[4] === undefined;
  const tz = m[7] ? 'UTC' : (p && p.TZID ? fuseauValide(p.TZID) : TZ);
  return { w, journee, tz, utc: versUTC(w, tz) };
}
function lireDuree(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v).trim());
  if (!m) return 0;
  const s = ((+m[2] || 0) * 7 + (+m[3] || 0)) * 86400 + (+m[4] || 0) * 3600 + (+m[5] || 0) * 60 + (+m[6] || 0);
  return (m[1] === '-' ? -s : s) * 1000;
}
function analyserICS(texte) {
  const lignes = texte.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const evts = [];
  let e = null;
  for (const l of lignes) {
    if (l === 'BEGIN:VEVENT') { e = {}; continue; }
    if (l === 'END:VEVENT') { if (e) evts.push(e); e = null; continue; }
    if (!e) continue;
    const i = l.indexOf(':');
    if (i < 0) continue;
    const [nom, ...params] = l.slice(0, i).split(';');
    const p = {};
    for (const x of params) {
      const j = x.indexOf('=');
      if (j > 0) p[x.slice(0, j).toUpperCase()] = x.slice(j + 1).replace(/^"|"$/g, '');
    }
    const valeur = l.slice(i + 1);
    const N = nom.toUpperCase();
    if (N === 'EXDATE') (e.exdate = e.exdate || []).push(...valeur.split(',').map(v => ({ v, p })));
    else e[N] = { v: valeur, p };
  }
  return evts;
}
export function evenementsICS(texte, debutFenetre, finFenetre) {
  const evts = analyserICS(texte);
  // Occurrences modifiees d'un evenement recurrent (RECURRENCE-ID)
  const surcharges = new Set();
  for (const e of evts) {
    if (e['RECURRENCE-ID'] && e.UID) {
      const d = lireDateICS(e['RECURRENCE-ID'].v, e['RECURRENCE-ID'].p);
      if (d) surcharges.add(e.UID.v + '|' + d.utc);
    }
  }
  const res = [];
  for (const e of evts) {
    if (!e.DTSTART) continue;
    if (e.STATUS && e.STATUS.v.toUpperCase() === 'CANCELLED') continue;
    const titre = e.SUMMARY ? e.SUMMARY.v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim() : '(sans titre)';
    // Lieu : la premiere ligne du champ LOCATION (l'iPhone met le nom, puis l'adresse sur les lignes suivantes)
    const lieu = e.LOCATION ? (e.LOCATION.v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1').split('\n').map(x => x.trim()).filter(Boolean)[0] || '') : '';
    const estSurcharge = !!e['RECURRENCE-ID'];
    for (const o of occurrences(e, debutFenetre, finFenetre)) {
      if (!estSurcharge && e.UID && surcharges.has(e.UID.v + '|' + o.debut)) continue;
      res.push({ debut: o.debut, journee: o.journee, titre, lieu });
    }
  }
  return res;
}
// Date d'un champ ICS lue comme si elle etait en UTC (sans fuseau) : a 14 h pres, de quoi ecarter vite
// un evenement tres loin de la fenetre
function dateNaiveICS(v) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/.exec(String(v).trim());
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) : null;
}
function occurrences(ev, debutFenetre, finFenetre) {
  // Evenement unique nettement hors de la fenetre (les centaines d'evenements passes d'un calendrier) :
  // ecarte sans conversion de fuseau, la partie la plus couteuse. Marge de 2 jours pour les fuseaux.
  if (!ev.RRULE || ev['RECURRENCE-ID']) {
    const n0 = dateNaiveICS(ev.DTSTART.v), n1 = ev.DTEND ? dateNaiveICS(ev.DTEND.v) : null;
    const dn = n1 !== null && n0 !== null ? n1 - n0 : ev.DURATION ? lireDuree(ev.DURATION.v) : 0;
    if (n0 !== null && (n0 - 2 * 86400e3 >= finFenetre || n0 + Math.max(dn, 86400e3) + 2 * 86400e3 <= debutFenetre)) return [];
  }
  const ds = lireDateICS(ev.DTSTART.v, ev.DTSTART.p);
  if (!ds) return [];
  let duree;
  if (ev.DTEND) {
    const de = lireDateICS(ev.DTEND.v, ev.DTEND.p);
    duree = de ? de.utc - ds.utc : 3600e3;
  } else if (ev.DURATION) duree = lireDuree(ev.DURATION.v);
  else duree = ds.journee ? 86400e3 : 0;

  const exclus = new Set();
  for (const x of ev.exdate || []) {
    const d = lireDateICS(x.v, x.p);
    if (d) exclus.add(d.utc);
  }
  const res = [];
  const ajouter = utc => {
    if (exclus.has(utc)) return;
    if (utc + Math.max(duree, 1) > debutFenetre && utc < finFenetre) res.push({ debut: utc, journee: ds.journee });
  };
  if (!ev.RRULE || ev['RECURRENCE-ID']) { ajouter(ds.utc); return res; }

  const r = {};
  for (const x of ev.RRULE.v.split(';')) {
    const j = x.indexOf('=');
    if (j > 0) r[x.slice(0, j).toUpperCase()] = x.slice(j + 1);
  }
  const freq = (r.FREQ || '').toUpperCase();
  const inter = Math.max(1, parseInt(r.INTERVAL || '1', 10));
  let compte = r.COUNT ? parseInt(r.COUNT, 10) : Infinity;
  let jusqua = Infinity;
  if (r.UNTIL) {
    const u = lireDateICS(r.UNTIL, {});
    if (u) jusqua = u.journee ? u.utc + 86400e3 - 1 : u.utc;
  }
  const NUM = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  // BYDAY : jours de la semaine, avec un rang facultatif en mensuel ("2TU" = 2e mardi, "-1FR" = dernier vendredi)
  const parJourRang = (r.BYDAY || '').split(',').map(s => /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(s.trim()))
    .filter(Boolean).map(m => ({ n: m[1] ? parseInt(m[1], 10) : 0, j: NUM[m[2].toUpperCase()] }));
  const parJour = parJourRang.map(x => x.j);
  // BYMONTHDAY : jours du mois ("15", "-1" = dernier jour) ; BYSETPOS : une position parmi les dates du mois
  const parJourMois = (r.BYMONTHDAY || '').split(',').map(s => parseInt(s, 10)).filter(n => n && Math.abs(n) <= 31);
  const position = parseInt(r.BYSETPOS || '0', 10) || 0;
  const J = 86400e3;
  const w0 = ds.w;
  const base = Date.UTC(w0.y, w0.m - 1, w0.d);
  const heureMs = ((w0.hh || 0) * 3600 + (w0.mi || 0) * 60 + (w0.ss || 0)) * 1000;
  const aUTC = dateMs => {
    const d = new Date(dateMs);
    return versUTC({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: w0.hh, mi: w0.mi, ss: w0.ss }, ds.tz);
  };
  // Une date finie bien avant la fenetre n'est pas convertie dans son fuseau (deux appels a Intl, la partie
  // la plus couteuse) : elle compte seulement pour COUNT. Marge de 2 jours pour l'heure et le fuseau.
  const avantFenetre = dm => dm + heureMs + Math.max(duree, 0) + 2 * J < debutFenetre;
  // Sans COUNT, on part directement de la periode qui precede la fenetre, au lieu de tout derouler depuis
  // la premiere date (un cours hebdomadaire de la rentree, un rappel quotidien de 2005...). Les mois sont
  // comptes pour 31 jours et les annees pour 366 : on ne saute jamais une periode qui toucherait la fenetre.
  let k0 = 0;
  const recul = debutFenetre - Math.max(duree, 0) - 3 * J - base;
  if (compte === Infinity && recul > 0) {
    const periode = { DAILY: 1, WEEKLY: 7, MONTHLY: 31, YEARLY: 366 }[freq];
    if (periode) k0 = Math.floor(recul / (inter * periode * J));
  }

  for (let k = k0; k < k0 + 6000 && compte > 0; k++) {
    let dates = [];
    if (freq === 'DAILY') {
      const dm = base + k * inter * J;
      if (!parJour.length || parJour.includes(new Date(dm).getUTCDay())) dates = [dm];
    } else if (freq === 'WEEKLY') {
      if (parJour.length) {
        const lundi = base - ((new Date(base).getUTCDay() + 6) % 7) * J + k * inter * 7 * J;
        dates = parJour.map(j => lundi + ((j + 6) % 7) * J).sort((a, b) => a - b).filter(x => x >= base);
      } else dates = [base + k * inter * 7 * J];
    } else if (freq === 'MONTHLY') {
      const m = new Date(Date.UTC(w0.y, w0.m - 1 + k * inter, 1));
      const an = m.getUTCFullYear(), mois = m.getUTCMonth();
      const nbJ = new Date(Date.UTC(an, mois + 1, 0)).getUTCDate();
      const jourDuMois = n => (n > 0 ? n : nbJ + 1 + n);
      let jours = [];
      if (parJourRang.length) {
        for (const { n, j } of parJourRang) {
          const tous = [];
          for (let d = 1 + ((j - m.getUTCDay() + 7) % 7); d <= nbJ; d += 7) tous.push(d);
          if (!n) jours.push(...tous);
          else { const d = n > 0 ? tous[n - 1] : tous[tous.length + n]; if (d) jours.push(d); }
        }
        if (parJourMois.length) jours = jours.filter(d => parJourMois.some(n => jourDuMois(n) === d));   // ex. vendredi 13
      } else if (parJourMois.length) jours = parJourMois.map(jourDuMois);
      else jours = [w0.d];
      jours = [...new Set(jours)].filter(d => d >= 1 && d <= nbJ).sort((a, b) => a - b);
      if (position) { const d = position > 0 ? jours[position - 1] : jours[jours.length + position]; jours = d ? [d] : []; }
      dates = jours.map(d => Date.UTC(an, mois, d)).filter(x => x >= base);
    } else if (freq === 'YEARLY') {
      const dm = Date.UTC(w0.y + k * inter, w0.m - 1, w0.d);
      if (new Date(dm).getUTCDate() === w0.d) dates = [dm];
    } else {
      ajouter(ds.utc);
      break;
    }
    let stop = false;
    for (const dm of dates) {
      if (compte <= 0) { stop = true; break; }
      if (avantFenetre(dm)) { compte--; continue; }
      const utc = aUTC(dm);
      if (utc > jusqua || utc >= finFenetre) { stop = true; break; }
      compte--;
      ajouter(utc);
    }
    if (stop) break;
  }
  return res;
}
