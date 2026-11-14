// Disposition des blocs sur la grille de l'écran (taille, position, orientation)
import { HAUTEUR, LARGEUR } from './commun.js';

// --- Grille de disposition (memes valeurs dans l'interface web) ---
export const MARGE = 24, GOUTTIERE = 16;
const WIDGETS = {               // taille minimale de chaque widget (en cases)
  date: { w: 3, h: 1 }, meteo: { w: 4, h: 2 }, heures: { w: 4, h: 2 }, jours: { w: 3, h: 2 }, agenda: { w: 3, h: 1 }, bus: { w: 3, h: 2 },
  courbe: { w: 4, h: 2 }, f1: { w: 3, h: 2 }, f1meteo: { w: 3, h: 2 }, rebours: { w: 3, h: 1 },
  astro: { w: 3, h: 1 }, mois: { w: 3, h: 3 },
};
export const ROTATIONS = [0, 1, 3];
// Taille et police du texte, reglables bloc par bloc
const TAILLES = { S: 0.8, M: 1, L: 1.25, XL: 1.5 };
const POLICES = ['moderne', 'helvetica', 'classique', 'machine'];    // 0 = paysage, 1 = portrait, 3 = portrait inverse
// Grille selon l'orientation : 12 x 8 cases en paysage, 8 x 12 en portrait
// Avec deux ecrans, la grille est doublee (24 x 8 cote a cote, 12 x 16 l'un sur l'autre en paysage) ;
// pc x pr = cases d'une dalle. Un bloc ne peut pas etre a cheval sur la jointure.
export function grille(rotation, ecrans) {
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
export function enPixels(d, g) {
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
export function validerDisposition(liste, g) {
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
