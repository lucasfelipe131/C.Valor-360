# GATE FASE 3 — RESULTADO

Data: 2026-08-22
Fase: Passo 03 — MMI (Malha de Memória Inteligente) + MCTX (Motor de Contexto)
Base autorizada: `498ebf3f31fde404dd11fb7eca894e6c85b7169a`
Branch local: `phase3/memory-context`
Resultado final: **GATE FASE 3 APROVADO**

## 1. Parecer executivo

Os dois bloqueios formais do gate foram eliminados sem ampliar o escopo:

1. `ValRepository.saveTechnicalContext` passou a derivar o `subject_id` textual do mesmo UUID com conversão explícita, eliminando o SQLSTATE `42P08` sem alteração de schema ou contrato público.
2. O verificador da Fase 1 passou a reconhecer `gate-client-empty-a` somente no cenário controlado, explícito e *verify-only* da Fase 3. O fixture não foi removido, preenchido nem modificado, e registros vazios não autorizados continuam sendo rejeitados.

Depois das correções, o fluxo real foi repetido em PostgreSQL 16.15 efêmero:

- migration aplicada sem erro;
- duas versões de memória gravadas por `saveTechnicalContext`;
- supersessão comprovada;
- `ContextSnapshot v1` persistido como entidade de primeira classe;
- seleção, exclusão, freshness, stale data, conflitos e lacunas comprovados;
- isolamento cross-tenant comprovado;
- backup realizado e restaurado em outro cluster PostgreSQL 16 limpo;
- schema, dados, migrations, snapshots e referências permaneceram idênticos após o restore;
- suíte completa: **384/384**;
- testes MMI/MCTX: **28/28**;
- builds principal e Manual: aprovados;
- smokes legado e v1: aprovados.

Não houve acesso à Railway ou produção. Não houve commit, push, PR, merge ou deploy. O Passo 04 não foi iniciado.

## 2. Bloqueio 1 — `saveTechnicalContext`

### 2.1 Query anterior exata

```sql
INSERT INTO val_memories (
  id, tenant_id, client_id, subject_type, subject_id,
  memory_type, memory_state, memory_domain, key, value, evidence,
  status, source, source_ref, source_type, observed_at,
  source_updated_at, freshness_policy_version, freshness_metadata,
  valid_from, supersedes_id, created_by, acl, created_at, updated_at
)
VALUES (
  $1, $2, $3, 'client', $3::text,
  'fact', 'HYPOTHESIS', 'AGRONOMIC', 'consultant_technical_context', $4, $5,
  'proposed', 'consultant_input', $6, 'consultant_input', $7,
  $7, 'val.context.freshness.v1', $8,
  NOW(), $9, $10, $11, NOW(), NOW()
)
```

Argumentos enviados pelo código:

```js
[
  id,
  this.tenantId,
  client.rows[0].id,
  jsonbParameter(value),
  evidence,
  `consultant_input:${id}`,
  observedAt,
  freshnessMetadata,
  previous.rows[0]?.id || null,
  ownerId,
  acl
]
```

| Parâmetro | Semântica | Tipo esperado |
|---|---|---|
| `$1` | ID da nova memória | UUID |
| `$2` | Organização/tenant | UUID |
| `$3` | ID interno do produtor em `clients` | UUID |
| `$4` | Conteúdo técnico | JSONB |
| `$5` | Evidências | JSONB |
| `$6` | Referência de origem | texto |
| `$7` | Data observada/atualizada na origem | timestamptz |
| `$8` | Metadados de freshness | JSONB |
| `$9` | Memória anterior supersedida | UUID ou `NULL` |
| `$10` | Autor da memória | UUID |
| `$11` | ACL | JSONB |

`$3` representava o mesmo valor nas duas ocorrências: o UUID interno do produtor. Em `client_id`, ele participa da relação UUID; em `subject_id`, o mesmo identificador precisa de representação textual. Não havia erro de indexação nem dois valores semanticamente diferentes. A expressão `$3::text` fez o PostgreSQL inferir o mesmo parâmetro como `uuid` e `text`, produzindo SQLSTATE `42P08`.

### 2.2 Correção aplicada

A ocorrência textual passou a ser derivada explicitamente do UUID:

```sql
client_id = $3
subject_id = ($3::uuid)::text
```

O mesmo ajuste foi aplicado ao seed controlado do verificador da Fase 3, que reproduzia a mesma ambiguidade no harness de teste.

Consequências verificadas:

