# Inteligência agronômica nativa v1

## Definição

Agronomia é uma capacidade transversal da VAL. O usuário não precisa abrir outro cérebro para que estágio, janela, observação de campo, análise vencida ou risco técnico influenciem a conversa.

## Fontes autorizadas

- contexto técnico confirmado do produtor;
- eventos assinados do Manual do Agrônomo;
- análises, laudos, NDVI e observações com fonte/data;
- KnowledgeItems técnicos com autoridade, risco e geografia;
- revisão humana do responsável técnico.

Eventos do Manual continuam passando por HMAC e aprovação. Eles não são transformados automaticamente em KnowledgeItem nem em prescrição.

## Auditoria do Manual disponível

Versão auditada: `manual-do-agronomo@0.2.0`.

| Dimensão | Resultado |
|---|---|
| Conteúdo disponível | diagnóstico visual Nutri/Fito/Inseto/Daninha, solo, ZARC, planejamento, cálculos, registros, relatórios e geodados |
| Integração | JSON estruturado, HMAC SHA-256, idempotência, tenant/workspace e allowlist de conteúdo estratégico |
| Safety | diagnóstico por foto é triagem; NDVI não determina causa; orientação acionável exige validação humana |
| Atualizações/supersessão | o Manual não publica registro normativo de lifecycle de conteúdo nesta versão; portanto nada foi inventado ou promovido |
| Papel na VAL | fonte governada de eventos/evidências do produtor; Biblioteca v1 permanece catálogo de conhecimento curado |

O build, os testes de ingestão e `manual/integration-smoke.mjs` validam a fronteira. Transformar todo conteúdo interno do Manual em itens curados exigirá lifecycle/editor responsável e não foi falsamente declarado como concluído.

## Papel do MIA

O roteamento `agronomic_question`/`agronomic_critical` e o safety determinístico funcionam como a capacidade MIA existente dentro da experiência única. O MIA:

- identifica timing e lacunas técnicas;
- separa observação, hipótese e recomendação;
- seleciona evidência aplicável;
- sinaliza revisão humana;
- bloqueia claim técnico não sustentado.

Ele não confirma fato do produtor por conhecimento geral e não recomenda produto, dose, mistura, compatibilidade ou aplicação sem evidência e autoridade apropriadas.

## Uso nas jornadas

- Home: prioridade apenas quando há timing/risco material confirmado.
- Prepare Visit: “Por que agora”, pergunta e prova; nunca receita.
- Cliente 360: estado e evidência em drill-down.
- Pós-visita: observação candidata, revisão e oportunidade separadas de prescrição.

## Autoridade e geografia

Fonte oficial/regulatória > científica/técnica confiável > interna validada > comercial > case/simulação. Evidência internacional mantém caveat local e não é universalizada para o Brasil.

## Safety invariants

- material comercial não sustenta claim high-risk;
- knowledge `HIGH` é guardrail/review-only;
- transcrição e biblioteca são conteúdo não confiável;
- logs contêm IDs/estado, não texto técnico sensível;
- cross-tenant permanece aplicado a contexto, artefato e evidência privada.
