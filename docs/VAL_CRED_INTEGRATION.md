# Integração VAL ⇄ VAL Cred

Contrato `val-cred-integration.v1`. O lado do VAL Cred está em `DCREDC149/docs/INTEGRACAO_VAL.md`.

A integração tem três partes. Cada uma liga sozinha quando as variáveis dela existem. Se faltar uma variável, só aquela parte fica desligada e o resto da VAL continua funcionando.

| Parte | Direção | Rota | Credencial |
|---|---|---|---|
| A | VAL Cred → VAL | `POST /api/v1/integrations/cred/events` | HMAC do corpo bruto com `VAL_CRED_WEBHOOK_SECRET` |
| B | VAL → VAL Cred | `POST {VAL_CRED_BASE_URL}/api/v1/integrations/val/events` | HMAC do corpo bruto com `VAL_CRED_INBOUND_SECRET` |
| C | VAL lê o VAL Cred | `GET {VAL_CRED_BASE_URL}/api/v1/integrations/val/producers/{chave}/credit-summary` | `Authorization: Bearer VAL_CRED_READ_TOKEN` |

## Configuração dos dois lados

| VAL (Railway, serviço da VAL) | VAL Cred | Observação |
|---|---|---|
| `VAL_CRED_WEBHOOK_SECRET` | `VAL_CRED_WEBHOOK_SECRET` | mesmo valor nos dois serviços (parte A) |
| URL pública da VAL | `VAL_BASE_URL` | sem barra final (parte A) |
| `VAL_CRED_BASE_URL` | URL pública do VAL Cred | http ou https, sem barra final (partes B e C) |
| `VAL_CRED_INBOUND_SECRET` | `VAL_INBOUND_SECRET` | mesmo valor nos dois serviços (parte B) |
| `VAL_CRED_READ_TOKEN` | `VAL_CRED_READ_TOKEN` | mesmo valor nos dois serviços (parte C) |
| `VAL_DEFAULT_TENANT_ID` | `VAL_TENANT_ID` | mesmo tenant; no piloto, `00000000-0000-4000-8000-000000000001` |

Use três segredos aleatórios e diferentes entre si, com pelo menos 32 caracteres cada. Eles ficam só nas variáveis da Railway, nunca no repositório. O `GET /api/val/status` (com sessão) mostra só três booleanos em `credIntegration`: `inboundConfigured`, `outboundConfigured` e `readConfigured`. Nem os valores nem o endereço do VAL Cred aparecem ali.

Ordem para ligar no staging:

1. Configure as variáveis dos dois lados e publique.
2. Confira `credIntegration` em `/api/val/status`.
3. No VAL Cred, cadastre a chave da VAL (`clients.external_key`) e o UUID do consultor no produtor ou na unidade.
4. Na VAL, chame `POST /api/grains/cred-sync` com a sessão do consultor para enviar a SOG que já existe.

## A. Eventos de crédito na VAL

`POST /api/v1/integrations/cred/events` fica fora do login do navegador. A rota ficou ao lado do webhook do Manual e usa o mesmo envelope v1 (`contracts/v1/integration-event.schema.json`). As regras ficam em `server/cred-events.js`:

- **Assinatura.** Só aceita `X-Valor-Signature: sha256=<hex>`, o HMAC-SHA256 dos bytes recebidos. A rota recusa Bearer e o segredo do Manual. Sem `VAL_CRED_WEBHOOK_SECRET`, responde 503.
- **Origem e tenant.** A origem gravada é sempre `val-cred`. O tenant é sempre o da VAL: se o evento trouxer outro `tenantId` ou outro `payload.unit.valTenantId`, a resposta é 403.
- **Tipos aceitos.** `credit.request.updated`, `credit.analysis.completed`, `credit.decision.recorded`, `credit.property.updated` e `cooperative.unit.upserted`. Tipos do Manual recebem 400 nesta rota. Os tipos de crédito também recebem 400 na rota do Manual.
- **Documentos.** Chaves com `cpf`, `cnpj`, `documen`, `passw`, `senha`, `secret` ou `token` são removidas em qualquer profundidade antes do hash.
- **Parecer.** `credit.decision.recorded` exige `humanDecision: true`.
- **Respostas.** 202 para evento novo, 200 `duplicate` para o mesmo `externalId` com o mesmo conteúdo, 409 para o mesmo `externalId` com outro conteúdo, 400/401/403 para recusa definitiva. 503 indica integração desligada ou PostgreSQL fora; nesse caso o VAL Cred tenta de novo.
- **Gravação.** O evento fica em `integration_events` com a idempotência existente e conta como uso `cred_sync`.
- **Sinais.** Crédito não gera sinal, decisão, memória nem contexto da VAL.
- **Propriedade.** `credit.property.updated` só acrescenta `properties.metadata.valCred`, e só numa propriedade que já existe com `propertyExternalKey = <chave do produtor>:<slug do nome>` na carteira do mesmo dono. A VAL nunca cria propriedade a partir desse evento nem muda nome, área ou a sede (`metadata.location`). Um evento mais antigo não sobrescreve um mais novo. A resposta informa `valCredMaterialization`: `APPLIED`, `STALE_IGNORED` ou `NO_TARGET`.
- **Dono.** O dono é o `ownerUserId`, que precisa ser um login ativo do tenant. Sem `ownerUserId`, o evento fica com o administrador inicial e não aparece na ficha do consultor. Esse é sempre o caso de `cooperative.unit.upserted`.

