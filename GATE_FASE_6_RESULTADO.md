# GATE DA FASE 6 — RESULTADO LOCAL

## Resultado executivo

**GATE FASE 6 APROVADO**

O primeiro fluxo vertical completo de visita foi implementado e validado localmente:

`preparar → registrar por texto/áudio → extrair candidatos → revisar → confirmar → consolidar memória/compromisso/outcome → gerar LearningCandidate → preparar melhor a visita seguinte`

O marco de valor foi comprovado:

> **A próxima visita é melhor porque a visita anterior aconteceu.**

Nenhum commit, push, Pull Request, merge, deploy, acesso à Railway ou alteração de produção foi realizado. O Passo 07 não foi iniciado.

## Base e cadeia de trabalho

| Item | Evidência | Status |
|---|---|---|
| Branch local | `phase6/visit-learning-loop` | APROVADO |
| HEAD remoto de origem | `origin/phase5/execution-insight` | `ea82fdaa9a401505e661be5409e21ae2d6a3112a` |
| HEAD local antes/depois da implementação | `ea82fdaa9a401505e661be5409e21ae2d6a3112a` | Sem commit |
| Merge-base com a Fase 5 | `ea82fdaa9a401505e661be5409e21ae2d6a3112a` | APROVADO |
| Partiu da `main` | Não | APROVADO |

## Escopo implementado

- `VisitLifecycle v1`: `PLANNED`, `PREPARED`, `IN_PROGRESS`, `COMPLETED_PENDING_REVIEW`, `COMPLETED` e `CANCELLED`, com transições explícitas e eventos append-only.
- preparação de visita versionada, preservando cada `ContextSnapshot`, perfil, tese, plano de valor e `ActionPlan` utilizados;
- registro pós-visita por texto livre ou áudio;
- contrato abstrato de transcrição com mock controlado e falha segura quando o provedor não está disponível;
- `VisitTranscript v1`, sem promoção automática de transcrição a fato;
- `VisitReport v1`, com `FACT_CANDIDATE`, `INFERENCE` e `HYPOTHESIS` separados;
- revisão humana com confirmação, edição, remoção e adição antes da consolidação;
- conversão de compromissos confirmados para `Commitment v1`;
- próximo passo obrigatório ou `NO_ACTION` explicitamente confirmado;
- `Outcome v1` comercial, técnico e relacional;
- `LearningCandidate v1`, sempre criado como `CANDIDATE`, nunca como conhecimento validado;
- APIs v1 aditivas e OpenAPI/JSON Schemas atualizados;
- interface mínima com um único gatilho “Registrar visita”, entrada por texto/áudio e confirmação humana;
- observabilidade sem conteúdo do áudio, transcrição ou relato nos logs.

Durante a validação PostgreSQL foi identificada e corrigida uma lacuna estritamente pertencente ao fluxo da Fase 6: o caminho PostgreSQL de `getClientContext` ainda não incorporava `val_outcomes` em `learning.visitOutcomes`. A consulta passou a recuperar outcomes apenas do mesmo tenant, produtor e carteira. Isso permite que a preparação seguinte use `NO_DECISION` no banco real, como já ocorria no fallback de testes, sem alterar contrato público, ValEngine ou prompt.

## Migration 004

Arquivo: `database/migrations/20260823_004_visit_learning_loop_expand.sql`.

Classificação: **EXPAND-ONLY e idempotente**.

### Alterações aditivas

Oito colunas nullable em `visits`:

- `lifecycle_status`;
- `lifecycle_version`;
- `lifecycle_revision`;
- `occurred_at`;
- `completed_at`;
- `cancelled_at`;
- `lifecycle_updated_at`;
- `lifecycle_updated_by`.

Seis tabelas novas:

- `val_visit_lifecycle_events`;
- `val_visit_preparations`;
- `val_visit_transcripts`;
- `val_visit_reports`;
- `val_outcomes`;
- `val_learning_candidates`.

