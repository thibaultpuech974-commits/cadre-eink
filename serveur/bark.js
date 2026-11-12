// Notifications sur l'iPhone par l'application Bark (gratuite, open source : github.com/Finb/Bark).
//
// Deux chemins, essayes dans cet ordre :
//  1. Envoi direct aux serveurs d'Apple (APNs), avec le « Device Token » copie dans Bark (Settings ->
//     Device Token). Aucun service intermediaire : rien ne depend d'une adresse IP partagee entre
//     Workers, contrairement a ntfy.sh qui limitait les envois par IP (HTTP 429).
//  2. Secours : le serveur public de Bark (api.day.app), avec la cle de l'appli (Service -> Copy Key).
//
// La cle Apple ci-dessous est celle de l'application Bark, publiee dans son serveur open source
// (github.com/Finb/bark-server, apns/apns_certs.go, licence MIT). Tous les serveurs Bark auto-heberges
// l'utilisent, par exemple github.com/cwxiaos/bark-worker sur Cloudflare Workers. Si l'auteur la
// change un jour, il faudra recopier la nouvelle ici.
const APNS_CLE = 'MIGTAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBHkwdwIBAQQg4vtC3g5L5HgKGJ2+T1eA0tOivREvEAY2g+juRXJkYL2gCgYIKoZIzj0DAQehRANCAASmOs3JkSyoGEWZsUGxFs/4pw1rIlSV2IC19M8u3G5kq36upOwyFWj9Gi3Ejc9d3sC7+SHRqXrEAJow8/7tRpV+';
const APNS_KEY_ID = 'LH4T9V5U4R';
const APNS_TEAM_ID = '5U8LBRXG3A';
const APNS_SUJET = 'me.fin.bark';
const APNS = 'https://api.push.apple.com/3/device/';
const BARK_PUBLIC = 'https://api.day.app/push';

