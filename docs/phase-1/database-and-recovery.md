# Banco, drift, backup e restore

## Inventário

`database/schema.sql` permanece intacto e representa o baseline histórico do commit auditado. Ele declara 39 tabelas e quatro versões embutidas de migração legada. Novas alterações são arquivos ordenados em `database/migrations/`.

Comandos:

```bash
npm run db:inventory
DRIFT_DATABASE_URL='<staging>' npm run db:drift
```

O drift compara tabelas, colunas e índices explícitos do schema `public` contra a união do baseline e das migrations versionadas. Item esperado ausente falha sempre; itens inesperados são relatados e falham com `--strict`.

## Expand/contract

1. **Expand:** adicionar estrutura compatível, defaults transitórios, backfill idempotente e índices.
2. **Dual read/write:** publicar código que usa a estrutura nova sem remover a antiga.
3. **Observar:** medir erros, nulidade, latência, locks e drift.
4. **Validate:** validar constraints em janela controlada.
5. **Contract:** remover compatibilidade somente em migration posterior, com aprovação própria.

Cada migration recebe SHA-256 no primeiro apply. Alterar um arquivo já aplicado interrompe o deploy. O runner usa lock transacional e mantém a execução idempotente.

## Backup inicial

- Fonte: somente staging.
- Formato: `pg_dump` custom, sem owner e ACL.
- Integridade: SHA-256 e metadados lado a lado.
- RPO inicial: 24 horas.
- RTO inicial: 4 horas.
- Retenção inicial proposta: 14 backups diários e quatro semanais, sujeita à política corporativa de dados.

```bash
STAGING_DATABASE_URL='<staging>' npm run db:backup
```

## Restore controlado

O alvo deve ser outro banco, descartável e com nome contendo `restore`, `sandbox` ou `test`. O comando se recusa a usar `DATABASE_URL` ou a própria origem.

```bash
RESTORE_DATABASE_URL='<val_phase1_restore>' \
BACKUP_FILE='.backups/staging/valor360-staging-....dump' \
CONFIRM_CONTROLLED_RESTORE=RESTORE_ONLY \
npm run db:restore:verify
```

A prova registra duração, banco alvo, hash do backup, health query e contagens de sete tabelas críticas. O arquivo de evidência deve ser anexado ao PR sem credenciais nem conteúdo de produtores.

## Rollback de migration

A migration atual é expand-only. Em incidente, voltar o código e manter as colunas; não executar `DROP`. Restore completo é mecanismo de desastre, não ferramenta rotineira para desfazer DDL aditivo.
