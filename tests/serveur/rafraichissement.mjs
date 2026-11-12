// Rafraichissement de l'ecran commande par le serveur : plan renvoye a l'envoi de l'apercu (?plan=1)
import { req, post, horloge } from './simu.mjs';
horloge('2026-11-07T17:00:00+01:00');
const L = 120, H = 680, OCTETS = L * H;
// Empreinte FNV-1a 32 bits, comme la carte
const empreinte = o => { let h = 0x811c9dc5; for (const b of o) { h ^= b; h = Math.imul(h, 0x01000193); } return ((h >>> 0) || 1).toString(16).padStart(8, '0'); };
// Image de base : un "tableau de bord" avec des traits et du texte simulé
const base = new Uint8Array(OCTETS);
for (let y = 0; y < H; y++) for (let x = 0; x < L; x++) base[y * L + x] = (y % 97 < 3) || ((x * 7 + y * 3) % 23 === 0) ? 0xFF : 0;
const avec = (img, x0, y0, l, h, v) => { const o = img.slice(); for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + l; x++) o[y * L + x] = v; return o; };
let affichee = null;   // image a l'ecran, selon la carte
const envoyer = async (img, opts = {}) => {
  const q = new URLSearchParams({ plan: '1', r: String(opts.r ?? 0), crc: opts.crc ?? (affichee ? empreinte(affichee) : '00000000'),
    dc: String(opts.dc ?? 3600), pr: String(opts.pr ?? 3600), np: String(opts.np ?? 0) });
  const rep = await req('/api/apercu?' + q, { method: 'POST', body: img });
  return new Uint8Array(await rep.arrayBuffer());
};
// Ce que fait la carte avec le plan, sur un ecran simule (memoires "precedente" et "courante" du controleur)
const appliquer = (plan, nouv, ecran) => {
  const t = String.fromCharCode(plan[0]);
  if (t === 'R') return { t, ecran };
  if (t === 'C' || t === 'N') return { t, ecran: nouv.slice() };
  const v = new DataView(plan.buffer, plan.byteOffset), prec = nouv.slice(), zones = [];
  let i = 2;
  for (let k = 0; k < plan[1]; k++) {
    const x = v.getUint16(i, true), y = v.getUint16(i + 2, true), w = v.getUint16(i + 4, true), h = v.getUint16(i + 6, true);
    i += 8; zones.push(x + ',' + y + ' ' + w + 'x' + h);
    for (let r = 0; r < h; r++) { prec.set(plan.subarray(i, i + w / 8), (y + r) * L + x / 8); i += w / 8; }
  }
  if (i !== plan.length) throw new Error('plan mal forme');
  // mise a jour differentielle : seuls les pixels ou "precedente" et "courante" different bougent
  const passe = (e, pr, co) => { for (let k = 0; k < OCTETS; k++) { const d = pr[k] ^ co[k]; e[k] = (e[k] & ~d) | (co[k] & d); } };
  const e = ecran.slice();
  if (t === 'I') {          // zones en negatif, puis retour : tous les pixels des zones bougent deux fois
    const neg = nouv.slice();
    for (const z of zones) { const [x, y, w, h] = z.split(/[ ,x]/).map(Number);
      for (let r = 0; r < h; r++) for (let c = 0; c < w / 8; c++) { const k = (y + r) * L + x / 8 + c; neg[k] = ~nouv[k] & 0xFF; } }
    passe(e, nouv, neg); passe(e, neg, nouv);
  } else { const n = { P: 1, D: 2, T: 3, Q: 4 }[t]; for (let k = 0; k < n; k++) passe(e, prec, nouv); }
  return { t, ecran: e, zones, octets: plan.length };
};
const etape = async (nom, img, opts) => {
  const plan = await envoyer(img, opts);
  const r = appliquer(plan, img, affichee || new Uint8Array(OCTETS).fill(0x55));
  const juste = r.ecran.every((b, k) => b === img[k]);
  console.log(nom.padEnd(28), ':', r.t, r.zones ? '| zones ' + r.zones.join(' ; ') + ' | ' + r.octets + ' octets' : '', '| écran juste :', juste);
  affichee = r.ecran;
};
await post({ mode: 'tableau', scenes: [], disposition: [{ id: 'date', x: 0, y: 0, w: 12, h: 1 }] });
await etape('démarrage', base);
await etape('image identique', base);
const temp = avec(base, 12, 200, 8, 40, 0xAA);               // une température change (64 x 40 px)
await etape('température', temp);
const deux = avec(avec(temp, 2, 30, 3, 20, 0x0F), 100, 600, 10, 30, 0xF0);   // deux endroits éloignés
await etape('deux zones', deux);
let points = deux;                                            // 20 petits changements dispersés
for (let k = 0; k < 20; k++) points = avec(points, (k * 37) % 118, (k * 113) % 670, 1, 2, k + 1);
await etape('dispersé (8 zones au plus)', points);
await etape('moitié de l\'écran', avec(points, 0, 0, 120, 340, 0x33));
await etape('empreinte fausse', avec(affichee, 50, 50, 2, 2, 0x81), { crc: 'deadbeef' });
await etape('24 h sans complet', avec(affichee, 60, 60, 2, 2, 0x18), { dc: 23 * 3600, pr: 3601 });
await etape('orientation changée', avec(affichee, 70, 70, 2, 2, 0x24), { r: 1 });
await post({ rafraich: { partiel: false } });
await etape('partiel désactivé', avec(affichee, 80, 80, 2, 2, 0x42));
await post({ rafraich: { partiel: true }, mode: 'photo' });
await etape('mode photo', avec(affichee, 90, 90, 2, 2, 0x99));
await post({ mode: 'tableau' });
// Méthodes : changer de méthode nettoie l'écran (N), puis les mises à jour partielles portent sa lettre
await etape('mise en route', avec(affichee, 100, 100, 2, 2, 0x5A));
await post({ rafraich: { methode: 'inversion' } });
await etape('méthode changée', avec(affichee, 12, 200, 8, 40, 0x3C));
await etape('inversion', avec(affichee, 12, 200, 8, 40, 0xC3));
await post({ rafraich: { methode: 'double', maxPartiels: 3 } });
await etape('méthode double', avec(affichee, 20, 300, 2, 2, 0x11));
await etape('double', avec(affichee, 20, 300, 2, 2, 0x22));
await etape('après 3 partielles', avec(affichee, 20, 300, 2, 2, 0x44), { np: 3 });
await post({ rafraich: { methode: 'quadruple', maxPartiels: 0 } });
await etape('méthode quadruple', avec(affichee, 30, 400, 2, 2, 0x11));
await etape('quadruple', avec(affichee, 30, 400, 2, 2, 0x66));
await post({ rafraich: { methode: 'simple', maxPartiels: 0 } });
// Ancienne carte (sans ?plan=1) : réponse texte inchangée
console.log('ancienne carte :', await (await req('/api/apercu?r=0', { method: 'POST', body: base })).text());
// Type de la dernière mise à jour, pour la page
affichee = base;
await envoyer(temp);
console.log('en-tête x-plan :', (await req('/api/apercu')).headers.get('x-plan'));
// La carte n'envoie plus une image identique à celle de l'écran : le serveur garde la sienne, et la
// mise à jour suivante reste partielle. Un changement de méthode entre-temps nettoie bien l'écran ensuite.
affichee = temp;
horloge('2026-11-07T18:00:00+01:00');            // un réveil où seule une donnée invisible change : rien n'est envoyé
await etape('après une image non envoyée', avec(temp, 30, 400, 2, 2, 0x77));
await post({ rafraich: { methode: 'double' } });
horloge('2026-11-07T19:00:00+01:00');            // méthode changée, puis un réveil sans envoi
await etape('méthode changée, après saut', avec(affichee, 30, 400, 2, 2, 0x78));
await post({ rafraich: { methode: 'simple' } });
// Réglages : valeurs inconnues ignorées ; intervalle des complets transmis à la carte
await post({ rafraich: { completH: 7, seuil: 99 } });
let cfg = (await (await req('/api/config')).json()).config.rafraich;
console.log('réglages invalides ignorés :', JSON.stringify(cfg));
await post({ rafraich: { completH: 12, seuil: 60 } });
cfg = (await (await req('/api/config')).json()).config.rafraich;
console.log('réglages :', JSON.stringify(cfg), '| cp envoyé à la carte :', (await (await req('/api/etat?ui=1')).json()).cp);
