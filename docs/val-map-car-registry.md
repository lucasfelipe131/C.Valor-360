# KML do CAR e matrículas no mapa do produtor

## Uso

No mapa de criação de talhões, abra **Camadas** e escolha **Importar KML / GeoJSON**. O mapa enquadra os limites; selecione o imóvel ou uma de suas partes na lista. A prévia mostra matrícula, titular e fonte quando informados.

**Usar contorno no talhão** abre um desenho editável. Escolha cultura e safra, confira quais áreas são produtivas, conclua o talhão e salve o mapeamento. O arquivo e seus atributos não são enviados nem gravados automaticamente. Os limites importados são referências temporárias daquele produtor/propriedade e saem da tela quando o contexto muda.

Um KML com várias áreas mantém cada parte separada. Recortes internos permanecem no mapa e impedem a adoção do polígono inteiro: use **Desenhar usando este limite como guia** e delimite somente a área produtiva. Esse cuidado evita incluir automaticamente reservas, áreas excluídas ou toda a propriedade no potencial produtivo. As safras continuam sendo atribuições independentes do mesmo talhão físico.

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

## Verificação

Testes executam importação e adoção nos componentes React, confirmação de cultura/safra/salvamento, cancelamento de resposta tardia de outro produtor, namespaces, recortes, múltiplas áreas, geometria inválida, entidades externas, simplificação, cache limitado, titular ausente e atualização incremental do desenho. A compilação inclui o Worker e o endpoint do Manual.

A emulação de componentes verifica comportamento, não substitui a conferência visual em Safari/iPhone físico.

Referências de implementação: [KML Reference](https://developers.google.com/kml/documentation/kmlreference) e [Saxen](https://github.com/nikku/saxen).
