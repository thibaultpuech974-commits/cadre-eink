// Connexion Cloudflare Access simulée, pour les tests.
// Le serveur ne répond qu'aux requêtes passées par Access : ctx.access présent et jeton JWT signé par
// l'équipe Access. Ce module fabrique une équipe de test, range sa clé publique dans le KV (la copie
// 'access-cles', comme en production : aucun appel réseau) et rend une fonction d'appel au Worker.
const EQUIPE = 'https://test.cloudflareaccess.com', AUD = 'aud-de-test';
const paire = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify']);
const jwk = await crypto.subtle.exportKey('jwk', paire.publicKey);
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');

// Jeton signé par l'équipe de test. Il expire en 2100 : les tests qui avancent l'horloge le gardent valable.
export async function jetonTest(corps = { email: 'moi@exemple.fr' }) {
  const t = b64({ alg: 'RS256', kid: 'test', typ: 'JWT' }) + '.' + b64(Object.assign({ iss: EQUIPE, aud: [AUD], exp: 4102444800 }, corps));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', paire.privateKey, new TextEncoder().encode(t));
  return t + '.' + Buffer.from(sig).toString('base64url');
}

// Ce que Cloudflare donne au Worker quand Access a laissé passer la requête
export const ctxTest = { access: { aud: AUD, getIdentity: async () => ({ email: 'moi@exemple.fr' }) } };

// Range la clé de l'équipe de test dans le KV de env, puis rend (requete) -> réponse du Worker, comme si
// Access avait laissé passer la personne (ou le jeton de service décrit par corps).
// Copie datée très loin : elle ne vieillit jamais, même quand un test avance l'horloge.
export async function connecter(worker, env, corps) {
  await env.CADRE.put('access-cles', JSON.stringify({ iss: EQUIPE, t: 8.64e15, keys: [{ kid: 'test', kty: 'RSA', n: jwk.n, e: jwk.e }] }));
  const jwt = await jetonTest(corps);
  return requete => {
    const r = new Request(requete);
    r.headers.set('cf-access-jwt-assertion', jwt);
    return worker.fetch(r, env, ctxTest);
  };
}
