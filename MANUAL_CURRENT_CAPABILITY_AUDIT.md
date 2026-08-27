# Manual do Agrônomo — auditoria de capacidades atuais

## Finalidade

Este documento registra o que existe no código atual do Manual do Agrônomo e como essas capacidades chegam à VAL. Ele é uma auditoria factual; itens propostos ou ainda não implementados são identificados explicitamente.

## Baseline auditado

- Data da auditoria: 2026-08-26.
- Branch de trabalho: `feature/val-master-evolution-vnext`.
- Pacote: `manual-do-agronomo`.
- Versão declarada: `0.2.0` em `manual/package.json`.
- Último commit que alterou `manual/` no baseline: `cb8424b68066d52f6e1da3667e381586886d4838` (`feat: add VAL Decision OS v3`).
- Superfície principal do Manual: `manual/app/page.tsx`.
- Integração na VAL: `src/pages/Agro.jsx`, `server/technical-workspace.js` e `manual/app/lib/valor360.ts`.

Após esse baseline, a branch de trabalho implementou e validou em código a navegação contextual v1 e a persistência explícita de resultados de diagnóstico. Os arquivos centrais dessa evolução são `manual/app/valor360-navigation.ts`, `manual/app/lib/photo-diagnosis-record.ts`, `manual/app/PhotoDiagnosis.tsx`, `manual/app/records.ts` e `manual/app/api/records/route.ts`. As seções abaixo registram esse novo contrato sem tratar os gaps remanescentes como resolvidos.

O `manual/README.md` ainda descreve parte da persistência como uma camada futura. Essa descrição está defasada em relação ao código, que já possui autenticação, sessão, workspace PostgreSQL, registros locais/remotos e integração tenant-scoped.

## Conclusão executiva

O Manual atual é a implementação funcional mais completa do repositório para mapeamento, calculadoras, análise de solo e quatro metodologias de triagem por imagem. A VAL preserva o acesso a essas capacidades, mas mapeamento e calculadoras ainda são consumidos principalmente por navegação para o Manual embutido em `iframe`, não por tools executáveis dentro do Copilot.

As lacunas materiais que permanecem são:

1. sincronização parcial da geometria de talhão para o modelo normalizado da VAL;
2. fotos/base64 dos scans continuam deliberadamente fora dos registros do Manual;
3. resultados salvos como `photo_diagnosis` ainda não inserem as imagens no banco `val_attachments`;
4. banco de imagens da VAL sem vínculo direto a propriedade ou talhão;
5. execução no Copilot ainda não cobre os nove motores do Manual; o adapter atual cobre deep-link e um cálculo determinístico de custo/ha;
6. sincronização completa do protocolo/contexto e testes E2E dos quatro scans ainda precisam ser validados no gate.

## Nomenclatura canônica

- `NutriScan`: metodologia nutricional.
- `FitoScan`: metodologia fitopatológica e nome canônico presente no código.
- `FitScan`: deve ser aceito somente como alias de entrada para `FitoScan`; não deve substituir o nome canônico em UI, registros ou telemetria.
- `InsetoScan`: metodologia entomológica.
- `DaninhaScan`: metodologia para plantas daninhas.

Fontes: `manual/README.md`, `manual/app/PhotoDiagnosis.tsx` e `manual/app/api/diagnosis/route.ts`.

## Inventário de superfícies

