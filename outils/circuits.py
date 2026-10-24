#!/usr/bin/env python3
"""Genere serveur/circuits.js : traces simplifies des circuits de F1.

Source : https://github.com/bacinger/f1-circuits (licence MIT, (c) Tomislav Bacinger).
Usage : git clone --depth 1 https://github.com/bacinger/f1-circuits /tmp/f1c
        python3 outils/circuits.py /tmp/f1c
"""
import json, math, sys, os

src = sys.argv[1]
ici = os.path.dirname(os.path.abspath(__file__))
sortie = os.path.join(ici, '..', 'serveur', 'circuits.js')

# Circuits des saisons recentes seulement (le fichier reste petit)
ids = set()
for an in range(2024, 2031):
    f = os.path.join(src, 'championships', f'f1-locations-{an}.json')
    if os.path.exists(f):
        ids |= {c['id'] for c in json.load(open(f))}

def rdp(pts, eps):
    """Simplification de Ramer-Douglas-Peucker."""
    if len(pts) < 3: return pts
    (x0, y0), (x1, y1) = pts[0], pts[-1]
    dx, dy = x1 - x0, y1 - y0
    l = math.hypot(dx, dy) or 1e-9
    dmax, imax = 0, 0
    for i in range(1, len(pts) - 1):
        x, y = pts[i]
        d = abs(dy * x - dx * y + x1 * y0 - y1 * x0) / l if math.hypot(dx, dy) > 1e-9 else math.hypot(x - x0, y - y0)
        if d > dmax: dmax, imax = d, i
    if dmax <= eps: return [pts[0], pts[-1]]
    return rdp(pts[:imax + 1], eps)[:-1] + rdp(pts[imax:], eps)

geo = json.load(open(os.path.join(src, 'f1-circuits.geojson')))
res = {}
for f in geo['features']:
    p = f['properties']
    if p['id'] not in ids: continue
    c = f['geometry']['coordinates']
    lat0 = sum(q[1] for q in c) / len(c)
    lon0 = sum(q[0] for q in c) / len(c)
    k = math.cos(math.radians(lat0))
    pts = [((q[0] - lon0) * k, -(q[1] - lat0)) for q in c]     # y vers le bas (ecran)
    xs = [q[0] for q in pts]; ys = [q[1] for q in pts]
    ext = max(max(xs) - min(xs), max(ys) - min(ys))
    simple = rdp(pts, ext * 0.0025)
    # Coordonnees entieres 0..999 en gardant les proportions
    mx, my = min(xs), min(ys)
    pl = [(round((x - mx) / ext * 999), round((y - my) / ext * 999)) for x, y in simple]
    res[p['id']] = {
        'nom': p['Name'], 'lieu': p['Location'], 'lat': round(lat0, 3), 'lon': round(lon0, 3),
        'l': round((max(xs) - min(xs)) / ext * 999), 'h': round((max(ys) - min(ys)) / ext * 999),
        'p': [v for q in pl for v in q],
    }

with open(sortie, 'w') as o:
    o.write('// Traces des circuits de F1, simplifies (genere par outils/circuits.py, ne pas modifier a la main).\n')
    o.write('// Source : github.com/bacinger/f1-circuits - licence MIT, (c) 2019-2025 Tomislav Bacinger.\n')
    o.write('// p = suite de points x,y (0..999, y vers le bas), dans le sens de la course, depuis la ligne de depart.\n')
    o.write('export default ' + json.dumps(res, ensure_ascii=False, separators=(',', ':')).replace('},"', '},\n"') + ';\n')
print(len(res), 'circuits,', os.path.getsize(sortie), 'octets')
for k, v in res.items(): print(k, len(v['p']) // 2, end='  ')
print()
