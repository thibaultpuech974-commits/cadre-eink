// Météo (Open-Meteo), avec copie de secours en cas de panne
import { avecSecours, pourEcran } from './commun.js';
import { JOURS_COURTS, dateDuJour, deux, mural } from './temps.js';

const DESCRIPTIONS = {
  0: 'Ciel dégagé', 1: 'Plutôt dégagé', 2: 'Partiellement nuageux', 3: 'Couvert',
  45: 'Brouillard', 48: 'Brouillard givrant',
  51: 'Bruine légère', 53: 'Bruine', 55: 'Bruine dense', 56: 'Bruine verglaçante', 57: 'Bruine verglaçante',
  61: 'Pluie faible', 63: 'Pluie', 65: 'Forte pluie', 66: 'Pluie verglaçante', 67: 'Pluie verglaçante',
  71: 'Neige faible', 73: 'Neige', 75: 'Forte neige', 77: 'Grains de neige',
  80: 'Averses', 81: 'Averses', 82: 'Fortes averses', 85: 'Averses de neige', 86: 'Averses de neige',
  95: 'Orage', 96: 'Orage et grêle', 99: 'Orage et grêle',
};
function directionVent(deg) {
  return ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}
// Donnees brutes d'Open-Meteo (avec copie de secours si le service ne repond pas)
export async function chargerMeteo(o, env) {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + o.lat + '&longitude=' + o.lon +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,' +
    'wind_speed_10m,wind_direction_10m,wind_gusts_10m' +
    '&hourly=temperature_2m,weather_code,precipitation_probability,is_day' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max' +
    '&timezone=Europe%2FParis&forecast_days=8&wind_speed_unit=kmh';
  const { texte, ancien } = await avecSecours(env, 'secours-meteo', 24 * 3600e3, async () => {
    const r = await fetch(url, { cf: { cacheTtl: 600, cacheEverything: true }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  }, url);
  const d = JSON.parse(texte);
  if (ancien) {
    // Copie ancienne : on prend la prevision heure par heure de l'heure actuelle comme "meteo actuelle"
    const w = mural(Date.now()), h = dateDuJour(w) + 'T' + deux(w.hh) + ':00';
    const i = d.hourly.time.indexOf(h);
    if (i < 0) throw new Error('copie trop ancienne');
    Object.assign(d.current, { time: h, temperature_2m: d.hourly.temperature_2m[i], apparent_temperature: d.hourly.temperature_2m[i],
      weather_code: d.hourly.weather_code[i], is_day: d.hourly.is_day[i] });
    const j = d.daily.time.indexOf(dateDuJour(w));
    if (j > 0) for (const k in d.daily) d.daily[k] = d.daily[k].slice(j);   // "aujourd'hui" en premier
  }
  return d;
}
export function meteo(o, d) {
  const c = d.current;
  const res = {
    ville: pourEcran(o.ville),
    t: Math.round(c.temperature_2m),
    c: c.weather_code,
    n: c.is_day ? 0 : 1,
    desc: DESCRIPTIONS[c.weather_code] || '',
    min: Math.round(d.daily.temperature_2m_min[0]),
    max: Math.round(d.daily.temperature_2m_max[0]),
  };
  if (o.details) {
    res.ressenti = Math.round(c.apparent_temperature);
    res.hum = Math.round(c.relative_humidity_2m);
    // Risque de pluie maximal sur les 12 prochaines heures (heure en cours comprise) :
    // repond a "faut-il un parapluie ?", meme le soir
    const iH = d.hourly.time.indexOf(c.time.slice(0, 13) + ':00');
    res.pluie = iH >= 0
      ? Math.max(0, ...d.hourly.precipitation_probability.slice(iH, iH + 12).map(v => v ?? 0))
      : (d.daily.precipitation_probability_max[0] ?? 0);
  }
  if (o.vent) {
    res.vent = { v: Math.round(c.wind_speed_10m), raf: Math.round(c.wind_gusts_10m), dir: directionVent(c.wind_direction_10m) };
  }
  if (o.soleil) {
    res.soleil = { lever: d.daily.sunrise[0].slice(11, 16).replace(':', 'h'), coucher: d.daily.sunset[0].slice(11, 16).replace(':', 'h') };
  }
  if (o.heures) {
    const pas = Math.max(1, Math.min(6, o.pasHeures | 0 || 3));
    let i = d.hourly.time.findIndex(t => t > c.time);
    if (i < 0) i = 0;
    res.heures = [];
    const nbH = Math.max(2, Math.min(12, o.nbHeures | 0 || 6));
    for (let k = 0; k < nbH && i < d.hourly.time.length; k++, i += pas) {
      res.heures.push({
        h: parseInt(d.hourly.time[i].slice(11, 13), 10) + 'h',
        t: Math.round(d.hourly.temperature_2m[i]),
        c: d.hourly.weather_code[i],
        n: d.hourly.is_day[i] ? 0 : 1,
        p: d.hourly.precipitation_probability[i] ?? 0,
      });
    }
  }
  if (o.courbe) {
    // Graphique : temperature (en dixiemes de degre), risque de pluie et nuit, heure par heure
    const nb = [12, 24, 36, 48].includes(o.courbeHeures) ? o.courbeHeures : 24;
    let i0 = d.hourly.time.indexOf(c.time.slice(0, 13) + ':00');
    if (i0 < 0) i0 = 0;
    const fin = Math.min(d.hourly.time.length, i0 + nb + 1);
    const g = { h0: parseInt(d.hourly.time[i0].slice(11, 13), 10), t: [], p: [], n: [], j: [] };
    for (let i = i0; i < fin; i++) {
      g.t.push(Math.round(d.hourly.temperature_2m[i] * 10));
      g.p.push(d.hourly.precipitation_probability[i] ?? 0);
      g.n.push(d.hourly.is_day[i] ? 0 : 1);
      if (i > i0 && d.hourly.time[i].slice(11, 13) === '00') {      // nom des jours suivants, a minuit
        const [y, m, j] = d.hourly.time[i].slice(0, 10).split('-').map(Number);
        g.j.push(JOURS_COURTS[new Date(Date.UTC(y, m - 1, j)).getUTCDay()] + ' ' + j);
      }
    }
    res.courbe = g;
  }
  if (o.jours) {
    const nb = Math.max(1, Math.min(6, o.nbJours | 0 || 4));
    res.jours = [];
    for (let k = 1; k <= nb && k < d.daily.time.length; k++) {
      const [y, m, j] = d.daily.time[k].split('-').map(Number);
      res.jours.push({
        j: JOURS_COURTS[new Date(Date.UTC(y, m - 1, j)).getUTCDay()] + ' ' + j,
        c: d.daily.weather_code[k],
        min: Math.round(d.daily.temperature_2m_min[k]),
        max: Math.round(d.daily.temperature_2m_max[k]),
        p: d.daily.precipitation_probability_max[k] ?? 0,
      });
    }
  }
  return res;
}