## B. SOG para o VAL Cred

Depois de gravar com sucesso, `PUT /api/grains/profiles`, `POST /api/grains/intents`, `PATCH /api/grains/intents/{id}` e `POST /api/grains/market` publicam o DTO salvo (`server/cred-publisher.js`). A publicação roda depois da resposta. Ela não muda status nem corpo da rota e nunca a derruba.

- **Envelope.** `{schemaVersion:1, type, externalId, occurredAt, source:'val', tenantId, ownerUserId, clientExternalKey, payload}`. Os tipos são `sog.profile.upserted`, `sog.intent.upserted` e `sog.market.snapshot`, mais `val.client.upserted` com o UUID do produtor citado. A cotação não leva `clientExternalKey`.
- **Payload.** Leva uma lista fechada dos campos do contrato, com números como número JSON. Notas, detalhes de fonte, especificação de qualidade, nome do produtor e CPF/CNPJ nunca saem. Número com formato de documento em texto livre vira `[documento omitido]`.
- **externalId.** Muda junto com o conteúdo: `sog-intent:<id>:<updatedAt ms>:<hash>`. Reenviar o mesmo conteúdo dá 200 `duplicate` no VAL Cred. Conteúdo novo nunca causa 409.
- **Falhas.** A VAL não guarda fila de reenvio. Para recuperar, use `POST /api/grains/cred-sync`, que exige sessão e aceita 6 chamadas a cada 10 minutos por consultor. Ela republica o workspace inteiro do consultor e devolve `{enabled, events, summary:{sent, duplicate, conflict, rejected, retry, skipped, invalid}, failures}`.
- **Logs.** Só tipo, `externalId` e resultado. Nunca o payload nem o segredo.

## C. Resumo de crédito na ficha do Cliente 360

`GET /api/clients/{id}/credit` exige sessão. O `{id}` pode ser o UUID ou a `external_key` do produtor. A rota confere a posse primeiro (cliente ativo do consultor logado) e só então consulta o VAL Cred. Produtor de outra carteira recebe 404 sem chamada ao VAL Cred.

- **Resposta.** `{contract, configured, status, summary, events, eventsAvailable, error?}`, consumida por `src/components/CreditSummaryCard.jsx` na aba Negócio.
- **status.** `ok`, `not_linked` (404 no VAL Cred), `unavailable` (VAL Cred fora, token recusado ou resposta fora do contrato) ou `not_configured` (sem `VAL_CRED_BASE_URL` ou `VAL_CRED_READ_TOKEN`; o cartão some).
- **Campos.** Só os do contrato atravessam (`server/cred-client.js`). Um resumo de outro produtor é descartado.
- **Cache.** 60 s para respostas válidas e 10 s para falhas.
- **events.** Últimos eventos `val-cred` do produtor recebidos pela parte A, no escopo do tenant e do login.

## Governança

A decisão de crédito é humana e fica no VAL Cred. A VAL não calcula score, não aprova nada e não recebe documentos. O resumo e os eventos são evidência para o consultor. Eles não alimentam o Decision Copilot, a memória nem o contexto da conversa.

## Testes

- `test/cred-integration-http.test.js`: servidor real com PostgreSQL (PGlite) e um VAL Cred simulado. Cobre assinatura, 503 sem segredo, tipos cruzados, 200/409, materialização, leitura da ficha, ganchos da SOG e o modo desligado.
- `test/cred-events.test.js`, `test/cred-publisher.test.js` e `test/cred-client.test.js`: módulos de cada parte. O de publicação também roda contra os módulos reais do VAL Cred quando `DCREDC149` existe na máquina.
