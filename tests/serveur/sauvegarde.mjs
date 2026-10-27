// Sauvegarde et restauration des réglages
import { kv, req, post, horloge } from './simu.mjs';
horloge('2026-10-27T12:00:00+01:00');
await post({ scenes: [{ id: 'bus', nom: 'Bus', creneaux: [{ jours: [0,0,0,0,1,0,0], debut: '18:00', fin: '20:00' }], reveilMin: 3,
  disposition: [{ id: 'bus', x: 0, y: 0, w: 6, h: 4 }] }], agenda: { urls: ['webcal://ics.test/a.ics'], anniversairesTexte: 'Léa 14/03/2005' },
  meteo: { ville: 'Lattes', lat: 43.57, lon: 3.9 } });
kv.set('bus', { v: JSON.stringify({ arrets: ['Gare'], passages: [['T', 0, 0, 0, 1, 'x']] }) });
const r = await req('/api/sauvegarde');
const fichier = await r.text();
const s = JSON.parse(fichier);
console.log('sauvegarde :', r.status, r.headers.get('content-disposition'), '|', fichier.length, 'octets | scènes', s.config.scenes.map(x => x.nom),
  '| ville', s.config.meteo.ville, '| anniversaires', s.config.agenda.anniversaires.length, '| bus', s.bus.arrets, '| sans photo :', !('photo' in s.config));
// Fausse manipulation puis restauration
await post({ scenes: [], meteo: { ville: 'Paris', lat: 48.85, lon: 2.35 }, agenda: { urls: [], anniversairesTexte: '' } });
kv.delete('bus');
await req('/api/photo?r=0', { method: 'POST', body: new Uint8Array(81600) });   // photo envoyée entre-temps
const avant = (await (await req('/api/config')).json()).config;
const rr = await req('/api/sauvegarde', { method: 'POST', body: fichier });
const c = (await (await req('/api/config')).json()).config;
console.log('restauration :', rr.status, '| scènes', c.scenes.map(x => x.nom + ' ' + x.creneaux[0].debut), '| ville', c.meteo.ville, '| agenda', c.agenda.urls.length,
  'url,', c.agenda.anniversaires.map(a => a.nom), '| bus', JSON.parse(kv.get('bus').v).arrets, '| photo gardée :', c.photo.version === avant.photo.version && c.photo.version > 0);
console.log('fichier invalide :', (await req('/api/sauvegarde', { method: 'POST', body: '{"a":1}' })).status, (await req('/api/sauvegarde', { method: 'POST', body: 'pas du json' })).status);
// Ancienne sauvegarde (avant les scènes) : convertie
const vieux = { format: 'cadre-eink', version: 1, config: { disposition: [{ id: 'date', x: 0, y: 0, w: 12, h: 1 }, { id: 'bus', x: 0, y: 1, w: 6, h: 3 }],
  bus: { toujours: false, creneaux: [{ jours: [1,0,0,0,0,0,0], debut: '07:00', fin: '08:00' }], reveilMin: 5 } } };
await req('/api/sauvegarde', { method: 'POST', body: JSON.stringify(vieux) });
const c2 = (await (await req('/api/config')).json()).config;
console.log('ancienne sauvegarde :', c2.scenes.map(x => x.nom + ' r=' + x.reveilMin), '| défaut', c2.disposition.map(d => d.id));
