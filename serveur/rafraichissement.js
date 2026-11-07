// Rafraîchissement de l'écran commandé par le serveur : zones modifiées et plan envoyé à la carte
import { HAUTEUR, LARGEUR } from './commun.js';
import { CONFIG_DEFAUT, METHODES_PARTIEL } from './config.js';

// ---------------------------------------------------------------------
//  Rafraichissement de l'ecran, commande par le serveur
//
//  Le controleur de l'ecran garde deux images : la "precedente" (ce qui est affiche) et la "courante"
//  (la nouvelle). En mise a jour partielle, il ne fait bouger que les pixels qui different, sans
//  clignotement (~0,6 s au lieu de 4,5 s). Mais sa memoire est perdue pendant la veille : la carte doit
//  lui redonner l'image affichee. Elle ne la garde pas ; le serveur, si (la derniere image recue), et il
//  envoie l'ancien contenu des seules zones qui changent.
//  Securite : la carte garde l'empreinte de l'image vraiment affichee (memoire RTC) et l'envoie ; si elle
//  ne correspond pas a l'image du serveur (rafraichissement rate, reporte...), rafraichissement complet.
//
//  Plans : R rien (image identique), P partiel (zones), C complet, N complet avec nettoyage (l'ecran
//  passe d'abord au blanc : au demarrage de la carte et au moins une fois par jour, comme le conseille
//  le fabricant).
// ---------------------------------------------------------------------
const OCTETS_LIGNE = LARGEUR / 8;            // 120 octets par ligne (1 bit par pixel, 1 = noir)
const CASE_L = 8, CASE_H = 40;               // cases de 64 x 40 pixels pour regrouper les differences
const NCX = OCTETS_LIGNE / CASE_L, NCY = HAUTEUR / CASE_H;   // 15 x 17 cases
const ZONES_MAX = 8;
// Empreinte d'une image (FNV-1a 32 bits, calculee de la meme facon par la carte ; 0 = "inconnue")
export function empreinteImage(octets) {
  let h = 0x811c9dc5;
  for (let i = 0; i < octets.length; i++) { h ^= octets[i]; h = Math.imul(h, 0x01000193); }
  return ((h >>> 0) || 1).toString(16).padStart(8, '0');
}
// Rectangles (en pixels, x et largeur multiples de 8) qui contiennent toutes les differences entre a et b
function zonesModifiees(a, b) {
  // 1. Dans chaque case, les bornes exactes des octets qui different
  const bornes = new Array(NCX * NCY).fill(null);
  for (let y = 0; y < HAUTEUR; y++) {
    const ligne = y * OCTETS_LIGNE, cy = (y / CASE_H) | 0;
    for (let x = 0; x < OCTETS_LIGNE; x++) {
      if (a[ligne + x] === b[ligne + x]) continue;
      const c = cy * NCX + ((x / CASE_L) | 0), z = bornes[c];
      if (!z) bornes[c] = { x0: x, x1: x, y0: y, y1: y };
      else { if (x < z.x0) z.x0 = x; if (x > z.x1) z.x1 = x; z.y1 = y; }
    }
  }
  // 2. Les cases voisines (diagonales comprises) forment une zone
  const union = (p, q) => ({ x0: Math.min(p.x0, q.x0), x1: Math.max(p.x1, q.x1), y0: Math.min(p.y0, q.y0), y1: Math.max(p.y1, q.y1) });
  const zones = [], vu = new Uint8Array(NCX * NCY);
  for (let c = 0; c < bornes.length; c++) {
    if (!bornes[c] || vu[c]) continue;
    let z = bornes[c];
    const pile = [c];
    vu[c] = 1;
    while (pile.length) {
      const k = pile.pop(), kx = k % NCX, ky = (k / NCX) | 0;
      z = union(z, bornes[k]);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = kx + dx, ny = ky + dy, n = ny * NCX + nx;
          if (nx < 0 || ny < 0 || nx >= NCX || ny >= NCY || vu[n] || !bornes[n]) continue;
          vu[n] = 1;
          pile.push(n);
        }
      }
    }
    zones.push(z);
  }
  // 3. Zones qui se chevauchent fusionnees ; au-dela de ZONES_MAX, on fusionne celles dont l'union
  //    ajoute le moins de surface
  const aire = z => (z.x1 - z.x0 + 1) * (z.y1 - z.y0 + 1);
  const chevauche = (p, q) => p.x0 <= q.x1 && q.x0 <= p.x1 && p.y0 <= q.y1 && q.y0 <= p.y1;
  for (;;) {
    let fusion = false;
    for (let i = 0; i < zones.length && !fusion; i++) {
      for (let j = i + 1; j < zones.length && !fusion; j++) {
        if (chevauche(zones[i], zones[j])) { zones[i] = union(zones[i], zones[j]); zones.splice(j, 1); fusion = true; }
      }
    }
    if (fusion) continue;
    if (zones.length <= ZONES_MAX) break;
    let mi = 0, mj = 1, cout = Infinity;
    for (let i = 0; i < zones.length; i++) {
      for (let j = i + 1; j < zones.length; j++) {
        const c = aire(union(zones[i], zones[j])) - aire(zones[i]) - aire(zones[j]);
        if (c < cout) { cout = c; mi = i; mj = j; }
      }
    }
    zones[mi] = union(zones[mi], zones[mj]);
    zones.splice(mj, 1);
  }
  return zones.sort((p, q) => p.y0 - q.y0 || p.x0 - q.x0)
    .map(z => ({ x: z.x0 * 8, y: z.y0, w: (z.x1 - z.x0 + 1) * 8, h: z.y1 - z.y0 + 1 }));
}
// Comment rafraichir l'ecran. p : crc (empreinte de l'image affichee selon la carte), dc (secondes depuis
// le dernier rafraichissement complet), pr (secondes avant le prochain reveil), np (mises a jour partielles
// depuis le dernier complet), r (orientation).
export function planRafraichissement(prec, metaPrec, nouv, p, cfg) {
  const R = Object.assign({}, CONFIG_DEFAUT.rafraich, cfg.rafraich || {});
  const crc = String(p.crc).toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(crc) || crc === '00000000') return { type: 'N', raison: 'demarrage' };
  if (p.dc + p.pr > R.completH * 3600) return { type: 'N', raison: 'quotidien' };
  if (!R.partiel) return { type: 'C', raison: 'desactive' };
  const lettre = METHODES_PARTIEL[R.methode] || 'P';
  // Methode changee depuis la derniere image : on repart d'un ecran propre pour pouvoir comparer
  if (metaPrec && metaPrec.m && metaPrec.m !== lettre) return { type: 'N', raison: 'methode' };
  if (cfg.mode !== 'tableau') return { type: 'C', raison: 'mode' };      // photo, pochette : images tramees
  if (!prec || ((metaPrec && metaPrec.h) || empreinteImage(prec)) !== crc) return { type: 'C', raison: 'inconnue' };
  if (metaPrec && metaPrec.r !== undefined && metaPrec.r !== p.r) return { type: 'C', raison: 'orientation' };
  const zones = zonesModifiees(prec, nouv);
  if (!zones.length) return { type: 'R' };
  const part = zones.reduce((s, z) => s + z.w * z.h, 0) / (LARGEUR * HAUTEUR) * 100;
  if (part > R.seuil) return { type: 'C', raison: 'seuil', part };
  if (R.maxPartiels && p.np >= R.maxPartiels) return { type: 'C', raison: 'serie' };
  return { type: lettre, zones, part };
}
// Reponse binaire lue par la carte : 1 octet (R, C, N), ou la lettre de la methode partielle (P, D, I),
// le nombre de zones, puis pour chaque zone x, y, largeur, hauteur (2 octets chacun, petit-boutiste) et
// l'ancien contenu de la zone, ligne par ligne
export function encoderPlan(plan, prec) {
  if (!plan.zones) return new Uint8Array([plan.type.charCodeAt(0)]);
  let taille = 2;
  for (const z of plan.zones) taille += 8 + (z.w / 8) * z.h;
  const o = new Uint8Array(taille), v = new DataView(o.buffer);
  o[0] = plan.type.charCodeAt(0); o[1] = plan.zones.length;
  let i = 2;
  for (const z of plan.zones) {
    v.setUint16(i, z.x, true); v.setUint16(i + 2, z.y, true); v.setUint16(i + 4, z.w, true); v.setUint16(i + 6, z.h, true);
    i += 8;
    const debut = z.x / 8, wb = z.w / 8;
    for (let y = z.y; y < z.y + z.h; y++) { o.set(prec.subarray(y * OCTETS_LIGNE + debut, y * OCTETS_LIGNE + debut + wb), i); i += wb; }
  }
  return o;
}
// Resume pour la page web (en-tete x-plan de l'apercu) : "P;2;3" (partiel simple, 2 zones, 3 % de l'ecran ;
// D double, I inversion), "C;seuil", "N;quotidien", "R"
export function resumePlan(plan) {
  if (plan.zones) return plan.type + ';' + plan.zones.length + ';' + Math.max(1, Math.round(plan.part));
  return plan.type + (plan.raison ? ';' + plan.raison : '');
}