| Área | Capacidade confirmada | Implementação principal |
|---|---|---|
| Produtores | Cadastro/importação, propriedades textuais, talhões, culturas, safras, áreas e matrículas | `manual/app/page.tsx`, `manual/app/ProducerCrmImport.tsx`, `manual/app/ProducerLandRegistry.tsx` |
| Análise de solo | PDF, foto/câmera, OCR, extração estruturada, edição, interpretação, histórico e vínculos | `manual/app/page.tsx`, `manual/app/api/soil-analysis/route.ts` |
| Mapeamento | Localização, importação, desenho, edição, fontes oficiais, cálculos e exportação | `manual/app/FieldMap.tsx`, `manual/app/lib/field-geometry.ts` |
| Diagnóstico visual | NutriScan, FitoScan, InsetoScan e DaninhaScan; salvamento explícito metadata-only implementado | `manual/app/PhotoDiagnosis.tsx`, `manual/app/api/diagnosis/route.ts`, `manual/app/lib/photo-diagnosis-record.ts` |
| Calculadoras | Nove calculadoras agronômicas/comerciais | `manual/app/page.tsx`, `manual/app/NutrientRemovalCalculator.tsx`, `manual/app/ZarcPlanner.tsx` |
| Talhão remoto | NDVI, NDRE, GNDVI, NDMI, SAVI, EVI2 e elevação | `manual/app/FieldInsights.tsx` |
| Bulas e catálogos | Agrofit, defensivos comerciais, foliares, consulta e OCR de rótulo | `manual/app/page.tsx`, arquivos JSON em `manual/app/` |
| Mercado | Cotações e notícias, cache e avisos de fonte | `manual/app/AgroMarketPage.tsx`, `manual/app/api/agro/route.ts` |
| Relatórios e arquivo | Fechamento de safra, registros, backup e restauração JSON | `manual/app/SeasonReports.tsx`, `manual/app/RecordsArchive.tsx`, `manual/app/records.ts` |
| Administração | Usuários, sessões, uso, feedback e sync administrativo controlado | `manual/app/lib/access.ts`, `manual/app/api/integrations/valor360/sync/route.ts` |

## Mapeamento de áreas

### Implementado no Manual

O fluxo de `manual/app/FieldMap.tsx` possui quatro etapas: `Localizar`, `Importar`, `Desenhar` e `Revisar`.

- mapa e imagem de satélite via Leaflet;
- busca por município, endereço ou coordenada por `/api/geospatial/search`;
- limite municipal do IBGE por `/api/geospatial/ibge-boundary`;
- consulta pública CAR/SICAR e SIGEF/INCRA por ponto em `/api/geospatial/official-boundaries`;
- importação KML e GeoJSON com origem declarada;
- desenho de polígono e seleção/remoção de vértices;
- desfazer, reverter, limpar e simplificar geometria;
- cálculo de área, perímetro e centroide;
- exportação GeoJSON e KML;
- sobreposição de tile NDVI;
- provenance e avisos explícitos: CAR é autodeclarado; SIGEF representa parcela certificada; o proprietário não é inferido.

`manual/app/ProducerLandRegistry.tsx` complementa o mapa com matrículas, metadados de documento, croqui, evidência de limite, vínculo talhão–matrícula e comparação entre área documental e mapeada. O binário do documento de matrícula não é persistido por esse componente; são mantidos metadados como nome e data do arquivo.

### Integração atual com a VAL

O evento do Manual materializa `properties`, `fields` e `crop_seasons` em `server/repository.js`. Nome e área do talhão, cultura e safra entram no modelo normalizado. Os pontos do polígono não são gravados em `fields.geometry_ref` ou `fields.geometry_version`; a geometria completa permanece no JSON do workspace/evento do Manual.

Portanto, a situação atual é **sincronização parcial**. A VAL consegue abrir o editor atual pelo Manual embutido, mas seu registro normalizado de talhão não é uma cópia completa da geometria.

## Propriedades, talhões e safras

O modelo de interface do Manual armazena, dentro de `Producer`:

- `properties` como texto;
- `fields` com `id`, `name`, `crop`, `season`, `area`, `points`, `ndviScenes` e `registrationId`;
- `registrations` para matrículas/evidências.

O workspace do Manual persiste `producers`, `soil_analyses` e `professional_profile` em JSONB por `tenant_id` e `workspace_id`, em `manual/app/api/workspace/route.ts`.

Na VAL, `database/schema.sql` possui modelos normalizados para `properties`, `fields`, `crop_seasons`, `field_reports`, `soil_analyses`, `soil_measurements` e `ndvi_observations`. A ingestão verifica tenant, owner, cliente, propriedade e talhão antes de vincular entidades.

## Análise de solo

### Entradas e interpretação

