// Alertes sur l'iPhone : le serveur surveille le cadre une fois par heure (déclencheur planifié de
// Cloudflare, voir "triggers" dans wrangler.jsonc) et envoie une notification par l'application Bark
// (voir bark.js) quand quelque chose ne va pas :
//  - muet     : le cadre ne donne plus de nouvelles (batterie vide, Wi-Fi perdu, carte bloquée)
//  - batterie : la batterie passe sous le seuil choisi
//  - bus      : les horaires de bus chargés arrivent à leur fin (le bloc Prochains bus deviendrait vide)
// Une notification par problème, puis un rappel tant qu'il dure (une fois par jour ; tous les 3 jours
// pour les bus).
import { json, texte } from './commun.js';
import { notifierBark, nettoyerToken, nettoyerCle, TOKEN_VALIDE, CLE_VALIDE } from './bark.js';
import { lireConfig } from './config.js';
import { finValiditeBus } from './bus.js';
import { JOURS_COURTS, MOIS, deux, mural } from './temps.js';

const RAPPEL_H = { muet: 24, batterie: 24, bus: 72 };

// Pourcentage estime d'apres la tension, pour une carte sans jauge (meme table que la carte et la page)
function pourcentTension(v) {
  const T = [3.3, 3.5, 3.6, 3.65, 3.7, 3.75, 3.8, 3.9, 4.0, 4.1, 4.2], P = [0, 5, 10, 20, 30, 40, 50, 65, 80, 90, 100];
  if (v <= T[0]) return 0;
  for (let i = 0; i < 10; i++) if (v < T[i + 1]) return Math.round(P[i] + (v - T[i]) / (T[i + 1] - T[i]) * (P[i + 1] - P[i]));
  return 100;
}
const quand = t => { const w = mural(t); return JOURS_COURTS[w.js].toLowerCase() + '. ' + w.d + ' ' + MOIS[w.m - 1] + ' à ' + deux(w.hh) + ':' + deux(w.mi); };
const duree = ms => { const h = ms / 3600e3; return h < 48 ? Math.round(h) + ' h' : Math.round(h / 24) + ' jours'; };

// Etat de chaque surveillance : probleme (vrai / faux), titre et message de la notification, et
// info (une ligne pour la page web, qu'il y ait un probleme ou non)
export async function etatAlertes(cfg, env, maintenant) {
  const a = cfg.alertes || {};
  const statut = JSON.parse((await env.CADRE.get('statut')) || 'null');
  const res = [];
  // 1. Cadre muet : pas de contact depuis 3 h, et depuis plus de 2,5 fois son intervalle de reveil
  //    (la nuit ou en heures creuses, il peut dormir 4 h). Pas en mode ecran blanc : le cadre est
  //    alors sans doute range, batterie debranchee.
  if (!statut) res.push({ cle: 'muet', probleme: false, info: "le cadre ne s'est encore jamais connecté" });
  else {
    const age = maintenant - statut.vu;
    const seuil = Math.max(3 * 3600e3, 2.5 * (statut.r || cfg.reveilMin * 60) * 1000);
    const range = cfg.mode === 'blanc';
    res.push({ cle: 'muet', probleme: age > seuil && !range, titre: 'Cadre : plus de nouvelles',
      message: 'Sans nouvelles depuis ' + duree(age) + ' (dernier contact ' + quand(statut.vu) + '). Batterie vide, Wi-Fi perdu ou carte bloquée ?',
      info: range && age > seuil ? 'écran blanc : pas d\'alerte tant que le cadre est rangé'
        : age > seuil ? 'sans nouvelles depuis ' + duree(age) : 'dernier contact ' + quand(statut.vu) });
  }
  // 2. Batterie : pourcentage de la jauge de la carte, sinon estime d'apres la tension ; pas pendant une charge
  const pct = statut && typeof statut.pct === 'number' ? Math.round(Math.min(100, statut.pct))
    : statut && statut.bat > 2.5 ? pourcentTension(statut.bat) : null;
  const seuilBat = [10, 20, 30].includes(+a.seuilBatterie) ? +a.seuilBatterie : 20;
  if (pct === null) res.push({ cle: 'batterie', probleme: false, info: 'pas encore de mesure de la batterie' });
  else {
    const enCharge = statut.crate >= 2;
    // retabli : l'alerte ne repart de zero qu'une fois la batterie rechargee (ou 5 points au-dessus du
    // seuil), pour qu'un pourcentage qui hesite autour du seuil n'envoie pas plusieurs notifications
    res.push({ cle: 'batterie', probleme: pct < seuilBat && !enCharge, retabli: enCharge || pct >= seuilBat + 5, titre: 'Cadre : batterie à ' + pct + ' %',
      message: 'La batterie du cadre est à ' + pct + ' % (seuil : ' + seuilBat + ' %). Pense à le recharger.',
      info: 'batterie à ' + pct + ' %' + (enCharge ? ', en charge' : '') });
  }
  // 3. Horaires de bus : seulement si le bloc Prochains bus est place quelque part
  const dispos = [cfg.disposition, cfg.dispositionPortrait].concat(...(cfg.scenes || []).map(sc => [sc.disposition, sc.dispositionPortrait]));
  const blocBus = dispos.some(l => (l || []).some(d => d.id === 'bus'));
  const fin = blocBus ? await finValiditeBus(env) : '';
  if (!blocBus) res.push({ cle: 'bus', probleme: false, info: 'le bloc Prochains bus n\'est pas utilisé' });
  else if (!fin) res.push({ cle: 'bus', probleme: false, info: 'aucun horaire de bus chargé' });
  else {
    const w = mural(maintenant);
    const jours = Math.round((Date.UTC(+fin.slice(0, 4), +fin.slice(4, 6) - 1, +fin.slice(6, 8)) - Date.UTC(w.y, w.m - 1, w.d)) / 86400e3);
    const date = fin.slice(6, 8) + '/' + fin.slice(4, 6) + '/' + fin.slice(0, 4);
    res.push({ cle: 'bus', probleme: jours < 3, titre: jours < 0 ? 'Cadre : horaires de bus périmés' : 'Cadre : horaires de bus bientôt périmés',
      message: (jours < 0 ? 'Les horaires de bus chargés ne sont plus valables depuis le ' + date + ' : le bloc Prochains bus reste vide.'
        : 'Les horaires de bus chargés s\'arrêtent le ' + date + '.') + ' Recharge-les dans la page du cadre : Prochains bus, puis Choisir mes arrêts.',
      info: jours < 0 ? 'horaires périmés depuis le ' + date : 'horaires valables jusqu\'au ' + date });
  }
  return res;
}

