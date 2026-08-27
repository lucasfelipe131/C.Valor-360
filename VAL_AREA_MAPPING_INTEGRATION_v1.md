# VAL Area Mapping Integration v1

## Objetivo

Integrar à experiência VAL a versão atual do mapeamento de áreas do Manual do Agrônomo, preservando sua lógica, fontes, avisos e controles. O objetivo não é criar outro editor de mapas nem copiar o layout completo do Manual.

Este documento diferencia o que já existe do que ainda precisa ser implementado.

## Estado atual confirmado

### Motor funcional

O motor atual está em:

- `manual/app/FieldMap.tsx`;
- `manual/app/lib/field-geometry.ts`;
- `manual/app/lib/official-geodata.ts`;
- `manual/app/api/geospatial/search/route.ts`;
- `manual/app/api/geospatial/ibge-boundary/route.ts`;
- `manual/app/api/geospatial/official-boundaries/route.ts`;
- `manual/app/ProducerLandRegistry.tsx`.

Ele oferece:

- etapas `Localizar`, `Importar`, `Desenhar` e `Revisar`;
- mapa e satélite Leaflet;
- busca por município, endereço ou coordenada;
- limite municipal IBGE;
- consulta CAR/SICAR e SIGEF/INCRA por ponto;
- importação KML/GeoJSON;
- desenho e correção de vértices;
- desfazer, reverter, limpar, remover ponto e simplificar;
- área em hectares, perímetro e centroide;
- exportação GeoJSON/KML;
- overlay NDVI;
- matrículas, croquis e vínculo de talhão;
- provenance de fonte e avisos sobre CAR, SIGEF e identidade do proprietário.

### Acesso pela VAL

`src/pages/Agro.jsx` abre o Manual por `/tecnico?embedded=1&page=produtores` em um `iframe`. `server/technical-workspace.js` protege e encaminha as rotas do Manual com identidade assinada da sessão VAL.

Essa integração preserva a capacidade atual, mas ainda apresenta o workspace do Manual dentro da VAL. Ela não é uma reimplementação nativa do editor.

A evolução em curso acrescenta `manual/app/valor360-navigation.ts`, protocolo `valor360:navigate` v1. Para mapeamento, os aliases `mapping`, `area-mapping`, `mapeamento` e `mapa` normalizam para `tool=mapping` e `page=produtores`.

### Segurança e confirmação do protocolo v1

O receiver aceita uma mensagem somente se:

- o Manual estiver no modo embedded;
- `event.origin` for exatamente `window.location.origin`;
- `event.source` for exatamente `window.parent`;
- o comando normalizar para página/tool suportado.

O comando pode transportar `requestId` e contexto de cliente, propriedade, talhão e análise. O Manual resolve cada ID/nome no workspace carregado antes de aplicá-lo; contexto não encontrado ou fora do produtor gera issue e não é adotado silenciosamente.

Depois do carregamento do workspace, o Manual responde ao parent com:

- `type = valor360:navigation-result`;
- `version = 1`;
- o mesmo `requestId`;
- status `APPLIED`, `PARTIAL` ou `CONTEXT_REJECTED`;
- página/tool aplicados;
- contexto efetivamente resolvido;
- `issues` de escopo/resolução.

O ack é emitido uma vez por `requestId`, e a atividade `valor360_deep_link` registra o status sem transformar contexto em memória.

## Contrato de dados atual

| Dado do Manual | Destino na VAL | Estado atual |
|---|---|---|
| Produtor e identidade externa | `clients` | Materializado com tenant e owner |
| Propriedade principal/textual | `properties` | Materializada |
| Nome/id do talhão | `fields.external_key`, `fields.name` | Materializado com chave property-scoped |
| Área do talhão | `fields.area_ha` | Materializada |
| Cultura e safra | `crop_seasons` | Materializadas quando ambas existem |
| Pontos do polígono | `fields.geometry_ref` | Não sincronizados |
| Versão da geometria | `fields.geometry_version` | Não sincronizada pelo evento de produtor |
| Cenas/estatísticas NDVI | `ndvi_observations` | Existe ingestão normalizada quando o evento específico é publicado |
| Matrícula/evidência | JSON/registro do Manual | Não normalizada como documento binário na VAL |

Fonte da materialização: `server/repository.js`. Schema destino: `database/schema.sql`.

## Gap crítico: geometry sync parcial

O objeto `FieldPlot` do Manual contém `points`, mas `materializeManualProperty` grava apenas nome, chave externa e área no `fields`. Portanto:

- o mapa continua completo no workspace JSON/evento do Manual;
- o talhão normalizado da VAL não possui uma referência reproduzível para essa geometria;
- `geometry_ref` e `geometry_version` existentes no schema não representam automaticamente a última edição do Manual;
- leitura nativa da VAL pode conhecer a área, mas não deve afirmar que possui o polígono normalizado.

## Arquitetura de integração

Os itens 1–3 e o protocolo/ack estão implementados e validados em código. Os itens de sincronização de geometria continuam propostos e não devem ser reportados como concluídos.

1. Manter `FieldMap` e `field-geometry` como fonte de lógica.
2. Abrir o mapeamento a partir da VAL com `client`, `property`, `field` e eventual `analysis` resolvidos contra o workspace autorizado.
3. Publicar uma revisão de geometria somente após a ação explícita de salvar.
4. Persistir uma referência imutável/versão da geometria e atualizar `fields.geometry_ref` + `fields.geometry_version` de forma tenant-scoped.
5. Manter no evento os metadados de origem: desenho, arquivo CAR, arquivo SIGEF, CAR WFS, SIGEF WFS ou outro arquivo.
6. Invalidar ContextSnapshot/cache do talhão somente depois da confirmação do write.
7. Exibir resultado resumido no Copilot e oferecer drill-down para o editor completo.

