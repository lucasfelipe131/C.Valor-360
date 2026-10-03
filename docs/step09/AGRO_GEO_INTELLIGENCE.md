# Passo 09 — inteligência territorial governada

Base: `e22258347987cd2e9a2fb8df71dbdc055d923476`, branch do Passo 08. PR empilhado e draft; K5 continua pendente como release gate.

A projeção territorial evolui `server/agronomic-geometry-bridge.js`, sobre propriedades, talhões, safras, observações, relatórios, análises e measurement sets canônicos. `getDecisionContexts` consulta essas entidades por tenant e carteira atual. A identidade canônica permanece explícita mesmo quando o ContextSnapshot usa a chave pública do produtor.

Relatórios de campo e análises de solo são lidos sem corte global por produtor: um talhão não perde sua evidência porque outros talhões receberam mais de vinte registros recentes. O teste de banco constrói 100 propriedades e 500 talhões, confirma 500 relatórios e 500 análises e exige cobertura dos 500 talhões na projeção de sinais.

`AgroGeoService` usa a autorização e as configurações do DecisionService. Persistência aditiva: versões de cards, revisões territoriais, histórico imutável de geometria/vínculo e validações humanas vinculadas ao fingerprint da evidência. O mapa do consultor e a projeção do Manual submetem contornos à mesma plausibilidade antes de substituir o valor canônico. Propostas incompatíveis ficam em revisão. O histórico conserva o registro anterior, origem, autor quando autenticado, data e motivo.

Os cards exibem propriedade, talhão, safra, fonte, estado epistemológico, freshness, informação ausente e próximo passo. Índice de vegetação é observação, nunca diagnóstico causal. Solo sem unidade não permite comparação. Praga sem amostragem não estabelece nível de dano. Daninha sem identificação suficiente demanda coleta. Não há prescrição, dose, produto, mistura, aplicação ou agendamento automáticos.

## Contratos e rotas

| Rota | Operação |
|---|---|
| GET /api/agro-geo?clientId= | Territórios, sinais, cards e cinco prioridades |
| GET /api/agro-geo/reviews | Fila da carteira atual |
| POST /api/agro-geo/reviews/:id | Resolução humana com motivo, sem alterar evidência |
| GET /api/agro-geo/history?clientId= | Histórico canônico autorizado |
| POST /api/agro-geo/analyses/:id/link | Vincular/desvincular com vínculo esperado e motivo |
| POST /api/agro-geo/signals/:cardId/validation | Validar/rejeitar versão de evidência com motivo e referências |
| PATCH /api/decisions/settings | Flags e rollback auditável por revisão |

Flags: `agro_geo_v1`, `field_priority_v1`, `agronomic_decision_cards`, `geo_review_queue`. Padrões ligados somente em staging/test/development. A desativação não apaga o histórico. Políticas versionadas em `agro-geo-policy.js`; pesos territoriais não ultrapassam o componente agronômico de 15 pontos do score comercial.

Clima atual permanece `UNAVAILABLE`. CAR/SIGEF/matrículas possuem contrato pronto; uma referência sem origem oficial demonstrada fica `UNVERIFIED`. As camadas cadastrais existentes continuam em SatelliteMap e não atribuem titularidade por nome.

Home e Visitas mostram até cinco cards. Cliente 360 e Agro reutilizam SatelliteMap com seleção de propriedade/talhão/safra, contornos e legenda. Ausência de rede e leitura em memória são identificadas como OFFLINE/STALE_CACHE/UNAVAILABLE. Não existe cache territorial persistente compartilhado entre usuários. Copilot chama o mesmo serviço e devolve as mesmas referências, sem chamada ao provedor.

## Verificação

`test/agro-geo.test.js`: adversariais de escopo, geometria, unidades, NDVI, clima, CAR, estados e projeção de 100 propriedades/500 talhões. `test/decision-service.test.js`: persistência, histórico imutável, isolamento, flags, rollback, vínculos, auditoria e HTTP quando executado com PostgreSQL 16 no CI. Suítes existentes cobrem KML/GeoJSON e o mapa reutilizado.

Situação de validação: execução em andamento. CI, smoke de staging e revisão visual mobile devem ser concluídos antes de declarar candidato pronto. Não executar K5 completo, não mergear e não promover produção.

## Fechamento de cards, contornos e mobile

A fixture `step09_synthetic_fixture` é idempotente e limitada pelos três IDs exatos do projeto, ambiente e serviço de staging. Usa somente a carteira UAT A já ativa e não troca senha nem permissão. Cria um produtor, propriedade, talhão e safra explicitamente sintéticos, com contornos sintéticos e origem rastreável. Um evento interno percorre normalização → Integration Hub → relatório/observação → sinal → prioridade → card persistido. A fonte de teste não é habilitada nos webhooks públicos. A transação confirma que contagem de produtores e valor de oportunidades reais permanecem iguais; o mesmo filtro de fonte se aplica aos indicadores de frontend.

O card prioriza título, próxima ação, motivo atual, confiança e prazo, com evidências expansíveis. Preserva source_ref, evento Hub, registro, sinal, política e identidade/revisão do card. Sem evidência exibe `INSUFFICIENT_EVIDENCE`. O mapa abre em diálogo modal nativo, isolando o toque da navegação inferior, e devolve o foco ao botão do card ao fechar.

Propriedade usa azul tracejado; talhão usa verde e o selecionado usa âmbar. O foco verifica vínculo e versão contra a leitura territorial autorizada e enquadra propriedade e talhão juntos, preservando o contexto do contorno externo. Geometria inválida não é desenhada; a fila e o motivo de revisão permanecem disponíveis. Fonte, referência, proveniência, versão, área e data de validação continuam no contrato. Seleção aceita toque e teclado.

`npm run test:agro:browser` executa Leaflet e os componentes/CSS reais com respostas sintéticas isoladas, nos viewports 375×667, 430×932 e 393×851. Verifica abertura/fechamento, foco, contornos, camadas, zoom, gesto touch de pan, detalhes, alvos mínimos e ausência de overflow horizontal. O CI instala Chromium e preserva relatório JSON e screenshots. Para ambientes que já dispõem de Chromium, `AGRO_CHROMIUM_PATH` permite indicar seu executável sem modificar o contrato CI. A emulação não substitui dispositivo físico: `MOBILE_PHYSICAL=PENDING_HUMAN` até UAT humano.
