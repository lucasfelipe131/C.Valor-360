# GATE DA FASE 1 — RESULTADO

**Data da comprovação:** 20 de agosto de 2026  
**Baseline auditado:** `f405617405fb66811207fdf006c2fbdaebfb8c9d`  
**Branch:** `phase1/foundation`  
**Pull Request:** [#78 — Fundação segura da Fase 1](https://github.com/lucasfelipe131/C.Valor-360/pull/78)  
**Execução canônica de evidência:** [Validate #162](https://github.com/lucasfelipe131/C.Valor-360/actions/runs/32395960129), commit `b4e390822106f900e94bf7364e60dea0d90de469`

## Conclusão executiva

O gate definido para o Passo 01 foi comprovado em ambiente controlado, sem conexão com produção e usando apenas dados sintéticos. A `main` permanece no commit auditado, o PR está aberto como rascunho, nenhum merge ou deploy foi feito e o Passo 02 não foi iniciado.

> **CONCLUSÃO FINAL: GATE APROVADO.**

Esta aprovação cobre a fundação de migração segura. Ela não habilita uma segunda organização, não autoriza produção e não elimina os riscos residuais registrados neste documento.

## Status dos requisitos

| Requisito | Status | Evidência objetiva |
|---|---:|---|
| Branch `phase1/foundation` publicada | ✅ Comprovado | PR #78 aponta para a branch publicada |
| Pull Request sem merge automático | ✅ Comprovado | PR #78 aberto, `draft: true`, `merged: false` |
| `main` protegida por PR | ✅ Comprovado | regra clássica exige PR e uma aprovação |
| Push direto e bypass impedidos | ✅ Comprovado | enforcement `everyone`; proteção também se aplica a administradores |
| Checks obrigatórios | ✅ Comprovado | `npm test`, `npm run build`, `manual npm run build` e `phase1 gate staging` |
| Branch atualizada e conversas resolvidas | ✅ Comprovado | ambas as opções estão habilitadas na regra |
| Force-push e exclusão da `main` | ✅ Bloqueados | permissões continuam desabilitadas |
| Baseline de comportamento preservado | ✅ Comprovado | 314/314 antes; 331/331 no estado final; builds verdes |
| Bootstraps atuais caracterizados | ✅ Comprovado | seis instalações por prototype cobertas sem alterar os bootstraps |
| Migrations e drift verificados | ✅ Comprovado | migration expand aplicada; drift estrito igual a zero |
| Isolamento negativo entre tenants | ✅ Comprovado | testes reais em PostgreSQL na origem e novamente após restore |
| Backup íntegro | ✅ Comprovado | dump custom com 139.089 bytes e SHA-256 verificado |
| Restore e rollback | ✅ Comprovado | restore em banco diferente; 43 tabelas e hashes comparados |
| Produção preservada | ✅ Comprovado | `main` não mudou; nenhuma URL, credencial, dado ou serviço de produção foi usado |
| Passo 02 não iniciado | ✅ Comprovado | composição explícita permanece apenas como desenho futuro |

## Proteção da `main` e PR

A regra foi salva no GitHub e confirmada pela API de branch:

- `protected: true`;
- `required_status_checks.enforcement_level: everyone`;
- checks obrigatórios vinculados ao GitHub Actions:
  - `npm test`;
  - `npm run build`;
  - `manual npm run build`;
  - `phase1 gate staging`;
- pull request obrigatório;
- uma aprovação obrigatória;
- aprovações antigas dispensadas após novos commits;
- revisão de Code Owners habilitada;
- branch atualizada antes do merge;
- resolução de conversas obrigatória;
- bypass administrativo, force-push e exclusão desabilitados.

O SHA da `main` permaneceu `f405617405fb66811207fdf006c2fbdaebfb8c9d`. Não foi realizado um push destrutivo de prova: a configuração salva e o enforcement retornado pela API são a evidência, sem arriscar a branch protegida.

O PR #78 permanece em rascunho e bloqueado para merge pelos controles configurados. Não há auto-merge.

## Testes executados

### Baseline

| Momento | Resultado |
|---|---|
| Commit auditado, antes da Fase 1 | 314 testes passaram; 0 falharam |
| Estado final local | 331 testes passaram; 0 falharam; 0 ignorados |
| CI canônico, job `npm test` | 331 passaram; 0 falharam; 0 ignorados; 2.521 ms |
| CI canônico, `npm run build` | passou |
| CI canônico, `manual npm run build` | passou |
| CI canônico, `phase1 gate staging` | passou integralmente |

Os 17 testes da Fase 1 cobrem caracterização da engine, migrations, observabilidade, isolamento e o gate de staging. Permanecem apenas dois avisos preexistentes e não bloqueantes: chunk Vite acima de 500 kB e detecção de múltiplos lockfiles pelo Next.js.

As execuções [#159](https://github.com/lucasfelipe131/C.Valor-360/actions/runs/32395284270) e [#160](https://github.com/lucasfelipe131/C.Valor-360/actions/runs/32395583784) localizaram, respectivamente, a passagem incorreta da conexão ao `pg_dump` e a ausência de `--dbname` no `pg_restore`. Os scripts foram corrigidos sem afrouxar controles. A execução [#161](https://github.com/lucasfelipe131/C.Valor-360/actions/runs/32395743511) passou tecnicamente; a #162 repetiu tudo e preservou os dez arquivos de evidência no artefato.

## Caracterização da composição atual

Os bootstraps não foram alterados nem removidos. Os testes provam esta ordem atual:

| Ordem | Arquivo | Classe | Método instalado |
|---:|---|---|---|
| 1 | `conversion-bootstrap.js` | `ValRepository` | `getClientContext` |
| 2 | `conversion-bootstrap.js` | `ValRepository` | `getIntelligence` |
| 3 | `conversion-bootstrap.js` | `ValRepository` | `recordRecommendation` |
| 4 | `conversion-bootstrap.js` | `ValEngine` | `answer` |
| 5 | `conversion-bootstrap.js` | `ValEngine` | `status` |
| 6 | `innovation-bootstrap.js` | `ValRepository` | `getClientContext` novamente |

Também ficaram congelados por caracterização: `conversionFoundation`, `conversionInnovations`, fallback determinístico, `decisionCore=val-conversion-core-v1`, persistência da recomendação e status da engine. A futura factory `composeValCore(...)` é apenas proposta para o Passo 02.

## Banco, migrations e drift

- `database/schema.sql` permaneceu intacto como baseline histórico.
- Nenhuma migration histórica foi apagada, alterada ou reescrita.
- A única migration nova é `20260820_001_manual_tenant_scope_expand`.
- A migration é exclusivamente **expand**: adiciona escopo `tenant_id`, índices e constraints `NOT VALID`; não contém `DROP`, rename, troca de PK, exclusão de dado ou `SET NOT NULL`.
- Checksum registrado: `065e0af576e96d7cf38ed35f80456e145918808f18d876b328fd1a89c46b41fb`.
- O runner usa lock, ordem determinística e falha se uma migration aplicada mudar de checksum.
- Drift estrito após o apply:
  - tabelas ausentes: 0;
  - colunas ausentes: 0;
  - índices ausentes: 0;
  - tabelas inesperadas: 0;
  - colunas inesperadas: 0;
  - índices inesperados: 0.

A estratégia daqui para frente é `expand → dual read/write → observar → validate → contract`, sempre em migrations posteriores e independentes.

## Evidências de isolamento entre tenants

O job criou PostgreSQL 16 efêmero com duas organizações e registros exclusivamente sintéticos. A origem `val_staging` demonstrou:

| Prova negativa | Resultado |
|---|---:|
| Tenant A vê apenas `gate-client-a` | ✅ |
| Tenant B vê apenas `gate-client-b` | ✅ |
| Outro owner no mesmo tenant vê clientes | 0 |
| Tentativa de sobrescrever o tenant do repositório | negada |
| Consulta de overview a cliente de outro tenant | negada |
| Query do Manual atravessando tenant | 0 linhas |
| Sessão assinada para tenant estrangeiro | rejeitada |

As mesmas sete provas foram repetidas, com o mesmo resultado, no banco restaurado `val_restore`. Nenhuma segunda organização foi habilitada no produto; a segunda organização existiu somente dentro do teste efêmero.

## Backup, restore e rollback

Artefato: [phase1-gate-evidence-32395960129](https://github.com/lucasfelipe131/C.Valor-360/actions/runs/32395960129/artifacts/9416642461), retenção de sete dias.

| Medida | Resultado |
|---|---|
| Formato | `pg_dump` custom, sem owner e ACL |
| Origem controlada | `val_staging` |
| Destino descartável e diferente | `val_restore` |
| Tamanho | 139.089 bytes |
| SHA-256 do backup | `79393c4f004f2b407aa795be780dde3397e3a19b31f69b7d9bf1716e4280e72b` |
| Duração medida do restore | 421 ms |
| Health query após restore | passou |
| Tabelas comparadas | 43 |
| Contagens fonte × restore | idênticas |
| Migrations fonte × restore | idênticas |
| Linhas sintéticas fonte × restore | idênticas |
| SHA-256 do schema | `ed8891c94c05b1a5605e93cf8c775ee956a6880e8e8f963207c0ae590adfb319` |
| SHA-256 dos dados comparados | `7a2a705ea1614539f9828e9f3735e5bba8e919af2038b49e5b499008381da358` |

**RPO inicial operacional:** até 24 horas, reduzido a zero no instante de um backup obrigatório pré-migration.  
**RTO inicial operacional:** até 4 horas.  
**Medição do ensaio:** restore em 421 ms para o conjunto sintético; esse número prova o procedimento, mas não estima o tempo de uma base com volume real.

Rollback disponível:

1. antes do merge/deploy, fechar o PR e retirar a branch;
2. após eventual merge, reverter o código sem remover colunas ou dados da migration expand;
3. manter a estrutura aditiva em incidente e restaurar somente por runbook aprovado;
4. usar dump e SHA-256 para restaurar em banco separado antes de qualquer promoção de tráfego.

## Observabilidade

A fundação introduz e caracteriza um `request_id` UUID propagado por `X-Request-Id` entre API, contexto assíncrono, ValEngine, queries e integração com o Manual. Os eventos cobertos são `api.received/completed`, `val.answer.started/completed`, `db.query` e `integration.sent/received`.

SQL, parâmetros, cookies, tokens, prompts, anexos e payloads não entram no log. Tenant e ator são pseudonimizados por hash curto. O teste local de `/live` preservou um UUID fornecido, retornou HTTP 200 e correlacionou início e fim da requisição.

## Escopo efetivamente alterado

- CI, `CODEOWNERS`, template e política de PR;
- runner e inventário de migrations versionadas;
- uma migration expand para escopo de tenant no Manual;
- guards tenant-aware em entradas existentes e filtros críticos do Manual;
- observabilidade por correlation/request ID;
- scripts fail-closed de drift, backup, restore e comparação;
- testes de caracterização e documentação operacional.

Não foram alterados:

- `server/val-engine.js`;
- `server/conversion-bootstrap.js` e `server/innovation-bootstrap.js`;
- prompts, metodologia e barreiras agronômicas;
- componentes React, identidade visual ou navegação;
- `database/schema.sql` e migrations históricas;
- IDs ou dados existentes;
- produção ou o SHA da `main`.

## Riscos remanescentes

| Risco | Tratamento obrigatório |
|---|---|
| Railway não permitiu criar staging persistente por indisponibilidade upstream | repetir o ensaio em staging persistente antes de qualquer deploy; o gate atual usou PostgreSQL efêmero controlado |
| Isolamento ainda é aplicação + SQL, sem RLS | manter a segunda organização desabilitada; ADR e rollout de RLS continuam pendentes |
| Constraints novas estão `NOT VALID` | validar somente após medição de locks e qualidade em staging persistente |
| Ensaio contém somente dados sintéticos | executar benchmark com volume representativo, anonimizado ou gerado, antes de produção |
| `CODEOWNERS` ainda não existe na base `main` enquanto o PR não for mergeado | o PR já exige uma aprovação; a revisão de Code Owner passa a operar sobre o arquivo após merge autorizado |
| Artefato do CI retido por sete dias | adotar retenção operacional de 14 diários + 4 semanais no staging persistente |
| Composição por prototype permanece | manter congelada pelos testes; a remoção pertence exclusivamente ao Passo 02 |

## Decisão do gate

Todos os critérios objetivos foram comprovados:

**“Isolamento entre tenants e restauração comprovados em ambiente controlado, baseline de comportamento preservado e `main` protegida.”**

**GATE APROVADO.** Recomenda-se planejar o Passo 02 somente após autorização explícita. Este relatório não inicia nem autoriza o Passo 02.
