// Bloc « Prochains trains » : API SNCF simulée (recherche de gares, trajets directs, retards, suppressions)
import w from '../../serveur/worker.js';
import { connecter } from './acces-test.mjs';
const kv = new Map();
const KV = {
  async get(k) { const e = kv.get(k); return e ? e.v : null; },
  async getWithMetadata(k) { const e = kv.get(k); return e ? { value: e.v, metadata: e.m } : { value: null, metadata: null }; },
  async put(k, v, o) { kv.set(k, { v, m: o && o.metadata }); }, async delete(k) { kv.delete(k); },
};
const env = { CADRE: KV, SNCF: 'cle-de-test' };
const NIMES = 'stop_area:SNCF:87775007', MONTP = 'stop_area:SNCF:87773002', PARIS = 'stop_area:SNCF:87686006';
// Un trajet au format Navitia : marche jusqu'au quai, puis le train
const trajet = (prevu, reel, arrivee, mode, numero, plus = {}) => Object.assign({ nb_transfers: 0, status: '', sections: [
  { type: 'crow_fly' },
  { type: 'public_transport', base_departure_date_time: prevu, departure_date_time: reel, arrival_date_time: arrivee,
    display_informations: { commercial_mode: mode, headsign: numero, direction: 'Terminus (Ville)' } }] }, plus);
const horaires = {
  [MONTP]: [trajet('20261114T174200', '20261114T174200', '20261114T181100', 'TER Occitanie', '876501'),          // déjà parti
    trajet('20261114T184200', '20261114T184200', '20261114T191100', 'TER Occitanie', '876503'),
    trajet('20261114T185700', '20261114T190200', '20261114T193300', 'TER Occitanie', '876505'),                  // 5 min de retard
    trajet('20261114T190600', '20261114T190600', '20261114T193000', 'TGV INOUI', '6209'),
    trajet('20261114T191200', '20261114T191200', '20261114T194000', 'Intercités', '4657', { status: 'NO_SERVICE' }),
    trajet('20261114T193000', '20261114T193000', '20261114T210000', 'TER Occitanie', '876599', { nb_transfers: 1 })],   // avec correspondance
  [PARIS]: [trajet('20261114T185000', '20261114T185000', '20261114T215300', 'OUIGO', '7890')],
};
let demandes = [], panne = 0;
globalThis.fetch = async (u, o) => {
  u = String(u);
  if (u.includes('api.sncf.com')) {
    demandes.push({ u, auth: o && o.headers && o.headers.authorization });
    if (panne) return new Response('{}', { status: panne });
    const url = new URL(u);
    if (url.pathname.endsWith('/places')) return new Response(JSON.stringify({ places: [
      { id: NIMES, name: 'Nîmes Centre (Nîmes)', embedded_type: 'stop_area' }, { id: 'admin:fr:30189', name: 'Nîmes (30000)', embedded_type: 'administrative_region' },
      { id: 'stop_area:SNCF:87703975', name: 'Nîmes Pont-du-Gard (Manduel)', embedded_type: 'stop_area' }] }));
    return new Response(JSON.stringify({ journeys: horaires[url.searchParams.get('to')] || [] }));
  }
  if (u.includes('open-meteo') || u.includes('jolpi.ca')) return new Response('{}');
  throw new Error('fetch inattendu ' + u);
};
const appeler = await connecter(w, env);
const req = (p, o = {}) => appeler(new Request('https://cadre.test' + p, o));
const post = async b => (await req('/api/config', { method: 'POST', body: JSON.stringify(b) })).json();
const etat = async () => { demandes = []; return (await req('/api/etat?ui=1')).json(); };
Date.now = () => Date.parse('2026-11-14T18:31:20+01:00');
const ligne = p => p.h + ' ' + p.m + ' ' + p.v + ' ' + p.a + (p.r ? ' +' + p.r : '') + (p.x ? ' supprimé' : '');

// Recherche d'une gare pour la page : seules les gares, noms raccourcis, la clé part dans l'en-tête
let r = await req('/api/gares?q=n%C3%AEmes');
console.log('gares :', JSON.stringify(await r.json()), '| clé en Basic :', demandes[0].auth === 'Basic ' + btoa('cle-de-test:'), '| clé dans l\'adresse :', demandes[0].u.includes('cle-de-test'));
console.log('recherche trop courte :', JSON.stringify(await (await req('/api/gares?q=n')).json()));

// Réglages : identifiants vérifiés, 3 destinations au plus, pas de doublon
r = await post({ scenes: [], disposition: [{ id: 'trains', x: 0, y: 0, w: 8, h: 4 }], trains: { gare: { id: NIMES, nom: 'Nîmes Centre (Nîmes)' }, nb: 4,
  vers: [{ id: MONTP, nom: 'Montpellier Saint-Roch' }, { id: MONTP, nom: 'Doublon' }, { id: 'javascript:alert(1)', nom: 'Faux' }, { id: PARIS, nom: 'Paris Gare de Lyon' }] } });
console.log('réglages :', r.config.trains.gare.nom, '->', r.config.trains.vers.map(v => v.nom).join(', '), '|', r.config.trains.nb, 'départs');

// Bloc : trains directs à venir, triés, toutes destinations confondues
let e = await etat();
console.log('18:31 : ' + e.trains.gare + '\n  ' + e.trains.d.map(ligne).join('\n  '));
const u = new URL(demandes[0].u).searchParams;
console.log('demandes :', demandes.length, '| départ', u.get('datetime'), '| sans correspondance', u.get('max_nb_transfers') === '0', '| temps réel', u.get('data_freshness'), '| sans tracé', u.get('disable_geojson'));
// Le bloc ailleurs que sur la scène affichée : aucune demande à la SNCF
await post({ disposition: [{ id: 'date', x: 0, y: 0, w: 12, h: 1 }] }); e = await etat();
console.log('sans le bloc : demandes', demandes.length, '| données', 'trains' in e);
await post({ disposition: [{ id: 'trains', x: 0, y: 0, w: 8, h: 4 }] });
// Pannes et réglages incomplets : un message, jamais d'erreur du serveur
panne = 429; console.log('quota :', (await etat()).trains.erreur);
panne = 401; console.log('clé refusée :', (await etat()).trains.erreur);
panne = 0;
await post({ trains: { vers: [] } }); e = await etat(); console.log('sans destination :', e.trains.erreur, '| demandes', demandes.length);
delete env.SNCF; e = await etat(); console.log('sans clé :', e.trains.erreur, '|', (await req('/api/gares?q=nimes')).status, await (await req('/api/gares?q=nimes')).text());
