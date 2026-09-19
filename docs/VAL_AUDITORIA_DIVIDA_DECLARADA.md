# Dívida declarada da auditoria da VAL

Achado **confirmado por medição** que foi deliberadamente deixado sem correção, com o motivo.
Não é lista de desejos nem backlog de ideias: cada item abaixo foi reproduzido, tem dano descrito e
tem uma razão escrita para não ter sido corrigido na hora.

Este arquivo existe porque a razão vivia só na mensagem de commit. Recuperar um enunciado exigia
varrer o histórico da conversa, e enunciado que só existe em transcript se perde.

## Como ler

| Campo | O que significa |
|---|---|
| **Medido** | o que a medição mostrou, com o número |
| **Por que ficou** | o motivo de não ter sido corrigido junto |
| **O que custa consertar** | o que precisa mudar antes, para o próximo a pegar |

---

## Contratos que teriam de mudar primeiro

### CUSTO-05 — botão de reenvio e reclassificação de candidato de voz
- **Medido**: as duas ações existem na intenção do produto e não têm caminho na interface.
- **Por que ficou**: as duas exigem mudar o contrato de confirmação, que é o que impede a VAL de
  persistir sem revisão humana. Mexer nele por causa de uma conveniência inverte a prioridade.
- **O que custa consertar**: decisão de produto sobre o contrato de confirmação, antes do código.

### GROUND-06 faceta C — nome próprio na gramática SAFE_NO_DATA
- **Medido**: a resposta de "não há dado" não pode citar o nome do produtor, e por isso soa genérica.
- **Por que ficou**: o contrato escrito proíbe nome próprio nessa gramática. Contrariá-lo é decisão
  de contrato, não conserto.

### MEMW-02 — supersessão de memória de voz
- **Medido**: memória nova de voz não supersede a anterior do mesmo assunto.
- **Por que ficou**: é escopo de produto (o que supersede o quê, e com que autoridade), não defeito.

### MEMW-03 — uma frase virando duas a quatro memórias em domínios diferentes
- **Medido**: confirmado pelas duas lentes. Uma frase do consultor é quebrada em várias memórias, em
  domínios distintos.
- **Por que ficou**: o conserto (separar oração por sujeito) é o de maior risco da família — separar
  errado inventa memória que o consultor não disse.

---

## Portões que erram, e afrouxá-los custa proteção real

### genericAssertion — pronome mais cópula
- **Medido**: "A cigarrinha-do-milho transmite enfezamentos. **Ela é** favorecida por plantios
  escalonados" é barrada em evidência global. É afirmação agronômica geral, não sobre produtor.
- **Por que ficou**: a mesma regra é a que segura "ele é analítico", "ela está com a proposta parada"
  e "ele tem 500 hectares" — medido em 8 de 8. Separar as duas exige semântica, não regex.
- **O que custa consertar**: distinguir predicado agronômico de atributo de produtor. Precisa de
  corpus e medição própria nas duas pernas.

### question_relevance — recusa resposta correta
- **Medido**: "Um sistêmico é absorvido pela planta... Ele exige menos cobertura" é reprovada com
  `question_relevance=FAIL`, sem nenhuma violação de escopo, para a pergunta "o que é um inseticida
  sistêmico?".
- **Por que ficou**: mecanismo diferente do que foi corrigido no KNOW-04; tem a sua própria medição
  a fazer.

### Relevância item a item da Biblioteca
- **Medido**: "o que fazer diante da resistência de plantas daninhas?" é recusada por
  `NO_DECISION_RELEVANCE` em 154 itens e `SUBJECT_NOT_COVERED` em 19 — nenhum item passa, embora o
  assunto esteja coberto.
- **Por que ficou**: é o escore por item, não o portão de vocabulário que foi corrigido no KNOW-03.

