# GATE VAL AI COPILOT v2 — APROVADO TÉCNICO / PENDENTE UAT MOBILE

Data: 25/08/2026  
Escopo: branch, PR DRAFT e projeto isolado de staging. Sem merge, sem produção e sem Passo 07.

## Decisão

A implementação, os contratos, os testes, o CI, o build e a validação desktop autenticada no staging foram aprovados. O gate de promoção permanece **PENDENTE** porque a experiência mobile/voice não foi executada em dispositivo físico nesta rodada. O requisito de performance para dúvidas rápidas também precisa de otimização: a última chamada medida concluiu com HTTP 200 em 54,3 s de backend.

Resultado dos 19 critérios finais: **18 PASS / 1 PENDENTE UAT**. Portanto, não promover, não fazer merge e não apontar produção.

## Rastreabilidade

| Item | Evidência |
|---|---|
| base | `feature/val-copilot-knowledge-v1@57b7c322e461287038879e64bb65af109b648fc1` |
| branch | `feature/val-ai-copilot-v2` |
| commit local validado | `89d83e5` |
| commit remoto validado | `a45640331862ccc06f0e2b658ad04f5fda9dbbce` |
| árvore local/remota | `c146b89ed3862d66d9c098e812a962a85a7ae8bf` |
| PR | `#89`, DRAFT contra `feature/val-copilot-knowledge-v1` |
| CI | GitHub Actions `Validate #189`, `success` |
| staging | projeto `VAL - STAGING INTEGRATION 01`, serviço `val-web-staging` |
| deploy validado | `9053e94b-41a7-4f14-a1a5-61240667c60c`, `SUCCESS`, commit `a456403` |
| banco | PostgreSQL isolado, `SUCCESS`; nenhuma migration nova |
| produção | não acessada nem alterada; `main` permaneceu `f405617405fb66811207fdf006c2fbdaebfb8c9d` |

O ambiente da Railway se chama internamente `production`, mas pertence ao projeto exclusivamente isolado de staging acima; não é a produção real da VAL.

## Arquitetura antes e depois

| Antes | Depois |
|---|---|
| templates e composição podiam chegar à UI sem contrato único de raciocínio | `AIReasoningResult v1` é anexado ao mesmo pipeline da VAL |
| intenção implícita misturada ao fluxo | Intent Router v1 classifica 12 intents e declara `persistence_mode` |
| especificidade dependia principalmente da composição existente | `NAME_SWAP_TEST`, `CONTEXT_REMOVAL_TEST`, Golden Question Quality e recomposição única são gates automáticos |
| conversa e histórico podiam ser tratados sem escopo explícito de sessão | `conversation_id` é isolado por produtor e sessão; memória confirmada continua separada |
| modelo aparecia como detalhe da engine | `ReasoningProvider` torna o provedor substituível e registra modelo, prompt, hash, latência, status e fallback |

Fluxo final:

`input -> authorization/tenancy -> ContextSnapshot -> memory/knowledge/agronomia -> AI Reasoning -> validação determinística -> safety -> composição -> UI`

A camada de IA sintetiza a decisão, mas não controla autorização, tenant, fact status, promoção de memória, aprovação de KnowledgeItem nem safety.

## UX antes e depois

| Jornada | Antes | Depois |
|---|---|
| pergunta rápida | exigia navegar para produtor, visita ou ambiente especializado | copiloto global abre por sidebar, topbar, Home, Produtor 360 ou `Ctrl/Cmd + K` |
| Home | atenção dividida entre dashboard e módulos | até três prioridades e entrada direta para perguntar, falar, foto ou arquivo |
| contexto | usuário repetia o produtor | Produtor 360 injeta o produtor atual; fora dele a seleção é obrigatória |
| resposta | análise densa na primeira camada | leitura curta, ação, até três perguntas e drill-down “Por que a VAL disse isso?” |
| registro | conversa e captura pareciam próximas | abas `Perguntar` e `Registrar informação` tornam a intenção explícita |
| agronomia | sensação de ambiente separado | foto, arquivo, solo e dúvida técnica entram pelo mesmo copiloto e passam por MIA/safety |

## Exemplos de resposta antes e depois

Antes, uma resposta podia continuar válida após trocar o nome: “entenda a necessidade, adapte a abordagem e apresente os benefícios”.