- nenhum parâmetro público foi adicionado ou removido;
- a ordem e a quantidade dos 11 argumentos permaneceram iguais;
- nenhuma coluna, constraint ou tabela foi alterada para contornar o erro;
- o writer PostgreSQL concluiu duas gravações consecutivas;
- o erro `42P08` não reapareceu;
- a segunda memória referencia a primeira por `supersedes_id`.

Teste de regressão específico:

```text
saveTechnicalContext mantém o parâmetro do produtor como UUID ao derivar subject_id textual
1 teste, 1 aprovado, 0 falhas
```

## 3. Bloqueio 2 — fixture `gate-client-empty-a`

### 3.1 Finalidade do fixture

`gate-client-empty-a` representa deliberadamente um produtor sem histórico material. Ele existe para comprovar que o MCTX:

- mantém uma lacuna como `missing_information`;
- não promove ausência a fato;
- não inventa contexto por plausibilidade linguística.

Preencher ou remover o fixture invalidaria precisamente o cenário que ele testa.

### 3.2 Regra incompatível

O verificador da Fase 1 exigia igualdade exata com:

```js
['gate-client-a']
```

Após o cenário da Fase 3, a lista correta no tenant A era:

```js
['gate-client-a', 'gate-client-empty-a']
```

O isolamento continuava íntegro; a regra antiga não distinguia um fixture controlado da Fase 3 de um registro adicional não autorizado. Portanto, o defeito estava no verificador, não no fixture.

### 3.3 Correção restrita do verificador

O fixture adicional somente é aceito quando todas as condições abaixo são verdadeiras:

- `GATE_VERIFY_ONLY=true`;
- `GATE_ALLOW_PHASE3_EMPTY_FIXTURE=true`;
- chave exata `gate-client-empty-a`;
- tenant, consultor, nome, status e origem exatos;
- `source='phase3_gate'`;
- exatamente uma linha correspondente;
- `material_rows=0` em perfis, propriedades, visitas, interações, oportunidades, relatórios, solo, NDVI, memórias e recomendações;
- conjunto final de clientes ainda comparado por igualdade estrita.

A flag foi adicionada somente à etapa de verificação após restore do workflow controlado. Sem a flag explícita, o mesmo fixture continua falhando fechado.

Testes do verificador:

| Cenário | Resultado |
|---|---|
| Fixture exato, vazio e explicitamente autorizado | APROVADO |
| Fixture sem flag explícita | REJEITADO como esperado |
| Fixture com origem incorreta | REJEITADO como esperado |
| Fixture com histórico material | REJEITADO como esperado |
| Outro cliente vazio, mesmo com flag | REJEITADO como esperado |
| Conjunto de testes Phase 1 gate | **10/10 aprovados** |

## 4. PostgreSQL 16 controlado

| Item | Banco-fonte | Banco restaurado |
|---|---|---|
| Engine | PostgreSQL 16.15 (`server_version_num=160015`) | PostgreSQL 16.15 |
| Banco | `val_staging_gate03_fixed2` | `val_restore_gate03_fixed2` |
| Porta local | 55451 | 55452 |
| Cluster/data directory | exclusivo | exclusivo e limpo |
| Dados | somente sintéticos | restore dos mesmos dados sintéticos |
| Drift final | zero | zero |

As duas instâncias ficaram restritas a `127.0.0.1` e foram encerradas graciosamente ao final. Nenhum recurso externo, Railway, staging compartilhado ou produção foi utilizado.

### 4.1 Migration

Migration: `database/migrations/20260820_002_memory_context_expand.sql`
SHA-256: `a09c996cfdb193ad209c52d658f9965ea8381f4bea7ec2dc93764d42d1759443`
Tempo da repetição final: 56 ms.

A migration não foi modificada pelas correções. A prova estrutural anterior e a repetição final demonstram:

- estratégia exclusivamente expand;
- 43 para 44 tabelas;
- 557 para 589 colunas;
- 199 para 213 constraints;
- 95 para 107 índices;
- nenhuma tabela, coluna ou índice histórico removido;
- IDs e valores legados preservados;
- novos campos da memória legada permanecendo `NULL`;
- nenhuma reclassificação automática de `memory_state` ou `memory_domain`;
- recomendação legada permanecendo compatível com referências de snapshot nulas;
- `val_context_snapshots` criada conforme especificação;
- checksum da migration imutável;
- drift zero na fonte e no banco restaurado.

## 5. Evidência MMI/MCTX pelo writer real

O verificador final não usou seed direto para substituir o writer. `saveTechnicalContext` criou as duas versões materiais e o restante do fluxo consumiu essas memórias.

