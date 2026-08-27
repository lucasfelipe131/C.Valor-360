# GATE VAL MASTER EVOLUTION vNEXT — RESULTADO FINAL

Data de fechamento: 2026-08-27 (UTC)

Branch: `feature/val-master-evolution-vnext`

Resultado: **GATE VAL vNEXT REPROVADO**

Recomendação: **NO-GO**

## 1. Decisão

As correções técnicas autorizadas foram implantadas no staging e passaram na regressão local e no CI remoto. O gate, porém, não pode ser aprovado: UAT físico em iPhone e Android, Voice/TTS em dispositivo real, fluxo conversacional físico e inspeção física da marca/PWA não foram executados. Evidência automatizada, browser remoto ou benchmark de componente não foi promovida a evidência física.

Este fechamento não reinstalou a VAL, não criou nova arquitetura, não adicionou feature fora das ressalvas, não alterou secrets, não fez merge em `main`, não promoveu produção e não iniciou Passo 07.

## 2. Baseline reproduzido e identidade congelada

| Item | Evidência reproduzida | Resultado |
|---|---|---|
| Branch | `feature/val-master-evolution-vnext` | PASS |
| Baseline originalmente implantado | `b7f8a38ad48cf09ca15f9bc62a46b293df092c8d` | CONFIRMADO |
| Head remoto documental informado | `bee311648d9d3507e48294b0b634b26d96bfbaf2` | CONFIRMADO |
| SHA técnico final implantado | `ce0c6e23a312ac741d441b70758fb201972b88ba` | PASS |
| `main` preservada | `f405617405fb66811207fdf006c2fbdaebfb8c9d` | PASS |
| Working tree antes das correções | Limpa na base recuperada; alterações posteriores restritas às ressalvas | PASS |
| Railway | Projeto `VAL - STAGING INTEGRATION 01`, serviço `val-web-staging` | PASS |
| Ambiente Railway | `production` dentro do projeto de staging; não é produção real | CONFIRMADO |
| `/live` | HTTP 200 no log Railway em `2026-08-27T22:01:16.711Z`, 28 ms | PASS |
| `/health` | Contrato JSON/readiness validado localmente e no CI; corpo público ao vivo não foi coletado por bloqueio da camada de acesso | PASS TÉCNICO |
| PostgreSQL | PostgreSQL 16 real nos gates CI, migrações 1–7, repetição, isolamento, backup/restore | PASS |
| IA | Configuração presente e suíte de componentes/Copilot aprovada; chamada generativa autenticada ao vivo não foi repetida neste fechamento | PARCIAL |
| Suíte conhecida | 864/864 | BASELINE CONFIRMADO |
| Suíte final | 913/913 | PASS, sem redução |
| Build VAL/PWA | Aprovado; stamp `valor360-vce0c6e23a312ac74` | PASS |
| Build Manual | Aprovado | PASS |

O commit documental deste arquivo sucede intencionalmente o SHA técnico implantado. Ele não deve ser implantado. A diferença esperada entre o deployment `ce0c6e23…` e o head final da branch é somente `GATE_VAL_MASTER_EVOLUTION_RESULTADO.md`.

## 3. Fechamento das 9 ressalvas