Foram adicionados apenas índices, checks e foreign keys necessários. As relações materiais usam `(tenant_id, id)` ou `(tenant_id, user_id)`.

### Invariantes comprovados antes do runtime

| Invariante | Antes | Depois da migration | Resultado |
|---|---:|---:|---|
| `clients` | 2 | 2 | Preservado |
| `visits` | 3 | 3 | Preservado |
| `val_memories` | 1 | 1 | Preservado |
| `val_attachments` | 1 | 1 | Preservado |
| `interactions` | 0 | 0 | Preservado |
| Hash dos IDs legados | `08e722e8b407a8c19196507d108c4dcc` | `08e722e8b407a8c19196507d108c4dcc` | Idêntico |

A migration não contém `UPDATE`, `DELETE`, `TRUNCATE`, `DROP`, `RENAME`, mudança de tipo ou backfill. A aplicação não classificou visitas existentes, não reclassificou memória legada e não alterou IDs.

Ela foi executada duas vezes no mesmo PostgreSQL 16. O schema da primeira e da segunda aplicação permaneceu idêntico, comprovando idempotência.

## PostgreSQL 16 — migration, backup e restore

Ambiente: dois clusters PostgreSQL **16.15** locais, efêmeros, isolados, vinculados apenas a `127.0.0.1` e removidos após a validação.

Sequência aplicada no banco de origem:

1. `database/schema.sql`;
2. migration 001;
3. migration 002;
4. migration 003;
5. fixtures explícitos de dois tenants;
6. baseline pré-migration;
7. migration 004;
8. reaplicação da migration 004;
9. ciclo vertical real da Fase 6;
10. backup com `pg_dump --format=custom`;
11. restore em outro cluster PostgreSQL 16 limpo;
12. revalidação de schema, dados, referências, constraints, isolamento e ciclo essencial.

### Resultado no banco migrado e restaurado

| Entidade | Origem | Restore |
|---|---:|---:|
| Visitas | 3 | 3 |
| Memórias | 9 | 9 |
| ContextSnapshots | 2 | 2 |
| ActionPlans | 2 | 2 |
| Preparações versionadas | 2 | 2 |
| Transcripts | 1 | 1 |
| Reports | 1 | 1 |
| Interações | 1 | 1 |
| Commitments | 1 | 1 |
| Outcomes | 1 | 1 |
| LearningCandidates | 1 | 1 |
| Oportunidades | 1 | 1 |
| Eventos de lifecycle | 4 | 4 |

- fingerprint semântico do catálogo completo, origem e restore: `a9b4d6af5f78cb5737a2bae7e445434b69eb31875ce3c9eb8aa73b05ae2da8f3`;
- fingerprint dos dados materiais, origem e restore: `678da8fd0b0c0530cdcefb27bda83437767b0b33dd5c6eebe6f24d453247c69f`;
- backup: 238.118 bytes;
- SHA-256 do backup: `b8a94030ee70dcb831a1a4867ee1e342018bf188f0d715ec54673d13cc82a099`.

O `pg_dump` textual feito depois do restore reescreve alguns casts de arrays de `varchar` em uma forma textual equivalente. Os dumps brutos e o diff foram preservados. A equivalência não foi presumida: tabelas, colunas, nomes/tipos/estado de validação das constraints, definições normalizadas, índices, referências, contagens e dados foram comparados; os fingerprints semânticos são idênticos.

### Evidências de isolamento

- acesso ao report/contexto por tenant adversarial: bloqueado;
- acesso por ator fora da carteira: não encontrado;
- criação de report com `tenant_id` divergente: negada antes da leitura;
- vínculo direto de um evento do tenant B à visita do tenant A: rejeitado pelo PostgreSQL com `SQLSTATE 23503`;
- transcript, report, preparação, outcome e LearningCandidate mantiveram foreign keys tenant-safe;
- nenhuma referência restaurada mudou de tenant ou ID.

## Testes

### Resultado consolidado

