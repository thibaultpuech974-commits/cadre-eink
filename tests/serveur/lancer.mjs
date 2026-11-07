// Lance tous les tests du serveur et verifie leurs resultats.
// Utilise par Cloudflare avant chaque deploiement (commande de build : npm test) :
// si un test echoue, l'ancienne version du serveur reste en ligne.
import { execFileSync } from 'child_process';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
const ici = dirname(fileURLToPath(import.meta.url));
const ATTENDU = {
  'test.mjs': [/UI 200/, /sans cle 401/, /sig stable true/, /^photo 200/m, /get photo 200 81600/, /pochette 200/, /apercu get 200 true/],
  'scenes.mjs': [/migration : Bus \[date,bus\].*Grand Prix \[date,meteo,f1\].*f1=semaine/, /scène invalide -> \[\] reveil 0 blocs 0/,
    /ven 16\/10 17h50 +Par défaut/, /ven 16\/10 18h30 +Bus +date,bus +réveil 180 s/, /ven 16\/10 19h58 +Bus .*réveil 125 s/,
    /jeu 22\/10 22h00 +Vacances +date,courbe/, /ven 23\/10 08h00 \(GP\) +Grand Prix +date,f1,meteo +réveil 1800 s/,
    /ven 23\/10 18h30 \(bus\+GP\) +Bus/, /lun 02\/11 09h00 +Par défaut/, /signature stable entre 12h00 et 12h05 : true/],
  'f1.mjs': [/GP des États-Unis \| manche 20 \| Dans 2 jours \| Circuit of the Americas \| tracé 57 pts/, /\| Ce week-end \|/,
    /~Ven 23 19h30 Essais libres 1/, /GP de Mexico \| manche 21 \| Dans 4 jours/, /courbe : départ 20h, 25 points/,
    /portrait 48 h : 49 points/, /appels à Jolpica pour 20 réveils \(1 par heure\) : [12]$/m,
    /copie du KV -> GP de Mexico/, /sans copie -> Calendrier F1 indisponible \(HTTP 429\)/],
  'firmware.mjs': [/version lue : 20261004-140322/, /envoi mauvais fichier : 400/, /carte ancienne .* : 20261004-140322/,
    /carte identique +-> fw proposé : undefined/, /carte plus récente +-> fw proposé : undefined/, /téléchargement : 200 300000/,
    /après retrait -> fw proposé : undefined \| binaire : 404/, /programme refusé par la carte -> fw proposé : undefined/, /refus enregistré : true/,
    /après 3 téléchargements -> fw proposé : undefined/, /renvoyé -> fw proposé : 20261004-140322/,
    /plantages : 2 W true \| quand : true/, /même compteur : date gardée true/, /contact 5 min après : pas d'écriture true \| carte redémarrée : enregistré true/],
  'ecrans.mjs': [/enregistré : date,meteo,jours,courbe,f1,bus/, /écran 0 : date@24,24 912x65 meteo@24,105 912x227 jours@24,348 912x308 \| données : meteo$/m,
    /écran 1 : courbe@24,24 912x308 f1@24,348 448x308 bus@488,348 448x308 \| données : meteo,f1,bus/, /signatures différentes : true/,
    /statut écran 2 : 3.95 20261027-120000/, /photo double : 200 écran 0 octet 0 = 1 \| écran 1 octet 0 = 2 \| photo simple refusée : 400/,
    /pochette : image \/ texte/, /pas de champ ecran/],
  'secours.mjs': [/copies enregistrées : 3/, /panne 3 h : 18° \(prévu à 13 h\) Couvert \| courbe dès 13h \| Demain Colle de maths/,
    /panne 2 jours : Météo indisponible \| agenda ok/, /après changement de ville puis panne : copie de Lyon utilisée/,
    /retour à Nîmes, panne : Météo indisponible/, /écritures de copies pour 12 réveils en 2 h : 6 /],
  'sauvegarde.mjs': [/sauvegarde : 200 attachment/, /restauration : 200 .*ville Lattes .*'Léa'.*'Gare'.*photo gardée : true/,
    /fichier invalide : 400 400/, /ancienne sauvegarde : \[ 'Bus r=5' \] \| défaut \[ 'date' \]/],
  'previsu.mjs': [/apercu.wasm à jour : true/, /par défaut modifiée : Par défaut \| 1 écran \| blocs date,meteo \| points noirs true/,
    /scène forcée : Grand Prix \| blocs date,f1 \| GP GP des États-Unis \| dessin true/, /deux écrans : date \| courbe/, /rien enregistré : true/, /prévision météo\/agenda : true \| aucune écriture : true/],
  'agenda.mjs': [/ok 1 évènement\(s\) \| webcal:\/\/ics.test\/maths.ics/, /erreur : adresse invalide .* \| pas une adresse/,
    /erreur : introuvable \(HTTP 404\) .* \| https:\/\/introuvable.test\/x.ics/, /fenêtre : 14 jours/, /panne : inaccessible \(réseau coupé\)/],
  'access.mjs': [/access sans CLE : 200/, /access \+ mauvaise CLE : 200/, /session personne : \{"access":true,"email":"moi@exemple.fr"\}/,
    /session jeton : \{"access":true,"email":""\}/, /pochette par jeton : 200 So What/, /secours sans cle : 401/,
    /secours avec cle : 200/, /session secours : \{"access":false\}/, /rien de configure : 500/],
  'batterie.mjs': [/288 réveils : 48 écritures, 48 points, de 4100 à 3904 mV/, /après 40 jours : 1 point/, /sans mesure : rien enregistré/,
    /jauge : état 85\.3 12\.5 \| point \[4050,853,125\]/, /fin de charge enregistrée : 0$/m, /valeurs bornées : 110 -200/, /seuil hésitant, 20 réveils en 10 min : 1 écriture\(s\)/,
    /éveil : état 123456 45678 \| point \[4050,853,-2,1235,457\]/, /éveil sans jauge : point \[4050,null,null,20,9\]/],
  'rafraichissement.mjs': [/démarrage +: N +\| écran juste : true/, /image identique +: R +\| écran juste : true/,
    /température +: P \| zones 96,200 64x40 \| 330 octets \| écran juste : true/,
    /deux zones +: P \| zones 16,30 24x20 ; 800,600 80x30 \| \d+ octets \| écran juste : true/,
    /dispersé \(8 zones au plus\) +: P \| zones( [^;|]+;){7} [^;|]+ \| \d+ octets \| écran juste : true/,
    /moitié de l'écran +: C /, /empreinte fausse +: C /, /24 h sans complet +: N /, /orientation changée +: C /,
    /partiel désactivé +: C /, /mode photo +: C /, /mise en route +: P /, /méthode changée +: N /,
    /inversion +: I \| zones 96,200 64x40 \| 330 octets \| écran juste : true/, /méthode double +: N /,
    /double +: D \| zones 160,300 16x2 \| 14 octets \| écran juste : true/, /après 3 partielles +: C /,
    /ancienne carte : ok/, /en-tête x-plan : P;1;1/,
    /réglages invalides ignorés : \{"partiel":true,"completH":24,"seuil":40,"methode":"simple","maxPartiels":0\}/,
    /réglages : \{"partiel":true,"completH":12,"seuil":60,"methode":"simple","maxPartiels":0\} \| cp envoyé à la carte : 43200/],
  'jetons.mjs': [/personne : config 200 \| jetons 200/, /carte : état 200 \| aperçu 200 \| programme 404/,
    /carte refusée : config 403 \| réglages 403 \| sauvegarde 403 \| envoi programme 403 \| jetons 403/,
    /raccourci : pochette 200 \| refusé : config 403 \| état 403/, /autre jeton : config 200/,
    /rôles devinés : abc123.access=carte def456.access=raccourci zzz999.access=null/,
    /choix du rôle : 200 \| puis config 403 \| rôle inconnu 400 \| par un jeton 403/, /oublier : 200 abc123.access def456.access$/m,
    /signature pirate 403 \| autre application 403 \| autre équipe 403 \| expiré 403 \| clé inconnue 403 \| abîmé 403/,
    /clés gardées en mémoire : true/, /clés introuvables : 503/],
  'agenda-recurrences.mjs': [
    /mensuel : Mar 10 18:00 2e mardi \| Ven 27 19:00 Dernier vendredi \| Lun 30 09:00 Fin de mois \| Mar 1 07:00 1er jour ouvré \| Mar 8 18:00 2e mardi \| Ven 25 19:00 Dernier vendredi \| Jeu 31 09:00 Fin de mois \| Ven 1 07:00 1er jour ouvré$/m,
    /divers : Aujourd'hui 18:00 Footing \| Aujourd'hui 20:00 Projet \| Demain 18:00 Footing \| Demain 20:00 Projet \| Lun 9 20:00 Projet \| Jeu 12 14:00 Code de la route \| Sam 14 18:00 Footing \| Dim 15 18:00 Footing \| Mer 18 17:00 Club \| Jeu 19 14:00 Code de la route$/m,
    /gros calendrier \(\d+ octets\) : calcul rapide \(< 25 ms\) : true/],
  'batterie-page.mjs': [/captures : charge ven\. 22:00 -> sam\. 00:00 \| autonomie attente$/m,
    /deux jours après : charge ven\. 22:00 -> sam\. 00:00 \| autonomie 1\.0 %\/jour/, /charge lente : mar\. 08:00 -> mer\. 03:00$/m,
    /sans charge : aucune/, /après un trou : 1\.9 %\/jour/, /jauge : charge lun\. 23:00 -> mar\. 01:00 \| autonomie 1\.0 %\/jour/,
    /presque pleine : mer\. 10:00 -> mer\. 13:00 \(en cours\)/,
    /éveil : 1 min 58 s par jour, dont 47 s d'écran \| sans compteurs : null/],
};
const INTERDIT = [/fetch inattendu/, /ERREUR/, /TypeError|ReferenceError|SyntaxError/];
let echecs = 0;
// La page web : son script doit etre du JavaScript valide (sinon la page entiere ne marche plus)
try {
  const { readFileSync } = await import('fs');
  const page = readFileSync(ici + '/../../serveur/interface.html', 'utf8');
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  if (!scripts.length) throw new Error('aucun script trouvé');
  scripts.forEach(js => new Function(js));
  console.log('ok   interface.html (script valide)');
} catch (e) { echecs++; console.log('ÉCHEC interface.html : ' + e.message); }
for (const [fichier, motifs] of Object.entries(ATTENDU)) {
  let sortie = '';
  try {
    sortie = execFileSync(process.execPath, ['--import', './html-texte.mjs', fichier], { cwd: ici, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
  } catch (e) {
    console.log('ÉCHEC ' + fichier + ' : le test a planté\n' + (e.stdout || '') + (e.stderr || ''));
    echecs++; continue;
  }
  const manquants = motifs.filter(m => !m.test(sortie)).concat(INTERDIT.filter(m => m.test(sortie)).map(m => 'interdit : ' + m));
  if (manquants.length) {
    echecs++;
    console.log('ÉCHEC ' + fichier + ' :\n  ' + manquants.join('\n  ') + '\n--- sortie ---\n' + sortie);
  } else console.log('ok   ' + fichier + ' (' + motifs.length + ' vérifications)');
}
console.log(echecs ? echecs + ' fichier(s) en échec : déploiement bloqué.' : 'Tous les tests du serveur passent.');
process.exit(echecs ? 1 : 0);