| # | Ressalva | Estado | Evidência/conclusão |
|---:|---|---|---|
| 1 | Readiness | PASS TÉCNICO | `/ready` agora é endpoint JSON real: 200 quando aplicação, banco e release estão prontos; 503 caso contrário. Não retorna SPA HTML. `/health` reutiliza o mesmo estado. |
| 2 | `source.commitSha` | PASS POR EVIDÊNCIA EQUIVALENTE | Sem SHA hardcoded; resolução por metadata Railway/Git/build. Deployment, build stamp e env convergem em `ce0c6e23…`; teste compara SHA reportado e fonte implantada. O corpo JSON público não pôde ser coletado. |
| 3 | Chunks > 500 KB | PASS | Lazy loading por rota e imports dinâmicos reduziram o JS inicial. Nenhum chunk de aplicação excede 500 KB; o PDF worker grande é auxiliar lazy, justificado. |
| 4 | Adapter Manual ↔ VAL | PASS TÉCNICO/POSTGRES | `AgronomicGeometryAdapter.v1`, Polygon/MultiPolygon, EPSG:4326, área, provenance, versão, edição, round-trip, vínculo/desvínculo e cross-tenant. Sem truncamento silencioso. |
| 5 | NutriScan/FitoScan ↔ attachment | PASS TÉCNICO/POSTGRES | `AgronomicScanProvenance.v1` mantém attachment, tenant, cliente quando existente, propriedade/talhão, tipo, timestamps e referência de resultado; suporta UNLINKED e bloqueia cross-tenant/cross-owner. |
| 6 | 9 calculadoras no Copilot | PASS | 9/9 usam a mesma implementação canônica; acesso direto e Copilot retornam estrutura equivalente. Bateria específica 15/15. |
| 7 | Clima, mercado e bulas | PASS DE GOVERNANÇA | Providers existentes auditados; fonte/timestamp/freshness/falha/cache/autoridade/custo documentados. Lacunas externas permanecem explicitamente bloqueadas, sem provider ou secret inventado. |
| 8 | GP-001–GP-016 | PARCIAL | 16/16 executados, 320/320 amostras técnicas; oito casos continuam dependentes de browser/dispositivo físico. |
| 9 | SLOs | PASS DE COMPONENTE | FAST, CONTEXT, DEEP, TOOL, LIVE_DATA e VOICE definidos por evidência. SLO end-to-end Railway/browser/model/provider/dispositivo ainda não está aprovado. |

## 4. Readiness, release e Railway

- `/ready` e `/health` retornam resposta estruturada e falham com 503 quando dependências mínimas ou identidade da release não estão prontas.
- `/api/release` expõe a identidade de release derivada, sem hardcode.
- Teste de contrato compara o SHA reportado ao SHA fornecido pelo ambiente implantado.
- Railway deployment `88dba4c8-cfd6-49b8-8849-f0e06ed688b6`: `SUCCESS`, criado `2026-08-27T21:58:27Z`, concluído `22:00:09Z`.
- Metadata do deployment: branch correta e commit `ce0c6e23a312ac741d441b70758fb201972b88ba`.
- Snapshot, build, publish, pre-deploy, container, healthcheck, networking e drain concluíram.
- A configuração efetiva do serviço usa `/ready` como healthcheck. O manifesto `railway.toml` ainda registra `/live`, mas o override do serviço já existia antes desta implantação e não foi alterado neste fechamento.
- Aplicação e PostgreSQL ficaram online 1/1, sem issues. Migração 007 foi aplicada; migrações 1–6 já estavam aplicadas; total de 7 verificado.
- Não foi possível capturar os corpos públicos de `/ready`, `/health` e `/api/release`: shell, browser remoto e fetch externo foram bloqueados pela camada de acesso. A conclusão de release/readiness usa evidência equivalente — metadata do deployment, stamp do build, runtime env, healthcheck Railway e teste CI. Nenhum corpo foi inventado.

## 5. Bundle antes/depois

| Métrica | Antes — Railway `b7f8a38` | Depois — `ce0c6e23` |
|---|---:|---:|
| JS inicial/main | 784.440 B; gzip 224.900 B | 212.655 B; gzip 67.808 B |
| CSS inicial | 531.640 B; gzip 101.210 B | 393.210 B; gzip 77.196 B |
| Maior chunk de aplicação | 784.440 B | PDF lazy 409.146 B; gzip 123.026 B |
| PDF worker auxiliar | 1.417.590 B, lazy | 1.417.586 B; gzip 417.571 B, lazy |
| Chunks de aplicação > 500 KB | Warning presente | `oversizedApplicationChunks=[]` |

As páginas pesadas, diagnóstico, mapeamento, gráficos e utilitários agronômicos passaram a carregar sob demanda. Funcionalidade não foi removida. O PDF worker permanece grande, mas não integra o JS inicial e é carregado apenas quando necessário.

## 6. Adapter de geometria

Contrato: `AgronomicGeometryAdapter.v1`.

