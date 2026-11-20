// Heures creuses (réveils espacés sur des plages jours + heures) et alertes sur l'iPhone (Bark)
import w from '../../serveur/worker.js';
import { kv, KV, req, post, etat, horloge } from './simu.mjs';
const env = { CADRE: KV };
const D = ids => ids.map((id, i) => ({ id, x: 0, y: i ? 2 * i - 1 : 0, w: 12, h: i ? 2 : 1 }));
// --- 1. Heures creuses : lun-ven 8 h-17 h, réveil toutes les 2 h ; une scène à son propre rythme le mardi midi
let r = await post({ reveilMin: 10, disposition: D(['date', 'meteo']),
  scenes: [{ id: 'midi', nom: 'Midi', creneaux: [{ jours: [0, 1, 0, 0, 0, 0, 0], debut: '12:00', fin: '13:00' }], reveilMin: 5, disposition: D(['date', 'courbe']) }],
  creuses: { actif: true, intervalleMin: 120, creneaux: [{ jours: [1, 1, 1, 1, 1, 0, 0], debut: '08:00', fin: '17:00' }, { jours: [1, 0, 0, 0, 0, 0, 0], debut: '18:00', fin: '09:00' }] } });
console.log('plages gardées :', r.config.creuses.creneaux.map(c => c.debut + '-' + c.fin).join(','), '| intervalle', r.config.creuses.intervalleMin);
const reveils = [];
for (const [nom, iso] of [['mar 7h50', '2026-11-10T07:50:00+01:00'], ['mar 9h00', '2026-11-10T09:00:00+01:00'], ['mar 11h00', '2026-11-10T11:00:00+01:00'],
  ['mar 12h30', '2026-11-10T12:30:00+01:00'], ['mar 16h30', '2026-11-10T16:30:00+01:00'], ['mar 17h10', '2026-11-10T17:10:00+01:00'], ['sam 10h00', '2026-11-14T10:00:00+01:00']]) {
  reveils.push(nom + ' ' + (await etat(iso)).reveil);
}
console.log('réveils :', reveils.join(' | '));
await post({ creuses: { actif: false } });
console.log('décochées :', (await etat('2026-11-10T09:00:00+01:00')).reveil, '| plages gardées', (await (await req('/api/config')).json()).config.creuses.creneaux.length);
await post({ reveilMin: 60, creuses: { actif: true, intervalleMin: 30 } });
console.log('jamais plus souvent que le rythme normal :', (await etat('2026-11-10T09:00:00+01:00')).reveil);
await post({ reveilMin: 10, creuses: { actif: false }, scenes: [] });

// --- 2. Alertes : notifications Bark envoyées par le déclencheur planifié, directement à Apple (APNs)
//        ou par le serveur public de Bark en secours
const notifs = [], jwts = [];
const ancien = globalThis.fetch;
let applePanne = 0, barkPanne = false, depot = 'ok';
// Dépôt open source de Bark simulé : mêmes fichiers que sur GitHub, clé identique, changée ou fichiers déplacés
const SOURCE = (await import('fs')).readFileSync(new URL('../../serveur/bark.js', import.meta.url), 'utf8');
const CLE_APPLE = SOURCE.match(/APNS_CLE = '([^']+)'/)[1];
const lectures = [];
globalThis.fetch = async (u, o) => {
  u = String(u);
  if (u.startsWith('https://api.push.apple.com/3/device/')) {
    const h = o.headers, jwt = h.authorization.replace('bearer ', '');
    if (!jwts.includes(jwt)) jwts.push(jwt);
    if (applePanne) return new Response(JSON.stringify({ reason: { 410: 'Unregistered', 403: 'ExpiredProviderToken', 4031: 'InvalidProviderToken' }[applePanne] || 'InternalServerError' }), { status: applePanne === 4031 ? 403 : applePanne });
    const b = JSON.parse(o.body);
    notifs.push({ title: b.aps.alert.title, message: b.aps.alert.body, level: b.level, via: 'apple:' + u.slice(36, 42) + ':' + h['apns-topic'] }); return new Response('');
  }
  if (u.startsWith('https://raw.githubusercontent.com/Finb/bark-server/master/apns/')) {
    lectures.push(u.split('/').pop());
    if (depot === '404') return new Response('404: Not Found', { status: 404 });
    if (u.endsWith('apns_certs.go')) return new Response('package apns\n\n// Bark push private key\nconst apnsPrivateKey = `-----BEGIN PRIVATE KEY-----\n' +
      (depot === 'change' ? 'MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQgNOUVELLE' : CLE_APPLE).match(/.{1,64}/g).join('\n') + '\n-----END PRIVATE KEY-----\n`\n');
    return new Response('const (\n\ttopic          = "me.fin.bark"\n\tkeyID          = "' + (depot === 'change' ? 'ZZ9ZZ9ZZ9Z' : 'LH4T9V5U4R') + '"\n\tteamID         = "5U8LBRXG3A"\n)\n');
  }
  if (u === 'https://api.day.app/push') {
    if (barkPanne) return new Response(JSON.stringify({ code: 400, message: 'failed to get device token' }), { status: 400 });
    const b = JSON.parse(o.body);
    notifs.push({ title: b.title, message: b.body, level: b.level, via: 'bark:' + b.device_key.slice(0, 4) }); return new Response('{"code":200,"message":"success"}');
  }
  return ancien(u, o);
};
const cron = async (iso) => { if (iso) horloge(iso); const avant = notifs.length; await w.scheduled({}, env, {}); return notifs.slice(avant).map(n => n.title + ' [' + n.via + ' ' + n.level + ']').join(' + ') || 'rien'; };
const TOKEN = 'ab12'.repeat(16), CLE = 'Kq7pLmZx3RtYvBn8Wc2HdF';
const suivi = () => { const m = JSON.parse(kv.get('alertes').v); delete m.cleApple; return JSON.stringify(m); };
const statut = async corps => (await req('/api/config', { method: 'POST', body: JSON.stringify(corps) })).status;
console.log('token invalide :', await statut({ alertes: { token: 'pas-un-token' } }), '| clé invalide :', await statut({ alertes: { cle: 'x' } }),
  '| actif sans destinataire :', await statut({ alertes: { actif: true } }));
