# Validate em Pull Requests empilhados

## Decisão

O workflow `Validate` deve executar para todo evento suportado de `pull_request`, independentemente da branch-base. O filtro de `push` continua limitado à `main`.

```yaml
on:
  pull_request: {}
  push:
    branches: [main]
```

## Causa raiz

O filtro anterior aceitava somente PRs direcionados a `main` ou `phase2/core-contracts`. Como `pull_request.branches` é avaliado contra a branch-base, PRs empilhados direcionados a `phase3/memory-context` ou futuras branches `phaseN/*` não criavam execução do workflow.

Não havia condição adicional por `github.base_ref`, `github.head_ref` ou `github.ref` nos jobs.

## Compatibilidade

| Evento | Resultado |
|---|---|
| PR para `main` | executa `Validate` |
| PR para `phase2/core-contracts` | executa `Validate` |
| PR para `phase3/memory-context` | executa `Validate` |
| PR para futura `phaseN/*` | executa `Validate` |
| push em `main` | executa `Validate` |
| push em outra branch | não executa `Validate` |

## Segurança

- `permissions: contents: read` permanece inalterado.
- Nenhum secret, environment ou permissão adicional foi introduzido.
- O evento continua sendo `pull_request`, não `pull_request_target`.
- Pull Requests de forks não recebem secrets do repositório; o workflow também não referencia secrets.
- Todos os jobs, testes, builds, verificações de isolamento, contratos e gates existentes permanecem inalterados.
- A proteção da `main` e seus checks obrigatórios não são modificados por este arquivo.

## Rollback

Repor o filtro anterior em `pull_request.branches` restaura o comportamento prévio. O rollback não envolve aplicação, banco, dados, deploy ou produção.
