# GATE — VAL Full-Screen Copilot v1

Data: 26/08/2026

Escopo: branch `feature/val-full-screen-copilot-v1`, serviço isolado `val-web-staging`

Resultado: **GATE NÃO APROVADO PARA PROMOÇÃO — IMPLEMENTAÇÃO TÉCNICA VALIDADA COM RESSALVAS BLOQUEANTES**

## Decisão

A experiência full-screen da VAL está implementada e foi exercitada no staging autenticado. A página funciona como centro de conversa e orquestração sem remover Clientes, Produtor 360, Visitas, Oportunidades, Inteligência Agronômica, Manual, Biblioteca, relatórios ou ferramentas existentes.

O gate de promoção não pode ser aprovado porque quatro critérios ainda têm evidência parcial: voz em hardware real, foto/câmera em hardware real, UAT físico mobile e medição formal de latência. Também há duas ressalvas operacionais no Railway: o metadado persistente da fonte ainda mostra a branch anterior, embora o commit exato da nova branch tenha sido implantado, e houve 502 transitório durante a troca de réplicas/redeploy. Nenhum desses pontos autoriza produção.

Este resultado não autoriza merge em `main`, produção, Passo 07 ou relaxamento de safety.

## Resposta à questão das premissas por produtor

**Sim, após alimentação confirmada, a VAL atualiza as premissas daquele produtor na solicitação seguinte. Ela não responde todos como Antônio Carlos Costa Beber.**

O comportamento validado é:

1. cada `ASK` recompõe o contexto do produtor, oportunidade/visita/análise ativa, histórico autorizado, memória confirmada e dados atuais disponíveis;
2. uma resposta dada apenas na conversa recalcula a tese somente naquela thread e não altera memória;
3. `REGISTER` abre revisão e exige confirmação humana;
4. somente depois da confirmação os fatos estruturados entram no contexto persistido;
5. a próxima solicitação relê esse contexto e recalcula as premissas.

Na UAT, foi registrado e confirmado no produtor sintético que ele avaliaria **150 hectares**, compararia **duas alternativas** e decidiria antes de **sexta-feira**. A pergunta seguinte citou esses três fatos e ainda confrontou os 150 ha com os 156 ha anteriormente registrados. Isso comprova a atualização por perfil sem promoção silenciosa de uma conversa.

## Evidência executada

- Suíte completa: **763/763 testes aprovados**, 0 falhas.
- Build principal Vite/PWA: **PASS**, 1.725 módulos; cache PWA preparado e verificado.
- Build Railway: **PASS**, incluindo Vite/PWA e Manual/Next.js; permanece apenas o aviso conhecido de chunks acima de 500 kB e o aviso de múltiplos lockfiles do Manual.
- Commit remoto de código implantado: `b2f202279ce616db8c5e9c23bc4ef55c723e3468`.
- Tree local/remota do código: `497823e9dcd1009522e3acaffd5d37ddb93ac75a`.
- Deployment funcional validado: `c9a65826-1ddf-4389-8022-9fae0a81b62f`; correção de continuidade agronômica exercitada no navegador.
- Deployment final após recuperação da troca de réplica: `e653e073-1287-4a39-9990-44e07d124a56`, `SUCCESS`, mesmo commit.
- URL de staging: `https://val-web-staging-production.up.railway.app/`.
- Nenhuma migration foi criada por esta evolução; nenhuma variável, secret, recurso ou banco foi alterado.
- Nenhuma alteração foi feita em produção, `main` ou Passo 07.

## Gate final — 18 critérios

