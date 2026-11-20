// Droits des jetons de service Cloudflare Access
//
// Chaque requete authentifiee par Access porte un jeton JWT signe par Cloudflare (en-tete
// Cf-Access-Jwt-Assertion). Pour une personne connectee, il contient son adresse email ; pour un jeton
// de service, son identifiant (common_name = Client ID). Le serveur verifie la signature, puis limite
// chaque jeton de service au role qu'il a : la carte n'atteint que les routes de la carte, le raccourci
// iPhone que l'envoi de la pochette et de la liste « A faire ». Un jeton vole ne peut donc ni changer les reglages, ni lire la
// sauvegarde, ni envoyer un programme a la carte.
//
// Le role d'un jeton est devine a ce qu'il demande (la carte demande /api/etat avec sa version, le
// raccourci envoie une pochette) et se change dans la page web (menu Accès des jetons). Un jeton dont
// le role n'est ni devine ni choisi n'a aucun droit : il apparait dans la page, ou on lui en donne un.
import { json, texte } from './commun.js';

// Routes permises a chaque role ('tout' : aucune limite). Un role se teste avec estRole et non avec
// « in » : 'toString' in ROLES vaut true (propriete heritee d'Object).
export const ROLES = {
  carte: ['GET /api/etat', 'GET /api/photo', 'GET /api/pochette.jpg', 'POST /api/apercu', 'GET /api/firmware.bin'],
  raccourci: ['POST /api/pochette', 'POST /api/taches'],
  tout: null,
};

const estRole = r => typeof r === 'string' && Object.hasOwn(ROLES, r);
// Liste des jetons vus, gardee dans le KV. Objet sans prototype : un identifiant comme '__proto__' ou
// 'toString' y est une cle ordinaire, et non une propriete heritee.
async function lireJetons(env) {
  let lu = null;
  try { lu = JSON.parse((await env.CADRE.get('jetons')) || 'null'); } catch (e) { /* copie illisible : on repart de zero */ }
  return Object.assign(Object.create(null), lu && typeof lu === 'object' && !Array.isArray(lu) ? lu : {});
}

function deviner(route, url) {
  if (route === 'GET /api/etat' && url.searchParams.has('fw')) return 'carte';
  if (route === 'POST /api/pochette' || route === 'POST /api/taches') return 'raccourci';
  return null;        // role a choisir dans la page ; en attendant, aucun droit
}

