# Plano da Fase 4 — MIC, MDI e MVV

## 1. Base, escopo e invariantes

- Branch local: `phase4/behavior-decision-value`.
- Commit-base imutável: `ec0c10686855f410f4e131754a34127f062fbf9f` (Passo 03 aprovado).
- Estratégia: evoluir os motores atuais por contratos e adapters; não substituir `ValEngine`, APIs, front-end, prompts, bootstraps ou barreiras agronômicas.
- Execução: somente local; sem commit, push, PR, merge, Railway, deploy ou produção.
- Persistência: nenhuma migration prevista. Os artefatos da Fase 4 são derivados do `ContextSnapshot v1` e do contexto legado, sem criar uma nova fonte de verdade no banco.

## 2. Auditoria das responsabilidades atuais

| Patrimônio atual | Responsabilidade observada | Módulo dono | Decisão de evolução |
|---|---|---|---|
| `src/lib/profile.js` + `profile-matrix.json` | Soma respostas 7–18 em cinco tags, escolhe primária/secundária e calcula IRT/NPS | MIC (legado) | Preservar resultado legado; adapter produz pesos probabilísticos em quatro dimensões e separa `DIGITAL` como preferência de interação |
| `sales-playbook.js` | Constituição, Structured Output, perfil decisório, método, evidência e safety | Adapter transversal | Não alterar prompt nesta fase; consumir a saída atual e anexar contratos v1 determinísticos |
| `decision-intelligence.js` (Nexo) | Evidências, sinais cruzados, hipóteses concorrentes, dado de maior valor e síntese | MDI | Reutilizar integralmente atrás do adapter de `DecisionThesis v1` |
| `conversion-engine.js` | Qualidade de dados, score/prioridade, workflow, confiança, reconciliação da resposta | MDI + MVV | MDI recebe fatos/risco/confiança; MVV recebe estágio, próxima pergunta e estratégia; cálculos permanecem determinísticos |
| `product-intelligence.js` (Value Bridge) | Comparação comercial de produtos, alternativas oficiais, lacunas e limites técnicos | MVV com MIA/MGO | Reutilizar como fonte de tese de valor/prova, sem promover equivalência técnica |
| `conversation-orchestrator.js` | Continuidade, intenção, roteamento, perguntas e síntese conversacional | CORE/MVV adapter | Preservar como implementação de conversa; ValuePlan limita perguntas e formaliza a saída |
| `val-methodology.js` | Sequência preparar → alinhar → descobrir → dimensionar → construir valor → propor → comprometer; SPIN/EPA/OPC | MVV | Preservar; mapear para estágios v1 sem criar metodologia concorrente |
| `commitment-ladder.js` | Próximo “sim” mínimo, guardrails e evidência | MVV/MEX futuro | Consumir apenas para `commitment_target`; persistência/lifecycle pertence ao Passo 05 |
| `objection-library.js` | Objeções reais e padrões com causalidade limitada | MVV | Reutilizar como evidência; fixture de preço proíbe desconto automático |
| `value-scenarios.js` | Cenários econômicos e break-even com números confirmados | MVV | Reutilizar; nenhum número pode ser inventado |
| `multi-decision-map.js` | Decisores e papéis confirmados, lacunas e ACL | MIC/MDI | Usar como contexto de governança; não inferir papéis ou atributos pessoais |
| `message-calibration.js` | Calibração em shadow mode e amostra mínima | MIC/MVV | Manter como feedback limitado; não autoalterar perfil ou prompt |
| `post-conversion-expansion.js` | Descoberta pós-fechamento e cross-sell com evidência | MVV | Consumir somente quando fechamento real existir |

## 3. Sobreposições e fronteiras

- Nexo e Conversion Engine hoje priorizam decisões. O Nexo explica conexões e hipóteses; o Conversion Engine calcula prioridade, estado e confiança. O MDI compõe ambos, sem duplicar seus cálculos.
- Conversion Engine, Value Bridge e Conversation Orchestrator hoje sugerem ação/pergunta. O MDI decide o que recomendar; o MVV decide como conduzir a conversa; o Orchestrator preserva continuidade e linguagem.
- `sales-playbook` contém regras dos três módulos, mas permanece como implementação legada. Os contratos v1 tornam as fronteiras verificáveis sem reescrever o prompt.
- Commitment Ladder não passa a ser lifecycle de compromisso: nesta fase fornece somente alvo de avanço. `Commitment` persistente continua reservado ao MEX/Passo 05.
- Objection Library fornece evidência histórica, nunca script causal ou autorização para desconto.

