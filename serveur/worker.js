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
function grille(rotation) {
  const portrait = rotation === 1 || rotation === 3;
  const g = portrait ? { cols: 8, rangs: 12, L: HAUTEUR, H: LARGEUR } : { cols: 12, rangs: 8, L: LARGEUR, H: HAUTEUR };
  g.caseL = (g.L - 2 * MARGE + GOUTTIERE) / g.cols;
  g.caseH = (g.H - 2 * MARGE + GOUTTIERE) / g.rangs;
  return g;
}
function enPixels(d, g) {
  return {
    id: d.id,
    e: TAILLES[d.t] || 1,
    f: Math.max(0, POLICES.indexOf(d.p)),
    x: Math.round(MARGE + d.x * g.caseL), y: Math.round(MARGE + d.y * g.caseH),
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
      if (chemin === '/api/photo' && m === 'POST') return await routeEnvoyerPhoto(req, url, env);
      if (chemin === '/api/photo' && m === 'GET') return await routeBinaire(env, 'photo', 'application/octet-stream');
      if (chemin === '/api/pochette' && m === 'POST') return await routeEnvoyerPochette(req, url, env);
      if (chemin === '/api/pochette.jpg' && m === 'GET') return await routeBinaire(env, 'pochette', 'image/jpeg');
      if (chemin === '/api/apercu' && m === 'POST') return await routeEnvoyerApercu(req, url, env);
      if (chemin === '/api/apercu' && m === 'GET') return await routeLireApercu(env);
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
  const etat = {
    mode: cfg.mode,
    reveil: cfg.dev ? Math.max(10, cfg.devSecondes | 0) : Math.max(3, cfg.reveilMin) * 60,
    dev: cfg.dev ? 1 : 0,
  };
  let contenu;

  if (cfg.mode === 'tableau') {
    contenu = await construireTableau(cfg, maintenant, env);
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
    contenu = { p: cfg.photo.version };
    etat.rotation = cfg.photo.rotation || 0;       // orientation choisie a l'envoi de la photo
  } else if (cfg.mode === 'pochette') {
    const p = { titre: pourEcran(cfg.pochette.titre), artiste: pourEcran(cfg.pochette.artiste), album: pourEcran(cfg.pochette.album),
      rotation: cfg.affichage.rotation || 0 };
    contenu = Object.assign({ v: cfg.pochette.version }, p);
    Object.assign(etat, p);
    if (!cfg.dev) etat.reveil = reveilNuit(cfg, maintenant, etat.reveil);
  } else {
    contenu = { blanc: cfg.version };
  }
  // La signature change seulement quand le contenu a afficher change :
  // le cadre ne rafraichit l'ecran que dans ce cas.
  etat.sig = await empreinte(cfg.mode + JSON.stringify(contenu));
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
    const ancien = JSON.parse((await env.CADRE.get('statut')) || 'null');
    const nouveau = { vu: maintenant, bat: isNaN(bat) ? null : bat, mode: cfg.mode, r: etat.reveil, sc: etat.scene || null,
      fw: fwCarte || (ancien && ancien.fw) || null };
    const aEcrire = !ancien || maintenant - ancien.vu >= 10 * 60000 || ancien.mode !== nouveau.mode ||
      ancien.fw !== nouveau.fw || ancien.r !== nouveau.r || ancien.sc !== nouveau.sc || (nouveau.bat !== null && Math.abs((ancien.bat || 0) - nouveau.bat) >= 0.05);
    if (aEcrire) {
      try { await env.CADRE.put('statut', JSON.stringify(nouveau)); } catch (e) { /* limite atteinte : sans gravite */ }
    }
  }
  return json(etat);
}

async function routeLireConfig(env) {
  const cfg = await lireConfig(env);
  const statut = JSON.parse((await env.CADRE.get('statut')) || 'null');
  return json({ config: cfg, statut, maintenant: Date.now() });
}

async function routeEcrireConfig(req, env) {
  const modif = await req.json();
  const cfg = await lireConfig(env);
  delete modif.version; delete modif.photo; delete modif.pochette;
  if (modif.mode && !MODES.includes(modif.mode)) return texte('Mode inconnu', 400);
  if (modif.disposition !== undefined) modif.disposition = validerDisposition(modif.disposition, grille(0));
  if (modif.dispositionPortrait !== undefined) modif.dispositionPortrait = validerDisposition(modif.dispositionPortrait, grille(1));
  if (modif.scenes !== undefined) modif.scenes = validerScenes(modif.scenes);
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
  fusionner(cfg, modif);
  cfg.version++;
  await ecrireConfig(env, cfg);
  return json({ config: cfg, ignorees });
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
  if (donnees.byteLength !== OCTETS) return texte('La photo doit faire exactement ' + OCTETS + ' octets', 400);
  await env.CADRE.put('photo', donnees);
  const cfg = await lireConfig(env);
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
  await env.CADRE.put('apercu', donnees, { metadata: { t: Date.now(), r: ROTATIONS.includes(r) ? r : 0 } });
  return texte('ok');
}

