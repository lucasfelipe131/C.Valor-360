# VAL Golden Performance Result v1

Data: 27/08/2026
Runner: `val.golden_performance.local_integration.v1`
Origem: `evals/val-golden-performance-local-result-v1.json`

## Resultado reproduzido

- 16/16 casos presentes;
- 20 amostras por caso, 320 no total, após 2 warm-ups;
- 320 sucessos técnicos, 0 falhas, 0 skips;
- error rate técnico: 0%;
- 0 divergências de path;
- 0 misses de target;
- 0 casos `FAST + genérico`;
- percentil nearest-rank; `p95` publicado somente com `N >= 20`;
- fixture `SYNTHETIC_ONLY`, sem dado real.

Este é um benchmark de integração canônica em processo. Ele executa roteadores, ContextSnapshot, MCA/MIA, adapters, validações e contratos reais, mas exclui transporte HTTP, PostgreSQL/Railway, inferência externa, renderização do browser e hardware físico. Como a resposta deste runner não é progressiva, `TTFUR = Total Latency`; first byte não foi inferido como TTFUR.

## GP-001–GP-016

Tempos em milissegundos.

| Caso | Intent | Path / classe | TTFUR p50 / p90 / p95 | Total p50 / p90 / p95 | Qualidade / especificidade / grounding | Resultado |
|---|---|---|---:|---:|---:|---|
| GP-001 Última visita | `ASK_CLIENT` | `FAST / FAST` | 1,857 / 4,247 / 7,601 | 1,857 / 4,247 / 7,601 | 1,000 / 1,000 / 1,000 | `PASS_LOCAL_INTEGRATION` |
| GP-002 Compromisso | `ASK_CLIENT` | `FAST / FAST` | 1,093 / 4,856 / 8,829 | 1,093 / 4,856 / 8,829 | 1,000 / 1,000 / 1,000 | `PASS_LOCAL_INTEGRATION` |
| GP-003 Perguntas de Ouro | `ASK_CLIENT` + session command | `FAST / FAST` | 1,255 / 6,678 / 8,705 | 1,255 / 6,678 / 8,705 | 0,983 / 1,000 / 0,900 | `PASS_LOCAL_INTEGRATION` |
| GP-004 PrepareVisit | `PREPARE_VISIT` | `DEEP / DEEP` | 23,802 / 44,528 / 65,493 | 23,802 / 44,528 / 65,493 | 0,975 / 1,000 / 1,000 | `PASS_LOCAL_INTEGRATION` |
| GP-005 Análise de solo | `ANALYZE_SOIL` | `TOOL / TOOL` | 0,977 / 3,019 / 3,119 | 0,977 / 3,019 / 3,119 | 1,000 / 1,000 / 1,000 | `PARTIAL_BROWSER_FILE_UAT_REQUIRED` |
| GP-006 NutriScan | `IMAGE_DIAGNOSIS` | `TOOL / TOOL` | 0,784 / 4,421 / 5,125 | 0,784 / 4,421 / 5,125 | 1,000 / 1,000 / 1,000 | `PARTIAL_PHYSICAL_IMAGE_UAT_REQUIRED` |
| GP-007 FitoScan | `IMAGE_DIAGNOSIS` | `TOOL / TOOL` | 0,706 / 6,972 / 22,135 | 0,706 / 6,972 / 22,135 | 1,000 / 1,000 / 1,000 | `PARTIAL_PHYSICAL_IMAGE_UAT_REQUIRED` |
| GP-008 Mapeamento | `ASK_AGRONOMIC` | `TOOL / TOOL` | 0,894 / 2,717 / 4,252 | 0,894 / 2,717 / 4,252 | 1,000 / 1,000 / 1,000 | `PARTIAL_BROWSER_GEOMETRY_UAT_REQUIRED` |
| GP-009 Calculadora | `CALCULATE` | `TOOL / TOOL` | 0,906 / 2,195 / 2,567 | 0,906 / 2,195 / 2,567 | 1,000 / 1,000 / 1,000 | `PASS_LOCAL_INTEGRATION` |
| GP-010 Mercado | `ASK_COMMODITY` | `LIVE_DATA / LIVE_DATA` | 1,299 / 4,010 / 4,315 | 1,299 / 4,010 / 4,315 | 1,000 / 1,000 / 1,000 | `PASS_LOCAL_INTEGRATION` |
| GP-011 Deep Reasoning | `ASK_AGRONOMIC` | `DEEP / DEEP` | 24,289 / 73,354 / 74,237 | 24,289 / 73,354 / 74,237 | 0,970 / 1,000 / 1,000 | `PASS_LOCAL_INTEGRATION` |
| GP-012 Voice Follow-up | `FOLLOW_UP_HELP` | `CONTEXT / VOICE` | 1,460 / 6,113 / 10,072 | 1,460 / 6,113 / 10,072 | 1,000 / 1,000 / 1,000 | `PARTIAL_PHYSICAL_VOICE_UAT_REQUIRED` |
| GP-013 Agro Hero Voice | `ASK_AGRONOMIC` | `TOOL / VOICE` | 0,149 / 0,341 / 0,690 | 0,149 / 0,341 / 0,690 | 1,000 / 1,000 / 1,000 | `PARTIAL_PHYSICAL_VOICE_UAT_REQUIRED` |
| GP-014 Agro Hero Text | `ASK_AGRONOMIC` | `CONTEXT / CONTEXT` | 21,423 / 41,393 / 76,524 | 21,423 / 41,393 / 76,524 | 0,970 / 1,000 / 1,000 | `PASS_LOCAL_INTEGRATION` |
| GP-015 Agro Hero Photo | `IMAGE_DIAGNOSIS` | `TOOL / TOOL` | 1,107 / 2,713 / 5,635 | 1,107 / 2,713 / 5,635 | 1,000 / 1,000 / 1,000 | `PARTIAL_PHYSICAL_CAMERA_UAT_REQUIRED` |
| GP-016 Agro Hero File | `ANALYZE_SOIL` | `TOOL / TOOL` | 0,808 / 3,612 / 5,918 | 0,808 / 3,612 / 5,918 | 1,000 / 1,000 / 1,000 | `PARTIAL_BROWSER_FILE_UAT_REQUIRED` |