## 4. Contrato 26/27 e DIGITAL

### 4.1 Questionário

O cadastro atual tem 45 perguntas:

- núcleo oficial: perguntas 1–27;
- obrigatórias atuais: 1–26;
- pergunta 27: núcleo comercial opcional (`additional_need`), preservada como origem de oportunidade;
- complementares opcionais: 28–45.

`QuestionnaireDefinition v1` registrará `question_id`, versão, dimensão, `required` e `active`. Assim, “26 respostas centrais” passa a significar **26 obrigatórias**, e “27 perguntas” passa a significar **27 perguntas do núcleo**, sem alterar validação, dados ou UI.

### 4.2 DIGITAL

`DIGITAL` recebe pontos hoje nas mesmas perguntas 7–18 e pode vencer como perfil primário. Porém, as alternativas associadas descrevem majoritariamente canal, formato de conteúdo, rapidez e atendimento remoto. O Projeto Mestre usa “analítico digital” como dinâmica composta e define somente quatro perfis decisórios. Nesta fase:

- o score/tag legado `Digital` permanece intacto;
- `BehavioralProfile v1` não o promove a quinto peso psicológico;
- seus sinais entram em `interaction_preferences`/orientação de comunicação;
- não há migração ou reclassificação dos dados antigos.

## 5. Cobertura atual das simuladas e gaps

Os testes existentes cobrem peças isoladas: objeção de preço sem desconto, break-even, perfis como hipótese, continuidade, commitment ladder, objeções observadas, mapa de decisores, safety e Nexo. Não existe hoje `CommercialScenarioFixture`, estado formal das 20 simuladas, nem rastreabilidade cenário → requisito → teste → módulo → owner. O caso Raul aparece apenas como conhecimento documental, sem fixture executável comparando abordagem fraca e venda de valor.

Gaps a fechar:

1. perfil probabilístico, híbrido, explicável e corrigível;
2. contrato formal do questionário;
3. `DecisionThesis v1` posicionada ou bloqueada por falta crítica;
4. `ValuePlan v1` com até três perguntas materiais e próximo passo;
5. fixtures comerciais `CASE_ONLY`, incluindo Raul fraco/bom e analogia Ferrari;
6. matriz das 20 simuladas com estado explícito;
7. telemetria sem conteúdo sensível;
8. consumo explícito de `ContextSnapshot v1` e bloqueio cross-tenant.

## 6. Implementação planejada

### MIC

- Adapter determinístico lê sinais e evidências autorizadas do `ContextSnapshot v1`, respostas do questionário e campos legados.
- Produz pesos normalizados `analytical`, `relational`, `innovative`, `conservative`.
- Confiança deriva de quantidade, diversidade e rastreabilidade dos sinais, nunca da eloquência.
- Sem sinais: pesos neutros, confiança baixa e lacunas explícitas.
- Sugere de uma a três perguntas de alto valor, sem repetir resposta confiável existente.

### MDI

- Compõe ContextSnapshot, BehavioralProfile, Nexo, Conversion Engine e Value Bridge.
- Se houver dado crítico ausente/conflito/bloqueio técnico: decisão `DISCOVER_BEFORE_RECOMMENDING`.
- Se houver base: tese posicionada com evidências, alternativas, riscos, trade-offs, condições de revisão e próxima ação.
- Confidence é determinística e limitada pela confiança do snapshot e pelas evidências.

### MVV

- Mapeia a metodologia existente para `EXPLORE`, `DIAGNOSE`, `BUILD_VALUE`, `PROPOSE`, `NEGOTIATE`, `COMMIT`.
- Preserva OPC como terminologia oficial e documenta APC como alias legado observado.
- Aplica EPA como funções dentro do plano: educar com evidência, personalizar forma/prova e assumir controle do processo sem pressionar a pessoa.
- Limita perguntas a três e exige materialidade declarada.
- Objeção “está caro” segue diagnóstico → impacto → agir versus não agir → risco/retorno → condição comercial; desconto automático é proibido.
- Analogias são opcionais e nunca entram em `evidence_refs`.