Depois, no staging, a mesma pergunta produziu leituras materiais diferentes:

- **Matheus Nascimento Jaeger:** decisão próxima sobre fertilizante e forma de pagamento, visita de fechamento em 28/08, alternativas de entrega/CPR e participação do pai ainda a confirmar; ação: validar decisão, participantes e formato de compra antes da visita.
- **Antonio Carlos Costa Beber:** o contexto acionou revisão técnica; a VAL reteve diagnóstico, produto, dose, mistura e aplicação e pediu fonte, método e responsável habilitado.

Isso responde ao ponto central: a VAL não aplica a resposta de Antonio a todos. Ela recompõe as premissas em cada solicitação com o `ContextSnapshot` confirmado, o perfil, o histórico, a oportunidade e as evidências daquele produtor.

## Golden Questions antes e depois

Antes, pequenas trocas de preposição podiam ocupar duas posições com a mesma pergunta decisória.

Depois:

- score interno em `specificity`, `openness`, `novelty`, `decision_impact` e `context_grounding`;
- similaridade conceitual igual ou superior a `0.68` reprova `novelty`;
- sinônimos de evidência, revisão, requisito e decisão são normalizados;
- a validação final de staging mostrou uma única pergunta material no bloqueio técnico: “Qual dado, fonte ou método ainda falta para o responsável técnico revisar esta decisão?”.

## Fluxo de dúvidas rápidas

1. usuário abre a VAL sem criar Visita;
2. dentro do Produtor 360, o produtor é implícito; fora dele, precisa ser selecionado;
3. Intent Router classifica a solicitação;
4. ContextSnapshot, memória confirmada, Biblioteca, Manual e agronomia são recuperados conforme relevância;
5. a resposta passa por quality e safety;
6. ASK registra auditoria/recomendação, mas não promove fatos;
7. somente `Registrar informação` abre Voice Capture, estrutura candidatos, mostra revisão e exige confirmação humana antes da memória.

## Fluxo desktop

O staging autenticado confirmou side panel sobre a página atual, seleção explícita fora de produtor, contexto implícito dentro de Matheus, texto, voz, foto e arquivo, densidades Simples/Equilibrada/Analítica e provenance em “Por que a VAL disse isso?”. A Home foi revalidada com exatamente três cards, numerados `01`, `02` e `03`.

## Fluxo mobile

O código e os testes confirmam navegação `HOJE / CLIENTES / VAL / MAIS`, botão central VAL, sheet/full screen, texto, voz, câmera e arquivo. Não houve execução em iPhone ou Android físico nesta rodada. Esse é o único bloqueio formal do gate de promoção.

## AI Reasoning e qualidade

- contrato `val.ai_reasoning_result.v1` com organização, produtor, snapshot, sinais, fatos, hipóteses, lacunas, Decision Thesis, perguntas, estratégia, agronomia, comercial, compromisso, riscos, confiança e refs;
- Decision Thesis contém `CURRENT_SITUATION`, `WHAT_MATTERS`, `KEY_UNCERTAINTY`, `THESIS`, `WHY`, `WHAT_TO_VALIDATE` e `WHAT_WOULD_CHANGE_MY_VIEW`;
- `VAL_RESPONSE_QUALITY v2` usa as 12 dimensões obrigatórias;
- uma única recomposição é permitida; nova falha gera `REASONING_DEGRADED` sem inventar contexto;
- safety tem precedência e nunca é apagada para melhorar score.

## Agronomia, Biblioteca e Manual

- agronomia é acionada por intent, anexo e contexto; high-risk exige fonte governada/revisão;
- a Biblioteca existente continua limitada a KnowledgeItems aprovados e guarda `knowledge_refs`;
- o Manual continua como fonte para MIA, não como outra VAL ou como memória do produtor;
- Memory, Knowledge, Manual, visita, interação, voz e oportunidade permanecem separados por provenance.

## Safety, memória e tenancy

