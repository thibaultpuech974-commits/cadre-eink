// Bloc « Météo du circuit » : prévisions aux coordonnées du circuit, limitées aux créneaux des séances
import fs from 'fs';
import w from '../../serveur/worker.js';
const kv = new Map(); let ecritures = [];
const KV = {
  async get(k) { const e = kv.get(k); return e ? e.v : null; },
  async getWithMetadata(k) { const e = kv.get(k); return e ? { value: e.v, metadata: e.m } : { value: null, metadata: null }; },
  async put(k, v, o) { ecritures.push(k); kv.set(k, { v, m: o && o.metadata }); }, async delete(k) { kv.delete(k); },
};
const env = { CLE: 'secret', CADRE: KV };
const deux = n => String(n).padStart(2, '0');
// Calendrier simulé au format Jolpica : un week-end avec sprint (Austin), un week-end classique (Mexico)
const s = (d, t) => ({ date: d, time: t });
const saison = { MRData: { RaceTable: { Races: [
  { round: '20', raceName: 'United States Grand Prix', date: '2026-10-25', time: '20:00:00Z', Circuit: { circuitName: 'Circuit of the Americas', Location: { lat: '30.1328', long: '-97.6411', locality: 'Austin' } },
    FirstPractice: s('2026-10-23', '17:30:00Z'), SprintQualifying: s('2026-10-23', '21:30:00Z'), Sprint: s('2026-10-24', '17:00:00Z'), Qualifying: s('2026-10-24', '21:00:00Z') },
  { round: '21', raceName: 'Mexico City Grand Prix', date: '2026-11-01', time: '20:00:00Z', Circuit: { circuitName: 'Autódromo Hermanos Rodríguez', Location: { lat: '19.4042', long: '-99.0907', locality: 'Mexico City' } },
    FirstPractice: s('2026-10-30', '18:30:00Z'), SecondPractice: s('2026-10-30', '22:00:00Z'), ThirdPractice: s('2026-10-31', '17:30:00Z'), Qualifying: s('2026-10-31', '21:00:00Z') },
] } } };
// Prévisions simulées, heure par heure (heure de Paris) entre start_date et end_date :
// 40 % de pluie à 22 h, et un coup de vent de nord-ouest à 20 h (20 km/h, sinon 8 km/h d'est)
function previsions(url) {
  const p = new URL(url).searchParams;
  const H = { time: [], temperature_2m: [], precipitation_probability: [], wind_speed_10m: [], wind_direction_10m: [] };
  for (let t = Date.parse(p.get('start_date') + 'T00:00Z'); t <= Date.parse(p.get('end_date') + 'T23:00Z'); t += 3600e3) {
    const d = new Date(t), h = d.getUTCHours();
    H.time.push(d.toISOString().slice(0, 13) + ':00');
    H.temperature_2m.push(+(19 + 6 * Math.cos((h - 16) / 24 * 2 * Math.PI)).toFixed(1));
    H.precipitation_probability.push(h === 22 ? 40 : h === 21 || h === 23 ? 15 : 0);
    H.wind_speed_10m.push(h === 20 ? 20.4 : 8); H.wind_direction_10m.push(h === 20 ? 310 : 90);
  }
  return { hourly: H };
}
let maintenant, demandes = [], panne = false;
globalThis.fetch = async (u) => {
  u = String(u);
  if (u.includes('open-meteo')) {
    demandes.push(u);
    if (panne) throw new Error('réseau coupé');
    return new Response(JSON.stringify(previsions(u)));
  }
  if (u.includes('jolpi.ca/ergast/f1/2026')) return new Response(JSON.stringify(saison));
  if (u.includes('jolpi.ca')) return new Response(JSON.stringify({ MRData: { RaceTable: { Races: [] } } }));
  throw new Error('fetch inattendu ' + u);
};
const req = (p, o = {}) => w.fetch(new Request('https://cadre.test' + p, Object.assign({ headers: { 'X-Cle': 'secret' } }, o)), env);
const post = async b => (await req('/api/config', { method: 'POST', body: JSON.stringify(b) })).json();
const etat = async iso => { maintenant = new Date(iso).getTime(); Date.now = () => maintenant; demandes = []; return (await req('/api/etat?ui=1')).json(); };
const jour = o => o.j + ' ' + o.min + '°/' + o.max + '° pluie ' + o.p + ' % vent ' + o.d + ' ' + o.v + ' | ' + o.g.h0 + 'h, ' + o.g.t.length + ' points, ' + o.g.s.map(c => c[2] + ' ' + c[0] + '-' + c[1]).join(', ');

