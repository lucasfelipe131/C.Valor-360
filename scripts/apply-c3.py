from pathlib import Path

report='''# Auditoria de terminologia do VALOR 360

Esta auditoria registra como os termos aparecem hoje e evita renomeações silenciosas. Ela não altera campos de banco, rotas, nomes de schema, chaves internas nem textos do produto nesta PR.

## Princípio

Os termos não são sinônimos perfeitos:

- **produtor** é a pessoa ou operação rural com quem o consultor conversa e para quem a decisão precisa fazer sentido;
- **Cliente 360** é o nome próprio do módulo que reúne o dossiê;
- **clientes** é o nome atual da lista principal do CRM;
- **conta comercial** é a relação de negócio, com potencial, pipeline, oportunidades e histórico;
- **conta de acesso** é o login do usuário;
- `client` é um nome técnico legado do contrato e do banco, não uma decisão de copy.

A regra para novas telas é qualificar o termo quando houver risco de ambiguidade. Use “produtor” para a conversa de campo, “Cliente 360” para o módulo, “conta comercial” para estratégia de carteira e “conta de acesso” para autenticação. Não renomear silenciosamente dados ou módulos existentes.

## Inventário observado

A varredura do repositório na data desta auditoria encontrou, incluindo documentação, código e textos visíveis:

| Termo | Ocorrências aproximadas | Leitura |
|---|---:|---|
| produtor | 292 | É o termo dominante na conversa de campo, na SOG e nas orientações da VAL. |
| cliente | 60 | Aparece principalmente em “Clientes”, “Cliente 360”, contratos técnicos e mensagens de banco. |
| conta | 45 | Representa tanto conta comercial quanto conta de acesso; sem qualificador, pode ficar ambíguo. |
| SPIN | 27 | A forma visível usa maiúsculas; ocorrências em minúsculas são chaves, variáveis ou classes. |
| EPA | 15 | A forma visível usa maiúsculas; ocorrências em minúsculas são internas. |
| OPC | 15 | A forma visível usa maiúsculas; ocorrências em minúsculas são internas. |
| Senoide | 3 | A grafia é consistente, mas o método existe apenas nas instruções da engine e não aparece no painel de métodos. |

As contagens são um retrato técnico, não um teste de produto. Elas podem variar conforme novas funcionalidades sejam adicionadas.

## Inconsistências sinalizadas

### 1. “Produtor”, “cliente” e “conta” coexistem sem uma regra escrita

O uso atual é, em grande parte, compreensível, mas a regra estava implícita. Há telas que dizem “Cliente 360”, botões que dizem “Priorizar a conta” e respostas que falam diretamente com o “produtor”. Isso só é consistente quando cada termo representa uma camada diferente.

**Decisão registrada para novas mudanças:**

- conversa, visita, pergunta e resposta da VAL: **produtor**;
- nome do módulo: **Cliente 360**;
- lista do CRM: manter **Clientes** até uma decisão explícita de produto;
- score, potencial e pipeline: **conta comercial** quando o contexto não estiver óbvio;
- login, senha e sessão: **conta de acesso**;
- contratos `client`, `clientId` e tabela `clients`: manter até uma migração planejada.

### 2. “Conta” também significa login

No motor comercial, “conta” significa carteira e oportunidade. Em configurações e acesso, significa credencial do usuário. Novos textos devem usar o qualificador adequado. Esta auditoria não altera as ocorrências atuais porque isso exigiria uma revisão visual de cada fluxo.

### 3. SPIN tem duas expansões próximas, mas não idênticas

O painel mostra **Situação, Problema, Implicação e Necessidade**. As instruções usam **Necessidade de solução**. As duas leituras são compatíveis, mas não são literalmente iguais.

**Pendente de decisão de produto:** escolher uma expansão oficial para material de treinamento e interface. Até essa decisão, manter SPIN em maiúsculas e não substituir uma forma pela outra silenciosamente.

### 4. EPA mantém o acrônimo, mas varia a descrição do “A”

A interface apresenta **Educar, Personalizar e Assumir a condução**. As instruções explicam “assuma o controle do processo com um próximo passo claro, sem controlar a pessoa”. A intenção é compatível, porém a formulação não é única.

**Pendente de decisão de produto:** definir a frase oficial de treinamento. Não alterar o acrônimo ou o comportamento da engine nesta auditoria.

### 5. OPC está consistente

A forma visível e as instruções usam **Objetivo, Processo e Compromisso**. O acrônimo permanece em maiúsculas para leitura humana e em minúsculas apenas nas chaves internas.

### 6. Senoide não está integrada ao painel de métodos

A engine reconhece **Senoide** e orienta que a fase registrada calibre ritmo e profundidade. Entretanto, o painel principal mostra SPIN, OPC e EPA, sem uma área equivalente para Senoide.

Isso é uma lacuna de produto, não um erro ortográfico. Exibir, remover ou redefinir Senoide exige decisão explícita sobre dados de entrada, significado das fases e efeito na recomendação.

### 7. Marca “VAL” aparece ocasionalmente como “Val”

A marca é majoritariamente escrita como **VAL**, mas existe copy legada com “Val”. A correção global não foi feita nesta PR para evitar misturar auditoria com mudança visual. Novos textos devem usar **VAL**.

## Contrato metodológico

Para textos destinados ao consultor:

| Método | Forma canônica do nome | Expansão registrada hoje |
|---|---|---|
| SPIN | `SPIN` | Situação, Problema, Implicação e Necessidade / Necessidade de solução — divergência sinalizada. |
| OPC | `OPC` | Objetivo, Processo e Compromisso. |
| EPA | `EPA` | Educar, Personalizar e Assumir a condução — formulação do terceiro elemento ainda precisa de padronização editorial. |
| Senoide | `Senoide` | Método citado pela engine; ainda sem representação visual e sem contrato de fases documentado no painel. |

Formas em minúsculas (`spin`, `opc`, `epa`) continuam válidas como chaves, variáveis, classes CSS e identificadores internos.

## Regra para futuras PRs

1. Mudança de copy pode corrigir gramática, mas não deve alterar nome de módulo, campo, enum ou método sem decisão explícita.
2. Uma renomeação de “cliente” para “produtor”, ou de “conta” para outro termo, precisa listar as telas, contratos e migrações afetados.
3. SPIN, OPC e EPA permanecem em maiúsculas quando visíveis.
4. Senoide permanece sem acento e com inicial maiúscula quando tratado como nome do método.
5. O teste `test/terminology-contract.test.js` protege os nomes atuais e a existência deste registro de inconsistências.
'''