- Manual → representação canônica VAL e canônica VAL → Manual.
- Preserva organização, cliente quando aplicável, propriedade, área/talhão, geometria, coordenadas, unidade, área calculada, provenance e versão.
- Suporta Polygon e MultiPolygon em EPSG:4326.
- Rejeita coordenadas inválidas e payload acima do limite explícito de 5.000 coordenadas; não corta geometria silenciosamente.
- Testa área, edição, round-trip, rebind, detach e isolamento cross-tenant.
- Gate PostgreSQL real validou persistência, migração repetível, drift, backup e restore.

Resultado: **PASS técnico e de persistência**. A manipulação tátil/visual em dispositivo físico permanece fora desta evidência.

## 7. Provenance NutriScan/FitoScan

Contrato: `AgronomicScanProvenance.v1`.

Fluxo validado:

`VAL Attachment → handoff → NutriScan/FitoScan → result → source attachment reference`

Campos preservados: `attachment_id`, `organization_id`, `client_id` quando houver, property/field quando houver, `analysis_type`, `created_at`, referência de resultado e provenance. O acesso é escopado por tenant e owner. Attachment `UNLINKED` foi coberto; a migração 007 remove apenas a obrigatoriedade de `client_id` e adiciona índice de unlinked, sem operação destrutiva.

Resultado: **PASS técnico e de persistência**. Foto/câmera física segue pendente no gate global.

## 8. Paridade das 9 calculadoras

| Calculadora | Implementação canônica | Direto | Copilot | Paridade |
|---|---|---|---|---|
| Semeadora | `semeadora` | PASS | PASS | PASS |
| População | `populacao` | PASS | PASS | PASS |
| Sementes | `sementes` | PASS | PASS | PASS |
| Colheita | `colheita` | PASS | PASS | PASS |
| Zoneamento | `zoneamento` | PASS | PASS | PASS |
| Pulverização | `pulverizacao` | PASS | PASS | PASS |
| Fertilizante | `fertilizante` | PASS | PASS | PASS |
| Reposição | `reposicao` | PASS | PASS | PASS |
| Cotação | `cotacao` | PASS | PASS | PASS |

O Intent Router chama a calculadora canônica, recebe resultado estruturado e só então permite à VAL explicá-lo. Fórmulas não foram duplicadas no prompt/modelo. A matriz detalhada está em `VAL_CALCULATOR_PARITY_v1.md`; bateria específica: 15/15.

## 9. Governança de fontes atuais

| Domínio | Provider/fonte existente | Freshness/timestamp e falha | Autoridade, tenant e custo | Estado |
|---|---|---|---|---|
| Clima | Manual: Open-Meteo + BigDataCloud | Provider/timestamp precisam acompanhar a resposta; Copilot falha fechado sem fonte autorizada | Uso/comercialização ainda requer validação externa; nenhum plano pago criado | BLOQUEIO EXTERNO DOCUMENTADO |
| Mercado/commodities | Copilot: `sog_market_snapshots`; Manual referencia Notícias Agrícolas, Google News e CME como indicativos | Snapshot contém fonte, timestamp e freshness; indisponibilidade não gera cotação inventada | Escopo tenant+owner; referências manuais não viraram autoridade do Copilot | PASS DE GOVERNANÇA |
| Bulas | Catálogo local Agrofit-derived com 1.632 itens; consulta ADAPAR | Catálogo local não registra timestamp de extração; sem feed/export oficial versionado, resposta técnica falha fechada | Claims preservam autoridade/safety; recurso necessário é feed/export oficial aprovado | BLOQUEIO EXTERNO DOCUMENTADO |

Detalhes: `VAL_CURRENT_SOURCES_GOVERNANCE_v1.md`. Nenhuma conta, secret, assinatura paga ou provider fictício foi adicionado.

## 10. Golden Performance GP-001–GP-016

Execução remota no CI: 20 amostras por caso, 2 warmups, 320 amostras. Resultado técnico: 320 sucessos, 0 falhas, 0 skips, 0 path mismatch, 0 target miss, 0 `FAST + genérico`. Qualidade geral média 0,994; especificidade 1,000; grounding médio 0,994. Fixtures exclusivamente sintéticas, sem dado real.

TTFUR e Total são iguais neste runner porque as respostas de componente não são progressivas. Valores abaixo em milissegundos; cada célula de latência é `P50 / P90 / P95`.

