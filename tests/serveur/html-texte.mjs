// Pour les tests sous Node : "import x from './interface.html'" donne le texte du fichier,
// comme le fait Cloudflare au deploiement. Utilisation : node --import ./html-texte.mjs test.mjs
import { register } from 'node:module';
register('./html-crochet.mjs', import.meta.url);
