// Blocs « Grand Prix de F1 » et « Graphique de température » : données envoyées à la carte
import fs from 'fs';
import w from '../../serveur/worker.js';
import { connecter } from './acces-test.mjs';
const kv = new Map();
const KV = {
  async get(k) { const e = kv.get(k); return e ? e.v : null; },
  async getWithMetadata(k) { const e = kv.get(k); return e ? { value: e.v, metadata: e.m } : { value: null, metadata: null }; },
  async put(k, v, o) { kv.set(k, { v, m: o && o.metadata }); }, async delete(k) { kv.delete(k); },
};
const env = { CADRE: KV };
const pad = n => String(n).padStart(2, '0');
// Météo simulée (heure de Paris) autour de l'instant fixé
function meteo(now) {
  const iso = d => { const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d).map(x => [x.type, x.value]));
    return p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute; };
  const h0 = new Date(now); h0.setUTCMinutes(0, 0, 0); h0.setTime(h0.getTime() - 30 * 3600e3);
  const hourly = { time: [], temperature_2m: [], weather_code: [], precipitation_probability: [], is_day: [] };
  for (let i = 0; i < 240; i++) { const d = new Date(h0.getTime() + i * 3600e3); const h = +iso(d).slice(11, 13);
    hourly.time.push(iso(d).slice(0, 13) + ':00'); hourly.temperature_2m.push(12 + 7 * Math.sin((h - 9) / 24 * 2 * Math.PI) + (i > 50 ? -3 : 0));
    hourly.weather_code.push(3); hourly.precipitation_probability.push(i > 38 && i < 48 ? [10, 30, 55, 80, 70, 40, 20, 5, 0, 0][i - 39] : 0); hourly.is_day.push(h >= 8 && h < 18 ? 1 : 0); }
  const daily = { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [], sunrise: [], sunset: [], precipitation_probability_max: [] };
  for (let k = 0; k < 8; k++) { const s = iso(new Date(now + k * 86400e3)).slice(0, 10); daily.time.push(s); daily.weather_code.push(3); daily.temperature_2m_max.push(19); daily.temperature_2m_min.push(6); daily.sunrise.push(s + 'T07:54'); daily.sunset.push(s + 'T18:31'); daily.precipitation_probability_max.push(10); }
  return { current: { time: iso(new Date(now)), temperature_2m: 14, apparent_temperature: 13, relative_humidity_2m: 70, weather_code: 3, is_day: 1, wind_speed_10m: 10, wind_direction_10m: 0, wind_gusts_10m: 20 }, hourly, daily };
}
// Calendrier F1 simulé au format Jolpica
const s = (d, t) => ({ date: d, time: t });
const saison = { MRData: { RaceTable: { Races: [
  { round: '20', raceName: 'United States Grand Prix', date: '2026-10-25', time: '20:00:00Z', Circuit: { circuitName: 'Circuit of the Americas', Location: { lat: '30.1328', long: '-97.6411', locality: 'Austin' } },
    FirstPractice: s('2026-10-23', '17:30:00Z'), SprintQualifying: s('2026-10-23', '21:30:00Z'), Sprint: s('2026-10-24', '17:00:00Z'), Qualifying: s('2026-10-24', '21:00:00Z') },
  { round: '21', raceName: 'Mexico City Grand Prix', date: '2026-11-01', time: '20:00:00Z', Circuit: { circuitName: 'Autódromo Hermanos Rodríguez', Location: { lat: '19.4042', long: '-99.0907', locality: 'Mexico City' } },
    FirstPractice: s('2026-10-30', '18:30:00Z'), SecondPractice: s('2026-10-30', '22:00:00Z'), ThirdPractice: s('2026-10-31', '17:30:00Z'), Qualifying: s('2026-10-31', '21:00:00Z') },
] } } };
let maintenant;
globalThis.fetch = async (u) => {
  u = String(u);
  if (u.includes('open-meteo')) return new Response(JSON.stringify(meteo(maintenant)));
  if (u.includes('jolpi.ca') && globalThis.jolpicaKO) { globalThis.refusJolpica = (globalThis.refusJolpica || 0) + 1; return new Response('Too Many Requests', { status: 429 }); }
  globalThis.appelsJolpica = (globalThis.appelsJolpica || 0) + 1;
  if (u.includes('jolpi.ca/ergast/f1/2026')) return new Response(JSON.stringify(saison));
  if (u.includes('jolpi.ca')) return new Response(JSON.stringify({ MRData: { RaceTable: { Races: [] } } }));
  throw new Error('fetch inattendu ' + u);
};
const appeler = await connecter(w, env);
const req = (p, o = {}) => appeler(new Request('https://cadre.test' + p, o));
const post = async b => (await req('/api/config', { method: 'POST', body: JSON.stringify(b) })).json();
const etat = async iso => { maintenant = new Date(iso).getTime(); Date.now = () => maintenant; return (await req('/api/etat?ui=1')).json(); };
await post({ disposition: [{ id: 'date', x: 0, y: 0, w: 12, h: 1 }, { id: 'courbe', x: 0, y: 1, w: 7, h: 4 }, { id: 'f1', x: 7, y: 1, w: 5, h: 7 }, { id: 'meteo', x: 0, y: 5, w: 7, h: 3 }] });
for (const iso of ['2026-10-21T10:00:00+02:00', '2026-10-24T20:00:00+02:00', '2026-10-25T23:30:00+01:00', '2026-10-26T00:30:00+01:00']) {
  const e = await etat(iso);
  console.log(iso.slice(0, 16), '|', e.f1.gp, '| manche', e.f1.manche, '|', e.f1.quand, '|', e.f1.circuit, '| tracé', e.f1.trace ? e.f1.trace.p.length / 2 + ' pts' : '-',
    '\n   ', e.f1.sessions.map(x => (x.f ? '~' : '') + x.j + ' ' + x.h + ' ' + x.n).join(' ; '));
}
let e = await etat('2026-10-24T20:00:00+02:00');
console.log('courbe : départ', e.meteo.courbe.h0 + 'h,', e.meteo.courbe.t.length, 'points, jours', e.meteo.courbe.j, '| JSON', JSON.stringify(e).length, 'octets');
fs.writeFileSync('../rendu/d_courbe_f1.json', JSON.stringify(e));
await post({ affichage: { rotation: 1 }, dispositionPortrait: [{ id: 'date', x: 0, y: 0, w: 8, h: 1 }, { id: 'f1', x: 0, y: 1, w: 8, h: 6 }, { id: 'courbe', x: 0, y: 7, w: 8, h: 3 }, { id: 'agenda', x: 0, y: 10, w: 8, h: 2 }], meteo: { courbeHeures: 48 } });
e = await etat('2026-10-28T09:00:00+01:00');
fs.writeFileSync('../rendu/d_courbe_f1_portrait.json', JSON.stringify(e));
console.log('portrait 48 h :', e.meteo.courbe.t.length, 'points ; GP :', e.f1.gp, e.f1.quand);
// Petit graphique comme sur le cadre de Thibault (maximum en haut a droite, pluie la nuit)
await post({ meteo: { courbeHeures: 24 }, disposition: [{ id: 'date', x: 0, y: 0, w: 12, h: 1 }, { id: 'meteo', x: 0, y: 1, w: 12, h: 2 },
  { id: 'courbe', x: 0, y: 3, w: 7, h: 2 }, { id: 'jours', x: 0, y: 5, w: 7, h: 3 }, { id: 'f1', x: 7, y: 3, w: 5, h: 5 }] });
