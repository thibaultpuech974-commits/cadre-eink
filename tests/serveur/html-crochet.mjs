import { readFile } from 'node:fs/promises';
export async function load(url, context, suivant) {
  if (url.endsWith('.html')) {
    const texte = await readFile(new URL(url), 'utf8');
    return { format: 'module', shortCircuit: true, source: 'export default ' + JSON.stringify(texte) + ';' };
  }
  return suivant(url, context);
}