// Destinataire enregistre : Device Token (envoi direct a Apple) et/ou cle Bark (serveur public, secours)
const destinataire = a => ({ token: a.token, cle: a.cle });
const aDestinataire = a => TOKEN_VALIDE.test(nettoyerToken(a.token)) || CLE_VALIDE.test(nettoyerCle(a.cle));
// Importance de chaque alerte dans Bark : « critical » sonne meme en mode silencieux (option de la page,
// pour le cadre muet seulement) ; « timeSensitive » passe les modes Concentration autorises
function niveau(cle, a) {
  if (cle === 'muet') return a.critique ? 'critical' : 'timeSensitive';
  return cle === 'batterie' ? 'timeSensitive' : 'active';
}

// Appelee une fois par heure : envoie les alertes nouvelles et les rappels. Le KV ("alertes") retient la
// date du dernier envoi de chaque alerte en cours ; il n'est ecrit que lorsqu'une alerte part ou cesse.
export async function verifierAlertes(env, maintenant = Date.now()) {
  const cfg = await lireConfig(env);
  const a = cfg.alertes || {};
  if (!a.actif || !aDestinataire(a)) return { envoyees: [] };
  const etats = await etatAlertes(cfg, env, maintenant);
  const memo = JSON.parse((await env.CADRE.get('alertes')) || '{}');
  const envoyees = [];
  let change = false;
  for (const e of etats) {
    const surveille = a[e.cle] !== false;
    try {
      if (surveille && e.probleme) {
        if (memo[e.cle] && maintenant - memo[e.cle] < RAPPEL_H[e.cle] * 3600e3) continue;
        const chemin = await notifierBark(env, destinataire(a), { titre: e.titre, message: e.message, niveau: niveau(e.cle, a) }, maintenant);
        console.log('Alerte envoyée (' + chemin + ') :', e.titre);
        memo[e.cle] = maintenant; change = true; envoyees.push(e.cle);
        if (memo.erreur) { delete memo.erreur; change = true; }
      } else if (memo[e.cle] && (!surveille || e.probleme || e.retabli !== false)) {
        // Le probleme a cesse (ou n'est plus surveille) ; pour le cadre muet, on previent de son retour
        if (surveille && e.cle === 'muet') await notifierBark(env, destinataire(a), { titre: 'Cadre : de retour', message: 'Le cadre répond à nouveau (' + e.info + ').', niveau: 'active' }, maintenant);
        delete memo[e.cle]; change = true;
      }
    } catch (err) {
      console.log('Alerte « ' + e.cle + ' » non envoyée :', err.message);
      // Retenue pour la page web (Device Token perime, par exemple) ; ecrite seulement si elle change
      if (!memo.erreur || memo.erreur.m !== err.message) { memo.erreur = { t: maintenant, m: err.message }; change = true; }
    }
  }
  if (change) { try { await env.CADRE.put('alertes', JSON.stringify(memo)); } catch (e) { /* limite d'ecriture : renvoyee dans une heure */ } }
  return { envoyees };
}

// --- Page web : etat des surveillances, notification d'essai (personnes connectees seulement) ---
export async function routeEtatAlertes(env) {
  const cfg = await lireConfig(env);
  const etats = await etatAlertes(cfg, env, Date.now());
  const memo = JSON.parse((await env.CADRE.get('alertes')) || '{}');
  return json({ etats: etats.map(e => ({ cle: e.cle, probleme: e.probleme, info: e.info, envoyee: memo[e.cle] || 0 })), erreur: memo.erreur || null });
}
// Essai avec les champs de la page, enregistres ou non. critique : essai d'une alerte critique
export async function routeEssaiAlerte(req, env) {
  let d = {};
  try { d = (await req.json()) || {}; } catch (e) { /* corps vide */ }
  const dest = { token: nettoyerToken(d.token), cle: nettoyerCle(d.cle) };
  if (dest.token && !TOKEN_VALIDE.test(dest.token)) return texte('Device Token invalide : copie-le dans Bark, Settings → Device Token (64 caractères 0-9 et a-f)', 400);
  if (dest.cle && !CLE_VALIDE.test(dest.cle)) return texte('Clé Bark invalide : copie-la dans Bark, Service → Copy Key', 400);
  if (!dest.token && !dest.cle) return texte('Colle d\'abord le Device Token de Bark', 400);
  let chemin;
  try {
    chemin = await notifierBark(env, dest, { titre: 'Cadre : essai', message: 'Les alertes du cadre arrivent bien sur cet appareil.', niveau: d.critique ? 'critical' : 'active' });
  } catch (e) { return texte('Envoi impossible : ' + e.message, 502); }
  return json({ ok: true, chemin });
}