e = await etat('2026-10-24T18:00:00+02:00');
fs.writeFileSync('../rendu/d_courbe_petite.json', JSON.stringify(e));
// Jolpica refuse (HTTP 429) : le calendrier gardé dans le KV prend le relais ; requêtes limitées
globalThis.appelsJolpica = 0; kv.delete('f1-2026');
for (let i = 0; i < 20; i++) await etat(new Date(Date.UTC(2026, 9, 27, 8, i * 60)).toISOString());
console.log('appels à Jolpica pour 20 réveils (1 par heure) :', globalThis.appelsJolpica);
globalThis.jolpicaKO = true;
e = await etat('2026-10-28T09:00:00+01:00');
console.log('Jolpica en panne, copie du KV ->', e.f1.erreur || e.f1.gp + ' ' + e.f1.quand);
// Tant que la panne dure : une demande par heure, pas une à chaque réveil (ici 18 réveils en 3 h)
globalThis.refusJolpica = 0;
const t9 = Date.parse('2026-10-28T09:00:00+01:00');
for (let i = 1; i <= 18; i++) e = await etat(new Date(t9 + i * 600e3).toISOString());
console.log('panne de 3 h, 18 réveils :', globalThis.refusJolpica, 'demandes | GP toujours affiché :', e.f1.gp);
globalThis.jolpicaKO = false; globalThis.appelsJolpica = 0;
for (let i = 19; i <= 30; i++) e = await etat(new Date(t9 + i * 600e3).toISOString());
console.log('Jolpica revenu :', globalThis.appelsJolpica, 'demande | échec effacé :', !JSON.parse(kv.get('f1-2026').v).echec);
globalThis.jolpicaKO = true;
kv.clear();
await post({ disposition: [{ id: 'f1', x: 0, y: 0, w: 6, h: 4 }] });
e = await etat('2026-10-28T09:00:00+01:00');
console.log('Jolpica en panne, sans copie ->', e.f1.erreur);
globalThis.refusJolpica = 0;
e = await etat('2026-10-28T09:10:00+01:00');
console.log('sans copie, 10 min après :', globalThis.refusJolpica, 'demande ->', e.f1.erreur);
e = await etat('2026-10-28T10:01:00+01:00');
console.log('sans copie, 1 h après :', globalThis.refusJolpica, 'demande');