| GP | Intent e path selecionado | Classe | N | TTFUR = Total (ms) | Qualidade / especificidade / grounding | Resultado |
|---|---|---|---:|---:|---:|---|
| GP-001 | última visita → `ASK_CLIENT / VISIT_HISTORY` | FAST | 20 | 0,525 / 0,712 / 0,730 | 1,000 / 1,000 / 1,000 | PASS |
| GP-002 | compromisso → `ASK_CLIENT / COMMITMENTS` | FAST | 20 | 0,348 / 0,453 / 0,615 | 1,000 / 1,000 / 1,000 | PASS |
| GP-003 | Perguntas de Ouro → `ASK_CLIENT / GOLDEN_QUESTIONS` | FAST | 20 | 0,306 / 0,400 / 0,407 | 0,983 / 1,000 / 0,900 | PASS |
| GP-004 | PrepareVisit → `PREPARE_VISIT` | DEEP | 20 | 6,116 / 6,709 / 7,020 | 0,975 / 1,000 / 1,000 | PASS |
| GP-005 | análise de solo → `ANALYZE_SOIL` | TOOL | 20 | 0,378 / 0,410 / 0,545 | 1,000 / 1,000 / 1,000 | PARCIAL — browser/file |
| GP-006 | NutriScan → `IMAGE_DIAGNOSIS / NUTRISCAN` | TOOL | 20 | 0,329 / 0,563 / 0,566 | 1,000 / 1,000 / 1,000 | PARCIAL — imagem física |
| GP-007 | FitoScan → `IMAGE_DIAGNOSIS / FITOSCAN` | TOOL | 20 | 0,299 / 0,542 / 0,633 | 1,000 / 1,000 / 1,000 | PARCIAL — imagem física |
| GP-008 | mapeamento → `ASK_AGRONOMIC / AREA_MAPPING` | TOOL | 20 | 0,368 / 0,582 / 0,627 | 1,000 / 1,000 / 1,000 | PARCIAL — browser/geometria |
| GP-009 | calculadora → `CALCULATE / CALCULATORS` | TOOL | 20 | 0,359 / 0,597 / 0,603 | 1,000 / 1,000 / 1,000 | PASS |
| GP-010 | mercado → `ASK_COMMODITY` | LIVE_DATA | 20 | 0,401 / 0,484 / 0,547 | 1,000 / 1,000 / 1,000 | PASS |
| GP-011 | Deep Reasoning → `ASK_AGRONOMIC` | DEEP | 20 | 6,029 / 7,060 / 7,428 | 0,970 / 1,000 / 1,000 | PASS |
| GP-012 | Voice Follow-up → `FOLLOW_UP_HELP` | VOICE | 20 | 0,430 / 0,571 / 0,616 | 1,000 / 1,000 / 1,000 | PARCIAL — voz física |
| GP-013 | Agro Hero Voice → `ASK_AGRONOMIC` | VOICE | 20 | 0,052 / 0,087 / 0,093 | 1,000 / 1,000 / 1,000 | PARCIAL — voz física |
| GP-014 | Agro Hero Text → `ASK_AGRONOMIC` | CONTEXT | 20 | 5,942 / 6,667 / 7,228 | 0,970 / 1,000 / 1,000 | PASS |
| GP-015 | Agro Hero Photo → `IMAGE_DIAGNOSIS / PHOTO` | TOOL | 20 | 0,377 / 0,496 / 0,591 | 1,000 / 1,000 / 1,000 | PARCIAL — câmera física |
| GP-016 | Agro Hero File → `ANALYZE_SOIL / FILE` | TOOL | 20 | 0,364 / 0,567 / 0,597 | 1,000 / 1,000 / 1,000 | PARCIAL — browser/file |

Resumo: 160 amostras PASS e 160 PARCIAL. Os casos foram executados, mas GP-005, 006, 007, 008, 012, 013, 015 e 016 não fecham UAT end-to-end.

## 11. SLOs baseados em evidência

