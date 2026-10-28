// État des calendriers (menu Agenda) : accessible ? combien d'évènements ?
import { req, horloge } from './simu.mjs';
horloge('2026-10-27T12:00:00+01:00');
const etat = async urls => (await req('/api/agenda-etat', { method: 'POST', body: JSON.stringify({ urls }) })).json();
let d = await etat(['webcal://ics.test/maths.ics', '', 'pas une adresse', 'https://introuvable.test/x.ics']);
for (const c of d.calendriers) console.log(c.ok ? 'ok ' + c.n + ' évènement(s)' : 'erreur : ' + c.erreur, '|', c.url);
console.log('fenêtre :', d.jours, 'jours');
globalThis.panne = ['ics'];
d = await etat(['webcal://ics.test/maths.ics']);
console.log('panne :', d.calendriers[0].erreur);
