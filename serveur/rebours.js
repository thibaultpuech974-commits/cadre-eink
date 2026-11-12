// Compte à rebours : jours restants avant les dates choisies sur la page web (vacances, concours…)
import { pourEcran } from './commun.js';
import { JOURS_COURTS, MOIS, mural } from './temps.js';

// Dates à venir, la plus proche d'abord (4 au plus) : n = jours restants (0 = aujourd'hui), t = titre,
// d = date en clair ("sam. 19 décembre"). Une date sans année revient chaque année ; une date passée
// n'est plus affichée. Le calcul se fait sur les jours du calendrier (heure de Paris), sans heures :
// il ne bouge pas aux changements d'heure.
export function compteARebours(o, maintenant) {
  const auj = mural(maintenant), jour0 = Date.UTC(auj.y, auj.m - 1, auj.d);
  const res = [];
  for (const d of (o && Array.isArray(o.liste) ? o.liste : [])) {
    let y = d.a || auj.y;
    let t = Date.UTC(y, d.m - 1, d.j);
    if (!d.a && t < jour0) t = Date.UTC(++y, d.m - 1, d.j);
    if (t < jour0) continue;
    const w = new Date(t);
    res.push({ n: Math.round((t - jour0) / 86400e3), t: pourEcran(d.nom),
      d: JOURS_COURTS[w.getUTCDay()].toLowerCase() + '. ' + w.getUTCDate() + ' ' + MOIS[w.getUTCMonth()] + (y !== auj.y ? ' ' + y : '') });
  }
  return res.sort((a, b) => a.n - b.n).slice(0, 4);
}