- PDF, JPEG, PNG, WebP e câmera;
- extração de texto de PDF;
- fallback de OCR com Tesseract;
- parsing local e extração estruturada por `/api/soil-analysis`;
- suporte a múltiplas amostras/profundidades;
- 21 métricas, incluindo pH, SMP, argila, matéria orgânica, P, K, S, Ca, Mg, Al, H+Al, CTC, V, m, B, Fe, Cu, Zn, Mn, areia e silte;
- revisão/edição humana, avisos e exportação.

### Estados reais de vínculo

- `UNLINKED`
- `LINKED_TO_CLIENT`
- `LINKED_TO_PROPERTY`
- `LINKED_TO_FIELD`

O fluxo suporta vincular, alterar vínculo e desvincular, preservando identidade externa estável, versão, histórico e provenance. A ingestão da VAL valida transições, escopo da propriedade/talhão, versão e horário do evento; medições atuais e substituídas são preservadas.

Fontes: `manual/app/lib/valor360.ts`, `server/repository.js`, `database/migrations/20260825_006_soil_measurement_sets_expand.sql` e `test/soil-analysis-linking.test.js`.

## NutriScan, FitoScan, InsetoScan e DaninhaScan

### Contrato implementado

- modos de API: `nutrition`, `disease`, `insect` e `weed`;
- uma a três imagens JPEG, PNG ou WebP;
- limite de entrada da interface: 15 MB por arquivo;
- redimensionamento no navegador para lado máximo de 1.600 px e JPEG 0,84;
- limite da API: 20 MB por requisição e 5 MB por imagem base64;
- contexto de cultura, estádio, órgão/local, posição/fase/grupo, distribuição e observações;
- qualidade da imagem, sinais visíveis, exatamente três hipóteses ranqueadas, confiança, severidade, evidências a favor/contra, confirmações, urgência, confundidores, lacunas e próximos passos;
- autenticação e rate limit de 12 análises/hora para tester ou 30/hora para admin;
- chamada ao modelo com `store: false`, schema JSON estrito e timeout de 90 segundos.

### Safety implementado

A API trata a imagem como triagem, não confirmação. Ela proíbe recomendação de marca, produto, ingrediente ativo ou dose. InsetoScan não infere nível de controle/dano econômico por foto; DaninhaScan não infere resistência por aparência. Os próximos passos orientam confirmação por vistoria, análise ou laboratório quando necessário.

### Persistência de resultado implementada

`manual/app/PhotoDiagnosis.tsx` oferece um botão explícito de salvamento somente depois de uma análise concluída. O clique cria um registro `photo_diagnosis`; analisar uma foto, trocar de metodologia ou apenas visualizar o resultado não persiste o diagnóstico.

O registro contém:

- `schemaVersion = manual-photo-diagnosis-v1`;
- metodologia e nome canônico;
- contexto resolvido de cliente, propriedade, talhão e análise, quando existente;
- contexto agronômico usado;
- metadados de evidência por foto: nome, MIME, tamanho e SHA-256 quando calculável;
- resultado estruturado;
- provenance com origem, capability, request de navegação, datas, confirmação `USER_EXPLICIT` e retenção `METADATA_ONLY`;
- safety `ASSISTED_TRIAGE_NOT_PRESCRIPTION` e `humanReviewRequired = true`;
- policy `rawImagesStored = false` e `inlineBinaryStored = false`.

A proteção existe em duas fronteiras:

- `manual/app/records.ts` sanitiza `photo_diagnosis` antes do IndexedDB, cache, import/export e envio ao servidor;
- `manual/app/api/records/route.ts` rejeita payload com imagem inline/binário e sanitiza novamente antes de gravar em `app_records`.

`manual/app/lib/photo-diagnosis-record.ts` bloqueia chaves como base64, data URL, preview, raw image e conteúdo equivalente. O sanitizer geral de `manual/app/lib/valor360.ts` também continua removendo imagem/foto/base64/data URL dos eventos Manual → VAL.

Consequências reais:

- o histórico guarda resultado, metadados, hash, contexto, provenance e safety após clique explícito;
- a foto/base64 original continua não persistida nesse registro;
- o registro pode ser publicado como `manual.record.saved` com payload sanitizado;
- a imagem não entra automaticamente em `val_attachments`;
- ainda não existe banco de imagens especializado NutriScan/FitoScan integrado ao Manual.

## Protocolo de navegação contextual v1

`manual/app/valor360-navigation.ts` implementa o contrato `valor360:navigate` versão 1 para:

- `mapping` → `produtores`;
- `calculators` → `calculadoras`;
- `soil` → `solo`;
- `diagnosis` → `diagnostico`.

O comando admite `requestId`, calculadora específica, modo de diagnóstico e contexto com cliente, propriedade, talhão e análise. Os aliases incluem mapeamento/mapa, calculadora/calcular, solo/análise de solo, NutriScan, FitoScan, FitScan, InsetoScan e DaninhaScan. `FitoScan` permanece canônico; `FitScan` é normalizado para `disease`.

A recepção por `postMessage` ocorre somente quando:

- o Manual está embutido na VAL;
- `event.origin === window.location.origin`;
- `event.source === window.parent`.

O Manual resolve cliente, propriedade, talhão e análise contra o workspace carregado. Entidade fora do produtor/workspace não é aceita silenciosamente. O resultado volta ao parent em `valor360:navigation-result`, com o mesmo `requestId`, status `APPLIED`, `PARTIAL` ou `CONTEXT_REJECTED`, contexto efetivamente resolvido e lista de `issues`. O ack é emitido uma vez por request e também gera atividade `valor360_deep_link`.

## Banco de imagens da VAL

A VAL possui uma implementação separada, centrada em `val_attachments`:

- `tenant_id`, `consultant_id` e `client_id`;
- nome, MIME, tamanho, base64 e SHA-256;
- limite de 6 MB;
- estados `received`, `interpreted`, `confirmed`, `stored` e `rejected`;
- `analysis` JSONB e timestamps;
- isolamento por tenant, consultor e produtor.

As rotas e repositório ficam em `server.js` e `server/repository.js`; a galeria fica em `src/components/ProducerFieldGallery.jsx`.

Limites atuais:

- não existem `property_id` e `field_id` em `val_attachments`;
- o diagnóstico especializado do Manual não é conectado ao attachment;
- `rejected` é um estado terminal e fica oculto das consultas normais, mas não representa exclusão física da linha/base64;
- o Copilot usa as imagens como observação visual não confirmada, com `diagnosticStatus = 'not_a_diagnosis'` e `diagnosis = null`.

## Calculadoras atuais

O Manual expõe nove calculadoras:

1. Regulagem de semeadora (`semeadora`)
2. População ideal (`populacao`)
3. Demanda de sementes (`sementes`)
4. Previsão de colheita (`colheita`)
5. Zoneamento ZARC (`zoneamento`)
6. Pulverização (`pulverizacao`)
7. Fertilizantes (`fertilizante`)
8. Extração e exportação (`reposicao`)
9. Cotação de insumos (`cotacao`)

O Manual inclui salvamento de registros/snapshots para os fluxos de cálculo. Pulverização, fertilizantes e cotação possuem registros específicos; outros resultados podem usar o tipo genérico `calculator`.

Na VAL, `server/decision-copilot/capability-router.js` reconhece `CALCULATE`, usa `TOOL PATH` e solicita `CALCULATORS`. `server/decision-copilot/capability-executor.js` implementa um adapter inicial: calcula custo/ha quando custo total e área estão explícitos, solicita os inputs ausentes e devolve um descritor/deep-link para o Manual. O protocolo v1 consegue selecionar uma das nove calculadoras pelo identificador canônico e retornar ack. Isso ainda não equivale a executar os nove motores do Manual dentro do chat.

Catálogos contados no baseline:

- 99 fórmulas em `manual/app/fertilizer-formulas.json`;
- 1.632 registros em `manual/app/agrofit-products.json`;
- 209 defensivos em `manual/app/commercial-agrochemicals.json`;
- 296 produtos em `manual/app/foliar-products.json`;
- cultivares: soja 26, milho 29, trigo 25 e canola 13 em `manual/app/cultivars.json`.

