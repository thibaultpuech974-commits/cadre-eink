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
 'BEGIN:VEVENT','UID:f1','DTSTART:' + ymd(demain) + 'T130000Z','DURATION:PT1H','SUMMARY:🏁 FORMULA 1 HEINEKEN DUTCH GRAND PRIX 2026 - Qualifying','END:VEVENT',
 'BEGIN:VEVENT','UID:old','DTSTART;TZID=Europe/Paris:20250101T100000','SUMMARY:Passé','END:VEVENT',
 'END:VCALENDAR' ].join('\r\n');
globalThis.fetch = async (u) => {
  u = String(u);
  if (u.includes('open-meteo')) return new Response(JSON.stringify(meteo));
  if (u.startsWith('https://ics.test')) return new Response(ics);
  throw new Error('fetch inattendu ' + u);
};
const req = (p, o={}) => w.fetch(new Request('https://cadre.test' + p, o), env);
const vraiNow = Date.now;
const fixer = (iso) => { Date.now = () => new Date(iso).getTime(); };
const post = async (b) => (await req('/api/config', { method: 'POST', headers: { 'X-Cle': 'secret' }, body: JSON.stringify(b) })).json();
const etat = async () => (await req('/api/etat?cle=secret&ui=1')).json();
// index : un bus a 18h40 et 18h55 le vendredi
await KV.put('bus', JSON.stringify({ arrets: ['Gare Feuchères'], lignes: ['4'], destinations: ['Castellas'], services: [{ j: '1111111', d: '20260101', f: '20271231' }],
  passages: [['T0', 0, 0, 0, 18 * 3600 + 40 * 60, 'GF1'], ['T1', 0, 0, 0, 18 * 3600 + 55 * 60, 'GF1']] }));
await post({ reveilMin: 10, bus: { toujours: false, creneaux: [{ jours: [0,0,0,0,1,0,0], debut: '18:00', fin: '20:00' }, { jours: [1,0,0,0,0,0,0], debut: '7:00', fin: '6:00' }], reveilMin: 3 },
  disposition: [{ id: 'date', x: 0, y: 0, w: 12, h: 1 }, { id: 'meteo', x: 0, y: 1, w: 12, h: 3 }, { id: 'agenda', x: 0, y: 4, w: 12, h: 4 }],
  dispositionBus: [{ id: 'date', x: 0, y: 0, w: 12, h: 1 }, { id: 'bus', x: 0, y: 1, w: 12, h: 4 }, { id: 'agenda', x: 0, y: 5, w: 12, h: 3 }] });
const c = (await post({})).config; console.log('creneaux valides :', JSON.stringify(c.bus.creneaux));
for (const [nom, iso] of [['ven 18h30 (dans le créneau)', '2026-10-23T18:30:00+02:00'], ['ven 17h50', '2026-10-23T17:50:00+02:00'], ['ven 17h56', '2026-10-23T17:56:00+02:00'], ['ven 20h30', '2026-10-23T20:30:00+02:00']]) {
  fixer(iso); const e = await etat();
  console.log(nom.padEnd(28), 'blocs:', e.disposition.map(d => d.id).join(','), '| reveil', e.reveil, 's | bus:', e.bus ? JSON.stringify(e.bus.passages.map(p => p.h + (p.tr ? '' : '~'))) : '-');
}
fixer('2026-10-23T17:50:00+02:00'); await post({ disposition: [{ id: 'date', x: 0, y: 0, w: 12, h: 1 }], dispositionBus: [] });
let e = await etat(); console.log('sans bloc bus nulle part     reveil', e.reveil, 's');
await post({ dev: true, devSecondes: 15 }); e = await etat(); console.log('mode dev                     reveil', e.reveil, 's');
await post({ dev: false, disposition: [{ id: 'date', x: 0, y: 0, w: 12, h: 1 }, { id: 'bus', x: 0, y: 1, w: 6, h: 3 }] });
fixer('2026-10-23T18:30:00+02:00'); e = await etat(); console.log('créneau, dispo normale avec bus, dispoBus vide -> blocs:', e.disposition.map(d => d.id).join(','), 'reveil', e.reveil);
fixer('2026-10-23T21:00:00+02:00'); e = await etat(); console.log('hors créneau -> blocs:', e.disposition.map(d => d.id).join(','), 'reveil', e.reveil);
// --- Mode nuit ---
await post({ nuit: { actif: true, debut: '23:00', fin: '06:30', intervalleMin: 60 }, bus: { creneaux: [{ jours: [0,0,0,0,0,1,0], debut: '06:00', fin: '08:00' }] } });
for (const [nom, iso] of [['ven 22h55 (avant la nuit)', '2026-10-23T22:55:00+02:00'], ['ven 23h10', '2026-10-23T23:10:00+02:00'],
  ['sam 02h00', '2026-10-24T02:00:00+02:00'], ['sam 05h40 (créneau 6h)', '2026-10-24T05:40:00+02:00'], ['sam 06h10 (créneau)', '2026-10-24T06:10:00+02:00'],
  ['dim 06h00 (fin 6h30)', '2026-10-25T06:00:00+01:00'], ['dim 06h31', '2026-10-25T06:31:00+01:00']]) {
  fixer(iso); const e = await etat(); console.log(('nuit ' + nom).padEnd(34), 'reveil', e.reveil, 's');
}
// Écritures du statut limitées
let n = 0; const put0 = KV.put; KV.put = async (k, v, o) => { if (k === 'statut') n++; return put0(k, v, o); };
await post({ nuit: { actif: false } });
for (let i = 0; i < 20; i++) { fixer(new Date(Date.UTC(2026, 9, 21, 10, 0) + i * 60000).toISOString()); await req('/api/etat?cle=secret&bat=3.9' + (i % 2 ? '1' : '0')); }
console.log('écritures statut sur 20 réveils (1/min) :', n);
