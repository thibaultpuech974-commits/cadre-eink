// Demandes en parallèle et copies de secours (météo, agenda) quand une source ne répond pas
import { kv, req, post, etat, horloge } from './simu.mjs';
await post({ scenes: [], disposition: [{ id: 'date', x: 0, y: 0, w: 12, h: 1 }, { id: 'meteo', x: 0, y: 1, w: 12, h: 3 },
  { id: 'agenda', x: 0, y: 4, w: 6, h: 4 }, { id: 'courbe', x: 6, y: 4, w: 6, h: 4 }],
  agenda: { urls: ['webcal://ics.test/maths.ics', 'https://ics.test/autre.ics'] } });
let e = await etat('2026-10-27T10:00:00+01:00');
console.log('normal :', e.meteo.t + '°', e.meteo.desc, '|', e.agenda.map(a => a.j + ' ' + a.h + ' ' + a.t).join(' ; '));
console.log('copies enregistrées :', [...kv.keys()].filter(k => k.startsWith('secours')).length);
// 3 h plus tard, plus de réseau : la météo vient de la copie (température de l'heure actuelle), l'agenda aussi
globalThis.panne = ['meteo', 'ics'];
e = await etat('2026-10-27T13:00:00+01:00');
console.log('panne 3 h :', e.meteo.erreur || e.meteo.t + '° (prévu à 13 h) ' + e.meteo.desc, '| courbe dès', e.meteo.courbe && e.meteo.courbe.h0 + 'h',
  '|', e.agenda.erreur || e.agenda.map(a => a.j + ' ' + a.t).join(' ; '));
// Un seul calendrier en panne : l'autre suffit (et la copie n'est pas nécessaire)
// Après 2 jours de panne : la météo n'est plus utilisée (24 h max), l'agenda oui (7 jours)
e = await etat('2026-10-29T13:00:00+01:00');
console.log('panne 2 jours :', e.meteo.erreur, '|', e.agenda.erreur || 'agenda ok (' + e.agenda.length + ' évènements)');
// Ville changée pendant la panne : la copie d'une autre ville n'est pas utilisée
globalThis.panne = [];
await post({ meteo: { ville: 'Lyon', lat: 45.76, lon: 4.84 } });
e = await etat('2026-10-29T14:00:00+01:00');
globalThis.panne = ['meteo'];
e = await etat('2026-10-29T15:00:00+01:00');
console.log('après changement de ville puis panne :', e.meteo.erreur || 'copie de Lyon utilisée');
await post({ meteo: { ville: 'Nîmes', lat: 43.84, lon: 4.36 } });
e = await etat('2026-10-29T15:10:00+01:00');
console.log('retour à Nîmes, panne :', e.meteo.erreur || 'copie utilisée', '(copie de Lyon seulement)');
// Écritures limitées : 12 réveils en 2 h -> au plus 2 copies par source
globalThis.panne = []; let n = 0; const put0 = kv.set.bind(kv);
kv.set = (k, v) => { if (k.startsWith('secours')) n++; return put0(k, v); };
for (let i = 0; i < 12; i++) await etat(new Date(Date.UTC(2026, 9, 30, 8, i * 10)).toISOString());
console.log('écritures de copies pour 12 réveils en 2 h :', n, '(3 sources)');
