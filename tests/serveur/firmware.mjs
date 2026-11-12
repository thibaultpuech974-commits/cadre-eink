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
const src = await (await w.fetch(new Request('https://cadre.test/'), env)).text();
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
// Programme refusé par la carte (retour arrière) : plus proposé ; 3 téléchargements sans succès : plus proposé
console.log('programme refusé par la carte -> fw proposé :', await etat('20261001-120000&fwko=' + v));
console.log('refus enregistré :', JSON.parse(kv.get('statut').v).fwko === v);
await req('/api/firmware.bin'); await req('/api/firmware.bin');
console.log('après 3 téléchargements -> fw proposé :', await etat('20261001-120000'));
await req('/api/firmware?v=' + v + '&nom=cadre_eink.ino.bin', { method: 'POST', body: bin });
console.log('renvoyé -> fw proposé :', await etat('20261001-120000'));
// Redémarrages anormaux signalés par la carte, et date de la réponse (écran "Hors ligne")
const r1 = await (await req('/api/etat?fw=' + v + '&pa=2&ra=W')).json();
const st = JSON.parse(kv.get('statut').v);
console.log('plantages :', st.pa, st.ra, typeof st.pat === 'number', '| quand :', /^(lun|mar|mer|jeu|ven|sam|dim)\. \d{1,2} [a-zéû]+ à \d\d:\d\d$/.test(r1.quand));
const pat = st.pat;
await req('/api/etat?fw=' + v + '&pa=2&ra=W');
console.log('même compteur : date gardée', JSON.parse(kv.get('statut').v).pat === pat, '| cause :', JSON.parse(kv.get('statut').v).ra);
// Dernier contact : enregistré au plus toutes les 10 min, sauf si la carte vient de redémarrer
const ilYa = Date.now() - 5 * 60000;
kv.set('statut', { v: JSON.stringify(Object.assign(JSON.parse(kv.get('statut').v), { vu: ilYa, ev: 50000, ee: 1000 })) });
await req('/api/etat?fw=' + v + '&ev=60000&ee=1000');
const vuSansRedemarrage = JSON.parse(kv.get('statut').v).vu === ilYa;
await req('/api/etat?fw=' + v + '&ev=3000&ee=0');
console.log('contact 5 min après : pas d\'écriture', vuSansRedemarrage, '| carte redémarrée : enregistré', JSON.parse(kv.get('statut').v).vu > ilYa);
await req('/api/firmware', { method: 'DELETE' });
console.log('après retrait -> fw proposé :', await etat('20261001-120000'), '| binaire :', (await req('/api/firmware.bin')).status);