### Integração

- Criar facade/adapters comerciais chamada pela composição atual, sem remover bootstraps.
- Anexar `behavioral_profile`, `decision_thesis` e `value_plan` à recomendação como campos compatíveis e adicionais.
- Propagar versões e referências no audit do `ResponseEnvelope v1` sem mudar campos obrigatórios legados.
- Emitir apenas IDs, versões, confidence, módulos e latência na telemetria.

## 7. Arquivos previstos

### Novos

- `server/commercial/contracts.js`
- `server/commercial/questionnaire-definition.js`
- `server/commercial/behavioral-profile.js`
- `server/commercial/decision-thesis.js`
- `server/commercial/value-plan.js`
- `server/commercial/scenario-fixtures.js`
- `server/commercial/composition.js`
- schemas JSON v1 correspondentes em `contracts/v1/`
- testes `test/phase4-*.test.js`
- documentação solicitada em `docs/phase-4/`
- `GATE_FASE_4_RESULTADO.md`

### Alterações mínimas previstas

- `server/conversion-bootstrap.js`: chamar o adapter após o comportamento legado estar calculado.
- `server/core/val-core.js`: registrar versões/módulos e referências comerciais no audit sem quebrar o envelope.
- `server/core/contracts.js` e `contracts/v1/response-envelope.schema.json`: aceitar os novos campos opcionais de auditoria sem alterar os obrigatórios de v1.
- `server/observability.js`: permitir somente metadados comerciais não sensíveis no logger estruturado.
- `openapi/val-core-v1.yaml` e `contracts/v1/README.md`: documentar somente os novos artefatos opcionais.

### Não serão alterados

- `server/val-engine.js`
- `server/sales-playbook.js`
- `server/val-methodology.js`
- `server/conversion-engine.js`
- `server/decision-intelligence.js`
- `server/product-intelligence.js`
- `server/innovation-bootstrap.js`
- front-end e Manual
- schema e migrations de banco
- autenticação, tenancy, IDs, dados e APIs legadas

## 8. Testes

- 22 casos mínimos MIC/MDI/MVV solicitados.
- Contract tests dos quatro novos contratos e compatibilidade de versões.
- Characterization tests dos adapters contra os motores legados.
- Fixture Raul fraco/bom e Ferrari.
- Testes negativos cross-tenant para perfil, tese e plano.
- `ContextSnapshot v1`, Request/ResponseEnvelope v1, smokes legado/v1, barreiras agronômicas.
- Suíte completa, build principal e build do Manual.

## 9. Riscos e proteções

| Risco | Proteção |
|---|---|
| alterar fala/fato legado | campos novos aditivos; saída legada preservada; characterization tests |
| perfil virar rótulo | pesos, evidências, confiança, lacunas e proibição de atributos sensíveis |
| DIGITAL ser apagado ou reinterpretado | tag e score legados preservados; adapter explícito de preferência de interação |
| dupla metodologia OPC/APC | OPC oficial; APC somente alias documentado |
| tese comercial burlar safety | bloqueio técnico tem precedência; testes de regressão existentes e novos |
| IA inventar número | cálculos e valores apenas determinísticos/confirmados; fixtures negativas |
| vazamento cross-tenant | validação de `organization_id` em todo contrato e testes negativos |
| telemetria vazar conteúdo | registrar refs, versões, confidence e latência; nunca conteúdo da conversa |

## 10. Rollback

Como não há migration, o rollback local é retirar a chamada do adapter e os arquivos aditivos da Fase 4. O comportamento legado permanece atrás dos mesmos bootstraps e contratos. Nenhum dado é reescrito e nenhuma API é removida.

## 11. Gate objetivo

O gate será aprovado somente quando os 14 critérios solicitados estiverem comprovados por testes, incluindo: MIC probabilístico; contrato 26/27; tese posicionada ou lacuna explícita; ValuePlan humano; preço sem desconto automático; Raul testado; fatos invariáveis por perfil; safety; compatibilidade legada/envelopes; consumo tenant-safe de ContextSnapshot; suíte e ambos os builds verdes.
