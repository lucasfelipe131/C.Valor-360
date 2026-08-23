# Marco de Integração 01 — Auditoria da cadeia

**Data:** 2026-08-23  
**Repositório:** `lucasfelipe131/C.Valor-360`  
**Branch de integração:** `integration/val-v1-staging`  
**Escopo:** Passos 02–06, sem `main`, produção ou Passo 07

## Mapa real aprovado

| Marco | Branch | HEAD remoto auditado | PR DRAFT | Base do PR |
| --- | --- | --- | --- | --- |
| Produção lógica de referência | `main` | `f405617405fb66811207fdf006c2fbdaebfb8c9d` | — | — |
| Passo 02 | `phase2/core-contracts` | `498ebf3f31fde404dd11fb7eca894e6c85b7169a` | #79 | `main` |
| Passo 03 | `phase3/memory-context` | `172ca81214d2364d38b8fd0a144af492cd543566` | #80 | `phase2/core-contracts` |
| Passo 04 | `phase4/behavior-decision-value` | `b4eaeebecdc2e1f97be7dbf20c87d985dc84f6ec` | #81 | `phase3/memory-context` |
| Passo 05 | `phase5/execution-insight` | `ea82fdaa9a401505e661be5409e21ae2d6a3112a` | #83 | `phase4/behavior-decision-value` |
| Passo 06 | `phase6/visit-learning-loop` | `7c0a8e7f6edbf581b893dc17eae43528e464b6f0` | #84 | `phase5/execution-insight` |

```text
main@f405617405fb66811207fdf006c2fbdaebfb8c9d
  -> phase2/core-contracts@498ebf3f31fde404dd11fb7eca894e6c85b7169a
  -> phase3/memory-context@172ca81214d2364d38b8fd0a144af492cd543566
  -> phase4/behavior-decision-value@b4eaeebecdc2e1f97be7dbf20c87d985dc84f6ec
  -> phase5/execution-insight@ea82fdaa9a401505e661be5409e21ae2d6a3112a
  -> phase6/visit-learning-loop@7c0a8e7f6edbf581b893dc17eae43528e464b6f0
```

## Ancestry e deltas

| Relação | Resultado | Commits exclusivos à direita |
| --- | --- | ---: |
| `main -> phase2` | ancestral integral | 7 |
| `phase2 -> phase3` | ancestral integral | 4 |
| `phase3 -> phase4` | ancestral integral | 2 |
| `phase4 -> phase5` | ancestral integral | 2 |
| `phase5 -> phase6` | ancestral integral | 1 |

O Passo 02 contém também o baseline aprovado do Passo 01, como exigido pela cadeia empilhada. Isso explica os seis commits de fundação anteriores ao commit de conteúdo do Passo 02 e não caracteriza duplicação.

## Merges já incorporados

1. `172ca81214d2364d38b8fd0a144af492cd543566` incorpora o commit de CI empilhado `933a8a70381706dfdcc1776361ee926318ef3c7f` na Fase 3.
2. `b4eaeebecdc2e1f97be7dbf20c87d985dc84f6ec` reconcilia a implementação da Fase 4 (`56f32181870eaaf7a2c87dc4363a88acc4f8069b`) com a ponta remota aprovada da Fase 3 (`172ca81214d2364d38b8fd0a144af492cd543566`).

Os dois merges pertencem ao histórico aprovado e foram preservados sem squash, rebase ou reescrita.

## Integridade

- todos os cinco PRs estão abertos, em modo DRAFT, com as bases empilhadas corretas;
- todos os HEADs remotos são mergeáveis segundo o GitHub;
- `7c0a8e7f...` tem `ea82fdaa...` como pai direto e contém integralmente os Passos 02–06;
- não há commit esperado ausente;
- não foram detectados patch IDs duplicados entre commits não-merge da cadeia;
- `git fsck --connectivity-only` não encontrou quebra de conectividade;
- não há conflito de integração a resolver porque cada ponta aprovada é ancestral da seguinte;
- a árvore de `7c0a8e7f...` é `1c3e4420c51c2cd8c33a481d3d922f762cb720f1`.

## Ressalva herdada

`git diff --check main..phase6` sinaliza somente espaços finais já presentes em `GATE_FASE_1_RESULTADO.md`. É dívida documental herdada do baseline aprovado da Fase 1, não conflito nem mudança produzida pelo Marco 01. O arquivo não foi reescrito para preservar os commits aprovados.

## Decisão da Parte A/B

A cadeia está íntegra. A branch `integration/val-v1-staging` foi criada diretamente em `7c0a8e7f6edbf581b893dc17eae43528e464b6f0`, sem alterar `main`, sem squash e sem reescrever qualquer commit aprovado.
