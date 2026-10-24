// Mise à jour par Wi-Fi : envoi du programme, proposition à la carte, statut
import w from '../../serveur/worker.js';
const kv = new Map();
const KV = {
  async get(k, type) { const e = kv.get(k); return e ? e.v : null; },
  async getWithMetadata(k) { const e = kv.get(k); return e ? { value: e.v, metadata: e.m } : { value: null, metadata: null }; },
  async put(k, v, o) { kv.set(k, { v, m: o && o.metadata }); },
  async delete(k) { kv.delete(k); },
};
const env = { CLE: 'secret', CADRE: KV };
globalThis.fetch = async () => new Response('{}');
const req = (p, o = {}) => w.fetch(new Request('https://cadre.test' + p, Object.assign({ headers: { 'X-Cle': 'secret' } }, o)), env);
await req('/api/config', { method: 'POST', body: JSON.stringify({ mode: 'blanc' }) });
// faux binaire : 0xE9 + marqueur de version
const bin = new Uint8Array(300000); bin[0] = 0xE9;
const marque = 'CADRE_FW:Oct  4 2026 14:03:22'; for (let i = 0; i < marque.length; i++) bin[5000 + i] = marque.charCodeAt(i);
// fonction versionDans de l'interface
const page = await (await w.fetch(new Request('https://cadre.test/'), env)).text();
const src = page.split('<script>')[1].split('</script>')[0];
const versionDans = new Function(src.slice(src.indexOf('function versionDans'), src.indexOf('function envoyerFirmware')) + 'return versionDans;')();
const v = versionDans(bin); console.log('version lue :', v);
console.log('envoi mauvais fichier :', (await req('/api/firmware?v=' + v, { method: 'POST', body: new Uint8Array(200000) })).status);
console.log('envoi :', (await req('/api/firmware?v=' + v + '&nom=cadre_eink.ino.bin', { method: 'POST', body: bin })).status);
const etat = async fw => (await (await req('/api/etat' + (fw ? '?fw=' + fw : ''))).json()).fw;
console.log('carte ancienne 20261001-120000 -> fw proposé :', await etat('20261001-120000'));
console.log('carte identique               -> fw proposé :', await etat(v));
console.log('carte plus récente            -> fw proposé :', await etat('20261020-080000'));
console.log('carte sans version            -> fw proposé :', await etat(''));
const b = await req('/api/firmware.bin?cle=secret', { headers: {} }); console.log('téléchargement :', b.status, (await b.arrayBuffer()).byteLength);
console.log('statut fw :', JSON.parse(kv.get('statut').v).fw);
await req('/api/firmware', { method: 'DELETE' });
console.log('après retrait -> fw proposé :', await etat('20261001-120000'), '| binaire :', (await req('/api/firmware.bin')).status);
