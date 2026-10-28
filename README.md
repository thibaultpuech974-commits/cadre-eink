# Cadre e-ink : guide d'installation

Le projet a trois parties :

| Partie | Fichier | Rôle |
|---|---|---|
| Serveur web | `serveur/` : `worker.js` (serveur), `interface.html` (page web), `circuits.js` (tracés F1) | Interface web, météo, agenda, bus, F1, photo, aperçu |
| Carte ESP32 | `cadre_eink/cadre_eink.ino` | Se réveille, demande quoi afficher, dessine, se rendort |
| Raccourci iPhone | à créer (étape 4) | Envoie la pochette Apple Music |

Le cadre n'a plus besoin de l'horloge DS3231 : tu peux la laisser branchée ou la retirer.

---

## 1. Mettre le serveur en ligne (Cloudflare, gratuit)

1. Crée un compte gratuit sur **dash.cloudflare.com**.
2. Menu **Workers & Pages** → **Créer** → **Créer un Worker**. Nomme-le `cadre`, puis **Déployer**.
3. Le serveur est fait de plusieurs fichiers : il se déploie depuis GitHub (voir « Déploiement automatique » plus bas), et non plus par copier-coller.
4. Crée l'espace de stockage : menu **Stockage et bases de données** → **KV** → **Créer** → nom `cadre-donnees`.
5. Retourne dans ton Worker → **Paramètres** → **Liaisons** → **Ajouter** → **Espace de noms KV** :
   - Nom de la variable : `CADRE` (en majuscules, exactement)
   - Espace de noms KV : `cadre-donnees`
6. Toujours dans **Paramètres** → **Variables et secrets** → **Ajouter** :
   - Type : **Secret**
   - Nom : `CLE`
   - Valeur : un mot de passe de ton choix (il protège ton cadre)
7. Ton adresse est affichée en haut de la page du Worker, du type
   `https://cadre.ton-nom.workers.dev`. Ouvre-la et connecte-toi avec ton mot de passe.

**Déploiement automatique depuis GitHub** : le fichier `wrangler.jsonc` du dépôt décrit le Worker (nom `cadre`, fichier `serveur/worker.js`, espace KV `CADRE`). Une fois le dépôt connecté dans **Paramètres → Builds**, chaque envoi sur la branche `main` redéploie le serveur, avec ses trois fichiers (`worker.js`, `interface.html`, `circuits.js`). Le secret `CLE` reste dans Cloudflare.

**Tests avant chaque déploiement** : dans **Paramètres → Builds → Configuration du build**, mets `npm test` comme **commande de build** (la commande de déploiement reste `npx wrangler deploy`). Cloudflare lance alors les tests du serveur avant de déployer : si l'un d'eux échoue, le déploiement est annulé et l'ancienne version reste en ligne. Pour les lancer toi-même : `npm test` à la racine du dépôt (Node.js 20.6 ou plus, rien à installer). Serveur de test local avec la page web : `cd tests/serveur && node --import ./html-texte.mjs serveur_bus.mjs`, puis http://localhost:8787 (mot de passe `secret`).

L'interface web marche sur ordinateur, iPhone et iPad. Sur iPhone, **Partager → Sur l'écran d'accueil** la transforme en « app ».

---

## 2. Programmer la carte

1. Dans l'IDE Arduino, installe les bibliothèques **GxEPD2**, **U8g2_for_Adafruit_GFX**, **ArduinoJson** (Benoit Blanchon) et **JPEGDEC** (bitbank2).
2. **Outils → PSRAM → OPI PSRAM** : indispensable pour les pochettes. Garde le **Partition Scheme** par défaut (il faut un schéma avec OTA pour la mise à jour par Wi-Fi, donc pas « Huge APP (no OTA) »).
3. En haut de `cadre_eink.ino`, remplis :
   - `WIFI_SSID` et `WIFI_MDP` (Wi-Fi 2,4 GHz)
   - `SERVEUR` : l'adresse du Worker, sans `/` à la fin
   - `CLE` : le même mot de passe que dans Cloudflare
   - `ECRAN_PRESENT` : mets **0** tant que tu n'as pas la nouvelle dalle. La carte dessine quand même et envoie l'image à l'aperçu web.
