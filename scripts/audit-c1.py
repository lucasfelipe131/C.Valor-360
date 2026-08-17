from pathlib import Path
import re

root=Path('.')
out=[]

def section(title):
    out.append('\n'+'='*18+' '+title+' '+'='*18+'\n')

sales=Path('server/sales-playbook.js').read_text()
section('BUILD VAL INSTRUCTIONS')
start=sales.find('export function buildValInstructions()')
if start<0: raise SystemExit('buildValInstructions não encontrado')
next_export=sales.find('\nexport ',start+10)
block=sales[start:next_export if next_export>0 else None]
out.append(block)

section('STAGE QUESTIONS')
for needle in ['function stageQuestions','const stageQuestions','export function stageQuestions']:
    pos=sales.find(needle)
    if pos>=0: break
if pos<0:
    out.append('stageQuestions não encontrado pelo nome literal.\n')
else:
    end=sales.find('\nfunction ',pos+20)
    if end<0: end=sales.find('\nexport ',pos+20)
    out.append(sales[pos:end if end>0 else None])

section('VISIBLE STRING LITERALS')
paths=[]
for folder in ['src/components','src/pages']:
    base=Path(folder)
    if base.exists(): paths.extend(sorted([p for p in base.rglob('*') if p.suffix in {'.js','.jsx','.ts','.tsx'}]))

quoted=re.compile(r"(?P<q>['\"`])(?P<s>(?:\\.|(?!\1).)*?)(?P=q)")
skip_patterns=[
    re.compile(r'^[a-zA-Z0-9_./:@#?=&%{}$+*|\\-]+$'),
    re.compile(r'^(GET|POST|PATCH|DELETE|PUT)$'),
    re.compile(r'^[a-z0-9_-]+(?:\s+[a-z0-9_-]+)*$'),
]
for path in paths:
    text=path.read_text()
    for line_no,line in enumerate(text.splitlines(),1):
        for match in quoted.finditer(line):
            value=match.group('s').replace('\\n',' ').strip()
            if len(value)<4 or value.startswith('/') or value.startswith('http') or 'className' in line[:match.start()+1]:
                continue
            if any(rx.fullmatch(value) for rx in skip_patterns):
                continue
            if not (re.search(r'[À-ÿ]',value) or ' ' in value or re.search(r'[.!?…]',value)):
                continue
            out.append(f'{path}:{line_no}: {value}')

section('DOCS')
for path in [Path('README.md'),Path('docs/VAL_ENGINE.md')]:
    out.append(f'\n--- {path} ---\n')
    out.append(path.read_text())

Path('tmp').mkdir(exist_ok=True)
Path('tmp/c1-copy-audit.txt').write_text('\n'.join(out))
print(f'{len(out)} blocos/linhas gravados')
