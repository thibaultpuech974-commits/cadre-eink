// Prévisualisation : état calculé avec des réglages non enregistrés, dessiné par apercu.wasm
import fs from 'fs';
import { createHash } from 'crypto';
import { req, post, horloge } from './simu.mjs';
horloge('2026-10-24T20:00:00+02:00');
// 1. Le module WebAssembly correspond au programme actuel de la carte
const ino = fs.readFileSync('../../carte/cadre_eink/cadre_eink.ino');
const attendu = createHash('sha1').update(ino).digest('hex').slice(0, 12);
const version = fs.readFileSync('../../serveur/apercu.version', 'utf8').trim();
console.log('apercu.wasm à jour :', version === attendu);
if (version !== attendu) console.log('-> le programme de la carte a changé : recompile la prévisualisation avec  bash outils/apercu/construire.sh');
// 2. Il se charge et dessine (servi par le serveur, comme pour la page)
const octets = await (await req('/api/apercu.wasm')).arrayBuffer();
let mem;
const v = () => new DataView(mem.buffer);
const wasi = { fd_prestat_get: () => 8, fd_prestat_dir_name: () => 8, fd_close: () => 0, fd_fdstat_get: () => 0, fd_seek: () => 0,
  fd_write: (fd, iovs, n, pE) => { let t = 0; for (let i = 0; i < n; i++) t += v().getUint32(iovs + 8 * i + 4, true); v().setUint32(pE, t, true); return 0; },
  clock_time_get: (a, b, p) => { v().setBigUint64(p, 0n, true); return 0; }, proc_exit: c => { throw new Error('exit ' + c); } };
const { instance } = await WebAssembly.instantiate(octets, { wasi_snapshot_preview1: wasi });
mem = instance.exports.memory; instance.exports._initialize();
const dessiner = etat => { const b = new TextEncoder().encode(JSON.stringify(etat)); const p = instance.exports.zone(b.length);
  new Uint8Array(mem.buffer, p, b.length).set(b); const img = instance.exports.dessiner(b.length, 4.0);
  let noirs = 0; const o = new Uint8Array(mem.buffer, img, 81600); for (const x of o) for (let k = 0; k < 8; k++) noirs += (x >> k) & 1; return noirs; };
// 3. Réglages non enregistrés -> état -> dessin
await post({ scenes: [{ id: 'gp', nom: 'Grand Prix', f1: 'weekend', disposition: [{ id: 'date', x: 0, y: 0, w: 12, h: 1 }, { id: 'f1', x: 0, y: 1, w: 6, h: 5 }] }],
  disposition: [{ id: 'date', x: 0, y: 0, w: 12, h: 1 }] });
const avant = (await (await req('/api/config')).json()).config;
const demande = (modif, scene) => req('/api/previsualiser', { method: 'POST', body: JSON.stringify({ modif, scene }) }).then(r => r.json());
let d = await demande({ disposition: [{ id: 'date', x: 0, y: 0, w: 12, h: 1 }, { id: 'meteo', x: 0, y: 1, w: 12, h: 3 }] }, -1);
console.log('par défaut modifiée :', d.scene, '|', d.ecrans.length, 'écran | blocs', d.ecrans[0].disposition.map(b => b.id).join(','), '| points noirs', dessiner(d.ecrans[0]) > 2000);
d = await demande({}, 0);
console.log('scène forcée :', d.scene, '| blocs', d.ecrans[0].disposition.map(b => b.id).join(','), '| GP', d.ecrans[0].f1 && d.ecrans[0].f1.gp, '| dessin', dessiner(d.ecrans[0]) > 2000);
d = await demande({ ecrans: { nb: 2, assemblage: 'cote' }, disposition: [{ id: 'date', x: 0, y: 0, w: 12, h: 1 }, { id: 'courbe', x: 12, y: 0, w: 12, h: 4 }] }, -1);
console.log('deux écrans :', d.ecrans.map(e => e.disposition.map(b => b.id).join(',')).join(' | '));
const apres = (await (await req('/api/config')).json()).config;
console.log('rien enregistré :', apres.version === avant.version && apres.ecrans.nb === 1 && apres.disposition.length === 1);
// Une prévision avec une autre ville et un autre agenda n'écrit rien dans le KV
import { kv } from './simu.mjs';
const cles = [...kv.keys()].sort().join(','), copie = kv.get('secours-meteo') && kv.get('secours-meteo').m;
d = await demande({ meteo: { ville: 'Lyon', lat: 45.76, lon: 4.84 }, agenda: { urls: ['https://ics.test/autre.ics'], nb: 3 }, bus: { nb: 2 } }, -1);
console.log('prévision météo/agenda :', d.ecrans.length === 1, '| aucune écriture :', [...kv.keys()].sort().join(',') === cles && (kv.get('secours-meteo') && kv.get('secours-meteo').m) === copie);
