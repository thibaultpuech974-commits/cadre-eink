// Blocs « Soleil et lune », « Calendrier du mois » et « À faire »
import fs from 'fs';
import { req, post, horloge, KV } from './simu.mjs';
import { ROLES } from '../../serveur/acces.js';
import { soleil, elongation, prochaineLune } from '../../serveur/astro.js';
const hm = ms => new Date(ms).toISOString().slice(11, 16);
const etat = async () => (await req('/api/etat?ui=1')).json();

// --- Calculs, comparés à des éphémérides connues (heures UTC) ---
let s = soleil(2026, 6, 21, 48.8566, 2.3522);
console.log('soleil à Paris le 21/06/2026 :', hm(s.lever), hm(s.coucher));           // 03:47 et 19:58 à 2 min près
console.log('pleine lune du 21/01/2000 à 04:40 :', Math.abs(elongation(Date.UTC(2000, 0, 21, 4, 40)) - 180) < 1,
  '| nouvelle lune du 08/04/2024 à 18:21 :', Math.min(elongation(Date.UTC(2024, 3, 8, 18, 21)), 1) < 1);
let t = Date.UTC(2026, 0, 1); const lunes = [];
for (let i = 0; i < 4; i++) { const p = prochaineLune(t); lunes.push(p.nom + ' ' + new Date(p.t).toISOString().slice(5, 10)); t = p.t + 86400e3; }
console.log('lunes de 2026 :', lunes.join(', '));
console.log('soleil de minuit (78° nord, 21 juin) :', soleil(2026, 6, 21, 78, 15));

// --- Bloc Soleil et lune ---
horloge('2026-11-14T08:00:00+01:00');
await post({ scenes: [], disposition: [{ id: 'astro', x: 0, y: 0, w: 6, h: 2 }], meteo: { ville: 'Nîmes', lat: 43.84, lon: 4.36 } });
let e = await etat();
console.log('Nîmes le 14/11/2026 :', JSON.stringify(e.astro));
const s1 = e.sig; horloge('2026-11-14T23:30:00+01:00'); const s2 = (await etat()).sig;
horloge('2026-11-15T00:30:00+01:00'); e = await etat();
console.log('même jour : signature identique', s1 === s2, '| lendemain : signature changée', e.sig !== s1, '| lever', e.astro.lever);
horloge('2026-11-24T10:00:00+01:00'); e = await etat();
console.log('24/11 :', e.astro.lune, e.astro.p, e.astro.ecl + ' % |', e.astro.suite);
await post({ meteo: { ville: 'Sydney', lat: -33.87, lon: 151.21 } }); horloge('2026-11-14T08:00:00+01:00');
console.log('hémisphère sud : lune retournée', (await etat()).astro.p);
await post({ meteo: { ville: 'Nîmes', lat: 43.84, lon: 4.36 } });

// --- Calendrier du mois ---
const ev = (uid, debut, titre, plus = []) => ['BEGIN:VEVENT', 'UID:' + uid, 'DTSTART;TZID=Europe/Paris:' + debut, 'DURATION:PT1H', 'SUMMARY:' + titre, ...plus, 'END:VEVENT'];
const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0',
  ...ev('a', '20261103T100000', 'Déjà passé'), ...ev('b', '20261114T173000', 'Colle de maths'), ...ev('c', '20261117T080000', 'Dentiste'),
  ...ev('d', '20261116T080000', 'Cours', ['RRULE:FREQ=WEEKLY;COUNT=6']), ...ev('f', '20261202T090000', 'En décembre'),
  'END:VCALENDAR'].join('\r\n');
