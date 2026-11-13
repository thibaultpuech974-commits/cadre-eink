// Réveils calés sur l'horloge : le cadre se réveille aux repères (14:00, 14:10…), pas « 10 min après le dernier réveil »
import { kv, req, post, horloge } from './simu.mjs';
import { calerSurHorloge } from '../../serveur/scenes.js';
const D = ids => ids.map((id, i) => ({ id, x: 0, y: i ? 2 * i - 1 : 0, w: 12, h: i ? 2 : 1 }));
const hms = t => new Date(t).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris' });
// Une carte simulée : elle demande son état, reste éveillée 'eveil' s, puis dort ce que dit le serveur,
// avec une horloge de veille qui avance ou retarde ('derive' : 1.01 = elle dort 1 % de trop)
const carte = async (depart, n, { eveil = 2, derive = 1 } = {}) => {
  const reveils = []; let t = new Date(depart).getTime();
  for (let i = 0; i < n; i++) {
    horloge(new Date(t).toISOString());
    const e = await (await req('/api/etat?bat=4.0&fw=20261108-101500')).json();
    reveils.push(hms(t) + (e.scene && e.scene !== 'Par défaut' ? ' ' + e.scene : ''));
    t += Math.round((eveil + e.reveil * derive) * 1000);
  }
  return reveils.join(' | ');
};
await post({ reveilMin: 10, disposition: D(['date', 'meteo']), scenes: [], nuit: { actif: false }, creuses: { actif: false } });

// 1. Rythme normal de 10 min : le premier intervalle est raccourci, puis un réveil juste après chaque repère
console.log('10 min, depuis 14:07:20 :', await carte('2026-11-10T14:07:20+01:00', 5));
console.log('60 min, depuis 13:58:30 :', (await post({ reveilMin: 60 }), await carte('2026-11-10T13:58:30+01:00', 3)));
// 2. Horloge de la carte qui avance de 0,4 % (elle se réveille trop tôt) : la marge suffit ;
//    de 2 % : réveil avant le repère, la carte se rendort une minute, puis repart du bon pied
console.log('60 min, horloge 0,4 % rapide :', await carte('2026-11-10T14:00:20+01:00', 4, { derive: 0.996 }));
console.log('60 min, horloge 2 % rapide :', await carte('2026-11-10T14:00:20+01:00', 5, { derive: 0.98 }));
console.log('60 min, horloge 2 % lente :', await carte('2026-11-10T14:00:20+01:00', 4, { derive: 1.02 }));
// 3. Nuit (23:00-07:00, toutes les 2 h) : repères aux heures paires, minuit compris, puis réveil à la fin de la nuit
await post({ reveilMin: 10, nuit: { actif: true, debut: '23:00', fin: '07:00', intervalleMin: 120 } });
console.log('nuit de 2 h en 2 h :', await carte('2026-11-10T22:47:00+01:00', 9));
await post({ nuit: { actif: false } });
// 4. Scène à son propre rythme (3 min) et fin de scène
await post({ scenes: [{ id: 'bus', nom: 'Bus', creneaux: [{ jours: [1, 1, 1, 1, 1, 0, 0], debut: '18:00', fin: '18:10' }], reveilMin: 3, disposition: D(['date', 'bus']) }] });
console.log('scène à 3 min :', await carte('2026-11-10T17:52:00+01:00', 7));
await post({ scenes: [] });
// 5. Intervalle qui ne tombe pas juste dans l'heure (45 min) : repères comptés depuis minuit, minuit toujours compris
console.log('repères de 45 min :', [22 * 3600 + 10 * 60, 22 * 3600 + 40 * 60, 23 * 3600 + 20 * 60].map(s => {
  const w = { hh: Math.floor(s / 3600), mi: Math.floor(s / 60) % 60, ss: 0 };
  const r = s + calerSurHorloge(2700, 0, w) - 14; return Math.floor(r / 3600) % 24 + ':' + String(Math.floor(r / 60) % 60).padStart(2, '0'); }).join(' | '));
// 6. Mode développement : pas de calage (réveils toutes les 30 s)
await post({ dev: true, devSecondes: 30 });
console.log('mode développement :', (await (await req('/api/etat?ui=1')).json()).reveil);
await post({ dev: false });
// 7. L'état du cadre n'est pas réécrit à chaque réveil parce que le délai varie de quelques secondes (scène à 3 min)
await post({ reveilMin: 3 });
let ecritures = 0; const set0 = kv.set.bind(kv);
kv.set = (k, v) => { if (k === 'statut') ecritures++; return set0(k, v); };
await carte('2026-11-11T10:00:07+01:00', 10, { eveil: 3 });
console.log('10 réveils en 27 min :', ecritures, 'écritures de l\'état');
