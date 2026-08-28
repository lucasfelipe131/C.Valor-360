# Prepare Visit Quality Model v1

Versão: `val.prepare_visit.quality.v1`

## Finalidade

Garantir que a preparação apresentada ao consultor seja específica, útil e rastreável sem transformar hipótese em fato, perfil em estereótipo ou observação agronômica em prescrição.

O modelo é um gate interno. O score e seus metadados não são exibidos ao consultor.

## Pipeline

`VoiceInteraction → MMI → MCTX → MIC → MDI → MVV → MEX → PrepareVisit → Quality Gate → VIS`

- MMI preserva conteúdo, estado epistêmico e proveniência.
- MCTX recupera fatos complementares sem tratá-los como conflito de atributo.
- MIC adapta forma e prova somente com confiança mínima de `0,30` e sinais observáveis.
- MDI cria uma tese e até três `decision_questions`.
- MVV converte questões de decisão em Perguntas de Ouro naturais.
- MEX transforma o compromisso-alvo em ação rastreável.
- PrepareVisit sintetiza o essencial sem copiar proveniência.

## Dimensões

Cada dimensão recebe valor entre `0` e `1`:

1. `CONTEXT_SPECIFICITY`: cultura, solução ou contexto material aparecem na síntese quando disponíveis.
2. `DECISION_RELEVANCE`: tese e perguntas podem alterar a decisão ou o próximo passo.
3. `QUESTION_QUALITY`: existem duas ou três perguntas naturais, interrogativas e aterradas.
4. `HISTORY_USAGE`: histórico existente produz prova ou contexto; ausência não é penalizada quando explicitada.
5. `BEHAVIOR_ADAPTATION`: perfil sustentado adapta abordagem; confiança baixa permanece neutra.
6. `AGRONOMIC_TIMING_USAGE`: estágio/janela material altera “Por que agora”.
7. `ACTIONABILITY`: “Evite” e “Saia com” orientam comportamento e compromisso observáveis.
8. `NON_GENERIC_LANGUAGE`: linguagem interna e frases vazias não chegam à saída.

Threshold v1: `0,78`.

## Questão de decisão

Uma questão de decisão é uma incerteza cuja resposta pode mudar materialmente:

- a tese;
- a estratégia;
- a prova necessária;
- o próximo passo.

Ela é interna ao MDI. O MVV a transforma em pergunta natural para o produtor.

## Estados comerciais

- `CONFIRMED_OBJECTION`: declaração explícita do produtor sustenta a objeção.
- `HYPOTHESIS`: preço/condição apareceu como possível fricção, sem rejeição confirmada.
- `ABSENT`: nenhum sinal material foi recuperado.

Menção a preço não autoriza desconto automático.

## Timing agronômico

O modelo reconhece estágio e janela somente para organizar a conversa. Ele não escolhe produto, dose, mistura, taxa ou manejo. Orientação acionável continua sujeita ao MIA/MGO e revisão técnica.

## Perfil comportamental

O perfil só altera apresentação quando:

- `confidence >= 0,30`;
- existe ao menos um sinal observável e rastreável.

Empate neutro não significa perfil analítico. Com baixa confiança, fatos, perguntas e tese permanecem invariáveis, e a abordagem é neutra.

## Detecção de genericidade

São bloqueados ou reparados na saída final, entre outros:

- “Confirme a fonte mestre.”
- “Resolva o conflito material.”
- “Valide o contexto.”
- “Obtenha o dado crítico.”
- “Fato confirmado pelo consultor: ...”
- “Contexto de voz revisado: ...”

Conceitos genéricos só são aceitáveis quando aterrados em qual dado, contexto, prova, necessidade ou valor.

## Reparo controlado

Se o primeiro resultado ficar abaixo do threshold:

1. reaplicar a síntese determinística usando o modelo de decisão;
2. preservar a mesma fonte, fatos e safety;
3. reavaliar as oito dimensões;
4. se ainda insuficiente, assumir explicitamente falta de informação e gerar perguntas de descoberta, sem preencher a tela com texto artificial.

O reparo nunca chama ferramenta, altera memória, inventa evidência ou promove hipótese.

