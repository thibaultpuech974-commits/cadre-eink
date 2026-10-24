// Scènes : migration des anciens réglages, choix de la scène affichée, rythme et réveils
import { kv, req, post, etat } from './simu.mjs';
const D = (ids) => ids.map((id, i) => ({ id, x: 0, y: i ? 2 * i - 1 : 0, w: 12, h: i ? 2 : 1 }));
const blocs = e => e.disposition.map(d => d.id).join(',');
// 1. Migration : ancienne config (disposition bus + créneau vendredi, option F1 semaine)
kv.set('config', { v: JSON.stringify({ reveilMin: 10, disposition: D(['date', 'meteo', 'f1']), dispositionPortrait: [],
  dispositionBus: D(['date', 'bus']), bus: { toujours: false, creneaux: [{ jours: [0,0,0,0,1,0,0], debut: '18:00', fin: '20:00' }], reveilMin: 3 },
  f1: { semaine: true } }) });
const c = await (await req('/api/config')).json();
console.log('migration :', c.config.scenes.map(s => s.nom + ' [' + s.disposition.map(d => d.id) + '] ' + JSON.stringify(s.creneaux.map(x => x.debut + '-' + x.fin)) + ' f1=' + s.f1 + ' r=' + s.reveilMin).join(' | '),
  '| défaut :', c.config.disposition.map(d => d.id).join(','), '| reste :', ['dispositionBus', 'f1'].filter(k => k in c.config).join(',') || 'rien');
// 2. Scènes : Bus (ven 18-20, 3 min), Grand Prix (week-end GP, 30 min), Vacances (dates)
await post({ scenes: [
  { id: 'bus', nom: 'Bus', creneaux: [{ jours: [0,0,0,0,1,0,0], debut: '18:00', fin: '20:00' }], reveilMin: 3, disposition: D(['date', 'bus']) },
  { id: 'gp', nom: 'Grand Prix', f1: 'weekend', reveilMin: 30, disposition: D(['date', 'f1', 'meteo']) },
  { id: 'vac', nom: 'Vacances', du: '2026-10-17', au: '2026-11-01', disposition: D(['date', 'courbe']) },
  { id: 'x', nom: 'Invalide', creneaux: [{ jours: [0,0,0,0,0,0,0], debut: '9:00', fin: '8:00' }], reveilMin: 7, disposition: [{ id: 'inconnu', x: 0, y: 0, w: 1, h: 1 }] },
], disposition: D(['date', 'meteo', 'agenda']), reveilMin: 10 });
const sc = (await (await req('/api/config')).json()).config.scenes;
console.log('validation : scène invalide ->', JSON.stringify(sc[3].creneaux), 'reveil', sc[3].reveilMin, 'blocs', sc[3].disposition.length);
await post({ scenes: sc.slice(0, 3) });
for (const [nom, iso] of [
  ['mer 14/10 12h00', '2026-10-14T12:00:00+02:00'], ['ven 16/10 17h50', '2026-10-16T17:50:00+02:00'], ['ven 16/10 18h30', '2026-10-16T18:30:00+02:00'],
  ['ven 16/10 19h58', '2026-10-16T19:58:00+02:00'], ['jeu 22/10 22h00', '2026-10-22T22:00:00+02:00'], ['ven 23/10 08h00 (GP)', '2026-10-23T08:00:00+02:00'],
  ['ven 23/10 18h30 (bus+GP)', '2026-10-23T18:30:00+02:00'], ['dim 25/10 23h30', '2026-10-25T23:30:00+01:00'], ['lun 02/11 09h00', '2026-11-02T09:00:00+01:00']]) {
  const e = await etat(iso);
  console.log(nom.padEnd(26), (e.scene || '').padEnd(11), blocs(e).padEnd(18), 'réveil', e.reveil, 's');
}
// 3. La signature ne dépend pas du nom de la scène ni du prochain changement
const e1 = await etat('2026-10-14T12:00:00+02:00'), e2 = await etat('2026-10-14T12:05:00+02:00');
console.log('signature stable entre 12h00 et 12h05 :', e1.sig === e2.sig);
