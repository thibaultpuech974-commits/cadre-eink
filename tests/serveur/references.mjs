// Images de référence : chaque jeu de test de tests/rendu (d_*.json, un état comme /api/etat) est dessiné par
// le code de la carte (dessin.h, compilé dans serveur/apercu.wasm) et comparé, point par point, à l'image
// enregistrée dans tests/rendu/references/. Un seul point qui bouge fait échouer le test : une modification
// du dessin ne peut plus changer un autre bloc sans que ça se voie.
//
//   npm test               compare (avec tous les autres tests)
//   npm run references     enregistre les images actuelles comme nouvelles références, après un changement voulu
//
// En cas d'écart, tests/rendu/ecarts/<jeu>.png montre où : gris = inchangé, rouge = disparu, bleu = apparu.
import fs from 'fs';
import zlib from 'zlib';
import { fileURLToPath } from 'url';
const racine = fileURLToPath(new URL('../../', import.meta.url));
const RENDU = racine + 'tests/rendu/', REFS = RENDU + 'references/', ECARTS = RENDU + 'ecarts/';
const L = 960, H = 680, OCTETS = L * H / 8, TENSION = 4.02;
const enregistrer = process.argv.includes('--enregistrer');

// --- Le dessin de la carte, en WebAssembly (le même module que la prévisualisation de la page) ---
let mem;
const v = () => new DataView(mem.buffer);
const wasi = { fd_prestat_get: () => 8, fd_prestat_dir_name: () => 8, fd_close: () => 0, fd_fdstat_get: () => 0, fd_seek: () => 0,
  fd_write: (fd, iovs, n, pE) => { let t = 0; for (let i = 0; i < n; i++) t += v().getUint32(iovs + 8 * i + 4, true); v().setUint32(pE, t, true); return 0; },
  clock_time_get: (a, b, p) => { v().setBigUint64(p, 0n, true); return 0; }, poll_oneoff: () => 52, proc_exit: c => { throw new Error('exit ' + c); } };
const { instance } = await WebAssembly.instantiate(fs.readFileSync(racine + 'serveur/apercu.wasm'), { wasi_snapshot_preview1: wasi });
mem = instance.exports.memory; instance.exports._initialize();
// Dessine un état et renvoie l'image à l'endroit : { l, h, noir } (noir : un octet par point, 1 = noir)
function dessiner(texte) {
  const json = new TextEncoder().encode(texte), p = instance.exports.zone(json.length);
  new Uint8Array(mem.buffer, p, json.length).set(json);
  const adresse = instance.exports.dessiner(json.length, TENSION);
  if (!adresse) throw new Error('état illisible (JSON)');
  const bits = new Uint8Array(mem.buffer, adresse, OCTETS);
  const point = (x, y) => (bits[y * (L / 8) + (x >> 3)] >> (7 - (x & 7))) & 1;
  // La carte dessine dans une image 960 x 680 ; en portrait (rotation 1 ou 3), on la redresse pour la regarder
  const rot = JSON.parse(texte).rotation || 0, portrait = rot === 1 || rot === 3;
  const l = portrait ? H : L, h = portrait ? L : H, noir = new Uint8Array(l * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < l; x++)
    noir[y * l + x] = rot === 1 ? point(L - 1 - y, x) : rot === 3 ? point(y, H - 1 - x) : rot === 2 ? point(L - 1 - x, H - 1 - y) : point(x, y);
  return { l, h, noir };
}

// --- Fichiers PNG (écrits et relus ici, sans bibliothèque) ---
const TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = o => { let c = 0xFFFFFFFF; for (const x of o) c = TABLE[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function bloc(type, donnees) {
  const b = Buffer.alloc(12 + donnees.length);
  b.writeUInt32BE(donnees.length, 0); b.write(type, 4, 'latin1'); Buffer.from(donnees).copy(b, 8);
  b.writeUInt32BE(crc(b.subarray(4, 8 + donnees.length)), 8 + donnees.length);
  return b;
}
// valeurs : un octet par point (0 à 2^bits - 1) ; palette : couleurs [r, v, b] (sinon niveaux de gris)
function ecrirePNG(l, h, valeurs, bits, palette) {
  const parLigne = Math.ceil(l * bits / 8), brut = Buffer.alloc((parLigne + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < l; x++)
    brut[y * (parLigne + 1) + 1 + ((x * bits) >> 3)] |= valeurs[y * l + x] << (8 - bits - ((x * bits) & 7));
  const entete = Buffer.alloc(13);
  entete.writeUInt32BE(l, 0); entete.writeUInt32BE(h, 4); entete[8] = bits; entete[9] = palette ? 3 : 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), bloc('IHDR', entete),
    ...(palette ? [bloc('PLTE', Buffer.from(palette.flat()))] : []), bloc('IDAT', zlib.deflateSync(brut, { level: 9 })), bloc('IEND', Buffer.alloc(0))]);
}
// Relit une référence (noir et blanc, 1 bit par point) : { l, h, noir }
function lirePNG(octets) {
  let l = 0, h = 0, idat = [];
  for (let p = 8; p < octets.length;) {
    const n = octets.readUInt32BE(p), type = octets.toString('latin1', p + 4, p + 8), d = octets.subarray(p + 8, p + 8 + n);
    if (type === 'IHDR') { l = d.readUInt32BE(0); h = d.readUInt32BE(4); if (d[8] !== 1 || d[9] !== 0 || d[12] !== 0) throw new Error('format inattendu (il faut du noir et blanc, 1 bit par point)'); }
    if (type === 'IDAT') idat.push(d);
    p += 12 + n;
  }
  const brut = zlib.inflateSync(Buffer.concat(idat)), parLigne = Math.ceil(l / 8), noir = new Uint8Array(l * h);
  let avant = new Uint8Array(parLigne);
  for (let y = 0; y < h; y++) {
    const filtre = brut[y * (parLigne + 1)], ligne = Uint8Array.from(brut.subarray(y * (parLigne + 1) + 1, (y + 1) * (parLigne + 1)));
    for (let i = 0; i < parLigne; i++) {               // filtres PNG (un logiciel d'images peut en avoir mis)
      const a = i ? ligne[i - 1] : 0, b = avant[i], c = i ? avant[i - 1] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      ligne[i] += filtre === 1 ? a : filtre === 2 ? b : filtre === 3 ? (a + b) >> 1 : filtre === 4 ? (pa <= pb && pa <= pc ? a : pb <= pc ? b : c) : 0;
    }
    for (let x = 0; x < l; x++) noir[y * l + x] = 1 - ((ligne[x >> 3] >> (7 - (x & 7))) & 1);   // dans le fichier, 1 = blanc
    avant = ligne;
  }
  return { l, h, noir };
}
const fichierReference = im => ecrirePNG(im.l, im.h, im.noir.map(n => 1 - n), 1);