| # | Critério | Status | Evidência / ressalva |
|---:|---|---|---|
| 1 | Copilot possui página inteira | PASS | Rota própria, `100dvh`, header, conversa central, composer fixo e painel opcional validados no staging. |
| 2 | Contexto acompanha a conversa | PASS | Produtor, oportunidade e objeto ativo foram carregados sem nova seleção; threads são separadas por escopo. |
| 3 | Não precisa abrir visita para perguntar | PASS | João foi consultado e teve visita preparada diretamente no Copilot. |
| 4 | Módulos continuam existindo | PASS | Navegação principal e módulos tradicionais preservados; regressão completa verde. |
| 5 | Ações especializadas podem ser abertas | PASS | Drill-down para Produtor 360, Inteligência Agronômica e Mercado exercitado. |
| 6 | Respostas estruturadas viram cards | PASS | `PrepareVisitCard`, `AgronomicInsightCard`, `MarketCard`, Decision Interview e cards reutilizáveis renderizados na conversa. |
| 7 | Voz funciona | PARTIAL | Pipeline, fallback por texto e captura governada existem; cloud browser não disponibilizou microfone físico. |
| 8 | Arquivos/foto funcionam | PARTIAL | TXT sintético foi anexado sem produtor, exibiu vínculo e abriu fluxo sem vínculo; câmera/foto física não foi exercitada. |
| 9 | Decision Interview funciona | PASS | Máximo de três perguntas, resposta na thread, recálculo e não repetição do padrão “reboleiras” validados. |
| 10 | Respostas não são genéricas | PASS | Respostas citaram João, município, culturas, oportunidade e fatos específicos; NAME_SWAP/CONTEXT_REMOVAL permanecem verdes. |
| 11 | Mobile funciona | PARTIAL | CSS responsivo, safe-area, composer e drawer passam em automação; dispositivo físico não foi exercitado. |
| 12 | Desktop funciona | PASS | Jornada autenticada completa executada no cloud browser. |
| 13 | Latência aceitável ou claramente melhor | PARTIAL | FAST respondeu em aproximadamente 0,6 s e algumas DEEP em menos de 2 s; uma DEEP levou cerca de 42–53 s. Falta p50/p95 formal. |
| 14 | Memory governance permanece | PASS | `ASK` usa sessão/persistência `NONE`; `REGISTER` só persistiu após revisão e confirmação. |
| 15 | Safety permanece | PASS | Guardrails técnicos, revisão humana, falha fechada de dados atuais e regressões passaram. |
| 16 | Tenancy permanece | PASS | Escopos tenant/owner, context binding, anexos e memória permanecem fail-closed e cobertos. |
| 17 | Regressões passam | PASS | 763/763. |
| 18 | Builds passam | PASS | Vite/PWA local e Vite/PWA + Manual no Railway concluídos. |

Resultado quantitativo: **14 PASS, 4 PARTIAL, 0 FAIL**. Pela regra do gate, qualquer `PARTIAL` impede aprovação para promoção.

## Matriz de validação — 30 cenários

| # | Cenário | Status | Evidência |
|---:|---|---|---|
| 1 | Abrir VAL full-screen | PASS | Staging autenticado; página dedicada. |
| 2 | Nova conversa | PASS | Ação limpa somente a thread escopada e preserva memória. |
| 3 | Contexto de produtor | PASS | João e produtor sintético validados. |
| 4 | Abrir a partir do Produtor 360 | PASS | João abriu com `current_client` correto. |
| 5 | Abrir da oportunidade | PASS | Oportunidade sintética abriu com produtor e objeto ativos. |
| 6 | Contexto implícito | PASS | Context binding e troca de objeto cobertos e exercitados. |
| 7 | Conversa contínua | PASS | Resposta material permaneceu na thread e recalculou a leitura. |
| 8 | Golden Questions | PASS | Até três perguntas específicas derivadas de lacunas/tese. |
| 9 | PrepareVisitCard | PASS | Frase natural “Me prepare para visitar João amanhã” gerou o card completo. |
| 10 | Agronomia no chat | PASS | `ASK_AGRONOMIC`, card e drill-down exercitados. |
| 11 | Análise de solo | PARTIAL | Fluxo de anexo sem vínculo e workspace headless validados; interpretação completa de laudo real no chat não foi exercitada. |
| 12 | Foto | PARTIAL | Input, MIME e rota estão cobertos; câmera/arquivo de imagem físico não foi exercitado. |
| 13 | Arquivo | PASS | Upload TXT sintético, prompt de vínculo e opção sem vínculo exercitados. |
| 14 | Market | PASS | Card `UNAVAILABLE` e falha fechada sem fabricar cotação. |
| 15 | Commodity | PASS | Soja classificada em FAST com exigência de fonte/data. |
| 16 | Voz | PARTIAL | Fallback e pipeline validados; microfone físico pendente. |
| 17 | Resposta por áudio | PARTIAL | Preferência “Texto + áudio” e controles `Ouvir/Pausar/Parar/Repetir` renderizados; audição humana pendente. |
| 18 | Decision Interview | PASS | Pergunta material, resposta e recálculo exercitados. |
| 19 | Confirmação | PASS | Revisão e `Confirmar tudo` concluíram com rastreabilidade. |
| 20 | ASK não persiste | PASS | UI declarou uso somente na conversa; memória confirmada permaneceu inalterada. |
| 21 | REGISTER persiste após confirmação | PASS | Fatos confirmados reapareceram nas premissas da próxima ASK. |
| 22 | Abrir módulo a partir do card | PASS | Produtor 360, Inteligência Agronômica e Mercado. |
| 23 | Mobile | PARTIAL | Automação/CSS verdes; UAT físico pendente. |
| 24 | Desktop | PASS | UAT completo no cloud browser. |
| 25 | FAST PATH | PASS | Mercado/commodity simples em aproximadamente 0,6 s. |
| 26 | DEEP PATH | PASS | Preparação, agronomia e recálculo executados com etapas reais. |
| 27 | Streaming | PARTIAL | Progresso real por etapas existe; streaming token a token não foi habilitado. |
| 28 | Cross-tenant | PASS | Regressões de isolamento e binding verdes. |
| 29 | Safety | PASS | Falha fechada, revisão técnica e não prescrição preservadas. |
| 30 | Regressões | PASS | 763/763. |

