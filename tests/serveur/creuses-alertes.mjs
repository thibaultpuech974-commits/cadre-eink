// Heures creuses (réveils espacés sur des plages jours + heures) et alertes sur l'iPhone (ntfy)
import w from '../../serveur/worker.js';
import { kv, KV, req, post, etat, horloge } from './simu.mjs';
const env = { CLE: 'secret', CADRE: KV };
const D = ids => ids.map((id, i) => ({ id, x: 0, y: i ? 2 * i - 1 : 0, w: 12, h: i ? 2 : 1 }));
// --- 1. Heures creuses : lun-ven 8 h-17 h, réveil toutes les 2 h ; une scène à son propre rythme le mardi midi
let r = await post({ reveilMin: 10, disposition: D(['date', 'meteo']),
  scenes: [{ id: 'midi', nom: 'Midi', creneaux: [{ jours: [0, 1, 0, 0, 0, 0, 0], debut: '12:00', fin: '13:00' }], reveilMin: 5, disposition: D(['date', 'courbe']) }],
  creuses: { actif: true, intervalleMin: 120, creneaux: [{ jours: [1, 1, 1, 1, 1, 0, 0], debut: '08:00', fin: '17:00' }, { jours: [1, 0, 0, 0, 0, 0, 0], debut: '18:00', fin: '09:00' }] } });
console.log('plages gardées :', r.config.creuses.creneaux.map(c => c.debut + '-' + c.fin).join(','), '| intervalle', r.config.creuses.intervalleMin);
const reveils = [];
for (const [nom, iso] of [['mar 7h50', '2026-11-10T07:50:00+01:00'], ['mar 9h00', '2026-11-10T09:00:00+01:00'], ['mar 11h00', '2026-11-10T11:00:00+01:00'],
  ['mar 12h30', '2026-11-10T12:30:00+01:00'], ['mar 16h30', '2026-11-10T16:30:00+01:00'], ['mar 17h10', '2026-11-10T17:10:00+01:00'], ['sam 10h00', '2026-11-14T10:00:00+01:00']]) {
  reveils.push(nom + ' ' + (await etat(iso)).reveil);
}
console.log('réveils :', reveils.join(' | '));
await post({ creuses: { actif: false } });
console.log('décochées :', (await etat('2026-11-10T09:00:00+01:00')).reveil, '| plages gardées', (await (await req('/api/config')).json()).config.creuses.creneaux.length);
await post({ reveilMin: 60, creuses: { actif: true, intervalleMin: 30 } });
console.log('jamais plus souvent que le rythme normal :', (await etat('2026-11-10T09:00:00+01:00')).reveil);
await post({ reveilMin: 10, creuses: { actif: false }, scenes: [] });

// --- 2. Alertes : notifications ntfy envoyées par le déclencheur planifié
const notifs = [];
const ancien = globalThis.fetch;
let ntfyEnPanne = false;
globalThis.fetch = async (u, o) => {
  if (String(u) !== 'https://ntfy.sh/') return ancien(u, o);
  if (ntfyEnPanne) return new Response('panne', { status: 503 });
  notifs.push(JSON.parse(o.body)); return new Response('{}');
};
const cron = async (iso) => { if (iso) horloge(iso); const avant = notifs.length; await w.scheduled({}, env, {}); return notifs.slice(avant).map(n => n.title + ' [' + n.topic + ']').join(' + ') || 'rien'; };
const SUJET = 'cadre-Ab12Cd34Ef56Gh78';
console.log('sujet trop court :', (await req('/api/config', { method: 'POST', body: JSON.stringify({ alertes: { actif: true, sujet: 'cadre' } }) })).status,
  '| actif sans sujet :', (await req('/api/config', { method: 'POST', body: JSON.stringify({ alertes: { actif: true } }) })).status);
