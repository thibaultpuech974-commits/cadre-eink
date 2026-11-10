// Réglages : valeurs par défaut, lecture/écriture dans le KV, migration des anciens réglages, vérification d'une modification
import { MODES, fusionner } from './commun.js';
import { ROTATIONS, grille, validerDisposition } from './disposition.js';
import { validerCreneaux, validerScenes } from './scenes.js';

export const CONFIG_DEFAUT = {
  mode: 'tableau',
  version: 1,
  reveilMin: 10,
  dev: false, devSecondes: 30,     // mode developpement : la carte ne dort pas
  // Mode nuit : reveils espaces (economie de batterie), la plage peut passer minuit
  nuit: { actif: false, debut: '23:00', fin: '07:00', intervalleMin: 60 },
  // Heures creuses : plages (jours + heures) ou personne ne regarde le cadre ; reveils espaces, comme la nuit
  creuses: { actif: false, creneaux: [], intervalleMin: 60 },
  // Alertes sur l'iPhone (notifications ntfy, voir alertes.js) : sujet = nom du canal, long et au hasard
  alertes: { actif: false, sujet: '', muet: true, batterie: true, bus: true, seuilBatterie: 20 },
  // Rafraichissement de l'ecran : mises a jour partielles (seules les zones changees, sans clignotement),
  // un rafraichissement complet avec nettoyage au moins toutes les completH heures, et un complet des que
  // plus de 'seuil' % de l'ecran change. methode : simple (une passe), double (deux passes, pixels plus
  // francs) ou inversion (chaque zone passe en negatif puis revient : moins de traces, petit clignotement).
  // maxPartiels : rafraichissement complet apres ce nombre de mises a jour partielles (0 = pas de limite)
  rafraich: { partiel: true, completH: 24, seuil: 40, methode: 'simple', maxPartiels: 0 },
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
  // lieu : affiche le lieu de chaque evenement (champ LOCATION du calendrier) apres son titre
  agenda: { actif: true, urls: [], nb: 8, joursMax: 14, anniversaires: [], lieu: true },
  // Compte a rebours : dates a venir (nom, jour, mois, annee ou 0 = chaque annee), saisies sur la page web
  rebours: { liste: [] },
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
export async function lireConfig(env) {
  const brut = await env.CADRE.get('config');
  const lu = brut ? JSON.parse(brut) : {};
  const cfg = fusionner(JSON.parse(JSON.stringify(CONFIG_DEFAUT)), lu);
  if (!Array.isArray(lu.scenes)) migrerScenes(cfg, lu);
  return cfg;
}
// Anciens reglages (disposition "pendant les creneaux bus", option F1 "semaine du GP") -> scenes
export function migrerScenes(cfg, lu) {
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
export async function ecrireConfig(env, cfg) {
  await env.CADRE.put('config', JSON.stringify(cfg));
}
// Verifie et nettoie une modification des reglages (renvoie les anniversaires illisibles, ou un message d'erreur).
// rapport (facultatif) recoit les autres lignes non comprises : rapport.rebours (dates du compte a rebours)
export function preparerModif(modif, cfg, rapport = {}) {
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
  if (modif.rafraich !== undefined) {
    const r = modif.rafraich || {}, actuel = cfg.rafraich || CONFIG_DEFAUT.rafraich;
    modif.rafraich = {
      partiel: r.partiel === undefined ? actuel.partiel : !!r.partiel,
      completH: [6, 12, 24].includes(+r.completH) ? +r.completH : actuel.completH,
      seuil: [20, 40, 60].includes(+r.seuil) ? +r.seuil : actuel.seuil,
      methode: METHODES_PARTIEL[r.methode] ? r.methode : (actuel.methode || 'simple'),
      maxPartiels: [0, 3, 6, 12].includes(+r.maxPartiels) ? +r.maxPartiels : (actuel.maxPartiels || 0),
    };
  }
  if (modif.creuses !== undefined) {
    const c = modif.creuses || {}, actuel = cfg.creuses || CONFIG_DEFAUT.creuses;
    modif.creuses = { actif: !!c.actif, creneaux: validerCreneaux(c.creneaux === undefined ? actuel.creneaux : c.creneaux),
      intervalleMin: [30, 60, 120, 240].includes(+c.intervalleMin) ? +c.intervalleMin : (actuel.intervalleMin || 60) };
  }
  if (modif.alertes !== undefined) {
    const a = modif.alertes || {}, actuel = cfg.alertes || CONFIG_DEFAUT.alertes;
    const val = (k, defaut) => (a[k] === undefined ? defaut : a[k]);
    const sujet = String(val('sujet', actuel.sujet) || '').trim();
    const actif = !!val('actif', actuel.actif);
    if (sujet ? !SUJET_ALERTES.test(sujet) : actif) return 'Alertes : le sujet ntfy doit faire 10 à 64 caractères (lettres sans accent, chiffres, - ou _)';
    modif.alertes = { actif, sujet, muet: !!val('muet', actuel.muet), batterie: !!val('batterie', actuel.batterie), bus: !!val('bus', actuel.bus),
      seuilBatterie: [10, 20, 30].includes(+a.seuilBatterie) ? +a.seuilBatterie : (actuel.seuilBatterie || 20) };
  }
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
  // Compte a rebours : texte saisi sur la page ("Vacances de Noël 19/12/2026", une date par ligne),
  // ou liste deja prete (restauration d'une sauvegarde)
  if (modif.rebours !== undefined) {
    const r = modif.rebours || {};
    let liste = Array.isArray(r.liste) ? r.liste : [];
    if (typeof r.texte === 'string') {
      const lu = lireAnniversaires(r.texte);
      liste = lu.liste;
      rapport.rebours = lu.ignorees;
    }
    modif.rebours = { liste: liste.filter(d => d && String(d.nom || '').trim() && d.j >= 1 && d.j <= 31 && d.m >= 1 && d.m <= 12)
      .map(d => ({ nom: String(d.nom).trim().slice(0, 40), j: d.j | 0, m: d.m | 0, a: d.a >= 2000 && d.a <= 2100 ? d.a | 0 : 0 })).slice(0, 12) };
  }
  return ignorees;
}
// Lignes du type "Léa 14/03/2005" ou "Mamie 2/11" (l'annee est facultative) : anniversaires, compte a rebours
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
// Sujet ntfy des alertes : il tient lieu de mot de passe, d'ou la longueur minimale (meme regle dans alertes.js)
const SUJET_ALERTES = /^[A-Za-z0-9_-]{10,64}$/;
// Methodes de mise a jour partielle et lettre du plan correspondant (la carte fait le reste)
export const METHODES_PARTIEL = { simple: 'P', double: 'D', inversion: 'I' };
