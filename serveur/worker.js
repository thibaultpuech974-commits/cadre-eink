// =====================================================================
//  Cadre e-ink - serveur Cloudflare Worker
//
//  Ce fichier fait tout cote "Internet" :
//   - sert l'interface web (reglages, apercu, envoi de photo, ecran blanc)
//   - prepare les donnees du tableau de bord (meteo Open-Meteo, agenda iCloud)
//   - stocke la photo, la pochette d'album et l'apercu de l'ecran
//
//  Le cadre (ESP32) ne fait que demander /api/etat a chaque reveil.
//
//  A configurer dans Cloudflare :
//   - un espace KV lie sous le nom  CADRE
//   - une variable secrete           CLE   (ton mot de passe)
// =====================================================================

import CIRCUITS from './circuits.js';
// Page web de reglage : fichier a part, integre par Cloudflare au deploiement (regle "Text" de wrangler.jsonc)
import INTERFACE from './interface.html';
// Code de dessin de la carte compile en WebAssembly (outils/apercu/construire.sh), pour la previsualisation
import APERCU_WASM from './apercu.wasm';

const LARGEUR = 960, HAUTEUR = 680, OCTETS = (LARGEUR / 8) * HAUTEUR;   // 81 600 octets
const TZ = 'Europe/Paris';
const MODES = ['tableau', 'photo', 'pochette', 'blanc'];

const CONFIG_DEFAUT = {
  mode: 'tableau',
  version: 1,
  reveilMin: 10,
  dev: false, devSecondes: 30,     // mode developpement : la carte ne dort pas
  // Mode nuit : reveils espaces (economie de batterie), la plage peut passer minuit
  nuit: { actif: false, debut: '23:00', fin: '07:00', intervalleMin: 60 },
  meteo: {
    ville: 'Nîmes', lat: 43.84, lon: 4.36,
    vent: true, details: true, soleil: true,
    heures: true, pasHeures: 3, nbHeures: 6,
    jours: true, nbJours: 4,
    courbeHeures: 24,              // graphique de temperature : 12, 24, 36 ou 48 h
  },
  // Scenes : dispositions affichees pendant une periode (creneaux, Grand Prix, dates), par ordre de priorite.
  // Hors de toute scene, c'est la disposition "par defaut" (disposition / dispositionPortrait).
  scenes: [],
  agenda: { actif: true, urls: [], nb: 8, joursMax: 14, anniversaires: [] },
  // Disposition des widgets sur une grille de 12 colonnes x 8 rangees
  disposition: [
    { id: 'date', x: 0, y: 0, w: 12, h: 1 },
    { id: 'meteo', x: 0, y: 1, w: 12, h: 2 },
    { id: 'heures', x: 0, y: 3, w: 12, h: 2 },
    { id: 'jours', x: 0, y: 5, w: 5, h: 3 },
    { id: 'agenda', x: 5, y: 5, w: 7, h: 3 },
  ],
  dispositionPortrait: [
    { id: 'date', x: 0, y: 0, w: 8, h: 1 },
    { id: 'meteo', x: 0, y: 1, w: 8, h: 2 },
    { id: 'heures', x: 0, y: 3, w: 8, h: 2 },
    { id: 'jours', x: 0, y: 5, w: 8, h: 2 },
    { id: 'agenda', x: 0, y: 7, w: 8, h: 5 },
  ],
  affichage: { traits: true, bordureApercu: 10, rotation: 0 },
  // Un ou deux ecrans identiques assembles en un seul grand ecran : 'cote' (cote a cote) ou 'dessus'
  // (l'un au-dessus de l'autre). L'ecran 0 est celui de gauche (ou du haut). joint = espace entre
  // les zones affichables des deux dalles, en mm (sert a l'apercu et a la photo).
  ecrans: { nb: 1, assemblage: 'cote', joint: 15 },
  photo: { version: 0, t: 0 },
  pochette: { version: 0, titre: '', artiste: '', album: '', t: 0 },
  // Prochains bus : arrets choisis sur la page web, lignes (null = toutes)
  bus: { arrets: [], options: [], lignes: null, nb: 4, horizon: 90, sourceRT: '' },
};

// --- Grille de disposition (memes valeurs dans l'interface web) ---
const MARGE = 24, GOUTTIERE = 16;
const WIDGETS = {               // taille minimale de chaque widget (en cases)
  date: { w: 3, h: 1 }, meteo: { w: 4, h: 2 }, heures: { w: 4, h: 2 }, jours: { w: 3, h: 2 }, agenda: { w: 3, h: 1 }, bus: { w: 3, h: 2 },
  courbe: { w: 4, h: 2 }, f1: { w: 3, h: 2 },
};
const ROTATIONS = [0, 1, 3];
// Taille et police du texte, reglables bloc par bloc
const TAILLES = { S: 0.8, M: 1, L: 1.25, XL: 1.5 };
const POLICES = ['moderne', 'helvetica', 'classique', 'machine'];    // 0 = paysage, 1 = portrait, 3 = portrait inverse
// Grille selon l'orientation : 12 x 8 cases en paysage, 8 x 12 en portrait
// Avec deux ecrans, la grille est doublee (24 x 8 cote a cote, 12 x 16 l'un sur l'autre en paysage) ;
// pc x pr = cases d'une dalle. Un bloc ne peut pas etre a cheval sur la jointure.
function grille(rotation, ecrans) {
  const portrait = rotation === 1 || rotation === 3;
  const g = portrait ? { pc: 8, pr: 12, L: HAUTEUR, H: LARGEUR } : { pc: 12, pr: 8, L: LARGEUR, H: HAUTEUR };
  const deux = ecrans && ecrans.nb === 2;
  g.nx = deux && ecrans.assemblage !== 'dessus' ? 2 : 1;
  g.ny = deux && ecrans.assemblage === 'dessus' ? 2 : 1;
  g.cols = g.pc * g.nx; g.rangs = g.pr * g.ny;
  g.caseL = (g.L - 2 * MARGE + GOUTTIERE) / g.pc;
  g.caseH = (g.H - 2 * MARGE + GOUTTIERE) / g.pr;
  return g;
}
// Ecran (0 ou 1) qui contient le bloc, ou -1 s'il est a cheval sur la jointure
function ecranDuBloc(d, g) {
  const ex = Math.floor(d.x / g.pc), ey = Math.floor(d.y / g.pr);
  if (ex !== Math.floor((d.x + d.w - 1) / g.pc) || ey !== Math.floor((d.y + d.h - 1) / g.pr)) return -1;
  return ex + ey;
}
function enPixels(d, g) {
  const n = ecranDuBloc(d, g), x = d.x % g.pc, y = d.y % g.pr;   // position dans sa dalle
  return {
    id: d.id, n,
    e: TAILLES[d.t] || 1,
    f: Math.max(0, POLICES.indexOf(d.p)),
    x: Math.round(MARGE + x * g.caseL), y: Math.round(MARGE + y * g.caseH),
    w: Math.round(d.w * g.caseL - GOUTTIERE), h: Math.round(d.h * g.caseH - GOUTTIERE),
  };
}
// Garde seulement des widgets valides, sans doublon ni chevauchement
function validerDisposition(liste, g) {
  const res = [];
  const occupe = new Set();
  for (const d of Array.isArray(liste) ? liste : []) {
    const min = WIDGETS[d && d.id];
    if (!min || res.some(r => r.id === d.id)) continue;
    const x = d.x | 0, y = d.y | 0, w = d.w | 0, h = d.h | 0;
    if (x < 0 || y < 0 || w < min.w || h < min.h || x + w > g.cols || y + h > g.rangs) continue;
    if (ecranDuBloc({ x, y, w, h }, g) < 0) continue;
    const cases = [];
    for (let i = x; i < x + w; i++) for (let j = y; j < y + h; j++) cases.push(i + ',' + j);
    if (cases.some(c => occupe.has(c))) continue;
    cases.forEach(c => occupe.add(c));
    const o = { id: d.id, x, y, w, h };
    if (TAILLES[d.t] && d.t !== 'M') o.t = d.t;
    if (POLICES.includes(d.p) && d.p !== 'moderne') o.p = d.p;
    res.push(o);
  }
  return res;
}

const JOURS_COURTS = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const JOURS_LONGS = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
  'août', 'septembre', 'octobre', 'novembre', 'décembre'];

