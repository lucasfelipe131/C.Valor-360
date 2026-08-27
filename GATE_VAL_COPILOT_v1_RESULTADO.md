# GATE VAL COPILOT v1 REPROVADO

Data: 25/08/2026
Escopo: branch e staging isolado; sem merge e sem produção.

## Decisão

A implementação técnica, a suíte, os builds, o CI e o staging foram aprovados. O gate integral permanece **REPROVADO** porque os critérios obrigatórios de aceitação física e humana ainda não foram concluídos: o iOS físico falhou e não foi retestado, o Android físico não foi executado e a jornada autenticada completa ainda não foi fechada pela interface implantada.

Automação não substitui essas provas. Nenhuma limitação foi ocultada para elevar a classificação.

## Rastreabilidade

| Item | Evidência |
|---|---|
| base aprovada | `feature/prepare-visit-quality@e3580b789445f7800dafd3ea307b96394a4b94cc` |
| branch | `feature/val-copilot-knowledge-v1`, criada da cadeia 02–06/integration/voice/simple/quality |
| commit local | `23896e2885d923cb0e9c40fb6e6a1fc7ca4192e1` |
| commit remoto | `91430010212a3cf3dc5aac6c1d70983b64df26bd` |
| árvore exata | `07f85a31d262499d08825350401d6281f30fa215` local e remota |
| PR | `#88`, DRAFT contra `feature/prepare-visit-quality` |
| CI | `Validate #185`, `success` |
| staging | `VAL - STAGING INTEGRATION 01`, serviço `val-web-staging` |
| deploy válido | `bd35a9ab-5ab2-4772-a9bc-8543d4339b9a`, `SUCCESS`, commit `9143001` |
| banco | PostgreSQL isolado; cinco migrations `already-applied`; nenhuma nova |
| health | `/health` = `200`; `/ready` = `200`; landing = `200` |
| produção | não acessada nem alterada; `main` permanece `f405617405fb66811207fdf006c2fbdaebfb8c9d` |

O ambiente da Railway se chama internamente `production`, mas pertence ao projeto exclusivamente isolado de staging acima; ele não é a produção real da VAL.

## Alterações entregues

- uma Home VAL orientada a até três prioridades reais e entrada natural por voz;
- resposta curta após confirmação de voz, usando o pipeline canônico em vez de um cérebro paralelo;
- Cliente 360 reorganizado como memória viva, com mudança, oportunidade, última visita comprovada e compromisso antes do cadastro;
- pós-visita com “Me conte como foi” como ação principal e fluxo legado inacessível;
- navegação simplificada, agronomia nativa e profundidade anterior em drill-down;
- Knowledge v1 governado, com contratos versionados, seleção determinística e provenance;
- integração causal do conhecimento com DecisionThesis, ValuePlan e PrepareVisit;
- integração do Manual como fonte de eventos/observações para MIA, nunca como segunda VAL;
- documentação, golden set e matrizes de UX/inteligência.

## Arquitetura

O fluxo preserva a mesma engine:

`entrada natural -> policy/tenant -> MMI/MCTX -> MIC/MDI/MVV/MEX/MIA -> composição -> UX simples`

Knowledge externo permanece separado dos fatos do produtor. Até três itens podem influenciar tese, prova, estratégia, pergunta ou guardrail; `used_in` só é registrado quando existe efeito causal. Item `HIGH` ou risco desconhecido falha fechado para revisão/guardrail e nunca vira prescrição, fato ou confiança automática.

Voice Capture continua transversal: conteúdo não confirmado não altera memória; áudio e transcript são dados não confiáveis; LearningCandidate não vira KnowledgeItem automaticamente.

## UX antes e depois

| Jornada | Antes | Depois |
|---|---|---|
| Home | dashboard de KPIs, motores e múltiplos caminhos | até três prioridades, produtor, voz e ação direta |
| Prepare Visit | inteligência correta, mas aninhada e densa | camada essencial preservada, até três perguntas e drill-down |
| Cliente 360 | dossiê/cadastro primeiro | memória, mudança e próximo passo primeiro |
| Pós-visita | voz competindo com controles e legado | captura por voz como ação principal; revisão humana preservada |
| Navegação | destinos concorrentes para VAL/Manual/Produtor 360 | uma VAL; ferramentas e profundidade como apoio |

## Inteligência antes e depois

| Antes | Depois |
|---|---|
| conhecimento externo podia ser confundido com memória/evidência | KnowledgeItem, Source e Selection possuem contratos e provenance próprios |
| retrieval de arquivo integral sem lifecycle, risco ou geografia por item | catálogo estruturado com lifecycle, autoridade, risco, vigência e geografia |
| risco de declarar conhecimento “usado” sem alterar a decisão | `used_in` exige mudança causal verificável |
| objetivo atual podia herdar categoria histórica conflitante | consulta e objetivo atuais dominam histórico incompatível |
| caveats podiam se perder no adapter | fonte, versão, geografia, freshness e reason codes chegam à composição |
| Home confirmava voz sem responder no mesmo fluxo | confirmação canônica aciona `/api/val/chat`, resposta curta e atualização de prioridades |

## Biblioteca e MIA

- 100 KnowledgeItems (`KI-001` a `KI-100`);
- 30 fontes canônicas e 30 cenários;
- nenhuma referência inexistente ou ID duplicado;
- 14 itens `HIGH`, todos com revisão humana obrigatória;
- risco desconhecido, lifecycle ausente ou incompatibilidade geográfica: fail-closed/caveat explícito;
- prompt injection em português e inglês tratado como conteúdo não confiável;
- MIA utiliza timing e observações para mudar a conversa sem sugerir produto, dose, mistura ou manejo sem evidência e revisão;
- Manual `0.2.0`: eventos HMAC, tenant, sanitização e smoke vertical aprovados; registros operacionais não são promovidos artificialmente a knowledge.

