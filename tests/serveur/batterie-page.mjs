// Page web, menu Batterie : périodes de charge et estimation de l'autonomie (fonctions de serveur/page/batterie.html et etat.html)
import fs from 'fs';
const page = ['etat', 'batterie'].map(f => fs.readFileSync('../../serveur/page/' + f + '.html', 'utf8')).join('\n');
const extrait = nom => {
  const i = page.indexOf('function ' + nom + '(');
  for (let k = page.indexOf('{', i), n = 0; k < page.length; k++) {
    if (page[k] === '{') n++;
    if (page[k] === '}' && --n === 0) return page.slice(i, k + 1);
  }
};
const { periodesCharge, estimation, eveilParJour, enMinSec } = new Function(['pourcentage', 'pctPoint', 'periodesCharge', 'estimation', 'eveilParJour', 'enMinSec'].map(extrait).join('\n') +
  '\nreturn { pourcentage, periodesCharge, estimation, eveilParJour, enMinSec };')();
const min = iso => Math.floor(Date.parse(iso) / 60000);
// Heure d'hiver de Paris (UTC+1), sans dépendre des données de langue de la machine qui lance les tests
const heure = m => { const d = new Date((m + 60) * 60000), p = n => String(n).padStart(2, '0');
  return ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'][d.getUTCDay()] + ' ' + p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()); };
let graine = 7;
const bruit = a => { graine = (graine * 16807) % 2147483647; return Math.round(((graine / 2147483647) * 2 - 1) * a); };
const charges = pts => periodesCharge(pts).map(c => heure(c[0]) + ' -> ' + heure(c[1]) + (c[2] ? ' (en cours)' : '')).join(' ; ') || 'aucune';
const autonomie = pts => { const e = estimation(pts); return e ? (-e.pente).toFixed(1) + ' %/jour' : 'attente'; };

// 1. Les mesures des captures d'écran du 7 nov. 2026 : ancienne carte (XIAO) jusqu'à mardi soir, trou,
//    Feather branchée en USB jeudi 23 h (pic), palier bruité vendredi, recharge rapide vers minuit, relaxation
const pts = [];
for (let t = min('2026-11-01T00:00+01:00'), k = 0; t <= min('2026-11-03T21:00+01:00'); t += 60, k++) pts.push([t, Math.round(3967 - 22 * k / 69) + bruit(4)]);
pts.push([min('2026-11-05T23:00+01:00'), 3985]);
for (let t = min('2026-11-06T00:00+01:00'); t <= min('2026-11-06T22:00+01:00'); t += 60) pts.push([t, 3940 + bruit(6)]);
[4110, 4078, 4068, 4064, 4061, 4059, 4058, 4057, 4056, 4055, 4054, 4054, 4053, 4052, 4051]
  .forEach((v, i) => pts.push([min('2026-11-07T00:00+01:00') + i * 60, v]));
console.log('captures : charge', charges(pts), '| autonomie', autonomie(pts));
// Deux jours plus tard, la batterie baisse lentement (0,01 V par jour, environ 1 % par jour vers 4,05 V)
const suite = pts.slice();
for (let k = 1; k <= 48; k++) suite.push([pts.at(-1)[0] + k * 60, Math.round(4051 - 10 * k / 24) + bruit(3)]);
console.log('deux jours après : charge', charges(suite), '| autonomie', autonomie(suite));

// 2. Charge lente (ancienne carte) : +0,01 V par heure pendant 20 h, mesures bruitées, à partir de lundi 8 h
const lente = [];
for (let k = 0; k < 12; k++) lente.push([min('2026-10-26T20:00+01:00') + k * 60, 3800 + bruit(5)]);
for (let k = 1; k <= 20; k++) lente.push([min('2026-10-27T07:00+01:00') + k * 60, 3800 + 10 * k + bruit(5)]);
for (let k = 1; k <= 6; k++) lente.push([min('2026-10-28T03:00+01:00') + k * 60, 3990 - 4 * k + bruit(3)]);
console.log('charge lente :', charges(lente));

// 3. Trois jours sans charge, mesures bruitées : rien à griser
const plat = [];
for (let k = 0; k < 72; k++) plat.push([min('2026-10-20T00:00+02:00') + k * 60, 3900 - Math.round(k / 8) + bruit(8)]);
console.log('sans charge :', charges(plat));

// 4. Batterie débranchée 2 jours sans recharge : l'estimation repart des mesures après le trou
const trou = [];
for (let k = 0; k < 24; k++) trou.push([min('2026-10-20T00:00+02:00') + k * 60, 3950 - 2 * k]);
for (let k = 0; k < 24; k++) trou.push([min('2026-10-23T00:00+02:00') + k * 60, 4000 - Math.round(k / 2)]);
console.log('après un trou :', autonomie(trou));

// 5. Carte avec jauge : [minutes, mV, dixièmes de %, dixièmes de % par heure]. Recharge vue par la vitesse
//    mesurée (+15 % par heure), puis la tension retombe de 0,05 V sans que le pourcentage de la jauge bouge
const jauge = [];
for (let k = 0; k < 24; k++) jauge.push([min('2026-10-26T00:00+01:00') + k * 60, 3850 + bruit(4), Math.round(600 - 10 * k / 24), 0]);
jauge.push([min('2026-10-27T00:00+01:00'), 4000, 650, 150], [min('2026-10-27T01:00+01:00'), 4100, 700, 140]);
for (let k = 1; k <= 30; k++) jauge.push([min('2026-10-27T01:00+01:00') + k * 60, 4050 - Math.round(k / 3), Math.round(700 - 10 * k / 24), 0]);
console.log('jauge : charge', charges(jauge), '| autonomie', autonomie(jauge));
// 6. Batterie presque pleine branchée : la tension ne monte presque pas, seule la jauge voit la charge
const pleine = [];
for (let k = 0; k < 6; k++) pleine.push([min('2026-10-28T08:00+01:00') + k * 60, 4150 + bruit(3), 960, k >= 3 ? 25 : 0]);
console.log('presque pleine :', charges(pleine));

// 7. Temps d'éveil : compteurs cumulés (dixièmes de s) ; 5 s d'éveil dont 2 s d'écran par heure.
//    La carte redémarre au milieu (compteurs remis à zéro) : le calcul ne devient pas négatif
const eveil = [];
for (let k = 0; k < 24; k++) eveil.push([min('2026-11-08T00:00+01:00') + k * 60, 4050, 800, 0, k < 12 ? 50 * k : 30 + 50 * (k - 12), k < 12 ? 20 * k : 10 + 20 * (k - 12)]);
const e7 = eveilParJour(eveil);
console.log('éveil :', enMinSec(e7.eveil), 'par jour, dont', enMinSec(e7.ecran), "d'écran | sans compteurs :", eveilParJour(jauge));

// 8. Nouveau programme sur la carte : 3 jours à 1,5 % par jour (fuite), puis le programme corrigé, 3 jours à
//    0,7 % par jour. Sans les versions, la droite mélange les deux ; avec, elle repart du nouveau programme
const prog = [], debutProg = min('2026-11-10T00:00+01:00'), changement = debutProg + 3 * 1440;
for (let k = 0; k <= 144; k++) {
  const t = debutProg + k * 60, j = (t - debutProg) / 1440;
  const pct = j <= 3 ? 90 - 1.5 * j : 90 - 4.5 - 0.7 * (j - 3);
  prog.push([t, 4000, Math.round(pct * 10) + bruit(2), -1]);
}
const fwProg = [[debutProg, '20261101-120000'], [changement, '20261117-090000']];
const e8 = estimation(prog, fwProg), e8sans = estimation(prog);
console.log('programme : sans versions', (-e8sans.pente).toFixed(1), '%/jour | avec', (-e8.pente).toFixed(1), '%/jour ± ' + e8.marge.toFixed(1) +
  ' sur', e8.jours.toFixed(1), 'jours, programme', e8.programme, '| une seule version :', estimation(prog, fwProg.slice(0, 1)).programme);
// Juste après le changement (moins d'une demi-journée) : pas encore d'estimation
console.log('programme tout neuf :', estimation(prog.filter(q => q[0] <= changement + 360), fwProg));

// 9. Vitesse de jauge isolée au-dessus de +2 %/h (jauge qui reprend après un arrêt, sans chargeur) : pas une
//    charge. Deux mesures de suite : une charge. La toute dernière seule : une charge qui commence.
const isole = [], t9 = min('2026-11-18T00:00+01:00');
for (let k = 0; k < 24; k++) isole.push([t9 + k * 60, 3950 - k, 900 - k, k === 10 ? 23 : -1]);
const deuxDeSuite = isole.map((q, k) => k === 11 ? [q[0], q[1], q[2], 21] : q);
const derniere = isole.map((q, k) => k === 23 ? [q[0], q[1], q[2], 25] : (k === 10 ? [q[0], q[1], q[2], -1] : q));
console.log('vitesse isolée :', periodesCharge(isole).length, 'charge | deux de suite :', periodesCharge(deuxDeSuite).length,
  '| dernière seule :', periodesCharge(derniere).length);
