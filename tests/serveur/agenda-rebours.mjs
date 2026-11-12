// Agenda : lieu des évènements (champ LOCATION) ; bloc Compte à rebours : jours restants avant une date
import { req, post, horloge } from './simu.mjs';
horloge('2026-11-10T12:00:00+01:00');
const ev = (uid, debut, titre, lieu) => ['BEGIN:VEVENT', 'UID:' + uid, 'DTSTART;TZID=Europe/Paris:' + debut, 'DURATION:PT1H', 'SUMMARY:' + titre]
  .concat(lieu ? ['LOCATION:' + lieu] : [], ['END:VEVENT']);
const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0',
  ...ev('a', '20261110T173000', 'Colle de maths', 'C104'),
  ...ev('b', '20261111T080000', 'Dentiste', 'Cabinet du Dr Martin\\n12 rue de la République\\, 30000 Nîmes'),
  ...ev('c', '20261111T100000', 'Cours de maths\\, salle B12', 'Salle B12'),
  ...ev('d', '20261111T140000', 'Anglais'),
  ...ev('e', '20261112T090000', 'Visite', '🏛 Musée de la Romanité\\, un lieu au nom vraiment très long pour un écran'),
  ...ev('f', '20261112T180000', 'FORMULA 1 LAS VEGAS GRAND PRIX 2026 - Practice 1', 'Las Vegas Strip Circuit'),
  'END:VCALENDAR'].join('\r\n');
const ancien = globalThis.fetch;
globalThis.fetch = async (u, o) => (String(u).includes('cal.test') ? new Response(ics) : ancien(u, o));
const D = [{ id: 'agenda', x: 0, y: 0, w: 8, h: 6 }, { id: 'rebours', x: 8, y: 0, w: 4, h: 6 }];
const etat = async () => (await req('/api/etat?ui=1')).json();
await post({ scenes: [], disposition: D, agenda: { urls: ['webcal://cal.test/a.ics'], nb: 8, joursMax: 14 } });
let e = await etat();
console.log('lieux :', e.agenda.map(x => x.j + ' ' + x.h + ' ' + x.t + (x.l ? ' @ ' + x.l : '')).join(' | '));
await post({ agenda: { lieu: false } });
console.log('option décochée :', (await etat()).agenda.some(x => 'l' in x) ? 'lieux envoyés' : 'aucun lieu');
// Compte à rebours : texte de la page -> liste ; dates annuelles, passées, illisibles
let r = await (await req('/api/config', { method: 'POST', body: JSON.stringify({ rebours: { texte:
  'Vacances de Noël 19/12/2026\nConcours blanc 14/01/2027\nRentrée 02/09\nNouvel an 1/1\nDéjà passé 01/11/2026\nAujourd\'hui 10/11\npas une date\n' } }) })).json();
console.log('enregistré :', r.config.rebours.liste.map(d => d.nom + '=' + d.j + '/' + d.m + '/' + d.a).join(' '), '| ignorées :', r.ignoreesRebours.join(','));
e = await etat();
console.log('rebours :', e.rebours.map(x => 'J-' + x.n + ' ' + x.t + ' (' + x.d + ')').join(' | '));
// Le lendemain, un jour de moins ; la signature (bloc seul) change une fois par jour seulement
await post({ disposition: [D[1]] });
const s1 = (await etat()).sig; horloge('2026-11-10T23:50:00+01:00'); const s2 = (await etat()).sig;
horloge('2026-11-11T00:10:00+01:00'); e = await etat();
console.log('même jour : signature identique', s1 === s2, '| lendemain :', e.rebours[0].n, e.rebours[0].t, '| signature changée', e.sig !== s1);
// Changement d'heure (29 mars 2027) : le compte reste en jours entiers
horloge('2027-03-27T12:00:00+01:00'); await post({ rebours: { texte: 'Lundi 29/03/2027' } }); console.log('avant le changement d\'heure :', (await etat()).rebours[0].n, 'jours');
// Sans le bloc, pas de données ; bloc vide ; sauvegarde et restauration
await post({ disposition: [D[0]] }); console.log('sans le bloc :', 'rebours' in (await etat()) ? 'données envoyées' : 'rien');
const sauv = await (await req('/api/sauvegarde')).text();
await post({ rebours: { texte: '' }, disposition: D }); console.log('liste vide :', JSON.stringify((await etat()).rebours));
console.log('restauration :', (await req('/api/sauvegarde', { method: 'POST', body: sauv })).status, (await (await req('/api/config')).json()).config.rebours.liste.map(d => d.nom).join(','));
