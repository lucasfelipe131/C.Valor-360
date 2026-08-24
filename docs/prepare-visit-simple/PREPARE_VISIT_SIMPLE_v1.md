# Prepare Visit Simple v1

Versão: `val.prepare_visit_simple.v1`

## Entrada

Projeção aditiva da resposta existente de preparação:

- `visit`, `client`;
- `preparation` (`PrepareVisit v1`);
- `context_snapshot_ref`;
- `behavioral_profile`;
- `decision_thesis`;
- `value_plan`;
- `action_plan`.

## Camada essencial

1. `objective`: uma frase.
2. `attention`: zero a dois fatos/alertas relevantes.
3. `questions`: no máximo três Perguntas de Ouro.
4. `strategy`: orientação curta, informada pelo perfil do produtor quando confirmado.
5. `commitment`: compromisso-alvo explícito.

Não exibe nomes de motores, IDs, JSON, scores, methodology ou provenance. Se faltar contexto, informa “Tenho pouco histórico deste produtor” e prioriza uma pergunta material; não preenche espaço com generalidades.

## Profundidade

“Ver análise” contém oportunidade principal, objeção, orientação, provas, lacunas, oportunidade secundária e até três prioridades. “Ver números e evidências” contém somente dados realmente disponíveis. Ausência de dados é declarada; valores não são inventados.

## Atalhos

- “Falar com a VAL”: reutiliza `VoiceInteraction v1 / PRE_VISIT`; somente confirmação humana recalcula a preparação.
- “Estou saindo agora”: objetivo, lembrete, três perguntas, o que evitar e compromisso.
- “Resumo em 60 segundos”: situação, oportunidade, risco, três perguntas e compromisso.

## Invariantes

A projeção não altera o artefato original. Todos os modos recebem a mesma tese, fatos, estratégia, perguntas, prioridades e safety. O limite visível é de três perguntas e três prioridades, coerente com `PrepareVisit v1` e `ActionPlan v1`.