// ---------------------------------------------------------------------
//  Point d'entree
// ---------------------------------------------------------------------
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const chemin = url.pathname;

    if (chemin === '/' || chemin === '/index.html') {
      return new Response(INTERFACE, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (!chemin.startsWith('/api/')) return new Response('Introuvable', { status: 404 });
    if (!env.CLE) return texte('La variable secrete CLE n\'est pas definie dans Cloudflare.', 500);
    if (!env.CADRE) return texte('L\'espace KV "CADRE" n\'est pas lie au Worker.', 500);

    const cle = req.headers.get('X-Cle') || url.searchParams.get('cle');
    if (cle !== env.CLE) return texte('Cle incorrecte', 401);

    try {
      const m = req.method;
      if (chemin === '/api/etat' && m === 'GET') return await routeEtat(url, env);
      if (chemin === '/api/config' && m === 'GET') return await routeLireConfig(env);
      if (chemin === '/api/config' && m === 'POST') return await routeEcrireConfig(req, env);
      if (chemin === '/api/previsualiser' && m === 'POST') return await routePrevisualiser(req, env);
      if (chemin === '/api/apercu.wasm' && m === 'GET') return new Response(APERCU_WASM, { headers: { 'content-type': 'application/wasm', 'cache-control': 'private, max-age=3600' } });
      if (chemin === '/api/batterie' && m === 'GET') return texte((await env.CADRE.get('batterie' + (url.searchParams.get('ecran') === '1' ? '1' : ''))) || '{"pts":[]}');
      if (chemin === '/api/sauvegarde' && m === 'GET') return await routeSauvegarde(env);
      if (chemin === '/api/sauvegarde' && m === 'POST') return await routeRestaurer(req, env);
      if (chemin === '/api/photo' && m === 'POST') return await routeEnvoyerPhoto(req, url, env);
      if (chemin === '/api/photo' && m === 'GET') return await routeBinaire(env, url.searchParams.get('ecran') === '1' ? 'photo1' : 'photo', 'application/octet-stream');
      if (chemin === '/api/pochette' && m === 'POST') return await routeEnvoyerPochette(req, url, env);
      if (chemin === '/api/pochette.jpg' && m === 'GET') return await routeBinaire(env, 'pochette', 'image/jpeg');
      if (chemin === '/api/apercu' && m === 'POST') return await routeEnvoyerApercu(req, url, env);
      if (chemin === '/api/apercu' && m === 'GET') return await routeLireApercu(url, env);
      if (chemin === '/api/gtfs' && m === 'GET') return await routeGTFS();
      if (chemin === '/api/bus-index' && m === 'POST') return await routeIndexBus(req, env);
      if (chemin === '/api/firmware' && m === 'POST') return await routeEnvoyerFirmware(req, url, env);
      if (chemin === '/api/firmware' && m === 'DELETE') return await routeRetirerFirmware(env);
      if (chemin === '/api/firmware.bin' && m === 'GET') return await routeBinaire(env, 'firmware', 'application/octet-stream');
      if (chemin === '/api/bus-test' && m === 'GET') return json(await prochainsBus((await lireConfig(env)).bus, Date.now(), env, true));
      return texte('Route inconnue', 404);
    } catch (e) {
      return texte('Erreur : ' + (e && e.message ? e.message : e), 500);
    }
  },
};

