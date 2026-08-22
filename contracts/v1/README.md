# Contratos canônicos v1 do VAL Core

Os contratos desta pasta são aditivos e versionados. Eles não substituem os payloads públicos históricos.

- `request-envelope.schema.json`: envelope interno montado pelo servidor. Tenant, ator e escopo nunca são aceitos do corpo enviado pelo navegador.
- `response-envelope.schema.json`: resposta canônica do endpoint `/api/v1/val/recommendations`.
- `memory-record.schema.json`: registro canônico aditivo da MMI; separa natureza da memória, estado epistemológico, origem, validade, confiança, ACL e supersessão.
- `context-snapshot.schema.json`: contexto mínimo, autorizado e rastreável selecionado pelo MCTX, persistido como entidade de primeira classe com auditoria de refs selecionadas/excluídas e políticas de freshness por domínio/fonte.
- contratos antigos permanecem disponíveis em `/api/val/chat` e `/api/val/recommendations` por meio do adaptador legado.

Uma futura versão deve receber novo identificador e novos arquivos. Os schemas v1 não podem ser alterados de forma incompatível.
