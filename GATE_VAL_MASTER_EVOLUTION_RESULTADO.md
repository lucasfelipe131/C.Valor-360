# GATE — VAL Master Evolution vNEXT

Data: 27/08/2026

Escopo: `VAL EXPERIENCE + PERFORMANCE + AGRONOMIC INTELLIGENCE + COPILOT + BRAND REFINEMENT vNEXT`

Branch: `feature/val-master-evolution-vnext`

Serviço isolado: `val-web-staging`, no projeto Railway `VAL - STAGING INTEGRATION 01`

Resultado: **APROVADO TÉCNICO COM RESSALVAS BLOQUEANTES — NÃO PROMOVER**

## Decisão

A evolução coordenada está implementada e ativa no staging. O Copilot full-screen, o hero funcional da Inteligência Agronômica, a conversa por texto, a entrada de voz com falha segura, os handoffs de foto/PDF, os cinco paths de raciocínio, o Manual atual, as ferramentas agronômicas e as variantes de marca coexistem sem remover os módulos anteriores.

O gate não autoriza promoção porque ainda existem evidências `PARTIAL`: microfone/câmera/TTS e mobile em hardware real; benchmark amplo de p50/p95; paridade nativa de geometria, scans e calculadoras; integração referência-a-referência entre resultados do Manual e o banco de imagens VAL; e inspeção visual física das variantes PWA/brand.

Este documento **não autoriza** merge em `main`, produção real, Passo 07, migration destrutiva, alteração de secrets ou redução de safety.

## Identidade exata do release

| Item | Evidência |
|---|---|
| Commit local da aplicação | `abf7737732ca502060b3f632aaeb4bdb50fa1cd2` |
| Commit remoto da aplicação | `b7f8a38ad48cf09ca15f9bc62a46b293df092c8d` |
| Tree local e remota | `f7d3f8da1a7b4ab0ff77a85b52cbfc3088a0ebc9` |
| Deployment | `0ab578a7-95a7-4757-a237-6b99c37fc153` — `SUCCESS` |
| Branch no deployment | `feature/val-master-evolution-vnext` |
| Serviço | `28d9c5f8-40bb-412e-8a58-40a11c892f2a` — `val-web-staging` |
| Projeto | `3689bcaa-603c-42f7-9e36-0b01274207c1` — `VAL - STAGING INTEGRATION 01` |
| URL exercitada | `https://val-web-staging-production.up.railway.app/` |

Os SHAs de commit local e remoto diferem porque o commit remoto foi formado pela integração autenticada; a tree Git é idêntica. O environment do projeto de staging possui o rótulo interno `production`, mas pertence ao projeto explicitamente isolado de staging e não é produção real.

## Baseline e preservação

- A evolução partiu da branch autorizada, não da `main`.
- Nenhuma funcionalidade estável foi removida para simplificar a UX.
- Voice Capture, AI Reasoning, Copilot full-screen, Inteligência Agronômica, Manual, memória confirmada, outcomes, commitments, LearningCandidates, uploads, PWA e módulos comerciais/agronômicos permanecem.
- Nenhuma migration nova foi criada. O predeploy apenas verificou as seis migrations atuais como `already-applied`.
- Nenhuma variável, secret, recurso, banco ou domínio foi alterado.
- Build Railway: Vite/PWA com 1.727 módulos, Manual Next.js/TypeScript e healthcheck `/ready` aprovados.

## Correção do head/hero agronômico

