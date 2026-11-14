// Lance tous les tests du serveur et verifie leurs resultats.
// Utilise par Cloudflare avant chaque deploiement (commande de build : npm test) :
// si un test echoue, l'ancienne version du serveur reste en ligne.
import { execFileSync } from 'child_process';
import { dirname } from 'path';
import { fileURLToPath } from 'url';
const ici = dirname(fileURLToPath(import.meta.url));
const ATTENDU = {
  'test.mjs': [/UI 200/, /sans cle 401/, /sig stable true/, /^photo 200/m, /get photo 200 81600/, /pochette 200/, /apercu get 200 true/,
    /"h": "Jour",\s+"t": "Anniversaire de Léa"/],      // évènement sur toute la journée
  'scenes.mjs': [/migration : Bus \[date,bus\].*Grand Prix \[date,meteo,f1\].*f1=semaine/, /scène invalide -> \[\] reveil 0 blocs 0/,
    /ven 16\/10 17h50 +Par défaut/, /ven 16\/10 18h30 +Bus +date,bus +réveil 185 s/, /ven 16\/10 19h58 +Bus .*réveil 125 s/,
    /jeu 22\/10 22h00 +Vacances +date,courbe/, /ven 23\/10 08h00 \(GP\) +Grand Prix +date,f1,meteo +réveil 1809 s/,
    /ven 23\/10 18h30 \(bus\+GP\) +Bus/, /lun 02\/11 09h00 +Par défaut/, /signature stable entre 12h00 et 12h05 : true/],
  'f1.mjs': [/GP des États-Unis \| manche 20 \| Dans 2 jours \| Circuit of the Americas \| tracé 57 pts/, /\| Ce week-end \|/,
    /~Ven 23 19h30 Essais libres 1/, /GP de Mexico \| manche 21 \| Dans 4 jours/, /courbe : départ 20h, 25 points/,
    /portrait 48 h : 49 points/, /appels à Jolpica pour 20 réveils \(1 par heure\) : [12]$/m,
    /copie du KV -> GP de Mexico/, /sans copie -> Calendrier F1 indisponible \(HTTP 429\)/,
    /panne de 3 h, 18 réveils : 3 demandes \| GP toujours affiché : GP de Mexico/, /Jolpica revenu : 1 demande \| échec effacé : true/,
    /sans copie, 10 min après : 0 demande -> Calendrier F1 indisponible \(HTTP 429\)/, /sans copie, 1 h après : 1 demande/],
  'firmware.mjs': [/version lue : 20261004-140322/, /envoi mauvais fichier : 400/, /carte ancienne .* : 20261004-140322/,
    /carte identique +-> fw proposé : undefined/, /carte plus récente +-> fw proposé : undefined/, /téléchargement : 200 300000/,
    /après retrait -> fw proposé : undefined \| binaire : 404/, /programme refusé par la carte -> fw proposé : undefined/, /refus enregistré : true/,
    /après 3 téléchargements -> fw proposé : undefined/, /renvoyé -> fw proposé : 20261004-140322/,
    /plantages : 2 W true \| quand : true/, /même compteur : date gardée true/, /contact 5 min après : pas d'écriture true \| carte redémarrée : enregistré true/],
  'meteo-circuit.mjs': [/demande : 1 \| circuit 30\.13,-97\.64 \| du 2026-10-23 au 2026-10-26 \| Europe\/Paris/,
    /Ven 23 15°\/23° pluie 15 % vent NO 20 \| 18h, 9 points, EL1 1\.5-2\.5, Q\. sprint 5\.5-6\.5/, /Sam 24 .* vent NO 20 \| 18h, 8 points, Sprint 1-2, Qualif\. 5-6/,
    /Dim 25 17°\/21° pluie 40 % vent E 8 \| 20h, 5 points, Course 1-3/, /pluie du graphique du vendredi : 0 0 0 15 40 15 0 0 0/,
    /rien de privé envoyé : true \| bloc F1 intact : 5 séances, tracé true/, /copie de secours écrite 0 fois/,
    /samedi 20h30 : Sam 24 \(Sprint, Qualif\.\) ; Dim 25 \(Course\) \| du 2026-10-24/, /dimanche 23h30 : GP des États-Unis \| 0 jour \| Séances terminées \| demandes 0/,
    /11 jours avant : Prévisions à partir du ven\. 16 \| demandes 0/, /lundi : Mexico City 19\.40 \| Ven 30 \(EL1, EL2\) ; Sam 31 \(EL3, Qualif\.\) ; Dim 1 \(Course\)/,
    /bloc seul : circuit,gp,lieu,manche,meteo,quand/, /sans le bloc : demandes 0 \| météo dans les données : false/, /panne, avec copie : 3 jours/,
    /panne, sans copie : 0 jour \| Météo du circuit indisponible \| F1 : GP de Mexico 5 séances/],
  'nouveaux-blocs.mjs': [/soleil à Paris le 21\/06\/2026 : 03:4[6-9] 19:5[6-9]/, /pleine lune du 21\/01\/2000 à 04:40 : true \| nouvelle lune du 08\/04\/2024 à 18:21 : true/,
    /lunes de 2026 : Pleine lune 01-03, Nouvelle lune 01-18, Pleine lune 02-01, Nouvelle lune 02-17/, /soleil de minuit .* : null/,
    /Nîmes le 14\/11\/2026 : \{"lever":"07:3[5-7]","coucher":"17:(1[89]|20)","duree":"9 h 4\d","ecart":"-[23] min","lune":"Premier croissant","p":1[567],"ecl":2\d,"suite":"Pleine lune mar\. 24"\}/,
    /même jour : signature identique true \| lendemain : signature changée true/, /24\/11 : Pleine lune (49|50) 100 % \| Nouvelle lune mer\. 9/, /hémisphère sud : lune retournée 8[345]/,
    /mois : \{"t":"Novembre 2026","p":6,"n":30,"a":14,"e":\[14,16,17,23,30\]\} \| calendrier lu 1 fois/, /agenda \(5 jours, inchangé\) : Aujourd'hui 17:30 Colle de maths \| Lun 16 08:00 Cours \| Mar 17 08:00 Dentiste$/m,
    /30\/11 au soir : Novembre 2026 30 \[\]/, /01\/12 : Décembre 2026 \| 1er en colonne 1 \| 31 jours \| \[2,7,14,21\]/, /février 2027 : 0 28/,
    /sans calendrier : grille 28 jours, marques 0/, /sans les blocs : rien/,
    /page : \["Rendre le DM de maths","Acheter des piles","Appeler Mamie"\] \| 4e coupée à 80 caractères/, /raccourci \(texte\) : 3 tâche\(s\) envoyée\(s\) au cadre/,
    /bloc : \["Rendre le DM de maths","Acheter des piles","Réviser la colle","Lire Woolf"\]/, /même liste renvoyée : Liste inchangée \(3\) \| écritures 0/,
    /raccourci \(JSON\) : 2 tâche\(s\) .* \| \["Rendre le DM de maths","Acheter des piles","Footing","Dentiste"\]/, /la page ne touche pas aux rappels : \["Footing","Dentiste"\] \| reçus à 2026-11-14T17:00/,
    /bouton Effacer : \{"liste":\["Une seule"\],"rappels":\[\],"rappelsT":0\}/, /liste vide envoyée : Liste inchangée \(0\) \| trop longue : 20 tâche/,
    /restauration : 200 \["Footing","Dentiste"\]/, /rien à faire : \[\]/, /droit du raccourci : true \| de la carte : false/],
  'trains.mjs': [/gares : \[\{"id":"stop_area:SNCF:87775007","nom":"Nîmes Centre"\},\{"id":"stop_area:SNCF:87703975","nom":"Nîmes Pont-du-Gard"\}\] \| clé en Basic : true \| clé dans l'adresse : false/,
    /recherche trop courte : \[\]/, /réglages : Nîmes Centre -> Montpellier Saint-Roch, Paris Gare de Lyon \| 4 départs/,
    /18:42 TER Montpellier Saint-Roch 19:11\n  18:50 OUIGO Paris Gare de Lyon 21:53\n  18:57 TER Montpellier Saint-Roch 19:33 \+5\n  19:06 TGV Montpellier Saint-Roch 19:30\n/,
    /demandes : 2 \| départ 20261114T183000 \| sans correspondance true \| temps réel realtime \| sans tracé true/, /sans le bloc : demandes 0 \| données false/,
    /quota : Trains indisponibles \(Quota SNCF atteint\)/, /clé refusée : Trains indisponibles \(Clé SNCF refusée\)/,
    /sans destination : Choisis une gare et une destination \| demandes 0/, /sans clé : Clé SNCF absente \(voir le README\) \| 502 Clé SNCF absente : ajoute le secret SNCF/],
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
    /double +: D \| zones 160,300 16x2 \| 14 octets \| écran juste : true/, /après 3 partielles +: C /, /méthode quadruple +: N /, /quadruple +: Q \| zones 240,400 16x2 \| 14 octets \| écran juste : true/,
    /ancienne carte : ok/, /en-tête x-plan : P;1;1/,
    /après une image non envoyée +: P \| zones 240,400 16x2 \| 14 octets \| écran juste : true/, /méthode changée, après saut +: N /,
    /réglages invalides ignorés : \{"partiel":true,"completH":24,"seuil":40,"methode":"simple","maxPartiels":0\}/,
    /réglages : \{"partiel":true,"completH":12,"seuil":60,"methode":"simple","maxPartiels":0\} \| cp envoyé à la carte : 43200/],
  'jetons.mjs': [/personne : config 200 \| jetons 200/, /carte : état 200 \| aperçu 200 \| programme 404/,
    /carte refusée : config 403 \| réglages 403 \| sauvegarde 403 \| envoi programme 403 \| jetons 403/,
    /raccourci : pochette 200 \| refusé : config 403 \| état 403/, /autre jeton : config 403 \| sauvegarde 403 \| aperçu 403/,
    /tous les droits choisis : 200 \| puis config 200/, /rôle deviné plus tard : aperçu 403 \| état 200 \| aperçu 200 \| config 403 \| rôle carte/,
    /rôles devinés : abc123.access=carte def456.access=raccourci zzz999.access=null/,
    /choix du rôle : 200 \| puis config 403 \| rôle inconnu 400 \| par un jeton 403/, /oublier : 200 abc123.access def456.access$/m,
    /signature pirate 403 \| autre application 403 \| autre équipe 403 \| expiré 403 \| clé inconnue 403 \| abîmé 403/,
    /clés gardées en mémoire : true/, /clés introuvables : 503/,
    /copie dans le KV : true \| clés k1:ekidktyn/, /2 h après, mémoire vidée : 200 \| 0 téléchargement \| 0 écriture/,
    /13 h après, copie trop vieille : 200 \| 1 téléchargement \| 1 écriture/, /clé inconnue, clés inchangées : 403 \| 2 téléchargements \| 1 écriture/,
    /Cloudflare muet, copie de 2 jours : 200 \| copie de 9 jours : 503/, /copie d'une autre équipe : 200 \| 1 téléchargement/],
  'agenda-recurrences.mjs': [
    /mensuel : Mar 10 18:00 2e mardi \| Ven 27 19:00 Dernier vendredi \| Lun 30 09:00 Fin de mois \| Mar 1 07:00 1er jour ouvré \| Mar 8 18:00 2e mardi \| Ven 25 19:00 Dernier vendredi \| Jeu 31 09:00 Fin de mois \| Ven 1 07:00 1er jour ouvré$/m,
    /divers : Aujourd'hui 18:00 Footing \| Aujourd'hui 20:00 Projet \| Demain 18:00 Footing \| Demain 20:00 Projet \| Lun 9 20:00 Projet \| Jeu 12 14:00 Code de la route \| Sam 14 18:00 Footing \| Dim 15 18:00 Footing \| Mer 18 17:00 Club \| Jeu 19 14:00 Code de la route$/m,
    /gros calendrier \(\d+ octets\) : calcul rapide \(< 25 ms\) : true/],
  'agenda-rebours.mjs': [/lieux : Aujourd'hui 17:30 Colle de maths @ C104 \| Demain 08:00 Dentiste @ Cabinet du Dr Martin \| Demain 10:00 Cours de maths, salle B12 \| Demain 14:00 Anglais \| Jeu 12 09:00 Visite @ Musée de la Romanité, un lieu\.\.\. \| Jeu 12 18:00 GP de Las Vegas - EL1$/m,
    /option décochée : aucun lieu/, /enregistré : Vacances de Noël=19\/12\/2026 Concours blanc=14\/1\/2027 Rentrée=2\/9\/0 .* \| ignorées : pas une date/,
    /rebours : J-0 Aujourd'hui \(mar\. 10 novembre\) \| J-39 Vacances de Noël \(sam\. 19 décembre\) \| J-52 Nouvel an \(ven\. 1 janvier 2027\) \| J-65 Concours blanc \(jeu\. 14 janvier 2027\)$/m,
    /même jour : signature identique true \| lendemain : 38 Vacances de Noël \| signature changée true/, /avant le changement d'heure : 2 jours/,
    /sans le bloc : rien/, /liste vide : \[\]/, /restauration : 200 Lundi/],
  'creuses-alertes.mjs': [/plages gardées : 08:00-17:00 \| intervalle 120/,
    /réveils : mar 7h50 605 \| mar 9h00 3636 \| mar 11h00 3605 \| mar 12h30 305 \| mar 16h30 1805 \| mar 17h10 605 \| sam 10h00 605/,
    /décochées : 605 \| plages gardées 1/, /jamais plus souvent que le rythme normal : 3618/, /token invalide : 400 \| clé invalide : 400 \| actif sans destinataire : 400/, /token nettoyé : true/,
    /alertes désactivées : rien/, /tout va bien : rien \| 2 h après : rien/, /5 h sans nouvelles : Cadre : plus de nouvelles \[apple:ab12ab:me\.fin\.bark timeSensitive\] \| Sans nouvelles depuis 5 h \(dernier contact mar\. 10 novembre à 12:00\)/,
    /une heure après : rien \| rappel le lendemain : Cadre : plus de nouvelles/, /Apple en panne, pas de clé : rien \| erreur retenue : direct : Apple a répondu HTTP 500/,
    /retour, batterie à 15 % : Cadre : de retour \[apple\S* active\] \+ Cadre : batterie à 15 % \[apple\S* timeSensitive\] .*\| erreur effacée : true/, /seuil hésitant : rien \/ rien \| suivi gardé : true/, /en charge : rien \| suivi : \{\}/,
    /écran blanc, 2 jours sans nouvelles : rien/, /bloc bus absent : rien \| fin retenue : 20261116/, /3 jours avant la fin : rien/,
    /2 jours avant la fin : Cadre : horaires de bus bientôt périmés .* s'arrêtent le 16\/11\/2026/, /le lendemain : rien/, /3 jours après, périmés : Cadre : horaires de bus périmés/,
    /état pour la page : muet : dernier contact mar\. 17 novembre à 10:00 \| batterie : batterie à 94 % \| bus ! horaires périmés depuis le 16\/11\/2026 \| fin recalculée : 20261116/,
    /essai : 200 apple 1 Cadre : essai active \| critique : 200 apple critical/, /token invalide : 400 Device Token invalide.* \| rien : 400/,
    /token périmé, sans clé : 502 .*Device Token périmé/, /token périmé, avec clé : 200 bark bark:Kq7p/,
    /les deux en panne : 502 .*Device Token périmé.* ; secours : api\.day\.app a répondu HTTP 400/, /clé seule : 200 bark bark:Kq7p/,
    /jeton Apple refusé : 502 .*clé Apple de Bark refusée \(jeton expiré même refait\).* \| nouveau jeton essayé : 1/, /critique, 5 h sans nouvelles : Cadre : plus de nouvelles \[bark:Kq7p critical\]/,
    /^retour : Cadre : de retour \[apple\S* active\]/m, /alerte bus décochée : rien \| suivi : \{\}/,
    /direct raté, secours : Cadre : plus de nouvelles \[bark:Kq7p timeSensitive\] \| ⚠ Envoi direct raté : Device Token à recopier depuis Bark\. \| page : envoi direct raté, secours utilisé : Device Token périmé/,
    /direct rétabli : .* \| erreur effacée : true/, /clé Apple refusée : 200 bark \| ⚠ Envoi direct raté : clé Apple de Bark à mettre à jour/,
    /11 h : +rien 0 lecture\(s\) \| 12 h : rien apns_certs\.go,apns\.go \| page : identique à celle du dépôt de Bark/,
    /clé changée : Cadre : clé Apple de Bark changée \[apple\S* timeSensitive\] \| L'auteur de Bark a publié une nouvelle clé Apple \(clé, Key ID ZZ9ZZ9ZZ9Z\)/,
    /le lendemain : rien \| page : nouvelle clé Apple dans le dépôt de Bark .* à mettre à jour/, /7 jours après : Cadre : clé Apple de Bark changée/,
    /clé de nouveau identique : rien \| suivi : \{"etat":"ok","m":"","alerte":0\}/, /dépôt illisible : rien \| page : pas vérifiée : dépôt de Bark illisible \(apns_certs\.go : HTTP 404\)/,
    /dimanche 12 h : Cadre : vérification \[apple\S* passive\] \| dimanche 13 h : rien/, /dimanche, token périmé sans secours : rien \| page : direct : Device Token périmé/,
    /vérification décochée : rien/, /clé seule, dimanche 12 h : rien 0 lecture\(s\) \| ligne clé Apple : false/,
    /JWT : ES256 LH4T9V5U4R 5U8LBRXG3A number \| signature valide : true/],
  'frise-applique.mjs': [/jours : mar\. 10 \| mer\. 11 \| jeu\. 12 \| ven\. 13 \| sam\. 14 \| dim\. 15 \| lun\. 16/,
    /frise : mar 00:00 défaut \| mar 07:00 Bus \| mar 08:00 défaut \| .*ven 18:00 Bus \| ven 20:00 défaut \| sam 00:00 Vacances \| dim 00:00 défaut \| dim 09:00 Week-end \| dim 22:00 défaut \| lun 07:00 Bus \| lun 08:00 défaut$/m,
    /week-end prioritaire : sam 00:00 Vacances \| sam 09:00 Week-end \| sam 22:00 Vacances \| dim 00:00 défaut \| dim 09:00 Week-end/,
    /sans scène : 1 segment défaut \| rien enregistré : true/, /demande illisible : 400/, /changement d'heure : dimanche de 25 h \| dim 09:00 Week-end \| dim 22:00 défaut/,
    /avant le premier réveil : inconnu/, /^réveil : appliqué à mar 12:00/m, /changement de mode : en attente/, /réveil suivant : appliqué à mar 12:10/,
    /10 min après, heure gardée : appliqué à mar 12:10/, /contour de l'aperçu : appliqué à mar 12:10 \| version inchangée : true/, /contour et traits : en attente/],
  // Images de reference du dessin : toutes identiques (sinon : npm run references, apres avoir regarde tests/rendu/ecarts/)
  'references.mjs': [/images de référence : (\d\d+) sur \1 identiques$/m],
  'reveils-cales.mjs': [/10 min, depuis 14:07:20 : 14:07:20 \| 14:10:07 \| 14:20:07 \| 14:30:07 \| 14:40:07/, /60 min, depuis 13:58:30 : 13:58:30 \| 14:00:20 \| 15:00:20/,
    /0,4 % rapide : 14:00:20 \| 15:00:05 \| 16:00:06 \| 17:00:05/, /2 % rapide : 14:00:20 \| 14:59:08 \| 15:00:18 \| 15:59:08 \| 16:00:19/,
    /2 % lente : 14:00:20 \| 15:01:31 \| 16:01:31 \| 17:01:31/,
    /nuit de 2 h en 2 h : 22:47:00 \| 22:50:07 \| 23:00:07 \| 00:00:38 \| 02:00:38 \| 04:00:38 \| 06:00:38 \| 07:00:07 \| 07:10:07/,
    /scène à 3 min : 17:52:00 \| 18:00:07 Bus \| 18:03:07 Bus \| 18:06:07 Bus \| 18:09:07 Bus \| 18:10:09 \| 18:20:07/,
    /repères de 45 min : 22:30 \| 23:15 \| 0:00/, /mode développement : 30/, /10 réveils en 27 min : 3 écritures de l'état/],
  'batterie-page.mjs': [/captures : charge ven\. 22:00 -> sam\. 00:00 \| autonomie attente$/m,
    /deux jours après : charge ven\. 22:00 -> sam\. 00:00 \| autonomie 1\.0 %\/jour/, /charge lente : mar\. 08:00 -> mer\. 03:00$/m,
    /sans charge : aucune/, /après un trou : 1\.9 %\/jour/, /jauge : charge lun\. 23:00 -> mar\. 01:00 \| autonomie 1\.0 %\/jour/,
    /presque pleine : mer\. 10:00 -> mer\. 13:00 \(en cours\)/,
    /éveil : 1 min 58 s par jour, dont 47 s d'écran \| sans compteurs : null/],
};
const INTERDIT = [/fetch inattendu/, /ERREUR/, /TypeError|ReferenceError|SyntaxError/];
let echecs = 0;
// La page web : chaque script doit etre du JavaScript valide (sinon ce morceau de la page ne marche plus)
try {
  const { readFileSync, readdirSync } = await import('fs');
  const dossier = ici + '/../../serveur/page/';
  let n = 0;
  for (const f of readdirSync(dossier).filter(f => f.endsWith('.html')).sort()) {
    for (const m of readFileSync(dossier + f, 'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      try { new Function(m[1]); n++; } catch (e) { throw new Error(f + ' : ' + e.message); }
    }
  }
  if (!n) throw new Error('aucun script trouvé');
  console.log('ok   page web (' + n + ' scripts valides)');
} catch (e) { echecs++; console.log('ÉCHEC page web : ' + e.message); }
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
