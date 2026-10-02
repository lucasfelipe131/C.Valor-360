# Passo 08 — Decision Engine e Next Best Action

Base imutável: `7432421a5c583ae08076b15a06b3e4bb7881eba0` (Passo 07, PR #111).
Branch: `feature/val-passo08-decision-engine-nba-v1`.
PR stacked draft, base `feature/val-passo07-hub-integracoes-v1`.

## Uma inteligência, uma identidade

`buildNextBestAction` evolui `server/decision-intelligence.js`: reutiliza os fatos do VAL NEXO e os indicadores comerciais existentes. `buildPortfolioRadar(..., {version:'v2'})` ordena esses mesmos cartões. O comportamento v1 continua disponível para os consumidores existentes e para rollback. Não existe outro cadastro de produtor, motor de IA ou CRM.

`ValRepository.getDecisionContexts` lê os produtores canônicos ativos do tenant e do consultor autenticado, inclusive contas de menor valor. O ContextSnapshot existente aplica a seleção governada de memória. Somente fatos atuais selecionados entram como memória na decisão; hipóteses não ganham condição de fato. A SOG usa seu repositório existente e referências de mercado do mesmo proprietário. Não há busca externa ou provider call para gerar prioridades.

O Hub é consumido pelo vínculo canônico e escopo originais. A evidência retém source, external_id, canonical_entity, observed_at, ingested_at, versão, evento e hash de payload. Um evento em revisão não é tratado como fato aprovado. Dados do produtor não são alterados pelo motor.

## Contrato e pontuação

DecisionCard v1 contém produtor canônico, prioridade/score, decisão, headline, why_this_producer, why_now, next_best_action, expected_value, risk_of_waiting, confidence, missing_information, evidence/source_refs, deadline, canal, timing, status, versão, generated_at e ContextSnapshot. Os aliases `why`, `action`, `risk`, `evidence_refs` preservam o contrato único nas telas e no Copilot.

Política v1: COMMERCIAL_VALUE 20, URGENCY 35, RELATIONSHIP 10, AGRONOMIC_SIGNAL 15, TIMING 15, RISK 5. A alternativa conservadora usa 10/40/10/15/20/5. As políticas registram os pesos, a saturação comercial de R$ 250 mil, os prazos de validade e o fator para evidência vencida. São heurísticas de priorização, não probabilidades estatísticas.

Cada dimensão expõe contribuição, peso, estado e referências. Dados ausentes permanecem NO_DATA com contribuição zero; não há penalidade por cadastro incompleto. Evidências antigas têm contribuição reduzida e confiança qualificada. Evidência com observação futura é incompatível e requer revisão. O total é limitado a 100. Empates usam score, prazo mais próximo e ID público canônico em ordem estável. A Home mostra no máximo cinco prioridades elegíveis.

Oportunidades fechadas/perdidas/canceladas, compromissos cancelados/concluídos e visitas canceladas/concluídas ficam fora dos gatilhos. Visita próxima só sugere preparação quando existe decisão relevante. A preparação chama o fluxo já existente com SPIN, OPC/APC, EPA e perguntas de ouro.

Valor é a estimativa registrada da oportunidade escolhida ou o potencial aberto conhecido. Sem base, UNKNOWN. Nenhum ROI, perda financeira ou receita causal é inventado. Sinal agronômico não validado entra na revisão; nenhuma dose, mistura ou operação é executada. O Decision Interview reutilizado faz uma pergunta material por vez.

## Persistência, isolamento e governança

A migração aditiva 017 cria configurações e seu histórico, versões de cartões, auditoria, revisões e feedback. Cartões referenciam `clients.id`; não criam entidades canônicas. As consultas exigem tenant e owner da sessão, membership ativa e proprietário atual do produtor. BI não acessa cartões individuais. Transferir ou arquivar um produtor revoga a leitura dos cartões antigos na carteira anterior.

Geração usa transação e lock por tenant/owner. O fingerprint canônico permite repetir leituras sem duplicar versões. Mudança de evidência, score, posição, tempo decisório ou política gera versão nova, preservando a anterior. Auditoria registra decision_generated, evidence_changed, priority_changed, review_requested, review_resolved, action_selected e action_dismissed, sempre com policy_version. Feedback tem chave de idempotência por tenant/owner; replay divergente é recusado.

Revisões têm PENDING, APPROVED, REJECTED ou RESOLVED e exigem justificativa. Resolver uma revisão não modifica a evidência, a identidade ou o CRM. Feedback relata escolha/uso/execução/adaptação/descarte humano; não retreina nem altera score automaticamente.

Prompt Registry e Model Registry inventariam as capacidades reais e hashes dos fontes ativos. Policy Registry cobre routing, grounding, freshness, scoring, safety, memory, source requirements e isolation. Prompts privados completos e secrets não são persistidos. A aprovação de release permanece pendente. O commit-base é recuperável para fontes anteriores; versões de configurações são recuperáveis no próprio histórico.

Flags: nba_v1, portfolio_radar_v2, decision_cards, management_decision_view. Defaults ativados apenas em staging/test/development. Mudanças exigem administrador, ambiente de desenvolvimento autorizado, justificativa e revisão esperada (controle otimista). Rollback cria uma revisão nova com a configuração histórica, sem apagar trilha. A mudança de modelo continua explícita na configuração existente, nunca automática.

## Produto e operação

Home, Cliente 360, Oportunidades, Visitas e Copilot consomem o mesmo contrato. Detalhes e evidências são expansíveis; o cartão prioriza ação, motivo, prazo, valor e confiança. Feedback exige confirmação. Respostas antigas de outro produtor são descartadas ao mudar o escopo da tela.

Hub / Integrações contém governança, fila de revisão e registros de versões. Gestão usa o RBAC e a unidade existentes: agregações por consultor, prioridades abertas, vencidas, falta de próximo passo, valor registrado, qualidade, confiança, feedback, tempo até ação relatada e oportunidades atualizadas após decisões. Atualização posterior não é apresentada como causalidade. As métricas seguem os filtros da unidade; demonstrações continuam excluídas da gestão.

Endpoints autenticados: GET /api/decisions, GET /api/decisions/cards/:id, POST /api/decisions/cards/:id/feedback, POST /api/decisions/cards/:id/review, GET /api/decisions/reviews, GET /api/decisions/registry, PATCH /api/decisions/settings e GET /api/management/decisions. `clientId` opcional é resolvido somente dentro da carteira autenticada. Tenant/owner enviados pelo navegador nunca ampliam escopo.

## Verificação e limites de release

Regressões: `test/decision-engine-v2.test.js`, `test/decision-service.test.js`, `test/decision-ui.test.js`. A suíte de serviço usa o schema e todas as migrações reais; CI executa também em PostgreSQL 16 com HTTP autenticado e perguntas ao Copilot. Nenhum teste exige provider call. O workflow conserva os gates existentes, inclusive Hub e Manual.

K5_RELEASE_GATE = PENDING. K5 não é executado durante este passo. Evidências anteriores são preservadas. Main, produção, secrets e PRs #107/#111 não são alterados. Não fazer merge ou promover produção. Declarar conclusão apenas após testes, CI e staging comprovados no SHA final; então parar.
