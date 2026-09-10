# KML do CAR e matrículas no mapa do produtor

## Uso

No mapa de criação de talhões, abra **Camadas** e escolha **Importar KML / GeoJSON**. O mapa enquadra os limites; selecione o imóvel ou uma de suas partes na lista. A prévia mostra matrícula, titular e fonte quando informados.

**Usar contorno no talhão** abre um desenho editável. Escolha cultura e safra, confira quais áreas são produtivas, conclua o talhão e salve o mapeamento. O arquivo e seus atributos não são enviados nem gravados automaticamente. Os limites importados são referências temporárias daquele produtor/propriedade e saem da tela quando o contexto muda.

Um KML com várias áreas mantém cada parte separada. Recortes internos permanecem no mapa e impedem a adoção do polígono inteiro: use **Desenhar usando este limite como guia** e delimite somente a área produtiva. Esse cuidado evita incluir automaticamente reservas, áreas excluídas ou toda a propriedade no potencial produtivo. As safras continuam sendo atribuições independentes do mesmo talhão físico.

## Editar um talhão salvo

No mapa, escolha **Editar talhão** e selecione o talhão existente. Arraste os pontos azuis para mover os cantos, toque em **+** para inserir um ponto naquele lado e toque num ponto azul para apagá-lo. Um toque fora dos pontos insere um novo vértice no lado mais próximo do contorno em edição. Em contornos com 80 ou mais vértices, os botões **+** ficam ocultos para reduzir a sobreposição; a inserção por toque no mapa continua disponível.

**Cancelar desenho** descarta a revisão. **Concluir talhão** atualiza a prévia; **Salvar mapeamento** confirma a alteração no banco, mantendo o identificador do talhão. Contornos cruzados ou com menos de 3 pontos não podem ser concluídos. O contorno físico é compartilhado pelas safras; a cultura e a produtividade continuam associadas à safra selecionada. Editar somente o contorno preserva produtividades existentes em outras unidades, como kg/ha.

## Titulares e fontes

A camada **Matrícula** inclui as referências de número retornadas pelo SIGEF e os registros com contorno cadastrados no Manual do Agrônomo para o produtor autorizado. Arquivos importados podem trazer número e nome do titular em atributos explícitos. O nome do produtor aberto, o nome do imóvel e a localização não são usados para inventar titularidade.

Na aproximação, matrículas com titular têm rótulo no mapa; toque no limite para consultar os dados e sua fonte. A lista permite buscar por nome ou número. Sem nome na fonte: **Titular não informado na fonte**. O endpoint público usado pelo aplicativo informa referências cadastrais sem nomes de titulares. Nomes de arquivos e cadastros do usuário são identificados como declarações sujeitas à conferência da matrícula.

A consulta `GET /api/workspace?scope=producer-map&clientId=...` exige sessão, resolve o produtor por tenant e responsável pela carteira e lê apenas o workspace autenticado. Ela retorna somente os campos da matrícula necessários à camada, com `no-store`. Identificadores conflitantes e dados de demonstração não entram em um produtor real. Não há cache global de titulares nem alteração de memória, ContextSnapshot ou inteligência na consulta/importação.

## Desempenho e limites

- Parser KML em Worker; arquivos até 5 MB, 300 imóveis, 50 mil vértices e 6 importações temporárias.
- KML local com Polygon/MultiGeometry, namespaces, ExtendedData, altitude descartada e recortes preservados. Links externos, ícones e entidades nunca são consultados. KMZ deve ser descompactado primeiro.
- Desenhos aceitam até 500 pontos. Um contorno mais detalhado pode receber simplificação explícita na prévia, com área original, área resultante e diferença inferior a 0,5%; geometrias inválidas exigem redesenho. O contorno original permanece na camada de referência.
- Leaflet usa Canvas e atualiza vértices/linhas do desenho em lugar de recriar pinos, talhões e todos os pontos a cada toque.
- Municípios e estados públicos compartilham uma leitura por sessão da página. Consultas cadastrais usam espera de 250 ms e extensão com margem; movimentos dentro de uma resposta completa reutilizam o resultado por até dois minutos. Resultados incompletos/limitados não são reutilizados como cobertura integral.
- Durante uma nova consulta, referências anteriores da mesma UF permanecem visíveis com indicação de atualização. Respostas obsoletas são descartadas; mudar UF ou sair da escala de consulta limpa a referência oficial anterior. A velocidade das fontes externas continua dependendo de SICAR/INCRA.
- CAR, SIGEF particular e SIGEF público são carregados em requisições independentes. Cada fonte aparece assim que responde; uma falha não bloqueia os limites recebidos das outras. Os indicadores distinguem carregamento, resultado parcial e indisponibilidade.
- Pequenos movimentos dentro da margem mantêm as consultas em andamento, sem reiniciar o prazo. Só uma mudança de área fora da margem, desativação de camada, atualização explícita ou saída do mapa cancela a consulta do navegador.
- O servidor compartilha somente geometrias públicas normalizadas e atributos permitidos: até 128 entradas/16 MB e 24 consultas em andamento. Requisições iguais compartilham a mesma consulta externa. Resultados completos duram 5 minutos, parciais 30 segundos e indisponibilidade 15 segundos. Cache de falha continua sendo falha, nunca um resultado vazio confirmado. **Atualizar camadas** força nova consulta, respeitando consultas já em andamento.
- Consultas externas têm limite de 18 segundos por fonte; o navegador permite 23 segundos. A primeira consulta ainda depende do tempo do serviço oficial. Registros de staging anteriores mostraram respostas próximas de 9 segundos e cancelamentos frequentes ao mover o mapa; uma consulta pública limitada ao SIGEF demorou mais de 11 segundos, acima do limite anterior de 9 segundos.
- O endpoint mantém a resposta combinada para clientes anteriores e aceita `source=car|sigef-particular|sigef-publico` para carregamento progressivo. Autenticação, limites de extensão/UF e `Cache-Control: private, no-store` são preservados. O cache público não inclui matrículas privadas do workspace, titulares importados, tokens ou dados de produtores.

## Referência GEOMART

A página pública [GEOMART](https://geomart.com.br/) e a prévia de [Imóveis Certificados Teste](https://geomart.com.br/imoveis-certificados-teste/) foram consultadas em 09/09/2026. A apresentação mostra código CAR, nome do imóvel, área, matrícula e exportação KML. Nome de imóvel não identifica seu titular. O mapa de teste não apresentou geometrias utilizáveis nesta sessão; não foi confirmada uma fonte de nomes de proprietários nem uma API de integração autorizada. Nenhuma integração com conta privada do GEOMART foi criada.

## Verificação

Testes executam importação e adoção nos componentes React, confirmação de cultura/safra/salvamento, cancelamento de resposta tardia de outro produtor, namespaces, recortes, múltiplas áreas, geometria inválida, entidades externas, simplificação, cache limitado, titular ausente e atualização incremental do desenho. Também cobrem arrastar/inserir/apagar vértices, cancelamento da revisão, preservação de identidade e produtividade, fontes independentes com falha parcial, continuidade durante movimentos pequenos, expiração, atualização forçada e consultas simultâneas no cache do servidor. A compilação inclui o Worker e o endpoint do Manual.

A emulação de componentes verifica comportamento, não substitui a conferência visual em Safari/iPhone físico.

Referências de implementação: [KML Reference](https://developers.google.com/kml/documentation/kmlreference) e [Saxen](https://github.com/nikku/saxen).