// --- Comparaison ---
const jeux = fs.readdirSync(RENDU).filter(f => /^d_.+\.json$/.test(f)).sort().map(f => f.slice(2, -5));
if (!jeux.length) throw new Error('aucun jeu de test dans tests/rendu');
if (enregistrer) fs.mkdirSync(REFS, { recursive: true });
fs.rmSync(ECARTS, { recursive: true, force: true });
let identiques = 0, changes = 0;
for (const jeu of jeux) {
  const image = dessiner(fs.readFileSync(RENDU + 'd_' + jeu + '.json', 'utf8'));
  // (le même état redonne la même image : sinon la comparaison ne voudrait rien dire)
  const encore = dessiner(fs.readFileSync(RENDU + 'd_' + jeu + '.json', 'utf8'));
  if (image.noir.some((n, i) => n !== encore.noir[i])) { console.log('INSTABLE ' + jeu + ' : deux dessins du même état diffèrent'); continue; }
  const chemin = REFS + jeu + '.png';
  let ref = null;
  try { if (fs.existsSync(chemin)) ref = lirePNG(fs.readFileSync(chemin)); } catch (e) { console.log('ILLISIBLE ' + jeu + '.png : ' + e.message); }
  let ecarts = -1, x0 = image.l, x1 = -1, y0 = image.h, y1 = -1;
  if (ref && ref.l === image.l && ref.h === image.h) {
    ecarts = 0;
    for (let i = 0; i < image.noir.length; i++) if (image.noir[i] !== ref.noir[i]) {
      ecarts++; const x = i % image.l, y = (i - x) / image.l;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (ecarts === 0) { identiques++; continue; }
  if (enregistrer) {
    fs.writeFileSync(chemin, fichierReference(image)); changes++;
    console.log((ref ? 'mise à jour  ' : 'nouvelle     ') + jeu + (ecarts > 0 ? ' : ' + ecarts + ' points changés' : ''));
    continue;
  }
  if (!ref) { console.log('MANQUANTE ' + jeu + ' : pas d\'image de référence'); continue; }
  fs.mkdirSync(ECARTS, { recursive: true });
  if (ecarts < 0) {
    fs.writeFileSync(ECARTS + jeu + '.png', fichierReference(image));
    console.log('DIFFÉRENT ' + jeu + ' : image de ' + image.l + ' x ' + image.h + ', référence de ' + ref.l + ' x ' + ref.h + ' (nouvelle image : tests/rendu/ecarts/' + jeu + '.png)');
    continue;
  }
  // Image des écarts : gris = noir inchangé, rouge = noir disparu, bleu = noir apparu
  const couleurs = image.noir.map((n, i) => n && ref.noir[i] ? 1 : ref.noir[i] ? 2 : n ? 3 : 0);
  fs.writeFileSync(ECARTS + jeu + '.png', ecrirePNG(image.l, image.h, couleurs, 2, [[255, 255, 255], [190, 190, 190], [220, 30, 30], [20, 90, 230]]));
  console.log('DIFFÉRENT ' + jeu + ' : ' + ecarts + ' points changés, de x ' + x0 + ' à ' + x1 + ' et de y ' + y0 + ' à ' + y1 + ' (voir tests/rendu/ecarts/' + jeu + '.png)');
}
// Une référence dont le jeu de test n'existe plus
const orphelines = fs.existsSync(REFS) ? fs.readdirSync(REFS).filter(f => f.endsWith('.png') && !jeux.includes(f.slice(0, -4))) : [];
for (const f of orphelines) {
  if (enregistrer) { fs.rmSync(REFS + f); console.log('supprimée    ' + f.slice(0, -4) + ' (son jeu de test n\'existe plus)'); }
  else console.log('ORPHELINE ' + f + ' : son jeu de test n\'existe plus');
}
if (enregistrer) console.log('images de référence : ' + changes + ' enregistrée(s), ' + identiques + ' inchangée(s)');
else {
  console.log('images de référence : ' + identiques + ' sur ' + jeux.length + ' identiques' + (orphelines.length ? ', ' + orphelines.length + ' en trop' : ''));
  if (identiques < jeux.length || orphelines.length) console.log('-> si le changement du dessin est voulu, regarde les écarts puis enregistre les nouvelles références :  npm run references');
}