horloge('2026-11-10T12:00:00+01:00');
await req('/api/etat?bat=4.05&pct=85&fw=20261108-101500');
console.log('alertes désactivées :', await cron('2026-11-10T20:00:00+01:00'));
await post({ alertes: { actif: true, sujet: SUJET } });
horloge('2026-11-10T12:00:00+01:00');
await req('/api/etat?bat=4.05&pct=85&fw=20261108-101500');
console.log('tout va bien :', await cron('2026-11-10T12:07:00+01:00'), '| 2 h après :', await cron('2026-11-10T14:07:00+01:00'));
console.log('5 h sans nouvelles :', await cron('2026-11-10T17:07:00+01:00'), '|', notifs.at(-1).message);
console.log('une heure après :', await cron('2026-11-10T18:07:00+01:00'), '| rappel le lendemain :', await cron('2026-11-11T17:07:00+01:00'));
ntfyEnPanne = true; await req('/api/etat?bat=3.62&pct=15&fw=20261108-101500');
console.log('ntfy en panne :', await cron('2026-11-11T18:07:00+01:00'));
ntfyEnPanne = false;
console.log('retour, batterie à 15 % :', await cron('2026-11-11T19:07:00+01:00'), '|', notifs.at(-1).message);
// Le pourcentage hésite autour du seuil : pas de nouvelle notification ; en charge : l'alerte repart de zéro
const vu = async (iso, q) => { horloge(iso); await req('/api/etat?fw=20261108-101500&' + q); };
await vu('2026-11-11T20:00:00+01:00', 'bat=3.66&pct=21'); const h1 = await cron('2026-11-11T20:07:00+01:00');
await vu('2026-11-11T21:00:00+01:00', 'bat=3.64&pct=19'); const h2 = await cron('2026-11-11T21:07:00+01:00');
console.log('seuil hésitant :', h1, '/', h2, '| suivi gardé :', 'batterie' in JSON.parse(kv.get('alertes').v));
await vu('2026-11-11T22:00:00+01:00', 'bat=3.9&pct=22&crate=12.5');
console.log('en charge :', await cron('2026-11-11T22:07:00+01:00'), '| suivi :', kv.get('alertes').v);
// Cadre rangé (écran blanc) : pas d'alerte « muet »
await post({ mode: 'blanc' });
console.log('écran blanc, 2 jours sans nouvelles :', await cron('2026-11-13T08:07:00+01:00'));
await post({ mode: 'tableau' });
// Horaires de bus : index valable jusqu'au 15/11 (services) ou au 16/11 (jour ajouté), bloc bus dans une scène
const index = { arrets: ['Gare'], lignes: ['T1'], destinations: ['Centre'], passages: [['t1', 0, 0, 0, 61200, 'S1']],
  services: [{ j: '1111100', d: '20260901', f: '20261115' }, { j: '0000000', plus: ['20261116'] }, { j: '0000000', d: '20260901', f: '20270101' }] };
await req('/api/bus-index', { method: 'POST', body: JSON.stringify(index) });
await vu('2026-11-13T09:00:00+01:00', 'bat=4.1&pct=95');
console.log('bloc bus absent :', await cron('2026-11-13T09:07:00+01:00'), '| fin retenue :', kv.get('bus-fin').v);
await post({ scenes: [{ id: 'bus', nom: 'Bus', creneaux: [{ jours: [0, 0, 0, 0, 1, 0, 0], debut: '18:00', fin: '20:00' }], disposition: D(['date', 'bus']) }] });
console.log('3 jours avant la fin :', await cron('2026-11-13T10:07:00+01:00'));
await vu('2026-11-14T09:00:00+01:00', 'bat=4.1&pct=95');
console.log('2 jours avant la fin :', await cron('2026-11-14T09:07:00+01:00'), '|', notifs.at(-1).message);
await vu('2026-11-15T09:00:00+01:00', 'bat=4.1&pct=95');
console.log('le lendemain :', await cron('2026-11-15T09:07:00+01:00'));
await vu('2026-11-17T10:00:00+01:00', 'bat=4.1&pct=94');
console.log('3 jours après, périmés :', await cron('2026-11-17T10:07:00+01:00'));
// Ancien index (enregistré avant cette version, sans date retenue) : la fin est calculée une fois
kv.delete('bus-fin');
const e = await (await req('/api/alertes')).json();
console.log('état pour la page :', e.etats.map(x => x.cle + (x.probleme ? ' ! ' : ' : ') + x.info).join(' | '), '| fin recalculée :', kv.get('bus-fin').v);
// Notification d'essai depuis la page, alerte décochée
const avant = notifs.length;
console.log('essai :', (await req('/api/alertes/essai', { method: 'POST', body: JSON.stringify({ sujet: SUJET }) })).status, notifs.length - avant, notifs.at(-1).title,
  '| sujet invalide :', (await req('/api/alertes/essai', { method: 'POST', body: JSON.stringify({ sujet: 'x y' }) })).status);
await post({ alertes: { bus: false } });
console.log('alerte bus décochée :', await cron('2026-11-17T11:07:00+01:00'), '| suivi :', kv.get('alertes').v);
