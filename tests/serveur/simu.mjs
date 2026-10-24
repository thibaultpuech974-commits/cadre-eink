// Serveur simulé : KV en mémoire, météo et calendrier F1 factices, horloge réglable
import fs from 'fs';
import w from '../../serveur/worker.js';
export const kv = new Map();
export const KV = {
  async get(k) { const e = kv.get(k); return e ? e.v : null; },
  async getWithMetadata(k) { const e = kv.get(k); return e ? { value: e.v, metadata: e.m } : { value: null, metadata: null }; },
  async put(k, v, o) { kv.set(k, { v, m: o && o.metadata }); }, async delete(k) { kv.delete(k); },
};
const env = { CLE: 'secret', CADRE: KV };
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
  if (u.includes('jolpi.ca/ergast/f1/2026')) return new Response(JSON.stringify(saison));
  if (u.includes('jolpi.ca')) return new Response(JSON.stringify({ MRData: { RaceTable: { Races: [] } } }));
  throw new Error('fetch inattendu ' + u);
};
export const req = (p, o = {}) => w.fetch(new Request('https://cadre.test' + p, Object.assign({ headers: { 'X-Cle': 'secret' } }, o)), env);
export const post = async b => (await req('/api/config', { method: 'POST', body: JSON.stringify(b) })).json();
export const etat = async iso => { maintenant = new Date(iso).getTime(); Date.now = () => maintenant; return (await req('/api/etat?ui=1')).json(); };