async function routeLireApercu(env) {
  const { value, metadata } = await env.CADRE.getWithMetadata('apercu', 'arrayBuffer');
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
function validerScenes(liste) {
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
      disposition: validerDisposition(sc.disposition, grille(0)),
      dispositionPortrait: validerDisposition(sc.dispositionPortrait, grille(1)),
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
async function construireTableau(cfg, maintenant, env) {
  const w = mural(maintenant);
  const rotation = ROTATIONS.includes(cfg.affichage.rotation) ? cfg.affichage.rotation : 0;
  const g = grille(rotation);
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
  if (scenes.some(sc => sc.f1)) await chargerGP();
  // Scene affichee : la premiere active de la liste, sinon la disposition par defaut
  const active = scenes.find(sc => sceneActive(sc, maintenant, f1));
  const cle = rotation ? 'dispositionPortrait' : 'disposition';
  let dispo = validerDisposition(active ? active[cle] : cfg[cle], g);
  if (dispo.some(d => d.id === 'f1')) await chargerGP();
  const presents = new Set(dispo.map(d => d.id));
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
  if (presents.has('meteo') || presents.has('heures') || presents.has('jours') || presents.has('courbe')) {
    try {
      res.meteo = await meteo(Object.assign({}, cfg.meteo,
        { heures: presents.has('heures'), jours: presents.has('jours'), courbe: presents.has('courbe') }));
    } catch (e) {
      res.meteo = { erreur: 'Météo indisponible' };
    }
  }
  if (presents.has('agenda')) {
    if (!cfg.agenda.urls.length && !cfg.agenda.anniversaires.length) res.agenda = { erreur: 'Aucun calendrier configuré' };
    else {
      try { res.agenda = await agenda(cfg.agenda, maintenant); }
      catch (e) { res.agenda = { erreur: 'Agenda indisponible' }; }
    }
  }
  if (presents.has('bus')) {
    try {
      res.bus = await prochainsBus(cfg.bus, maintenant, env, true);
      // Les minutes restantes ne sont pas affichees : on les retire pour que la signature
      // ne change pas a chaque minute (sinon l'ecran clignoterait a chaque reveil)
      for (const p of res.bus.passages || []) delete p.m;
    }
    catch (e) { res.bus = { erreur: 'Bus indisponibles' }; }
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

async function meteo(o) {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + o.lat + '&longitude=' + o.lon +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,' +
    'wind_speed_10m,wind_direction_10m,wind_gusts_10m' +
    '&hourly=temperature_2m,weather_code,precipitation_probability,is_day' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max' +
    '&timezone=Europe%2FParis&forecast_days=8&wind_speed_unit=kmh';
  const r = await fetch(url, { cf: { cacheTtl: 600, cacheEverything: true } });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
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
async function agenda(o, maintenant) {
  const fin = maintenant + Math.max(1, o.joursMax || 14) * 86400e3;
  let tous = [];
  for (const brut of o.urls) {
    const url = brut.replace(/^webcal:\/\//i, 'https://');
    const r = await fetch(url, { cf: { cacheTtl: 900, cacheEverything: true } });
    if (!r.ok) throw new Error('Calendrier HTTP ' + r.status);
    tous = tous.concat(evenementsICS(await r.text(), maintenant, fin));
  }
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

// =====================================================================
//  Interface web (une seule page)
// =====================================================================
const INTERFACE = `<!doctype html>
<html lang="fr"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cadre</title>
<style>
:root{--fond:#f4f2ee;--carte:#fff;--texte:#1d1c1a;--doux:#6b6862;--trait:#dedbd4;--accent:#1d1c1a;--alerte:#b3261e}
@media (prefers-color-scheme:dark){:root{--fond:#171615;--carte:#22211f;--texte:#ecebe7;--doux:#a3a09a;--trait:#3a3835;--accent:#ecebe7;--alerte:#f2b8b5}}
*{box-sizing:border-box}
body{margin:0;background:var(--fond);color:var(--texte);font:16px/1.5 -apple-system,system-ui,sans-serif}
main{max-width:760px;margin:0 auto;padding:16px}
h1{font-size:22px;font-weight:600;margin:8px 0 16px}
h2{font-size:17px;font-weight:600;margin:0 0 12px}
section,details.menu{background:var(--carte);border:1px solid var(--trait);border-radius:14px;padding:16px;margin-bottom:14px}
details.menu{padding:0 16px}
details.menu>summary{list-style:none;cursor:pointer;font-size:17px;font-weight:600;padding:16px;margin:0 -16px;display:flex;justify-content:space-between;align-items:center;-webkit-user-select:none;user-select:none}
details.menu>summary::-webkit-details-marker{display:none}
details.menu>summary::after{content:'';width:9px;height:9px;border-right:2px solid var(--doux);border-bottom:2px solid var(--doux);transform:rotate(45deg);transition:transform .2s;margin:0 4px 4px 12px}
details.menu[open]>summary::after{transform:rotate(-135deg);margin-bottom:-4px}
details.menu[open]>summary{padding-bottom:8px}
details.menu[open]{padding-bottom:16px}
.outilsMenus{display:flex;justify-content:flex-end;gap:14px;margin:4px 2px 8px;font-size:14px}
.outilsMenus a{color:var(--doux)}
.ecran{width:100%;aspect-ratio:960/680;background:#fff;border:var(--bord,10px) solid #2a2927;border-radius:6px;display:block;image-rendering:auto;box-sizing:content-box;max-width:calc(100% - 2 * var(--bord,10px))}
.ecran.editeur{border-width:8px;max-width:calc(100% - 16px)}
.editeur{position:relative;touch-action:none;user-select:none;-webkit-user-select:none;overflow:hidden;margin-top:6px}
.editeur .case{position:absolute;border:1px dashed #dcd9d2;border-radius:3px;box-sizing:border-box}
.editeur .widget{position:absolute;background:#f3f2ef;border:2px solid #1d1c1a;border-radius:6px;color:#1d1c1a;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:2px;font-size:13px;line-height:1.2;text-align:center;cursor:grab;padding:4px 18px 4px 4px;box-sizing:border-box;overflow:hidden}
.editeur .widget.actif{background:#e6e3dc;cursor:grabbing;box-shadow:0 2px 10px rgba(0,0,0,.25);z-index:2}
.editeur .widget.refus{border-color:#b3261e}
.editeur .widget.choisi{box-shadow:inset 0 0 0 3px #2f6fd6;border-color:#2f6fd6}
.editeur .widget b{font-weight:600}
.editeur .widget small{color:#6b6862;font-size:11px}
.editeur .widget.bas{flex-direction:row;gap:8px}
.editeur .widget.bas small,.editeur .widget.etroit small{display:none}
.editeur .poignee{position:absolute;right:0;bottom:0;width:min(24px,60%);height:min(24px,60%);cursor:nwse-resize;background:linear-gradient(135deg,transparent 52%,#1d1c1a 52%);border-bottom-right-radius:3px}
.puces{display:flex;flex-wrap:wrap;gap:0 16px;margin-top:10px}
.statut{color:var(--doux);font-size:14px;margin-top:10px}
.modes{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
@media (min-width:560px){.modes{grid-template-columns:repeat(4,1fr)}}
button{font:inherit;border-radius:10px;border:1px solid var(--trait);background:var(--carte);color:var(--texte);padding:10px 12px;cursor:pointer}
button.actif{background:var(--accent);color:var(--fond);border-color:var(--accent)}
button.principal{background:var(--accent);color:var(--fond);border-color:var(--accent);width:100%;margin-top:12px}
button.danger{color:var(--alerte)}
label{display:flex;align-items:center;gap:8px;margin:6px 0}
input[type=text],input[type=password],input[type=time],textarea,select{font:inherit;width:100%;padding:9px 10px;border-radius:10px;border:1px solid var(--trait);background:var(--fond);color:var(--texte)}
textarea{min-height:80px;font-size:13px}
.ligne{display:flex;gap:8px;align-items:center}
.ligne>*{flex:1;min-width:0}
.ligne>button[style*="flex:0"]{flex:none!important}
.aide{color:var(--doux);font-size:14px;margin:6px 0 0}
.resultats div{padding:6px 8px;border-radius:8px;cursor:pointer}
.resultats div:hover{background:var(--fond)}
canvas.photo{width:100%;aspect-ratio:960/680;background:#fff;border:1px solid var(--trait);border-radius:6px;margin-top:10px}
code{font-size:13px;word-break:break-all;background:var(--fond);padding:2px 6px;border-radius:6px}
pre{font-size:12px;background:var(--fond);padding:10px;border-radius:8px;overflow:auto;max-height:260px}
#connexion{max-width:360px;margin:15vh auto}
.cache{display:none}
.msg{font-size:14px;margin-top:8px;min-height:1.2em}
</style>
</head><body><main>

<section id="connexion" class="cache">
  <h2>Cadre</h2>
  <p class="aide">Entre le mot de passe défini dans Cloudflare (variable CLE).</p>
  <input type="password" id="champCle" placeholder="Mot de passe">
  <button class="principal" onclick="seConnecter()">Se connecter</button>
  <div class="msg" id="msgCle"></div>
</section>

<div id="app" class="cache">
<h1>Cadre</h1>

<section>
  <h2>Aperçu de l'écran</h2>
  <canvas id="apercu" class="ecran" width="960" height="680"></canvas>
  <div class="statut" id="statut">Chargement…</div>
  <label style="margin-top:10px">Contour de l'aperçu <input type="range" id="bordure" min="0" max="40" value="10" style="flex:1"></label>
</section>

<section>
  <h2>Affichage</h2>
  <div class="modes">
    <button data-mode="tableau" onclick="changerMode('tableau')">Tableau de bord</button>
    <button data-mode="photo" onclick="changerMode('photo')">Photo</button>
    <button data-mode="pochette" onclick="changerMode('pochette')">Pochette</button>
    <button data-mode="blanc" class="danger" onclick="ecranBlanc()">Écran blanc</button>
  </div>
  <p class="aide" id="aideMode"></p>
</section>

<div class="outilsMenus"><a href="#" onclick="toutesLesSections(true);return false">Tout ouvrir</a><a href="#" onclick="toutesLesSections(false);return false">Tout fermer</a></div>

<details class="menu" id="menu-dispo">
  <summary>Scènes et disposition</summary>
  <p class="aide">Une scène est une disposition des blocs, affichée pendant une période que tu choisis (par exemple « Bus » le vendredi de 18:00 à 20:00, ou « Grand Prix » la semaine d'une course). En dehors de toute scène, c'est la scène <b>Par défaut</b> qui s'affiche.</p>
  <div class="puces" id="listeScenes" style="margin:8px 0"></div>
  <div id="reglagesScene" class="cache" style="padding:10px 12px;border:1px solid var(--trait);border-radius:10px;margin-bottom:10px">
    <label>Nom <input type="text" id="sceneNom" maxlength="40"></label>
    <p class="aide" style="margin:8px 0 2px"><b>Quand l'afficher</b> (toutes les conditions remplies doivent l'être) :</p>
    <div id="sceneCreneaux"></div>
    <button style="margin-top:6px" onclick="ajouterCreneau(null, 'sceneCreneaux')">+ Ajouter un créneau</button>
    <p class="aide" style="margin:10px 0 2px">Formule 1 :</p>
    <select id="sceneF1"><option value="">peu importe</option><option value="semaine">la semaine d'un Grand Prix</option><option value="weekend">le week-end d'un Grand Prix</option></select>
    <label>Du <input type="date" id="sceneDu" style="width:auto;flex:1;min-width:0"> au <input type="date" id="sceneAu" style="width:auto;flex:1;min-width:0"></label>
    <label>Mise à jour toutes les
      <select id="sceneReveil" style="width:auto"><option value="0">(rythme normal)</option><option>3</option><option>5</option><option>10</option><option>15</option><option>30</option><option>60</option></select> min</label>
    <p class="aide" id="sceneResume"></p>
    <div class="ligne" style="margin-top:6px">
      <button onclick="monterScene()">Plus prioritaire</button>
      <button onclick="copierDefaut()">Copier « Par défaut »</button>
      <button class="danger" onclick="supprimerScene()">Supprimer</button>
    </div>
  </div>
  <p class="aide" id="aideDefaut">Scène affichée quand aucune autre n'est active. Son rythme se règle dans « Réveil du cadre ».</p>
  <p class="aide">Fais glisser un bloc pour le déplacer, tire son coin en bas à droite pour l'agrandir. Les blocs ne peuvent pas se chevaucher ; le contenu s'adapte à leur taille.</p>
  <div class="modes" style="grid-template-columns:repeat(3,1fr);margin-bottom:6px">
    <button data-rot="0" onclick="choisirRotation(0)">Paysage</button>
    <button data-rot="1" onclick="choisirRotation(1)">Portrait</button>
    <button data-rot="3" onclick="choisirRotation(3)">Portrait inversé</button>
  </div>
  <p class="aide">Les deux portraits correspondent aux deux sens possibles du cadre accroché en hauteur : choisis celui qui affiche l'image à l'endroit. Chaque orientation garde sa propre disposition.</p>
  <p style="margin:10px 0 4px;font-weight:600" id="titreEditeur"></p>
  <div id="editeur" class="ecran editeur"></div>
  <p class="aide">Touche un bloc (sans le déplacer) pour régler la taille et la police de son texte.</p>
  <div id="styleBloc" class="cache" style="margin-top:8px;padding:10px 12px;border:1px solid var(--trait);border-radius:10px">
    <p style="margin:0 0 4px;font-weight:600" id="styleTitre"></p>
    <div class="ligne" style="flex-wrap:wrap">
      <label>Taille <select id="styleTaille" style="width:auto"><option value="S">Petite</option><option value="M">Normale</option><option value="L">Grande</option><option value="XL">Très grande</option></select></label>
      <label>Police <select id="stylePolice" style="width:auto"><option value="moderne">Moderne</option><option value="helvetica">Helvetica</option><option value="classique">Classique</option><option value="machine">Machine à écrire</option></select></label>
    </div>
    <p class="aide">Helvetica, Classique et Machine à écrire n'existent qu'en tailles moyennes : pour les très grands textes (date, température), Moderne reste plus grand. La température garde toujours ses chiffres hauts et fins.</p>
  </div>
  <div class="puces" id="choixWidgets"></div>
  <label><input type="checkbox" id="traits"> Traits de séparation entre les blocs</label>
  <div class="ligne" style="margin-top:6px">
    <button onclick="reinitialiserDispo()">Disposition par défaut</button>
    <button class="principal" style="margin-top:0" onclick="enregistrerDispo()">Enregistrer</button>
  </div>
  <div class="msg" id="msgDispo"></div>
</details>

<details class="menu" id="menu-meteo">
  <summary>Météo</summary>
  <div class="ligne"><input type="text" id="ville" placeholder="Rechercher une ville"><button style="flex:0" onclick="chercherVille()">Chercher</button></div>
  <div class="resultats" id="resultatsVille"></div>
  <p class="aide" id="villeChoisie"></p>
  <label><input type="checkbox" id="mVent"> Vent et rafales</label>
  <label><input type="checkbox" id="mDetails"> Ressenti, humidité, risque de pluie</label>
  <label><input type="checkbox" id="mSoleil"> Lever et coucher du soleil</label>
  <label>Prochaines heures :
    <select id="mNbHeures" style="width:auto"><option>4</option><option>5</option><option>6</option><option>8</option><option>10</option><option>12</option></select>
    colonnes, une toutes les
    <select id="mPas" style="width:auto"><option>1</option><option>2</option><option>3</option><option>4</option></select> h</label>
  <label>Prochains jours : jusqu'à
    <select id="mNbJours" style="width:auto"><option>3</option><option>4</option><option>5</option><option>6</option></select> jours</label>
  <p class="aide">Le nombre de colonnes réellement affichées dépend de la largeur du bloc.</p>
  <label>Graphique de température sur les
    <select id="mCourbe" style="width:auto"><option>12</option><option>24</option><option>36</option><option>48</option></select> prochaines heures</label>
  <p class="aide">Le graphique montre la température heure par heure, le risque de pluie (barres hachurées) et la nuit (fond grisé). Ajoute le bloc « Graphique de température » dans la Disposition.</p>
  <button class="principal" onclick="enregistrerMeteo()">Enregistrer la météo</button>
  <div class="msg" id="msgMeteo"></div>
</details>

<details class="menu" id="menu-agenda">
  <summary>Agenda</summary>
  <p class="aide">Liens de calendriers publics iCloud, un par ligne (ils commencent par webcal://).</p>
  <textarea id="aUrls" placeholder="webcal://p00-caldav.icloud.com/published/2/..."></textarea>
  <p class="aide">Anniversaires, un par ligne : prénom puis date (l'année est facultative, elle sert à afficher l'âge).</p>
  <textarea id="aAnniv" placeholder="Léa 14/03/2005&#10;Mamie 02/11"></textarea>
  <label>Nombre maximum d'événements
    <select id="aNb" style="width:auto"><option>3</option><option>4</option><option>5</option><option>6</option><option>8</option><option>10</option><option>12</option></select></label>
  <p class="aide">Le cadre en affiche autant que la hauteur du bloc Agenda le permet.</p>
  <button class="principal" onclick="enregistrerAgenda()">Enregistrer l'agenda</button>
  <button style="width:100%;margin-top:8px" onclick="tester()">Voir les données envoyées au cadre</button>
  <div class="msg" id="msgAgenda"></div>
  <pre id="donnees" class="cache"></pre>
</details>

<details class="menu" id="menu-bus">
  <summary>Prochains bus (Tango)</summary>
  <p class="aide" id="busEtat"></p>
  <button style="width:100%" onclick="chargerGTFS()">Choisir mes arrêts (charge les horaires Tango)</button>
  <div id="busChoix" class="cache" style="margin-top:8px">
    <input type="text" id="busRecherche" placeholder="Nom de l'arrêt, par ex. Gare Feuchères" oninput="chercherArret()">
    <div class="resultats" id="busResultats"></div>
    <p class="aide">Arrêts choisis (2 au maximum) :</p>
    <div id="busArrets" class="puces"></div>
    <button class="principal" onclick="construireIndexBus()">Utiliser ces arrêts</button>
  </div>
  <p class="aide" style="margin-top:12px">Lignes et sens affichés :</p>
  <div id="busLignes" class="puces"></div>
  <label style="flex-wrap:wrap">Afficher
    <select id="busNb" style="width:auto"><option>2</option><option>3</option><option>4</option><option>5</option><option>6</option><option>8</option></select>
    passages, sur les
    <select id="busHorizon" style="width:auto"><option>30</option><option>60</option><option>90</option><option>120</option><option>180</option></select>
    prochaines minutes</label>
  <p class="aide">Le bloc « Prochains bus » s'affiche dans les scènes où tu le places (section « Scènes et disposition ») : crée par exemple une scène « Bus » pour les heures où tu prends le bus, avec une mise à jour toutes les 3 min.</p>
  <details style="margin-top:6px"><summary class="aide">Réglage avancé</summary>
    <label>Source du temps réel (laisser vide pour la source par défaut)</label>
    <input type="text" id="busSource" placeholder="https://…">
  </details>
  <button class="principal" onclick="enregistrerBus()">Enregistrer</button>
  <button style="width:100%;margin-top:8px" onclick="testerBus()">Voir les prochains passages maintenant</button>
  <div class="msg" id="msgBus"></div>
  <pre id="busTest" class="cache"></pre>
</details>

<details class="menu" id="menu-photo">
  <summary>Photo plein écran</summary>
  <input type="file" id="fichier" accept="image/*">
  <div class="ligne" style="margin-top:8px">
    <label><input type="radio" name="cadrage" value="remplir" checked> Remplir</label>
    <label><input type="radio" name="cadrage" value="ajuster"> Image entière</label>
  </div>
  <label>Luminosité <input type="range" id="lum" min="-80" max="80" value="0"></label>
  <label>Contraste <input type="range" id="contraste" min="50" max="200" value="110"></label>
  <canvas class="photo" id="photoTramee" width="960" height="680"></canvas>
  <button class="principal" onclick="envoyerPhoto()">Envoyer au cadre</button>
  <div class="msg" id="msgPhoto"></div>
</details>

<details class="menu" id="menu-pochette">
  <summary>Pochette Apple Music</summary>
  <p class="aide" id="pochetteActuelle">Aucune pochette reçue pour l'instant.</p>
  <p class="aide">Adresse à mettre dans le raccourci iPhone :</p>
  <p><code id="urlPochette"></code></p>
</details>

<details class="menu" id="menu-reveil">
  <summary>Réveil du cadre</summary>
  <label>En temps normal, le cadre vérifie s'il y a du nouveau toutes les
    <select id="reveil" style="width:auto"><option>5</option><option>10</option><option>15</option><option>30</option><option>60</option></select> min</label>
  <p class="aide">Plus c'est court, plus le cadre réagit vite, mais plus la batterie se vide.</p>
  <label style="margin-top:12px"><input type="checkbox" id="dev"> Mode développement : la carte ne se met plus en veille et vérifie toutes les
    <select id="devSecondes" style="width:auto"><option>15</option><option>30</option><option>60</option></select> s</label>
  <p class="aide">Le téléversement depuis l'IDE Arduino marche alors sans le bouton BOOT. À utiliser carte branchée en USB : sur batterie, elle se viderait en un jour. L'écran garde au moins 3 minutes entre deux rafraîchissements, mais l'aperçu ci-dessus se met à jour à chaque cycle. Pense à le désactiver une fois fini.</p>
  <label style="margin-top:12px"><input type="checkbox" id="nuitActif"> Mode nuit</label>
  <label>De <input type="time" id="nuitDebut" style="width:auto"> à <input type="time" id="nuitFin" style="width:auto"></label>
  <label>Réveil toutes les <select id="nuitIntervalle" style="width:auto"><option>30</option><option>60</option><option>120</option></select> min</label>
  <p class="aide">La nuit, le cadre se réveille moins souvent pour économiser la batterie. Il se réveille tout seul à la fin de la nuit, et reste à l'heure pour les créneaux de bus.</p>
  <button class="principal" onclick="enregistrerReveil()">Enregistrer</button>
  <div class="msg" id="msgReveil"></div>
</details>

<details class="menu" id="menu-programme">
  <summary>Programme de la carte</summary>
  <p class="aide" id="fwInfo">Version installée : inconnue.</p>
  <input type="file" id="fichierFw" accept=".bin">
  <button class="principal" onclick="envoyerFirmware()">Envoyer le programme</button>
  <div class="msg" id="msgFw"></div>
  <p class="aide">Pour mettre la carte à jour sans câble : dans l'IDE Arduino, <b>Croquis → Exporter les binaires compilés</b>, puis choisis ici le fichier <code>cadre_eink.ino.bin</code> (dans le dossier <code>build</code> du croquis, pas le « merged »). La carte l'installe à son prochain réveil, si sa batterie est assez chargée, puis redémarre. Un programme plus ancien que celui de la carte est ignoré.</p>
</details>

<p class="aide" style="text-align:center"><a href="#" onclick="deconnexion()" style="color:var(--doux)">Se déconnecter</a></p>
</div>
</main>

<script>
var LARG = 960, HAUT = 680, OCTETS = 81600;
var cle = '';
var config = null;
var image = null;
try { cle = localStorage.getItem('cadre-cle') || ''; } catch (e) {}

function $(id) { return document.getElementById(id); }
function api(chemin, options) {
  options = options || {};
  options.headers = options.headers || {};
  options.headers['X-Cle'] = cle;
  return fetch(chemin, options).then(function (r) {
    if (r.status === 401) { afficherConnexion('Mot de passe incorrect'); throw new Error('cle'); }
    if (!r.ok) return r.text().then(function (t) { throw new Error(t); });
    return r;
  });
}
function message(id, t) { $(id).textContent = t; if (t) setTimeout(function () { $(id).textContent = ''; }, 6000); }

function afficherConnexion(t) { $('app').classList.add('cache'); $('connexion').classList.remove('cache'); $('msgCle').textContent = t || ''; }
function seConnecter() { cle = $('champCle').value.trim(); try { localStorage.setItem('cadre-cle', cle); } catch (e) {} demarrer(); }
function deconnexion() { try { localStorage.removeItem('cadre-cle'); } catch (e) {} cle = ''; afficherConnexion(''); return false; }

function demarrer() {
  if (!cle) { afficherConnexion(''); return; }
  charger().then(function () {
    $('connexion').classList.add('cache'); $('app').classList.remove('cache');
  }).catch(function () {});
}

// Met a jour l'etat et l'apercu sans toucher aux formulaires en cours d'edition
function rafraichir() {
  return api('/api/config').then(function (r) { return r.json(); }).then(function (d) {
    config = d.config;
    afficherStatut(d.statut, d.maintenant);
    chargerApercu();
  });
}

// --- Contour de l'apercu ---
function appliquerBordure() { document.documentElement.style.setProperty('--bord', $('bordure').value + 'px'); }
$('bordure').oninput = appliquerBordure;
$('bordure').onchange = function () {
  api('/api/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ affichage: { bordureApercu: +$('bordure').value } }) })
    .then(function (r) { return r.json(); }).then(function (d) { config = d.config; }).catch(function () {});
};

// --- Editeur de disposition (meme grille que le serveur) ---
var MARGE = 24, GOUT = 16;
// Grille selon l'orientation : 12 x 8 cases en paysage, 8 x 12 en portrait
function grilleUI(r) {
  var portrait = r === 1 || r === 3;
  var g = portrait ? { cols: 8, rangs: 12, L: HAUT, H: LARG } : { cols: 12, rangs: 8, L: LARG, H: HAUT };
  g.cl = (g.L - 2 * MARGE + GOUT) / g.cols; g.ch = (g.H - 2 * MARGE + GOUT) / g.rangs;
  return g;
}
var rot = 0, G = grilleUI(0);
var INFOS = {
  date: { nom: 'Date et batterie', ex: 'Vendredi 23 octobre', min: [3, 1] },
  meteo: { nom: 'Météo actuelle', ex: '17 °C, partiellement nuageux', min: [4, 2] },
  heures: { nom: 'Prochaines heures', ex: '22h · 1h · 4h · 7h…', min: [4, 2] },
  jours: { nom: 'Prochains jours', ex: 'Sam · Dim · Lun…', min: [3, 2] },
  agenda: { nom: 'Agenda', ex: 'Demain 18:30 Colle…', min: [3, 1] },
  bus: { nom: 'Prochains bus', ex: 'Ligne 4 → Gare  12:42', min: [3, 2] },
  courbe: { nom: 'Graphique de température', ex: 'Courbe des prochaines 24 h', min: [4, 2] },
  f1: { nom: 'Grand Prix de F1', ex: 'Tracé du circuit et horaires', min: [3, 2] }
};
var DISPO_DEFAUT = {
  0: [ { id: 'date', x: 0, y: 0, w: 12, h: 1 }, { id: 'meteo', x: 0, y: 1, w: 12, h: 2 },
       { id: 'heures', x: 0, y: 3, w: 12, h: 2 }, { id: 'jours', x: 0, y: 5, w: 5, h: 3 },
       { id: 'agenda', x: 5, y: 5, w: 7, h: 3 } ],
  1: [ { id: 'date', x: 0, y: 0, w: 8, h: 1 }, { id: 'meteo', x: 0, y: 1, w: 8, h: 2 },
       { id: 'heures', x: 0, y: 3, w: 8, h: 2 }, { id: 'jours', x: 0, y: 5, w: 8, h: 2 },
       { id: 'agenda', x: 0, y: 7, w: 8, h: 5 } ]
};
// Dispositions de la scene "Par defaut" : '0' paysage, '1' portrait ; les autres scenes ont les leurs
var dispos = { '0': [], '1': [] };
var scenes = [];
var sceneCourante = -1;               // -1 = Par defaut
function cleDispo() { return cleOri(rot) ? 'dispositionPortrait' : 'disposition'; }
function ranger() {                   // range la disposition en cours d'edition a sa place
  if (sceneCourante < 0) dispos[cleOri(rot)] = dispo; else scenes[sceneCourante][cleDispo()] = dispo;
}
function dispoCourante() { return sceneCourante < 0 ? dispos[cleOri(rot)] : (scenes[sceneCourante][cleDispo()] || []); }
var NOMS_J = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
function resumeScene(sc) {
  var t = [];
  (sc.creneaux || []).forEach(function (c) {
    var j = NOMS_J.filter(function (x, i) { return c.jours[i]; }).join(', ');
    t.push(j + ' de ' + c.debut + ' à ' + c.fin);
  });
  if (sc.f1) t.push(sc.f1 === 'semaine' ? "la semaine d'un Grand Prix" : "le week-end d'un Grand Prix");
  if (sc.du || sc.au) t.push((sc.du ? 'du ' + sc.du.split('-').reverse().join('/') : '') + (sc.au ? ' au ' + sc.au.split('-').reverse().join('/') : ''));
  var r = t.length ? 'Affichée : ' + t.join(' ; ') + '.' : 'Aucune condition : cette scène est affichée tout le temps (et remplace « Par défaut »).';
  r += sc.reveilMin ? ' Mise à jour toutes les ' + sc.reveilMin + ' min.' : ' Rythme de mise à jour normal.';
  return r;
}
function lireFormScene() {
  if (sceneCourante < 0) return;
  var sc = scenes[sceneCourante];
  sc.nom = $('sceneNom').value.trim() || sc.nom;
  sc.creneaux = lireCreneaux('sceneCreneaux');
  sc.f1 = $('sceneF1').value; sc.du = $('sceneDu').value; sc.au = $('sceneAu').value;
  sc.reveilMin = +$('sceneReveil').value;
}
var dernierStatut = null;
function dessinerPuces() {
  var z = $('listeScenes'); z.innerHTML = '';
  var affichee = (dernierStatut && dernierStatut.sc) || '';
  var ajouter = function (nom, i) {
    var b = document.createElement('button');
    b.textContent = nom + (nom === affichee ? ' •' : '');
    b.title = nom === affichee ? 'Scène affichée en ce moment' : '';
    b.classList.toggle('actif', i === sceneCourante);
    b.onclick = function () { choisirScene(i); };
    z.appendChild(b);
  };
  ajouter('Par défaut', -1);
  scenes.forEach(function (sc, i) { ajouter(sc.nom, i); });
  var plus = document.createElement('button');
  plus.textContent = '+ Nouvelle scène';
  plus.onclick = nouvelleScene;
  if (scenes.length < 8) z.appendChild(plus);
}
function afficherScenes() {
  dessinerPuces();
  $('titreEditeur').textContent = 'Blocs de la scène « ' + (sceneCourante < 0 ? 'Par défaut' : scenes[sceneCourante].nom) + ' »';
  $('reglagesScene').classList.toggle('cache', sceneCourante < 0);
  $('aideDefaut').classList.toggle('cache', sceneCourante >= 0);
  if (sceneCourante >= 0) {
    var sc = scenes[sceneCourante];
    $('sceneNom').value = sc.nom;
    $('sceneCreneaux').innerHTML = '';
    (sc.creneaux || []).forEach(function (c) { ajouterCreneau(c, 'sceneCreneaux'); });
    $('sceneF1').value = sc.f1 || ''; $('sceneDu').value = sc.du || ''; $('sceneAu').value = sc.au || '';
    $('sceneReveil').value = String(sc.reveilMin || 0);
    $('sceneResume').textContent = resumeScene(sc);
  }
}
// Le resume et le nom se mettent a jour pendant la saisie
$('reglagesScene').addEventListener('change', function () { lireFormScene(); if (sceneCourante >= 0) $('sceneResume').textContent = resumeScene(scenes[sceneCourante]); });
$('sceneNom').addEventListener('input', function () { if (sceneCourante >= 0 && this.value.trim()) { scenes[sceneCourante].nom = this.value.trim(); dessinerPuces();
  $('titreEditeur').textContent = 'Blocs de la scène « ' + scenes[sceneCourante].nom + ' »'; } });
function choisirScene(i) {
  lireFormScene(); ranger();
  sceneCourante = i;
  afficherScenes();
  appliquerRotation(rot);
}
function nouvelleScene() {
  lireFormScene(); ranger();
  scenes.push({ id: 's' + Date.now().toString(36), nom: 'Scène ' + (scenes.length + 1),
    creneaux: [{ jours: [1, 1, 1, 1, 1, 0, 0], debut: '07:00', fin: '08:00' }], f1: '', du: '', au: '', reveilMin: 0,
    disposition: copie(dispos['0']), dispositionPortrait: copie(dispos['1']) });
  sceneCourante = scenes.length - 1;
  afficherScenes(); appliquerRotation(rot);
  message('msgDispo', 'Scène créée à partir de « Par défaut » : choisis sa période et ses blocs, puis enregistre.');
}
function supprimerScene() {
  if (sceneCourante < 0) return;
  var nom = scenes[sceneCourante].nom;
  scenes.splice(sceneCourante, 1);
  sceneCourante = -1;
  afficherScenes(); appliquerRotation(rot);
  message('msgDispo', 'Scène « ' + nom + ' » supprimée : enregistre pour confirmer (ou recharge la page pour annuler).');
}
function monterScene() {
  if (sceneCourante <= 0) { message('msgDispo', 'Cette scène est déjà la plus prioritaire.'); return; }
  lireFormScene(); ranger();
  var sc = scenes.splice(sceneCourante, 1)[0];
  scenes.splice(sceneCourante - 1, 0, sc);
  sceneCourante--;
  afficherScenes();
  message('msgDispo', "Si plusieurs scènes sont actives en même temps, celle de gauche l'emporte.");
}
function copierDefaut() {
  dispo = copie(dispos[cleOri(rot)]);
  ranger(); dessinerEditeur();
  message('msgDispo', 'Disposition « Par défaut » copiée dans cette scène (orientation actuelle).');
}
var dispo = [];
var choisi = null;                    // bloc selectionne pour regler son texte
var NOMS_TAILLES = { S: 'Petite', M: 'Normale', L: 'Grande', XL: 'Très grande' };
var NOMS_POLICES = { moderne: 'Moderne', helvetica: 'Helvetica', classique: 'Classique', machine: 'Machine à écrire' };
function descStyle(d) {
  var t = [];
  if (d.t && d.t !== 'M') t.push(NOMS_TAILLES[d.t]);
  if (d.p && d.p !== 'moderne') t.push(NOMS_POLICES[d.p]);
  return t.join(' · ');
}
function selectionner(id) {
  choisi = id;
  var d = dispo.filter(function (x) { return x.id === id; })[0];
  if (!d) { choisi = null; $('styleBloc').classList.add('cache'); dessinerEditeur(); return; }
  $('styleTitre').textContent = 'Texte du bloc « ' + INFOS[id].nom + ' »';
  $('styleTaille').value = d.t || 'M';
  $('stylePolice').value = d.p || 'moderne';
  $('styleBloc').classList.remove('cache');
  dessinerEditeur();
}
function changerStyle() {
  var d = dispo.filter(function (x) { return x.id === choisi; })[0];
  if (!d) return;
  d.t = $('styleTaille').value; d.p = $('stylePolice').value;
  if (d.t === 'M') delete d.t;
  if (d.p === 'moderne') delete d.p;
  dessinerEditeur();
}
$('styleTaille').onchange = changerStyle;
$('stylePolice').onchange = changerStyle;
function cleOri(r) { return (r === 1 || r === 3) ? 1 : 0; }
function copie(o) { return JSON.parse(JSON.stringify(o)); }
function pct(v, total) { return (v / total * 100) + '%'; }
function placer(el, d) {
  el.style.left = pct(MARGE + d.x * G.cl, G.L); el.style.top = pct(MARGE + d.y * G.ch, G.H);
  el.style.width = pct(d.w * G.cl - GOUT, G.L); el.style.height = pct(d.h * G.ch - GOUT, G.H);
}
function etiquette(el, d) {
  el.classList.toggle('bas', d.h < 2);
  el.classList.toggle('etroit', d.w < 4);
}
function chevauche(a, b) { return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h; }
function libre(d, sauf) {
  if (d.x < 0 || d.y < 0 || d.x + d.w > G.cols || d.y + d.h > G.rangs) return false;
  for (var i = 0; i < dispo.length; i++) if (dispo[i].id !== sauf && chevauche(d, dispo[i])) return false;
  return true;
}
function borner(v, a, b) { return Math.max(a, Math.min(b, v)); }
// Donne au canvas/element la forme de l'ecran (paysage ou portrait)
function formeEcran(el, r) {
  var portrait = cleOri(r) === 1;
  el.style.aspectRatio = portrait ? '680 / 960' : '960 / 680';
  el.style.width = portrait ? 'min(calc(100% - 2 * var(--bord, 10px)), 420px)' : '';
  el.style.margin = portrait ? '6px auto 0' : '';
}
function remplirDispo() {
  dispos['0'] = copie(config.disposition || []);
  dispos['1'] = copie(config.dispositionPortrait || []);
  scenes = copie(config.scenes || []);
  if (sceneCourante >= scenes.length) sceneCourante = -1;
  afficherScenes();
  $('traits').checked = !!config.affichage.traits;
  appliquerRotation(config.affichage.rotation || 0);
}
function appliquerRotation(r) {
  rot = r; G = grilleUI(r); dispo = dispoCourante();
  choisi = null; $('styleBloc').classList.add('cache');
  var b = document.querySelectorAll('[data-rot]');
  for (var i = 0; i < b.length; i++) b[i].classList.toggle('actif', +b[i].getAttribute('data-rot') === r);
  formeEcran($('editeur'), r);
  dessinerEditeur();
}
function choisirRotation(r) { ranger(); appliquerRotation(r); }
function dessinerEditeur() {
  var ed = $('editeur');
  ed.innerHTML = '';
  for (var y = 0; y < G.rangs; y++) for (var x = 0; x < G.cols; x++) {
    var c = document.createElement('div'); c.className = 'case';
    placer(c, { x: x, y: y, w: 1, h: 1 }); ed.appendChild(c);
  }
  dispo.forEach(function (d) {
    var el = document.createElement('div');
    el.className = 'widget' + (d.id === choisi ? ' choisi' : '');
    el.innerHTML = '<b></b><small></small><div class="poignee"></div>';
    el.querySelector('b').textContent = INFOS[d.id].nom;
    el.querySelector('small').textContent = descStyle(d) || INFOS[d.id].ex;
    placer(el, d);
    etiquette(el, d);
    ed.appendChild(el);
    brancher(el, d);
  });
  var zone = $('choixWidgets');
  zone.innerHTML = '';
  Object.keys(INFOS).forEach(function (id) {
    var l = document.createElement('label'), cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = dispo.some(function (d) { return d.id === id; });
    cb.onchange = function () { basculer(id, cb.checked); };
    l.appendChild(cb); l.appendChild(document.createTextNode(INFOS[id].nom));
    zone.appendChild(l);
  });
}
function brancher(el, d) {
  var depart = null;
  el.addEventListener('pointerdown', function (ev) {
    ev.preventDefault();
    var r = $('editeur').getBoundingClientRect();
    depart = { px: ev.clientX, py: ev.clientY, d: copie(d), redim: ev.target.classList.contains('poignee'),
      cl: r.width * G.cl / G.L, ch: r.height * G.ch / G.H, bouge: false };
    el.setPointerCapture(ev.pointerId);
    el.classList.add('actif');
  });
  el.addEventListener('pointermove', function (ev) {
    if (!depart) return;
    var dx = Math.round((ev.clientX - depart.px) / depart.cl), dy = Math.round((ev.clientY - depart.py) / depart.ch);
    if (dx || dy) depart.bouge = true;
    var e = copie(depart.d), min = INFOS[d.id].min;
    if (depart.redim) {
      e.w = borner(depart.d.w + dx, min[0], G.cols - e.x);
      e.h = borner(depart.d.h + dy, min[1], G.rangs - e.y);
    } else {
      e.x = borner(depart.d.x + dx, 0, G.cols - e.w);
      e.y = borner(depart.d.y + dy, 0, G.rangs - e.h);
    }
    if (libre(e, d.id)) { d.x = e.x; d.y = e.y; d.w = e.w; d.h = e.h; placer(el, d); etiquette(el, d); el.classList.remove('refus'); }
    else el.classList.add('refus');
  });
  function fin() { depart = null; el.classList.remove('actif'); el.classList.remove('refus'); }
  el.addEventListener('pointerup', function () {
    var simpleClic = depart && !depart.bouge && !depart.redim;
    fin();
    if (simpleClic) selectionner(d.id);
  });
  el.addEventListener('pointercancel', fin);
}
function basculer(id, actif) {
  if (actif) {
    var min = INFOS[id].min, place = null;
    for (var y = 0; y <= G.rangs - min[1] && !place; y++)
      for (var x = 0; x <= G.cols - min[0] && !place; x++) {
        var e = { id: id, x: x, y: y, w: min[0], h: min[1] };
        if (libre(e, id)) place = e;
      }
    if (!place) { message('msgDispo', "Pas assez de place : réduis ou retire d'abord un autre bloc."); }
    else dispo.push(place);
  } else {
    dispo = dispo.filter(function (d) { return d.id !== id; });
    if (choisi === id) { choisi = null; $('styleBloc').classList.add('cache'); }
  }
  ranger();
  dessinerEditeur();
}
function reinitialiserDispo() {
  dispo = copie(DISPO_DEFAUT[cleOri(rot)]);
  ranger();
  $('traits').checked = true;
  dessinerEditeur();
  message('msgDispo', 'Disposition par défaut rétablie : pense à enregistrer.');
}
function enregistrerDispo() {
  lireFormScene(); ranger();
  var avant = scenes.map(function (sc) { return (sc.creneaux || []).length; });
  enregistrer({ disposition: dispos['0'], dispositionPortrait: dispos['1'], scenes: scenes,
    affichage: { traits: $('traits').checked, rotation: rot } }, 'msgDispo')
    .then(function () {
      var perdu = (config.scenes || []).some(function (sc, i) { return sc.creneaux.length < avant[i]; });
      if (perdu) message('msgDispo', 'Enregistré, mais un créneau a été ignoré : coche au moins un jour et mets une fin après le début.');
    });
}

// --- Conversion entre l'image "physique" de l'ecran (960 x 680) et l'image "a l'endroit" ---
// (memes formules que la rotation de la bibliotheque Adafruit GFX sur la carte)
function lireBit(b, i) { return (b[i >> 3] >> (7 - (i & 7))) & 1; }
function physVersLog(phys, r) {
  if (!r) return { bits: phys, w: LARG, h: HAUT };
  var log = new Uint8Array(OCTETS), w = HAUT, h = LARG;
  for (var py = 0; py < HAUT; py++) for (var px = 0; px < LARG; px++) {
    if (!lireBit(phys, py * LARG + px)) continue;
    var lx = r === 1 ? py : HAUT - 1 - py, ly = r === 1 ? LARG - 1 - px : px;
    var n = ly * w + lx; log[n >> 3] |= 0x80 >> (n & 7);
  }
  return { bits: log, w: w, h: h };
}
function logVersPhys(log, r) {
  if (!r) return log;
  var phys = new Uint8Array(OCTETS), w = HAUT;
  for (var ly = 0; ly < LARG; ly++) for (var lx = 0; lx < HAUT; lx++) {
    if (!lireBit(log, ly * w + lx)) continue;
    var px = r === 1 ? LARG - 1 - ly : ly, py = r === 1 ? lx : HAUT - 1 - lx;
    var n = py * LARG + px; phys[n >> 3] |= 0x80 >> (n & 7);
  }
  return phys;
}

// --- Prochains bus (Tango) : lecture du fichier d'horaires GTFS dans le navigateur ---
var zipGTFS = null, gtfsArrets = null, busSel = [];
var NOMS_JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function lireZip(buf) {
  var dv = new DataView(buf), u8 = new Uint8Array(buf);
  var e = u8.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('fichier zip invalide');
  var n = dv.getUint16(e + 10, true), p = dv.getUint32(e + 16, true), fichiers = {};
  for (var i = 0; i < n; i++) {
    var ln = dv.getUint16(p + 28, true), lx = dv.getUint16(p + 30, true), lc = dv.getUint16(p + 32, true);
    var nom = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + ln));
    fichiers[nom.split('/').pop()] = { meth: dv.getUint16(p + 10, true), taille: dv.getUint32(p + 20, true), off: dv.getUint32(p + 42, true) };
    p += 46 + ln + lx + lc;
  }
  return { u8: u8, dv: dv, fichiers: fichiers };
}
function extraire(zip, nom) {
  var f = zip.fichiers[nom];
  if (!f) return Promise.resolve('');
  var o = f.off, ln = zip.dv.getUint16(o + 26, true), lx = zip.dv.getUint16(o + 28, true);
  var data = zip.u8.subarray(o + 30 + ln + lx, o + 30 + ln + lx + f.taille);
  if (f.meth === 0) return Promise.resolve(new TextDecoder().decode(data));
  return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text();
}
function decouperCSV(l) {
  var r = [], cur = '', q = false;
  for (var i = 0; i < l.length; i++) {
    var ch = l[i];
    if (q) { if (ch === '"') { if (l[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { r.push(cur); cur = ''; }
    else cur += ch;
  }
  r.push(cur);
  return r;
}
// Appelle cb(champs, colonnes) pour chaque ligne d'un fichier CSV GTFS
function parcourirCSV(texte, cb) {
  var debut = 0, cols = null;
  if (texte.charCodeAt(0) === 0xFEFF) debut = 1;
  while (debut < texte.length) {
    var fin = texte.indexOf('\\n', debut);
    if (fin < 0) fin = texte.length;
    var l = texte.slice(debut, fin);
    debut = fin + 1;
    if (l.charCodeAt(l.length - 1) === 13) l = l.slice(0, -1);
    if (!l) continue;
    var c = l.indexOf('"') < 0 ? l.split(',') : decouperCSV(l);
    if (!cols) { cols = {}; c.forEach(function (h, i) { cols[h.trim()] = i; }); continue; }
    cb(c, cols);
  }
}
function sansAccents(t) { return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

function chargerGTFS() {
  $('busEtat').textContent = 'Téléchargement des horaires Tango… (quelques secondes)';
  api('/api/gtfs').then(function (r) { return r.arrayBuffer(); }).then(function (buf) {
    zipGTFS = lireZip(buf);
    $('busEtat').textContent = 'Lecture des arrêts…';
    return extraire(zipGTFS, 'stops.txt');
  }).then(function (t) {
    var groupes = {};
    parcourirCSV(t, function (c, h) {
      var lt = h.location_type !== undefined ? c[h.location_type] : '';
      if (lt && lt !== '0') return;
      var nom = (c[h.stop_name] || '').trim();
      if (nom) (groupes[nom] = groupes[nom] || []).push(c[h.stop_id]);
    });
    gtfsArrets = groupes;
    busSel = (config.bus.arrets || []).filter(function (n) { return groupes[n]; });
    $('busChoix').classList.remove('cache');
    afficherBusSel();
    $('busEtat').textContent = Object.keys(groupes).length + ' arrêts chargés : cherche le tien ci-dessous.';
    $('busRecherche').focus();
  }).catch(function (e) { $('busEtat').textContent = 'Erreur : ' + e.message; });
}
function chercherArret() {
  var q = sansAccents($('busRecherche').value.trim()), zone = $('busResultats');
  zone.innerHTML = '';
  if (!gtfsArrets || q.length < 2) return;
  Object.keys(gtfsArrets).filter(function (n) { return sansAccents(n).indexOf(q) >= 0; }).sort().slice(0, 8).forEach(function (n) {
    var d = document.createElement('div');
    d.textContent = n;
    d.onclick = function () {
      if (busSel.indexOf(n) < 0) { if (busSel.length >= 2) busSel.shift(); busSel.push(n); }
      $('busRecherche').value = ''; zone.innerHTML = '';
      afficherBusSel();
    };
    zone.appendChild(d);
  });
}
function afficherBusSel() {
  var z = $('busArrets');
  z.innerHTML = '';
  if (!busSel.length) { z.textContent = 'Aucun'; return; }
  busSel.forEach(function (n) {
    var b = document.createElement('button');
    b.textContent = n + '  ✕';
    b.style.marginTop = '4px';
    b.onclick = function () { busSel = busSel.filter(function (x) { return x !== n; }); afficherBusSel(); };
    z.appendChild(b);
  });
}

// Garde seulement les passages aux arrets choisis, avec ce qu'il faut pour les dater
function construireIndexBus() {
  if (!busSel.length) { message('msgBus', "Choisis d'abord au moins un arrêt."); return; }
  var ids = {};
  busSel.forEach(function (n) { gtfsArrets[n].forEach(function (id) { ids[id] = n; }); });
  $('busEtat').textContent = 'Analyse des horaires des arrêts choisis…';
  Promise.all(['routes.txt', 'trips.txt', 'stop_times.txt', 'calendar.txt', 'calendar_dates.txt'].map(function (f) { return extraire(zipGTFS, f); }))
    .then(function (t) {
      var routes = {}, trips = {}, besoin = {}, brut = [];
      parcourirCSV(t[0], function (c, h) {
        routes[c[h.route_id]] = ((c[h.route_short_name] || '').trim() || (c[h.route_long_name] || '').trim() || c[h.route_id]);
      });
      parcourirCSV(t[2], function (c, h) {
        var sid = c[h.stop_id];
        if (!ids[sid]) return;
        if (h.pickup_type !== undefined && c[h.pickup_type] === '1') return;    // pas de montee possible
        var hs = (c[h.departure_time] || c[h.arrival_time] || '').trim();
        if (!hs) return;
        var p = hs.split(':');
        brut.push([c[h.trip_id], (+p[0]) * 3600 + (+p[1]) * 60 + (+p[2] || 0), sid]);
        besoin[c[h.trip_id]] = 1;
      });
      parcourirCSV(t[1], function (c, h) {
        var id = c[h.trip_id];
        if (besoin[id]) trips[id] = { r: c[h.route_id], d: (c[h.trip_headsign] || '').trim(), s: c[h.service_id] };
      });
      var servicesUtiles = {};
      Object.keys(trips).forEach(function (k) { servicesUtiles[trips[k].s] = 1; });
      var services = {};
      var J = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      parcourirCSV(t[3], function (c, h) {
        var s = c[h.service_id];
        if (servicesUtiles[s]) services[s] = { j: J.map(function (x) { return c[h[x]] === '1' ? '1' : '0'; }).join(''), d: c[h.start_date], f: c[h.end_date] };
      });
      parcourirCSV(t[4], function (c, h) {
        var s = c[h.service_id];
        if (!servicesUtiles[s]) return;
        var o = services[s] = services[s] || { j: '0000000' };
        if (c[h.exception_type] === '1') (o.plus = o.plus || []).push(c[h.date]);
        else if (c[h.exception_type] === '2') (o.moins = o.moins || []).push(c[h.date]);
      });
      // Index compact : listes de lignes, destinations et services, puis passages numerotes
      var lignes = [], dests = [], svc = [], iL = {}, iD = {}, iS = {}, options = {};
      function num(tab, idx, v) { if (idx[v] === undefined) { idx[v] = tab.length; tab.push(v); } return idx[v]; }
      var passages = [];
      brut.forEach(function (p) {
        var tr = trips[p[0]];
        if (!tr) return;
        var l = routes[tr.r] || tr.r, d = tr.d;
        if (d && sansAccents(d) === sansAccents(ids[p[2]])) return;               // terminus : pas de depart
        var s = services[tr.s];
        if (!s) return;
        passages.push([p[0], num(lignes, iL, l), num(dests, iD, d), num(svc, iS, tr.s), p[1], p[2]]);
        options[l + '|' + d] = { k: l + '|' + d, l: l, d: d };
      });
      var index = { maj: Date.now(), arrets: busSel.slice(), lignes: lignes, destinations: dests,
        services: svc.map(function (k) { return services[k]; }), passages: passages };
      var opts = Object.keys(options).map(function (k) { return options[k]; }).sort(function (a, b) {
        return a.l.localeCompare(b.l, 'fr', { numeric: true }) || a.d.localeCompare(b.d, 'fr');
      });
      $('busEtat').textContent = 'Envoi au serveur…';
      return api('/api/bus-index', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(index) })
        .then(function () {
          var garde = Array.isArray(config.bus.lignes) ? config.bus.lignes.filter(function (k) { return options[k]; }) : null;
          return enregistrer({ bus: { arrets: busSel.slice(), options: opts, lignes: garde && garde.length ? garde : null } });
        })
        .then(function () { remplirBus(); message('msgBus', passages.length + ' passages trouvés pour ' + busSel.join(' et ') + '.'); });
    })
    .catch(function (e) { $('busEtat').textContent = 'Erreur : ' + e.message; });
}

function remplirBus() {
  var b = config.bus;
  $('busEtat').textContent = b.arrets && b.arrets.length ? 'Arrêt(s) : ' + b.arrets.join(' · ') : 'Aucun arrêt choisi pour l\\'instant.';
  var z = $('busLignes');
  z.innerHTML = '';
  (b.options || []).forEach(function (o) {
    var l = document.createElement('label'), cb = document.createElement('input');
    cb.type = 'checkbox'; cb.value = o.k;
    cb.checked = !Array.isArray(b.lignes) || b.lignes.indexOf(o.k) >= 0;
    l.appendChild(cb); l.appendChild(document.createTextNode('Ligne ' + o.l + (o.d ? ' → ' + o.d : '')));
    z.appendChild(l);
  });
  $('busNb').value = String(b.nb); $('busHorizon').value = String(b.horizon);
  $('busSource').value = b.sourceRT || '';
}
function ajouterCreneau(c, conteneur) {
  c = c && c.jours ? c : { jours: [1, 1, 1, 1, 1, 0, 0], debut: '07:00', fin: '08:00' };
  var bloc = document.createElement('div');
  bloc.className = 'creneau';
  bloc.style.cssText = 'border:1px solid var(--trait);border-radius:10px;padding:6px 10px;margin-top:6px';
  var jours = document.createElement('div');
  jours.className = 'puces';
  NOMS_JOURS.forEach(function (n, i) {
    var l = document.createElement('label'), cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = !!c.jours[i];
    l.appendChild(cb); l.appendChild(document.createTextNode(n));
    jours.appendChild(l);
  });
  var heures = document.createElement('div');
  heures.className = 'ligne';
  heures.innerHTML = '<label>de <input type="time" class="cDebut" style="width:auto;min-width:0;flex:1;padding:8px 6px"></label><label>à <input type="time" class="cFin" style="width:auto;min-width:0;flex:1;padding:8px 6px"></label><button style="flex:0;padding:8px 12px" title="Supprimer ce créneau" aria-label="Supprimer ce créneau">✕</button>';
  heures.querySelector('.cDebut').value = c.debut;
  heures.querySelector('.cFin').value = c.fin;
  heures.querySelector('button').onclick = function () { bloc.remove(); };
  bloc.appendChild(jours); bloc.appendChild(heures);
  $(conteneur).appendChild(bloc);
}
function lireCreneaux(conteneur) {
  var res = [], blocs = $(conteneur).querySelectorAll('.creneau');
  for (var i = 0; i < blocs.length; i++) {
    var j = [], cases = blocs[i].querySelectorAll('.puces input');
    for (var k = 0; k < cases.length; k++) j.push(cases[k].checked ? 1 : 0);
    res.push({ jours: j, debut: blocs[i].querySelector('.cDebut').value, fin: blocs[i].querySelector('.cFin').value });
  }
  return res;
}
function enregistrerBus() {
  var cases = $('busLignes').querySelectorAll('input'), choisies = [], toutes = true;
  for (var i = 0; i < cases.length; i++) { if (cases[i].checked) choisies.push(cases[i].value); else toutes = false; }
  enregistrer({ bus: { lignes: toutes ? null : choisies, nb: +$('busNb').value, horizon: +$('busHorizon').value,
    sourceRT: $('busSource').value.trim() } }, 'msgBus')
    .then(function () { remplirBus(); });
}
function testerBus() {
  var z = $('busTest');
  z.classList.remove('cache'); z.textContent = 'Chargement…';
  api('/api/bus-test').then(function (r) { return r.json(); }).then(function (d) {
    if (d.erreur) { z.textContent = d.erreur; return; }
    var t = (d.tempsReel ? 'Temps réel disponible' : 'Pas de temps réel : horaires théoriques') + '\\n\\n';
    if (!d.passages.length) t += 'Aucun passage dans les prochaines minutes.';
    d.passages.forEach(function (p) {
      t += p.h + '  (dans ' + p.m + ' min)  Ligne ' + p.l + (p.d ? ' → ' + p.d : '') + (p.x ? '  SUPPRIMÉ' : (p.tr ? '  [temps réel]' : '')) + '\\n';
    });
    z.textContent = t;
  }).catch(function (e) { z.textContent = 'Erreur : ' + e.message; });
}

function charger() {
  return api('/api/config').then(function (r) { return r.json(); }).then(function (d) {
    config = d.config;
    remplirFormulaires();
    afficherStatut(d.statut, d.maintenant);
    chargerApercu();
  });
}

function pourcentage(v) {
  var T = [3.3, 3.5, 3.6, 3.65, 3.7, 3.75, 3.8, 3.9, 4.0, 4.1, 4.2], P = [0, 5, 10, 20, 30, 40, 50, 65, 80, 90, 100];
  if (v <= T[0]) return 0; if (v >= T[10]) return 100;
  for (var i = 0; i < 10; i++) if (v < T[i + 1]) return Math.round(P[i] + (v - T[i]) / (T[i + 1] - T[i]) * (P[i + 1] - P[i]));
  return 100;
}
function duree(ms) {
  var m = Math.round(ms / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return 'il y a ' + m + ' min';
  var h = Math.round(m / 60);
  if (h < 48) return 'il y a ' + h + ' h';
  return 'il y a ' + Math.round(h / 24) + ' jours';
}
var NOMS = { tableau: 'tableau de bord', photo: 'photo', pochette: 'pochette', blanc: 'écran blanc' };
function afficherStatut(s, maintenant) {
  dernierStatut = s;
  if (config.mode === 'tableau' && s && s.sc) setTimeout(dessinerPuces, 0);
  var t = 'Mode demandé : ' + NOMS[config.mode] + '. ';
  if (!s) t += "Le cadre ne s'est pas encore connecté.";
  else {
    t += 'Dernière connexion du cadre ' + duree(maintenant - s.vu) + '.';
    if (config.mode === 'tableau' && s.sc) t += ' Scène affichée : ' + s.sc + '.';
    if (s.bat && s.bat > 2.5) t += ' Batterie ' + pourcentage(s.bat) + ' % (' + s.bat.toFixed(2).replace('.', ',') + ' V).';
    var prochain = s.vu + (s.r ? s.r * 1000 : config.dev ? config.devSecondes * 1000 : config.reveilMin * 60000) - maintenant;
    if (prochain > 0) t += ' Prochain réveil dans ' + Math.max(1, Math.round(prochain / 60000)) + ' min environ.';
  }
  $('statut').textContent = t;
  afficherFirmware(s);
  var boutons = document.querySelectorAll('[data-mode]');
  for (var i = 0; i < boutons.length; i++) boutons[i].classList.toggle('actif', boutons[i].getAttribute('data-mode') === config.mode);
  var aide = '';
  if (config.mode === 'blanc') aide = "L'écran s'effacera au prochain réveil du cadre. Attends que l'aperçu soit blanc avant de débrancher la batterie.";
  else if (config.dev) aide = 'Mode développement actif : le changement s\\'applique dans ' + config.devSecondes + ' s environ.';
  else aide = "Le changement s'applique au prochain réveil du cadre (dans " + config.reveilMin + ' min au plus).';
  $('aideMode').textContent = aide;
}

// Affiche des bits (1 = noir) de taille w x h dans un canvas
function dessinerBits(canvas, octets, w, h) {
  w = w || LARG; h = h || HAUT;
  canvas.width = w; canvas.height = h;
  var ctx = canvas.getContext('2d');
  var img = ctx.createImageData(w, h);
  for (var i = 0; i < w * h; i++) {
    var noir = (octets[i >> 3] >> (7 - (i & 7))) & 1;
    var v = noir ? 20 : 255;
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
function chargerApercu() {
  api('/api/apercu').then(function (r) {
    var t = +r.headers.get('x-date'), rr = +(r.headers.get('x-rotation') || 0);
    return r.arrayBuffer().then(function (b) {
      var l = physVersLog(new Uint8Array(b), rr);
      formeEcran($('apercu'), rr);
      dessinerBits($('apercu'), l.bits, l.w, l.h);
      if (t) $('statut').textContent += ' Aperçu du ' + new Date(t).toLocaleString('fr-FR') + '.';
    });
  }).catch(function () {
    var cv = $('apercu'); cv.width = LARG; cv.height = HAUT; formeEcran(cv, 0);
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, LARG, HAUT);
    ctx.fillStyle = '#888'; ctx.font = '32px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText("Pas encore d'aperçu : le cadre ne s'est pas encore connecté", LARG / 2, HAUT / 2);
  });
}

function remplirFormulaires() {
  remplirMeteo(); remplirAgenda(); remplirDispo(); remplirBus();
  $('reveil').value = String(config.reveilMin);
  $('dev').checked = !!config.dev; $('devSecondes').value = String(config.devSecondes || 30);
  var n = config.nuit || {};
  $('nuitActif').checked = !!n.actif; $('nuitDebut').value = n.debut || '23:00'; $('nuitFin').value = n.fin || '07:00';
  $('nuitIntervalle').value = String(n.intervalleMin || 60);
  $('bordure').value = String(config.affichage.bordureApercu); appliquerBordure();
  var p = config.pochette;
  if (p.version) $('pochetteActuelle').textContent = 'Dernière pochette : ' + (p.titre || '?') + ' — ' + (p.artiste || '?') + ' (' + new Date(p.t).toLocaleString('fr-FR') + ')';
  $('urlPochette').textContent = location.origin + '/api/pochette?cle=' + encodeURIComponent(cle);
}
function remplirMeteo() {
  var m = config.meteo;
  $('villeChoisie').textContent = 'Ville actuelle : ' + m.ville + ' (' + m.lat + ', ' + m.lon + ')';
  $('mVent').checked = m.vent; $('mDetails').checked = m.details; $('mSoleil').checked = m.soleil;
  $('mPas').value = String(m.pasHeures); $('mNbJours').value = String(m.nbJours); $('mNbHeures').value = String(m.nbHeures || 6);
  $('mCourbe').value = String(m.courbeHeures || 24);

}
function remplirAgenda() {
  $('aUrls').value = config.agenda.urls.join('\\n');
  $('aNb').value = String(config.agenda.nb);
  $('aAnniv').value = (config.agenda.anniversaires || []).map(function (a) {
    return a.nom + ' ' + String(a.j).padStart(2, '0') + '/' + String(a.m).padStart(2, '0') + (a.a ? '/' + a.a : '');
  }).join('\\n');
}

function enregistrer(modif, idMsg) {
  return api('/api/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(modif) })
    .then(function (r) { return r.json(); })
    .then(function (d) { config = d.config; return rafraichir(); })
    .then(function () { if (idMsg) message(idMsg, 'Enregistré. Le cadre se mettra à jour à son prochain réveil.'); })
    .catch(function (e) { if (idMsg) message(idMsg, 'Erreur : ' + e.message); });
}
function changerMode(mode) { enregistrer({ mode: mode }); }
function ecranBlanc() {
  if (confirm("Effacer l'écran (tout blanc) ? À faire avant de débrancher la batterie pour une longue absence.")) enregistrer({ mode: 'blanc' });
}

var villeTemp = null;
function chercherVille() {
  var q = $('ville').value.trim(); if (!q) return;
  fetch('https://geocoding-api.open-meteo.com/v1/search?count=5&language=fr&name=' + encodeURIComponent(q))
    .then(function (r) { return r.json(); }).then(function (d) {
      var zone = $('resultatsVille'); zone.innerHTML = '';
      (d.results || []).forEach(function (v) {
        var div = document.createElement('div');
        div.textContent = v.name + ' — ' + [v.admin1, v.country].filter(Boolean).join(', ');
        div.onclick = function () {
          villeTemp = { ville: v.name, lat: Math.round(v.latitude * 100) / 100, lon: Math.round(v.longitude * 100) / 100 };
          $('villeChoisie').textContent = 'Ville choisie : ' + v.name + ' (pense à enregistrer)';
          zone.innerHTML = '';
        };
        zone.appendChild(div);
      });
      if (!d.results) zone.textContent = 'Aucune ville trouvée';
    });
}
function enregistrerMeteo() {
  var m = { vent: $('mVent').checked, details: $('mDetails').checked, soleil: $('mSoleil').checked,
    pasHeures: +$('mPas').value, nbHeures: +$('mNbHeures').value, nbJours: +$('mNbJours').value, courbeHeures: +$('mCourbe').value };
  if (villeTemp) { m.ville = villeTemp.ville; m.lat = villeTemp.lat; m.lon = villeTemp.lon; villeTemp = null; }
  enregistrer({ meteo: m }, 'msgMeteo');
}
function enregistrerAgenda() {
  var modif = { agenda: { urls: $('aUrls').value.split('\\n'), nb: +$('aNb').value, anniversairesTexte: $('aAnniv').value } };
  api('/api/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(modif) })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      config = d.config; remplirAgenda();
      var t = 'Enregistré. Le cadre se mettra à jour à son prochain réveil.';
      if (d.ignorees && d.ignorees.length) t = 'Enregistré, mais lignes non comprises : ' + d.ignorees.join(' ; ') + ' (format attendu : Prénom 14/03/2005)';
      $('msgAgenda').textContent = t;
      return rafraichir();
    })
    .catch(function (e) { message('msgAgenda', 'Erreur : ' + e.message); });
}
function enregistrerReveil() {
  var dev = $('dev').checked;
  enregistrer({ reveilMin: +$('reveil').value, dev: dev, devSecondes: +$('devSecondes').value,
    nuit: { actif: $('nuitActif').checked, debut: $('nuitDebut').value || '23:00', fin: $('nuitFin').value || '07:00',
      intervalleMin: +$('nuitIntervalle').value } }, 'msgReveil')
    .then(function () {
      if (dev) $('msgReveil').textContent = "Mode développement activé : il prendra effet au prochain réveil normal de la carte (ou appuie sur son bouton R pour la redémarrer tout de suite).";
    });
}
function tester() {
  $('donnees').classList.remove('cache'); $('donnees').textContent = 'Chargement…';
  api('/api/etat?ui=1').then(function (r) { return r.json(); })
    .then(function (d) { $('donnees').textContent = JSON.stringify(d, null, 2); })
    .catch(function (e) { $('donnees').textContent = 'Erreur : ' + e.message; });
}

// --- Photo : recadrage + tramage Floyd-Steinberg dans le navigateur ---
var bitsPhoto = null;
$('fichier').onchange = function () {
  var f = this.files[0]; if (!f) return;
  var img = new Image();
  img.onload = function () { image = img; tramer(); };
  img.src = URL.createObjectURL(f);
};
$('lum').oninput = tramer; $('contraste').oninput = tramer;
var radios = document.getElementsByName('cadrage');
for (var i = 0; i < radios.length; i++) radios[i].onchange = tramer;

function tramer() {
  if (!image) return;
  // La photo est preparee "a l'endroit" selon l'orientation du cadre
  var rp = (config && config.affichage.rotation) || 0;
  var LARG = rp ? 680 : 960, HAUT = rp ? 960 : 680;
  var c = document.createElement('canvas'); c.width = LARG; c.height = HAUT;
  var ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, LARG, HAUT);
  var remplir = document.querySelector('input[name=cadrage]:checked').value === 'remplir';
  var e = remplir ? Math.max(LARG / image.width, HAUT / image.height) : Math.min(LARG / image.width, HAUT / image.height);
  var w = image.width * e, h = image.height * e;
  ctx.drawImage(image, (LARG - w) / 2, (HAUT - h) / 2, w, h);
  var px = ctx.getImageData(0, 0, LARG, HAUT).data;
  var lum = +$('lum').value, k = +$('contraste').value / 100;
  var g = new Float32Array(LARG * HAUT);
  for (var j = 0; j < LARG * HAUT; j++) {
    var v = 0.299 * px[j * 4] + 0.587 * px[j * 4 + 1] + 0.114 * px[j * 4 + 2];
    g[j] = (v - 128) * k + 128 + lum;
  }
  bitsPhoto = new Uint8Array(OCTETS);
  for (var y = 0; y < HAUT; y++) for (var x = 0; x < LARG; x++) {
    var n = y * LARG + x, ancien = g[n], nouveau = ancien < 128 ? 0 : 255, err = ancien - nouveau;
    if (nouveau === 0) bitsPhoto[n >> 3] |= 0x80 >> (n & 7);
    if (x + 1 < LARG) g[n + 1] += err * 7 / 16;
    if (y + 1 < HAUT) {
      if (x > 0) g[n + LARG - 1] += err * 3 / 16;
      g[n + LARG] += err * 5 / 16;
      if (x + 1 < LARG) g[n + LARG + 1] += err / 16;
    }
  }
  formeEcran($('photoTramee'), rp);
  dessinerBits($('photoTramee'), bitsPhoto, LARG, HAUT);
  rotationPhoto = rp;
}
var rotationPhoto = 0;
function envoyerPhoto() {
  if (!bitsPhoto) { message('msgPhoto', "Choisis d'abord une photo."); return; }
  api('/api/photo?r=' + rotationPhoto, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: logVersPhys(bitsPhoto, rotationPhoto) })
    .then(function () { message('msgPhoto', 'Photo envoyée : elle s\\'affichera au prochain réveil du cadre.'); return rafraichir(); })
    .catch(function (e) { message('msgPhoto', 'Erreur : ' + e.message); });
}

// --- Programme de la carte ---
function texteVersion(v) { return v.slice(6, 8) + '/' + v.slice(4, 6) + '/' + v.slice(0, 4) + ' à ' + v.slice(9, 11) + 'h' + v.slice(11, 13); }
function afficherFirmware(s) {
  var inst = s && s.fw, f = config.firmware;
  var t = 'Version installée sur la carte : ' + (inst ? 'compilée le ' + texteVersion(inst) : 'inconnue (ancien programme, ou pas encore connectée)') + '.';
  if (f) {
    t += ' Programme envoyé : compilé le ' + texteVersion(f.version) + ' (' + Math.round(f.taille / 1024) + ' Ko), ';
    if (inst === f.version) t += 'installé.';
    else if (inst && inst > f.version) t += 'plus ancien que celui de la carte : ignoré.';
    else t += 'en attente du prochain réveil.';
  }
  $('fwInfo').textContent = t;
}
// Retrouve la date de compilation ecrite par le programme ("CADRE_FW:Oct 24 2026 14:03:22")
function versionDans(o) {
  var m = 'CADRE_FW:', d2 = function (n) { return (n < 10 ? '0' : '') + n; };
  for (var i = 0; i + 29 < o.length; i++) {
    if (o[i] !== 67) continue;
    var k = 1; while (k < 9 && o[i + k] === m.charCodeAt(k)) k++;
    if (k < 9) continue;
    var s = ''; for (var j = 0; j < 20; j++) s += String.fromCharCode(o[i + 9 + j]);
    var mois = 'JanFebMarAprMayJunJulAugSepOctNovDec'.indexOf(s.slice(0, 3)) / 3 + 1;
    var jour = parseInt(s.slice(4, 6), 10), an = s.slice(7, 11);
    if (mois < 1 || !jour) return null;
    return an + d2(mois) + d2(jour) + '-' + s.slice(12, 14) + s.slice(15, 17) + s.slice(18, 20);
  }
  return null;
}
function envoyerFirmware() {
  var f = $('fichierFw').files[0];
  if (!f) { message('msgFw', "Choisis d'abord le fichier .bin."); return; }
  if (/merged|bootloader|partitions/i.test(f.name)) { message('msgFw', 'Ce n\\'est pas le bon fichier : prends cadre_eink.ino.bin.'); return; }
  var version;
  f.arrayBuffer().then(function (buf) {
    var o = new Uint8Array(buf);
    if (o[0] !== 0xE9) throw new Error("ce n'est pas un programme ESP32");
    version = versionDans(o);
    if (!version) throw new Error('ce programme ne vient pas du cadre (version introuvable)');
    $('msgFw').textContent = 'Envoi…';
    return api('/api/firmware?v=' + version + '&nom=' + encodeURIComponent(f.name),
      { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: buf });
  }).then(function () {
    message('msgFw', 'Programme du ' + texteVersion(version) + ' envoyé : la carte l\\'installera à son prochain réveil.');
    return rafraichir();
  }).catch(function (e) { message('msgFw', 'Erreur : ' + e.message); });
}

// --- Menus deroulants : on retient ceux qui sont ouverts (sur cet appareil) ---
var menus = document.querySelectorAll('details.menu');
var menusOuverts = [];
try { menusOuverts = JSON.parse(localStorage.getItem('cadre-menus') || '[]'); } catch (e) {}
for (var i = 0; i < menus.length; i++) {
  if (menusOuverts.indexOf(menus[i].id) >= 0) menus[i].open = true;
  menus[i].addEventListener('toggle', function () {
    var ouverts = [];
    for (var k = 0; k < menus.length; k++) if (menus[k].open) ouverts.push(menus[k].id);
    try { localStorage.setItem('cadre-menus', JSON.stringify(ouverts)); } catch (e) {}
  });
}
function toutesLesSections(ouvrir) { for (var k = 0; k < menus.length; k++) menus[k].open = ouvrir; }

demarrer();
setInterval(function () { if (config) rafraichir().catch(function () {}); }, 60000);
</script>
</body></html>`;