Nenhuma migration nova é necessária apenas para preencher `geometry_ref` e `geometry_version`, pois as colunas já existem. A forma de armazenamento referenciada precisa ser definida e validada antes do write; não deve ser inventada silenciosamente pelo modelo.

## Abertura pelo Copilot

Comandos como “VAL, abre o mapeamento do João” devem seguir estas fronteiras:

1. `Intent Router` reconhece a intenção de ferramenta.
2. O Orchestrator envia um comando v1 com `requestId`; o Manual revalida produtor, propriedade, talhão e análise no workspace.
3. Se houver mais de um João ou mais de uma propriedade materialmente possível, a VAL pergunta uma ou duas informações; não escolhe silenciosamente.
4. A UI abre a ferramenta existente e aguarda o ack que informa o contexto realmente aplicado.
5. Nenhuma mudança de geometria é persistida sem ação humana explícita.

O modelo pode solicitar a capacidade. Autorização, escopo, write e audit pertencem ao Orchestrator.

## Estados de UX requeridos

- carregando mapa;
- mapa pronto;
- localizando;
- consultando fontes oficiais;
- importando/validando arquivo;
- desenhando/editando;
- revisando;
- salvando;
- salvo com versão;
- falha recuperável;
- fonte oficial indisponível;
- contexto ambíguo;
- acesso negado/cross-tenant.

O estado de processamento deve refletir operações reais. Falha de CAR/SIGEF não pode aparecer como limite oficial confirmado.

## Provenance e safety

- CAR/SICAR permanece rotulado como autodeclarado e não comprova domínio.
- SIGEF/INCRA permanece rotulado como parcela certificada, respeitando o status retornado.
- Proprietário/detentor não deve ser inferido quando a fonte não o fornece.
- Arquivo importado conserva origem declarada e metadados não verificados.
- O sistema não contorna captcha nem acessa conta de terceiro.
- Geometry version e fonte precisam acompanhar a observação NDVI quando aplicável.
- Toda consulta e gravação deve carregar tenant, owner e entidades autorizadas.

## Testes existentes reutilizáveis

`test/manual-geospatial.test.js` cobre:

- área, perímetro e centroide;
- parse/round-trip KML e GeoJSON;
- simplificação;
- hosts e campos allowlisted de CAR/SIGEF;
- privacidade e ausência de owner inferido;
- timeout e contrato estático da UX.

`test/soil-analysis-linking.test.js` cobre identidade property-scoped de propriedade/talhão e rejeição cross-client, que devem ser reaproveitadas no adapter de mapeamento.

`test/manual-current-capabilities.test.js` valida o protocolo v1, aliases, rejeição de versão incompatível, resolução de contexto somente dentro da carteira/workspace, bloqueio de campo/análise cross-client, exigência de same-origin + `window.parent`, ack e preservação do mapeamento atual. Esse conjunto integrou 8/8 novos testes aprovados; a suíte relevante do Manual ficou em 43/43 e o build do Manual passou.

## Testes adicionais necessários para aprovação

- Copilot abre o mapeamento com produtor correto.
- Entrada a partir de Produtor 360 preserva produtor/propriedade/talhão.
- Ambiguidade não seleciona entidade automaticamente.
- Desenho, edição e importação continuam funcionais.
- Área/perímetro/centroide permanecem idênticos ao motor atual.
- Salvar cria uma nova `geometry_version` e não sobrescreve revisão concorrente.
- `geometry_ref` resolvida reproduz o polígono salvo.
- Um write atrasado não reverte geometria mais recente.
- Cross-client e cross-tenant falham fechados.
- CAR/SIGEF indisponível gera erro/indisponibilidade, nunca sucesso falso.
- Mobile e desktop permitem concluir o fluxo.
- Drill-down retorna ao mesmo contexto.
- Mensagem same-origin vinda de uma janela que não seja `window.parent` é ignorada.
- Versão de protocolo incompatível é rejeitada.
- Cada `requestId` recebe no máximo um ack.
- Ack `PARTIAL`/`CONTEXT_REJECTED` expõe issues e não finge contexto aplicado.

## Rollback

O caminho seguro de rollback é desabilitar o envio contextual v1 e manter o acesso simples por `/tecnico?embedded=1&page=produtores`. Dados versionados já confirmados não devem ser apagados. Não há autorização para migration destrutiva.

## Gate de integração

A integração só pode ser declarada completa quando:

1. a ferramenta atual do Manual continua inteira;
2. contexto de produtor/propriedade/talhão é preservado;
3. desenho, edição, importação e fontes oficiais funcionam;
4. geometria e versão passam a ser sincronizadas, não apenas a área;
5. provenance permanece visível;
6. tenancy e concorrência são testadas;
7. Copilot consegue abrir a capacidade sem executar writes autônomos;
8. comando v1 e ack comprovam contexto aplicado ou rejeitado;
9. regressões e builds passam.

No estado atual, os itens 1–3 e o protocolo v1/ack estão implementados/validados em código. O item 4 continua parcial e é o gap central não resolvido por esse protocolo. UAT físico/mobile do editor no ambiente publicado permanece pendente.
