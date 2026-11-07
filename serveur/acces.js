// Droits des jetons de service Cloudflare Access
//
// Chaque requete authentifiee par Access porte un jeton JWT signe par Cloudflare (en-tete
// Cf-Access-Jwt-Assertion). Pour une personne connectee, il contient son adresse email ; pour un jeton
// de service, son identifiant (common_name = Client ID). Le serveur verifie la signature, puis limite
// chaque jeton de service au role qu'il a : la carte n'atteint que les routes de la carte, le raccourci
// iPhone que l'envoi de la pochette. Un jeton vole ne peut donc ni changer les reglages, ni lire la
// sauvegarde, ni envoyer un programme a la carte.
//
// Le role d'un jeton est devine a sa premiere requete (la carte demande /api/etat avec sa version, le
// raccourci envoie une pochette) et se change dans la page web (menu Accès des jetons).
import { json, texte } from './commun.js';

// Routes permises a chaque role ('tout' : aucune limite)
export const ROLES = {
  carte: ['GET /api/etat', 'GET /api/photo', 'GET /api/pochette.jpg', 'POST /api/apercu', 'GET /api/firmware.bin'],
  raccourci: ['POST /api/pochette'],
  tout: null,
};

function deviner(route, url) {
  if (route === 'GET /api/etat' && url.searchParams.has('fw')) return 'carte';
  if (route === 'POST /api/pochette') return 'raccourci';
  return null;        // role a choisir dans la page ; en attendant, tous les droits (comme avant)
}

// --- Verification du jeton JWT (RS256, cles publiques de l'equipe Cloudflare) ---
const octets = s => {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b + '='.repeat((4 - b.length % 4) % 4)), c => c.charCodeAt(0));
};
const cles = new Map();     // equipe -> { t, k: Map(kid -> cle) }, gardees une heure
async function cle(iss, kid) {
  let e = cles.get(iss);
  if (!e || Date.now() - e.t > 3600e3 || !e.k.has(kid)) {
    const rep = await fetch(iss + '/cdn-cgi/access/certs', { signal: AbortSignal.timeout(5000) });
    if (!rep.ok) throw new Error('clés de Cloudflare Access indisponibles (HTTP ' + rep.status + ')');
    const k = new Map();
    for (const c of (await rep.json()).keys || []) {
      if (c.kty !== 'RSA' || !c.kid) continue;
      k.set(c.kid, await crypto.subtle.importKey('jwk', { kty: 'RSA', n: c.n, e: c.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']));
    }
    e = { t: Date.now(), k };
    cles.set(iss, e);
  }
  return e.k.get(kid) || null;
}
// Contenu du jeton s'il est valable (signature de Cloudflare, application, date), sinon null.
// L'emetteur doit etre une equipe Cloudflare (*.cloudflareaccess.com), et le jeton viser cette
// application (aud) : un jeton d'une autre equipe ou d'une autre application est refuse.
export async function lireJwt(jwt, aud, maintenant = Date.now()) {
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
  const k = await cle(corps.iss, tete.kid);
  if (!k) return null;
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', k, octets(p3[2]), new TextEncoder().encode(p3[0] + '.' + p3[1]));
  return ok ? corps : null;
}

// Qui appelle, et a-t-il le droit ? Renvoie { refus } (une reponse a renvoyer telle quelle) ou
// { personne } : true pour une personne connectee ou le mot de passe de secours.
export async function controlerAcces(req, access, env, url) {
  if (!access) return { personne: true };            // mode de secours (mot de passe CLE)
  const jwt = req.headers.get('cf-access-jwt-assertion');
  if (!jwt) return { personne: true };               // pas de jeton a lire (ne se produit pas chez Cloudflare)
  let p;
  try { p = await lireJwt(jwt, access.aud); } catch (e) { return { refus: texte('Vérification du jeton impossible : ' + e.message, 503) }; }
  if (!p) return { refus: texte('Jeton Cloudflare Access invalide', 403) };
  if (p.email || !p.common_name) return { personne: true };
  // Jeton de service
  const id = String(p.common_name).slice(0, 120);
  const route = req.method + ' ' + url.pathname;
  const jetons = JSON.parse((await env.CADRE.get('jetons')) || '{}');
  if (!jetons[id]) {
    jetons[id] = { role: deviner(route, url), vu: Date.now(), route };
    try { await env.CADRE.put('jetons', JSON.stringify(jetons)); } catch (e) { /* limite d'ecriture : reessaye au prochain appel */ }
  }
  const role = jetons[id].role || 'tout';
  if (!ROLES[role] || ROLES[role].includes(route)) return { personne: false };
  return { refus: texte('Ce jeton (rôle « ' + role + ' ») n\'a pas accès à ' + route, 403) };
}

// --- Page web : liste des jetons vus et choix de leur role (personnes seulement) ---
export async function routeLireJetons(env) {
  return json({ jetons: JSON.parse((await env.CADRE.get('jetons')) || '{}'), roles: Object.keys(ROLES) });
}
export async function routeEcrireJetons(req, env) {
  const m = await req.json();
  const jetons = JSON.parse((await env.CADRE.get('jetons')) || '{}');
  if (!m || !jetons[m.id]) return texte('Jeton inconnu', 400);
  if (m.oublier) delete jetons[m.id];
  else if (m.role in ROLES) jetons[m.id].role = m.role;
  else return texte('Rôle inconnu', 400);
  await env.CADRE.put('jetons', JSON.stringify(jetons));
  return json({ jetons });
}
