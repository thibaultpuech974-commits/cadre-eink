// Deux écrans assemblés : grille doublée, chaque dalle reçoit sa moitié
import { kv, req, post, etat, horloge } from './simu.mjs';
horloge('2026-10-27T12:00:00+01:00');
const ids = e => e.disposition.map(d => d.id + '@' + d.x + ',' + d.y + ' ' + d.w + 'x' + d.h).join(' ');
await post({ ecrans: { nb: 2, assemblage: 'cote', joint: 15 }, affichage: { rotation: 0 }, scenes: [],
  disposition: [
    { id: 'date', x: 0, y: 0, w: 12, h: 1 }, { id: 'meteo', x: 0, y: 1, w: 12, h: 3 }, { id: 'jours', x: 0, y: 4, w: 12, h: 4 },
    { id: 'courbe', x: 12, y: 0, w: 12, h: 4 }, { id: 'f1', x: 12, y: 4, w: 6, h: 4 },
    { id: 'agenda', x: 10, y: 4, w: 4, h: 2 },        // a cheval sur la jointure : refuse
    { id: 'bus', x: 18, y: 4, w: 6, h: 4 } ] });
const cfg = (await (await req('/api/config')).json()).config;
console.log('enregistré :', cfg.disposition.map(d => d.id).join(','), '(agenda à cheval refusé)');
const at = async (iso, n) => { const e = await etat(iso); return e; };
const e0 = await (await req('/api/etat?ecran=0')).json(), e1 = await (await req('/api/etat?ecran=1')).json();
console.log('écran 0 :', ids(e0), '| données :', ['meteo', 'f1', 'bus', 'agenda'].filter(k => k in e0).join(','));
console.log('écran 1 :', ids(e1), '| données :', ['meteo', 'f1', 'bus', 'agenda'].filter(k => k in e1).join(','), '| ecran', e1.ecran);
console.log('signatures différentes :', e0.sig !== e1.sig);
// Statut séparé par dalle
await req('/api/etat?ecran=1&bat=3.95&fw=20261027-120000');
const c = await (await req('/api/config')).json();
console.log('statut écran 2 :', c.statut1 && c.statut1.bat, c.statut1 && c.statut1.fw);
// L'un au-dessus de l'autre, en portrait (8 x 24)
await post({ ecrans: { nb: 2, assemblage: 'dessus' }, affichage: { rotation: 1 },
  dispositionPortrait: [{ id: 'date', x: 0, y: 0, w: 8, h: 1 }, { id: 'courbe', x: 0, y: 12, w: 8, h: 4 }, { id: 'jours', x: 0, y: 10, w: 8, h: 4 }] });
const p0 = await (await req('/api/etat?ecran=0')).json(), p1 = await (await req('/api/etat?ecran=1')).json();
console.log('dessus portrait — écran 0 :', ids(p0), '| écran 1 :', ids(p1), '(jours à cheval refusé)');
// Photo : deux images mises bout à bout
const photo = new Uint8Array(81600 * 2); photo[0] = 1; photo[81600] = 2;
console.log('photo double :', (await req('/api/photo?r=1', { method: 'POST', body: photo })).status,
  'écran 0 octet 0 =', new Uint8Array(await (await req('/api/photo')).arrayBuffer())[0],
  '| écran 1 octet 0 =', new Uint8Array(await (await req('/api/photo?ecran=1')).arrayBuffer())[0],
  '| photo simple refusée :', (await req('/api/photo', { method: 'POST', body: new Uint8Array(81600) })).status);
// Pochette : image sur l'un, texte sur l'autre
await post({ mode: 'pochette' });
console.log('pochette :', (await (await req('/api/etat?ecran=0')).json()).partie, '/', (await (await req('/api/etat?ecran=1')).json()).partie);
// Retour à un seul écran : les blocs de la 2e dalle disparaissent, ancienne carte inchangée
await post({ mode: 'tableau', ecrans: { nb: 1 }, affichage: { rotation: 0 } });
const s = await (await req('/api/etat')).json();
console.log('un écran :', ids(s), '| ecran' in s ? 'champ ecran présent' : 'pas de champ ecran');
