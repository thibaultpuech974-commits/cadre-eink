// Frise des scènes (quelle scène à quelle heure, sur 7 jours) et retour « appliqué » (le cadre a-t-il reçu les réglages ?)
import { kv, KV, req, post, horloge } from './simu.mjs';
const D = ids => ids.map((id, i) => ({ id, x: 0, y: i ? 2 * i - 1 : 0, w: 12, h: i ? 2 : 1 }));
const scene = (id, nom, extra) => Object.assign({ id, nom, creneaux: [], f1: '', du: '', au: '', reveilMin: 0, disposition: D(['date', 'meteo']) }, extra);
const BUS = scene('bus', 'Bus', { creneaux: [{ jours: [1, 1, 1, 1, 1, 0, 0], debut: '07:00', fin: '08:00' }, { jours: [0, 0, 0, 0, 1, 0, 0], debut: '18:00', fin: '20:00' }] });
const VAC = scene('vac', 'Vacances', { du: '2026-11-14', au: '2026-11-14' });
const WE = scene('we', 'Week-end', { creneaux: [{ jours: [0, 0, 0, 0, 0, 1, 1], debut: '09:00', fin: '22:00' }] });
const hm = t => new Date(t).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', hour: '2-digit', minute: '2-digit' }).replace('.', '');
const frise = async scenes => (await req('/api/frise', { method: 'POST', body: JSON.stringify({ modif: { scenes } }) })).json();
const lire = async () => (await req('/api/config')).json();

// --- 1. Frise : mardi 10 novembre 2026 à midi ; rien n'est enregistré
horloge('2026-11-10T12:00:00+01:00');
await post({ reveilMin: 10, disposition: D(['date', 'meteo']), scenes: [] });
const ecritures = () => [...kv.keys()].sort().join(',') + '|' + kv.get('config').v.length;
const avant = ecritures();
let f = await frise([BUS, VAC, WE]);
const nom = i => i < 0 ? 'défaut' : f.noms[i];
console.log('jours :', f.jours.map(j => j.nom).join(' | '));
console.log('frise :', f.segments.map(s => hm(s.t) + ' ' + nom(s.scene)).join(' | '));
// Priorité : la première scène de la liste l'emporte
f = await frise([WE, VAC, BUS]);
console.log('week-end prioritaire :', f.segments.filter(s => s.t >= f.jours[4].t0 && s.t < f.jours[5].t1).map(s => hm(s.t) + ' ' + nom(s.scene)).join(' | '));
f = await frise([]);
console.log('sans scène :', f.segments.length, 'segment', nom(f.segments[0].scene), '| rien enregistré :', ecritures() === avant);
console.log('demande illisible :', (await req('/api/frise', { method: 'POST', body: 'pas du JSON' })).status,
  '| scène sans créneau valide : gardée sans lui', (await frise([scene('x', 'X', { creneaux: [{ jours: [0, 0, 0, 0, 0, 0, 0], debut: '10:00', fin: '09:00' }] })])).segments.map(s => s.scene).join());
// Semaine du changement d'heure (dimanche 25 octobre 2026 : 25 heures)
horloge('2026-10-22T12:00:00+02:00');
f = await frise([WE]);
console.log('changement d\'heure : dimanche de', (f.jours[3].t1 - f.jours[3].t0) / 3600e3, 'h |', f.segments.filter(s => s.t >= f.jours[3].t0 && s.t < f.jours[3].t1).map(s => hm(s.t) + ' ' + nom(s.scene)).join(' | '));

// --- 2. Appliqué : le serveur note la version des réglages reçue par la carte, et depuis quand
horloge('2026-11-10T12:00:00+01:00');
const etatPage = async () => { const d = await lire(); return d.statut && typeof d.statut.cv === 'number' ? (d.statut.cv === d.config.version ? 'appliqué à ' + hm(d.statut.cvt) : 'en attente') : 'inconnu'; };
console.log('avant le premier réveil :', await etatPage());
await req('/api/etat?bat=4.05&fw=20261108-101500');
console.log('réveil :', await etatPage());
horloge('2026-11-10T12:04:00+01:00');
await post({ mode: 'photo' });
console.log('changement de mode :', await etatPage());
horloge('2026-11-10T12:10:00+01:00');
await req('/api/etat?bat=4.05&fw=20261108-101500');
console.log('réveil suivant :', await etatPage());
horloge('2026-11-10T12:20:00+01:00');
await req('/api/etat?bat=4.05&fw=20261108-101500');
console.log('10 min après, heure gardée :', await etatPage());
const v = (await lire()).config.version;
await post({ affichage: { bordureApercu: 20 } });
console.log('contour de l\'aperçu :', await etatPage(), '| version inchangée :', (await lire()).config.version === v);
await post({ affichage: { bordureApercu: 20, traits: false } });
console.log('contour et traits :', await etatPage());
