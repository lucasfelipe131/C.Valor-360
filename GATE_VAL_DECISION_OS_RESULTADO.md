# GATE — VAL Decision OS v3

Data: 26/08/2026

Escopo: `feature/val-decision-os-v3` em staging isolado

Resultado: **APROVADO TÉCNICO COM RESSALVAS — NÃO PROMOVER**

## Decisão

O núcleo do VAL Decision Copilot v3 está implementado, versionado e ativo no staging. A VAL recalcula as premissas por solicitação usando o produtor selecionado, o snapshot autorizado, memória confirmada, histórico e dados atuais disponíveis. `ASK` e respostas da Decision Interview não promovem memória; somente `REGISTER`, depois de revisão e confirmação humana, incorpora fatos estruturados que serão relidos na próxima solicitação.

O gate não autoriza produção, merge em `main` nem Passo 07. Permanecem como ressalvas antes de promoção: UAT físico de microfone/áudio em dispositivos móveis, validação humana “Por que eu não pensei nisso?”, ensaio formal de p50/p95 e conexão de fontes atuais autorizadas de clima e bula/rótulo no ambiente.

## Evidência executada

- Suíte completa final: **753/753 testes aprovados**.
- Build Vite/PWA: **PASS**, 1.720 módulos; service worker versionado e verificado. Há somente o aviso não bloqueante de chunk acima de 500 kB.
- Migração staging `20260825_006_soil_measurement_sets_expand`: aplicada e depois verificada como versionada; nenhuma migração destrutiva.
- Deploy Railway staging: **SUCCESS**, branch `feature/val-decision-os-v3`, commit remoto `26258dbccef96f81903b6f22aab4b2dd3b4e6726`.
- UAT autenticado no produtor sintético `Produtor UAT Voice 01`:
  - consulta de mercado sem cotação atual falhou fechada, sem usar memória antiga como preço de hoje;
  - a pergunta independente seguinte, “Me prepare para uma conversa comercial com este produtor”, rompeu a âncora de mercado, recalculou o contexto e retornou `DEEP` específico para o produtor;
  - Decision Interview pediu duas lacunas materiais e declarou que a resposta vale apenas na conversa até registro confirmado;
  - nenhuma falha ou warning da aplicação no console ao final.
- Nenhuma alteração em secrets, produção, `main` ou Passo 07.

## Gate final — 24 critérios

| # | Critério | Status | Evidência / ressalva |
|---:|---|---|---|
| 1 | Funcionalidades existentes permanecem | PASS | Regressão completa aprovada; módulos e rotas legadas preservados. |
| 2 | Copilot acessa essas funções | PARTIAL | Router FAST/DEEP e módulos especialistas integrados; clima e bula/rótulo falham fechados até fonte atual autorizada ser conectada. |
| 3 | Consultor pode navegar manualmente | PASS | Jornada principal e workspaces diretos preservados. |
| 4 | Consultor pode perguntar sem navegar | PASS | Home e Copilot global validados no staging. |
| 5 | Inteligência Agronômica mantém página própria organizada | PASS | Workspace nativo e ferramenta técnica coexistem. |
| 6 | Não parece Manual separado | PASS | Manual aparece como capacidade técnica integrada, sem criar outro cérebro. |
| 7 | Análises podem existir desvinculadas | PASS | Modelo e testes de solo headless/desvinculado aprovados. |
| 8 | Análises podem ser vinculadas/desvinculadas | PASS | Vínculo versionado preserva identidade e medições. |
| 9 | Agronomia é cruzada com produtor | PASS | ContextSnapshot e refs auditáveis integram workspace, Manual e produtor. |
| 10 | Decision Interview funciona | PASS | Contrato, no máximo três lacunas, sessão e UI aprovados. |
| 11 | VAL pergunta quando falta dado | PASS | UAT mostrou duas perguntas materiais antes de concluir. |
| 12 | VAL não pergunta o que já sabe | PASS | Deduplicação por fatos confirmados, commodity e safra coberta. |
| 13 | Voz de entrada funciona | PARTIAL | Pipeline, API, storage, confirmação e 4 contextos passam automatizados; microfone físico não foi exercitado neste UAT. |
| 14 | Voz de saída funciona | PARTIAL | Síntese browser-native, controles e fallback passam; audição humana/dispositivo físico pendente. |
| 15 | Respostas são específicas | PASS | Cinco perfis opostos produzem premissas/abordagens distintas; UAT citou o produtor e sua oportunidade. |
| 16 | Commodity/market podem ser consultados | PASS | Consulta staging executada; ausência de fonte atual foi informada sem fabricação. |
| 17 | Current data possui fonte/data | PASS | Cotação só é `CURRENT` com fonte, data, praça/unidade e freshness; caso ausente falha fechado. |
| 18 | FAST PATH reduz latência simples | PASS | Rota determinística de mercado respondeu no staging em ~0,1 s; visitas e mercado possuem cobertura automatizada. |
| 19 | DEEP PATH preserva qualidade | PASS | Preparação específica e Decision Interview aprovadas; latência formal p50/p95 ainda precisa de ensaio. |
| 20 | Memória continua governada | PASS | `ASK` é `NONE`; `REGISTER` exige revisão/confirmação; próxima solicitação relê snapshot. |
| 21 | Safety permanece | PASS | Prescrição/dose, injeção, anexos, knowledge e revisão humana passam regressão. |
| 22 | Tenancy permanece | PASS | Tenant/owner, Manual, FAST, anexos e voz falham fechados em cross-tenant. |
| 23 | Regressões passam | PASS | 753/753. |
| 24 | Builds passam | PASS | Vite/PWA aprovado; build do Manual já aprovado no ciclo, sem mudança posterior no Manual. |