| Classe | N | TTFUR P50/P90/P95 (ms) | Total P50/P90/P95 (ms) | Error rate | Quality mínima | Budget de componente |
|---|---:|---:|---:|---:|---:|---:|
| FAST | 60 | 0,387 / 0,615 / 0,690 | 0,387 / 0,615 / 0,690 | 0% | 0,983 | ≤ 25 ms |
| CONTEXT | 20 | 5,942 / 6,667 / 7,228 | 5,942 / 6,667 / 7,228 | 0% | 0,970 | ≤ 200 ms |
| DEEP | 40 | 6,096 / 7,020 / 7,365 | 6,096 / 7,020 / 7,365 | 0% | 0,970 | ≤ 200 ms |
| TOOL | 140 | 0,368 / 0,582 / 0,613 | 0,368 / 0,582 / 0,613 | 0% | 1,000 | ≤ 50 ms |
| LIVE_DATA | 20 | 0,401 / 0,484 / 0,547 | 0,401 / 0,484 / 0,547 | 0% | 1,000 | ≤ 20 ms |
| VOICE | 40 | 0,101 / 0,507 / 0,571 | 0,101 / 0,507 / 0,571 | 0% | 1,000 | ≤ 25 ms |

Estes são SLOs executáveis de componente. Não incluem transporte HTTP/Railway, browser, autenticação real, modelo externo, provider live, captura/transcrição/TTS ou dispositivo. Logo, não constituem SLO end-to-end aprovado. A regra `FAST + GENÉRICO = FAIL` foi aplicada e teve zero ocorrência.

## 12. Critical path e otimização

| Caso | Total P95 | Estágio dominante |
|---|---:|---|
| GP-004 | 7,020 ms | MCA P95 5,374 ms; context 0,375 ms; tool 0,512 ms |
| GP-011 | 7,428 ms | MCA P95 6,363 ms; MIA 0,934 ms; context 0,354 ms |
| GP-014 | 7,228 ms | MCA P95 6,008 ms; MIA 0,876 ms; context 0,398 ms |

MCA é o critical path medido. Não foi feita otimização especulativa adicional: foram preservados reads paralelos, `SessionContextCache` escopado por tenant/owner/client, compactação de contexto, roteamento FAST/CONTEXT/DEEP e lazy loading. Qualidade não foi reduzida para perseguir latência.

## 13. Regressão, builds e CI remoto

- Suíte final: **913/913**.
- Baterias suplementares: phase2 19/19, phase3 28/28, phase4 34/34, phase5 41/41, phase6 42/42.
- Smokes phase2, phase5 e phase6: PASS.
- Copilot, Voice, AI Reasoning, PrepareVisit, MMI, MCTX, MIC, MDI, MVV, MEX, MCA, MIA, VIS, Manual, Agronomic Intelligence, NutriScan, FitoScan, mapeamento, calculadoras, attachments, hero agronômico, mobile/PWA automatizado, tenancy, safety e builds: cobertos pela suíte/gates correspondentes.
- PostgreSQL 16 real: geometry/provenance, migração repetida, drift, source/repeat, tenant isolation, backup e restore: PASS.
- CI remoto `Validate #193`, run `33120163438`, commit `ce0c6e23…`: **8/8 jobs verdes**.
- Artifacts CI: phase1 `9666142854`; voice `9666135023`; phase6 `9666134183`; vNext data `9666134166`; golden performance `9666124686`.
- Draft PR: `#90`; sem merge.

O build reportou 1 vulnerabilidade moderate e 1 high em dependências de build. O install runtime com `--omit=dev` reportou zero. Não houve atualização especulativa de dependências fora das ressalvas. O aviso de múltiplos lockfiles no workspace também permanece não bloqueante.

## 14. UAT físico, conversacional, agronômico e marca

| Evidência obrigatória | Estado | Observação |
|---|---|---|
| iPhone real | FAIL / NÃO EXECUTADO | Sem modelo, iOS, Safari/PWA e evidências físicas. |
| Android real | FAIL / NÃO EXECUTADO | Sem dispositivo, versão, Chrome/PWA e evidências físicas. |
| Voice/TTS físico | FAIL / NÃO EXECUTADO | Automação de componentes passa; microfone, transcrição, TTS e interrupção reais não foram executados. |
| UAT conversacional completo | PARCIAL | Intents e ferramentas automatizados passam; conversa por voz com confirmação e reflexo no PrepareVisit não foi executada end-to-end. |
| UAT agronômico real | PARCIAL | Paths reais de ferramenta foram exercitados em componente; foto, arquivo e mapeamento físicos/browser final seguem pendentes. |
| Marca desktop/iPhone/Android/PWA | FAIL FÍSICO | SVGs, manifest, favicon e testes estáticos passam; inspeção física de legibilidade, recorte, contraste e presença não ocorreu. |