| Execução | Resultado |
|---|---|
| Suíte completa | **499/499** |
| Testes específicos da Fase 6 | **41/41** |
| Casos obrigatórios 1–32 | **32/32** |
| Regressão MEX/VIS | **28/28** |
| Regressão agrupada Fases 1–5 | **124/124** |
| Smoke legado/Core v1 | APROVADO |
| Smoke Fase 5 | APROVADO |
| Smoke Fase 6 | APROVADO |

Os 458 testes anteriores permanecem aprovados; os 41 testes adicionados elevam o total para 499.

### Casos obrigatórios da Fase 6

| # | Caso | Status |
|---:|---|---|
| 1 | planejada → preparada | PASSOU |
| 2 | preparação versionada | PASSOU |
| 3 | texto → report candidato | PASSOU |
| 4 | áudio mock → transcript → report | PASSOU |
| 5 | report pendente não consolida memória | PASSOU |
| 6 | confirmação grava fatos | PASSOU |
| 7 | edição antes da confirmação | PASSOU |
| 8 | remoção de candidato | PASSOU |
| 9 | objeção rastreável | PASSOU |
| 10 | Commitment criado | PASSOU |
| 11 | data ambígua exige confirmação | PASSOU |
| 12 | próximo passo explícito | PASSOU |
| 13 | outcome `WON` | PASSOU |
| 14 | outcome `NO_DECISION` | PASSOU |
| 15 | outcome técnico | PASSOU |
| 16 | LearningCandidate criado | PASSOU |
| 17 | nenhuma promoção automática | PASSOU |
| 18 | sinal comportamental sem certeza | PASSOU |
| 19 | oportunidade secundária segura | PASSOU |
| 20 | report cross-tenant bloqueado | PASSOU |
| 21 | outcome cross-tenant bloqueado | PASSOU |
| 22 | learning cross-tenant bloqueado | PASSOU |
| 23 | safety agronômico preservado | PASSOU |
| 24 | APIs legadas preservadas | PASSOU |
| 25 | PrepareVisit v1 preservado | PASSOU |
| 26 | ActionPlan/Commitment preservados | PASSOU |
| 27 | visita 2 usa visita 1 | PASSOU |
| 28 | preparação 2 materialmente melhor | PASSOU |
| 29 | ausência de dados permanece lacuna | PASSOU |
| 30 | falha de transcrição degrada com segurança | PASSOU |
| 31 | áudio/transcrição não entram em logs | PASSOU |
| 32 | fluxo somente texto funciona | PASSOU |

## Builds

| Build | Resultado | Observação |
|---|---|---|
| Aplicação principal/Vite | APROVADO | 1.701 módulos transformados |
| PWA stamp | APROVADO | cache `valor360-vea82fdaa9a401505` |
| PWA verify | APROVADO | cache validado |
| Manual/Next.js | APROVADO | TypeScript, páginas estáticas e rotas concluídos |

Avisos não bloqueantes já existentes:

- Vite informa chunks superiores a 500 kB;
- Next.js informa múltiplos lockfiles ao inferir a raiz do workspace.

Nenhum desses avisos altera o resultado do build ou foi tratado com refatoração fora de escopo.

## Gate objetivo

| Critério | Evidência | Status |
|---:|---|---|
| 1 | visita preparada e preparação persistida/versionada | APROVADO |
| 2 | registro por texto | APROVADO |
| 3 | áudio abstrato, validado e testável por mock | APROVADO |
| 4 | candidatos só consolidam após confirmação humana | APROVADO |
| 5 | fatos confirmados entram na MMI | APROVADO |
| 6 | Commitment com owner, prazo e status | APROVADO |
| 7 | próximo passo ou `NO_ACTION` explícito | APROVADO |
| 8 | outcomes comerciais, técnicos e relacionais | APROVADO |
| 9 | LearningCandidate sem promoção automática | APROVADO |
| 10 | preparação 2 recupera a visita 1 | APROVADO |
| 11 | preparação 2 é materialmente melhor | APROVADO |
| 12 | cross-tenant bloqueado em código e banco | APROVADO |
| 13 | safety agronômico soberano | APROVADO |
| 14 | APIs legadas e envelopes anteriores compatíveis | APROVADO |
| 15 | suíte completa 499/499 | APROVADO |
| 16 | builds principal, PWA e Manual | APROVADO |

