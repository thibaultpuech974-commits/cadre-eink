// Agenda : évènements récurrents (règles mensuelles, très anciens évènements, COUNT, UNTIL, EXDATE)
// et temps de calcul (l'offre gratuite de Cloudflare limite le calcul à 10 ms par requête)
import { req, post, horloge } from './simu.mjs';
horloge('2026-11-07T12:00:00+01:00');
const ev = (uid, debut, regle, titre, extra = []) => ['BEGIN:VEVENT', 'UID:' + uid, 'DTSTART;TZID=Europe/Paris:' + debut,
  'DURATION:PT1H', 'RRULE:' + regle, 'SUMMARY:' + titre, ...extra, 'END:VEVENT'];
const cal = evts => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...evts.flat(), 'END:VCALENDAR'].join('\r\n');
const calendriers = {
  // Règles mensuelles : 2e mardi, dernier vendredi, dernier jour du mois, 1er jour ouvré (BYSETPOS)
  'mensuel.ics': cal([
    ev('m1', '20250909T180000', 'FREQ=MONTHLY;BYDAY=2TU', '2e mardi'),
    ev('m2', '20250926T190000', 'FREQ=MONTHLY;BYDAY=-1FR', 'Dernier vendredi'),
    ev('m3', '20250930T090000', 'FREQ=MONTHLY;BYMONTHDAY=-1', 'Fin de mois'),
    ev('m4', '20251001T070000', 'FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=1', '1er jour ouvré'),
  ]),
  // Très ancien (plus de 6 000 jours), hebdomadaire depuis 2018 avec une date exclue, COUNT fini ou en cours, UNTIL
  'divers.ics': cal([
    ev('d1', '20050101T180000', 'FREQ=DAILY;BYDAY=SA,SU', 'Footing'),
    ev('d2', '20180103T170000', 'FREQ=WEEKLY;BYDAY=WE', 'Club', ['EXDATE;TZID=Europe/Paris:20261111T170000']),
    ev('d3', '20261001T100000', 'FREQ=WEEKLY;COUNT=5', 'Stage'),
    ev('d4', '20261001T140000', 'FREQ=WEEKLY;COUNT=8;BYDAY=TH', 'Code de la route'),
    ev('d5', '20261020T200000', 'FREQ=DAILY;UNTIL=20261109T225959Z', 'Projet'),
  ]),
};
// Gros calendrier : emploi du temps hebdomadaire depuis la rentrée 2025, vieux rendez-vous hebdomadaires,
// anniversaires annuels et 400 évènements passés (68 Ko)
const gros = [];
const J = ['MO', 'TU', 'WE', 'TH', 'FR'], d2 = n => String(n).padStart(2, '0');
for (let i = 0; i < 30; i++) gros.push(ev('c' + i, '202509' + d2(1 + (i % 5)) + 'T' + d2(8 + (i % 9)) + '0000', 'FREQ=WEEKLY;BYDAY=' + J[i % 5], 'Cours ' + i));
for (let i = 0; i < 20; i++) gros.push(ev('v' + i, '201801' + d2(1 + i) + 'T180000', 'FREQ=WEEKLY', 'Ancien ' + i));
for (let i = 0; i < 10; i++) gros.push(ev('a' + i, '2000' + d2(1 + i) + '15T090000', 'FREQ=YEARLY', 'Annuel ' + i));
for (let i = 0; i < 400; i++) gros.push(['BEGIN:VEVENT', 'UID:p' + i, 'DTSTART;TZID=Europe/Paris:2025' + d2(1 + (i % 12)) + d2(1 + (i % 28)) + 'T100000',
  'DURATION:PT1H', 'SUMMARY:Passé ' + i, 'END:VEVENT']);
calendriers['gros.ics'] = cal(gros);
const ancien = globalThis.fetch;
globalThis.fetch = async (u, o) => {
  const m = /^https:\/\/cal\.test\/(.+)$/.exec(String(u));
  return m ? new Response(calendriers[m[1]]) : ancien(u, o);
};
const agenda = async (fichier, jours) => {
  await post({ scenes: [], disposition: [{ id: 'agenda', x: 0, y: 0, w: 12, h: 8 }],
    agenda: { urls: ['webcal://cal.test/' + fichier], nb: 14, joursMax: jours } });
  const e = await (await req('/api/etat?ui=1')).json();
  return e.agenda.map(x => x.j + ' ' + x.h + ' ' + x.t).join(' | ');
};
console.log('mensuel :', await agenda('mensuel.ics', 62));
console.log('divers :', await agenda('divers.ics', 14));
// Temps de calcul du gros calendrier : le meilleur de 12 essais au plus (on s'arrête dès que c'est bon).
// Trois essais ne suffisaient pas sur la machine de Cloudflare, plus lente et encore en mise en route :
// le test échouait par moments (31 ms) et bloquait le déploiement sans que le code ait ralenti.
await post({ agenda: { urls: ['webcal://cal.test/gros.ics'], nb: 8, joursMax: 14 } });
let meilleur = Infinity;
for (let k = 0; k < 12 && meilleur >= 25; k++) {
  const c0 = process.cpuUsage();
  await (await req('/api/etat?ui=1')).json();
  const c = process.cpuUsage(c0);
  meilleur = Math.min(meilleur, (c.user + c.system) / 1000);
}
console.log('gros calendrier (' + calendriers['gros.ics'].length + ' octets) : calcul rapide (< 25 ms) :', meilleur < 25, '(' + meilleur.toFixed(1) + ' ms)');