// ---------------------------------------------------------------------
//  Utilitaires
// ---------------------------------------------------------------------
function texte(t, statut = 200) {
  return new Response(t, { status: statut, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
function json(obj, statut = 200) {
  return new Response(JSON.stringify(obj), {
    status: statut,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
function fusionner(cible, source) {
  for (const k of Object.keys(source || {})) {
    const v = source[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && cible[k] && typeof cible[k] === 'object' && !Array.isArray(cible[k])) {
      fusionner(cible[k], v);
    } else {
      cible[k] = v;
    }
  }
  return cible;
}
async function lireConfig(env) {
  const brut = await env.CADRE.get('config');
  const lu = brut ? JSON.parse(brut) : {};
  const cfg = fusionner(JSON.parse(JSON.stringify(CONFIG_DEFAUT)), lu);
  if (!Array.isArray(lu.scenes)) migrerScenes(cfg, lu);
  return cfg;
}
// Anciens reglages (disposition "pendant les creneaux bus", option F1 "semaine du GP") -> scenes
function migrerScenes(cfg, lu) {
  const copie = o => JSON.parse(JSON.stringify(o || []));
  const sans = (l, id) => (l || []).filter(d => d.id !== id);
  const avec = (l, id) => (l || []).some(d => d.id === id);
  const b = lu.bus || {};
  cfg.scenes = [];
  const dB = lu.dispositionBus || [], dBP = lu.dispositionBusPortrait || [];
  const busUtilise = avec(cfg.disposition, 'bus') || avec(cfg.dispositionPortrait, 'bus') || dB.length || dBP.length;
  if (busUtilise && !b.toujours) {
    const cr = Array.isArray(b.creneaux) ? b.creneaux : b.jours ? [{ jours: b.jours, debut: b.debut, fin: b.fin }]
      : [{ jours: [0, 0, 0, 0, 1, 0, 0], debut: '18:00', fin: '20:00' }];
    cfg.scenes.push({ id: 'bus', nom: 'Bus', creneaux: cr, f1: '', du: '', au: '', reveilMin: b.reveilMin || 3,
      disposition: copie(dB.length ? dB : cfg.disposition), dispositionPortrait: copie(dBP.length ? dBP : cfg.dispositionPortrait) });
    cfg.disposition = sans(cfg.disposition, 'bus'); cfg.dispositionPortrait = sans(cfg.dispositionPortrait, 'bus');
  }
  if (lu.f1 && lu.f1.semaine && (avec(cfg.disposition, 'f1') || avec(cfg.dispositionPortrait, 'f1'))) {
    cfg.scenes.push({ id: 'gp', nom: 'Grand Prix', creneaux: [], f1: 'semaine', du: '', au: '', reveilMin: 0,
      disposition: copie(cfg.disposition), dispositionPortrait: copie(cfg.dispositionPortrait) });
    cfg.disposition = sans(cfg.disposition, 'f1'); cfg.dispositionPortrait = sans(cfg.dispositionPortrait, 'f1');
  }
  for (const k of ['dispositionBus', 'dispositionBusPortrait', 'f1']) delete cfg[k];
  for (const k of ['toujours', 'creneaux', 'reveilMin', 'jours', 'debut', 'fin']) delete cfg.bus[k];
}
async function ecrireConfig(env, cfg) {
  await env.CADRE.put('config', JSON.stringify(cfg));
}
async function empreinte(chaine) {
  const h = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(chaine));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}

// ---------------------------------------------------------------------
//  Fuseaux horaires (sans bibliotheque)
// ---------------------------------------------------------------------
const formats = {};
function formatFuseau(tz) {
  if (!formats[tz]) {
    formats[tz] = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  }
  return formats[tz];
}
function fuseauValide(tz) {
  try { formatFuseau(tz); return tz; } catch (e) { return TZ; }
}
// Heure "murale" (y, m, d, hh, mi, ss, js = jour de semaine) d'un instant UTC dans un fuseau
function mural(utcMs, tz = TZ) {
  const o = {};
  for (const p of formatFuseau(tz).formatToParts(new Date(utcMs))) o[p.type] = p.value;
  const y = +o.year, m = +o.month, d = +o.day;
  return { y, m, d, hh: +o.hour % 24, mi: +o.minute, ss: +o.second, js: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}
function decalageMin(utcMs, tz) {
  const w = mural(utcMs, tz);
  return (Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mi, w.ss) - Math.floor(utcMs / 1000) * 1000) / 60000;
}
// Heure murale dans un fuseau -> instant UTC
function versUTC(w, tz) {
  const brut = Date.UTC(w.y, w.m - 1, w.d, w.hh || 0, w.mi || 0, w.ss || 0);
  if (tz === 'UTC') return brut;
  const o1 = decalageMin(brut, tz);
  let utc = brut - o1 * 60000;
  const o2 = decalageMin(utc, tz);
  if (o2 !== o1) utc = brut - o2 * 60000;
  return utc;
}
const deux = n => String(n).padStart(2, '0');

// ---------------------------------------------------------------------
//  Routes
// ---------------------------------------------------------------------
async function routeEtat(url, env) {
  const cfg = await lireConfig(env);
  const pourInterface = url.searchParams.has('ui');
  const maintenant = Date.now();
  // Avec deux ecrans, chaque dalle demande sa moitie : ?ecran=0 (gauche / haut) ou ?ecran=1
  const deuxEcrans = cfg.ecrans && cfg.ecrans.nb === 2;
  const ecran = deuxEcrans && url.searchParams.get('ecran') === '1' ? 1 : 0;
  const etat = {
    mode: cfg.mode,
    reveil: cfg.dev ? Math.max(10, cfg.devSecondes | 0) : Math.max(3, cfg.reveilMin) * 60,
    dev: cfg.dev ? 1 : 0,
  };
  let contenu;

  if (cfg.mode === 'tableau') {
    contenu = await construireTableau(cfg, maintenant, env);
    // Seulement les blocs de cette dalle, et seulement les donnees dont ils ont besoin
    // (sinon un changement sur l'autre dalle ferait rafraichir celle-ci pour rien)
    contenu.disposition = contenu.disposition.filter(d => d.n === ecran);
    contenu.disposition.forEach(d => delete d.n);
    const ici = new Set(contenu.disposition.map(d => d.id));
    if (!['meteo', 'heures', 'jours', 'courbe'].some(id => ici.has(id))) delete contenu.meteo;
    for (const id of ['agenda', 'bus', 'f1']) if (!ici.has(id)) delete contenu[id];
    Object.assign(etat, contenu);
    // Scene affichee : son rythme (ou le rythme normal / de nuit), et reveil cale sur le prochain changement de scene
    const sc = contenu.scene;
    delete contenu.scene; delete etat.scene;
    etat.scene = sc.nom;
    if (!cfg.dev) {
      etat.reveil = sc.reveilMin ? Math.max(3, sc.reveilMin) * 60 : reveilNuit(cfg, maintenant, etat.reveil);
      if (sc.changement) etat.reveil = Math.min(etat.reveil, Math.max(60, Math.ceil((sc.changement - maintenant) / 1000) + 5));
    }
  } else if (cfg.mode === 'photo') {
    if (!cfg.dev) etat.reveil = reveilNuit(cfg, maintenant, etat.reveil);
    contenu = { p: cfg.photo.version, ecran };
    etat.rotation = cfg.photo.rotation || 0;       // orientation choisie a l'envoi de la photo
  } else if (cfg.mode === 'pochette') {
    const p = { titre: pourEcran(cfg.pochette.titre), artiste: pourEcran(cfg.pochette.artiste), album: pourEcran(cfg.pochette.album),
      rotation: cfg.affichage.rotation || 0 };
    // Deux ecrans : la pochette sur l'un, le titre en grand sur l'autre
    if (deuxEcrans) p.partie = ecran === 0 ? 'image' : 'texte';
    contenu = Object.assign({ v: cfg.pochette.version }, p);
    Object.assign(etat, p);
    if (!cfg.dev) etat.reveil = reveilNuit(cfg, maintenant, etat.reveil);
  } else {
    contenu = { blanc: cfg.version };
  }
  // La signature change seulement quand le contenu a afficher change :
  // le cadre ne rafraichit l'ecran que dans ce cas.
  etat.sig = await empreinte(cfg.mode + JSON.stringify(contenu));
  if (deuxEcrans) etat.ecran = ecran;
  // Mise a jour par Wi-Fi : proposee seulement si le programme envoye est plus recent que celui de la carte
  // (versions "AAAAMMJJ-hhmmss" : date de compilation)
  const fwCarte = VERSION_FW.test(url.searchParams.get('fw') || '') ? url.searchParams.get('fw') : null;
  if (cfg.firmware && fwCarte && cfg.firmware.version > fwCarte) etat.fw = cfg.firmware.version;
  const w = mural(maintenant);
  etat.maj = deux(w.hh) + ':' + deux(w.mi);

  if (!pourInterface) {
    // L'offre gratuite limite les ecritures (~1 000 par jour) : l'etat du cadre n'est enregistre
    // que toutes les 10 min, ou quand quelque chose d'important change (mode, version, batterie).
    const bat = parseFloat(url.searchParams.get('bat'));
    const cleStatut = ecran ? 'statut' + ecran : 'statut';
    const ancien = JSON.parse((await env.CADRE.get(cleStatut)) || 'null');
    const nouveau = { vu: maintenant, bat: isNaN(bat) ? null : bat, mode: cfg.mode, r: etat.reveil, sc: etat.scene || null,
      fw: fwCarte || (ancien && ancien.fw) || null, hb: (ancien && ancien.hb) || 0 };
    // Historique de la batterie : un point par heure, 30 jours (24 ecritures par jour au plus)
    let historique = false;
    if (nouveau.bat > 2.5 && maintenant - nouveau.hb >= 55 * 60000) {
      try {
        const cleH = 'batterie' + (ecran ? ecran : '');
        const h = JSON.parse((await env.CADRE.get(cleH)) || '{"pts":[]}');
        const debut = Math.floor((maintenant - 30 * 86400e3) / 60000);
        h.pts = h.pts.filter(p => p[0] >= debut);
        h.pts.push([Math.floor(maintenant / 60000), Math.round(nouveau.bat * 1000)]);   // minutes, millivolts
        await env.CADRE.put(cleH, JSON.stringify(h));
        nouveau.hb = maintenant; historique = true;
      } catch (e) { /* limite d'ecriture */ }
    }
    const aEcrire = historique || !ancien || maintenant - ancien.vu >= 10 * 60000 || ancien.mode !== nouveau.mode ||
      ancien.fw !== nouveau.fw || ancien.r !== nouveau.r || ancien.sc !== nouveau.sc || (nouveau.bat !== null && Math.abs((ancien.bat || 0) - nouveau.bat) >= 0.05);
    if (aEcrire) {
      try { await env.CADRE.put(cleStatut, JSON.stringify(nouveau)); } catch (e) { /* limite atteinte : sans gravite */ }
    }
  }
  return json(etat);
}

async function routeLireConfig(env) {
  const cfg = await lireConfig(env);
  const statut = JSON.parse((await env.CADRE.get('statut')) || 'null');
  const statut1 = cfg.ecrans && cfg.ecrans.nb === 2 ? JSON.parse((await env.CADRE.get('statut1')) || 'null') : null;
  return json({ config: cfg, statut, statut1, maintenant: Date.now() });
}

async function routeEcrireConfig(req, env) {
  const modif = await req.json();
  const cfg = await lireConfig(env);
  const ignorees = preparerModif(modif, cfg);
  if (typeof ignorees === 'string') return texte(ignorees, 400);
  fusionner(cfg, modif);
  cfg.version++;
  await ecrireConfig(env, cfg);
  return json({ config: cfg, ignorees });
}
// Verifie et nettoie une modification des reglages (renvoie les anniversaires illisibles, ou un message d'erreur)
function preparerModif(modif, cfg) {
  delete modif.version; delete modif.photo; delete modif.pochette; delete modif.firmware;
  if (modif.mode && !MODES.includes(modif.mode)) return 'Mode inconnu';
  if (modif.ecrans) {
    const e = modif.ecrans;
    modif.ecrans = { nb: e.nb === 2 ? 2 : 1, assemblage: e.assemblage === 'dessus' ? 'dessus' : 'cote',
      joint: Math.max(0, Math.min(100, +e.joint || 0)) };
  }
  const ecrans = modif.ecrans || cfg.ecrans;
  if (modif.disposition !== undefined) modif.disposition = validerDisposition(modif.disposition, grille(0, ecrans));
  if (modif.dispositionPortrait !== undefined) modif.dispositionPortrait = validerDisposition(modif.dispositionPortrait, grille(1, ecrans));
  if (modif.scenes !== undefined) modif.scenes = validerScenes(modif.scenes, ecrans);
  delete modif.dispositionBus; delete modif.dispositionBusPortrait; delete modif.f1;
  if (modif.affichage && modif.affichage.rotation !== undefined && !ROTATIONS.includes(modif.affichage.rotation)) delete modif.affichage.rotation;
  if (modif.agenda && Array.isArray(modif.agenda.urls)) {
    modif.agenda.urls = modif.agenda.urls.map(u => String(u).trim()).filter(Boolean);
  }
  let ignorees = [];
  if (modif.agenda && typeof modif.agenda.anniversairesTexte === 'string') {
    const r = lireAnniversaires(modif.agenda.anniversairesTexte);
    modif.agenda.anniversaires = r.liste;
    ignorees = r.ignorees;
    delete modif.agenda.anniversairesTexte;
  }
  return ignorees;
}

// --- Previsualisation : l'etat qu'enverrait le serveur avec des reglages pas encore enregistres ---
// La page le dessine elle-meme avec le code de la carte (apercu.wasm). Rien n'est enregistre.
async function routePrevisualiser(req, env) {
  let demande;
  try { demande = await req.json(); } catch (e) { return texte('Demande illisible', 400); }
  const cfg = await lireConfig(env);
  const modif = demande.modif || {};
  const err = preparerModif(modif, cfg);
  if (typeof err === 'string') return texte(err, 400);
  fusionner(cfg, modif);
  const scene = Number.isInteger(demande.scene) ? demande.scene : null;
  // Lecture seule : une prevision ne doit rien ecrire (copies de secours, calendrier F1...),
  // par exemple une ville essayee sans l'enregistrer ne doit pas remplacer la copie de la vraie ville
  const kv = env.CADRE;
  const lecture = { get: (...a) => kv.get(...a), getWithMetadata: (...a) => kv.getWithMetadata(...a),
    put: async () => {}, delete: async () => {} };
  const contenu = await construireTableau(cfg, Date.now(), Object.assign({}, env, { CADRE: lecture }), scene);
  const nb = cfg.ecrans && cfg.ecrans.nb === 2 ? 2 : 1;
  const ecrans = [];
  for (let n = 0; n < nb; n++) {
    const e = Object.assign({ mode: 'tableau' }, contenu, { disposition: contenu.disposition.filter(d => d.n === n) });
    delete e.scene;
    ecrans.push(e);
  }
  return json({ scene: contenu.scene.nom, ecrans });
}

// --- Sauvegarde des reglages (fichier telecharge depuis la page web) et restauration ---
async function routeSauvegarde(env) {
  const cfg = await lireConfig(env);
  for (const k of ['version', 'photo', 'pochette', 'firmware']) delete cfg[k];
  const bus = await env.CADRE.get('bus');
  const date = dateDuJour(mural(Date.now()));
  return new Response(JSON.stringify({ format: 'cadre-eink', version: 1, date, config: cfg, bus: bus ? JSON.parse(bus) : null }, null, 1), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
      'content-disposition': 'attachment; filename="cadre-reglages-' + date + '.json"' },
  });
}
async function routeRestaurer(req, env) {
  let s;
  try { s = await req.json(); } catch (e) { return texte('Fichier illisible', 400); }
  if (!s || s.format !== 'cadre-eink' || !s.config || typeof s.config !== 'object') return texte("Ce fichier n'est pas une sauvegarde du cadre", 400);
  const actuel = await lireConfig(env);
  const modif = JSON.parse(JSON.stringify(s.config));
  const anniv = modif.agenda && Array.isArray(modif.agenda.anniversaires) ? modif.agenda.anniversaires : null;
  const err = preparerModif(modif, actuel);
  if (typeof err === 'string') return texte(err, 400);
  // On repart des reglages par defaut (et non des reglages actuels), en gardant photo, pochette et programme
  const cfg = fusionner(JSON.parse(JSON.stringify(CONFIG_DEFAUT)), modif);
  if (anniv) cfg.agenda.anniversaires = anniv.filter(a => a && a.nom && a.j >= 1 && a.j <= 31 && a.m >= 1 && a.m <= 12)
    .map(a => ({ nom: String(a.nom).slice(0, 40), j: a.j | 0, m: a.m | 0, a: a.a | 0 }));
  if (!Array.isArray(modif.scenes)) migrerScenes(cfg, modif);
  for (const k of ['photo', 'pochette', 'firmware']) if (actuel[k]) cfg[k] = actuel[k];
  cfg.version = actuel.version + 1;
  await ecrireConfig(env, cfg);
  if (s.bus && Array.isArray(s.bus.passages)) { await env.CADRE.put('bus', JSON.stringify(s.bus)); indexBusCache = null; }
  return json({ config: cfg });
}

// Lignes du type "Léa 14/03/2005" ou "Mamie 2/11" (l'annee est facultative)
function lireAnniversaires(texte) {
  const liste = [], ignorees = [];
  for (const brut of texte.split(/\r?\n/)) {
    const l = brut.trim();
    if (!l) continue;
    const m = /^(.*?)[\s:,;-]+(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{4}))?$/.exec(l);
    const j = m ? +m[2] : 0, mo = m ? +m[3] : 0;
    if (!m || !m[1].trim() || j < 1 || j > 31 || mo < 1 || mo > 12) { ignorees.push(l); continue; }
    liste.push({ nom: m[1].trim().slice(0, 40), j, m: mo, a: m[4] ? +m[4] : 0 });
  }
  return { liste, ignorees };
}

async function routeEnvoyerPhoto(req, url, env) {
  const donnees = await req.arrayBuffer();
  const cfg = await lireConfig(env);
  const nb = cfg.ecrans && cfg.ecrans.nb === 2 ? 2 : 1;
  // Une image par dalle, mises bout a bout (ecran 0 puis ecran 1)
  if (donnees.byteLength !== OCTETS * nb) return texte('La photo doit faire exactement ' + OCTETS * nb + ' octets', 400);
  await env.CADRE.put('photo', donnees.slice(0, OCTETS));
  if (nb === 2) await env.CADRE.put('photo1', donnees.slice(OCTETS));
  const r = parseInt(url.searchParams.get('r') || '0', 10);
  cfg.photo = { version: cfg.photo.version + 1, t: Date.now(), rotation: ROTATIONS.includes(r) ? r : 0 };
  cfg.mode = 'photo';
  cfg.version++;
  await ecrireConfig(env, cfg);
  return json({ ok: true, config: cfg });
}

async function routeEnvoyerPochette(req, url, env) {
  const donnees = await req.arrayBuffer();
  if (donnees.byteLength < 100) return texte('Image vide', 400);
  if (donnees.byteLength > 3000000) return texte('Image trop lourde (max 3 Mo)', 400);
  await env.CADRE.put('pochette', donnees);
  const cfg = await lireConfig(env);
  const p = url.searchParams;
  cfg.pochette = {
    version: cfg.pochette.version + 1,
    titre: (p.get('titre') || '').slice(0, 80),
    artiste: (p.get('artiste') || '').slice(0, 80),
    album: (p.get('album') || '').slice(0, 80),
    t: Date.now(),
  };
  cfg.mode = 'pochette';
  cfg.version++;
  await ecrireConfig(env, cfg);
  return texte('Pochette envoyée au cadre');
}

// Relais du fichier d'horaires Tango (pour que la page web puisse le lire)
async function routeGTFS() {
  const r = await fetch(GTFS_TANGO, { cf: { cacheTtl: 86400, cacheEverything: true } });
  if (!r.ok) return texte('Horaires Tango indisponibles (HTTP ' + r.status + ')', 502);
  return new Response(r.body, { headers: { 'content-type': 'application/zip', 'cache-control': 'no-store' } });
}

// Index des passages aux arrets choisis, prepare par la page web
async function routeIndexBus(req, env) {
  const t = await req.text();
  if (t.length > 3000000) return texte('Index trop gros : choisis moins d\'arrets', 400);
  const idx = JSON.parse(t);
  if (!Array.isArray(idx.passages)) return texte('Index invalide', 400);
  await env.CADRE.put('bus', t);
  indexBusCache = null;
  return json({ ok: true, passages: idx.passages.length });
}

async function routeBinaire(env, cle, type) {
  const donnees = await env.CADRE.get(cle, 'arrayBuffer');
  if (!donnees) return texte('Rien a envoyer', 404);
  return new Response(donnees, { headers: { 'content-type': type, 'cache-control': 'no-store' } });
}

// --- Programme de la carte (mise a jour par Wi-Fi) ---
const VERSION_FW = /^\d{8}-\d{6}$/;
async function routeEnvoyerFirmware(req, url, env) {
  const version = url.searchParams.get('v') || '';
  if (!VERSION_FW.test(version)) return texte('Version du programme manquante', 400);
  const donnees = await req.arrayBuffer();
  if (donnees.byteLength < 100000 || donnees.byteLength > 8 * 1048576 || new Uint8Array(donnees)[0] !== 0xE9) {
    return texte("Ce fichier n'est pas un programme ESP32", 400);
  }
  await env.CADRE.put('firmware', donnees);
  const cfg = await lireConfig(env);
  cfg.firmware = { version, taille: donnees.byteLength, t: Date.now(), nom: (url.searchParams.get('nom') || '').slice(0, 80) };
  await ecrireConfig(env, cfg);
  return json({ firmware: cfg.firmware });
}
async function routeRetirerFirmware(env) {
  const cfg = await lireConfig(env);
  delete cfg.firmware;
  await ecrireConfig(env, cfg);
  await env.CADRE.delete('firmware');
  return json({ ok: true });
}

async function routeEnvoyerApercu(req, url, env) {
  const donnees = await req.arrayBuffer();
  if (donnees.byteLength !== OCTETS) return texte('Taille incorrecte', 400);
  const r = parseInt(url.searchParams.get('r') || '0', 10);
  await env.CADRE.put(url.searchParams.get('ecran') === '1' ? 'apercu1' : 'apercu', donnees, { metadata: { t: Date.now(), r: ROTATIONS.includes(r) ? r : 0 } });
  return texte('ok');
}

async function routeLireApercu(url, env) {
  const { value, metadata } = await env.CADRE.getWithMetadata(url.searchParams.get('ecran') === '1' ? 'apercu1' : 'apercu', 'arrayBuffer');
  if (!value) return texte('Pas encore d\'apercu', 404);
  return new Response(value, {
    headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'x-date': String(metadata ? metadata.t : 0), 'x-rotation': String(metadata && metadata.r ? metadata.r : 0) },
  });
}

// ---------------------------------------------------------------------
//  Prochains bus (reseau Tango, Nimes Metropole, donnees ouvertes)
//
//  - Les horaires theoriques (GTFS) sont analyses par la page web, qui ne
//    garde que les passages aux arrets choisis : c'est "l'index" stocke en KV.
//  - Le serveur y applique le temps reel (GTFS-RT) au moment de la demande.
// ---------------------------------------------------------------------
const GTFS_TANGO = 'https://www.data.gouv.fr/api/1/datasets/r/15aeb8a5-1cca-4bb9-ae5f-b6e67e4ff2ab';
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

// --- Creneaux d'affichage des bus (ex. vendredi 18h-20h) ---
const enMinutes = s => { const [h, m] = String(s || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
function listeCreneaux(o) {
  if (Array.isArray(o.creneaux)) return o.creneaux;
  return o.jours ? [{ jours: o.jours, debut: o.debut, fin: o.fin }] : [];   // anciens reglages
}
function dansCreneau(o, maintenant) {
  if (o.toujours) return true;
  const w = mural(maintenant), jour = (w.js + 6) % 7, min = w.hh * 60 + w.mi;
  return listeCreneaux(o).some(c => (c.jours || [])[jour] && min >= enMinutes(c.debut) && min < enMinutes(c.fin));
}
// Instant (ms) du debut du prochain creneau, ou null
function prochainDebutCreneau(o, maintenant, champ = 'debut') {
  let meilleur = null;
  for (let k = 0; k <= 7; k++) {
    const w = mural(maintenant + k * 86400e3), jour = (w.js + 6) % 7;
    for (const c of listeCreneaux(o)) {
      if (!(c.jours || [])[jour]) continue;
      const m = enMinutes(c[champ]);
      const t = versUTC({ y: w.y, m: w.m, d: w.d, hh: Math.floor(m / 60), mi: m % 60 }, TZ);
      if (t > maintenant && (meilleur === null || t < meilleur)) meilleur = t;
    }
  }
  return meilleur;
}
// --- Mode nuit ---
// Minutes ecoulees depuis le debut de la nuit en cours, ou -1 si on n'est pas la nuit
function dansNuit(n, maintenant) {
  if (!n || !n.actif) return -1;
  const w = mural(maintenant), min = w.hh * 60 + w.mi;
  const d = enMinutes(n.debut), f = enMinutes(n.fin);
  if (d === f) return -1;
  const depuis = (min - d + 1440) % 1440, duree = (f - d + 1440) % 1440;
  return depuis < duree ? depuis : -1;
}
// Intervalle de reveil (s) : la nuit, reveil espace, et cale sur la fin de la nuit
function reveilNuit(cfg, maintenant, normal) {
  const n = cfg.nuit, depuis = dansNuit(n, maintenant);
  if (depuis >= 0) {
    const w = mural(maintenant);
    const resteS = ((enMinutes(n.fin) - (w.hh * 60 + w.mi) + 1440) % 1440) * 60 - w.ss;
    const inter = Math.max(15, Math.min(240, n.intervalleMin || 60)) * 60;
    return Math.max(60, Math.min(inter, resteS + 5));
  }
  return normal;
}
function texteCreneaux(o) {
  const J = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
  return listeCreneaux(o).map(c => J.filter((x, i) => (c.jours || [])[i]).join(', ') + ' ' +
    String(c.debut).replace(':', 'h') + '-' + String(c.fin).replace(':', 'h')).join(' ; ');
}

// --- Scenes ---
const heureOK = h => (/^\d{1,2}:\d{2}$/.test(String(h)) ? String(h) : null);
const dateOK = d => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? String(d) : '');
function validerCreneaux(liste) {
  return (Array.isArray(liste) ? liste : []).map(c => ({
    jours: [0, 1, 2, 3, 4, 5, 6].map(i => (c && c.jours || [])[i] ? 1 : 0),
    debut: heureOK(c && c.debut) || '07:00', fin: heureOK(c && c.fin) || '08:00',
  })).filter(c => c.jours.some(Boolean) && enMinutes(c.fin) > enMinutes(c.debut)).slice(0, 8);
}
function validerScenes(liste, ecrans) {
  const vus = new Set();
  return (Array.isArray(liste) ? liste : []).slice(0, 8).map((sc, i) => {
    let id = String(sc && sc.id || '').replace(/[^a-z0-9-]/gi, '').slice(0, 20) || 's' + i;
    while (vus.has(id)) id += 'x';
    vus.add(id);
    return {
      id, nom: String(sc.nom || '').trim().slice(0, 40) || 'Scène ' + (i + 1),
      creneaux: validerCreneaux(sc.creneaux),
      f1: ['semaine', 'weekend'].includes(sc.f1) ? sc.f1 : '',
      du: dateOK(sc.du), au: dateOK(sc.au),
      reveilMin: [0, 3, 5, 10, 15, 30, 60].includes(+sc.reveilMin) ? +sc.reveilMin : 0,
      disposition: validerDisposition(sc.disposition, grille(0, ecrans)),
      dispositionPortrait: validerDisposition(sc.dispositionPortrait, grille(1, ecrans)),
    };
  });
}
const dateDuJour = w => w.y + '-' + deux(w.m) + '-' + deux(w.d);
// Une scene est active si toutes ses conditions sont remplies (sans condition : toujours active)
function sceneActive(sc, maintenant, gp) {
  const jour = dateDuJour(mural(maintenant));
  if (sc.du && jour < sc.du) return false;
  if (sc.au && jour > sc.au) return false;
  if (sc.f1) {
    const p = gp && gp.periodes && gp.periodes[sc.f1];
    if (!p || maintenant < p[0] || maintenant >= p[1]) return false;
  }
  if ((sc.creneaux || []).length && !dansCreneau({ creneaux: sc.creneaux }, maintenant)) return false;
  return true;
}
// Prochain instant ou une scene peut commencer ou finir (pour que le cadre se reveille pile a ce moment)
function prochainChangementScene(scenes, maintenant, gp) {
  const t = [];
  for (const sc of scenes) {
    if ((sc.creneaux || []).length) {
      t.push(prochainDebutCreneau({ creneaux: sc.creneaux }, maintenant, 'debut'));
      t.push(prochainDebutCreneau({ creneaux: sc.creneaux }, maintenant, 'fin'));
    }
    const p = sc.f1 && gp && gp.periodes && gp.periodes[sc.f1];
    if (p) t.push(p[0], p[1]);
    for (const [d, lendemain] of [[sc.du, 0], [sc.au, 1]]) {
      if (!d) continue;
      const [y, m, j] = d.split('-').map(Number);
      t.push(versUTC({ y, m, d: j + lendemain }, TZ));
    }
  }
  const futurs = t.filter(x => x && x > maintenant);
  return futurs.length ? Math.min(...futurs) : null;
}

async function prochainsBus(o, maintenant, env, ignorerCreneau) {
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

// ---------------------------------------------------------------------
//  Tableau de bord : date + meteo + agenda
// ---------------------------------------------------------------------
// forcer : numero de la scene a afficher (-1 = Par defaut) ; absent = scene active a cet instant
async function construireTableau(cfg, maintenant, env, forcer = null) {
  const w = mural(maintenant);
  const rotation = ROTATIONS.includes(cfg.affichage.rotation) ? cfg.affichage.rotation : 0;
  const g = grille(rotation, cfg.ecrans);
  // Grand Prix de F1 : utile pour le bloc F1 et pour les scenes "semaine / week-end de GP"
  const scenes = cfg.scenes || [];
  let f1 = null;
  const chargerGP = async () => {
    if (!f1) {
      try { f1 = await grandPrix(maintenant, env); }
      catch (e) { console.log('F1 :', e.message); f1 = { erreur: 'Calendrier F1 indisponible (' + e.message + ')' }; }
    }
    return f1;
  };
  // Toutes les sources sont interrogees en meme temps (reponse plus rapide = carte allumee moins
  // longtemps). Meteo, agenda et F1 sont lancees avant de connaitre la scene, si une des dispositions
  // possibles les utilise ; les bus (plus lourds) seulement si la scene affichee les montre.
  const cle = rotation ? 'dispositionPortrait' : 'disposition';
  const possibles = [cfg[cle]].concat(scenes.map(sc => sc[cle]));
  const peutServir = ids => possibles.some(l => (l || []).some(d => ids.includes(d.id)));
  const sansErreur = (p, message) => p.catch(e => { console.log(message, ':', e.message); return { erreur: message }; });
  const pMeteo = peutServir(['meteo', 'heures', 'jours', 'courbe'])
    ? sansErreur(chargerMeteo(cfg.meteo, env), 'Météo indisponible') : null;
  const avecAgenda = cfg.agenda.urls.length || cfg.agenda.anniversaires.length;
  const pAgenda = peutServir(['agenda']) && avecAgenda ? sansErreur(agenda(cfg.agenda, maintenant, env), 'Agenda indisponible') : null;
  const pGP = scenes.some(sc => sc.f1) || peutServir(['f1']) ? chargerGP() : null;
  if (scenes.some(sc => sc.f1)) await pGP;
  // Scene affichee : la premiere active de la liste, sinon la disposition par defaut
  const active = forcer === null || forcer === undefined ? scenes.find(sc => sceneActive(sc, maintenant, f1))
    : forcer >= 0 ? scenes[forcer] || null : null;
  let dispo = validerDisposition(active ? active[cle] : cfg[cle], g);
  const presents = new Set(dispo.map(d => d.id));
  const pBus = presents.has('bus') ? sansErreur(prochainsBus(cfg.bus, maintenant, env, true), 'Bus indisponibles') : null;
  const [brutMeteo, resAgenda] = await Promise.all([pMeteo, pAgenda, pGP]);
  const res = {
    date: JOURS_LONGS[w.js] + ' ' + w.d + ' ' + MOIS[w.m - 1],
    rotation,
    disposition: dispo.map(d => enPixels(d, g)),
    gouttiere: GOUTTIERE,
    traits: cfg.affichage.traits ? 1 : 0,
    scene: { nom: active ? active.nom : 'Par défaut', reveilMin: active ? active.reveilMin : 0,
      changement: prochainChangementScene(scenes, maintenant, f1) },
  };
  if (presents.has('f1')) { res.f1 = Object.assign({}, f1); delete res.f1.periodes; }
  if (['meteo', 'heures', 'jours', 'courbe'].some(id => presents.has(id))) {
    if (!brutMeteo || brutMeteo.erreur) res.meteo = { erreur: 'Météo indisponible' };
    else {
      try {
        res.meteo = meteo(Object.assign({}, cfg.meteo,
          { heures: presents.has('heures'), jours: presents.has('jours'), courbe: presents.has('courbe') }), brutMeteo);
      } catch (e) { console.log('Météo :', e.message); res.meteo = { erreur: 'Météo indisponible' }; }
    }
  }
  if (presents.has('agenda')) res.agenda = avecAgenda ? resAgenda : { erreur: 'Aucun calendrier configuré' };
  if (presents.has('bus')) {
    res.bus = await pBus;
    // Les minutes restantes ne sont pas affichees : on les retire pour que la signature
    // ne change pas a chaque minute (sinon l'ecran clignoterait a chaque reveil)
    for (const p of res.bus.passages || []) delete p.m;
  }
  return res;
}

const DESCRIPTIONS = {
  0: 'Ciel dégagé', 1: 'Plutôt dégagé', 2: 'Partiellement nuageux', 3: 'Couvert',
  45: 'Brouillard', 48: 'Brouillard givrant',
  51: 'Bruine légère', 53: 'Bruine', 55: 'Bruine dense', 56: 'Bruine verglaçante', 57: 'Bruine verglaçante',
  61: 'Pluie faible', 63: 'Pluie', 65: 'Forte pluie', 66: 'Pluie verglaçante', 67: 'Pluie verglaçante',
  71: 'Neige faible', 73: 'Neige', 75: 'Forte neige', 77: 'Grains de neige',
  80: 'Averses', 81: 'Averses', 82: 'Fortes averses', 85: 'Averses de neige', 86: 'Averses de neige',
  95: 'Orage', 96: 'Orage et grêle', 99: 'Orage et grêle',
};
// Les polices de l'ecran ne contiennent que l'alphabet latin (Latin-1) :
// on remplace les caracteres typographiques et on retire le reste (emojis...)
function pourEcran(t) {
  return String(t || '')
    .replace(/[\u2018\u2019\u02BC]/g, "'").replace(/[\u201C\u201D\u00AB\u00BB]/g, '"')
    .replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...').replace(/\u0152/g, 'OE').replace(/\u0153/g, 'oe')
    .normalize('NFC').replace(/[^\u0020-\u007E\u00A0-\u00FF]/g, '').replace(/\s+/g, ' ').trim();
}
function directionVent(deg) {
  return ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'][Math.round(((deg % 360) + 360) % 360 / 45) % 8];
}

// Copie de secours d'une source externe : enregistree au plus une fois par heure (limite d'ecritures
// du KV), relue si la source ne repond pas, tant qu'elle a moins de ageMax ms.
// 'controle' : si la copie a ete faite pour une autre adresse (ville changee), elle n'est pas utilisee.
async function avecSecours(env, cle, ageMax, charger, controle = '') {
  try {
    const texte = await charger();
    try {
      const { metadata } = await env.CADRE.getWithMetadata(cle);
      if (!metadata || Date.now() - metadata.t > 3600e3 || metadata.c !== controle) {
        await env.CADRE.put(cle, texte, { metadata: { t: Date.now(), c: controle } });
      }
    } catch (e) { /* limite d'ecriture : sans gravite */ }
    return { texte, ancien: false };
  } catch (e) {
    const { value, metadata } = await env.CADRE.getWithMetadata(cle);
    if (value && metadata && metadata.c === controle && Date.now() - metadata.t < ageMax) {
      console.log('Copie de secours utilisee pour', cle, ':', e.message);
      return { texte: value, ancien: true };
    }
    throw e;
  }
}

// Donnees brutes d'Open-Meteo (avec copie de secours si le service ne repond pas)
async function chargerMeteo(o, env) {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + o.lat + '&longitude=' + o.lon +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,' +
    'wind_speed_10m,wind_direction_10m,wind_gusts_10m' +
    '&hourly=temperature_2m,weather_code,precipitation_probability,is_day' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max' +
    '&timezone=Europe%2FParis&forecast_days=8&wind_speed_unit=kmh';
  const { texte, ancien } = await avecSecours(env, 'secours-meteo', 24 * 3600e3, async () => {
    const r = await fetch(url, { cf: { cacheTtl: 600, cacheEverything: true }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.text();
  }, url);
  const d = JSON.parse(texte);
  if (ancien) {
    // Copie ancienne : on prend la prevision heure par heure de l'heure actuelle comme "meteo actuelle"
    const w = mural(Date.now()), h = dateDuJour(w) + 'T' + deux(w.hh) + ':00';
    const i = d.hourly.time.indexOf(h);
    if (i < 0) throw new Error('copie trop ancienne');
    Object.assign(d.current, { time: h, temperature_2m: d.hourly.temperature_2m[i], apparent_temperature: d.hourly.temperature_2m[i],
      weather_code: d.hourly.weather_code[i], is_day: d.hourly.is_day[i] });
    const j = d.daily.time.indexOf(dateDuJour(w));
    if (j > 0) for (const k in d.daily) d.daily[k] = d.daily[k].slice(j);   // "aujourd'hui" en premier
  }
  return d;
}
function meteo(o, d) {
  const c = d.current;
  const res = {
    ville: pourEcran(o.ville),
    t: Math.round(c.temperature_2m),
    c: c.weather_code,
    n: c.is_day ? 0 : 1,
    desc: DESCRIPTIONS[c.weather_code] || '',
    min: Math.round(d.daily.temperature_2m_min[0]),
    max: Math.round(d.daily.temperature_2m_max[0]),
  };
  if (o.details) {
    res.ressenti = Math.round(c.apparent_temperature);
    res.hum = Math.round(c.relative_humidity_2m);
    // Risque de pluie maximal sur les 12 prochaines heures (heure en cours comprise) :
    // repond a "faut-il un parapluie ?", meme le soir
    const iH = d.hourly.time.indexOf(c.time.slice(0, 13) + ':00');
    res.pluie = iH >= 0
      ? Math.max(0, ...d.hourly.precipitation_probability.slice(iH, iH + 12).map(v => v ?? 0))
      : (d.daily.precipitation_probability_max[0] ?? 0);
  }
  if (o.vent) {
    res.vent = { v: Math.round(c.wind_speed_10m), raf: Math.round(c.wind_gusts_10m), dir: directionVent(c.wind_direction_10m) };
  }
  if (o.soleil) {
    res.soleil = { lever: d.daily.sunrise[0].slice(11, 16).replace(':', 'h'), coucher: d.daily.sunset[0].slice(11, 16).replace(':', 'h') };
  }
  if (o.heures) {
    const pas = Math.max(1, Math.min(6, o.pasHeures | 0 || 3));
    let i = d.hourly.time.findIndex(t => t > c.time);
    if (i < 0) i = 0;
    res.heures = [];
    const nbH = Math.max(2, Math.min(12, o.nbHeures | 0 || 6));
    for (let k = 0; k < nbH && i < d.hourly.time.length; k++, i += pas) {
      res.heures.push({
        h: parseInt(d.hourly.time[i].slice(11, 13), 10) + 'h',
        t: Math.round(d.hourly.temperature_2m[i]),
        c: d.hourly.weather_code[i],
        n: d.hourly.is_day[i] ? 0 : 1,
        p: d.hourly.precipitation_probability[i] ?? 0,
      });
    }
  }
  if (o.courbe) {
    // Graphique : temperature (en dixiemes de degre), risque de pluie et nuit, heure par heure
    const nb = [12, 24, 36, 48].includes(o.courbeHeures) ? o.courbeHeures : 24;
    let i0 = d.hourly.time.indexOf(c.time.slice(0, 13) + ':00');
    if (i0 < 0) i0 = 0;
    const fin = Math.min(d.hourly.time.length, i0 + nb + 1);
    const g = { h0: parseInt(d.hourly.time[i0].slice(11, 13), 10), t: [], p: [], n: [], j: [] };
    for (let i = i0; i < fin; i++) {
      g.t.push(Math.round(d.hourly.temperature_2m[i] * 10));
      g.p.push(d.hourly.precipitation_probability[i] ?? 0);
      g.n.push(d.hourly.is_day[i] ? 0 : 1);
      if (i > i0 && d.hourly.time[i].slice(11, 13) === '00') {      // nom des jours suivants, a minuit
        const [y, m, j] = d.hourly.time[i].slice(0, 10).split('-').map(Number);
        g.j.push(JOURS_COURTS[new Date(Date.UTC(y, m - 1, j)).getUTCDay()] + ' ' + j);
      }
    }
    res.courbe = g;
  }
  if (o.jours) {
    const nb = Math.max(1, Math.min(6, o.nbJours | 0 || 4));
    res.jours = [];
    for (let k = 1; k <= nb && k < d.daily.time.length; k++) {
      const [y, m, j] = d.daily.time[k].split('-').map(Number);
      res.jours.push({
        j: JOURS_COURTS[new Date(Date.UTC(y, m - 1, j)).getUTCDay()] + ' ' + j,
        c: d.daily.weather_code[k],
        min: Math.round(d.daily.temperature_2m_min[k]),
        max: Math.round(d.daily.temperature_2m_max[k]),
        p: d.daily.precipitation_probability_max[k] ?? 0,
      });
    }
  }
  return res;
}

// ---------------------------------------------------------------------
//  Agenda iCloud (fichiers .ics), y compris les evenements recurrents
// ---------------------------------------------------------------------
async function agenda(o, maintenant, env) {
  const fin = maintenant + Math.max(1, o.joursMax || 14) * 86400e3;
  // Tous les calendriers en meme temps ; un calendrier qui ne repond pas est remplace par sa
  // derniere copie (jusqu'a 7 jours), ou ignore si les autres repondent
  const lus = await Promise.allSettled(o.urls.map(async brut => {
    const url = brut.replace(/^webcal:\/\//i, 'https://');
    const { texte } = await avecSecours(env, 'secours-ics-' + await empreinte(url), 7 * 86400e3, async () => {
      const r = await fetch(url, { cf: { cacheTtl: 900, cacheEverything: true }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) throw new Error('Calendrier HTTP ' + r.status);
      return r.text();
    });
    return evenementsICS(texte, maintenant, fin);
  }));
  const reussis = lus.filter(l => l.status === 'fulfilled');
  if (o.urls.length && !reussis.length) throw lus[0].reason;
  let tous = [].concat(...reussis.map(l => l.value));
  tous = tous.concat(anniversaires(o.anniversaires || [], maintenant, fin));
  tous.sort((a, b) => a.debut - b.debut || (b.journee ? 1 : 0) - (a.journee ? 1 : 0));

  const auj = mural(maintenant);
  const demain = mural(maintenant + 86400e3);
  const memeJour = (a, b) => a.y === b.y && a.m === b.m && a.d === b.d;
  return tous.slice(0, Math.max(1, Math.min(14, o.nb || 8))).map(e => {
    const enCours = e.debut < maintenant;
    const w = enCours ? auj : mural(e.debut);
    const j = memeJour(w, auj) ? "Aujourd'hui" : memeJour(w, demain) ? 'Demain' : JOURS_COURTS[w.js] + ' ' + w.d;
    let h = '';
    if (!e.journee) h = enCours ? 'en cours' : deux(w.hh) + ':' + deux(w.mi);
    const t = pourEcran(titreF1(e.titre));
    return { j, h, t: t.length > 60 ? t.slice(0, 57) + '...' : t };
  });
}

// ---------------------------------------------------------------------
//  Titres de Formule 1 : "FORMULA 1 SPONSOR XXX GRAND PRIX 2026 - Race"
//  devient "GP de XXX - Course" (le nom du GP en premier, sans le sponsor)
// ---------------------------------------------------------------------
const GP_F1 = [            // mot-cle -> nom du GP (le dernier mot-cle trouve dans le titre l'emporte)
  [/australi/i, "GP d'Australie"], [/chin/i, 'GP de Chine'], [/japan/i, 'GP du Japon'],
  [/bahrain/i, 'GP de Bahreïn'], [/saudi|arabie/i, "GP d'Arabie saoudite"], [/miami/i, 'GP de Miami'],
  [/canad/i, 'GP du Canada'], [/monaco/i, 'GP de Monaco'], [/barcelon|catalu/i, 'GP de Barcelone'],
  [/spanish|spain|españa|espagne|madrid/i, "GP d'Espagne"], [/austria|österreich|autriche/i, "GP d'Autriche"],
  [/british|britain|grande-bretagne/i, 'GP de Grande-Bretagne'], [/belgi/i, 'GP de Belgique'],
  [/hungar|hongrie/i, 'GP de Hongrie'], [/dutch|netherlands|pays-bas/i, 'GP des Pays-Bas'],
  [/emilia|imola/i, "GP d'Émilie-Romagne"], [/ital/i, "GP d'Italie"], [/azerbai/i, "GP d'Azerbaïdjan"],
  [/singapo/i, 'GP de Singapour'], [/united states|usa|états-unis/i, 'GP des États-Unis'],
  [/las vegas/i, 'GP de Las Vegas'], [/mexic|méxico/i, 'GP de Mexico'], [/s[ãa]o paulo|brazil|brasil/i, 'GP de São Paulo'],
  [/qatar/i, 'GP du Qatar'], [/abu dhabi/i, "GP d'Abu Dhabi"],
];
const SESSIONS_F1 = [
  [/(free )?practice 1|\bfp1\b|essais libres 1/i, 'Essais libres 1'],
  [/(free )?practice 2|\bfp2\b|essais libres 2/i, 'Essais libres 2'],
  [/(free )?practice 3|\bfp3\b|essais libres 3/i, 'Essais libres 3'],
  [/sprint (qualifying|shootout|quali)|qualifications? sprint/i, 'Qualif. sprint'],
  [/sprint/i, 'Sprint'],
  [/qualif/i, 'Qualifications'],
  [/\brace\b|course/i, 'Course'],
];
function titreF1(t) {
  if (!/formula\s*1|\bf1\b|grand prix|gran premio|grande pr[eê]mio|grosser preis|großer preis/i.test(t)) return t;
  // Le nom du GP = le mot-cle de lieu situe le plus loin dans le titre (les sponsors sont au debut)
  let meilleur = null, pos = -1;
  for (const [re, nom] of GP_F1) {
    const g = new RegExp(re.source, 'gi');
    let m;
    while ((m = g.exec(t))) if (m.index > pos) { pos = m.index; meilleur = nom; }
  }
  if (!meilleur) return t;
  let session = '';
  for (const [re, nom] of SESSIONS_F1) if (re.test(t)) { session = nom; break; }
  return session ? meilleur + ' - ' + session : meilleur;
}

// ---------------------------------------------------------------------
//  Prochain Grand Prix de F1 : calendrier Jolpica (ex-Ergast), trace du circuit integre
// ---------------------------------------------------------------------
// Le calendrier est garde dans le KV et redemande au plus toutes les 12 h : Jolpica limite le nombre
// de requetes par adresse, et les Workers Cloudflare partagent leurs adresses avec beaucoup d'autres
// sites (d'ou des refus "HTTP 429"). Si Jolpica ne repond pas, on garde la derniere copie.
const CLES_GP = ['round', 'raceName', 'date', 'time', 'Circuit', 'FirstPractice', 'SecondPractice', 'ThirdPractice',
  'SprintQualifying', 'SprintShootout', 'Sprint', 'Qualifying'];
async function calendrierF1(annee, env) {
  const cle = 'f1-' + annee;
  let memo = null;
  try { memo = JSON.parse((await env.CADRE.get(cle)) || 'null'); } catch (e) { /* pas de copie */ }
  if (memo && Date.now() - memo.t < 12 * 3600e3) return memo.courses;
  try {
    const r = await fetch('https://api.jolpi.ca/ergast/f1/' + annee + '.json?limit=40',
      { cf: { cacheTtl: 21600, cacheEverything: true }, signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const courses = ((((await r.json()).MRData || {}).RaceTable || {}).Races || [])
      .map(c => Object.fromEntries(CLES_GP.filter(k => c[k] !== undefined).map(k => [k, c[k]])));
    if (courses.length || !memo || !memo.courses.length) {
      try { await env.CADRE.put(cle, JSON.stringify({ t: Date.now(), courses })); } catch (e) { /* limite d'ecriture */ }
    }
    return courses.length || !memo ? courses : memo.courses;
  } catch (e) {
    if (memo) return memo.courses;          // copie plus ancienne : toujours valable pour les horaires
    throw new Error(e.name === 'TimeoutError' ? 'pas de réponse' : e.message);
  }
}
const SESSIONS_JOLPICA = [['FirstPractice', 'Essais libres 1'], ['SecondPractice', 'Essais libres 2'],
  ['ThirdPractice', 'Essais libres 3'], ['SprintQualifying', 'Qualif. sprint'], ['SprintShootout', 'Qualif. sprint'],
  ['Sprint', 'Sprint'], ['Qualifying', 'Qualifications']];
const instantF1 = s => (s && s.date ? Date.parse(s.date + 'T' + (s.time || '12:00:00Z')) : NaN);
// Circuit integre le plus proche des coordonnees donnees par le calendrier
function circuitProche(lat, lon) {
  let meilleur = null, dMin = Infinity;
  for (const id in CIRCUITS) {
    const c = CIRCUITS[id];
    const d = Math.hypot((c.lat - lat) * 111, (c.lon - lon) * 111 * Math.cos(lat * Math.PI / 180));
    if (d < dMin) { dMin = d; meilleur = c; }
  }
  return dMin < 10 ? meilleur : null;          // a moins de 10 km
}
const numJour = w => Date.UTC(w.y, w.m - 1, w.d) / 86400e3;
async function grandPrix(maintenant, env) {
  const an = mural(maintenant).y;
  // Le GP reste affiche jusqu'a 3 h apres le depart de la course
  let gp = (await calendrierF1(an, env)).find(c => instantF1(c) + 3 * 3600e3 > maintenant);
  if (!gp) { try { gp = (await calendrierF1(an + 1, env))[0]; } catch (e) { /* pas encore publie */ } }
  if (!gp) return { erreur: 'Saison de F1 terminée' };
  const course = instantF1(gp);
  const sessions = SESSIONS_JOLPICA.filter(([k]) => gp[k]).map(([k, n]) => [instantF1(gp[k]), n, 3600e3]);
  sessions.push([course, 'Course', 2 * 3600e3]);
  sessions.sort((a, b) => a[0] - b[0]);
  const auj = numJour(mural(maintenant));
  const ecart = numJour(mural(sessions[0][0])) - auj;
  const ecartCourse = numJour(mural(course)) - auj;
  const quand = ecart > 1 ? 'Dans ' + ecart + ' jours' : ecart === 1 ? 'Demain' : ecartCourse > 0 ? 'Ce week-end' : maintenant < course ? "Aujourd'hui" : 'Terminé';
  const loc = (gp.Circuit && gp.Circuit.Location) || {};
  const c = circuitProche(parseFloat(loc.lat), parseFloat(loc.long));
  const wC = mural(course);
  return {
    gp: pourEcran(titreF1(gp.raceName || '')),
    manche: +gp.round || 0,
    circuit: pourEcran(c ? c.nom : (gp.Circuit || {}).circuitName),
    lieu: pourEcran(loc.locality || ''),
    quand,
    sessions: sessions.map(([t, n, duree]) => {
      const w = mural(t);
      return { j: JOURS_COURTS[w.js] + ' ' + w.d, h: w.hh + 'h' + deux(w.mi), n, f: t + duree < maintenant ? 1 : 0 };
    }),
    trace: c ? { l: c.l, h: c.h, p: c.p } : null,
    // Periodes pour les scenes : semaine (du lundi 0 h) et week-end (du jour de la 1re seance, 0 h)
    // jusqu'a 3 h apres le depart de la course
    periodes: {
      semaine: [versUTC({ y: wC.y, m: wC.m, d: wC.d - (wC.js + 6) % 7 }, TZ), course + 3 * 3600e3],
      weekend: [versUTC(Object.assign({}, mural(sessions[0][0]), { hh: 0, mi: 0, ss: 0 }), TZ), course + 3 * 3600e3],
    },
  };
}

// Prochaine occurrence de chaque anniversaire (evenement "journee entiere")
function anniversaires(liste, maintenant, fin) {
  const auj = mural(maintenant);
  const res = [];
  for (const a of liste) {
    for (const y of [auj.y, auj.y + 1]) {
      let j = a.j;
      const nbJ = new Date(Date.UTC(y, a.m, 0)).getUTCDate();
      if (j > nbJ) j = nbJ;                       // 29 fevrier -> 28 les autres annees
      const passe = a.m < auj.m || (a.m === auj.m && j < auj.d);
      if (y === auj.y && passe) continue;
      const debut = versUTC({ y, m: a.m, d: j }, TZ);
      if (debut < fin) {
        const age = a.a ? y - a.a : 0;
        res.push({ debut, journee: true, titre: 'Anniversaire de ' + a.nom + (age > 0 ? ' (' + age + ' ans)' : '') });
      }
      break;
    }
  }
  return res;
}

function lireDateICS(v, p) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(String(v).trim());
  if (!m) return null;
  const w = { y: +m[1], m: +m[2], d: +m[3], hh: +(m[4] || 0), mi: +(m[5] || 0), ss: +(m[6] || 0) };
  const journee = (p && p.VALUE === 'DATE') || m[4] === undefined;
  const tz = m[7] ? 'UTC' : (p && p.TZID ? fuseauValide(p.TZID) : TZ);
  return { w, journee, tz, utc: versUTC(w, tz) };
}
function lireDuree(v) {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(v).trim());
  if (!m) return 0;
  const s = ((+m[2] || 0) * 7 + (+m[3] || 0)) * 86400 + (+m[4] || 0) * 3600 + (+m[5] || 0) * 60 + (+m[6] || 0);
  return (m[1] === '-' ? -s : s) * 1000;
}
function analyserICS(texte) {
  const lignes = texte.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const evts = [];
  let e = null;
  for (const l of lignes) {
    if (l === 'BEGIN:VEVENT') { e = {}; continue; }
    if (l === 'END:VEVENT') { if (e) evts.push(e); e = null; continue; }
    if (!e) continue;
    const i = l.indexOf(':');
    if (i < 0) continue;
    const [nom, ...params] = l.slice(0, i).split(';');
    const p = {};
    for (const x of params) {
      const j = x.indexOf('=');
      if (j > 0) p[x.slice(0, j).toUpperCase()] = x.slice(j + 1).replace(/^"|"$/g, '');
    }
    const valeur = l.slice(i + 1);
    const N = nom.toUpperCase();
    if (N === 'EXDATE') (e.exdate = e.exdate || []).push(...valeur.split(',').map(v => ({ v, p })));
    else e[N] = { v: valeur, p };
  }
  return evts;
}

function evenementsICS(texte, debutFenetre, finFenetre) {
  const evts = analyserICS(texte);
  // Occurrences modifiees d'un evenement recurrent (RECURRENCE-ID)
  const surcharges = new Set();
  for (const e of evts) {
    if (e['RECURRENCE-ID'] && e.UID) {
      const d = lireDateICS(e['RECURRENCE-ID'].v, e['RECURRENCE-ID'].p);
      if (d) surcharges.add(e.UID.v + '|' + d.utc);
    }
  }
  const res = [];
  for (const e of evts) {
    if (!e.DTSTART) continue;
    if (e.STATUS && e.STATUS.v.toUpperCase() === 'CANCELLED') continue;
    const titre = e.SUMMARY ? e.SUMMARY.v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim() : '(sans titre)';
    const estSurcharge = !!e['RECURRENCE-ID'];
    for (const o of occurrences(e, debutFenetre, finFenetre)) {
      if (!estSurcharge && e.UID && surcharges.has(e.UID.v + '|' + o.debut)) continue;
      res.push({ debut: o.debut, journee: o.journee, titre });
    }
  }
  return res;
}

function occurrences(ev, debutFenetre, finFenetre) {
  const ds = lireDateICS(ev.DTSTART.v, ev.DTSTART.p);
  if (!ds) return [];
  let duree;
  if (ev.DTEND) {
    const de = lireDateICS(ev.DTEND.v, ev.DTEND.p);
    duree = de ? de.utc - ds.utc : 3600e3;
  } else if (ev.DURATION) duree = lireDuree(ev.DURATION.v);
  else duree = ds.journee ? 86400e3 : 0;

  const exclus = new Set();
  for (const x of ev.exdate || []) {
    const d = lireDateICS(x.v, x.p);
    if (d) exclus.add(d.utc);
  }
  const res = [];
  const ajouter = utc => {
    if (exclus.has(utc)) return;
    if (utc + Math.max(duree, 1) > debutFenetre && utc < finFenetre) res.push({ debut: utc, journee: ds.journee });
  };
  if (!ev.RRULE || ev['RECURRENCE-ID']) { ajouter(ds.utc); return res; }

  const r = {};
  for (const x of ev.RRULE.v.split(';')) {
    const j = x.indexOf('=');
    if (j > 0) r[x.slice(0, j).toUpperCase()] = x.slice(j + 1);
  }
  const freq = (r.FREQ || '').toUpperCase();
  const inter = Math.max(1, parseInt(r.INTERVAL || '1', 10));
  let compte = r.COUNT ? parseInt(r.COUNT, 10) : Infinity;
  let jusqua = Infinity;
  if (r.UNTIL) {
    const u = lireDateICS(r.UNTIL, {});
    if (u) jusqua = u.journee ? u.utc + 86400e3 - 1 : u.utc;
  }
  const NUM = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  const parJour = r.BYDAY ? r.BYDAY.split(',').map(s => NUM[s.trim().slice(-2).toUpperCase()]).filter(x => x !== undefined) : [];
  const J = 86400e3;
  const w0 = ds.w;
  const base = Date.UTC(w0.y, w0.m - 1, w0.d);
  const aUTC = dateMs => {
    const d = new Date(dateMs);
    return versUTC({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: w0.hh, mi: w0.mi, ss: w0.ss }, ds.tz);
  };

  for (let k = 0; k < 6000 && compte > 0; k++) {
    let dates = [];
    if (freq === 'DAILY') {
      const dm = base + k * inter * J;
      if (!parJour.length || parJour.includes(new Date(dm).getUTCDay())) dates = [dm];
    } else if (freq === 'WEEKLY') {
      if (parJour.length) {
        const lundi = base - ((new Date(base).getUTCDay() + 6) % 7) * J + k * inter * 7 * J;
        dates = parJour.map(j => lundi + ((j + 6) % 7) * J).sort((a, b) => a - b).filter(x => x >= base);
      } else dates = [base + k * inter * 7 * J];
    } else if (freq === 'MONTHLY') {
      const debutMois = new Date(Date.UTC(w0.y, w0.m - 1 + k * inter, 1));
      const nbJ = new Date(Date.UTC(debutMois.getUTCFullYear(), debutMois.getUTCMonth() + 1, 0)).getUTCDate();
      if (w0.d <= nbJ) dates = [Date.UTC(debutMois.getUTCFullYear(), debutMois.getUTCMonth(), w0.d)];
    } else if (freq === 'YEARLY') {
      const dm = Date.UTC(w0.y + k * inter, w0.m - 1, w0.d);
      if (new Date(dm).getUTCDate() === w0.d) dates = [dm];
    } else {
      ajouter(ds.utc);
      break;
    }
    let stop = false;
    for (const dm of dates) {
      const utc = aUTC(dm);
      if (utc > jusqua || compte <= 0 || utc >= finFenetre) { stop = true; break; }
      compte--;
      ajouter(utc);
    }
    if (stop) break;
  }
  return res;
}