Resultado quantitativo: **20 PASS, 4 PARTIAL, 0 FAIL**.

## Matriz obrigatória — 30 cenários

| # | Cenário | Status | Evidência |
|---:|---|---|---|
| 1 | Perguntar sem visita | PASS | Copilot global/Home e contrato `ASK`. |
| 2 | Perguntar dentro do produtor | PASS | UAT com produtor sintético selecionado. |
| 3 | Perguntar mercado | PASS | UAT fail-closed e testes de fonte/freshness. |
| 4 | Perguntar commodity | PASS | Router e seleção estrita por commodity. |
| 5 | Perguntar agronomia | PASS | Capability Router, safety e knowledge governado. |
| 6 | Análise de solo sem vínculo | PASS | Measurement set headless. |
| 7 | Vincular análise | PASS | Vínculo versionado e tenant-safe. |
| 8 | Desvincular análise | PASS | Desvínculo preserva identidade/medições. |
| 9 | Cruzar análise com produtor | PASS | ContextSnapshot com refs agronômicas. |
| 10 | Voz entrada | PARTIAL | Automação completa; hardware real pendente. |
| 11 | Voz saída | PARTIAL | Runtime/SSR/controles aprovados; audição humana pendente. |
| 12 | VAL faz pergunta | PASS | Decision Interview visível no UAT. |
| 13 | Consultor responde | PASS | Acúmulo de respostas na sessão e segunda rodada cobertos. |
| 14 | Premissas recalculadas | PASS | `recomputed_for_request:true`; UAT rompeu âncora de mercado. |
| 15 | Memória não muda em ASK | PASS | Persistência `NONE` e confirmação inalterada. |
| 16 | Memória muda após REGISTER confirmado | PASS | Voice/REGISTER confirmado grava fatos estruturados e próxima requisição os relê. |
| 17 | Perguntas específicas | PASS | Lacunas materiais contextualizadas e deduplicadas. |
| 18 | NAME_SWAP_TEST | PASS | Golden/regressão com produtores opostos. |
| 19 | FAST PATH | PASS | Mercado/visita determinísticos. |
| 20 | DEEP PATH | PASS | UAT de preparação comercial. |
| 21 | Biblioteca | PASS | 100 itens, 30 fontes, retrieval e lifecycle aprovados. |
| 22 | Manual | PASS | Integração, ownership e safety aprovados; fonte atual específica pode ficar `NO_DATA`. |
| 23 | MIA | PASS | Entrevista identifica material missing information. |
| 24 | Commercial + agronomic reasoning | PASS | Orquestração e barreira técnica cobertas. |
| 25 | Current data | PASS | Fonte/data/freshness obrigatórias e futuro inválido rejeitado. |
| 26 | Cross-tenant | PASS | Testes de isolamento em DB/fallback/voz/anexos/Manual. |
| 27 | Safety | PASS | Regressão integral sem redução de guardrails. |
| 28 | Mobile | PARTIAL | CSS, safe-area e superfícies responsivas passam; dispositivo físico pendente. |
| 29 | Desktop | PASS | Cloud Browser autenticado em staging. |
| 30 | Regressão completa | PASS | 753/753. |

Resultado quantitativo da matriz: **27 PASS, 3 PARTIAL, 0 FAIL**.

## Ressalvas e condições para eventual promoção

1. Executar UAT real de captura de voz e reprodução de áudio em pelo menos iOS/Safari e Android/Chrome.
2. Executar UAT físico mobile e registrar evidência de toque, teclado, safe-area, rolagem e retomada.
3. Medir FAST e DEEP com amostra suficiente e publicar p50/p95 por estágio.
4. Conectar e homologar fontes atuais autorizadas de clima e bula/rótulo antes de declarar essas capacidades disponíveis.
5. Aplicar a avaliação humana “A VAL trouxe algo que você não havia considerado?” e registrar `NO / SOMEWHAT / YES / STRONGLY YES`.
6. Repetir um UAT comparativo com cinco perfis confirmados em staging, sem usar produtor real para prompts enviados a provedor externo sem autorização específica.

## Conclusão

A pergunta central está respondida: **a VAL não responde todos os produtores como Antônio Carlos Costa Beber**. Em cada solicitação, ela seleciona o produtor atual e recalcula as premissas. Informação dada apenas em `ASK`/Decision Interview muda a leitura somente naquela sessão; informação revisada e confirmada em `REGISTER` atualiza a memória estruturada do produtor e passa a compor as premissas da próxima solicitação. Perfis `PENDING`, `PROPOSED` ou vencidos não personalizam a resposta.

Este documento encerra o trabalho autorizado. **Não promover sem nova autorização humana explícita.**