| Fluxo | Status | Evidência real |
|---|---|---|
| Falar com a VAL | PARTIAL | No deployment final, o botão acionou o fluxo. Como o cloud browser não possui microfone, a UI exibiu: “Nenhum microfone foi encontrado. Use o texto ou conecte um microfone.” Falha segura aprovada; captura física pendente. |
| Digitar / perguntar | PASS | Composer abriu no hero, aceitou envio e preservou o contexto. A pergunta de catálogo retornou em `FAST` no mesmo ecossistema. |
| Foto | PASS funcional / PARTIAL físico | Foto sintética sem produtor foi mantida somente na sessão, entregue ao Manual e abriu NutriScan com `1/3`; não houve auto-ranking, autosave ou POST de attachment. Câmera física pendente. |
| Arquivo | PASS | TXT inválido sem vínculo falhou fechado. PDF sintético `uat-analise-solo.pdf` foi classificado como análise de solo, permaneceu somente na sessão e chegou ao Manual sem parse/save automático. |
| Contexto | PASS | Partindo do Produtor 360, o hero mostrou `Produtor UAT Voice 01`; a resposta seguinte confirmou exatamente esse produtor. |
| Estados e telemetria | PASS | Loading/erro/sucesso, telemetria básica, handlers reais e regressões `AGRO_HERO_001`–`010` aprovados. |
| Desktop | PASS | Viewport final: `1363 × 936`; `scrollWidth = clientWidth = 1363`, sem overflow horizontal. |
| Mobile | PARTIAL | Contratos responsivos, safe-area e testes automatizados passaram; dispositivo físico não foi exercitado. |
| Console | PASS | Nenhum erro da aplicação após o UAT final; mensagens de extensão do navegador foram excluídas da avaliação. |

Os uploads de foto/PDF foram exercitados no predecessor imediato `ddcea159...`. O commit final alterou somente roteamento FAST, execução determinística, cards e testes; a regressão integral cobre o caminho de mídia preservado.

## UAT final do FAST path e especificidade

| Cenário | Resposta | Browser ação → card | Backend `ttfrMs` | HTTP |
|---|---|---:|---:|---:|
| Catálogo agronômico sem produtor | Catálogo factual, com requisitos de fontes atuais e integrações parciais declarados | 813 ms | 52,880 ms | 59 ms |
| Identidade sem produtor | “Nenhum produtor está selecionado nesta conversa.” | 822 ms | 165,671 ms | 168 ms |
| Identidade com contexto | “Produtor atual: Produtor UAT Voice 01.” | 908 ms | 141,103 ms | 147 ms |

Nos três casos:

- path exibido: `FAST`;
- engine/modelo profundo: não chamado;
- memória privada: não consultada quando não havia produtor;
- persistência: `NONE`;
- nova Decision Interview: não aberta;
- tenant e produtor: derivados somente do contexto autorizado.

O histórico visual ainda contém respostas antigas do UAT anterior, mas a nova resposta do deployment final aparece separadamente com `FAST` e sem a entrevista antiga.

## Performance e latência

### Evidência final focal

Para os três casos FAST acima, pelo percentil nearest-rank:

| Métrica | N | p50 | p75 | p90 | p95 |
|---|---:|---:|---:|---:|---:|
| Backend `ttfrMs` | 3 | 141,103 ms | 165,671 ms | 165,671 ms | 165,671 ms |
| Browser ação → card | 3 | 822 ms | 908 ms | 908 ms | 908 ms |

A rota simples que antes acionava `CONTEXT`/engine e chegou a aproximadamente 19,03 s agora responde por regra determinística. Isso comprova a correção focal, não um SLO global.

### Limites da evidência

- A amostra final tem somente três casos e não representa todos os GP, usuários, redes ou réplicas.
- O `TTFR` atual é marcado na conclusão e funciona como proxy de conclusão do backend, não como first token progressivo.
- O registry é em memória, por réplica, limitado a 500 observações por série e perde dados em restart/deploy.
- Erros/timeouts não entram nos percentis; não há agregação global, baseline histórico ou SLO aprovado.
- A evidência anterior de `CONTEXT:ASK_AGRONOMIC`, com `N=2`, teve p50 42,114 ms e p95 19.030,19 ms; o caso lento concentrou aproximadamente 18.970 ms na engine legada.
- Resultado do eixo performance: **PARTIAL — melhoria focal comprovada, promoção bloqueada até benchmark suficiente**.

## Golden Performance Set GP-001–GP-016