// Device Token : hexadecimal (64 caracteres aujourd'hui, Apple se reserve de l'allonger)
export const TOKEN_VALIDE = /^[0-9a-f]{64,200}$/;
// Cle du serveur public de Bark (22 lettres et chiffres aujourd'hui)
export const CLE_VALIDE = /^[A-Za-z0-9]{10,64}$/;
export const nettoyerToken = t => String(t || '').replace(/[\s<>]/g, '').toLowerCase();
// La cle peut etre collee seule ou avec l'adresse (« https://api.day.app/AbCd.../ »)
export const nettoyerCle = c => String(c || '').trim().replace(/^https?:\/\/[^/]+\//, '').split('/')[0];

const b64url = octets => btoa(String.fromCharCode(...new Uint8Array(octets))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const texteB64url = s => b64url(new TextEncoder().encode(s));

// Jeton d'authentification d'Apple (JWT signe ES256). Apple demande de ne pas en refaire plus d'un toutes
// les 20 min et le refuse apres 1 h : il est garde 50 min, en memoire et dans le KV (« apns-jwt »).
let jwtMemoire = null;
async function jetonApple(env, maintenant, neuf) {
  const valide = j => j && maintenant - j.t < 50 * 60e3 && j.t <= maintenant;
  if (!neuf && valide(jwtMemoire)) return jwtMemoire.j;
  if (!neuf) {
    const kv = JSON.parse((await env.CADRE.get('apns-jwt')) || 'null');
    if (valide(kv)) { jwtMemoire = kv; return kv.j; }
  }
  const cle = await crypto.subtle.importKey('pkcs8', Uint8Array.from(atob(APNS_CLE), c => c.charCodeAt(0)),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const debut = texteB64url(JSON.stringify({ alg: 'ES256', kid: APNS_KEY_ID })) + '.' +
    texteB64url(JSON.stringify({ iss: APNS_TEAM_ID, iat: Math.floor(maintenant / 1000) }));
  // WebCrypto rend la signature au format r||s (64 octets), celui qu'attend un JWT
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, cle, new TextEncoder().encode(debut));
  jwtMemoire = { j: debut + '.' + b64url(sig), t: maintenant };
  try { await env.CADRE.put('apns-jwt', JSON.stringify(jwtMemoire)); } catch (e) { /* limite d'ecriture : garde en memoire */ }
  return jwtMemoire.j;
}

// Raisons d'Apple traduites (https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns)
const RAISONS = {
  BadDeviceToken: 'Device Token refusé par Apple : recopie-le depuis Bark (Settings → Device Token)',
  Unregistered: 'Device Token périmé (Bark désinstallée ou réinstallée ?) : recopie-le depuis Bark',
  DeviceTokenNotForTopic: 'ce Device Token n\'est pas celui de l\'application Bark',
  TooManyRequests: 'trop de notifications vers cet iPhone, Apple demande d\'attendre',
};

async function envoiApple(env, token, notif, maintenant) {
  // Charge utile au format de Bark : son extension lit level, volume et group (en texte)
  const corps = JSON.stringify({
    aps: { alert: { title: notif.titre, body: notif.message }, sound: '1107', 'mutable-content': 1, category: 'myNotificationCategory', 'thread-id': 'cadre' },
    group: 'cadre', level: notif.niveau || 'active', ...(notif.niveau === 'critical' ? { volume: '5' } : {}),
  });
  for (const neuf of [false, true]) {
    const r = await fetch(APNS + token, { method: 'POST', body: corps, signal: AbortSignal.timeout(8000), headers: {
      authorization: 'bearer ' + await jetonApple(env, maintenant, neuf), 'apns-topic': APNS_SUJET, 'apns-push-type': 'alert',
      'apns-priority': '10', 'apns-expiration': String(Math.floor(maintenant / 1000) + 86400), 'content-type': 'application/json' } });
    if (r.ok) return;
    let raison = '';
    try { raison = (await r.json()).reason || ''; } catch (e) { /* pas de JSON */ }
    // Jeton d'authentification refuse ou expire : on en refait un, une seule fois
    if (!neuf && r.status === 403 && /ProviderToken/.test(raison)) continue;
    throw new Error(RAISONS[raison] || 'Apple a répondu HTTP ' + r.status + (raison ? ' (' + raison + ')' : ''));
  }
}

async function envoiBarkPublic(cle, notif) {
  const r = await fetch(BARK_PUBLIC, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, signal: AbortSignal.timeout(8000),
    body: JSON.stringify({ device_key: cle, title: notif.titre, body: notif.message, group: 'cadre', level: notif.niveau || 'active',
      ...(notif.niveau === 'critical' ? { volume: 5 } : {}) }) });
  let d = null;
  try { d = await r.json(); } catch (e) { /* pas de JSON */ }
  if (!r.ok || (d && d.code && d.code !== 200)) throw new Error('api.day.app a répondu HTTP ' + r.status + (d && d.message ? ' (' + d.message + ')' : ''));
}

// Envoie une notification : directement a Apple si un Device Token est enregistre, sinon (ou en cas
// d'echec) par le serveur public de Bark si une cle l'est. Rend le chemin utilise ; leve une erreur
// qui explique chaque echec.
// notif : { titre, message, niveau } ; niveau = passive | active | timeSensitive | critical
export async function notifierBark(env, dest, notif, maintenant = Date.now()) {
  const token = nettoyerToken(dest.token), cle = nettoyerCle(dest.cle);
  const erreurs = [];
  if (TOKEN_VALIDE.test(token)) {
    try { await envoiApple(env, token, notif, maintenant); return 'apple'; } catch (e) { erreurs.push('direct : ' + e.message); }
  }
  if (CLE_VALIDE.test(cle)) {
    try { await envoiBarkPublic(cle, notif); return 'bark'; } catch (e) { erreurs.push('secours : ' + e.message); }
  }
  throw new Error(erreurs.join(' ; ') || 'ni Device Token ni clé Bark valide');
}
