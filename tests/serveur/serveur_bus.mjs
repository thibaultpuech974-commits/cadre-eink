import fs from 'fs';
import w from '../../serveur/worker.js';
// --- KV simulé ---
const kv = new Map();
const KV = {
  async get(k, type) { const e = kv.get(k); if (!e) return null; return type === 'arrayBuffer' ? e.v : e.v; },
  async getWithMetadata(k, type) { const e = kv.get(k); return e ? { value: e.v, metadata: e.m } : { value: null, metadata: null }; },
  async put(k, v, o) { kv.set(k, { v, m: o && o.metadata }); },
};
const env = { CLE: 'secret', CADRE: KV };
// --- fetch simulé : météo + ICS ---
const now = new Date();
const pad = n => String(n).padStart(2, '0');
function iso(d) { return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
const hourly = { time: [], temperature_2m: [], weather_code: [], precipitation_probability: [], is_day: [] };
const h0 = new Date(now); h0.setMinutes(0,0,0); h0.setHours(0);
for (let i = 0; i < 192; i++) { const d = new Date(h0.getTime() + i*3600e3); hourly.time.push(iso(d)); hourly.temperature_2m.push(10 + 8*Math.sin(i/24*2*Math.PI)); hourly.weather_code.push([0,2,3,61,80][i%5]); hourly.precipitation_probability.push((i*7)%100); hourly.is_day.push(d.getHours()>7&&d.getHours()<19?1:0); }
const daily = { time: [], weather_code: [], temperature_2m_max: [], temperature_2m_min: [], sunrise: [], sunset: [], precipitation_probability_max: [] };
for (let k = 0; k < 8; k++) { const d = new Date(h0.getTime() + k*86400e3); const s = iso(d).slice(0,10); daily.time.push(s); daily.weather_code.push([0,3,61,95,71,45,2,1][k]); daily.temperature_2m_max.push(19.4-k); daily.temperature_2m_min.push(8.6-k/2); daily.sunrise.push(s+'T07:54'); daily.sunset.push(s+'T18:31'); daily.precipitation_probability_max.push(10*k); }
const meteo = { current: { time: iso(now), temperature_2m: 16.6, apparent_temperature: 15.2, relative_humidity_2m: 64, weather_code: 2, is_day: 1, wind_speed_10m: 14.8, wind_direction_10m: 315, wind_gusts_10m: 31.2 }, hourly, daily };
// ICS de test : cours hebdo MO,WE (Paris), un évènement journée, un évènement UTC, une exception, une occurrence déplacée
const ymd = d => d.getUTCFullYear() + pad(d.getUTCMonth()+1) + pad(d.getUTCDate());
const debutSemaine = new Date(Date.UTC(2026, 8, 7)); // lundi 7 sept 2026
const demain = new Date(now.getTime() + 86400e3);
const ics = [
 'BEGIN:VCALENDAR','VERSION:2.0',
 'BEGIN:VEVENT','UID:cours1','DTSTART;TZID=Europe/Paris:' + ymd(debutSemaine) + 'T080000','DTEND;TZID=Europe/Paris:' + ymd(debutSemaine) + 'T100000',
 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR;UNTIL=20270630T000000Z','SUMMARY:Cours de maths\\, salle B12','END:VEVENT',
 'BEGIN:VEVENT','UID:j1','DTSTART;VALUE=DATE:' + ymd(demain),'DTEND;VALUE=DATE:' + ymd(new Date(demain.getTime()+86400e3)),'SUMMARY:Anniversaire de Léa','END:VEVENT',
 'BEGIN:VEVENT','UID:u1','DTSTART:' + ymd(demain) + 'T163000Z','DURATION:PT1H','SUMMARY:Colle de physique avec un titre vraiment très long qui dépasse','END:VEVENT',
 'BEGIN:VEVENT','UID:old','DTSTART;TZID=Europe/Paris:20250101T100000','SUMMARY:Passé','END:VEVENT',
 'END:VCALENDAR' ].join('\r\n');
globalThis.fetch = async (u) => {
  u = String(u);
  if (u.includes('open-meteo')) return new Response(JSON.stringify(meteo));
  if (u.startsWith('https://ics.test')) return new Response(ics);
  if (u.includes('data.gouv.fr/api/1/datasets/r/15aeb8a5')) return new Response(fs.readFileSync('gtfs_test.zip'));
  if (u.includes('bus-tracker')) { if (process.env.MODE_RT === 'json') return new Response(fs.readFileSync('rt_test.json')); return new Response('panne', { status: 503 }); }
  if (u.includes('resources/80731')) { if (process.env.MODE_RT === 'pb') return new Response(fs.readFileSync('rt_test.pb')); return new Response('panne', { status: 503 }); }
  throw new Error('fetch inattendu ' + u);
};
import http from 'http';
// apercu initial = rendu du tableau complet
const pbm = fs.readFileSync('/tmp/claude-0/-home-claude/ddece4b2-ab1a-5083-ad3a-3f963bcd7421/scratchpad/hote/rendu_complet.pbm');
const bitsApercu = pbm.subarray(pbm.length - 81600);
await KV.put('apercu', bitsApercu.buffer.slice(bitsApercu.byteOffset, bitsApercu.byteOffset + 81600), { metadata: { t: Date.now() - 4 * 60000 } });
await KV.put('statut', JSON.stringify({ vu: Date.now() - 4 * 60000, bat: 4.02, mode: 'tableau' }));
await KV.put('config', JSON.stringify({ agenda: { urls: ['webcal://ics.test/cal.ics'] } }));
http.createServer(async (rq, rs) => {
  const chunks = []; for await (const c of rq) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const r = await w.fetch(new Request('http://localhost:8787' + rq.url, { method: rq.method, headers: rq.headers, body: (rq.method === 'GET' || rq.method === 'HEAD') ? undefined : body }), env);
  const h = {}; r.headers.forEach((v, k) => h[k] = v);
  rs.writeHead(r.status, h); rs.end(Buffer.from(await r.arrayBuffer()));
}).listen(8787, () => console.log('ok'));