| Caso | Capacidade | Situação |
|---|---|---|
| GP-001 | Última visita | Contrato/teste funcional aprovado; benchmark de rede pendente. |
| GP-002 | Compromisso | Contrato/teste funcional aprovado; benchmark de rede pendente. |
| GP-003 | Perguntas de Ouro | Até três, específicas; benchmark pendente. |
| GP-004 | PrepareVisit | Funcional; benchmark DEEP amplo pendente. |
| GP-005 | Análise de solo | Funcional com vínculo/handoff; performance E2E pendente. |
| GP-006 | NutriScan | Roteável; upload, handoff e abertura por foto foram exercitados, sem alegar resultado/persistência completos. |
| GP-007 | FitoScan | Roteável; `FitScan` permanece somente alias; integração completa parcial. |
| GP-008 | Mapeamento | Ferramenta atual preservada; geometria VAL versionada permanece parcial. |
| GP-009 | Calculadora | Custo/ha nativo; nove calculadoras acessíveis por drill-down; paridade nativa parcial. |
| GP-010 | Mercado | Fail-closed sem fonte atual; probe existente ainda diverge entre `LIVE_DATA/ASK_MARKET` esperado e `FAST/ASK_COMMODITY` com `data_path=LIVE_DATA`. |
| GP-011 | Deep Reasoning | Funcional; percentis/SLO amplos pendentes. |
| GP-012 | Voice Follow-up | Contrato aprovado; hardware físico pendente. |
| GP-013 | Agro Hero Voice | Handler e erro seguro aprovados; hardware físico pendente. |
| GP-014 | Agro Hero Text | UAT final aprovado em 813 ms ação → card. |
| GP-015 | Agro Hero Photo | Upload/handoff aprovado; câmera física pendente. |
| GP-016 | Agro Hero File | PDF e erro inválido aprovados; benchmark amplo pendente. |

Os 16 casos estão declarados, sintéticos, sequenciais e roteáveis. Isso não equivale a 16 benchmarks de rede completos.

## Manual atual e paridade agronômica

A versão auditada é o Manual do Agrônomo `0.2.0`, localizada no próprio repositório. O inventário real está em `MANUAL_CURRENT_CAPABILITY_AUDIT.md`; nenhum recurso inexistente foi inventado.

| Capacidade | Status | Limite honesto |
|---|---|---|
| Manual e navegação atual | PASS | Versão atual auditada e incorporada como capacidade, sem copiar o layout paralelo para a página VAL. |
| Campo, propriedades, talhões e solo | PASS | Handoff e quatro estados `UNLINKED`, `LINKED_CLIENT`, `LINKED_PROPERTY`, `LINKED_FIELD` preservados. |
| Mapeamento | PARTIAL | Desenho, edição, KML/GeoJSON, área, perímetro, centroide, CAR/SIGEF e exportação existem no Manual; `geometry_ref/version` completo na VAL ainda não. |
| Calculadoras | PARTIAL | Nove calculadoras atuais acessíveis; somente custo/ha possui executor nativo completo no Copilot. |
| NutriScan | PARTIAL | Modo canônico `nutrition`, foto e handoff funcionais; execução/persistência e vínculo ao attachment VAL ainda não são E2E completos. |
| FitoScan | PARTIAL | Modo canônico `disease`; `FitScan` é alias; adapter resultado → attachment permanece pendente. |
| Diagnóstico por foto | PARTIAL | Triagem, safety e histórico sanitizado existem; sem ligação por referência ao banco VAL. |
| Banco de imagens VAL | PASS de integridade / PARTIAL de integração | Tenant/owner/client, MIME, tamanho, SHA-256, status e histórico preservados; Manual mantém raw somente na sessão e não liga o resultado ao attachment. |
| Clima, mercado e bulas | PARTIAL | Sempre exigem fonte atual autorizada; ausência falha fechada. |
| Biblioteca, evidências e histórico | PASS | Conhecimento governado, provenance e drill-down preservados. |

## Brand refinement

