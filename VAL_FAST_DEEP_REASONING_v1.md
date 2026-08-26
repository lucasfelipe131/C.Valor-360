# VAL Fast/Deep Reasoning v1

> **Status da entrega:** contrato candidato em validação exclusiva no staging. Nenhuma medição ou evidência deste documento autoriza produção, `main` ou Passo 07.

## Objetivo

Separar perguntas de leitura direta de perguntas que exigem cruzamento, hipótese ou síntese, reduzindo latência sem sacrificar qualidade ou safety.

## FAST

FAST responde a partir de uma capacidade determinística e autorizada.

Exemplos:

- última visita;
- último compromisso;
- cotação registrada com fonte/data;
- status objetivo de oportunidade;
- cálculo determinístico com entradas completas.

Contrato:

- `run.path: FAST`;
- modelo externo não é chamado;
- `run.capabilities_planned` registra o plano do router;
- `run.capabilities_used` lista somente o que foi de fato executado e contribuiu para a resposta;
- `run.capability_results` registra o resultado de cada execução, inclusive indisponibilidade ou falha;
- resposta traz fato, provenance e limitação;
- nenhuma hipótese é apresentada como fato;
- ASK permanece `persistence_mode: NONE`.

FAST não significa usar cache sem escopo, dado vencido ou resposta genérica.

Uma capacidade planejada e não executada não pode aparecer como usada. FAST sem adapter ou dado válido retorna indisponibilidade; não transforma o plano em evidência.

## DEEP

DEEP é usado quando a pergunta exige pelo menos uma destas operações:

- cruzar múltiplas coleções;
- comparar alternativas/trade-offs;
- relacionar agronomia e comercial;
- interpretar anexo;
- formular tese ou perguntas materiais;
- explicar evidências e o que mudaria a leitura.

DEEP pode usar provider de raciocínio, mas fatos, autorização, memória, current data e safety permanecem determinísticos.

## Seleção

O System Capability Router define o caminho funcional. `resolveStructuredReasoningRoute` decide se DEEP usa provider estruturado ou fallback específico.

Uma pista lexical isolada não deve forçar DEEP se a resposta é uma leitura direta. Da mesma forma, uma frase curta pode ser DEEP quando pede impacto sobre produtor, negociação ou contexto agronômico.

## Telemetria

`latency_breakdown` reserva:

- AUTH;
- CONTEXT_RETRIEVAL;
- MEMORY;
- DATABASE;
- MCA;
- MIA;
- EXTERNAL_DATA;
- MODEL_INPUT;
- MODEL_INFERENCE;
- VALIDATION;
- RESPONSE.

Valores não medidos ficam `null`; não devem ser fabricados como zero.

## Progresso

Feedback progressivo deve refletir eventos reais do backend e os resultados de execução. Mensagem fixa que sempre diz “cruzando agronomia” sem o módulo constar em `capabilities_used` e `capability_results` não é progresso válido.

Exemplos permitidos:

- “Recuperei o histórico; agora estou cruzando a oportunidade.”
- “A fonte de mercado ainda não respondeu.”

## Qualidade

FAST e DEEP obedecem aos mesmos invariantes:

- tenant/ator autorizado;
- provenance;
- memória governada;
- current data com fonte/data;
- technical safety;
- linguagem específica;
- confiança calibrada.

FAST pode não ter Golden Questions quando a leitura direta responde integralmente. DEEP deve acionar Decision Interview quando uma lacuna material impede boa tese.

Em consulta de mercado, fonte e data/hora precisam estar no corpo da resposta e no `voice_output.speakable_text`, além da proveniência estruturada. Uma referência apenas planejada ou presente em metadata não satisfaz esse contrato.

## Medição honesta

O contrato reduz chamadas e trabalho, mas não prova latência por si só. O gate exige:

- provider spy com zero chamadas em FAST;
- cinco ou mais amostras pareadas no mesmo staging;
- p50 e p95 separados por caminho;
- comparação com a mesma classe de autenticação/rede;
- duração total do backend;
- registro de fallback e cold start.

Não há meta absoluta inventada nesta versão. O gate só marca “FAST reduz latência” quando a medição mostrar melhora material e repetível.

## Fallback

- FAST sem dado: resposta curta `UNAVAILABLE` ou “não encontrei registro”, sem escalar automaticamente a um modelo para inventar.
- DEEP sem provider: fallback determinístico, com `fallback=true` e confidence reduzida.
- timeout: preservar resultado parcial seguro somente se sua fonte estiver identificada.

## Testes

- última visita usa FAST e não chama modelo;
- cotação direta usa FAST;
- impacto de cotação na conta usa DEEP;
- solo/imagem usam DEEP;
- safety permanece nos dois caminhos;
- telemetry identifica path/capabilities;
- comparação de qualidade e latência é registrada no gate.
