// Créneaux, nuit et scènes : ce qui s'affiche selon le moment
import { TZ, dateDuJour, mural, versUTC } from './temps.js';
import { grille, validerDisposition } from './disposition.js';

// --- Creneaux d'affichage des bus (ex. vendredi 18h-20h) ---
const enMinutes = s => { const [h, m] = String(s || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
function listeCreneaux(o) {
  if (Array.isArray(o.creneaux)) return o.creneaux;
  return o.jours ? [{ jours: o.jours, debut: o.debut, fin: o.fin }] : [];   // anciens reglages
}
export function dansCreneau(o, maintenant) {
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
// Intervalle de reveil (s) : la nuit et pendant les heures creuses, reveil espace, et cale sur la fin de la periode
export function reveilNuit(cfg, maintenant, normal) {
  const n = cfg.nuit, depuis = dansNuit(n, maintenant);
  if (depuis >= 0) {
    const w = mural(maintenant);
    const resteS = ((enMinutes(n.fin) - (w.hh * 60 + w.mi) + 1440) % 1440) * 60 - w.ss;
    const inter = Math.max(15, Math.min(240, n.intervalleMin || 60)) * 60;
    return Math.max(60, Math.min(inter, resteS + 5));
  }
  // Heures creuses : meme principe, sur des plages jours + heures (elles ne passent pas minuit) ;
  // jamais plus souvent que le rythme normal
  const c = cfg.creuses;
  if (c && c.actif) {
    const w = mural(maintenant), jour = (w.js + 6) % 7, min = w.hh * 60 + w.mi;
    const plage = (c.creneaux || []).find(x => (x.jours || [])[jour] && min >= enMinutes(x.debut) && min < enMinutes(x.fin));
    if (plage) {
      const resteS = (enMinutes(plage.fin) - min) * 60 - w.ss;
      const inter = Math.max(normal, Math.max(15, Math.min(240, c.intervalleMin || 60)) * 60);
      return Math.max(60, Math.min(inter, resteS + 5));
    }
  }
  return normal;
}
export function texteCreneaux(o) {
  const J = ['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'];
  return listeCreneaux(o).map(c => J.filter((x, i) => (c.jours || [])[i]).join(', ') + ' ' +
    String(c.debut).replace(':', 'h') + '-' + String(c.fin).replace(':', 'h')).join(' ; ');
}
// --- Scenes ---
const heureOK = h => (/^\d{1,2}:\d{2}$/.test(String(h)) ? String(h) : null);
const dateOK = d => (/^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) ? String(d) : '');
export function validerCreneaux(liste) {
  return (Array.isArray(liste) ? liste : []).map(c => ({
    jours: [0, 1, 2, 3, 4, 5, 6].map(i => (c && c.jours || [])[i] ? 1 : 0),
    debut: heureOK(c && c.debut) || '07:00', fin: heureOK(c && c.fin) || '08:00',
  })).filter(c => c.jours.some(Boolean) && enMinutes(c.fin) > enMinutes(c.debut)).slice(0, 8);
}
export function validerScenes(liste, ecrans) {
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
// Une scene est active si toutes ses conditions sont remplies (sans condition : toujours active)
export function sceneActive(sc, maintenant, gp) {
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
export function prochainChangementScene(scenes, maintenant, gp) {
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
