# Prepare Visit Golden Set v1

## Objetivo

Provar que preparações de produtores e situações diferentes não são variações do mesmo template e que toda saída respeita epistemologia, safety, tenancy e simplicidade.

## Casos

| ID | Contexto | Expectativa diferencial |
|---|---|---|
| `PREPARE_VISIT_GOLDEN_001_COSTA_BEBER` | Milho, inseticida, plantio realizado, emergência, primeira aplicação próxima e possível fricção de preço | Timing explícito; preço como hipótese; perguntas sobre critério, valor e avanço; compromisso antes da janela |
| `PREPARE_VISIT_GOLDEN_002_SOY_FUNGICIDE` | Produtor diferente, soja, fungicida, foco técnico e relato ainda não validado | Perguntas técnicas contextuais; perfil conservador sustentado; nenhuma dose/produto específico/prescrição |
| `PREPARE_VISIT_GOLDEN_003_NEW_PRODUCER` | Produtor novo sem histórico | VAL assume pouca informação; pergunta prioridade, resultado e governança; não fabrica tese detalhada |

## Invariantes

- Objetivo não contém dump de memória ou proveniência.
- No máximo três Perguntas de Ouro.
- Perguntas internas nunca aparecem.
- Objeção confirmada e sinal comercial permanecem distintos.
- Histórico só é usado quando recuperado.
- Perfil muda abordagem, não fatos, objetivo ou questões materiais.
- Timing agronômico muda a conversa, não vira prescrição.
- “Saia com” contém compromisso observável.
- Diferentes casos possuem objetivo e perguntas materialmente diferentes.
- Quality score passa `0,78` ou a saída assume insuficiência de contexto.

## Implementação de regressão

- Fixture: `test/support/prepare-visit-quality-context.js`
- Testes: `test/prepare-visit-quality.test.js`
- Total inicial: 13 testes golden.

