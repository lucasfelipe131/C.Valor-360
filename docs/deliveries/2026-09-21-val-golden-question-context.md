# VAL — respostas às perguntas de ouro no contexto

Continuação do PR #108, preservando a conversa por voz e a ajuda de navegação.
A branch isolada incorpora a base atual do PR #107,
`8ce398289e3d200a778f983b9945ebb9bf890df7`, sem alterar essa branch.

## Causa e correção

O browser enviava as respostas da entrevista no texto da solicitação. A
composição, porém, validava a resposta somente contra o snapshot de registros
selecionados. A informação recém-fornecida não era evidência admissível; uma
leitura que a utilizasse podia ser descartada como sem suporte. O contexto
compactado para o modelo também omitiria esses relatos nos turnos seguintes.

As respostas explicitamente delimitadas pela entrevista e os relatos diretos
do consultor agora entram como `consultant_input`, `OBSERVATION`,
`SESSION_ONLY`. O contexto do modelo e a validação usam as mesmas observações,
separadas dos fatos confirmados. Perguntas, hipóteses, comandos, respostas da
própria IA e recomendações históricas não são promovidos por esse caminho.

A continuidade recupera somente turnos do usuário previamente escopados pelo
servidor: mesmo tenant, owner, produtor, conversa, época e domínio. Metadados
de evidência enviados em `sessionContext.replies` não são aceitos como prova.
Troca de produtor, nova conversa ou mudança de domínio preservam as barreiras
existentes. Nenhuma memória, oportunidade, interação ou visita é criada por
essa correção.

Quando a redação do modelo não passa na validação, a leitura pode recuperar o
relato atribuído ao consultor e uma próxima pergunta, novamente validados.
Nesse caso a interface informa que usou a resposta da conversa, em vez de
afirmar que a descartou. Campos respondidos da entrevista deixam de ser
perguntados novamente.

O acompanhamento “como seguimos...” usa a intenção de próximo passo; CPR de
grãos com insumos não é reclassificada como uma pergunta apenas agronômica
pela presença de soja/milho e fertilizantes.

## Validação

- **2.169 testes aprovados**, zero falhas, skips, todos ou cancelamentos.
- Build Vite e verificação PWA aprovados.
- HTTP real, com dados sintéticos e sem provider externo: pergunta de ouro,
  resposta pelo envelope do browser, relato digitado diretamente, leitura com
  volume/prazo/FOB e soja ainda em negociação, acompanhamento, nova conversa,
  tentativa de troca de produtor e ausência de gravações confirmadas.
- Validação de rejeição de fatos de outro tenant, owner, produtor, conversa,
  época ou domínio; rejeição de texto da IA e de recomendações históricas como
  relatos do usuário.

O exemplo automatizado usa produtor fictício e 12 mil sacas, sem dados privados
da captura. Não houve teste pago de geração nem homologação no staging.

## Publicação

PR #108 permanece DRAFT. Sem merge, deploy, redeploy ou alteração de source,
configuração, usuários ou banco do staging. A pausa de publicação e os gates
de incidente/recuperação do ambiente compartilhado continuam em vigor.