Path('docs/TERMINOLOGY_AUDIT.md').write_text(report)

engine=Path('docs/VAL_ENGINE.md')
source=engine.read_text()
marker='## Regra de revisão textual e reconhecimento\n'
link='''## Terminologia de produto\n\nA separação entre produtor, Cliente 360, conta comercial, conta de acesso e os métodos SPIN, OPC, EPA e Senoide está registrada em [`docs/TERMINOLOGY_AUDIT.md`](TERMINOLOGY_AUDIT.md). Inconsistências são sinalizadas antes de qualquer renomeação.\n\n'''
if source.count(marker)!=1:
    raise RuntimeError('marcador da regra textual não encontrado de forma única')
engine.write_text(source.replace(marker,link+marker,1))

Path('test/terminology-contract.test.js').write_text("""import assert from 'node:assert/strict'\nimport {readFileSync} from 'node:fs'\nimport test from 'node:test'\n\nconst read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')\nconst panel=read('src/components/ValPanel.jsx')\nconst playbook=read('server/sales-playbook.js')\nconst audit=read('docs/TERMINOLOGY_AUDIT.md')\nconst engineDocs=read('docs/VAL_ENGINE.md')\n\ntest('nomes visíveis dos métodos permanecem explícitos e estáveis',()=>{\n assert.match(panel,/label:'SPIN'/)\n assert.match(panel,/label:'OPC'/)\n assert.match(panel,/label:'EPA'/)\n assert.match(playbook,/SPIN, EPA, OPC ou Senoide/)\n assert.doesNotMatch(playbook,/Senóide/)\n})\n\ntest('auditoria sinaliza divergências sem renomear silenciosamente',()=>{\n assert.match(audit,/Não renomear silenciosamente/)\n assert.match(audit,/“Produtor”, “cliente” e “conta” coexistem/)\n assert.match(audit,/SPIN tem duas expansões próximas, mas não idênticas/)\n assert.match(audit,/EPA mantém o acrônimo, mas varia a descrição/)\n assert.match(audit,/OPC está consistente/)\n assert.match(audit,/Senoide não está integrada ao painel de métodos/)\n assert.match(audit,/Pendente de decisão de produto/)\n})\n\ntest('terminologia define camadas sem migrar contratos técnicos',()=>{\n assert.match(audit,/conta comercial/)\n assert.match(audit,/conta de acesso/)\n assert.match(audit,/contratos `client`, `clientId` e tabela `clients`/)\n assert.match(engineDocs,/TERMINOLOGY_AUDIT\.md/)\n})\n""")

for path in ['scripts/audit-c3.py','.github/workflows/audit-c3.yml','tmp/c3-terms.md','scripts/apply-c3.py','.github/workflows/apply-c3.yml']:
    Path(path).unlink(missing_ok=True)
try: Path('tmp').rmdir()
except OSError: pass
print('C3 aplicado com sucesso.')
