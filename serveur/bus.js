// Bus : horaires théoriques (GTFS dans le KV), temps réel (GTFS-RT) et prochains passages
import { pourEcran } from './commun.js';
import { TZ, deux, mural, versUTC } from './temps.js';
import { dansCreneau, texteCreneaux } from './scenes.js';

// ---------------------------------------------------------------------
//  Prochains bus (reseau Tango, Nimes Metropole, donnees ouvertes)
//
//  - Les horaires theoriques (GTFS) sont analyses par la page web, qui ne
//    garde que les passages aux arrets choisis : c'est "l'index" stocke en KV.
//  - Le serveur y applique le temps reel (GTFS-RT) au moment de la demande.
// ---------------------------------------------------------------------
export const GTFS_TANGO = 'https://www.data.gouv.fr/api/1/datasets/r/15aeb8a5-1cca-4bb9-ae5f-b6e67e4ff2ab';
const RT_TANGO = [
  'https://gtfs.bus-tracker.fr/gtfs-rt/tango/trip-updates?format=json',     // version corrigee (Bus Tracker)
  'https://transport.data.gouv.fr/resources/80731/download',                // flux officiel (protobuf)
];
let indexBusCache = null, indexBusMaj = 0;
async function lireIndexBus(env) {
  if (indexBusCache && Date.now() - indexBusMaj < 60000) return indexBusCache;
  const brut = await env.CADRE.get('bus');
  indexBusCache = brut ? JSON.parse(brut) : null;
  indexBusMaj = Date.now();
  return indexBusCache;
}
export function oublierIndexBus() { indexBusCache = null; }
// --- Lecture minimale du format protobuf GTFS-RT (TripUpdate seulement) ---
function lireProtobuf(octets) {
  let p = 0, bas32 = 0;
  const varint = () => {
    let r = 0, m = 1, b, decalage = 0;
    bas32 = 0;
    do {
      b = octets[p++];
      r += (b & 0x7f) * m; m *= 128;
      if (decalage < 32) bas32 = (bas32 | ((b & 0x7f) << decalage)) >>> 0;   // 32 bits de poids faible, exacts
      decalage += 7;
    } while (b & 0x80);
    return r;
  };
  function message(fin, champs) {
    const o = {};
    while (p < fin) {
      const cle = varint(), num = Math.floor(cle / 8), type = cle & 7;
      const def = champs[num];
      let v;
      let signe32 = 0;
      if (type === 0) { v = varint(); signe32 = bas32 | 0; }
      else if (type === 2) {
        const l = varint(), debut = p;
        if (def && def.sous) v = message(p + l, def.sous);
        else if (def && def.texte) v = new TextDecoder().decode(octets.subarray(p, p + l));
        p = debut + l;
      } else if (type === 1) p += 8;
      else if (type === 5) p += 4;
      else break;
      if (!def || v === undefined) continue;
      if (def.signe && type === 0) v = signe32;    // retards negatifs (int32)
      if (def.liste) (o[def.nom] = o[def.nom] || []).push(v); else o[def.nom] = v;
    }
    return o;
  }
  const evenement = { 1: { nom: 'delay', signe: true }, 2: { nom: 'time' } };
  const arret = { 1: { nom: 'stopSequence' }, 2: { nom: 'arrival', sous: evenement }, 3: { nom: 'departure', sous: evenement },
    4: { nom: 'stopId', texte: true }, 5: { nom: 'scheduleRelationship' } };
  const trajet = { 1: { nom: 'tripId', texte: true }, 3: { nom: 'startDate', texte: true }, 4: { nom: 'scheduleRelationship' },
    5: { nom: 'routeId', texte: true } };
  const maj = { 1: { nom: 'trip', sous: trajet }, 2: { nom: 'stopTimeUpdate', sous: arret, liste: true }, 5: { nom: 'delay', signe: true } };
  const entite = { 1: { nom: 'id', texte: true }, 3: { nom: 'tripUpdate', sous: maj } };
  return message(octets.length, { 2: { nom: 'entity', sous: entite, liste: true } });
}
// Temps reel : trip_id -> { annule, parArret: { stop_id: { t (s, epoch) | delai (s) } }, delai }
async function tempsReel(source) {
  const sources = source ? [source] : RT_TANGO;
  for (const url of sources) {
    try {
      const r = await fetch(url, { cf: { cacheTtl: 30, cacheEverything: true } });
      if (!r.ok) continue;
      const octets = new Uint8Array(await r.arrayBuffer());
      let flux;
      if (octets[0] === 0x7b) flux = JSON.parse(new TextDecoder().decode(octets));   // '{' : JSON
      else flux = lireProtobuf(octets);
      const res = {};
      for (const e of flux.entity || []) {
        const tu = e.tripUpdate || e.trip_update;
        if (!tu || !tu.trip) continue;
        const tid = tu.trip.tripId || tu.trip.trip_id;
        if (!tid) continue;
        const sr = tu.trip.scheduleRelationship ?? tu.trip.schedule_relationship;
        const info = { annule: sr === 3 || sr === 'CANCELED', parArret: {}, delai: tu.delay };
        for (const s of tu.stopTimeUpdate || tu.stop_time_update || []) {
          const sid = s.stopId || s.stop_id;
          if (!sid) continue;
          const ev = s.departure || s.arrival || {};
          const ssr = s.scheduleRelationship ?? s.schedule_relationship;
          info.parArret[sid] = {
            t: ev.time !== undefined ? Number(ev.time) : undefined,
            delai: ev.delay !== undefined ? Number(ev.delay) : undefined,
            saute: ssr === 1 || ssr === 'SKIPPED',
          };
        }
        res[tid] = info;
      }
      return res;
    } catch (e) { /* source suivante */ }
  }
  return null;     // pas de temps reel : horaires theoriques seulement
}
function serviceActif(s, date, jsLundi0) {
  if (!s) return false;
  if (s.moins && s.moins.includes(date)) return false;
  if (s.plus && s.plus.includes(date)) return true;
  return !!s.j && s.j[jsLundi0] === '1' && (!s.d || s.d <= date) && (!s.f || date <= s.f);
}
export async function prochainsBus(o, maintenant, env, ignorerCreneau) {
  const idx = await lireIndexBus(env);
  if (!idx || !idx.passages || !idx.passages.length) return { erreur: 'Aucun arrêt choisi' };
  if (!ignorerCreneau && !dansCreneau(o, maintenant)) {
    return { hors: 'Bus affichés : ' + texteCreneaux(o) };
  }
  const horizon = Math.max(15, Math.min(240, o.horizon || 90)) * 60000;
  const lignes = Array.isArray(o.lignes) ? new Set(o.lignes) : null;   // null = toutes
  const rt = await tempsReel(o.sourceRT);
  const res = [];
  // Passages du jour, et de la veille apres minuit (horaires GTFS > 24h)
  for (const decalageJour of [0, -1]) {
    const w = mural(maintenant + decalageJour * 86400e3);
    const date = '' + w.y + deux(w.m) + deux(w.d);
    const minuit = versUTC({ y: w.y, m: w.m, d: w.d }, TZ);
    const lundi0 = (w.js + 6) % 7;
    for (const [tripId, ligne, dest, service, secondes, arretId] of idx.passages) {
      if (decalageJour === -1 && secondes < 86400) continue;
      const cle = idx.lignes[ligne] + '|' + idx.destinations[dest];
      if (lignes && !lignes.has(cle)) continue;
      if (!serviceActif(idx.services[service], date, lundi0)) continue;
      let t = minuit + secondes * 1000, reel = false, annule = false;
      const info = rt && rt[tripId];
      if (info) {
        const a = info.parArret[arretId];
        if (info.annule || (a && a.saute)) annule = true;
        else if (a && a.t) { t = a.t * 1000; reel = true; }
        else if (a && a.delai !== undefined) { t += a.delai * 1000; reel = true; }
        else if (info.delai !== undefined) { t += info.delai * 1000; reel = true; }
      }
      if (t < maintenant - 30000 || t > maintenant + horizon) continue;
      res.push({ t, l: idx.lignes[ligne], d: idx.destinations[dest], reel, annule });
    }
  }
  res.sort((a, b) => a.t - b.t);
  return {
    passages: res.slice(0, Math.max(1, Math.min(10, o.nb || 4))).map(p => {
      const w = mural(p.t);
      return { l: pourEcran(p.l), d: pourEcran(p.d), h: deux(w.hh) + 'h' + deux(w.mi),
        m: Math.max(0, Math.round((p.t - maintenant) / 60000)), tr: p.reel ? 1 : 0, x: p.annule ? 1 : 0 };
    }),
    tempsReel: rt ? 1 : 0,
    arrets: (idx.arrets || []).map(pourEcran).join(' · '),
  };
}