O branding não foi reaberto. Não há evidência para redesenho, nem autorização para iniciar novo ciclo visual.

## 15. Critérios de aprovação do gate final

| Critério | Estado |
|---:|---|
| 1. 9 ressalvas fechadas ou evidência equivalente | PARCIAL — GP/UAT e SLO E2E pendentes |
| 2. iPhone físico | FAIL |
| 3. Android físico | FAIL |
| 4. Copilot conversacional | PARCIAL |
| 5. Voice/TTS | FAIL FÍSICO |
| 6. Geometria adapter | PASS |
| 7. NutriScan/FitoScan provenance | PASS |
| 8. 9 calculadoras com paridade | PASS |
| 9. Fontes atuais governadas | PASS DE GOVERNANÇA; bloqueios externos explícitos |
| 10. GP-001–GP-016 executados | PASS DE EXECUÇÃO; 8 casos PARCIAIS no resultado |
| 11. SLOs definidos | PASS DE COMPONENTE; E2E pendente |
| 12. Bundle otimizado/justificado | PASS |
| 13. `source.commitSha` correto | PASS POR EVIDÊNCIA EQUIVALENTE |
| 14. Readiness corrigido/documentado | PASS |
| 15. Marca/PWA | FAIL FÍSICO |
| 16. Regressão completa | PASS — 913/913 |
| 17. CI remoto | PASS — 8/8 |
| 18. Safety | PASS automatizado/CI |
| 19. Tenancy | PASS automatizado/PostgreSQL |

## 16. Riscos e bloqueios remanescentes

1. UAT físico em iPhone e Android continua obrigatório.
2. Voice/TTS, câmera, arquivos, interrupção e percepção de performance não têm evidência de dispositivo real.
3. O fluxo conversacional de confirmação e atualização do PrepareVisit não foi comprovado end-to-end por voz.
4. Oito GPs permanecem PARCIAIS por dependerem de browser/dispositivo.
5. SLO end-to-end ainda precisa medir Railway, browser, autenticação, modelo/provider, streaming, voz e dispositivo.
6. O corpo JSON público dos endpoints de release/readiness não foi coletado, embora o contrato e a identidade tenham evidência equivalente aprovada tecnicamente.
7. IA está configurada, mas a chamada generativa autenticada ao vivo não foi repetida neste fechamento.
8. Clima requer decisão de autorização/comercialização; bulas requerem feed/export oficial versionado e aprovado.
9. Inspeção física da marca/PWA segue ausente.
10. Vulnerabilidades de dependências de build e warning de lockfiles precisam de triagem futura dentro de escopo autorizado.

## 17. Rollback

- Rollback técnico de emergência: redeploy explícito de `b7f8a38ad48cf09ca15f9bc62a46b293df092c8d` no mesmo serviço de staging. Como essa base não possui `/ready` verdadeiro, o healthcheck deve ser revalidado em `/live` antes de qualquer tráfego.
- Se o problema for restrito ao último ajuste de insights demo, rollback de um commit para `84957a488150c61684b7c8d0c71d77606afca0bc`.
- Não reverter banco destrutivamente: migração 007 é aditiva/compatível; preservar backup/restore e os índices/colunas adicionais.
- Não alterar `main`, produção real ou secrets. Auto-deploy deve permanecer desabilitado e PR `#90` deve permanecer DRAFT.

## 18. Parada obrigatória

Decisão final: **GATE VAL vNEXT REPROVADO — NO-GO**.

O trabalho autorizado termina neste relatório. Não mergear, não promover para produção e não iniciar Passo 07. Aguardar autorização humana explícita para uma nova rodada, limitada à coleta das evidências físicas e end-to-end pendentes.