Foram criadas e integradas as variantes `VAL Light`, `VAL Dark`, `VAL Monochrome`, `VAL Compact`, `VAL Icon Only` e `VAL Maskable`, com adaptação por surface. A paleta azul/verde, aliases públicos, tipografia e identidade central foram preservados. A folha recebeu silhueta mais orgânica e o wordmark ganhou contraste e massa óptica.

Status: **PARTIAL para promoção visual**. Assets, componente, testes e build estão aprovados; ainda faltam inspeção física de favicon/maskable/PWA instalada e validação em 16, 24, 32, 44 e 64 px nas superfícies alvo.

## Regressão e builds

- Suíte final: **864/864 testes aprovados**, 0 falhas, 0 ignorados.
- Matriz focada final: **34/34 aprovada**.
- Revisão independente final: nenhum P0/P1; nenhuma fuga de tenancy, memória ou autorização.
- Vite/PWA local: **PASS**, 1.727 módulos; cache `valor360-vabf7737732ca5020` preparado e verificado.
- Manual Next.js/TypeScript local: **PASS**, 4/4 páginas estáticas.
- Railway: Vite/PWA, Manual, seis migrations já aplicadas e `/ready`: **PASS**.
- Warnings não bloqueantes: chunks Vite acima de 500 kB, `http-proxy` npm obsoleto e workspace root do Next inferido por dois lockfiles.

Cobertura preservada: Copilot, Voice, AI Reasoning, MMI, MCTX, MIC, MDI, MVV, MEX, MCA, MIA, VIS, Manual, Agro, NutriScan, FitoScan, calculadoras, mapeamento, uploads, mobile automatizado, PWA, tenancy, safety e builds.

## Gate final — 24 critérios

| # | Critério | Status | Evidência / ressalva |
|---:|---|---|---|
| 1 | Falar com a VAL no header funciona | PARTIAL | Handler real e erro seguro aprovados; captura física pendente. |
| 2 | Texto no header funciona | PASS | Composer e envio no mesmo contexto; UAT final FAST. |
| 3 | Foto no header funciona | PASS | Foto sintética, fluxo sem vínculo e NutriScan exercitados; câmera física fica como ressalva. |
| 4 | Arquivo no header funciona | PASS | PDF de solo e arquivo inválido exercitados com fail-closed. |
| 5 | Contexto é preservado | PASS | Produtor 360 → Agro → Copilot confirmou o produtor correto. |
| 6 | Mobile funciona | PARTIAL | Automação verde; hardware real pendente. |
| 7 | Desktop funciona | PASS | UAT final autenticado, sem overflow. |
| 8 | Voice funciona | PARTIAL | Pipeline e fallback aprovados; entrada/saída físicas pendentes. |
| 9 | Copilot funciona | PASS | Full-screen, thread, cards, composer, contexto e ferramentas preservados. |
| 10 | Funcionalidades antigas permanecem | PASS | Regressão integral e navegação confirmadas. |
| 11 | Manual atual foi auditado | PASS | Manual `0.2.0` e capability audit entregues. |
| 12 | Mapeamento atualizado entrou | PARTIAL | Implementação atual reutilizada; sincronização de geometria VAL incompleta. |
| 13 | Calculadoras atualizadas entraram | PARTIAL | Nove atuais acessíveis; paridade nativa incompleta. |
| 14 | NutriScan funciona | PARTIAL | Foto/handoff/metodologia funcionam; integração resultado/attachment incompleta. |
| 15 | FitoScan funciona | PARTIAL | Rota/metodologia funcionam; integração E2E incompleta. |
| 16 | Banco de imagem permanece íntegro | PASS | Escopo, hash, status, provenance e ausência de autosave indevido preservados. |
| 17 | Seções agronômicas estão mais claras | PASS | Cinco grupos, títulos, subtítulos e CTAs funcionais no staging. |
| 18 | Performance melhora | PARTIAL | FAST focal abaixo de 1 s no browser; amostra/SLO global pendentes. |
| 19 | Respostas permanecem específicas | PASS | Catálogo factual, identidade autorizada, NAME_SWAP e CONTEXT_REMOVAL verdes. |
| 20 | Logo refinada sem perder identidade | PARTIAL | Assets/componentes aprovados; gate visual físico pendente. |
| 21 | Safety permanece | PASS | Fonte, dose, mistura, compatibilidade, prescrição, review e audit preservados. |
| 22 | Tenancy permanece | PASS | Tenant/owner/client e contexto falham fechados. |
| 23 | Regressões passam | PASS | 864/864. |
| 24 | Builds passam | PASS | Local e Railway aprovados. |

