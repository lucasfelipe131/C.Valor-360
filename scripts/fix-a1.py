from pathlib import Path

path=Path('server/sales-playbook.js')
source=path.read_text()
old='Dose, mistura, produto regulado, receita, diagnóstico causal de campo, solo ou NDVI e alegação financeira sensível exigem o preenchimento explícito de human_review e blocked_actions. Você apenas solicita a revisão; nunca declara aprovação. A aplicação controla audiência, aprovação e possibilidade de exibição.'
new='Dose, mistura, produto regulado, receita, diagnóstico causal de campo, solo ou NDVI e alegação financeira sensível exigem o preenchimento explícito de human_review e blocked_actions. Essa revisão humana não pode ser substituída pelo modelo. Você apenas solicita a revisão; nunca declara aprovação. A aplicação controla audiência, aprovação e possibilidade de exibição.'
if source.count(old)!=1:
    raise RuntimeError('trecho da barreira humana não encontrado de forma única')
path.write_text(source.replace(old,new,1))
Path('scripts/fix-a1.py').unlink(missing_ok=True)
Path('.github/workflows/fix-a1.yml').unlink(missing_ok=True)