## Distribuição por classe de serviço

| Classe | N | Total/TTFUR p50 | p90 | p95 | Error rate | Qualidade p50 |
|---|---:|---:|---:|---:|---:|---:|
| FAST | 60 | 1,458 | 6,678 | 8,829 | 0% | 1,000 |
| CONTEXT | 20 | 21,423 | 41,393 | 76,524 | 0% | 0,970 |
| DEEP | 40 | 24,289 | 65,493 | 74,237 | 0% | 0,970 |
| TOOL | 140 | 0,906 | 4,252 | 5,918 | 0% | 1,000 |
| LIVE_DATA | 20 | 1,299 | 4,010 | 4,315 | 0% | 1,000 |
| VOICE | 40 | 0,787 | 3,626 | 6,113 | 0% | 1,000 |

## Critical path comprovado

`buildCommercialComposition`/MCA domina os três casos mais caros:

| Caso | MCA p95 | Total p95 | Participação aproximada |
|---|---:|---:|---:|
| GP-004 | 63,443 ms | 65,493 ms | 96,9% |
| GP-011 | 70,699 ms | 74,237 ms | 95,2% |
| GP-014 | 71,730 ms | 76,524 ms | 93,7% |

Nenhum caso rompeu o SLO de componente definido em `VAL_PERFORMANCE_SLOS_v1.md`. Portanto não houve alteração especulativa de MCA/MIA. As otimizações já existentes e justificadas permanecem: `Promise.all` nas leituras independentes, `SessionContextCache` escopado por tenant/owner/client, compactação do contexto, roteamento FAST/CONTEXT/DEEP/TOOL/LIVE_DATA e lazy loading do frontend.

## Limites para o gate

Os 16 paths canônicos foram executados e medidos. Isso não transforma browser ou hardware em evidência física. GP-005/006/007/008/012/013/015/016 permanecem `PARTIAL` até UAT aplicável. Percentis E2E de Railway, modelo externo, microfone, transcrição, TTS, câmera e upload ainda precisam ser coletados no staging implantado.