Resultado quantitativo: **15 PASS, 9 PARTIAL, 0 FAIL**. Pela regra do gate, qualquer `PARTIAL` impede promoção.

## Documentação entregue

- `VAL_MASTER_EXPERIENCE_vNEXT.md`
- `VAL_AGRONOMIC_INTELLIGENCE_v3.md`
- `VAL_AGRO_HERO_INTERACTIONS_v1.md`
- `VAL_PERFORMANCE_ARCHITECTURE_v2.md`
- `VAL_VOICE_DECISION_COPILOT_v2.md`
- `MANUAL_CURRENT_CAPABILITY_AUDIT.md`
- `VAL_AGRONOMIC_CAPABILITY_DIFF.md`
- `VAL_AREA_MAPPING_INTEGRATION_v1.md`
- `VAL_NUTRISCAN_INTEGRATION_v1.md`
- `VAL_FITSCAN_INTEGRATION_v1.md`
- `VAL_CALCULATOR_PARITY_v1.md`
- `VAL_BRAND_REFINEMENT_v1.md`
- `VAL_LOGO_VARIANTS_v1.md`
- `GATE_VAL_MASTER_EVOLUTION_RESULTADO.md`

## Riscos e condições antes de nova avaliação

1. Executar UAT físico iOS/Safari e Android/Chrome para microfone, áudio, câmera, teclado, safe-area e retomada.
2. Executar benchmark suficiente de GP-001–016, incluindo erros/timeouts, e aprovar SLOs por path e estágio.
3. Completar e provar o adapter versionado de geometria entre Manual e VAL antes de declarar paridade de mapeamento.
4. Completar adapter de resultados NutriScan/FitoScan/diagnóstico por referência ao attachment, sem duplicar binário.
5. Decidir e implementar somente as calculadoras que realmente devam executar nativamente no Copilot; não chamar drill-down de paridade.
6. Conectar fontes atuais autorizadas de clima, mercado e bulas com origem, data, praça/unidade e vigência.
7. Executar inspeção visual física das variantes de logo, favicon e maskable/PWA.
8. Corrigir o metadado persistente `source.commitSha` do Railway, que ainda mostra `02e1a771...`; o deployment exato, porém, está comprovadamente em `b7f8a38...`.
9. Tratar o warning de bundle/chunks antes de uma rodada de otimização maior.

## Rollback

Rollback da aplicação no staging:

1. apontar **somente** `val-web-staging` para o commit anterior `ddcea159ad124fe423b95d3d5b9c3fa6cf765199`;
2. redeployar o mesmo serviço e exigir `/ready` verde;
3. repetir smoke de autenticação, Agro hero e Copilot;
4. não executar rollback de banco: esta correção não criou migration e as seis migrations verificadas já existiam;
5. não alterar `main`, produção real, secrets ou outros serviços.

## Conclusão e parada

O marco de valor foi atingido tecnicamente no staging: o consultor pode usar as ferramentas, acionar o fluxo de voz, digitar ou anexar pela VAL, e os botões do topo não são decoração. A melhoria FAST e a preservação do contexto foram comprovadas no deployment final; voz em hardware real permanece `PARTIAL`.

O gate permanece bloqueado para promoção pelas ressalvas explicitadas. Trabalho encerrado no escopo autorizado. **PARAR e aguardar autorização humana explícita.**
