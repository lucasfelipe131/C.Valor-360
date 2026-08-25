# Auditoria UX + Inteligência — VAL Copiloto v1

Data: 24/08/2026
Escopo: branch de staging, sem produção
Base escolhida: `feature/prepare-visit-quality@e3580b789445f7800dafd3ea307b96394a4b94cc`

## Base e rastreabilidade

| Marco | HEAD remoto auditado |
|---|---|
| `main` | `f405617405fb66811207fdf006c2fbdaebfb8c9d` |
| Fase 02 | `498ebf3` |
| Fase 03 | `172ca812` |
| Fase 04 | `b4eaeebe` |
| Fase 05 | `ea82fdaa` |
| Fase 06 | `7c0a8e7f6edbf581b893dc17eae43528e464b6f0` |
| Integração | `b5967758428dc501d97407bb50d2cdb200c4ade7` |
| Voice Capture | `8a6cf894f4ae67610eecbf9835f5ed42369bec40` |
| Prepare Visit simples | `6fc962f8f37c62d045b4727bc5f29a6f3bafee15` |
| Qualidade Prepare Visit | `e3580b789445f7800dafd3ea307b96394a4b94cc` |

A ancestralidade foi confirmada em toda a cadeia. A base escolhida contém integralmente as Fases 02–06, Voice Capture, a UX simples e a correção de qualidade Costa Beber. A branch desta evolução é `feature/val-copilot-knowledge-v1`; ela não parte da `main`.

## Diagnóstico das quatro jornadas

| Tela | Objetivo atual | Problema | Informação útil | Informação excessiva | Duplicidade | Fricção | Melhoria proposta |
|---|---|---|---|---|---|---|---|
| Home / Dashboard | Resumir carteira e abrir módulos | Parece BI e painel de motores, não copiloto | Próxima visita, prioridades, compromissos | KPIs, gráficos, funil, sete barreiras, estados de engine | Dashboard e Ambientes VAL funcionam como duas homes | Usuário escolhe módulo, ação, profundidade e etapa antes de falar | Uma Home VAL com até 3 prioridades, produtor e uma entrada natural de voz; análises em drill-down |
| Preparar Visita | Produzir roteiro e plano | Boa apresentação, mas aninhada na agenda e dependente de contexto correto | Objetivo, timing, até 3 perguntas, estratégia, compromisso, voz | Profundidade analítica quando aberta por padrão | Formulário da agenda e preparação coexistem | Sem visita agendada, a jornada não conduz o usuário | Reutilizar `PrepareVisitSimple`, manter a primeira camada fixa e tornar o pré-requisito explícito e guiado |
| Cliente 360 | Consolidar cadastro, negócio e contexto técnico | Parece dossiê/cadastro; não comprova o que mudou após uma memória de voz | Perfil, histórico, oportunidade, agronomia e voz | Todos os indicadores, gráficos, preferências e formulários expandidos | Clientes e Produtor 360 parecem destinos concorrentes | É difícil localizar última interação, compromisso e próximo passo | Resumo de memória viva primeiro; histórico, comercial, agronomia, evidências e cadastro em camadas |
| Pós-visita | Registrar relatório e confirmar fatos | Voice Capture correto disputa atenção com ações da agenda; existe fluxo legado inacessível | Transcrição, revisão humana, candidatos, Commitment, Outcome e próxima preparação | Formulário legado e controles secundários | Dois fluxos de registro no mesmo arquivo | O consultor não encontra imediatamente “Me conte como foi” | Uma jornada focada em voz, mantendo o lifecycle já validado e detalhes sob demanda |

## Auditoria de inteligência

O pipeline de qualidade Costa Beber já corrigiu perdas entre Voice Capture, MMI, MCTX, MIC, MDI, MVV, MEX e Prepare Visit. A nova auditoria identificou um risco adicional antes de integrar a Biblioteca:

- `validated_knowledge` no `ContextSnapshot v1` representa memória governada do produtor; não é lugar para conhecimento externo global;
- conhecimento geral misturado a fatos pode elevar confiança, esconder lacunas ou parecer contexto específico;
- o sincronizador legado envia arquivos integrais a um vector store sem lifecycle, geografia, risco ou seleção por item;
- a interface Home ainda mostra nomenclatura interna e exige decisões metodológicas do usuário;
- o Cliente 360 atualiza a engine após voz, mas sua primeira camada não demonstra a memória incorporada;
- o pós-visita funcional é o Voice Capture; o formulário legado permanece no código, mas não é aberto por nenhum estado.

## Manual do Agrônomo

A versão auditada é `manual-do-agronomo@0.2.0` (Next.js 16.3). Ela contém diagnóstico visual em quatro trilhas, planejamento/ZARC, análises de solo, cálculos, registros de campo, relatórios, geodados oficiais e sincronização administrativa. O webhook publica eventos JSON estruturados, remove credenciais/documentos/binários, assina o corpo com HMAC SHA-256 e limita a sincronização ao tenant/workspace autenticado.

O repositório do Manual não possui, nesta versão, um catálogo normativo de conteúdo `novo/atualizado/superseded`. Por isso, nenhum registro operacional foi promovido artificialmente a `KnowledgeItem`. A governança efetiva permanece: evento assinado -> validação de schema e limites físicos -> contexto técnico/observação -> safety/MIA -> revisão humana. A Biblioteca v1 é a fonte versionada para conhecimento curado; o Manual é fonte de sinais e evidências do produtor. O smoke vertical `node manual/integration-smoke.mjs`, a ingestão HMAC e o build do Manual comprovam essa fronteira sem transformar o Manual em segunda VAL.

## Biblioteca recebida

- 100 KnowledgeItems (`KI-001` a `KI-100`);
- 30 fontes (`SRC-001` a `SRC-030`), todas referenciadas;
- 30 cenários (`SCN-001` a `SCN-030`);
- nenhum ID duplicado ou referência inexistente;
- 14 itens de risco `HIGH`, todos exigindo revisão humana;
- status de origem `APPROVED_EXTERNAL`, que não equivale silenciosamente a `ACTIVE`;
- campos de governança ausentes permanecerão `null`, sem fabricação;
- `KI-012` contém uma referência duplicada a `SRC-010`, normalizada sem perder o registro bruto;
- evidências internacionais mantêm escopo e caveat local.

## Estado externo anterior à mudança

Na reprodução de 24/08/2026, a URL de staging respondeu `502 — Application failed to respond` (request id `_shF2Y2XRaG81hau9o6EoQ`). O container voltou a responder antes da publicação desta branch e a landing pública foi reaberta. A ocorrência permanece registrada como baseline operacional; a evidência do deploy desta entrega será adicionada ao gate final, sem reescrever esse histórico.

## Decisão arquitetural

1. Preservar contratos, migrations e engines existentes.
2. Instalar catálogo estruturado local, sem recurso pago e sem PDF no prompt.
3. Recuperar no máximo três itens capazes de mudar a decisão.
4. Manter conhecimento externo fora da MMI e dos fatos do produtor.
5. Usar itens `HIGH` somente como guardrail/revisão, nunca prescrição.
6. Apresentar uma única VAL; motores, scores e provenance ficam em auditoria/drill-down.
7. Medir `KNOWLEDGE_USAGE` sem enfraquecer as oito dimensões existentes de Prepare Visit.

## Causa técnica evitada na integração Knowledge

A revisão adversarial detectou e corrigiu antes do deploy: risco desconhecido permissivo; lifecycle sem relógio; objetivo atual contaminado por cultura/categoria histórica; caveats e provenance perdidos no adapter; knowledge confundido com evidência factual; injeção PT-BR incompleta; compatibilidade `file_search` removida; e uso declarado sem efeito causal. Os testes finais exigem risco fail-closed, source set canônico completo, prioridade da consulta atual e `used_in` somente quando tese, prova, estratégia, pergunta ou guardrail mudam materialmente.