### GROUND-02 frente de servidor — portão de 50% de sobreposição
- **Medido**: com a visita selecionada e presente em `facts_used`, "quando foi a última visita
  concluída do João Pereira?" ainda devolve "Não há evidência selecionada suficiente". O bloqueio não
  é o nome nem a cauda semântica: a pergunta tem três termos próprios (última, visita, concluída) e o
  registro compartilha **um**, porque ele diz "Realizada" e a pergunta diz "concluída".
- **Por que ficou**: fechar isso exige tratar como relevante a leitura que **é** a evidência
  autorizada da faceta da pergunta — mexe no critério de relevância inteiro, e no mesmo
  `directlyAnswersQuestion` do GROUND-04 e do GROUND-06.
- **Nota**: a frente de **tela** do GROUND-02 foi corrigida: com registro selecionado e resposta
  descartada, a tela diz isso na densidade padrão e oferece abrir o que foi selecionado. O aviso fica
  só na tela — no payload de raciocínio viraria claim e derrubaria o próprio grounding.

---

## Atribuição de erro

### Violação de contrato do snapshot reportada como falha do banco
- **Medido**: erro de contrato nasce na composição do snapshot, **depois** da leitura, e o
  repositório devolve 503 "O contexto do cliente não pôde ser lido no banco configurado". A tela
  manda reenviar (o reenvio falha idêntico) e a operação vai procurar defeito no PostgreSQL.
- **Por que ficou**: eu cheguei a corrigir e recuei. O 503 para violação de escopo é decisão
  deliberada, codificada em teste (`Conflicting producer and client-subject aliases must fail
  closed`). Contrariar uma decisão já tomada e testada pede medição própria, não efeito colateral de
  outro conserto.
- **O que custa consertar**: decidir qual status a violação de contrato deve ter, e atualizar o teste
  de propósito.

---

## Escopo de funcionalidade, não defeito

### ESC-03 — a escada de conversão ignora `val_commitments`
- **Medido**: a escada não lê os compromissos registrados.
- **Por que ficou**: é mudança de escopo de funcionalidade, não correção de defeito.

### PLAN-03 — resultado apontando para o compromisso de outro consultor
- **Medido**: as duas lentes confirmaram o mecanismo — um consultor grava resultado apontando para o
  compromisso de outro, e a única barreira é a chave estrangeira por tenant. A lente de intenção
  **refutou o impacto**: nenhuma superfície expõe isso hoje.
- **Por que ficou**: mecanismo real sem caminho de usuário. Vira defeito de isolamento de verdade no
  dia em que o learning-context passar a cruzar planos — é esse o gatilho para reabrir.


---

## Minimização de dado enviado ao modelo

### CONV-01 — o piso de 8 domínios admite a visita inteira num acompanhamento por pronome
- **Medido**: com o piso ativo, `collectionMatchesContextDomain` aceita a visita pela linha
  `requested.includes('VISIT') && intrinsic.includes('VISIT')`, e `visitIdentityOnly` (que reduz a
  visita a campos de identidade) continua decidindo por `matchedValContextDomains(query)` — a função
  que o piso substituiu em todos os outros portões. Um acompanhamento por pronome num fio
  MULTI_DOMAIN recebe o payload narrado da visita.
- **Por que ficou**: a lente refutou o P0. A assimetria (perguntar *sobre a visita* entrega menos do
  que perguntar outra coisa) **já existia antes** do piso, para qualquer pergunta MULTI_DOMAIN que
  casasse domínios não-VISIT; o piso só estendeu isso à entrada que antes devolvia 503. Nenhuma
  fronteira de autorização é cruzada: é o registro do próprio consultor sobre o próprio produtor do
  fio, e o mesmo conteúdo chega ao consultor por uma pergunta direta.
- **O que custa consertar**: alinhar `visitIdentityOnly` a `expandedValContextDomains`, ou estreitar o
  piso. É higiene de minimização, não vazamento.

---

## Como esta lista é mantida

Cada item nasce de uma medição e morre com outra. Um item sai daqui quando é corrigido — com o
commit que o fecha — ou quando uma lente o refuta, e nesse caso a refutação também fica registrada.
Item que só foi discutido, nunca medido, não entra.
