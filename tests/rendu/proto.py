import re
src=open('../../carte/cadre_eink/cadre_eink.ino').read()
lignes=src.split('\n')
sig=re.compile(r'^(?!static|if|for|while|return|else)([A-Za-z_][\w:<>\*\s]*?[\s\*])([A-Za-z_]\w*)\(([^;{}]*)\)\s*\{')
protos=[]; premiere=None
for i,l in enumerate(lignes):
    m=sig.match(l)
    if m and not l.startswith(' '):
        if premiere is None: premiere=i
        protos.append(m.group(1)+m.group(2)+'('+m.group(3)+');')
open('ino_arduino.cpp','w').write('\n'.join(lignes[:premiere]+protos+lignes[premiere:]))
print('prototypes inseres avant la ligne', premiere+1, ':', len(protos))
