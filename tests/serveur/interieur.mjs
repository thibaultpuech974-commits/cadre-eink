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
