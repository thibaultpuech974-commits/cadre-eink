// Imports de fichiers comme le fait Cloudflare au deploiement (regles de wrangler.jsonc) :
// .html -> texte, apercu.wasm -> octets (ArrayBuffer)
import { readFile } from 'node:fs/promises';
export async function load(url, context, suivant) {
  if (url.endsWith('.html')) {
    const texte = await readFile(new URL(url), 'utf8');
    return { format: 'module', shortCircuit: true, source: 'export default ' + JSON.stringify(texte) + ';' };
  }
  if (url.endsWith('.wasm')) {
    const b64 = (await readFile(new URL(url))).toString('base64');
    return { format: 'module', shortCircuit: true, source: 'export default Uint8Array.from(atob(' + JSON.stringify(b64) + '), c => c.charCodeAt(0)).buffer;' };
  }
  return suivant(url, context);
}
