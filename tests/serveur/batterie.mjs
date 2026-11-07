// Historique de la batterie : un point par heure, 30 jours
import { kv, req, post, horloge } from './simu.mjs';
await post({ scenes: [], disposition: [{ id: 'date', x: 0, y: 0, w: 12, h: 1 }] });
let ecritures = 0; const set0 = kv.set.bind(kv);
kv.set = (k, v) => { if (k === 'batterie') ecritures++; return set0(k, v); };
// 2 jours de réveils toutes les 10 min, batterie de 4,10 V à 3,90 V
const t0 = Date.UTC(2026, 9, 20, 0, 0);
for (let i = 0; i < 288; i++) {
  horloge(new Date(t0 + i * 600e3).toISOString());
  await req('/api/etat?bat=' + (4.10 - 0.2 * i / 288).toFixed(3));
}
let h = JSON.parse(kv.get('batterie').v);
console.log('2 jours, 288 réveils :', ecritures, 'écritures,', h.pts.length, 'points, de', h.pts[0][1], 'à', h.pts.at(-1)[1], 'mV');
// 40 jours plus tard : les points de plus de 30 jours sont supprimés
horloge(new Date(t0 + 40 * 86400e3).toISOString());
await req('/api/etat?bat=4.15');
h = JSON.parse((await (await req('/api/batterie')).text()));
console.log('après 40 jours :', h.pts.length, 'point(s)');
// Sans batterie mesurée (USB) : pas de point
kv.delete('batterie');
horloge(new Date(t0 + 41 * 86400e3).toISOString());
await req('/api/etat?bat=0.00');
console.log('sans mesure :', kv.has('batterie') ? 'point ajouté (erreur)' : 'rien enregistré');
// Carte avec jauge (Feather) : pourcentage et vitesse enregistrés dans l'état et dans l'historique
kv.delete('batterie'); kv.delete('statut');
horloge(new Date(t0 + 42 * 86400e3).toISOString());
await req('/api/etat?bat=4.05&pct=85.34&crate=12.5');
h = JSON.parse(kv.get('batterie').v);
let st = JSON.parse(kv.get('statut').v);
console.log('jauge : état', st.pct, st.crate, '| point', JSON.stringify(h.pts.at(-1).slice(1)));
// Fin de charge 2 min plus tard : l'état est réécrit tout de suite, sans attendre 10 min
horloge(new Date(t0 + 42 * 86400e3 + 2 * 60000).toISOString());
await req('/api/etat?bat=4.05&pct=85.4&crate=0');
st = JSON.parse(kv.get('statut').v);
console.log('fin de charge enregistrée :', st.crate);
// Valeurs absurdes : bornées (0 à 110 %, -200 à +200 % par heure)
kv.delete('statut');
await req('/api/etat?bat=4.05&pct=900&crate=-9999');
st = JSON.parse(kv.get('statut').v);
console.log('valeurs bornées :', st.pct, st.crate);
// Mode développement (réveil toutes les 30 s), fin de charge : une vitesse qui hésite autour du seuil
// (+1,9 / +2,1 % par heure) ne réécrit pas l'état à chaque réveil
let ecrituresStatut = 0; const set1 = kv.set.bind(kv);
kv.set = (k, v) => { if (k === 'statut') ecrituresStatut++; return set1(k, v); };
for (let i = 0; i < 20; i++) {
  horloge(new Date(t0 + 43 * 86400e3 + i * 30e3).toISOString());
  await req('/api/etat?bat=4.18&pct=99&crate=' + (i % 2 ? '1.9' : '2.1'));
}
console.log('seuil hésitant, 20 réveils en 10 min :', ecrituresStatut, 'écriture(s)');
// Temps d'éveil et d'écran cumulés par la carte : gardés dans l'état et dans l'historique (dixièmes de s)
kv.delete('batterie'); kv.delete('statut');
horloge(new Date(t0 + 44 * 86400e3).toISOString());
await req('/api/etat?bat=4.05&pct=85.3&crate=-0.2&ev=123456&ee=45678');
st = JSON.parse(kv.get('statut').v);
console.log('éveil : état', st.ev, st.ee, '| point', JSON.stringify(JSON.parse(kv.get('batterie').v).pts.at(-1).slice(1)));
kv.delete('batterie');
horloge(new Date(t0 + 45 * 86400e3).toISOString());
await req('/api/etat?bat=4.05&ev=2000&ee=900');
console.log('éveil sans jauge : point', JSON.stringify(JSON.parse(kv.get('batterie').v).pts.at(-1).slice(1)));