horloge('2026-11-10T12:00:00+01:00');
await req('/api/etat?bat=4.05&pct=85&fw=20261108-101500');
console.log('alertes désactivées :', await cron('2026-11-10T20:00:00+01:00'));
await post({ alertes: { actif: true, token: '<' + TOKEN.toUpperCase().match(/.{8}/g).join(' ') + '>' } });
console.log('token nettoyé :', (await (await req('/api/config')).json()).config.alertes.token === TOKEN);
horloge('2026-11-10T12:00:00+01:00');
await req('/api/etat?bat=4.05&pct=85&fw=20261108-101500');
console.log('tout va bien :', await cron('2026-11-10T12:07:00+01:00'), '| 2 h après :', await cron('2026-11-10T14:07:00+01:00'));
console.log('5 h sans nouvelles :', await cron('2026-11-10T17:07:00+01:00'), '|', notifs.at(-1).message);
console.log('une heure après :', await cron('2026-11-10T18:07:00+01:00'), '| rappel le lendemain :', await cron('2026-11-11T17:07:00+01:00'));
applePanne = 500; await req('/api/etat?bat=3.62&pct=15&fw=20261108-101500');
console.log('Apple en panne, pas de clé :', await cron('2026-11-11T18:07:00+01:00'), '| erreur retenue :', JSON.parse(kv.get('alertes').v).erreur.m);
applePanne = 0;
console.log('retour, batterie à 15 % :', await cron('2026-11-11T19:07:00+01:00'), '|', notifs.at(-1).message, '| erreur effacée :', !('erreur' in JSON.parse(kv.get('alertes').v)));
// Le pourcentage hésite autour du seuil : pas de nouvelle notification ; en charge : l'alerte repart de zéro
const vu = async (iso, q) => { horloge(iso); await req('/api/etat?fw=20261108-101500&' + q); };
await vu('2026-11-11T20:00:00+01:00', 'bat=3.66&pct=21'); const h1 = await cron('2026-11-11T20:07:00+01:00');
await vu('2026-11-11T21:00:00+01:00', 'bat=3.64&pct=19'); const h2 = await cron('2026-11-11T21:07:00+01:00');
console.log('seuil hésitant :', h1, '/', h2, '| suivi gardé :', 'batterie' in JSON.parse(kv.get('alertes').v));
await vu('2026-11-11T22:00:00+01:00', 'bat=3.9&pct=22&crate=12.5');
console.log('en charge :', await cron('2026-11-11T22:07:00+01:00'), '| suivi :', suivi());
// Cadre rangé (écran blanc) : pas d'alerte « muet »
await post({ mode: 'blanc' });
console.log('écran blanc, 2 jours sans nouvelles :', await cron('2026-11-13T08:07:00+01:00'));
await post({ mode: 'tableau' });
// Horaires de bus : index valable jusqu'au 15/11 (services) ou au 16/11 (jour ajouté), bloc bus dans une scène
const index = { arrets: ['Gare'], lignes: ['T1'], destinations: ['Centre'], passages: [['t1', 0, 0, 0, 61200, 'S1']],
  services: [{ j: '1111100', d: '20260901', f: '20261115' }, { j: '0000000', plus: ['20261116'] }, { j: '0000000', d: '20260901', f: '20270101' }] };
