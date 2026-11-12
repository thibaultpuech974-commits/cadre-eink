# Cadre e-ink : guide d'installation

Le projet a trois parties :

| Partie | Fichier | Rôle |
|---|---|---|
| Serveur web | `serveur/` : `worker.js` (point d'entrée et routes) et un fichier par thème (`meteo.js`, `agenda.js`, `bus.js`, `f1.js`, `scenes.js`, `tableau.js`, `rebours.js`, `alertes.js`, `rafraichissement.js`…, liste en tête de `worker.js`), `page/` (page web : `structure.html` pour les menus, `style.html`, et un script par thème, assemblés par `page.js`), `circuits.js` (tracés F1) | Interface web, météo, agenda, bus, F1, photo, aperçu |
| Carte ESP32 | `carte/cadre_eink/` : `cadre_eink.ino` (réglages, Wi-Fi, écran, veille) et `dessin.h` (dessin de l'image, partagé avec l'aperçu web) | Se réveille, demande quoi afficher, dessine, se rendort |
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
   - Valeur : un mot de passe de ton choix (il protège ton cadre tant que Cloudflare Access n'est pas activé, voir 1 bis)
7. Ton adresse est affichée en haut de la page du Worker, du type
   `https://cadre.ton-nom.workers.dev`. Ouvre-la et connecte-toi avec ton mot de passe.

## 1 bis. Protéger l'accès avec Cloudflare Access (recommandé)

Avec Access, personne n'atteint le serveur sans s'être identifié : la page web demande une connexion (code reçu par email + code d'une app d'authentification), et la carte et le raccourci iPhone présentent chacun un **jeton de service**. Le mot de passe `CLE` ne sert plus qu'en secours, si Access est désactivé.

**Ordre à respecter** (sinon le cadre est bloqué dès l'activation d'Access) : d'abord installer les jetons sur la carte et dans le raccourci, ensuite activer Access.

1. **Zero Trust** : dans le tableau de bord, ouvre **Zero Trust**. La première fois, choisis un nom d'équipe et l'offre **Free** (gratuite jusqu'à 50 utilisateurs).
2. **Jetons de service** : **Zero Trust → Access controls → Service credentials → Service Tokens → Create Service Token**. Crée-en deux : `cadre-esp32` et `raccourci-iphone` (durée : sans expiration). Note à chaque fois le **Client ID** et le **Client Secret** : le secret n'est affiché qu'une seule fois. Deux jetons séparés permettent d'en couper un sans toucher à l'autre.
3. **Carte** : remplis `ACCES_ID` et `ACCES_SECRET` dans `secrets.h` (voir partie 2) avec le jeton `cadre-esp32`, puis installe ce programme (par câble ou par Wi-Fi, voir partie 2). Il marche avant comme après l'activation d'Access.
4. **Raccourci iPhone** : ajoute les deux en-têtes du jeton `raccourci-iphone` (partie 4, étape 9).
5. **Activer Access** : **Workers & Pages → cadre → onglet Access → Protect this Worker behind Access**, choisis **All traffic**, et une règle qui n'autorise que ton adresse email. Toutes les adresses du Worker sont protégées, `workers.dev` compris.
6. **Autoriser les jetons** : **Zero Trust → Access controls → Applications**, ouvre l'application du Worker → **Policies → Add a policy**, action **Service Auth**, règle **Include → Service Token** avec `cadre-esp32` et `raccourci-iphone`.
7. **Double authentification** : **Zero Trust → Access controls → Access settings**, active l'**Independent MFA** (méthode : application d'authentification, TOTP). Puis, dans l'application du Worker → **Authentication → MFA**, choisis de l'exiger. À la première connexion, tu scannes un QR code avec une app comme Google Authenticator ou Authy.
8. **Vérifier** : ouvre l'adresse du Worker dans une fenêtre privée. Tu dois tomber sur la page de connexion Cloudflare, puis arriver directement sur l'interface, sans mot de passe. En bas de la page, « Se déconnecter » affiche ton adresse. Attends un réveil du cadre et lance le raccourci une fois pour vérifier qu'ils passent.

Ensuite, tu peux garder le secret `CLE` (il n'est utilisé que si Access est désactivé) ou le supprimer : sans Access ni `CLE`, le serveur refuse tout.

**Droits de chaque jeton** : le serveur vérifie le jeton signé par Cloudflare à chaque requête, et limite chaque jeton de service à son rôle. La carte n'a accès qu'à ses routes : son état, la photo, la pochette, son programme et l'envoi de l'aperçu. Le raccourci ne peut qu'envoyer la pochette. Un jeton volé ne peut donc ni changer les réglages, ni lire la sauvegarde, ni envoyer un programme à la carte. Le rôle est deviné dès que le jeton se comporte comme la carte (elle demande son état avec sa version) ou comme le raccourci (il envoie une pochette). Il se vérifie et se change dans la page web, menu **Accès des jetons** (groupe Système). Un jeton dont le rôle n'a pas pu être deviné n'a aucun droit tant que tu ne lui en as pas choisi un. Les personnes connectées gardent tous les droits.

En cas de fuite d'un jeton (téléphone perdu, code publié par erreur) : dans **Service Tokens**, désactive-le ou fais **Rotate** pour en générer un nouveau. Les vraies valeurs de `WIFI_MDP`, `CLE` et `ACCES_SECRET` restent dans `secrets.h`, qui n'est jamais envoyé sur GitHub.

**Déploiement automatique depuis GitHub** : le fichier `wrangler.jsonc` du dépôt décrit le Worker (nom `cadre`, fichier `serveur/worker.js`, espace KV `CADRE`). Une fois le dépôt connecté dans **Paramètres → Builds**, chaque envoi sur la branche `main` redéploie le serveur, avec tous les fichiers du dossier `serveur/`. Le secret `CLE` et les réglages d'Access restent dans Cloudflare. Le même fichier active deux choses : les **journaux** du serveur (**Workers & Pages → cadre → Observabilité** : source en panne, copie de secours utilisée, erreur d'une route, alerte envoyée ; gardés 3 jours) et un **déclencheur planifié** une fois par heure, qui sert aux alertes sur l'iPhone (partie 8).

**Tests avant chaque déploiement** : dans **Paramètres → Builds → Configuration du build**, mets `npm test` comme **commande de build** (la commande de déploiement reste `npx wrangler deploy`). Cloudflare lance alors les tests du serveur avant de déployer : si l'un d'eux échoue, le déploiement est annulé et l'ancienne version reste en ligne. Pour les lancer toi-même : `npm test` à la racine du dépôt (Node.js 20.6 ou plus, rien à installer). Serveur de test local avec la page web : `cd tests/serveur && node --import ./html-texte.mjs serveur_bus.mjs`, puis http://localhost:8787 (mot de passe `secret`).

L'interface web marche sur ordinateur, iPhone et iPad. Sur iPhone, **Partager → Sur l'écran d'accueil** la transforme en « app ».

---

## 2. Programmer la carte

1. Dans l'IDE Arduino, installe les bibliothèques **GxEPD2**, **U8g2_for_Adafruit_GFX**, **ArduinoJson** (Benoit Blanchon) et **JPEGDEC** (bitbank2).
2. Carte : **Adafruit Feather ESP32-S3 2MB PSRAM** (la PSRAM, indispensable pour les pochettes, est activée d'office). Dans **Outils → Partition Scheme**, choisis **Minimal SPIFFS (1.9MB APP with OTA/128KB SPIFFS)** : le programme (environ 1,6 Mo) ne tient pas dans le schéma par défaut (1,2 Mo), et la mise à jour par Wi-Fi demande un schéma « with OTA ». Avec un schéma « No OTA » ou « Huge APP », la carte refuse les mises à jour par Wi-Fi (« Partition Could Not be Found »). À la compilation, le maximum annoncé doit être 1 966 080 octets ; si le programme approche cette limite, il faudra alléger les polices.

   **Câblage de l'écran** (connecteur 9 broches de la carte pilote → Feather) : VCC → 3V, GND → GND, DIN → MO, CLK → SCK, CS → 5, DC → 6, RST → 9, BUSY → 10, PWR → A2. La batterie est lue par la jauge MAX17048 intégrée à la Feather : aucun câblage. Broches réservées au 2e écran : CS → 12, RST → A0, BUSY → A1 (DC, PWR, DIN et CLK partagés).
   Ouvre `cadre_eink.ino` : l'IDE affiche aussi `dessin.h`, `certificats.h` et `secrets.h` dans d'autres onglets. Tous ces fichiers doivent rester ensemble dans le dossier `cadre_eink`.
3. **Tes identifiants** : dans le dossier `cadre_eink`, copie `secrets.exemple.h` sous le nom `secrets.h`, puis remplis `secrets.h` :
   - `WIFI_SSID` et `WIFI_MDP` (Wi-Fi 2,4 GHz)
   - `SERVEUR` : l'adresse du Worker, sans `/` à la fin
   - `CLE` : le même mot de passe que dans Cloudflare
   - `ACCES_ID` et `ACCES_SECRET` : le jeton de service du cadre si tu utilises Cloudflare Access (partie 1 bis), sinon laisse-les vides

   `secrets.h` est ignoré par Git (`.gitignore`) : il reste sur ton ordinateur, et une nouvelle version du programme récupérée sur GitHub ne l'écrase pas. Sans lui, la compilation s'arrête sur « Fichier secrets.h introuvable ».

   En haut de `cadre_eink.ino`, deux réglages :
   - `ECRAN_PRESENT` : laisse **1** quand l'écran est branché. À **0**, la carte fonctionne sans écran : elle dessine quand même et envoie l'image à l'aperçu web.
   - `VERIFIER_CERTIFICAT` : laisse **1**. La carte vérifie alors que le serveur est bien le sien : son certificat doit être signé par l'une des autorités de `certificats.h`, celles qu'utilise Cloudflare (Let's Encrypt, Google Trust Services, SSL.com). Sans cette vérification, une fausse borne Wi-Fi au même nom pourrait lire les jetons de la carte et lui envoyer un faux programme. Si la carte affiche « Certificat du serveur refusé » (Cloudflare serait passé à une autre autorité), mets **0** le temps de mettre à jour `certificats.h` (`python3 outils/certificats.py`), puis remets **1**. Installe la première version avec vérification **par câble**, moniteur série ouvert : si la connexion échoue, la ligne « connexion securisee » en donne la raison.
4. Téléverse, puis ouvre le moniteur série (115200 bauds) pour suivre le premier réveil.
5. Quelques secondes plus tard, l'aperçu apparaît dans l'interface web.

**Pour téléverser à nouveau** : la carte dort presque tout le temps. Deux solutions :
- active le **Mode développement** dans la section **Réveil du cadre** de la page web. La carte ne se met plus en veille, vérifie toutes les 15 à 60 s, et le téléversement marche normalement. À utiliser branché en USB, et à désactiver une fois fini. Il prend effet au prochain réveil, ou tout de suite si tu appuies sur le bouton **RESET** de la carte ;
- ou maintiens le bouton **BOOT**, appuie sur **RESET**, relâche BOOT, puis téléverse (le numéro du port COM peut changer : vérifie **Outils → Port**). Après le téléversement, appuie une fois sur **RESET**.

**Mettre à jour la carte par Wi-Fi** (une fois ce programme installé par câble) :
1. Dans l'IDE Arduino, avec le même **Partition Scheme** que ci-dessus, **Croquis → Exporter les binaires compilés**.
2. Dans le dossier du croquis, ouvre `build`, puis le sous-dossier de la carte : le fichier à prendre est `cadre_eink.ino.bin` (pas `merged`, `bootloader` ni `partitions`).
3. Dans la page web, section **Programme de la carte**, choisis ce fichier puis **Envoyer le programme**.
4. Au réveil suivant, la carte le télécharge (la LED rouge s'allume environ 30 s), redémarre et redessine l'écran. La section affiche alors « installé ».

La carte ne se met à jour que si sa batterie dépasse 3,6 V, et seulement vers un programme plus récent que le sien.

**Retour arrière automatique** : un programme reçu par Wi-Fi démarre « à l'essai ». Il n'est gardé qu'une fois qu'il a joint le serveur (il pourra donc recevoir un correctif). S'il plante, ou s'il n'arrive pas à joindre le serveur en 3 essais espacés de 30 s, la carte revient toute seule à son programme précédent et n'installera plus cette version : la section **Programme de la carte** l'indique. Envoie alors une version corrigée (recompilée, donc plus récente). Le serveur arrête aussi de proposer un programme téléchargé 3 fois sans être gardé : renvoie-le pour réessayer. Ce filet ne marche qu'à partir de ce programme-ci : il doit déjà être sur la carte. Le premier programme qui l'apporte s'installe comme avant, sans filet ; installe-le de préférence par câble.

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
   - Avec Cloudflare Access (partie 1 bis), **En-têtes** : ajoute `CF-Access-Client-Id` et `CF-Access-Client-Secret` avec les valeurs du jeton `raccourci-iphone`. L'adresse de l'étape 8 ne contient alors plus de mot de passe.

Lance-le pendant que la musique joue : le cadre passe en mode Pochette à son prochain réveil.

Limite d'iOS : un raccourci ne peut pas se déclencher tout seul à chaque changement de morceau. Lance-le à la main, via Siri (« Pochette sur le cadre »), un widget ou le bouton Action. Tu peux aussi créer une automatisation **Quand l'app Musique est ouverte**.

---

## 5. Scènes et disposition du tableau de bord

**Trois groupes de menus** : **Contenu** (scènes, météo, agenda, bus, compte à rebours, photo, pochette), **Cadre** (montage, réveil, batterie, alertes) et **Système** (programme de la carte, jetons, sauvegarde). Un seul groupe est affiché à la fois ; la page retient lequel, et les menus ouverts.

**Annuler / Rétablir** : au-dessus des blocs, ↶ et ↷ (ou Ctrl+Z / Ctrl+Maj+Z) reviennent en arrière ou en avant d'une modification à la fois : déplacement, taille, ajout ou retrait d'un bloc, texte, création ou suppression d'une scène, nombre d'écrans.

**Texte d'un bloc** : touche un bloc (sans le déplacer) : une bulle s'ouvre contre lui avec sa taille et sa police ; ✕ ou un appui ailleurs dans l'éditeur la ferme.

**Enregistrer** : la page n'a qu'un seul bouton Enregistrer. Dès qu'un réglage change (disposition, montage, météo, agenda, compte à rebours, bus, réveil, alertes), une barre « Non enregistré : Météo, Réveil… » (les menus concernés) apparaît en bas avec **Enregistrer** et **Annuler** ; la page prévient si tu la quittes sans enregistrer. Les actions immédiates (changer de mode, envoyer une photo ou un programme, choisir les arrêts de bus) ne passent pas par cette barre.

**État du cadre** : sous l'aperçu, des pastilles résument la dernière connexion (orange si le cadre aurait dû se connecter depuis longtemps), la batterie, le prochain réveil, la scène affichée et l'heure de l'image. Après un changement (mode, réglages, photo, pochette), la pastille **Changement en attente · réveil dans 6 min** reste affichée tant que le cadre n'est pas passé prendre les réglages, puis devient **Appliqué à 14:12** pendant une heure. Tant qu'un changement attend, la page regarde toutes les 20 s si le cadre est passé.

**Montage du cadre** (groupe Cadre) : nombre d'écrans, sens du cadre (paysage, portrait, portrait inversé) et traits de séparation, des réglages qu'on ne fait qu'une fois.

**Agenda** : sous les adresses des calendriers, la page indique pour chacun s'il est accessible (✓) et combien d'évènements il contient dans les prochains jours, ou ce qui ne va pas (✗ : adresse invalide, calendrier introuvable ou plus public…). Sur l'écran, les évènements sont regroupés par jour (le jour n'est écrit qu'une fois), et le lieu suit le titre quand il reste de la place (« Colle de maths · C104 ») ; l'option **Afficher le lieu** le retire.

**Scènes** : une scène est une disposition des blocs affichée pendant une période choisie. La scène **Par défaut** s'affiche quand aucune autre n'est active. Dans la section **Scènes et disposition** :
- **+ Nouvelle scène** crée une scène (copie de « Par défaut ») ; donne-lui un nom ;
- **Quand l'afficher** : des créneaux (jours + heures, par exemple « ven de 18:00 à 20:00 »), et/ou la semaine ou le week-end d'un Grand Prix de F1, et/ou des dates (du … au …). Toutes les conditions remplies doivent l'être ; une scène sans condition est affichée tout le temps ;
- **Mise à jour toutes les …** : rythme propre à la scène (3 min pour les bus, par exemple). « Rythme normal » garde celui de « Réveil du cadre » (et le mode nuit) ;
- **Plus prioritaire** / **Moins prioritaire** : si plusieurs scènes sont actives en même temps, celle de gauche l'emporte ;
- **Dupliquer** copie la scène choisie (créneaux et blocs) : pratique pour une variante, par exemple des heures creuses avec les mêmes blocs ;
- la **frise**, sous la liste des scènes, montre quelle scène s'affichera à chaque heure des 7 prochains jours, avec tes réglages même non enregistrés : une ligne par jour, une couleur par scène, le trait vertical marque maintenant. Touche un créneau pour lire ses heures et choisir sa scène ; la phrase du dessous donne la scène du moment, les prochains changements, et les scènes qui ne s'affichent jamais dans la semaine ;
- le cadre se réveille tout seul au début et à la fin de chaque scène.

Exemples : « Bus » (ven 18:00-20:00, mise à jour 3 min, bloc bus en grand), « Grand Prix » (week-end d'un GP, bloc F1), « Vacances » (du 17/10 au 01/11, sans l'agenda des cours). La page indique la scène affichée en ce moment (point • à côté de son nom). Tes anciens réglages ont été convertis : la disposition « Pendant les créneaux bus » est devenue la scène « Bus ».

**Prévisualisation** : le bouton **Prévisualiser** (sous les blocs, ou en haut des menus) ouvre un panneau en bas de l'écran qui dessine une scène exactement comme le cadre l'affichera, avec les données actuelles et tes réglages de disposition, météo, agenda et bus, même pas encore enregistrés. L'image suit chaque modification ; le menu du panneau choisit la scène, « – » le réduit et « ✕ » le ferme. Tire la barre de titre pour le déplacer, et son coin en bas à droite pour l'agrandir ou le réduire ; la page retient sa place (double-clic sur la barre : retour en bas à droite). Rien n'est enregistré ni envoyé au cadre. Elle utilise le même code de dessin que la carte, compilé en WebAssembly (`serveur/apercu.wasm`).

> **Après chaque modification de `dessin.h`** (le dessin de l'image), recompile la prévisualisation : `bash outils/apercu/preparer-outils.sh` (une seule fois), puis `bash outils/apercu/construire.sh`. Les tests refusent le déploiement si elle n'est pas à jour. Une modification de `cadre_eink.ino` seul (réseau, écran, veille) n'en demande pas.

Pour les blocs de la scène choisie :
- fais glisser un bloc pour le déplacer (au doigt ou à la souris) ;
- tire son **coin en bas à droite** pour l'agrandir ou le réduire ;
- coche ou décoche un bloc pour l'ajouter ou le retirer ;
- **Traits de séparation** dessine des lignes entre les blocs.

L'écran est découpé en une grille de 12 × 8 cases, et les blocs ne peuvent pas se chevaucher. Le contenu de chaque bloc s'adapte à sa taille : polices, taille des icônes, nombre de colonnes d'heures ou de jours, nombre de lignes d'agenda. Dans l'agenda, un titre trop long pour sa ligne passe sur 2, voire 3 lignes quand il reste de la place en bas du bloc (sans jamais retirer un évènement de la liste). Clique sur **Enregistrer**, et le cadre applique la disposition à son prochain réveil.

**Orientation** (menu **Montage du cadre**) : les boutons **Paysage**, **Portrait** et **Portrait inversé** choisissent le sens du cadre. Les deux portraits correspondent aux deux façons d'accrocher le cadre en hauteur : prends celui qui affiche l'image à l'endroit. Chaque orientation garde sa propre disposition (grille de 8 × 12 cases en portrait). Une photo est préparée dans l'orientation active au moment de l'envoi : renvoie-la si tu changes d'orientation.

**Tailles et polices** : dans la bulle, choisis la **taille** (Petite, Normale, Grande, Très grande) et sa **police** (Moderne, Helvetica, Classique, Machine à écrire). Chaque cran change tous les textes du bloc d'un palier (environ 25 %), et un texte trop long rétrécit avant d'être coupé. Helvetica et Classique s'arrêtent à 25 px : en Grande et Très grande, leurs plus grands textes passent en Moderne (42 px au plus). Machine à écrire monte jusqu'à 53 px (Courier pour les petites tailles, Inconsolata au-delà).

Le curseur **Contour de l'aperçu** ne règle que l'épaisseur du cadre noir dessiné autour de l'aperçu sur la page web. Il ne change rien sur l'écran.

**Deux écrans** : avec deux dalles identiques assemblées, choisis **Deux côte à côte** ou **Deux l'un sur l'autre** dans **Montage du cadre**. La grille est doublée (24 × 8 cases côte à côte en paysage, 12 × 16 l'un sur l'autre), et la jointure entre les deux écrans est dessinée en noir : un bloc ne peut pas être à cheval dessus. Indique l'**espace entre les zones d'affichage** (en mm) : il sert à aligner l'aperçu et à découper les photos pour que l'image reste continue. L'écran 1 est celui de gauche (ou du haut). En mode Pochette, la pochette s'affiche sur l'écran 1 et le titre en grand sur l'écran 2.

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

## 7. Graphique de température, Grand Prix de F1 et compte à rebours

Trois blocs à ajouter dans **Scènes et disposition** :

- **Graphique de température** : la courbe heure par heure sur les 12, 24, 36 ou 48 prochaines heures (réglage dans **Météo**). Les barres hachurées montrent le risque de pluie, le fond grisé la nuit, et le minimum et le maximum sont indiqués. Le nom du jour s'affiche à minuit. Taille conseillée : au moins 6 × 3 cases.
- **Grand Prix de F1** : le tracé du circuit du prochain Grand Prix (la barre marque la ligne de départ, la flèche le sens de course), le compte à rebours (« Dans 4 jours », « Ce week-end ») et les horaires des séances à l'heure française. Les séances terminées sont barrées. Le GP reste affiché jusqu'à 3 h après le départ de la course, puis le suivant prend sa place. Pour ne l'afficher que pendant les Grands Prix, place-le dans une scène dont la condition Formule 1 est « la semaine » ou « le week-end d'un Grand Prix ».
- **Compte à rebours** : les jours restants avant une date (« J-39 », puis « Jour J »), avec les dates suivantes dessous ou à côté selon la taille du bloc. Les dates se saisissent dans le menu **Compte à rebours**, une par ligne : le nom puis la date (« Vacances de Noël 19/12/2026 »). Sans année, la date revient chaque année ; une date passée disparaît toute seule ; 12 dates au plus.

Le calendrier vient de l'API libre Jolpica (ex-Ergast). Les tracés viennent du projet libre [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) (licence MIT) et sont intégrés au serveur (`serveur/circuits.js`). Pour les mettre à jour quand un nouveau circuit arrive :
`git clone --depth 1 https://github.com/bacinger/f1-circuits /tmp/f1c && python3 outils/circuits.py /tmp/f1c`

---

## 8. Photo plein écran et alertes sur l'iPhone

**Photo** (groupe Contenu) : choisis une image, puis cadre-la dans l'aperçu tramé. **Remplir** couvre tout l'écran, **Image entière** la montre en entier avec des marges blanches. Fais glisser la photo pour choisir la partie visible, pince-la (ou utilise le curseur **Zoom**, jusqu'à 4 fois) pour l'agrandir ; **Recentrer** revient au cadrage de départ. **Tramage** : Floyd-Steinberg garde les nuances fines, Atkinson donne des noirs et des blancs plus francs, souvent plus lisibles de loin. **Envoyer au cadre** envoie l'image telle que tu la vois.

**Alertes** (groupe Cadre) : le serveur vérifie une fois par heure et envoie une notification sur l'iPhone quand le cadre ne donne plus de nouvelles depuis 3 h, quand la batterie passe sous le seuil choisi (10, 20 ou 30 %), ou quand les horaires de bus arrivent à leur fin. Mise en route :
1. installe l'application gratuite **ntfy** sur l'iPhone (aucun compte) ;
2. dans le menu **Alertes sur l'iPhone**, clique sur **Générer un sujet**, coche la première case, puis **Enregistrer** ;
3. dans ntfy, touche « + » et abonne-toi à ce sujet ;
4. **Envoyer un essai** : la notification doit arriver en quelques secondes.

Une notification par problème, puis un rappel par jour tant qu'il dure (tous les 3 jours pour les bus), et une dernière quand le cadre répond à nouveau. Le sujet tient lieu de mot de passe : quiconque le connaît peut lire tes alertes, garde donc le sujet long tiré au hasard. Les notifications passent par le service public ntfy.sh. En mode Écran blanc, le cadre est considéré comme rangé : pas d'alerte de silence.

---

## Fonctionnement et autonomie

- Le cadre se réveille selon l'intervalle choisi dans l'interface (10 min par défaut), se connecte quelques secondes, puis se rendort. Il retient les réglages de la connexion Wi-Fi précédente pour se reconnecter en 1 s environ.
- **Mode nuit** (section Réveil du cadre) : pendant la plage choisie, par exemple de 23:00 à 07:00, le cadre ne se réveille que toutes les 30, 60 ou 120 min. Il se réveille tout seul à la fin de la nuit, et au début de chaque scène. Une scène qui a son propre rythme l'emporte sur le mode nuit.
- **Heures creuses** (même menu) : des plages jours + heures où personne ne regarde le cadre, par exemple du lundi au vendredi de 8:00 à 17:00. Il s'y réveille toutes les 30 min à 4 h, comme la nuit, et jamais plus souvent qu'en temps normal. Il se réveille tout seul à la fin de la plage et au début de chaque scène ; une scène qui a son propre rythme l'emporte. Une plage ne peut pas passer minuit : pour la nuit, utilise le mode nuit.
- L'écran ne se rafraîchit **que si le contenu a changé**, et au moins une fois par jour pour le préserver.
- **Rafraîchissement commandé par le serveur** (menu Réveil du cadre) : la carte envoie l'image qu'elle vient de dessiner, et le serveur la compare à l'image affichée. Si peu de choses changent, il renvoie les zones concernées et la carte fait une **mise à jour partielle** (environ 0,6 s, sans clignotement). Sinon, rafraîchissement complet (environ 4,5 s) : quand plus de 40 % de l'écran change (réglable), pour une photo, une pochette ou l'écran blanc. Avec un **nettoyage** (l'écran passe d'abord au blanc, environ 9 s) au démarrage de la carte et au moins une fois toutes les 24 h (réglable), comme le conseille le fabricant de l'écran. La carte garde l'empreinte de l'image vraiment affichée : en cas de doute (rafraîchissement raté ou reporté), le serveur demande un rafraîchissement complet. La pastille « Image de … » indique comment la dernière image a été affichée. Plusieurs méthodes de mise à jour partielle, à choisir selon le rendu sur la dalle : **simple** (une passe, sans clignotement, mais des traces d'anciennes images peuvent rester), **double, triple ou quadruple passe** (les pixels qui changent reçoivent 2 à 4 impulsions dans le même sens, environ 0,5 s chacune : les traces s'effacent mieux, comme dans le projet [InkBoy](https://github.com/kuslota/InkBoy)) et **inversion des zones** (chaque zone passe en négatif puis revient : tous ses pixels font un aller-retour complet, avec un petit clignotement limité aux zones). Changer de méthode nettoie l'écran au prochain affichage ; on peut aussi imposer un rafraîchissement complet après 3, 6 ou 12 mises à jour partielles. Particularité du contrôleur de cette dalle : après chaque mise à jour partielle, il échange le rôle de ses deux mémoires (image précédente et nouvelle image). Les méthodes à deux passes en tiennent compte. Le programme `carte/test_ecran/test_ecran.ino` permet de le vérifier sur une autre dalle (`TEST 1`). Son `TEST 2` compare les méthodes côte à côte : l'écran est coupé en 5 colonnes (1, 2, 3, 4 passes, inversion) qui reçoivent les mêmes 24 changements, chacune avec sa méthode. La colonne qui garde le moins de traces indique la méthode à choisir.
- **Image identique** : quand seule une donnée invisible a changé (le vent quand le bloc météo est étroit, un évènement au-delà des lignes affichées), le dessin donne exactement l'image déjà à l'écran. La carte ne l'envoie alors pas au serveur et ne touche pas à l'écran.
- **Une seule connexion sécurisée par réveil** : les requêtes d'un réveil (état, photo, envoi de l'image) passent par la même connexion, au lieu d'en négocier une chacune (environ une seconde d'éveil à chaque fois). Elle est fermée avant le décodage d'une pochette, une mise à jour du programme et le rafraîchissement de l'écran, qui ont besoin de la mémoire.
- Le Wi-Fi est coupé pendant le rafraîchissement de l'écran (sauf en mode développement).
- **Hors ligne** : sans réponse du serveur depuis plus de 3 h (Wi-Fi perdu, serveur en panne, accès refusé…), le tableau de bord affiché n'est plus à jour. Le cadre le remplace alors par un écran « Hors ligne » qui donne la cause et la date des dernières nouvelles. Une photo ou l'écran blanc restent affichés. Le cadre réessaie toutes les 30 min, puis reprend l'affichage normal dès que le serveur répond. Un échec isolé est réessayé au bout de 10 min au plus, même la nuit.
- **Garde-fou** : si la carte plante ou reste bloquée plus de 4 min, elle redémarre. Après 3 redémarrages anormaux d'affilée, elle se met en pause une heure avant de réessayer, au lieu de vider la batterie. La page web affiche « Redémarrage anormal le … » pendant 7 jours, avec la cause au survol. L'intervalle de réveil est toujours compris entre 1 min et 24 h, quoi que demande le serveur.
- **Temps d'éveil** (menu Batterie) : la carte compte le temps passé hors veille, et le temps d'écran, et les envoie au réveil suivant. La page affiche les secondes d'éveil par jour : le meilleur indicateur de consommation sans multimètre.
- Les changements faits dans l'interface s'appliquent au prochain réveil : la pastille « Changement en attente », puis « Appliqué à … », le confirme sous l'aperçu.
- **Graphique de batterie** (menu Batterie) : les périodes de charge sont grisées et marquées « en charge » : celles où la jauge de la carte mesure une charge (au moins +2 % par heure), ou où la tension monte nettement (au moins +60 mV). Sous le graphique, une ligne indique la dernière recharge (« il y a 2 jours, jusqu'à 100 % ») ou « en charge en ce moment ». Le pourcentage est celui de la jauge MAX17048 de la Feather ; pour les mesures plus anciennes, il est déduit de la tension. L'autonomie est estimée à partir de 6 h après une recharge (avant, la tension redescend d'elle-même) ; il faut donc environ 18 h de mesures. La vitesse de la jauge (0,2 % par heure par cran) sert à repérer les charges : la consommation du cadre, bien plus faible, se lit sur la pente du pourcentage.
- **Avant une longue absence** : bouton **Écran blanc**, attends que l'aperçu devienne blanc, puis débranche la batterie. Au retour, rebranche-la et choisis un mode dans l'interface.
- L'offre gratuite de Cloudflare limite le nombre d'écritures (environ 1 000 par jour). Le serveur n'enregistre l'état du cadre que toutes les 10 min, ou quand la batterie, le mode ou le programme change, ce qui laisse de la marge même en mode développement.