Alguns itens de catálogo possuem `source` vazio e os JSONs não expõem uma versão global uniforme. A existência do registro não deve ser apresentada como vigência oficial sem validação de fonte/data.

## Persistência, tenancy e integração

O Manual usa duas camadas:

- cache owner-scoped em `localStorage`/IndexedDB;
- PostgreSQL em `app_workspace_data` e `app_records`.

Parte do DDL do Manual ainda é criada/ajustada em runtime por `manual/app/lib/access.ts`, `manual/app/lib/db.ts` e `manual/app/api/workspace/route.ts`. A VAL também possui migrations versionadas para escopo tenant e modelos normalizados. Isso é uma diferença operacional a preservar na análise de rollout; não autoriza migration destrutiva.

A integração Manual → VAL usa HMAC SHA-256 e `VALOR360_WEBHOOK_URL`. O proxy injeta identidade assinada e de curta duração vinculada à sessão VAL. O sync administrativo falha fechado se owner/workspace não coincidirem. A ingestão é tenant-scoped, owner-scoped e idempotente.

## Testes existentes encontrados

| Domínio | Cobertura encontrada |
|---|---|
| Mapeamento/geodados | Área, perímetro, centroide, round-trip KML/GeoJSON, simplificação, hosts/privacidade CAR/SIGEF e timeout em `test/manual-geospatial.test.js` |
| Planejamento/calculadoras | Regionalização, colheita, população, guard de yield gap e presença das nove calculadoras em `test/agronomy-planning.test.js` |
| Solo | Estados, versões, histórico, materialização, conflito/stale write e cross-client em `test/soil-analysis-linking.test.js` |
| Integração do workspace | Proxy, autenticação e rotas em `test/technical-workspace.test.js` |
| Imagens VAL | Escopo por produtor, ausência de diagnóstico automático e rejeição cross-client em `test/val-engine.test.js` |

No baseline original não havia testes dedicados para persistência dos scans. A evolução adicionou `test/manual-photo-diagnosis.test.js` e `test/manual-current-capabilities.test.js`: 8/8 testes novos passaram, a suíte relevante do Manual passou em 43/43 e `npm run build` do Manual foi aprovado. A cobertura valida clique explícito, payload metadata-only, rejeição/sanitização de binário, aliases, resolução de contexto e ack.

Continuam pendentes UAT físico de câmera/upload no ambiente publicado e ligação NutriScan/FitoScan → `val_attachments`.

## Resultado da auditoria

| Capacidade requerida | Estado factual |
|---|---|
| Manual real e atual localizado | Confirmado |
| Mapeamento completo no Manual | Confirmado |
| Mapeamento nativo equivalente na VAL | Não; acesso atual é pelo Manual embutido |
| Geometry sync normalizado | Parcial; nome/área/safra entram, pontos não |
| Nove calculadoras atuais | Confirmado no Manual |
| Calculadoras executadas pelo Copilot | Parcial; deep-link v1 está validado e custo/ha determinístico existe no executor, mas os nove motores ainda não |
| NutriScan | Triagem e salvamento explícito metadata-only implementados/validados em código |
| FitoScan | Nome canônico e salvamento explícito metadata-only implementados/validados em código |
| FitScan | Não é produto separado; usar somente como alias de entrada |
| Banco de imagens VAL | Confirmado e tenant-scoped, mas apenas no nível do produtor |
| Banco de imagens integrado aos scans | Não |
| Navegação contextual Manual v1 | Implementada/validada em código com same-origin/parent, resolução de workspace e ack |
| Safety de diagnóstico | Confirmado |
| Tenancy da integração | Confirmado |

O salvamento metadata-only e o protocolo v1 estão aprovados em testes/build de código. A aprovação de experiência ainda depende de UAT físico. Eles não resolvem os dois gaps explicitamente mantidos: imagens dos scans não entram no banco VAL e a sincronização de geometria continua parcial.
