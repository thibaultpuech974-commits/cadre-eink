// =====================================================================
//  Cadre e-ink - identifiants de la carte : MODELE
//
//  Copie ce fichier en "secrets.h" (meme dossier), puis remplis secrets.h.
//  secrets.h n'est jamais envoye sur GitHub (il est dans .gitignore) : tes mots de passe
//  restent sur ton ordinateur. Ce modele, lui, est public : n'y mets rien de vrai.
// =====================================================================
#pragma once

const char* WIFI_SSID   = "NOM_DE_TA_BOX";
const char* WIFI_MDP    = "MOT_DE_PASSE";
const char* SERVEUR     = "https://cadre.TON-NOM.workers.dev";   // sans / a la fin
// Jeton de service Cloudflare Access du cadre (Zero Trust -> Access -> Service credentials).
// Indispensable : le serveur n'a pas d'autre entree.
const char* ACCES_ID     = "";   // CF-Access-Client-Id     (se termine par .access)
const char* ACCES_SECRET = "";   // CF-Access-Client-Secret
