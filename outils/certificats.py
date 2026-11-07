# Produit carte/cadre_eink/certificats.h : les certificats racine des autorites qu'utilise Cloudflare
# pour ses certificats (Let's Encrypt, Google Trust Services, SSL.com), avec lesquels la carte verifie
# qu'elle parle bien a son serveur. Pris dans le magasin de certificats du systeme (Linux).
# Utilisation : python3 outils/certificats.py   (puis recompiler la carte)
# Liste de Cloudflare : https://developers.cloudflare.com/ssl/reference/certificate-authorities/
import os, subprocess, sys
MAGASIN = '/etc/ssl/certs'
RACINES = [
    ('ISRG_Root_X1', "Let's Encrypt (RSA)"),
    ('ISRG_Root_X2', "Let's Encrypt (ECC)"),
    ('GTS_Root_R1', 'Google Trust Services (RSA)'),
    ('GTS_Root_R4', 'Google Trust Services (ECC)'),
    ('SSL.com_TLS_RSA_Root_CA_2022', 'SSL.com (RSA, 2022)'),
    ('SSL.com_TLS_ECC_Root_CA_2022', 'SSL.com (ECC, 2022)'),
    ('SSL.com_Root_Certification_Authority_RSA', 'SSL.com (RSA, 2016)'),
    ('SSL.com_Root_Certification_Authority_ECC', 'SSL.com (ECC, 2016)'),
]
ici = os.path.dirname(os.path.abspath(__file__))
sortie = os.path.join(ici, '..', 'carte', 'cadre_eink', 'certificats.h')
lignes = [
    '// =====================================================================',
    "//  Cadre e-ink - certificats racine (inclus par cadre_eink.ino)",
    '//',
    "//  La carte n'accepte qu'un serveur dont le certificat est signe par l'une de ces autorites :",
    "//  celles qu'utilise Cloudflare (Let's Encrypt, Google Trust Services, SSL.com). Une fausse borne",
    "//  Wi-Fi ne peut donc ni lire les jetons de la carte, ni lui envoyer un faux programme.",
    "//  Fichier produit par outils/certificats.py : ne pas modifier a la main.",
    '// =====================================================================',
    '#pragma once',
    '',
    'const char RACINES[] =',
]
for nom, role in RACINES:
    chemin = os.path.join(MAGASIN, nom + '.pem')
    if not os.path.exists(chemin):
        sys.exit('Certificat introuvable : ' + chemin)
    fin = subprocess.check_output(['openssl', 'x509', '-in', chemin, '-noout', '-enddate'], text=True).strip().split('=')[1]
    pem = subprocess.check_output(['openssl', 'x509', '-in', chemin], text=True).strip().split('\n')
    lignes.append('  // ' + nom.replace('_', ' ') + ' : ' + role + ', valable jusqu\'au ' + fin)
    lignes += ['  "' + l + '\\n"' for l in pem]
lignes[-1] += ';'
lignes.append('')
open(sortie, 'w').write('\n'.join(lignes))
print('Ecrit :', os.path.relpath(sortie), '-', len(RACINES), 'certificats')
