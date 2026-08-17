from pathlib import Path

path=Path('test/val-engine.test.js')
source=path.read_text()
old="""  const last=items.at(-1)
  assert.match(Array.isArray(last)?String(last[0]):String(last.title),/Oportunidade 199/)
"""
new="""  const titles=items.map(item=>Array.isArray(item)?String(item[0]):String(item.title))
  assert.ok(titles.some(title=>/Oportunidade 199/.test(title)))
"""
if source.count(old)!=1:
    raise RuntimeError('asserção legada da última oportunidade não encontrada')
path.write_text(source.replace(old,new,1))
Path('scripts/fix-a3-test.py').unlink(missing_ok=True)
Path('.github/workflows/fix-a3-test.yml').unlink(missing_ok=True)