await req('/api/bus-index', { method: 'POST', body: JSON.stringify(index) });
await vu('2026-11-13T09:00:00+01:00', 'bat=4.1&pct=95');
console.log('bloc bus absent :', await cron('2026-11-13T09:07:00+01:00'), '| fin retenue :', kv.get('bus-fin').v);
await post({ scenes: [{ id: 'bus', nom: 'Bus', creneaux: [{ jours: [0, 0, 0, 0, 1, 0, 0], debut: '18:00', fin: '20:00' }], disposition: D(['date', 'bus']) }] });
console.log('3 jours avant la fin :', await cron('2026-11-13T10:07:00+01:00'));
await vu('2026-11-14T09:00:00+01:00', 'bat=4.1&pct=95');
console.log('2 jours avant la fin :', await cron('2026-11-14T09:07:00+01:00'), '|', notifs.at(-1).message);
await vu('2026-11-15T09:00:00+01:00', 'bat=4.1&pct=95');
console.log('le lendemain :', await cron('2026-11-15T09:07:00+01:00'));
await vu('2026-11-17T10:00:00+01:00', 'bat=4.1&pct=94');
console.log('3 jours après, périmés :', await cron('2026-11-17T10:07:00+01:00'));
// Ancien index (enregistré avant cette version, sans date retenue) : la fin est calculée une fois
kv.delete('bus-fin');
const e = await (await req('/api/alertes')).json();
console.log('état pour la page :', e.etats.filter(x => x.cle !== 'cleApple').map(x => x.cle + (x.probleme ? ' ! ' : ' : ') + x.info).join(' | '), '| fin recalculée :', kv.get('bus-fin').v);
// Notification d'essai depuis la page (champs non enregistrés), alerte critique, secours, erreurs
const essai = async corps => { const r = await req('/api/alertes/essai', { method: 'POST', body: JSON.stringify(corps) }); return r.status + ' ' + (r.ok ? (await r.json()).chemin : await r.text()); };
let avant = notifs.length;
console.log('essai :', await essai({ token: TOKEN }), notifs.length - avant, notifs.at(-1).title, notifs.at(-1).level,
  '| critique :', await essai({ token: TOKEN, critique: true }), notifs.at(-1).level);
console.log('token invalide :', await essai({ token: 'zz' }), '| rien :', await essai({}));
applePanne = 410;
console.log('token périmé, sans clé :', await essai({ token: TOKEN }));
console.log('token périmé, avec clé :', await essai({ token: TOKEN, cle: 'https://api.day.app/' + CLE + '/' }), notifs.at(-1).via);
barkPanne = true;
console.log('les deux en panne :', await essai({ token: TOKEN, cle: CLE }));
applePanne = 0; barkPanne = false;
console.log('clé seule :', await essai({ cle: CLE }), notifs.at(-1).via);
// Jeton d'authentification d'Apple expiré : refait une fois, puis gardé
applePanne = 403; avant = jwts.length;
const r403 = await essai({ token: TOKEN });
applePanne = 0;
console.log('jeton Apple refusé :', r403, '| nouveau jeton essayé :', jwts.length - avant);
// Cadre muet en alerte critique, par la clé seulement
await post({ alertes: { critique: true, token: '', cle: CLE } });
await vu('2026-11-17T10:00:00+01:00', 'bat=4.1&pct=94');
console.log('critique, 5 h sans nouvelles :', await cron('2026-11-17T15:07:00+01:00'));
await post({ alertes: { critique: false, token: TOKEN, cle: '' } });
await vu('2026-11-17T15:30:00+01:00', 'bat=4.1&pct=94');
console.log('retour :', await cron('2026-11-17T16:07:00+01:00'));
await post({ alertes: { bus: false } });
console.log('alerte bus décochée :', await cron('2026-11-17T17:07:00+01:00'), '| suivi :', suivi());

