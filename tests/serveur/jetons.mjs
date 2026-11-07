// Droits des jetons de service Cloudflare Access : jeton JWT verifie (signature, equipe, application,
// date), role devine a la premiere requete, routes limitees par role, roles changes depuis la page.
import w from '../../serveur/worker.js';
const kv = new Map();
const KV = {
  async get(k, type) { const e = kv.get(k); return e ? e.v : null; },
  async getWithMetadata(k) { const e = kv.get(k); return e ? { value: e.v, metadata: e.m } : { value: null, metadata: null }; },
  async put(k, v, o) { kv.set(k, { v, m: o && o.metadata }); },
};
const env = { CADRE: KV };
const EQUIPE = 'https://maison.cloudflareaccess.com', AUD = 'aud-du-cadre';
const sub = crypto.subtle;
const paire = await sub.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const pirate = await sub.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
const jwk = await sub.exportKey('jwk', paire.publicKey);
let certsDispo = true, appelsCerts = 0;
globalThis.fetch = async (u) => {
  if (String(u) === EQUIPE + '/cdn-cgi/access/certs') {
    appelsCerts++;
    if (!certsDispo) throw new Error('réseau coupé');
    return new Response(JSON.stringify({ keys: [{ kid: 'k1', kty: 'RSA', alg: 'RS256', use: 'sig', n: jwk.n, e: jwk.e }] }));
  }
  throw new Error('hors ligne');   // météo, etc. : sans objet ici
};
const b64 = o => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
const maintenant = Math.floor(Date.now() / 1000);
async function jeton(corps, cle = paire.privateKey, kid = 'k1') {
  const t = b64({ alg: 'RS256', kid, typ: 'JWT' }) + '.' + b64(Object.assign({ iss: EQUIPE, aud: [AUD], iat: maintenant, exp: maintenant + 3600 }, corps));
  const sig = await sub.sign('RSASSA-PKCS1-v1_5', cle, new TextEncoder().encode(t));
  return t + '.' + Buffer.from(sig).toString('base64url');
}
const ctx = { access: { aud: AUD, getIdentity: async () => { throw new Error('pas d\'identite'); } } };
const req = async (methode, chemin, jwt, corps) => {
  const r = await w.fetch(new Request('https://cadre.test' + chemin, { method: methode, body: corps,
    headers: jwt ? { 'cf-access-jwt-assertion': jwt } : {} }), env, ctx);
  return r.status;
};
const moi = await jeton({ email: 'moi@exemple.fr', sub: 'u1', type: 'app' });
const carte = await jeton({ common_name: 'abc123.access', sub: '', type: 'app' });
const raccourci = await jeton({ common_name: 'def456.access', sub: '', type: 'app' });
const autre = await jeton({ common_name: 'zzz999.access', sub: '', type: 'app' });

console.log('personne : config', await req('GET', '/api/config', moi), '| jetons', await req('GET', '/api/jetons', moi));
// La carte : role devine a sa premiere requete, puis limitee a ses routes
console.log('carte : état', await req('GET', '/api/etat?bat=4.0&fw=20261107-120000', carte), '| aperçu', await req('POST', '/api/apercu?r=0', carte, new Uint8Array(81600)),
  '| programme', await req('GET', '/api/firmware.bin', carte));
console.log('carte refusée : config', await req('GET', '/api/config', carte), '| réglages', await req('POST', '/api/config', carte, '{"mode":"photo"}'),
  '| sauvegarde', await req('GET', '/api/sauvegarde', carte), '| envoi programme', await req('POST', '/api/firmware?v=20261107-120000', carte, new Uint8Array(10)),
  '| jetons', await req('GET', '/api/jetons', carte));
console.log('raccourci : pochette', await req('POST', '/api/pochette?titre=So%20What', raccourci, new Uint8Array(5000)),
  '| refusé : config', await req('GET', '/api/config', raccourci), '| état', await req('GET', '/api/etat?fw=20261107-120000', raccourci));
// Jeton inconnu dont le role ne se devine pas : tous les droits jusqu'a ce qu'on en choisisse un
console.log('autre jeton : config', await req('GET', '/api/config', autre));
let liste = JSON.parse(kv.get('jetons').v);
console.log('rôles devinés :', Object.entries(liste).map(([id, j]) => id + '=' + j.role).join(' '));
console.log('choix du rôle :', await req('POST', '/api/jetons', moi, JSON.stringify({ id: 'zzz999.access', role: 'raccourci' })),
  '| puis config', await req('GET', '/api/config', autre), '| rôle inconnu', await req('POST', '/api/jetons', moi, JSON.stringify({ id: 'zzz999.access', role: 'admin' })),
  '| par un jeton', await req('POST', '/api/jetons', autre, JSON.stringify({ id: 'zzz999.access', role: 'tout' })));
console.log('oublier :', await req('POST', '/api/jetons', moi, JSON.stringify({ id: 'zzz999.access', oublier: true })), Object.keys(JSON.parse(kv.get('jetons').v)).join(' '));
// Jetons invalides
console.log('signature pirate', await req('GET', '/api/config', await jeton({ email: 'moi@exemple.fr' }, pirate.privateKey)),
  '| autre application', await req('GET', '/api/config', await jeton({ email: 'moi@exemple.fr', aud: ['autre'] })),
  '| autre équipe', await req('GET', '/api/config', await jeton({ email: 'moi@exemple.fr', iss: 'https://pirate.example.com' })),
  '| expiré', await req('GET', '/api/config', await jeton({ email: 'moi@exemple.fr', exp: maintenant - 600 })),
  '| clé inconnue', await req('GET', '/api/config', await jeton({ email: 'moi@exemple.fr' }, paire.privateKey, 'k9')),
  '| abîmé', await req('GET', '/api/config', 'pas.un.jeton'));
console.log('clés gardées en mémoire :', appelsCerts <= 3);
certsDispo = false;
console.log('clés introuvables :', await req('GET', '/api/config', await jeton({ email: 'moi@exemple.fr' }, paire.privateKey, 'k7')));
