# VAL Reasoning Confidence v1

> **Status da entrega:** heurística candidata em validação exclusiva no staging. Não é aprovação para produção, `main` ou Passo 07.

## Finalidade

Confidence orienta quando responder, perguntar ou reduzir a força da tese. Não é probabilidade de venda, verdade automática nem autorização técnica.

## Dimensões

`val.reasoning_confidence.v1` contém:

- `context`: cobertura e diversidade de fatos/fontes;
- `thesis`: força da tese diante das evidências;
- `question`: qualidade/necessidade das perguntas;
- `agronomy`: cobertura técnica, ou `null` quando não aplicável;
- `knowledge`: apoio da Biblioteca/Manual;
- thresholds para perguntar ou responder.

Scores ficam entre 0 e 1.

## Interpretação

- abaixo de `ask_below`: Decision Interview deve considerar perguntas materiais;
- igual ou acima de `answer_at_or_above`: a VAL pode responder, mantendo incerteza residual;
- `null`: dimensão não aplicável, não equivalente a zero;
- safety pode bloquear mesmo com confidence alta;
- current data vencido reduz confiança na atualidade, não reescreve fatos do produtor.

## Fontes

Confidence é derivada de sinais observáveis:

- quantidade e diversidade de evidências;
- confidence do ContextSnapshot;
- memória confirmada e freshness;
- dados agronômicos vinculados;
- knowledge realmente usado;
- lacunas e contradições.

Somente `run.capabilities_used` com resultado sustentado em `run.capability_results` pode contribuir como evidência de execução. `run.capabilities_planned` descreve intenção de rota e, isoladamente, não aumenta confidence.

Library ou Manual não elevam a confiança de um fato particular do produtor. Eles apoiam princípio, pergunta, guardrail ou interpretação.

## Calibração

Uma tese forte deve dizer por que é forte e o que a faria mudar. Uma tese fraca deve assumir insuficiência, não compensar com linguagem confiante.

O score não é exibido obrigatoriamente na camada simples. Na densidade analítica, pode ser acompanhado de rationale e fontes.

## Relação com Decision Interview

Confidence baixa sozinha não autoriza questionário. A pergunta precisa ser material, não conhecida e capaz de mudar a decisão. Máximo de três por rodada.

Depois da resposta de sessão, as dimensões são recalculadas dentro do mesmo `conversation_id` e produtor. Essa resposta pode mudar a tese da conversa, mas não vira evidência confirmada. Somente REGISTER revisado e confirmado muda memória permanente; a solicitação seguinte então recupera o snapshot e recompõe as premissas.

Recência de uma cotação não equivale a verificação. Confidence de mercado combina proveniência declarada, confidence da referência e freshness, mantendo fonte e data/hora visíveis na resposta.

## Limites da implementação inicial

A heurística atual usa contagens, tipos de fonte e confidence já presente no resultado. Ela é explicável e determinística, mas precisa de calibração com cenários reais; não deve ser apresentada como modelo estatístico validado.

## Testes

- limites 0–1 e agronomy `null` quando não aplicável;
- mais evidência confiável não reduz contexto sem motivo;
- falta material aciona entrevista;
- dado conhecido suprime pergunta;
- knowledge não confirma fato do produtor;
- safety vence confidence;
- outputs específicos de produtores diferentes não colapsam no mesmo score/texto.
