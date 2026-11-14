// À faire : tâches saisies sur la page web, et liste envoyée par un raccourci iPhone (app Rappels)
import { pourEcran } from './commun.js';

export const MAX_TACHES = 20;
// Une tache par ligne ou par element ; les puces et cases a cocher recopiees ("- ", "• ", "[ ] ") sont retirees
export function nettoyerTaches(source) {
  const lignes = Array.isArray(source) ? source : String(source || '').split(/\r?\n/);
  return lignes.map(l => String(l === null || l === undefined ? '' : l).replace(/^\s*(?:[-*•◦]|\[[ xX]?\])\s+/, '').replace(/\s+/g, ' ').trim().slice(0, 80))
    .filter(Boolean).slice(0, MAX_TACHES);
}
// Corps envoye par le raccourci : du texte (une tache par ligne), ou du JSON : une liste, ou
// { taches: ... } avec une liste ou un texte d'une tache par ligne (ce que l'app Raccourcis envoie
// quand on glisse des rappels dans un champ de texte)
export function lireEnvoi(corps) {
  const t = String(corps || '').trim();
  if (t[0] === '[' || t[0] === '{') {
    try {
      const o = JSON.parse(t);
      if (o && typeof o.taches === 'string') return nettoyerTaches(o.taches);
      const l = Array.isArray(o) ? o : o && Array.isArray(o.taches) ? o.taches : null;
      if (l) return nettoyerTaches(l.map(x => (x && typeof x === 'object' ? x.titre || x.title || x.nom || '' : x)));
    } catch (e) { /* pas du JSON : du texte qui commence par un crochet */ }
  }
  return nettoyerTaches(t);
}
// Lignes du bloc : les taches de la page d'abord, puis celles du raccourci, sans doublon
export function tachesDuBloc(o) {
  const vues = new Set(), res = [];
  for (const t of [].concat((o && o.liste) || [], (o && o.rappels) || [])) {
    const propre = pourEcran(t);
    if (!propre || vues.has(propre.toLowerCase())) continue;
    vues.add(propre.toLowerCase()); res.push(propre);
  }
  return res.slice(0, MAX_TACHES);
}