| Prova | Resultado |
|---|---|
| Linhas da supersessão | 2 |
| Nova memória referencia a anterior | SIM |
| ContextSnapshot versionado | `val.context_snapshot.v1` |
| Snapshot como entidade de primeira classe | COMPROVADO |
| `selected_refs` | 3 referências persistidas |
| `excluded_refs` | 2 referências persistidas |
| `exclusion_reason_codes` | Persistidos e revalidados |
| Freshness versionada | COMPROVADA |
| Stale data | COMPROVADO |
| Conflito | COMPROVADO |
| `missing_information` | COMPROVADO |
| Recomendação ligada ao snapshot | COMPROVADA |

IDs sintéticos da prova:

- recommendation: `630328d0-6e64-47e0-8599-d324c141f6a4`;
- ContextSnapshot: `c6508a9e-5fdf-504d-ae4f-77a4fd740f45`.

Os mesmos IDs, referências e invariantes foram encontrados após o restore.

## 6. Isolamento e testes negativos cross-tenant

| Invariante | Fonte | Restore |
|---|---|---|
| Tenant A não recupera memória do tenant B | PASSOU | PASSOU |
| Tenant B não recupera memória do tenant A | PASSOU | PASSOU |
| Override de `organization_id` | NEGADO | NEGADO |
| Produtor de tenant estrangeiro | NEGADO | NEGADO |
| Ator incorreto dentro do tenant | 0 clientes | 0 clientes |
| Sessão assinada do tenant B no tenant A | REJEITADA | REJEITADA |
| Registro Manual cross-tenant | 0 linhas | 0 linhas |
| Snapshot do tenant A consultado pelo tenant B | 0 linhas | 0 linhas |
| Referência cross-tenant por FK composta | REJEITADA | REJEITADA |

Antes do fixture da Fase 3, o tenant A via somente `gate-client-a` e o tenant B somente `gate-client-b`. Depois do fixture explicitamente autorizado, o tenant A via exatamente `gate-client-a` e `gate-client-empty-a`; o tenant B continuou vendo somente `gate-client-b`.

## 7. Backup, restore e rollback

Backup lógico comprovado:

- arquivo: `.backups/staging/valor360-staging-2026-08-22T16-26-03-963Z.dump`;
- formato: custom dump do PostgreSQL;
- tamanho: 166.894 bytes;
- SHA-256: `16f87f3d20a64c44b0c99f0ee61de581fba312e2373f2dcd65de0b3f8f6bbc05`.

Restore em outro PostgreSQL 16 limpo:

- duração no dataset sintético: 664 ms;
- 44 tabelas;
- health query aprovada;
- contagens, ledger de migrations e linhas sintéticas idênticos;
- schema SHA-256: `aa9e06a5d705a4a61c07a082302d6ee9d84aa820a5c2be401eb7741684d2ea8e`;
- dados SHA-256: `fd14952322ba9ba077bd37cb346f438d147bd4b8e74e30ea0c3cdf4560252a1d`;
- snapshots, referências, constraints e isolamento revalidados.

RPO/RTO desta prova controlada:

- RPO: 0 no instante do snapshot lógico consistente;
- RTO medido: 664 ms para o dataset sintético;
- estes números não constituem SLA de produção.

Rollback disponível:

1. restaurar o dump comprovado em uma instância PostgreSQL 16 limpa;
2. validar checksum, schema, migrations e contagens;
3. reexecutar os verificadores de isolamento e MMI/MCTX;
4. manter as estruturas expand-only inertes se a aplicação retornar ao commit-base;
5. não executar `DROP` ou migration contract nesta fase.

## 8. Testes, builds e smokes finais

| Validação | Resultado |
|---|---|
| Regressão específica de `saveTechnicalContext` | **1/1** |
| Verificador/fixtures da Fase 1 | **10/10** |
| MMI/MCTX (`test/phase3-*.test.js`) | **28/28** |
| Suíte completa (`node --test`, comando efetivo de `npm test`) | **384/384**, 0 falhas, 0 ignorados |
| Build principal — Vite + stamp/verify PWA | PASSOU; 1.701 módulos |
| Build Manual — Next.js + TypeScript | PASSOU |
| Smoke legado | HTTP 200; `requestId`; `engineMode=rules` |
| Smoke `POST /api/v1/val/recommendations` | HTTP 200; `val.response.v1`; `prepare_visit.v1` |
| Ordem de composição existente | `conversion → innovation` preservada |
| `git diff --check` | PASSOU |
| `node --check` nos arquivos alterados | PASSOU |

Warnings não bloqueantes e preexistentes:

