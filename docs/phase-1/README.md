# Passo 01 — Fundação de migração segura

Status deste diretório: implementação local sobre o commit auditado `f405617405fb66811207fdf006c2fbdaebfb8c9d`. Nenhuma mudança foi aplicada à produção, ao GitHub remoto ou a um banco externo.

## Objetivo e limite

Esta fase cerca o sistema existente com controles de mudança, caracterização, tenancy defensiva, migrations versionadas, recuperação verificável e rastreabilidade. Autenticação, PostgreSQL, `ValEngine`, APIs e front-end continuam sendo os componentes existentes.

O Passo 02 não faz parte deste trabalho.

## Arquivos alterados

| Grupo | Arquivos |
|---|---|
| Proteção | `.github/workflows/validate.yml`, `.github/CODEOWNERS`, `.github/pull_request_template.md`, `scripts/verify-github-protection.mjs` |
| Baseline e testes | `test/phase1-*.test.js` e três expectativas preexistentes atualizadas para o novo filtro de tenant |
| Banco | `server/migrate.js`, `server/migration-runner.js`, `database/migrations/20260820_001_manual_tenant_scope_expand.sql`, `scripts/db-*.mjs` |
| MSP | `server/tenant-scope.js`, pontos de entrada tenant-aware em `server/repository.js`, identidade e dados críticos do Manual |
| Observabilidade | `server/observability.js`, `server/db.js`, `server.js`, `server/technical-workspace.js` e propagação do ID no webhook do Manual |
| Operação | `package.json`, `.gitignore`, documentos deste diretório |

## Arquivos deliberadamente não alterados

- `database/schema.sql`: mantido como baseline histórico auditado; não foi reescrito.
- `server/conversion-bootstrap.js` e `server/innovation-bootstrap.js`: os patches continuam ativos e na mesma ordem.
- `server/val-engine.js`, prompts, metodologia, motores determinísticos e regras de segurança agronômica.
- autenticação principal, contratos públicos de API, componentes React, identidade visual e navegação.
- dados, IDs, tabelas legadas, lógica de arquivamento e separação do SOG.
- configurações remotas de GitHub, Railway, staging e produção.

## Migration prevista e implementada

`20260820_001_manual_tenant_scope_expand` é exclusivamente **EXPAND**:

- cria, quando ausentes, as tabelas paralelas do acesso do Manual;
- adiciona `tenant_id` às tabelas críticas do Manual;
- preenche linhas legadas com o tenant único do piloto;
- adiciona FKs e checks como `NOT VALID`, além de índices tenant-aware;
- não contém `DROP`, renome, exclusão, troca de PK ou `SET NOT NULL`.

A fase CONTRACT não está autorizada nem implementada. Ela só poderá validar constraints, remover o default piloto e endurecer nulabilidade depois de telemetria e restore aprovados.

## Rollback

- Código: reverter o conjunto do Passo 01 antes de qualquer deploy; não há alteração remota neste estado local.
- Migration expand já aplicada: manter colunas e índices aditivos e desativar os novos readers/writers por rollback de código. Não apagar colunas em incidente.
- Falha de dados: restaurar o backup em banco descartável, comparar contagens e só então executar procedimento aprovado para o ambiente afetado.
- Prompts, modelo e regras comerciais não mudaram; não existe rollback de comportamento de IA nesta fase.

## Riscos residuais

| Risco | Estado |
|---|---|
| `main` sem proteção remota, confirmado pela API do GitHub | Bloqueia o gate até configuração e verificação no GitHub |
| Railway possui somente `production` para o projeto VAL; não há staging | Bloqueia restore seguro; produção permaneceu intocada |
| RLS ainda não habilitado | Segunda organização continua bloqueada; a proteção atual é sessão + guard + SQL tenant-aware |
| Admin/telemetria do Manual nasceu como identidade global | Não habilitar segunda organização até o contrato de identidade organizacional ser fechado |
| Composição por prototype | Congelada por caracterização; remoção pertence ao Passo 02 |
| Migration expand em tabela com volume desconhecido | Medir locks e tempo em staging antes de qualquer deploy |

## Gate objetivo

| Critério | Evidência exigida | Estado local |
|---|---|---|
| Baseline preservado | testes pré e pós, builds principal e Manual | Implementado; revalidar no CI remoto |
| Negativas cross-tenant | sessão, guard, repositório e Manual | Implementado em testes |
| Schema sem drift impeditivo | `npm run db:drift` após migration em staging | Pendente de banco controlado |
| Backup íntegro | dump custom + SHA-256 | Pendente de staging |
| Restore comprovado | restore descartável, health query e contagens | Pendente de alvo controlado |
| `main` protegida | PR, CODEOWNER, checks, sem force-push/delete | Pendente de configuração remota |

O gate só pode ser declarado aprovado quando **todos** os itens estiverem verdes. Até lá, o status correto é: **Passo 01 implementado localmente; gate não concluído**.
