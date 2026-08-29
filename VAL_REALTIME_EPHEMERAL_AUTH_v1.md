# VAL Realtime — Ephemeral Authentication v1

## Contrato

`POST /api/v1/realtime-voice/sessions` exige cookie de sessão VAL válido e PostgreSQL pronto. O backend valida:

- `identity.id` e `identity.tenantId`;
- usuário admin quando não há allowlist, ou correspondência exata em `VAL_REALTIME_VOICE_TESTERS`;
- rate limit configurável, default 6 criações por usuário/10 minutos;
- reserva disponível dentro do teto de US$ 25.

Somente então o backend usa a `OPENAI_API_KEY` já existente para emitir um client secret de 30 segundos. A resposta ao browser contém `ek_...`, modelo e parâmetros limitados da sessão; a chave permanente nunca é enviada ao frontend, bundle ou logs.

## Isolamento e autorização

- sessão interna indexada por UUID, tenant e owner;
- rotas de uso e turno rejeitam outro tenant/usuário com resposta sem revelar a existência da sessão;
- contexto do produtor é carregado no escopo autenticado;
- tools continuam no Copilot canônico autenticado;
- `OpenAI-Safety-Identifier` é SHA-256 de tenant + usuário, sem PII legível;
- tracing do provider fica desabilitado nesta fase;
- áudio/transcrição não entram em audit logs.

## Rotas auxiliares

- `GET /api/v1/realtime-voice/budget` — tester autorizado, resumo sem conteúdo;
- `POST /api/v1/realtime-voice/sessions/:id/usage` — uso/custo da sessão escopada;
- `POST /api/v1/realtime-voice/sessions/:id/turns` — atualiza somente estado conversacional efêmero, `persistenceMode=NONE`.

Não foi criado ou alterado secret permanente.