// --- 3. Vérifications de l'envoi direct (déclencheur de 12:07, heure de Paris)
await post({ alertes: { bus: true, cle: CLE } });
await post({ scenes: [] });
const memoA = () => JSON.parse(kv.get('alertes').v);
const page = async () => (await (await req('/api/alertes')).json());
// Envoi direct raté, le secours prend le relais et le signale dans la notification et sur la page
await vu('2026-11-18T08:00:00+01:00', 'bat=4.1&pct=94');
applePanne = 410; // le cadre se tait 5 h : alerte « muet »
console.log('direct raté, secours :', await cron('2026-11-18T13:07:00+01:00'), '|', notifs.at(-1).message.split('\n')[1], '| page :', (await page()).erreur.m);
applePanne = 0;
await vu('2026-11-18T13:30:00+01:00', 'bat=4.1&pct=94');
console.log('direct rétabli :', await cron('2026-11-18T14:07:00+01:00'), '| erreur effacée :', (await page()).erreur === null);
// Clé Apple refusée par Apple : cause « clé » (et non Device Token)
applePanne = 4031;
console.log('clé Apple refusée :', await essai({ token: TOKEN, cle: CLE }), '|', notifs.at(-1).message.split('\n')[1]);
applePanne = 0;
// Clé Apple : vérifiée chaque jour à 12 h seulement, identique au dépôt
lectures.length = 0;
await vu('2026-11-19T11:00:00+01:00', 'bat=4.1&pct=94');
console.log('11 h : ', await cron('2026-11-19T11:07:00+01:00'), lectures.length, 'lecture(s) | 12 h :', await cron('2026-11-19T12:07:00+01:00'), lectures.join(','),
  '| page :', (await page()).etats.find(e => e.cle === 'cleApple').info);
// L'auteur de Bark change de clé : alerte, pas de nouvelle alerte le lendemain, rappel 7 jours après
depot = 'change';
await vu('2026-11-20T11:00:00+01:00', 'bat=4.1&pct=94');
console.log('clé changée :', await cron('2026-11-20T12:07:00+01:00'), '|', notifs.at(-1).message);
await vu('2026-11-21T11:00:00+01:00', 'bat=4.1&pct=94');
console.log('le lendemain :', await cron('2026-11-21T12:07:00+01:00'), '| page :', (await page()).etats.find(e => e.cle === 'cleApple').info);
await vu('2026-11-27T11:00:00+01:00', 'bat=4.1&pct=94');
console.log('7 jours après :', await cron('2026-11-27T12:07:00+01:00'));
depot = 'ok';
await vu('2026-11-28T11:00:00+01:00', 'bat=4.1&pct=94');
console.log('clé de nouveau identique :', await cron('2026-11-28T12:07:00+01:00'), '| suivi :', JSON.stringify(memoA().cleApple));
// Dépôt illisible : pas d'alerte, la page le dit
depot = '404';
await vu('2026-12-01T11:00:00+01:00', 'bat=4.1&pct=94');
console.log('dépôt illisible :', await cron('2026-12-01T12:07:00+01:00'), '| page :', (await page()).etats.find(e => e.cle === 'cleApple').info);
depot = 'ok';
// Dimanche 12 h : notification discrète ; refusée sans secours : erreur sur la page
await vu('2026-11-29T11:00:00+01:00', 'bat=4.1&pct=94');
console.log('dimanche 12 h :', await cron('2026-11-29T12:07:00+01:00'), '| dimanche 13 h :', await cron('2026-11-29T13:07:00+01:00'));
await post({ alertes: { cle: '' } });
applePanne = 410;
await vu('2026-12-06T11:00:00+01:00', 'bat=4.1&pct=94');
console.log('dimanche, token périmé sans secours :', await cron('2026-12-06T12:07:00+01:00'), '| page :', (await page()).erreur.m);
applePanne = 0;
await post({ alertes: { hebdo: false } });
await vu('2026-12-13T11:00:00+01:00', 'bat=4.1&pct=94');
console.log('vérification décochée :', await cron('2026-12-13T12:07:00+01:00'));
// Sans Device Token (clé seule) : rien à vérifier
await post({ alertes: { token: '', cle: CLE, hebdo: true } });
lectures.length = 0;
await vu('2026-12-20T11:00:00+01:00', 'bat=4.1&pct=94');
console.log('clé seule, dimanche 12 h :', await cron('2026-12-20T12:07:00+01:00'), lectures.length, 'lecture(s) | ligne clé Apple :', (await page()).etats.some(e => e.cle === 'cleApple'));

// Jeton d'authentification d'Apple : un JWT ES256 valide pour la clé de Bark (en-tête kid, émetteur team)
const [h64, c64, s64] = jwts[0].split('.');
const deB64 = t => Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const entete = JSON.parse(new TextDecoder().decode(deB64(h64))), corps = JSON.parse(new TextDecoder().decode(deB64(c64)));
const PEM = (await import('fs')).readFileSync(new URL('../../serveur/bark.js', import.meta.url), 'utf8').match(/APNS_CLE = '([^']+)'/)[1];
const privee = await crypto.subtle.importKey('pkcs8', deB64(PEM), { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
const jwk = await crypto.subtle.exportKey('jwk', privee);
const publique = await crypto.subtle.importKey('jwk', { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publique, deB64(s64), new TextEncoder().encode(h64 + '.' + c64));
console.log('JWT :', entete.alg, entete.kid, corps.iss, typeof corps.iat, '| signature valide :', ok, '| jetons différents :', jwts.length);
