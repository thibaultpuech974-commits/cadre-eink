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
//   - Cloudflare Access sur le Worker (connexion + double authentification
//     pour la page web, jetons de service pour la carte et le raccourci iPhone)
//   - en secours, sans Access : une variable secrete CLE (mot de passe)
//
//  Ce fichier garde le point d'entree et les routes (/api/...). Le reste est range par theme :
//   commun.js            dimensions de l'ecran, reponses HTTP, copie de secours, texte pour l'ecran
//   temps.js             fuseaux horaires, noms des jours et des mois
//   config.js            reglages (defaut, lecture, verification d'une modification)
//   disposition.js       grille et blocs de l'ecran
//   scenes.js            creneaux, nuit, scenes
//   bus.js               horaires et temps reel des bus
//   meteo.js             Open-Meteo
//   agenda.js            calendriers ICS et anniversaires
//   f1.js                calendrier de Formule 1 (+ circuits.js : traces des circuits)
//   tableau.js           donnees de chaque bloc envoyees a la carte
//   rafraichissement.js  plan de rafraichissement partiel de l'ecran
// =====================================================================

// Page web de reglage : fichier a part, integre par Cloudflare au deploiement (regle "Text" de wrangler.jsonc)
import INTERFACE from './interface.html';
// Code de dessin de la carte compile en WebAssembly (outils/apercu/construire.sh), pour la previsualisation
import APERCU_WASM from './apercu.wasm';
import { OCTETS, empreinte, fusionner, json, pourEcran, texte } from './commun.js';
import { dateDuJour, deux, mural } from './temps.js';
import { CONFIG_DEFAUT, METHODES_PARTIEL, ecrireConfig, lireConfig, migrerScenes, preparerModif } from './config.js';
import { ROTATIONS } from './disposition.js';
import { reveilNuit } from './scenes.js';
import { GTFS_TANGO, oublierIndexBus, prochainsBus } from './bus.js';
import { evenementsICS } from './agenda.js';
import { construireTableau } from './tableau.js';
import { empreinteImage, encoderPlan, planRafraichissement, resumePlan } from './rafraichissement.js';