Resultado quantitativo da matriz: **24 PASS, 6 PARTIAL, 0 FAIL**.

## UAT solicitado

| Tarefa | Status | Resultado observado |
|---|---|---|
| “Descubra o que aconteceu com João.” | PASS | Resposta específica com produtor, município, culturas e situação comercial. |
| “Prepare uma visita.” | PASS | Frase natural gerou `PREPARE_VISIT` e card estruturado com objetivo, por que agora, três perguntas e saída esperada. |
| “Pergunte algo agronômico.” | PASS | Card agronômico, Decision Interview e continuidade sem repetir “reboleiras”. |
| “Registre uma informação.” | PASS | Fato sintético revisado/confirmado e relido na solicitação seguinte. |
| “Consulte mercado.” | PASS | Ausência de fonte atual comunicada de forma explícita e segura. |

A pergunta subjetiva “Você sentiu que estava conversando com a VAL ou navegando por um sistema?” ainda precisa ser aplicada a usuários reais. A execução técnica sem treinamento foi possível, mas não substitui essa pesquisa.

## Ressalvas bloqueantes antes de nova avaliação

1. Executar UAT físico de entrada e saída de voz em iOS/Safari e Android/Chrome.
2. Executar UAT físico mobile cobrindo teclado, safe-area, rolagem, drawer, câmera e retomada.
3. Exercitar foto real e um PDF de análise de solo autorizado do upload ao card interpretado, incluindo vínculo e não vínculo.
4. Medir FAST/DEEP com amostra suficiente e publicar p50/p95 por estágio; investigar as respostas DEEP de 42–53 s.
5. Habilitar streaming progressivo somente se a governança permitir; até lá, declarar apenas progresso por etapas reais.
6. Corrigir o metadado persistente do Railway: a implantação usa o commit da branch `feature/val-full-screen-copilot-v1`, mas o config/deployment metadata ainda mostra `feature/val-decision-os-v3`.
7. Alinhar e observar os healthchecks (`/live` visto no build e `/ready` no config), executar soak e confirmar ausência de novos 502 após troca de réplica.
8. Aplicar a UAT subjetiva com usuários reais e registrar o resultado.

## Documentação entregue

- `VAL_FULL_SCREEN_COPILOT_v1.md`
- `VAL_CONVERSATION_ARCHITECTURE_v1.md`
- `VAL_CONTEXTUAL_PANEL_v1.md`
- `VAL_CHAT_COMPONENTS_v1.md`
- `VAL_MULTIMODAL_COMPOSER_v1.md`
- `VAL_CONVERSATION_MEMORY_POLICY_v1.md`
- `VAL_FULL_SCREEN_MOBILE_v1.md`
- `VAL_FULL_SCREEN_DESKTOP_v1.md`
- `GATE_VAL_FULL_SCREEN_COPILOT_RESULTADO.md`

## Conclusão

O full-screen Copilot já está funcional no staging como centro de conversa e orquestração, e a atualização controlada das premissas por produtor foi comprovada. Porém, **“funcional no staging” não equivale a “gate totalmente aprovado”**: as evidências físicas e operacionais acima ainda faltam.

Trabalho encerrado no escopo autorizado. **PARAR e aguardar autorização humana explícita.**