## Evidência de testes

- suíte completa: **654/654**;
- fluxo Home/Voice focado: **22/22**;
- Voice Capture: **96/96** na rodada específica desta árvore;
- regressões explícitas Fases 02–06: **164/164**;
- safety/tenancy focados: **26/26**;
- smokes Fases 02, 05 e 06: aprovados;
- build Vite/PWA: aprovado; cache `valor360-v23896e2885d923cb` verificado;
- build Manual: aprovado;
- smoke Manual -> VAL: aprovado, com HMAC e sanitização;
- CI remoto `Validate #185`: `success`;
- staging: build, pre-deploy, migrations, healthcheck e deploy aprovados;
- logs do deployment: zero erro severo e zero marcador de payload sensível na inspeção executada.

O warning de chunk Vite acima de 500 kB é não bloqueante, mas permanece risco de performance a medir em dispositivo real.

## Critérios do gate

| # | Critério | Estado | Evidência ou gap |
|---:|---|---|---|
| 1 | Home está mais simples | **PENDENTE UAT** | estrutura, automação e deploy aprovados; leitura autenticada por usuário ainda pendente |
| 2 | PrepareVisit está mais inteligente | **PASS** | golden Costa Beber, contrastes, knowledge e quality aprovados |
| 3 | Perguntas de Ouro são específicas | **PASS** | 2–3 perguntas, sem linguagem interna e com contraste material |
| 4 | Cliente 360 virou memória viva | **PENDENTE UAT** | view model/refetch/tenant aprovados; jornada autenticada final pendente |
| 5 | pós-visita alimenta aprendizado | **PENDENTE UAT** | Commitment/Outcome/Learning aprovados em serviço/PG; fluxo completo pela UI pendente |
| 6 | Voice Capture está integrado | **REPROVADO NA ACEITAÇÃO** | gate Voice permanece reprovado; iOS sem reteste e Android ausente |
| 7 | Biblioteca está governada | **PASS** | contratos, integridade, lifecycle, risco, fonte e seleção aprovados |
| 8 | MIA está nativo na VAL | **PASS TÉCNICO** | composição e safety agronômico aprovados |
| 9 | Manual alimenta MIA | **PASS TÉCNICO** | evento HMAC/sanitizado, ingestão e smoke vertical aprovados |
| 10 | usuário não precisa entender motores | **PENDENTE UAT** | motores removidos da primeira camada; validação humana autenticada pendente |
| 11 | mesma engine atende SIMPLE e ANALYTICAL | **PASS** | apresentação muda; fatos/tese permanecem |
| 12 | segunda visita melhora | **PENDENTE UAT** | automação/PG aprovados; repetição integral pela interface pendente |
| 13 | nenhum claim técnico indevido ocorre | **PASS** | high-risk, MIA e observação agronômica falham fechados |
| 14 | tenancy continua íntegra | **PENDENTE FINAL** | testes/PG aprovados; negativo HTTP implantado de áudio/transcript pendente |
| 15 | regressões passam | **PASS** | 654/654, smokes e CI verde |
| 16 | builds passam | **PASS** | principal/PWA, Manual, CI e Railway verdes |
| 17 | mobile funciona | **REPROVADO** | iOS físico falhou e não foi retestado; Android físico não executado |
| 18 | nenhuma produção foi tocada | **PASS** | somente branch/PR DRAFT e projeto isolado de staging; `main` intacta |

Totais: **10 PASS / 6 PENDENTES / 2 REPROVADOS**.

## Gaps obrigatórios

1. retestar o fix de duração em iPhone físico até transcrição, revisão e confirmação;
2. executar Android físico em Chrome e PWA;
3. fechar pela interface autenticada: Home/Cliente 360 -> PRE -> FIELD -> POST -> Commitment/Outcome/LearningCandidate -> visita 2;
4. executar cancelamento, retry, fallback textual e negação de microfone em dispositivos reais;
5. executar negativos HTTP cross-tenant de áudio e transcript no staging;
6. validar concisão, navegação, quantidade de toques e performance no aparelho.

## Riscos

- codecs reais do Safari/Android ainda não possuem evidência física final;
- comportamento de rede móvel, permissão e retomada não foi fechado;
- UAT autenticado pode revelar fricção que teste de fonte/CSS não detecta;
- chunk principal acima de 500 kB pode afetar aparelhos/rede mais lentos;
- object storage privado continua sendo a arquitetura futura para áudio bruto; nenhum recurso pago foi criado nesta entrega.

## Rollback

Não há migration nova nem alteração destrutiva. O rollback de staging consiste em reconectar `val-web-staging` à branch anterior `feature/prepare-visit-simple-ux@6fc962f8f37c62d045b4727bc5f29a6f3bafee15` e redeployar. O PostgreSQL não precisa de rollback. A branch e o PR DRAFT preservam toda a rastreabilidade.

## Recomendação e parada

Não promover, não fazer merge e não iniciar o Passo 07. Executar apenas o UAT físico/autenticado listado acima e reemitir o gate depois de todas as evidências passarem.

Produção e `main` permanecem intactas. O trabalho para aqui e aguarda autorização humana explícita.

**GATE VAL COPILOT v1 REPROVADO**
