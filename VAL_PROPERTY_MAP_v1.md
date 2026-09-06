# VAL_PROPERTY_MAP_v1 — Sede no mapa, talhões no perfil, rota por satélite

## O que é

Três lugares, um dado:

| Onde | O que aparece | Componente |
|---|---|---|
| **Produtor 360 → "Propriedade e talhões"** | Mapa de satélite com a sede (pino) e os talhões (contornos). Marcar sede por toque ou GPS; desenhar talhão tocando nos cantos; área calculada do contorno; cultura/safra por talhão. | `src/components/PropertyFields.jsx` |
| **Visitas → "Próxima rota"** | Rota das próximas visitas sobre satélite: pinos numerados na ordem do horário, linha tracejada entre eles. Quem não tem sede entra na lista como "sem localização cadastrada" — nunca como pino aproximado. | `src/components/map/RouteMap.jsx` |
| **Preparar visita → "ONDE"** | Leitura: sede e talhões do produtor que vai ser visitado. Sem sede, diz isso e aponta onde registrar. | `src/components/map/PropertyPreview.jsx` |

Mapa base: `src/components/map/SatelliteMap.jsx` — Leaflet por import dinâmico, tiles
Esri World Imagery (mesmo provedor e atribuição que o Manual do Agrônomo usa), pinos
em `divIcon` (sem PNGs padrão). Sem sede registrada o mapa abre no Brasil inteiro:
é o único enquadramento honesto.

## Onde o dado vive

Nada novo no schema. Estende o que já existia:

- **Sede** → `properties.metadata.location = {lat,lng,source,updatedAt}` da propriedade
  principal do produtor (a primeira com sede; senão a mais recente; senão é criada
  com o nome de `commercial.property` ou "Propriedade principal").
- **Talhão** → linha em `fields` (nome, `area_ha`) com o contorno em
  `fields.geometry_ref` no envelope canônico `AgronomicGeometryAdapter.v1` — o mesmo
  que o Manual do Agrônomo lê em `/api/technical/bootstrap`. Cultura + safra viram
  `crop_seasons`.
- **Carteira** (`/api/intelligence`) → cada produtor ganha `location` (subconsulta em
  `properties`), o que alimenta a rota sem uma chamada por produtor.
- **Sem PostgreSQL** → `store.val.propertyProfiles` no arquivo local, por
  tenant/dono, com o mesmo contrato de resposta.

## API

- `GET /api/clients/:id/property` → `{clientId, property:{id,name,municipality,areaHa,location|null}, properties:[{id,name}], fields:[{id,name,areaHa,crop,season,points:[{lat,lng}],geometryStatus}], source}`
- `PUT /api/clients/:id/property` com `{propertyName?, location: {lat,lng} | null | ausente, fields:[{id?,name,areaHa?,crop?,season?,points?,clearGeometry?}], removedFieldIds:[]}`
  - `location` ausente mantém; `null` remove; objeto marca.
  - Contorno precisa de ≥ 3 pontos; cultura exige safra; latitude/longitude fora do
    intervalo é 400 — mensagens em português, sem "invalid input".
  - Talhão removido é apagado; análises ligadas a ele perdem o vínculo (as FKs já
    eram `SET NULL`/`CASCADE` no schema). A interface confirma antes.
  - Audita `property_profile_updated` e invalida o contexto da VAL para o produtor.

Contrato compartilhado em `server/property-profile.js`; geometria e rota puras em
`src/lib/property-map.js`.

## O que NÃO faz (de propósito)

- Não geocodifica município nem endereço: sem pino do consultor, não há pino.
- Não sugere ordem "ótima" de rota: a ordem é o horário agendado.
- Não importa CAR/SIGEF nem NDVI aqui — isso continua no Manual do Agrônomo, que
  passa a receber os talhões desenhados no perfil.
- Imagem de satélite exige conexão; sem rede o mapa fica escuro com os pinos.

## Testes

`test/val-property-map-v1.test.js`: área do contorno (~1 ha num quadrado de 100 m),
ordenação da rota e separação "sem sede", contrato de entrada, ida-e-volta do envelope
canônico, repositório sem PostgreSQL por dono, e as telas ligadas ao mapa.
