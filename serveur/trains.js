// Trains : prochains départs directs d'une gare vers les destinations choisies (API SNCF, moteur Navitia)
//
// La cle de l'API (gratuite, a demander sur numerique.sncf.com) est le secret SNCF de Cloudflare :
// elle n'est jamais dans le depot ni dans les reglages. Une demande par destination : l'API calcule
// les prochains trajets sans correspondance, ce qui donne aussi l'heure d'arrivee et les retards.
import { pourEcran } from './commun.js';
import { TZ, deux, mural, versUTC } from './temps.js';

const API = 'https://api.sncf.com/v1/coverage/sncf';
export const MAX_DESTINATIONS = 3;
const ID_GARE = /^stop_area:[A-Za-z0-9:_-]{3,60}$/;
// "Montpellier Saint-Roch (Montpellier)" -> "Montpellier Saint-Roch"
const nomCourt = n => pourEcran(String(n || '').replace(/\s*\([^)]*\)\s*$/, '')).slice(0, 40);

async function demander(chemin, env) {
  if (!env.SNCF) throw new Error('Clé SNCF absente');
  const r = await fetch(API + chemin, { headers: { authorization: 'Basic ' + btoa(env.SNCF + ':') },
    cf: { cacheTtl: 120, cacheEverything: true }, signal: AbortSignal.timeout(8000) });
  if (r.status === 401 || r.status === 403) throw new Error('Clé SNCF refusée');
  if (r.status === 429) throw new Error('Quota SNCF atteint');
  if (!r.ok && r.status !== 404) throw new Error('SNCF HTTP ' + r.status);     // 404 : aucun trajet trouve
  return r.json();
}

// Recherche d'une gare par son nom, pour la page web : [{ id, nom }]
export async function chercherGares(q, env) {
  const d = await demander('/places?q=' + encodeURIComponent(String(q).slice(0, 60)) + '&type%5B%5D=stop_area&count=8', env);
  return (d.places || []).filter(p => p.embedded_type === 'stop_area' && ID_GARE.test(p.id || ''))
    .map(p => ({ id: p.id, nom: nomCourt(p.name) }));
}

// Reglages recus de la page ou d'une sauvegarde : gare de depart, 3 destinations au plus, nombre de trains
export function nettoyerTrains(t, actuel) {
  const gare = g => (g && ID_GARE.test(g.id || '') && nomCourt(g.nom) ? { id: g.id, nom: nomCourt(g.nom) } : null);
  const o = t || {}, a = actuel || {};
  const vers = (Array.isArray(o.vers) ? o.vers : a.vers || []).map(gare).filter(Boolean);
  return { gare: o.gare === undefined ? a.gare || null : gare(o.gare),
    vers: vers.filter((v, i) => vers.findIndex(x => x.id === v.id) === i).slice(0, MAX_DESTINATIONS),
    nb: [2, 3, 4, 5, 6, 8].includes(+o.nb) ? +o.nb : a.nb || 4 };
}

// "20261114T184200" (heure de Paris) -> instant UTC en ms
const instant = s => {
  const m = /^(\d{4})(\d\d)(\d\d)T(\d\d)(\d\d)(\d\d)?$/.exec(s || '');
  return m ? versUTC({ y: +m[1], m: +m[2], d: +m[3], hh: +m[4], mi: +m[5], ss: +(m[6] || 0) }, TZ) : NaN;
};
const hhmm = s => (s && s.length >= 13 ? s.slice(9, 11) + ':' + s.slice(11, 13) : '');
// "TGV INOUI" -> "TGV", "TER Occitanie" -> "TER", "OUIGO Train Classique" -> "OUIGO"
const modeCourt = m => (/ouigo/i.test(m) ? 'OUIGO' : /tgv/i.test(m) ? 'TGV' : /^ter\b/i.test(m) ? 'TER' : m.slice(0, 12));

// Donnees du bloc : { gare, d: [{ h, v, a, m, r, x }] } ou { erreur }.
// h = heure de depart prevue a l'horaire, v = destination, a = heure d'arrivee, m = type de train,
// r = retard en minutes (absent si a l'heure), x = 1 si le train est supprime.
// Pas de "dans 12 min" : l'ecran ne serait redessine a chaque reveil que pour ca.
export async function prochainsTrains(o, maintenant, env) {
  const t = o || {};
  if (!env.SNCF) return { erreur: 'Clé SNCF absente (voir le README)' };
  if (!t.gare || !(t.vers || []).length) return { erreur: 'Choisis une gare et une destination' };
  const nb = t.nb || 4;
  // Depart demande a la minute ronde precedente (multiple de 2) : deux reveils proches partagent le cache
  const w = mural(Math.floor(maintenant / 120e3) * 120e3);
  const quand = '' + w.y + deux(w.m) + deux(w.d) + 'T' + deux(w.hh) + deux(w.mi) + '00';
  const lus = await Promise.allSettled(t.vers.map(v => demander('/journeys?from=' + encodeURIComponent(t.gare.id) +
    '&to=' + encodeURIComponent(v.id) + '&datetime=' + quand + '&max_nb_transfers=0&min_nb_journeys=' + nb + '&count=' + nb +
    '&data_freshness=realtime&disable_geojson=true', env)));
  const reussis = lus.filter(l => l.status === 'fulfilled');
  if (!reussis.length) return { erreur: 'Trains indisponibles (' + lus[0].reason.message + ')' };
  const trains = [], vus = new Set();
  lus.forEach((l, i) => {
    if (l.status !== 'fulfilled') return;
    for (const j of l.value.journeys || []) {
      const s = (j.sections || []).find(x => x.type === 'public_transport');
      if (!s || (j.nb_transfers || 0) > 0) continue;
      const info = s.display_informations || {};
      const prevu = s.base_departure_date_time || s.departure_date_time, reel = s.departure_date_time;
      const tPrevu = instant(prevu), tReel = instant(reel);
      if (!isFinite(tPrevu) || Math.max(tPrevu, tReel || 0) < maintenant - 60e3) continue;      // deja parti
      // Un meme train peut desservir deux destinations choisies : il n'apparait que pour la premiere
      const cle = (info.headsign || '') + '|' + prevu;
      if (vus.has(cle)) continue;
      vus.add(cle);
      const mode = pourEcran(info.commercial_mode || info.physical_mode || 'Train');
      const train = { h: hhmm(prevu), v: t.vers[i].nom, a: hhmm(s.arrival_date_time), m: modeCourt(mode), t: tPrevu };
      const retard = Math.round((tReel - tPrevu) / 60e3);
      if (retard >= 1) train.r = retard;
      if (j.status === 'NO_SERVICE') train.x = 1;
      trains.push(train);
    }
  });
  trains.sort((x, y) => x.t - y.t);
  return { gare: t.gare.nom, d: trains.slice(0, nb).map(x => { delete x.t; return x; }) };
}
