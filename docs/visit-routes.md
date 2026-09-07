# Visitas e roteiro por satélite

Base: staging `f3ed11a5c15f4accda834ea736b1c672b47cd2ff`. Branch de trabalho: `feature/val-satellite-visit-routes-v1`. Evolução solicitada pelo usuário, com publicação autorizada somente no staging. PR #95, main e produção não são alterados por esta entrega.

## Fluxo

Visitas abre a agenda do dia ao lado do mapa Esri World Imagery, com alternativa OpenStreetMap, tela cheia e enquadramento das paradas. Pins numerados e agenda compartilham os mesmos IDs. Visitas concluídas aparecem em verde; em andamento ou aguardando relato, em âmbar; planejadas, neutras. O histórico completo, preparar visita, relato por voz/texto e cancelamento continuam disponíveis.

Sugestões usam somente produtores da carteira com coordenadas cadastradas, excluem quem já está no roteiro e ordenam pelo acréscimo geométrico aproximado. As distâncias em linha reta são identificadas. Adicionar abre o agendamento para revisão de horário/objetivo. A ordem automática respeita horários fixos; mover manualmente muda a ordem do roteiro, preservando horários e visitas já realizadas/em andamento.

A rota por estrada usa OSRM com limite de 15 pontos, timeout de 8 segundos, cache por 5 minutos e limite de chamadas. Falha do provedor não produz rota ou tempo inventados. Parada sem coordenada permanece na agenda e impede representar um trajeto completo através de um trecho desconhecido. Repetir a mesma propriedade em posições não consecutivas é permitido.

## Percurso registrado

GPS começa somente em **Iniciar percurso**. A tela informa a dependência de permissão, GPS e permanência da tela aberta. Pausa, troca de dia, saída e mudança de conta encerram o observador. Respostas atrasadas não reiniciam captura. A sequência de gravações é serializada; pontos repetidos são idempotentes e filas antigas não atravessam contas. Amostras com precisão ruim são descartadas, e interrupções superiores a dois minutos não viram linhas artificiais.

Migração aditiva `20260906_008_visit_routes_expand` cria `val_visit_routes`, isolada por organização, dono e dia. Guarda ordem, trilha e estado de captura. Auditoria contém contagens e alterações de estado, não coordenadas. Visita encerrada é um registro do atendimento, não prova de uma trilha GPS.

## APIs

- GET/PUT `/api/visit-routes/day?date=AAAA-MM-DD&timeZone=America/Sao_Paulo`: ordem e trilha do usuário autenticado.
- POST `/api/visit-routes/driving`: IDs autorizados de produtores, origem GPS opcional e candidato opcional de inserção. Destinos vêm do cadastro.
- GET/POST `/api/demo/producer`: disponibilidade e criação idempotente da demonstração, apenas quando `VAL_DEMO_ENVIRONMENT=staging` ou `test` está configurado no servidor. A identidade vem da sessão.
- GET `/api/clients/:id/property?propertyId=...`: seleção de propriedade com isolamento por produtor/dono/organização. PUT conserva a propriedade selecionada; IDs inválidos não caem na propriedade principal.

O produtor fictício e seu roteiro de teste estão descritos em `docs/demo-producer.md`. A demonstração não preenche os formulários separados do Manual com análises oficiais: análises simuladas vivem no cadastro canônico e estão disponíveis ao contexto da VAL.

## Validação

Testes cobrem rota/ordenação, geometria ausente, distâncias, isolamento, falha do provedor, gravação GPS, cancelamento de eventos tardios, seleção de propriedade, fixture e perfil fictícios, além da suíte completa e build/PWA. O verificador PostgreSQL da CI exercita dados e migração em banco de teste isolado antes de publicar. GPS físico e qualidade de imagens de satélite dependem de dispositivo, cobertura do provedor e conexão.
