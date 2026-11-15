// Température intérieure : mesurée par la carte (thermistance), renvoyée dans le bloc Météo
import { kv, req, post, horloge } from './simu.mjs';
await post({ scenes: [], disposition: [{ id: 'date', x: 0, y: 0, w: 12, h: 1 }, { id: 'meteo', x: 0, y: 1, w: 12, h: 2 }] });
const t0 = Date.UTC(2026, 10, 15, 12, 0);
let n = 0, pas = 1;
const reveil = async (ti, extra = '') => { horloge(new Date(t0 + (n += pas) * 60000).toISOString()); return (await req('/api/etat?bat=4.05' + (ti === null ? '' : '&ti=' + ti) + extra)).json(); };
const statut = () => JSON.parse(kv.get('statut').v);
// Carte sans thermistance (ou ancien programme) : rien dans le bloc
let e = await reveil(null);
console.log('sans mesure :', 'int' in e.meteo ? 'présente (erreur)' : 'absente', '| état', statut().ti);
// Première mesure : arrondie au demi-degré, enregistrée tout de suite
let ecritures = 0; const set0 = kv.set.bind(kv);
kv.set = (k, v) => { if (k === 'statut') ecritures++; return set0(k, v); };
e = await reveil(21.37);
console.log('21,37 ->', e.meteo.int, '| état', statut().ti, statut().tia, '| écritures', ecritures);
// Mesure qui hésite : la valeur affichée et la signature ne bougent pas, et rien n'est écrit
// (réveils au même instant : l'état n'a aucune autre raison d'être réécrit)
const sig = e.sig; ecritures = 0; pas = 0;
const vues = [];
for (const t of [21.6, 21.8, 21.2, 21.7, 21.3]) { e = await reveil(t); vues.push(e.meteo.int + (e.sig === sig ? '' : ' (signature changée)')); }
console.log('mesure qui hésite :', vues.join(' '), '| écritures', ecritures);
// Vrai changement : nouvelle valeur, nouvelle signature, état réécrit
e = await reveil(22.0);
console.log('22,0 ->', e.meteo.int, '| signature changée', e.sig !== sig, '| écritures', ecritures);
// Mesures absurdes : ignorées
pas = 1;
e = await reveil(95); const e2 = await reveil('abc');
console.log('absurde :', 'int' in e.meteo || 'int' in e2.meteo ? 'affichée (erreur)' : 'ignorée');
// Page web : la valeur du dernier réveil ; plus rien si la carte ne la mesure plus
await reveil(19.5);
let ui = await (await req('/api/etat?ui=1')).json();
await reveil(null);
const ui2 = await (await req('/api/etat?ui=1')).json();
console.log('page :', ui.meteo.int, '| après un réveil sans mesure :', 'int' in ui2.meteo ? 'présente (erreur)' : 'absente');
// La météo gardée en mémoire par le serveur n'est pas modifiée ; sans bloc Météo, rien n'est envoyé
await post({ disposition: [{ id: 'date', x: 0, y: 0, w: 12, h: 1 }, { id: 'jours', x: 0, y: 1, w: 12, h: 2 }] });
e = await reveil(20);
console.log('sans le bloc Météo :', e.meteo && 'int' in e.meteo ? 'présente (erreur)' : 'absente');
// Historique pour la page web : un point par demi-heure, 30 jours, sans écriture de plus entre deux points
kv.delete('temperature'); kv.delete('statut');
let ecrituresH = 0; const set1 = kv.set.bind(kv);
kv.set = (k, v) => { if (k === 'temperature') ecrituresH++; return set1(k, v); };
const t1 = Date.UTC(2026, 10, 16, 0, 0);
for (let i = 0; i < 144; i++) { horloge(new Date(t1 + i * 600e3).toISOString()); await req('/api/etat?bat=4.05&ti=' + (20 + 2 * Math.sin(i / 144 * 2 * Math.PI)).toFixed(1)); }
let h = JSON.parse(await (await req('/api/temperature')).text());
console.log('24 h, 144 réveils :', ecrituresH, 'écritures,', h.pts.length, 'points, de', Math.min(...h.pts.map(p => p[1])), 'à', Math.max(...h.pts.map(p => p[1])), '| écart', h.pts[1][0] - h.pts[0][0], 'min');
// Réveils sans mesure : aucun point ; 40 jours plus tard : les vieux points sont supprimés
horloge(new Date(t1 + 2 * 86400e3).toISOString()); await req('/api/etat?bat=4.05');
const avant = JSON.parse(kv.get('temperature').v).pts.length;
horloge(new Date(t1 + 40 * 86400e3).toISOString()); await req('/api/etat?bat=4.05&ti=18.2');
h = JSON.parse(kv.get('temperature').v);
console.log('sans mesure :', avant === 48 ? 'aucun point' : 'point ajouté (erreur)', '| après 40 jours :', h.pts.length, 'point', JSON.stringify(h.pts[0].slice(1)));
kv.delete('temperature');
console.log('rien enregistré :', await (await req('/api/temperature')).text());