// ---------------------------------------------------------------------
//  Point d'entree
// ---------------------------------------------------------------------
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const chemin = url.pathname;

    if (chemin === '/' || chemin === '/index.html') {
      // no-cache : le navigateur revalide la page a chaque visite, pour qu'elle reste
      // accordee a la previsualisation (apercu.wasm) apres un deploiement
      return new Response(INTERFACE, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' } });
    }
    if (!chemin.startsWith('/api/')) return new Response('Introuvable', { status: 404 });
    // Cloudflare Access : ctx.access n'existe que si Access a authentifie la requete
    // (personne connectee a la page web, ou carte / raccourci avec leur jeton de service)
    const access = ctx && ctx.access ? ctx.access : null;
    if (!access && !env.CLE) return texte('Ni Cloudflare Access ni la variable secrete CLE ne sont configures.', 500);
    if (!env.CADRE) return texte('L\'espace KV "CADRE" n\'est pas lie au Worker.', 500);

    // Sans Access (mode de secours) : mot de passe CLE
    if (!access) {
      const cle = req.headers.get('X-Cle') || url.searchParams.get('cle');
      if (cle !== env.CLE) return texte('Cle incorrecte', 401);
    }

    try {
      const m = req.method;
      if (chemin === '/api/session' && m === 'GET') return await routeSession(access);
      if (chemin === '/api/etat' && m === 'GET') return await routeEtat(url, env);
      if (chemin === '/api/config' && m === 'GET') return await routeLireConfig(env);
      if (chemin === '/api/config' && m === 'POST') return await routeEcrireConfig(req, env);
      if (chemin === '/api/agenda-etat' && m === 'POST') return await routeEtatAgenda(req, env);
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
// Comment la page web est connectee : par Cloudflare Access (avec l'adresse email) ou par mot de passe
async function routeSession(access) {
  if (!access) return json({ access: false });
  let email = '';
  try { const id = await access.getIdentity(); email = (id && id.email) || ''; } catch (e) { /* jeton de service : pas d'identite */ }
  return json({ access: true, email });
}
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
  // Ecart maximal entre deux rafraichissements complets (s) : la carte redessine au plus tard a ce moment,
  // meme sans changement, pour que le serveur puisse commander le rafraichissement complet du jour
  etat.cp = ((cfg.rafraich && cfg.rafraich.completH) || 24) * 3600;

  if (!pourInterface) {
    // L'offre gratuite limite les ecritures (~1 000 par jour) : l'etat du cadre n'est enregistre
    // que toutes les 10 min, ou quand quelque chose d'important change (mode, version, batterie).
    const bat = parseFloat(url.searchParams.get('bat'));
    // Jauge de la carte (MAX17048) : pourcentage et vitesse de charge (+) ou de decharge (-) en % par heure
    const lu = (nom, min, max) => { const x = parseFloat(url.searchParams.get(nom)); return isNaN(x) ? null : Math.round(Math.max(min, Math.min(max, x)) * 10) / 10; };
    const pct = lu('pct', 0, 110), crate = lu('crate', -200, 200);
    // Temps d'eveil et temps d'ecran cumules par la carte depuis son demarrage (ms) : la page en deduit les
    // secondes d'eveil par jour, sans ecriture de plus (ils voyagent avec l'etat et l'historique)
    const entier = nom => { const x = parseInt(url.searchParams.get(nom), 10); return isNaN(x) || x < 0 ? null : Math.min(x, 4294967295); };
    const ev = entier('ev'), ee = entier('ee');
    const cleStatut = ecran ? 'statut' + ecran : 'statut';
    const ancien = JSON.parse((await env.CADRE.get(cleStatut)) || 'null');
    const nouveau = { vu: maintenant, bat: isNaN(bat) ? null : bat, mode: cfg.mode, r: etat.reveil, sc: etat.scene || null,
      fw: fwCarte || (ancien && ancien.fw) || null, hb: (ancien && ancien.hb) || 0 };
    if (pct !== null) nouveau.pct = pct;
    if (crate !== null) nouveau.crate = crate;
    if (ev !== null) { nouveau.ev = ev; nouveau.ee = ee || 0; }
    // Historique de la batterie : un point par heure, 30 jours (24 ecritures par jour au plus)
    let historique = false;
    if (nouveau.bat > 2.5 && maintenant - nouveau.hb >= 55 * 60000) {
      try {
        const cleH = 'batterie' + (ecran ? ecran : '');
        const h = JSON.parse((await env.CADRE.get(cleH)) || '{"pts":[]}');
        const debut = Math.floor((maintenant - 30 * 86400e3) / 60000);
        h.pts = h.pts.filter(p => p[0] >= debut);
        // minutes, millivolts, et si la carte a une jauge : dixiemes de %, dixiemes de % par heure ;
        // puis temps d'eveil et d'ecran cumules (dixiemes de seconde)
        const p = [Math.floor(maintenant / 60000), Math.round(nouveau.bat * 1000)];
        if (pct !== null || ev !== null) p.push(pct !== null ? Math.round(pct * 10) : null, crate !== null ? Math.round(crate * 10) : null);
        if (ev !== null) p.push(Math.round(ev / 100), Math.round((ee || 0) / 100));
        h.pts.push(p);
        await env.CADRE.put(cleH, JSON.stringify(h));
        nouveau.hb = maintenant; historique = true;
      } catch (e) { /* limite d'ecriture */ }
    }
    const aEcrire = historique || !ancien || maintenant - ancien.vu >= 10 * 60000 || ancien.mode !== nouveau.mode ||
      ancien.fw !== nouveau.fw || ancien.r !== nouveau.r || ancien.sc !== nouveau.sc || (nouveau.bat !== null && Math.abs((ancien.bat || 0) - nouveau.bat) >= 0.05) ||
      // debut ou fin de charge : la page le montre tout de suite (ecart d'au moins 1 % par heure, pour
      // qu'une vitesse qui hesite autour du seuil en fin de charge n'ecrive pas a chaque reveil)
      (crate !== null && (ancien.crate >= 2) !== (crate >= 2) && Math.abs(crate - (ancien.crate || 0)) >= 1);
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
// --- Etat de chaque calendrier de l'agenda (page web) : accessible ? combien d'evenements a venir ? ---
async function routeEtatAgenda(req, env) {
  let demande;
  try { demande = await req.json(); } catch (e) { return texte('Demande illisible', 400); }
  const cfg = await lireConfig(env);
  const jours = Math.max(1, cfg.agenda.joursMax || 14);
  const maintenant = Date.now(), fin = maintenant + jours * 86400e3;
  const urls = (Array.isArray(demande.urls) ? demande.urls : []).map(u => String(u).trim()).filter(Boolean).slice(0, 10);
  const calendriers = await Promise.all(urls.map(async u => {
    const url = u.replace(/^webcal:\/\//i, 'https://');
    if (!/^https:\/\/[^\s/]+\.[^\s/]+/i.test(url)) return { url: u, ok: false, erreur: 'adresse invalide (elle doit commencer par webcal:// ou https://)' };
    try {
      const r = await fetch(url, { cf: { cacheTtl: 900, cacheEverything: true }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) {
        return { url: u, ok: false, erreur: r.status === 404 || r.status === 403
          ? "introuvable (HTTP " + r.status + ") : le calendrier n'est peut-être plus public" : 'erreur HTTP ' + r.status };
      }
      const t = await r.text();
      if (!/BEGIN:VCALENDAR/.test(t)) return { url: u, ok: false, erreur: "cette adresse ne renvoie pas un calendrier" };
      const nom = (/^X-WR-CALNAME[^:]*:(.*)$/m.exec(t) || [])[1];
      return { url: u, ok: true, nom: nom ? nom.trim().replace(/\\([,;\\])/g, '$1').slice(0, 60) : '', n: evenementsICS(t, maintenant, fin).length };
    } catch (e) {
      return { url: u, ok: false, erreur: e.name === 'TimeoutError' ? 'pas de réponse' : 'inaccessible (' + e.message + ')' };
    }
  }));
  return json({ jours, calendriers });
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
  if (s.bus && Array.isArray(s.bus.passages)) { await env.CADRE.put('bus', JSON.stringify(s.bus)); oublierIndexBus(); }
  return json({ config: cfg });
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
  oublierIndexBus();
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
// Image que la carte vient de dessiner (avant de l'afficher). Avec ?plan=1, le serveur la compare a l'image
// precedente et repond comment rafraichir l'ecran (voir planRafraichissement) ; sinon il repond "ok".
async function routeEnvoyerApercu(req, url, env) {
  const donnees = await req.arrayBuffer();
  if (donnees.byteLength !== OCTETS) return texte('Taille incorrecte', 400);
  const lu = parseInt(url.searchParams.get('r') || '0', 10), r = ROTATIONS.includes(lu) ? lu : 0;
  const cle = url.searchParams.get('ecran') === '1' ? 'apercu1' : 'apercu';
  const nouv = new Uint8Array(donnees);
  const metadata = { t: Date.now(), r, h: empreinteImage(nouv) };
  let reponse = texte('ok');
  if (url.searchParams.get('plan') === '1') {
    const cfg = await lireConfig(env);
    const precedent = await env.CADRE.getWithMetadata(cle, 'arrayBuffer');
    const prec = precedent.value ? new Uint8Array(precedent.value) : null;
    const p = url.searchParams;
    const plan = planRafraichissement(prec, precedent.metadata, nouv,
      { crc: p.get('crc') || '', dc: Number(p.get('dc')) || 0, pr: Number(p.get('pr')) || 0, np: Number(p.get('np')) || 0, r }, cfg);
    metadata.p = resumePlan(plan);
    metadata.m = METHODES_PARTIEL[(cfg.rafraich && cfg.rafraich.methode) || 'simple'] || 'P';
    reponse = new Response(encoderPlan(plan, prec), { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' } });
  }
  await env.CADRE.put(cle, donnees, { metadata });
  return reponse;
}
async function routeLireApercu(url, env) {
  const { value, metadata } = await env.CADRE.getWithMetadata(url.searchParams.get('ecran') === '1' ? 'apercu1' : 'apercu', 'arrayBuffer');
  if (!value) return texte('Pas encore d\'apercu', 404);
  return new Response(value, {
    headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'x-date': String(metadata ? metadata.t : 0),
      'x-rotation': String(metadata && metadata.r ? metadata.r : 0), 'x-plan': (metadata && metadata.p) || '' },
  });
}
