from pathlib import Path

path=Path('docs/VAL_ENGINE.md')
source=path.read_text()
marker='## Estratégia de modelos\n'
section='''## Regra de revisão textual e reconhecimento

Regex de reconhecimento não é texto de interface. Classes como `defici[eê]ncia` e `aduba[cç][aã]o` existem para aceitar variações de acento e não devem ser “corrigidas” durante uma revisão ortográfica.

Do mesmo modo, `normalize()` e `lower()` removem acentos de propósito em pontos de comparação e roteamento. Alterações nesses trechos são mudanças de comportamento, não de copy, e exigem um teste específico.

A revisão linguística deve tocar apenas strings destinadas à leitura humana. O teste `test/accent-pattern-contract.test.js` bloqueia a remoção acidental dessas variações.

'''
if source.count(marker)!=1:
    raise RuntimeError('marcador de estratégia de modelos não encontrado de forma única')
path.write_text(source.replace(marker,section+marker,1))

Path('scripts/apply-c2.py').unlink(missing_ok=True)
Path('.github/workflows/apply-c2.yml').unlink(missing_ok=True)
print('C2 aplicado com sucesso.')