// Deux jours avant les premiers essais : les trois jours du week-end
await post({ disposition: [{ id: 'date', x: 0, y: 0, w: 12, h: 1 }, { id: 'f1', x: 0, y: 1, w: 12, h: 4 }, { id: 'f1meteo', x: 0, y: 5, w: 12, h: 3 }] });
let e = await etat('2026-10-21T10:00:00+02:00');
const p1 = new URL(demandes[0]).searchParams;
console.log('demande :', demandes.length, '| circuit', p1.get('latitude') + ',' + p1.get('longitude'), '| du', p1.get('start_date'), 'au', p1.get('end_date'), '|', p1.get('timezone'));
console.log('mercredi : ' + e.f1.lieu + '\n  ' + e.f1.meteo.map(jour).join('\n  '));
console.log('pluie du graphique du vendredi :', e.f1.meteo[0].g.p.join(' '));
console.log('rien de privé envoyé :', !('interne' in e.f1) && !('periodes' in e.f1), '| bloc F1 intact :', e.f1.sessions.length, 'séances, tracé', !!e.f1.trace);
fs.writeFileSync('../rendu/d_meteo_circuit.json', JSON.stringify(e));
// Une écriture de secours par heure au plus, pas une à chaque réveil
ecritures = [];
for (let i = 1; i <= 5; i++) await etat(new Date(Date.parse('2026-10-21T10:00:00+02:00') + i * 600e3).toISOString());
console.log('5 réveils en 50 min : copie de secours écrite', ecritures.filter(k => k === 'secours-meteo-f1').length, 'fois');

// Samedi soir, sprint terminé : le vendredi a disparu, le samedi reste entier (colonne à droite du bloc F1)
await post({ disposition: [{ id: 'date', x: 0, y: 0, w: 12, h: 1 }, { id: 'f1', x: 0, y: 1, w: 7, h: 7 }, { id: 'f1meteo', x: 7, y: 1, w: 5, h: 7 }] });
e = await etat('2026-10-24T20:30:00+02:00');
console.log('samedi 20h30 :', e.f1.meteo.map(o => o.j + ' (' + o.g.s.map(c => c[2]).join(', ') + ')').join(' ; '), '| du', new URL(demandes[0]).searchParams.get('start_date'));
fs.writeFileSync('../rendu/d_meteo_circuit_colonne.json', JSON.stringify(e));
// Course terminée (le GP reste affiché 3 h) : plus rien à prévoir
e = await etat('2026-10-25T23:30:00+01:00');
console.log('dimanche 23h30 :', e.f1.gp, '|', e.f1.meteo.length, 'jour |', e.f1.noteMeteo, '| demandes', demandes.length);
// Trop tôt (11 jours avant) : pas de demande, la date des premières prévisions est annoncée
e = await etat('2026-10-12T09:00:00+02:00');
console.log('11 jours avant :', e.f1.noteMeteo, '| demandes', demandes.length);
// GP suivant, 4 jours avant : week-end classique, autre circuit
e = await etat('2026-10-26T09:00:00+01:00');
console.log('lundi : ' + e.f1.lieu, new URL(demandes[0]).searchParams.get('latitude'), '|', e.f1.meteo.map(o => o.j + ' (' + o.g.s.map(c => c[2]).join(', ') + ')').join(' ; '));

// Le bloc seul : ni tracé ni horaires dans les données ; sans le bloc : pas de demande au service météo
await post({ disposition: [{ id: 'f1meteo', x: 0, y: 0, w: 6, h: 4 }] });
e = await etat('2026-10-26T09:10:00+01:00');
console.log('bloc seul :', Object.keys(e.f1).sort().join(','));
await post({ disposition: [{ id: 'f1', x: 0, y: 0, w: 6, h: 4 }] });
e = await etat('2026-10-26T09:20:00+01:00');
console.log('sans le bloc : demandes', demandes.length, '| météo dans les données :', 'meteo' in e.f1);

// Service météo en panne : la copie de secours sert ; sans copie, un message, et le bloc F1 n'est pas touché
await post({ disposition: [{ id: 'f1', x: 0, y: 0, w: 6, h: 4 }, { id: 'f1meteo', x: 6, y: 0, w: 6, h: 4 }] });
panne = true;
e = await etat('2026-10-26T09:30:00+01:00');
console.log('panne, avec copie :', e.f1.meteo.length, 'jours');
kv.delete('secours-meteo-f1');
e = await etat('2026-10-26T09:40:00+01:00');
console.log('panne, sans copie :', e.f1.meteo.length, 'jour |', e.f1.noteMeteo, '| F1 :', e.f1.gp, e.f1.sessions.length, 'séances');
