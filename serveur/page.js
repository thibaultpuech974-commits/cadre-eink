// Page web de réglage : assemblée à partir des fichiers du dossier page/
//
// Chaque fichier est un morceau de HTML, intégré comme du texte par Cloudflare au déploiement (règle
// "Text" de wrangler.jsonc pour les .html) : structure.html (les menus), style.html (la feuille de
// style), puis un fichier de script par thème. Le serveur les met bout à bout et envoie une seule
// page : une seule requête pour le navigateur, et tous les morceaux sont toujours de la même version.
//
// L'ordre des scripts compte : commun.html d'abord (outils utilisés partout), menus.html en dernier
// (il lance le démarrage de la page, quand tout le reste est en place).
import STRUCTURE from './page/structure.html';
import STYLE from './page/style.html';
import COMMUN from './page/commun.html';
import DISPOSITION from './page/disposition.html';
import ETAT from './page/etat.html';
import REGLAGES from './page/reglages.html';
import BUS from './page/bus.html';
import TRAINS from './page/trains.html';
import PHOTO from './page/photo.html';
import PROGRAMME from './page/programme.html';
import BATTERIE from './page/batterie.html';
import JETONS from './page/jetons.html';
import ALERTES from './page/alertes.html';
import SAUVEGARDE from './page/sauvegarde.html';
import PREVISU from './page/previsu.html';
import MENUS from './page/menus.html';

const SCRIPTS = [COMMUN, DISPOSITION, ETAT, REGLAGES, BUS, TRAINS, PHOTO, PROGRAMME, BATTERIE, ALERTES, JETONS, SAUVEGARDE, PREVISU, MENUS];

// (fonctions de remplacement : un "$" du texte inséré n'est alors pas interprété)
export const PAGE = STRUCTURE.replace('<!-- STYLE -->', () => STYLE).replace('<!-- SCRIPTS -->', () => SCRIPTS.join(''));