## Compatibilidade e limites preservados

- ValEngine não foi alterada;
- `sales-playbook` e prompts comerciais não foram alterados;
- Manual não foi alterado;
- RequestEnvelope/ResponseEnvelope v1 permanecem compatíveis;
- ContextSnapshot, BehavioralProfile, DecisionThesis, ValuePlan, ActionPlan, Commitment, InsightCard e PrepareVisit permanecem compatíveis;
- rotas legadas continuam ativas;
- `visits.status` permanece como campo legado e não foi reinterpretado;
- anexos existentes foram reutilizados; object storage não foi redesenhado;
- nenhuma prescrição, dose ou produto é inferido do relato de buva;
- MDP completo e aprendizado automático não foram implementados.

## Observabilidade

Os eventos registram, quando aplicável:

- `request_id`;
- `visit_id`;
- `visit_report_id`;
- `interaction_id`;
- `transcript_id`;
- `context_snapshot_id`;
- IDs de commitments, outcomes e LearningCandidates;
- status de confirmação;
- módulos chamados;
- latência e resultado.

O teste obrigatório comprovou que conteúdo do áudio, texto da transcrição e `sourceText` não aparecem na telemetria.

## Rollback disponível

Rollback operacional seguro:

1. não publicar a branch local;
2. desabilitar/reverter apenas as rotas e a UI da Fase 6;
3. manter as estruturas aditivas inertes, preservando os registros já criados;
4. retornar ao commit aprovado da Fase 5: `ea82fdaa9a401505e661be5409e21ae2d6a3112a`.

Rollback de dados:

- backup custom restaurável comprovado em outro PostgreSQL 16;
- catálogo, dados e referências restaurados com fingerprints idênticos.

Rollback físico da migration só é documentado para ambiente efêmero e exigiria exportação prévia. Ele não é recomendado em ambiente real porque destruiria dados da Fase 6. O rollback operacional mantém a compatibilidade e os dados.

## Riscos remanescentes

1. O provedor externo de transcrição ainda não foi integrado; o contrato e os mocks estão prontos, e o runtime falha com segurança.
2. A extração estruturada inicial é deliberadamente conservadora e depende da revisão humana.
3. Anexos continuam no mecanismo atual em PostgreSQL; object storage permanece dívida futura já conhecida.
4. Linhas legadas de visita ficam sem lifecycle v1 até uma transição explícita; não há backfill por inferência.
5. Checks novos sobre colunas legadas de `visits` permanecem `NOT VALID` para compatibilidade expand-only; novas escritas são verificadas.
6. O build principal mantém o aviso de tamanho de chunks; otimização não pertence a este gate.

## Evidências locais

Diretório canônico: `.gate/phase6-operational-20260823-7/`.

Principais artefatos:

- `source-verification.json`;
- `restore-catalog.json`;
- `source-runtime-verification.log`;
- `restore-runtime-verification.log`;
- `pre-migration-*` e `post-migration-*`;
- `phase6-migrated.dump` e `backup.sha256`;
- `full-test.tap`;
- `phase6-test.tap`;
- `phase5-mex-vis.tap`;
- `phase1-5-regression.tap`;
- `phase2-smoke.json`, `phase5-smoke.json`, `phase6-smoke.json`;
- `main-build.log`, `pwa-stamp.log`, `pwa-verify.log`, `manual-build.log`.

## Declaração final

**GATE FASE 6 APROVADO.**

O trabalho permanece somente local e sem commit. Aguardar autorização explícita para qualquer publicação. Não iniciar o Passo 07.
