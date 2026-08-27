# VAL Decision Interview v1

> **Status da entrega:** contrato candidato em validação exclusiva no staging. Não autoriza produção, merge em `main` nem Passo 07.

## Finalidade

Decision Interview é o comportamento pelo qual a VAL reconhece que uma tese ainda depende de informação material, explica a lacuna e faz somente as perguntas que podem mudar a decisão.

Não é formulário, cadastro implícito nem mecanismo de persistência.

## Contrato

O runtime produz `val.decision_interview.v1` com:

- `status`: `NEEDS_INPUT` ou `NOT_NEEDED`;
- `questions`: zero a três perguntas;
- `material_missing_information`;
- `non_material_missing_information`;
- `session_context`;
- `explanation`;
- `recompute_after_reply`;
- `register_offer`.

Cada pergunta contém:

- `field`: lacuna que será preenchida;
- `classification: MATERIAL`;
- `question`;
- `why`;
- `already_known: false`.

## Materialidade

Uma lacuna é `MATERIAL` quando a resposta pode alterar pelo menos um destes elementos:

- tese ou alternativa preferida;
- risco técnico ou comercial;
- cálculo econômico;
- janela ou urgência;
- participante da decisão;
- evidência necessária;
- próximo compromisso.

Lacunas meramente descritivas ficam em `NON_MATERIAL` e não precisam interromper a conversa.

## Regra de pergunta mínima

- máximo de três perguntas por rodada;
- não perguntar dado já confirmado no contexto;
- não repetir pergunta já respondida na sessão;
- explicar por que a resposta muda a decisão;
- responder parcialmente quando já houver base suficiente;
- se não houver base, assumir insuficiência em vez de inventar.

## Estado e memória

```text
CONFIRMED_MEMORY -----> leitura autorizada
SESSION_CONTEXT ------> continuidade temporária
USER_REPLY -----------> SESSION_CONTEXT
REGISTER confirmado --> CONFIRMED_MEMORY
```

Uma resposta do consultor durante ASK entra apenas no fio da sessão. O contrato mantém `persistence_mode: NONE` e `confirmed_memory_unchanged: true`.

Para suprimir uma pergunta como “já conhecida”, a memória persistida precisa estar verificada e em estado epistemológico de fato/confirmado. Memória proposta, hipótese, inferência, visita antiga irrelevante ou texto incidental não substituem a informação material.

Quando a informação for material, a UI pode oferecer: “Quer registrar no histórico ou usar apenas nesta conversa?”. A oferta não equivale a confirmação.

## Recomputação

Após a resposta do consultor:

1. o backend recupera novamente o contexto confirmado;
2. reinsere somente os turnos da mesma conversa e do mesmo produtor;
3. recompõe premissas, confidence e tese;
4. remove perguntas que já tenham resposta;
5. mantém memória persistente inalterada.

REGISTER revisado e confirmado encerra a separação transitória para os candidatos aceitos: a solicitação seguinte recupera novamente o contexto, recompõe as premissas e deve refletir a nova memória confirmada em `confirmed_memory_refs`, `memory_refs` ou no snapshot, conforme a policy. Candidatos rejeitados ou ainda pendentes permanecem fora da memória confirmada.

## Cobertura inicial

Há perguntas determinísticas para preparação de visita, solo, agronomia, cálculo, oportunidade e objeção. Outros intents podem usar Golden Questions como fallback. Fallback não autoriza pergunta genérica nem mais de três itens.

O reconhecimento de “já conhecido” é conservador e baseado no contexto disponível. O gate deve incluir casos negativos para impedir que uma palavra incidental seja tratada como resposta confirmada.

## Exemplo

```text
Consultor: Me prepare para falar com João.
VAL: Consigo montar uma leitura inicial. Faltam duas informações que podem
mudar a abordagem: quem participa da decisão e qual é a janela real?
```

A resposta seguinte atualiza a sessão. Ela não atualiza o cadastro de João até que o consultor escolha Registrar, revise os candidatos e confirme.

## Testes obrigatórios

- `questions.length <= 3`;
- somente `MATERIAL` é perguntado;
- dado conhecido é suprimido;
- resposta de sessão muda a pergunta/tese seguinte;
- troca de produtor não carrega a sessão;
- ASK não muda memória;
- REGISTER sem confirmação não muda memória;
- REGISTER confirmado muda o snapshot seguinte;
- safety continua prevalecendo depois da recomputação.

## Limite

Decision Interview melhora a coleta decisória, mas não comprova por si só entendimento humano. Cenários reais e a métrica “Por que eu não pensei nisso?” permanecem avaliação humana separada.
