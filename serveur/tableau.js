// Tableau de bord : assemble les données de chaque bloc pour la carte
import { JOURS_LONGS, MOIS, mural } from './temps.js';
import { GOUTTIERE, ROTATIONS, enPixels, grille, validerDisposition } from './disposition.js';
import { prochainChangementScene, sceneActive } from './scenes.js';
import { prochainsBus } from './bus.js';
import { chargerMeteo, meteo } from './meteo.js';
import { agenda } from './agenda.js';
import { grandPrix } from './f1.js';
import { compteARebours } from './rebours.js';

// ---------------------------------------------------------------------
//  Tableau de bord : date + meteo + agenda
// ---------------------------------------------------------------------
// forcer : numero de la scene a afficher (-1 = Par defaut) ; absent = scene active a cet instant
export async function construireTableau(cfg, maintenant, env, forcer = null) {
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
  if (presents.has('rebours')) res.rebours = compteARebours(cfg.rebours, maintenant);
  if (presents.has('bus')) {
    res.bus = await pBus;
    // Les minutes restantes ne sont pas affichees : on les retire pour que la signature
    // ne change pas a chaque minute (sinon l'ecran clignoterait a chaque reveil)
    for (const p of res.bus.passages || []) delete p.m;
  }
  return res;
}
