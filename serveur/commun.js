// Petits outils communs : dimensions de l'écran, réponses HTTP, fusion d'objets, empreinte

export const LARGEUR = 960, HAUTEUR = 680, OCTETS = (LARGEUR / 8) * HAUTEUR;   // 81 600 octets
export const MODES = ['tableau', 'photo', 'pochette', 'blanc'];
// ---------------------------------------------------------------------
//  Utilitaires
// ---------------------------------------------------------------------
export function texte(t, statut = 200) {
  return new Response(t, { status: statut, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
export function json(obj, statut = 200) {
  return new Response(JSON.stringify(obj), {
    status: statut,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}
export function fusionner(cible, source) {
  for (const k of Object.keys(source || {})) {
    const v = source[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && cible[k] && typeof cible[k] === 'object' && !Array.isArray(cible[k])) {
      fusionner(cible[k], v);
    } else {
      cible[k] = v;
    }
  }
  return cible;
}
export async function empreinte(chaine) {
  const h = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(chaine));
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}
// Les polices de l'ecran ne contiennent que l'alphabet latin (Latin-1) :
// on remplace les caracteres typographiques et on retire le reste (emojis...)
export function pourEcran(t) {
  return String(t || '')
    .replace(/[\u2018\u2019\u02BC]/g, "'").replace(/[\u201C\u201D\u00AB\u00BB]/g, '"')
    .replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...').replace(/\u0152/g, 'OE').replace(/\u0153/g, 'oe')
    .normalize('NFC').replace(/[^\u0020-\u007E\u00A0-\u00FF]/g, '').replace(/\s+/g, ' ').trim();
}
// Copie de secours d'une source externe : enregistree au plus une fois par heure (limite d'ecritures
// du KV), relue si la source ne repond pas, tant qu'elle a moins de ageMax ms.
// 'controle' : si la copie a ete faite pour une autre adresse (ville changee), elle n'est pas utilisee.
export async function avecSecours(env, cle, ageMax, charger, controle = '') {
  try {
    const texte = await charger();
    try {
      const { metadata } = await env.CADRE.getWithMetadata(cle);
      if (!metadata || Date.now() - metadata.t > 3600e3 || metadata.c !== controle) {
        await env.CADRE.put(cle, texte, { metadata: { t: Date.now(), c: controle } });
      }
    } catch (e) { /* limite d'ecriture : sans gravite */ }
    return { texte, ancien: false };
  } catch (e) {
    const { value, metadata } = await env.CADRE.getWithMetadata(cle);
    if (value && metadata && metadata.c === controle && Date.now() - metadata.t < ageMax) {
      console.log('Copie de secours utilisee pour', cle, ':', e.message);
      return { texte: value, ancien: true };
    }
    throw e;
  }
}