let lectures = 0;
const ancien = globalThis.fetch;
globalThis.fetch = async (u, o) => (String(u).includes('cal.test') ? (lectures++, new Response(ics)) : ancien(u, o));
await post({ disposition: [{ id: 'mois', x: 0, y: 0, w: 5, h: 5 }, { id: 'agenda', x: 5, y: 0, w: 7, h: 5 }], agenda: { urls: ['webcal://cal.test/a.ics'], nb: 4, joursMax: 5 } });
e = await etat();
console.log('mois :', JSON.stringify(e.mois), '| calendrier lu', lectures, 'fois');
console.log('agenda (5 jours, inchangé) :', e.agenda.map(x => x.j + ' ' + x.h + ' ' + x.t).join(' | '));
horloge('2026-11-30T23:00:00+01:00'); e = await etat(); console.log('30/11 au soir :', e.mois.t, e.mois.a, JSON.stringify(e.mois.e));
horloge('2026-12-01T00:30:00+01:00'); e = await etat(); console.log('01/12 :', e.mois.t, '| 1er en colonne', e.mois.p, '|', e.mois.n, 'jours |', JSON.stringify(e.mois.e));
horloge('2027-02-10T12:00:00+01:00'); e = await etat(); console.log('février 2027 :', e.mois.p, e.mois.n);
await post({ agenda: { urls: [] } }); e = await etat();
console.log('sans calendrier : grille', e.mois.n, 'jours, marques', e.mois.e.length);
await post({ disposition: [{ id: 'date', x: 0, y: 0, w: 12, h: 1 }] }); e = await etat();
console.log('sans les blocs :', 'astro' in e || 'mois' in e ? 'données envoyées' : 'rien');

// --- À faire : tâches de la page, liste envoyée par le raccourci iPhone ---
horloge('2026-11-14T18:00:00+01:00');
let ecritures = 0; const mettre = KV.put.bind(KV); KV.put = async (...a) => { ecritures++; return mettre(...a); };
const envoyer = async corps => (await req('/api/taches', { method: 'POST', body: corps })).text();
let r = await post({ disposition: [{ id: 'taches', x: 0, y: 0, w: 6, h: 6 }], taches: { texte: '- Rendre le DM de maths\n\n  [ ] Acheter des piles  \n• Appeler Mamie\n' + 'x'.repeat(200) } });
console.log('page :', JSON.stringify(r.config.taches.liste.slice(0, 3)), '| 4e coupée à', r.config.taches.liste[3].length, 'caractères');
await post({ taches: { texte: 'Rendre le DM de maths\nAcheter des piles' } });
console.log('raccourci (texte) :', await envoyer('Acheter des piles\r\nRéviser la colle 📚\nLire Woolf\n'));
e = await etat(); console.log('bloc :', JSON.stringify(e.taches));
ecritures = 0; const v1 = e.version;
console.log('même liste renvoyée :', await envoyer('Acheter des piles\nRéviser la colle 📚\nLire Woolf'), '| écritures', ecritures);
console.log('raccourci (JSON, texte) :', await envoyer(JSON.stringify({ taches: 'Footing\nPiscine' })), '|', JSON.stringify((await etat()).taches));
console.log('raccourci (JSON) :', await envoyer(JSON.stringify({ taches: ['Footing', { titre: 'Dentiste' }] })), '|', JSON.stringify((await etat()).taches));
r = await post({ taches: { texte: 'Une seule' } });
console.log('la page ne touche pas aux rappels :', JSON.stringify(r.config.taches.rappels), '| reçus à', new Date(r.config.taches.rappelsT).toISOString().slice(0, 16));
const sauv = await (await req('/api/sauvegarde')).text();
r = await post({ taches: { rappels: [] } }); console.log('bouton Effacer :', JSON.stringify(r.config.taches));
console.log('liste vide envoyée :', await envoyer(''), '| trop longue :', (await envoyer(Array.from({ length: 30 }, (_, i) => 'Tâche ' + i).join('\n'))));
console.log('restauration :', (await req('/api/sauvegarde', { method: 'POST', body: sauv })).status, JSON.stringify((await (await req('/api/config')).json()).config.taches.rappels));
await post({ taches: { texte: '', rappels: [] } }); console.log('rien à faire :', JSON.stringify((await etat()).taches));
console.log('droit du raccourci :', ROLES.raccourci.includes('POST /api/taches'), '| de la carte :', ROLES.carte.includes('POST /api/taches'));