- chunk Vite acima de 500 kB;
- Next.js detecta dois lockfiles.

## 9. Arquivos da correção restrita

- `server/repository.js`;
- `test/repository-jsonb.test.js`;
- `scripts/phase3-staging-verify.mjs`;
- `test/phase3-database-gate-contract.test.js`;
- `scripts/phase1-staging-verify.mjs`;
- `scripts/lib/phase1-gate-fixtures.mjs`;
- `test/phase1-gate-fixtures.test.js`;
- `test/phase1-gate-staging.test.js`;
- `.github/workflows/validate.yml` — somente preparação local da etapa controlada de restore;
- este relatório e o manifesto local de evidências.

Não foram alterados para esta correção:

- schema canônico ou migration 002;
- autenticação e contratos públicos;
- prompts;
- front-end;
- Manual;
- produção;
- histórico de migrations;
- IDs ou dados reais.

## 10. Integridade do repositório e restrições

| Restrição | Resultado |
|---|---|
| Branch local | `phase3/memory-context` |
| HEAD | `498ebf3f31fde404dd11fb7eca894e6c85b7169a` — inalterado |
| Ref local `main` | `f405617405fb66811207fdf006c2fbdaebfb8c9d` — inalterada |
| Commit | NÃO REALIZADO |
| Push | NÃO REALIZADO |
| PR | NÃO ABERTO |
| Merge | NÃO REALIZADO |
| Deploy | NÃO REALIZADO |
| Railway | NÃO ACESSADA |
| Produção | NÃO ACESSADA |
| Passo 04 | NÃO INICIADO |

## 11. Riscos remanescentes

Não há bloqueio remanescente para o Gate da Fase 3. Permanecem riscos operacionais não bloqueantes:

- a prova usou dados sintéticos e não mede locks, volume ou desempenho de uma base representativa;
- RPO/RTO medidos não são SLA de staging ou produção;
- a exceção do fixture depende de flags explícitas e deve permanecer restrita ao restore controlado;
- os warnings de tamanho de bundle e múltiplos lockfiles devem ser tratados em fase própria, sem ampliar este gate.

## 12. Evidências

Evidências finais:

- `.gate/phase3-fixed2-gate-closure-manifest.json`;
- `.gate/phase3-fixed2-migration-apply.json`;
- `.gate/phase3-fixed2-drift-source.json`;
- `.gate/phase3-fixed2-phase1-source.json`;
- `.gate/phase3-fixed2-memory-context-source.json`;
- `.gate/phase3-fixed2-phase1-after-phase3.json`;
- `.gate/phase3-fixed2-restore.json`;
- `.gate/phase3-fixed2-restore-compare.json`;
- `.gate/phase3-fixed2-drift-restored.json`;
- `.gate/phase3-fixed2-phase1-restored.json`;
- `.gate/phase3-fixed2-memory-context-restored.json`;
- `.backups/staging/valor360-staging-2026-08-22T16-26-03-963Z.dump`.

As evidências `phase3-v2-*` permanecem como histórico da reprodução dos bloqueios anteriores; as evidências `phase3-fixed2-*` são a prova definitiva após a correção.

## 13. Critérios do gate

| Critério | Status |
|---|---|
| SQLSTATE `42P08` eliminado no writer real | APROVADO |
| Teste de regressão específico | APROVADO |
| Fixture vazio válido preservado | APROVADO |
| Registros vazios não autorizados continuam detectados | APROVADO |
| Migration PostgreSQL 16 executa sem erro | APROVADO |
| Migration expand-only e legado preservado | APROVADO |
| `val_context_snapshots` como entidade de primeira classe | APROVADO |
| Supersessão corrigível e auditável | APROVADO |
| Freshness versionada | APROVADO |
| Stale data, conflito e lacuna | APROVADO |
| Auditoria de seleção sem conteúdo sensível | APROVADO |
| Nenhuma memória cross-tenant recuperável | APROVADO |
| APIs legadas e envelopes v1 compatíveis | APROVADO |
| Suíte completa, builds e smokes | APROVADO |
| Backup, restore e rollback comprovados | APROVADO |
| Todas as evidências anteriores permanecem válidas | APROVADO |

## 14. Conclusão final

# GATE FASE 3 APROVADO

Toda recomendação consegue apontar para contexto autorizado, rastreável e corrigível. Os dois bloqueios foram removidos, a persistência foi comprovada pelo writer real e o ciclo migration → backup → restore → revalidação foi concluído em PostgreSQL 16 isolado.

O trabalho para neste gate. O Passo 04 não foi iniciado e depende de nova autorização explícita.