- ASK usa `persistence_mode=NONE` e não transforma conversa em fato;
- REGISTER/POST_VISIT retornam `CONFIRM_REQUIRED` e o endpoint de ASK rejeita promoção silenciosa;
- voz transitória é cancelada após transcrição e antes de qualquer confirmação/memória;
- prompt, transcript, documentos e KnowledgeItems são tratados como conteúdo não confiável;
- tenant e ator continuam vinculados ao ContextSnapshot e às consultas;
- a última validação técnica gerou o evento governado `val.technical_review_divergence`, acionou hard block/revisão e ainda concluiu a API com HTTP 200; não foi falha operacional.

## Testes e regressões

- suíte completa local: **662/662**;
- suíte focada v2: **10/10**;
- cinco perfis: analítico, relacional, conservador, inovador e pouco histórico;
- cinco preferências de consultor: mesma decisão, densidade diferente;
- 12 intents, ASK sem memória, REGISTER com confirmação, sessão por produtor, troca de produtor, voz transitória, mobile, desktop, provenance, Library, Manual, fallback, safety, tenancy e prompt injection cobertos pela suíte acumulada;
- build Vite: aprovado, 1.714 módulos;
- PWA/Manual/Railway: build e deploy aprovados;
- GitHub Actions `Validate #189`: `success`;
- Railway deploy final da implementação: `SUCCESS`;
- warning conhecido: chunk principal acima de 500 kB, não bloqueante, mas relacionado ao gap de performance.

## Critérios do gate

| # | Critério | Estado | Evidência |
|---:|---|---|---|
| 1 | perguntar sem abrir visita | **PASS** | Home e copiloto global validados |
| 2 | entender contexto atual | **PASS** | Produtor 360 abriu Matheus implicitamente |
| 3 | raciocínio específico | **PASS** | Antonio e Matheus tiveram teses materiais diferentes |
| 4 | NAME_SWAP_TEST | **PASS** | teste automático e recomposição |
| 5 | Golden Questions melhoram | **PASS** | score em cinco dimensões e deduplicação confirmada no staging |
| 6 | usar histórico | **PASS** | Matheus usou visita, oportunidade e participantes registrados |
| 7 | agronomia natural | **PASS** | follow-up de milho acionou MIA/safety no mesmo painel |
| 8 | Biblioteca relevante | **PASS TÉCNICO** | retrieval governado preservado e refs no contrato |
| 9 | Manual quando necessário | **PASS TÉCNICO** | fonte MIA preservada no pipeline único |
| 10 | usuário não vê motores | **PASS** | primeira camada fala em decisão, não em MMI/MCTX/MIA |
| 11 | Home mais simples | **PASS** | exatamente três prioridades + pergunta direta |
| 12 | mobile mais rápido | **PENDENTE UAT** | contrato e layout passam; dispositivo físico não executado |
| 13 | registro fora de visita | **PASS TÉCNICO** | Quick Note/Voice Capture disponível no painel global |
| 14 | conversa não vira memória | **PASS** | UI, roteador, endpoint e testes |
| 15 | safety permanece | **PASS** | hard block e revisão observados no staging |
| 16 | tenancy permanece | **PASS** | escopo por tenant/ator e regressões verdes |
| 17 | fallback funciona | **PASS** | `REASONING_DEGRADED` e fallback determinístico testados |
| 18 | regressões passam | **PASS** | 662/662 |
| 19 | builds passam | **PASS** | local, CI e Railway |

## Gaps

1. executar UAT em iPhone e Android físicos: abrir VAL, digitar, voz, foto, arquivo, cancelar, retry e confirmação;
2. medir e reduzir a latência de dúvidas rápidas; amostra final de backend: 54,3 s;
3. executar uma confirmação completa de Quick Note pelo staging com um produtor de teste e verificar a premissa recomposta na pergunta seguinte;
4. medir o impacto do chunk acima de 500 kB em rede móvel e PWA.

## Rollback

Não há migration nova, segredo alterado ou recurso criado. Para rollback integral do staging, reconectar `val-web-staging` à branch anterior `feature/val-copilot-knowledge-v1@57b7c322e461287038879e64bb65af109b648fc1` e redeployar. O PostgreSQL não requer rollback.

## Recomendação e parada

Manter o PR `#89` em DRAFT. Não promover, não fazer merge, não tocar produção e não iniciar Passo 07. Executar somente os gaps de UAT/performance acima após nova autorização humana explícita.

**GATE VAL AI COPILOT v2: APROVADO TÉCNICO / PENDENTE UAT MOBILE.**
