// Cloudflare Access : le Worker accepte les requetes authentifiees par Access (ctx.access),
// et garde le mot de passe CLE comme secours quand Access n'est pas active.
import w from '../../serveur/worker.js';
const kv = new Map();
const KV = {
  async get(k) { const e = kv.get(k); return e ? e.v : null; },
  async getWithMetadata(k) { const e = kv.get(k); return e ? { value: e.v, metadata: e.m } : { value: null, metadata: null }; },
  async put(k, v, o) { kv.set(k, { v, m: o && o.metadata }); },
};
globalThis.fetch = async (u) => { throw new Error('fetch inattendu ' + u); };
const personne = { aud: 'cadre', getIdentity: async () => ({ email: 'moi@exemple.fr' }) };
const jeton = { aud: 'cadre', getIdentity: async () => { throw new Error('pas d\'identite'); } };
const req = (p, env, ctx, o = {}) => w.fetch(new Request('https://cadre.test' + p, o), env, ctx);
const avecCle = { CLE: 'secret', CADRE: KV }, sansCle = { CADRE: KV };
let r;

r = await req('/api/config', sansCle, { access: personne }); console.log('access sans CLE :', r.status);
r = await req('/api/config', avecCle, { access: personne }, { headers: { 'X-Cle': 'faux' } }); console.log('access + mauvaise CLE :', r.status);
r = await req('/api/session', sansCle, { access: personne }); console.log('session personne :', JSON.stringify(await r.json()));
r = await req('/api/session', sansCle, { access: jeton }); console.log('session jeton :', JSON.stringify(await r.json()));
r = await req('/api/pochette?&titre=So%20What', sansCle, { access: jeton }, { method: 'POST', body: new Uint8Array(5000) });
console.log('pochette par jeton :', r.status, JSON.parse(kv.get('config').v).pochette.titre);

r = await req('/api/config', avecCle, {}); console.log('secours sans cle :', r.status);
r = await req('/api/config', avecCle, undefined, { headers: { 'X-Cle': 'secret' } }); console.log('secours avec cle :', r.status);
r = await req('/api/session', avecCle, {}, { headers: { 'X-Cle': 'secret' } }); console.log('session secours :', JSON.stringify(await r.json()));
r = await req('/api/config', sansCle, {}); console.log('rien de configure :', r.status);
