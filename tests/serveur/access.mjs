// Cloudflare Access : le Worker ne répond qu'aux requêtes authentifiées par Access (ctx.access et jeton
// signé). L'ancien mot de passe de secours (CLE) est retiré : il n'ouvre plus rien, mais la carte peut
// continuer à l'envoyer. Aussi : en-têtes de sécurité, erreurs sans détail interne, KV abîmé.
import w from '../../serveur/worker.js';
import { connecter, ctxTest } from './acces-test.mjs';
const kv = new Map();
const KV = {
  async get(k) { const e = kv.get(k); return e ? e.v : null; },
  async getWithMetadata(k) { const e = kv.get(k); return e ? { value: e.v, metadata: e.m } : { value: null, metadata: null }; },
  async put(k, v, o) { kv.set(k, { v, m: o && o.metadata }); },
  async delete(k) { kv.delete(k); },
};
globalThis.fetch = async () => { throw new Error('hors ligne'); };   // météo, etc. : sans objet ici
const env = { CLE: 'secret', CADRE: KV };     // un ancien secret CLE resté dans Cloudflare
const moi = await connecter(w, env);
const carte = await connecter(w, env, { common_name: 'carte1.access', sub: '', type: 'app' });
const U = p => 'https://cadre.test' + p;
let r;

r = await moi(new Request(U('/api/config'))); console.log('personne connectée :', r.status);
r = await moi(new Request(U('/api/config'), { headers: { 'X-Cle': 'faux' } })); console.log('personne + mauvais mot de passe :', r.status);
r = await moi(new Request(U('/api/session'))); console.log('session personne :', JSON.stringify(await r.json()));

// Sans Access, ni l'ancien mot de passe ni rien d'autre n'ouvre une route
r = await w.fetch(new Request(U('/api/config'), { headers: { 'X-Cle': 'secret' } }), env, {});
console.log('sans Access, mot de passe en en-tête :', r.status, await r.text());
r = await w.fetch(new Request(U('/api/config?cle=secret')), env); console.log('sans Access, mot de passe dans l\'adresse :', r.status);
r = await w.fetch(new Request(U('/api/config')), { CADRE: KV }, {}); console.log('sans Access ni secret :', r.status);
// Access présent mais sans jeton à vérifier : refus (et non tous les droits)
r = await w.fetch(new Request(U('/api/config')), env, ctxTest); console.log('Access sans jeton :', r.status, await r.text());

// La carte déjà installée envoie son jeton de service ET l'ancien mot de passe : elle doit toujours passer
r = await carte(new Request(U('/api/etat?bat=4.02&fw=20261107-120000'), { headers: { 'X-Cle': 'secret' } }));
console.log('carte installée, état :', r.status, '| rôle', JSON.parse(kv.get('jetons').v)['carte1.access'].role);
r = await carte(new Request(U('/api/firmware.bin?cle=secret'), { headers: { 'X-Cle': 'secret' } }));
console.log('carte installée, programme :', r.status, '(404 : aucun programme en attente)');
r = await carte(new Request(U('/api/config'))); console.log('carte, réglages :', r.status);

// En-têtes de sécurité, sur la page comme sur l'API
const entetes = r => ['x-content-type-options', 'referrer-policy', 'content-security-policy'].map(h => r.headers.get(h)).join(' | ');
r = await w.fetch(new Request(U('/')), env); console.log('en-têtes page :', r.status, entetes(r), '|', r.headers.get('content-type'));
r = await moi(new Request(U('/api/config'))); console.log('en-têtes API :', entetes(r));

// Erreur imprévue : une référence, pas le message interne
const journaux = []; const errOrig = console.error; console.error = (...a) => journaux.push(a.join(' '));
r = await moi(new Request(U('/api/config'), { method: 'POST', body: '{pas du json' }));
console.error = errOrig;
const t = await r.text(), ref = (t.match(/réf\. ([0-9a-f]{8})/) || [])[1];
console.log('erreur imprévue :', r.status, '| réf.', !!ref, '| détail caché', !/JSON|Unexpected|position/i.test(t), '| détail journalisé', journaux.some(l => l.includes(ref) && /JSON/.test(l)));

// Valeur du KV abîmée : ignorée au lieu de casser le réveil de la carte
kv.set('statut', { v: '{abîmé' });
const logOrig = console.log; const notes = []; console.log = (...a) => notes.push(a.join(' '));
r = await carte(new Request(U('/api/etat?bat=4.02&fw=20261107-120000')));
const r2 = await moi(new Request(U('/api/config')));
console.log = logOrig;
console.log('statut abîmé : état', r.status, '| réglages', r2.status, '| signalé', notes.some(l => l.includes('statut')));
r = await moi(new Request(U('/api/bus-index'), { method: 'POST', body: '{abîmé' })); console.log('index de bus illisible :', r.status, await r.text());

// Rôles : une propriété héritée d'Object n'est pas un rôle, '__proto__' est un identifiant ordinaire
r = await moi(new Request(U('/api/jetons'), { method: 'POST', body: JSON.stringify({ id: 'carte1.access', role: 'toString' }) }));
console.log('rôle toString :', r.status, await r.text());
kv.set('jetons', { v: JSON.stringify({ 'vieux.access': { role: 'toString', vu: 1, route: 'GET /api/etat' } }) });
const vieux = await connecter(w, env, { common_name: 'vieux.access' });
r = await vieux(new Request(U('/api/etat?fw=20261107-120000'))); console.log('rôle toString déjà enregistré :', r.status);
const proto = await connecter(w, env, { common_name: '__proto__' });
r = await proto(new Request(U('/api/etat?bat=4.0&fw=20261107-120000')));
const enr = JSON.parse(kv.get('jetons').v);
console.log('jeton __proto__ :', r.status, '| enregistré', Object.hasOwn(enr, '__proto__') && enr['__proto__'].role, '| réglages', (await proto(new Request(U('/api/config')))).status);
r = await moi(new Request(U('/api/jetons'), { method: 'POST', body: JSON.stringify({ id: 'toString', role: 'tout' }) })); console.log('jeton toString inconnu :', r.status);
r = await moi(new Request(U('/api/jetons'), { method: 'POST', body: 'pas du json' })); console.log('demande illisible :', r.status);
