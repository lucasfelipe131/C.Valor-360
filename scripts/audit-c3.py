from pathlib import Path
import re

roots=[Path('src'),Path('server'),Path('docs'),Path('README.md')]
extensions={'.js','.jsx','.mjs','.ts','.tsx','.md'}
files=[]
for root in roots:
    if root.is_file(): files.append(root)
    elif root.exists(): files.extend(path for path in root.rglob('*') if path.is_file() and path.suffix in extensions)

patterns={
 'produtor':re.compile(r'\bprodutor(?:es|a|as)?\b',re.I),
 'cliente':re.compile(r'\bcliente(?:s)?\b',re.I),
 'conta':re.compile(r'\bconta(?:s)?\b',re.I),
 'SPIN':re.compile(r'\bspin\b',re.I),
 'EPA':re.compile(r'\bepa\b',re.I),
 'OPC':re.compile(r'\bopc\b',re.I),
 'Senoide':re.compile(r'\b(?:senoide|senóide)\b',re.I),
}

out=['# Inventário bruto de terminologia','']
for name,pattern in patterns.items():
    matches=[]
    forms={}
    for path in sorted(files):
        for line_no,line in enumerate(path.read_text(errors='ignore').splitlines(),1):
            found=list(pattern.finditer(line))
            if not found: continue
            for match in found: forms[match.group(0)]=forms.get(match.group(0),0)+1
            snippet=line.strip()
            if len(snippet)>260: snippet=snippet[:257]+'...'
            matches.append((str(path),line_no,snippet))
    out.extend([f'## {name}',f'Formas: {forms}',f'Total: {sum(forms.values())}',''])
    for path,line_no,snippet in matches[:160]: out.append(f'- `{path}:{line_no}` — {snippet}')
    if len(matches)>160: out.append(f'- … {len(matches)-160} linhas adicionais')
    out.append('')

Path('tmp').mkdir(exist_ok=True)
Path('tmp/c3-terms.md').write_text('\n'.join(out))
print('inventário gerado')
