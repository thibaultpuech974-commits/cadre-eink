# Cadre e-ink

Cadre d'affichage à encre électronique (Waveshare 13,3", Adafruit Feather ESP32-S3) piloté par un
Cloudflare Worker. La carte ne fait que trois choses : demander au serveur quoi afficher, dessiner,
dormir. Tout le reste vit dans le serveur et se règle depuis la page web.

Le guide d'utilisation est `README.md`. Ce fichier-ci dit comment travailler dans le dépôt.

## Les parties

| Dossier | Contenu |
|---|---|
| `carte/cadre_eink/` | `cadre_eink.ino` (Wi-Fi, veille, écran, mise à jour par Wi-Fi), `dessin.h` (dessin de l'image, partagé avec l'aperçu web), `certificats.h`, `secrets.h` (jamais dans Git ; modèle : `secrets.exemple.h`) |
| `serveur/` | `worker.js` (point d'entrée et routes) et un fichier par thème, listés en tête de `worker.js` ; `page/` (page web, assemblée par `page.js`) ; `apercu.wasm` (`dessin.h` compilé pour la page) |
| `tests/serveur/` | tests du serveur, lancés par `npm test` |
| `tests/rendu/` | jeux de test du dessin (`d_*.json`) et images de référence (`references/`) |
| `outils/` | compilation de l'aperçu, certificats, tracés des circuits |

## Commandes

- `npm test` : tous les tests du serveur et du dessin (Node.js 20.6 ou plus, rien à installer). Cloudflare la lance avant chaque déploiement.
- `npm run references` : enregistre les images de référence après un changement voulu du dessin.
- `bash outils/apercu/preparer-outils.sh` (une seule fois), puis `bash outils/apercu/construire.sh` : recompile `serveur/apercu.wasm`.
- `bash tests/rendu/lancer.sh` : rendus sur ordinateur, y compris la pochette et les écrans « Hors ligne » et « Batterie vide » (g++ et Pillow).
- `cd tests/serveur && node --import ./html-texte.mjs serveur_bus.mjs` : serveur local avec la page web, sur http://localhost:8787, sans connexion (`acces-test.mjs` simule Cloudflare Access ; les tests s'en servent aussi : `connecter(w, env)`).

## Règles à ne pas casser

1. **`main` est la production.** Chaque envoi sur `main` déploie le serveur (après `npm test`). Travailler sur une branche et ouvrir une demande de fusion. Seule exception : les petites corrections du README vont directement sur `main`.
2. **Le serveur doit rester compatible avec le programme déjà installé sur la carte.** La carte est mise à jour à part, plus tard. Un nouveau champ de `/api/etat` doit être facultatif ; ne jamais renommer ni retirer un champ ou un paramètre que la carte utilise.
3. **Après une modification de `dessin.h`** : recompiler l'aperçu, lancer `npm test`, regarder les écarts (`tests/rendu/ecarts/`), puis `npm run references` s'ils sont voulus. `apercu.wasm`, `apercu.version` et les références partent dans le même envoi que `dessin.h`.
4. **Un nouveau fichier de test doit être inscrit** dans `ATTENDU` de `tests/serveur/lancer.mjs`, sinon il n'est pas lancé. Un test affiche des lignes ; `lancer.mjs` les vérifie par expressions régulières.
5. **Offre gratuite de Cloudflare** : 10 ms de calcul par requête, environ 1 000 écritures KV par jour. Pas d'écriture KV à chaque réveil du cadre (l'état n'est écrit que toutes les 10 min ou quand quelque chose change).
6. **Mémoire de la carte** : 2 Mo de PSRAM, mémoire interne juste pendant une connexion sécurisée, programme limité à 1 966 080 octets. Les grosses allocations vont en PSRAM (`ps_malloc`).
7. **Le programme de la carte ne se compile et ne s'essaie que chez l'utilisateur** (IDE Arduino, carte réelle). Toute modification de `carte/` doit le dire dans la demande de fusion (« ni compilé ni essayé sur la carte ») et indiquer quoi vérifier au moniteur série, en téléversant d'abord par USB.
8. **Aucun secret dans le dépôt** : ni `secrets.h`, ni jeton, ni nom de Wi-Fi. Les secrets (`SNCF`) et les réglages d'Access restent dans Cloudflare.
9. **Page web** : aucune bibliothèque externe. Une donnée (titre d'agenda, de chanson, nom d'arrêt) s'insère avec `textContent` ; `innerHTML` ne reçoit que du texte fixe.
10. **Pas d'entrée sans Cloudflare Access** : toute route `/api/` exige `ctx.access` et un jeton JWT vérifié (`acces.js`). Ne pas rajouter de mot de passe ni de contournement, même pour les tests.

## Conventions

- **Tout est en français** : noms de fonctions et de variables, commentaires, messages de commit, demandes de fusion, textes de l'interface. Répondre en français.
- **Commentaires** : sans accents dans `carte/` et dans la plupart des fichiers `.js` du serveur, avec accents dans les tests et la page. Suivre le style du fichier modifié. Les textes affichés (écran, page) ont toujours leurs accents.
- **Commits** : titre « Partie : ce qui change » (« Carte : … », « Page : … », « Agenda : … »), puis pourquoi, et ce qui a été vérifié ou non.
- **README** : c'est le guide d'utilisation. Le mettre à jour dans la même demande de fusion dès qu'un comportement change.
- Un commentaire dit pourquoi, pas ce que fait la ligne.

## Avant de dire que c'est fait

- `npm test` passe.
- Si la page a changé : l'essayer dans un navigateur sur le serveur local, sur ordinateur et en largeur de téléphone.
- Dire ce qui n'a pas été vérifié : la vraie carte, Cloudflare (déclencheur planifié, journaux, temps de calcul), les services extérieurs.