4. Téléverse, puis ouvre le moniteur série (115200 bauds) pour suivre le premier réveil.
5. Quelques secondes plus tard, l'aperçu apparaît dans l'interface web.

**Pour téléverser à nouveau** : la carte dort presque tout le temps. Deux solutions :
- active le **Mode développement** dans la section **Réveil du cadre** de la page web. La carte ne se met plus en veille, vérifie toutes les 15 à 60 s, et le téléversement marche normalement. À utiliser branché en USB, et à désactiver une fois fini. Il prend effet au prochain réveil, ou tout de suite si tu appuies sur le bouton **R** de la carte ;
- ou débranche-la, maintiens le bouton **B (BOOT)** en la rebranchant, puis téléverse.

**Mettre à jour la carte par Wi-Fi** (une fois ce programme installé par câble) :
1. Dans l'IDE Arduino, **Croquis → Exporter les binaires compilés**.
2. Dans le dossier du croquis, ouvre `build`, puis le sous-dossier de la carte : le fichier à prendre est `cadre_eink.ino.bin` (pas `merged`, `bootloader` ni `partitions`).
3. Dans la page web, section **Programme de la carte**, choisis ce fichier puis **Envoyer le programme**.
4. Au réveil suivant, la carte le télécharge (la petite LED orange s'allume environ 30 s), redémarre et redessine l'écran. La section affiche alors « installé ».

La carte ne se met à jour que si sa batterie dépasse 3,6 V, et seulement vers un programme plus récent que le sien. Si un programme envoyé plante au démarrage, la carte ne peut plus se mettre à jour par Wi-Fi : il faut la reprogrammer par câble (bouton BOOT). Teste donc d'abord par câble les grosses modifications.

---

## 3. Brancher l'agenda iCloud

1. Sur l'iPhone, ouvre **Calendrier** → **Calendriers** (en bas).
2. Touche le **(i)** à côté du calendrier voulu.
3. Active **Calendrier public**, puis **Partager le lien…** → **Copier**.
4. Colle le lien (il commence par `webcal://`) dans la section **Agenda** de l'interface web, puis **Enregistrer**. Tu peux mettre plusieurs calendriers, un par ligne.

À savoir : un calendrier public est consultable par toute personne qui a le lien. Le lien est long et introuvable par hasard, mais ne le partage pas.

**Calendriers auxquels tu es abonné** (F1, sport, vacances scolaires…) : dans Réglages → Apps → Calendrier → Comptes → Calendriers avec abonnement, copie le champ **Serveur** et ajoute-le sur sa propre ligne. S'il ne commence pas par `webcal://` ou `https://`, ajoute `https://` devant. Les titres de Formule 1 sont réécrits automatiquement avec le nom du GP en premier, sans le sponsor : « GP des Pays-Bas - Qualifications ».

**Anniversaires** : le calendrier « Anniversaires » de l'iPhone (issu des contacts) ne peut pas être partagé. Saisis-les plutôt dans le champ **Anniversaires** de la section Agenda, un par ligne : `Léa 14/03/2005` ou `Mamie 02/11`. Si tu donnes l'année, le cadre affiche l'âge, par exemple « Anniversaire de Léa (21 ans) ». Ils apparaissent dans l'agenda dans les 14 jours qui précèdent, même sans calendrier iCloud.

---

## 4. Raccourci iPhone pour la pochette Apple Music

Dans l'app **Raccourcis**, crée un nouveau raccourci « Pochette sur le cadre » avec ces actions, dans l'ordre :

1. **Obtenir le morceau en cours**
2. **Obtenir les détails des médias** → **Illustration** (de « Morceau en cours »)
3. **Redimensionner l'image** → largeur **640**, hauteur **640**
4. **Convertir l'image** → **JPEG**
5. **Obtenir les détails des médias** → **Titre** (de « Morceau en cours »), puis **Encoder en URL**
6. **Obtenir les détails des médias** → **Artiste**, puis **Encoder en URL**
7. **Obtenir les détails des médias** → **Titre de l'album**, puis **Encoder en URL**
8. **Texte** : colle l'adresse affichée dans la section « Pochette » de l'interface web, puis ajoute
   `&titre=` [résultat de l'étape 5] `&artiste=` [étape 6] `&album=` [étape 7]
   (les crochets = variables à insérer en touchant le champ)
9. **Obtenir le contenu de l'URL** :
   - URL : le **Texte** de l'étape 8
   - Méthode : **POST**
   - Corps de la requête : **Fichier** → l'**image convertie** de l'étape 4

Lance-le pendant que la musique joue : le cadre passe en mode Pochette à son prochain réveil.

Limite d'iOS : un raccourci ne peut pas se déclencher tout seul à chaque changement de morceau. Lance-le à la main, via Siri (« Pochette sur le cadre »), un widget ou le bouton Action. Tu peux aussi créer une automatisation **Quand l'app Musique est ouverte**.

---

## 5. Scènes et disposition du tableau de bord

**Enregistrer** : la page n'a qu'un seul bouton Enregistrer. Dès qu'un réglage change (disposition, montage, météo, agenda, bus, réveil), une barre « Modifications non enregistrées » apparaît en bas avec **Enregistrer** et **Annuler** ; la page prévient si tu la quittes sans enregistrer. Les actions immédiates (changer de mode, envoyer une photo ou un programme, choisir les arrêts de bus) ne passent pas par cette barre.

**État du cadre** : sous l'aperçu, des pastilles résument la dernière connexion (orange si le cadre aurait dû se connecter depuis longtemps), la batterie, le prochain réveil, la scène affichée et l'heure de l'image.

**Montage du cadre** (menu à part) : nombre d'écrans, sens du cadre (paysage, portrait, portrait inversé) et traits de séparation, des réglages qu'on ne fait qu'une fois.

**Agenda** : sous les adresses des calendriers, la page indique pour chacun s'il est accessible (✓) et combien d'évènements il contient dans les prochains jours, ou ce qui ne va pas (✗ : adresse invalide, calendrier introuvable ou plus public…).

**Scènes** : une scène est une disposition des blocs affichée pendant une période choisie. La scène **Par défaut** s'affiche quand aucune autre n'est active. Dans la section **Scènes et disposition** :
- **+ Nouvelle scène** crée une scène (copie de « Par défaut ») ; donne-lui un nom ;
- **Quand l'afficher** : des créneaux (jours + heures, par exemple « ven de 18:00 à 20:00 »), et/ou la semaine ou le week-end d'un Grand Prix de F1, et/ou des dates (du … au …). Toutes les conditions remplies doivent l'être ; une scène sans condition est affichée tout le temps ;
- **Mise à jour toutes les …** : rythme propre à la scène (3 min pour les bus, par exemple). « Rythme normal » garde celui de « Réveil du cadre » (et le mode nuit) ;
- **Plus prioritaire** : si plusieurs scènes sont actives en même temps, celle de gauche l'emporte ;
- le cadre se réveille tout seul au début et à la fin de chaque scène.

Exemples : « Bus » (ven 18:00-20:00, mise à jour 3 min, bloc bus en grand), « Grand Prix » (week-end d'un GP, bloc F1), « Vacances » (du 17/10 au 01/11, sans l'agenda des cours). La page indique la scène affichée en ce moment (point • à côté de son nom). Tes anciens réglages ont été convertis : la disposition « Pendant les créneaux bus » est devenue la scène « Bus ».

**Prévisualisation** : le bouton **Prévisualiser** (sous les blocs, ou en haut des menus) ouvre un panneau en bas de l'écran qui dessine une scène exactement comme le cadre l'affichera, avec les données actuelles et tes réglages de disposition, météo, agenda et bus, même pas encore enregistrés. L'image suit chaque modification ; le menu du panneau choisit la scène, « – » le réduit et « ✕ » le ferme. Tire la barre de titre pour le déplacer, et son coin en bas à droite pour l'agrandir ou le réduire ; la page retient sa place (double-clic sur la barre : retour en bas à droite). Rien n'est enregistré ni envoyé au cadre. Elle utilise le même code de dessin que la carte, compilé en WebAssembly (`serveur/apercu.wasm`).

> **Après chaque modification de `cadre_eink.ino`**, recompile la prévisualisation : `bash outils/apercu/preparer-outils.sh` (une seule fois), puis `bash outils/apercu/construire.sh`. Les tests refusent le déploiement si elle n'est pas à jour.

Pour les blocs de la scène choisie :
- fais glisser un bloc pour le déplacer (au doigt ou à la souris) ;
- tire son **coin en bas à droite** pour l'agrandir ou le réduire ;
- coche ou décoche un bloc pour l'ajouter ou le retirer ;
- **Traits de séparation** dessine des lignes entre les blocs.

L'écran est découpé en une grille de 12 × 8 cases, et les blocs ne peuvent pas se chevaucher. Le contenu de chaque bloc s'adapte à sa taille : polices, taille des icônes, nombre de colonnes d'heures ou de jours, nombre de lignes d'agenda. Clique sur **Enregistrer**, et le cadre applique la disposition à son prochain réveil.

**Orientation** : les boutons **Paysage**, **Portrait** et **Portrait inversé** choisissent le sens du cadre. Les deux portraits correspondent aux deux façons d'accrocher le cadre en hauteur : prends celui qui affiche l'image à l'endroit. Chaque orientation garde sa propre disposition (grille de 8 × 12 cases en portrait). Une photo est préparée dans l'orientation active au moment de l'envoi : renvoie-la si tu changes d'orientation.

**Texte d'un bloc** : touche un bloc sans le déplacer, puis choisis sa **taille** (Petite, Normale, Grande, Très grande) et sa **police** (Moderne, Helvetica, Classique, Machine à écrire). Chaque cran change tous les textes du bloc d'un palier (environ 25 %), et un texte trop long rétrécit avant d'être coupé. Helvetica et Classique s'arrêtent à 25 px : en Grande et Très grande, leurs plus grands textes passent en Moderne (42 px au plus). Machine à écrire monte jusqu'à 53 px (Courier pour les petites tailles, Inconsolata au-delà).

Le curseur **Contour de l'aperçu** ne règle que l'épaisseur du cadre noir dessiné autour de l'aperçu sur la page web. Il ne change rien sur l'écran.

**Deux écrans** : avec deux dalles identiques assemblées, choisis **Deux côte à côte** ou **Deux l'un sur l'autre** dans **Scènes et disposition**. La grille est doublée (24 × 8 cases côte à côte en paysage, 12 × 16 l'un sur l'autre), et la jointure entre les deux écrans est dessinée en noir : un bloc ne peut pas être à cheval dessus. Indique l'**espace entre les zones d'affichage** (en mm) : il sert à aligner l'aperçu et à découper les photos pour que l'image reste continue. L'écran 1 est celui de gauche (ou du haut). En mode Pochette, la pochette s'affiche sur l'écran 1 et le titre en grand sur l'écran 2.

> **Carte : à faire plus tard.** Le serveur est prêt, mais le programme de la carte ne gère encore qu'un écran. Il faudra qu'il ajoute `&ecran=1` à ses demandes pour la seconde dalle (`/api/etat`, `/api/photo`, `/api/apercu`) et qu'il sache dessiner la pochette en deux parties (`partie` = `image` ou `texte` dans l'état). Sans ce paramètre, le serveur répond comme pour l'écran 1 : la carte actuelle continue de marcher.

---

## 6. Prochains bus (Tango)

1. Dans la section **Prochains bus**, clique sur **Choisir mes arrêts**. La page télécharge les horaires officiels de Tango (données ouvertes de Nîmes Métropole), ce qui prend quelques secondes.
2. Tape le nom de ton arrêt, choisis-le (2 arrêts au maximum), puis **Utiliser ces arrêts**.
3. Coche les lignes et les sens à afficher, le nombre de passages et l'horizon, puis **Enregistrer**.
4. **Voir les prochains passages maintenant** affiche tout de suite ce que le cadre recevra.
5. Dans **Scènes et disposition**, crée une scène « Bus » avec tes créneaux et une mise à jour toutes les 3 min, et places-y le bloc **Prochains bus** (ou mets-le dans la scène Par défaut pour le voir tout le temps).

Les horaires théoriques sont corrigés par le **temps réel** quand il est disponible. Sur l'écran, « à 18h42 » est une heure en temps réel, et « vers 18h42 » une heure théorique. Un bus annulé s'affiche « supprimé ». Les horaires Tango changent quelques fois par an (rentrée, vacances) : refais alors l'étape 1 pour recharger les arrêts.

---

## 7. Graphique de température et Grand Prix de F1

Deux blocs à ajouter dans **Disposition** :

- **Graphique de température** : la courbe heure par heure sur les 12, 24, 36 ou 48 prochaines heures (réglage dans **Météo**). Les barres hachurées montrent le risque de pluie, le fond grisé la nuit, et le minimum et le maximum sont indiqués. Le nom du jour s'affiche à minuit. Taille conseillée : au moins 6 × 3 cases.
- **Grand Prix de F1** : le tracé du circuit du prochain Grand Prix (la barre marque la ligne de départ, la flèche le sens de course), le compte à rebours (« Dans 4 jours », « Ce week-end ») et les horaires des séances à l'heure française. Les séances terminées sont barrées. Le GP reste affiché jusqu'à 3 h après le départ de la course, puis le suivant prend sa place. Pour ne l'afficher que pendant les Grands Prix, place-le dans une scène dont la condition Formule 1 est « la semaine » ou « le week-end d'un Grand Prix ».

Le calendrier vient de l'API libre Jolpica (ex-Ergast). Les tracés viennent du projet libre [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) (licence MIT) et sont intégrés au serveur (`serveur/circuits.js`). Pour les mettre à jour quand un nouveau circuit arrive :
`git clone --depth 1 https://github.com/bacinger/f1-circuits /tmp/f1c && python3 outils/circuits.py /tmp/f1c`

---

## Fonctionnement et autonomie

- Le cadre se réveille selon l'intervalle choisi dans l'interface (10 min par défaut), se connecte quelques secondes, puis se rendort. Il retient les réglages de la connexion Wi-Fi précédente pour se reconnecter en 1 s environ.
- **Mode nuit** (section Réveil du cadre) : pendant la plage choisie, par exemple de 23:00 à 07:00, le cadre ne se réveille que toutes les 30, 60 ou 120 min. Il se réveille tout seul à la fin de la nuit, et au début de chaque scène. Une scène qui a son propre rythme l'emporte sur le mode nuit.
- L'écran ne se rafraîchit **que si le contenu a changé** (environ une fois par heure pour la météo), et au moins une fois par jour pour le préserver.
- Les changements faits dans l'interface s'appliquent au prochain réveil.
- **Avant une longue absence** : bouton **Écran blanc**, attends que l'aperçu devienne blanc, puis débranche la batterie. Au retour, rebranche-la et choisis un mode dans l'interface.
- L'offre gratuite de Cloudflare limite le nombre d'écritures (environ 1 000 par jour). Le serveur n'enregistre l'état du cadre que toutes les 10 min, ou quand la batterie, le mode ou le programme change, ce qui laisse de la marge même en mode développement.