// --- Verification du jeton JWT (RS256, cles publiques de l'equipe Cloudflare) ---
const octets = s => {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b + '='.repeat((4 - b.length % 4) % 4)), c => c.charCodeAt(0));
};
// Cles publiques de l'equipe Cloudflare Access (/cdn-cgi/access/certs), sur trois etages :
//  1. en memoire, une heure ;
//  2. dans le KV (cle 'access-cles'), douze heures. La memoire d'un Worker peu sollicite est videe
//     sans cesse : sans cette copie, les cles etaient retelechargees a un reveil du cadre sur trois
//     (132 fois en 24 h, 110 ms chaque fois, pendant que la carte attend sa reponse) ;
//  3. chez Cloudflare, quand la copie est trop vieille ou ne connait pas la cle du jeton (les cles
//     changent de temps en temps). Si Cloudflare ne repond pas, la copie sert jusqu'a 7 jours.
// La copie n'est reecrite que si elle a change ou a plus de douze heures (limite d'ecritures du KV).
const cles = new Map();     // equipe -> { t, k: Map(kid -> cle) }
const CLE_KV = 'access-cles', MEMOIRE_MS = 3600e3, COPIE_MS = 12 * 3600e3, SECOURS_MS = 7 * 86400e3;
async function importer(jwks) {
  const k = new Map();
  for (const c of jwks || []) {
    if (c.kty !== 'RSA' || !c.kid) continue;
    k.set(c.kid, await crypto.subtle.importKey('jwk', { kty: 'RSA', n: c.n, e: c.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
  }
  return k;
}
async function cle(iss, kid, env) {
  let e = cles.get(iss);
  if (e && Date.now() - e.t <= MEMOIRE_MS && e.k.has(kid)) return e.k.get(kid);
  // Copie du KV : seulement les champs publics des cles (kid, n, e), pour cette equipe
  let copie = null;
  try { copie = JSON.parse((env && await env.CADRE.get(CLE_KV)) || 'null'); } catch (err) { /* pas de copie lisible */ }
  if (copie && (copie.iss !== iss || !Array.isArray(copie.keys))) copie = null;
  const connue = copie && copie.keys.some(c => c.kid === kid);
  if (connue && Date.now() - copie.t < COPIE_MS) {
    e = { t: Date.now(), k: await importer(copie.keys) };
    cles.set(iss, e);
    return e.k.get(kid) || null;
  }
  let keys;
  try {
    const rep = await fetch(iss + '/cdn-cgi/access/certs', { signal: AbortSignal.timeout(5000) });
    if (!rep.ok) throw new Error('clés de Cloudflare Access indisponibles (HTTP ' + rep.status + ')');
    keys = ((await rep.json()).keys || []).filter(c => c.kty === 'RSA' && c.kid).map(c => ({ kid: c.kid, kty: 'RSA', n: c.n, e: c.e }));
  } catch (err) {
    if (connue && Date.now() - copie.t < SECOURS_MS) {
      console.log('Clés de Cloudflare Access : copie de secours utilisée :', err.message);
      e = { t: Date.now(), k: await importer(copie.keys) };
      cles.set(iss, e);
      return e.k.get(kid) || null;
    }
    throw err;
  }
  e = { t: Date.now(), k: await importer(keys) };
  cles.set(iss, e);
  const texte = JSON.stringify(keys);
  if (env && (!copie || JSON.stringify(copie.keys) !== texte || Date.now() - copie.t >= COPIE_MS)) {
    try { await env.CADRE.put(CLE_KV, JSON.stringify({ iss, t: Date.now(), keys })); } catch (err) { /* limite d'ecriture : sans gravite */ }
  }
  return e.k.get(kid) || null;
}
// Contenu du jeton s'il est valable (signature de Cloudflare, application, date), sinon null.
// L'emetteur doit etre une equipe Cloudflare (*.cloudflareaccess.com), et le jeton viser cette
// application (aud) : un jeton d'une autre equipe ou d'une autre application est refuse.
export async function lireJwt(jwt, aud, env, maintenant = Date.now()) {
  const p3 = String(jwt).split('.');
  if (p3.length !== 3) return null;
  let tete, corps;
  try {
    tete = JSON.parse(new TextDecoder().decode(octets(p3[0])));
    corps = JSON.parse(new TextDecoder().decode(octets(p3[1])));
  } catch (e) { return null; }
  if (tete.alg !== 'RS256' || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(corps.iss || '')) return null;
  if (aud && ![].concat(corps.aud || []).includes(aud)) return null;
  const s = maintenant / 1000;
  if (!(corps.exp > s - 60) || (corps.nbf && corps.nbf > s + 60)) return null;
  const k = await cle(corps.iss, tete.kid, env);
  if (!k) return null;
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', k, octets(p3[2]), new TextEncoder().encode(p3[0] + '.' + p3[1]));
  return ok ? corps : null;
}

// Qui appelle, et a-t-il le droit ? Renvoie { refus } (une reponse a renvoyer telle quelle) ou
// { personne } : true pour une personne connectee, false pour un jeton de service dans son role.
export async function controlerAcces(req, access, env, url) {
  if (!access) return { refus: texte('Cloudflare Access requis', 403) };
  // Access ajoute toujours ce jeton ; s'il manque quand meme, on refuse plutot que de tout permettre
  const jwt = req.headers.get('cf-access-jwt-assertion');
  if (!jwt) return { refus: texte('Jeton Cloudflare Access absent', 403) };
  let p;
  try { p = await lireJwt(jwt, access.aud, env); } catch (e) { return { refus: texte('Vérification du jeton impossible : ' + e.message, 503) }; }
  if (!p) return { refus: texte('Jeton Cloudflare Access invalide', 403) };
  if (p.email || !p.common_name) return { personne: true };
  // Jeton de service
  const id = String(p.common_name).slice(0, 120);
  const route = req.method + ' ' + url.pathname;
  const jetons = await lireJetons(env);
  // Jeton jamais vu, ou encore sans role : on essaie de le deviner a cette requete
  if (!jetons[id] || !jetons[id].role) {
    const devine = deviner(route, url);
    if (!jetons[id] || devine) {
      jetons[id] = { role: devine, vu: (jetons[id] && jetons[id].vu) || Date.now(), route: (jetons[id] && jetons[id].route) || route };
      try { await env.CADRE.put('jetons', JSON.stringify(jetons)); } catch (e) { /* limite d'ecriture : reessaye au prochain appel */ }
    }
  }
  const role = jetons[id].role;
  // Sans role : aucun droit (et non tous, comme avant), jusqu'a ce qu'on lui en choisisse un dans la page
  if (!estRole(role)) {
    return { refus: texte('Ce jeton n\'a pas encore de rôle : choisis-le dans la page web (menu Accès des jetons)', 403) };
  }
  if (!ROLES[role] || ROLES[role].includes(route)) return { personne: false };
  return { refus: texte('Ce jeton (rôle « ' + role + ' ») n\'a pas accès à ' + route, 403) };
}

// --- Page web : liste des jetons vus et choix de leur role (personnes seulement) ---
export async function routeLireJetons(env) {
  return json({ jetons: await lireJetons(env), roles: Object.keys(ROLES) });
}
export async function routeEcrireJetons(req, env) {
  let m;
  try { m = await req.json(); } catch (e) { return texte('Demande illisible', 400); }
  const jetons = await lireJetons(env);
  if (!m || typeof m.id !== 'string' || !Object.hasOwn(jetons, m.id)) return texte('Jeton inconnu', 400);
  if (m.oublier) delete jetons[m.id];
  else if (estRole(m.role)) jetons[m.id].role = m.role;
  else return texte('Rôle inconnu', 400);
  await env.CADRE.put('jetons', JSON.stringify(jetons));
  return json({ jetons });
}
