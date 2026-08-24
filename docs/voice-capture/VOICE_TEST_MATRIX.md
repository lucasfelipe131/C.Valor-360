# Matriz de testes — Voice Capture

Base: `b5967758428dc501d97407bb50d2cdb200c4ade7` em `integration/val-v1-staging`.

Branch: `feature/voice-capture`.

Status: automação local e gate CI implementados; este documento não aprova o gate.

## Como ler a evidência

| Marca | Significado |
|---|---|
| `LOCAL` | existe teste automatizado local com mock/fallback ou análise de contrato |
| `PG-CI` | cenário existe no verificador PostgreSQL 16 do workflow, mas a execução remota final ainda não foi registrada |
| `STAGING` | precisa ser executado no ambiente implantado |
| `MOBILE` | exige dispositivo físico; CSS/SSR não substituem essa prova |

Os testes locais com cliente OpenAI simulado comprovam o adapter, não uma chamada real. O teste `voice-capture-api-surface` comprova ligação de rotas/OpenAPI e o client usa `fetch` simulado; ele não é um smoke HTTP com servidor e banco reais.

## Matriz 34/34

| # | Requisito | Evidência implementada | Evidência ainda necessária |
|---:|---|---|---|
| 1 | áudio pré-visita | `LOCAL` service/frontend; `PG-CI` PRE + PrepareVisit | `STAGING` áudio real pela UI |
| 2 | áudio pós-visita | `LOCAL` service/frontend; `PG-CI` POST/Visit Loop | `STAGING` fluxo completo |
| 3 | áudio Cliente 360 | `LOCAL` service/frontend; `PG-CI` CLIENT_NOTE | `STAGING` UI e refresh real |
| 4 | observação de campo | `LOCAL` service/extraction/frontend; `PG-CI` FIELD_NOTE | `STAGING` lifecycle/UX |
| 5 | transcrição bem-sucedida | `LOCAL` adapter com cliente simulado e mock de service | OpenAI real em `STAGING` |
| 6 | transcrição falha | `LOCAL` falha segura, áudio preservado | falha real/controlada em `STAGING` |
| 7 | retry | `LOCAL` mesma interação, tentativa nova, lease e worker obsoleto | retry com provider real |
| 8 | usuário cancela | `LOCAL` service, hook e UI | `STAGING` durante upload/processamento |
| 9 | transcript não vira fato automaticamente | `LOCAL` comparação pré-confirmação; `PG-CI` contagens de domínio | confirmar no banco de staging |
| 10 | fato confirmado entra na MMI | `LOCAL` service; `PG-CI` memória após confirmação | inspeção funcional em staging |
| 11 | fato rejeitado não entra | `LOCAL` revisão/rejeição e ausência de memória | fluxo de edição na UI implantada |
| 12 | usuário edita extração | `LOCAL` service/frontend, inicial separado da revisão | navegador real |
| 13 | compromisso candidato confirmado | `LOCAL` prazo/owner/critério; `PG-CI` Commitment | UI e calendário em staging |
| 14 | oportunidade candidata | `LOCAL` sem efeito prévio e `REQUIRES_MIA`; `PG-CI` | interface/pipeline em staging |
| 15 | perfil recebe sinal observável | `LOCAL` extractor/service; `PG-CI` preparação usa evidência | inspeção MIC/contexto em staging |
| 16 | áudio não altera fatos técnicos | `LOCAL` safety/epistemologia e zero domínio pré-confirmação | comparação de snapshots em staging |
| 17 | relato agronômico não vira prescrição | `LOCAL` extractor, revisão e memória; `PG-CI` | teste funcional de safety |
| 18 | cross-tenant de áudio bloqueado | `LOCAL` storage/repository; `PG-CI` FK e leitura negativa | teste HTTP negativo em staging |
| 19 | cross-tenant de transcript bloqueado | `LOCAL` repository; `PG-CI` ator/tenant/FKs | teste HTTP negativo em staging |
| 20 | logs sem conteúdo sensível | `LOCAL` observability allowlist | inspeção de logs Railway/OpenAI |
| 21 | segunda visita melhora | `LOCAL` service/preparation; `PG-CI` comparação e seis sinais | jornada real em staging |
| 22 | pré-visita atualiza PrepareVisit | `LOCAL` versionamento/idempotência; `PG-CI` | UI implantada e versão anterior |
| 23 | áudio sem visita atualiza Cliente 360 | `LOCAL` CLIENT_NOTE; `PG-CI` | Cliente 360 em staging |
| 24 | transcrição maliciosa não altera instruções | `LOCAL` extractor/service adversarial | smoke adversarial em staging |
| 25 | arquivo inválido rejeitado | `LOCAL` MIME, assinatura, base64 e container | codecs reais dos browsers |
| 26 | limite de tamanho | `LOCAL` fronteira 6.000.000 e +1 byte; OpenAPI 413 | request real no proxy/staging |
| 27 | limite de duração | `LOCAL` inclui `ffprobe` real com WAV sintético e probes injetados de fronteira | validar codecs reais e proxy em staging |
| 28 | experiência mobile | `LOCAL` SSR/hook/CSS/ARIA/lifecycle | `STAGING` viewport + `MOBILE` iOS/Android/PWA |
| 29 | fallback para texto | `LOCAL` service/frontend, sem storage/provider | `STAGING` permissão negada/provider indisponível |
| 30 | compatibilidade Visit Report v1 | `LOCAL` adapter/Phase 6; `PG-CI` source/ref/atomicidade | staging com dados fictícios |
| 31 | compatibilidade ContextSnapshot | `LOCAL` memória/preparação + regressão da Fase 3; `PG-CI` | staging |
| 32 | compatibilidade Commitment | `LOCAL` contrato/service + regressão da Fase 5; `PG-CI` | staging |
| 33 | compatibilidade Outcome | `LOCAL` somente POST + regressão da Fase 6; `PG-CI` | staging |
| 34 | compatibilidade LearningCandidate | `LOCAL` POST, status CANDIDATE e negativo por tipo; `PG-CI` | staging; provar zero promoção |

## Arquivos reais de teste

| Arquivo | Cobertura |
|---|---|
| `test/voice-capture-contracts.test.js` | schemas, enums, estados, retry e terminais |
| `test/voice-capture-extraction.test.js` | structured output, fallback, prompt injection, safety e epistemologia |
| `test/voice-capture-storage.test.js` | MIME/assinatura, limites, `ffprobe` real com WAV sintético, probes de fronteira, escopo e metadata |
| `test/voice-capture-transcription-provider.test.js` | SDK simulado, multipart, metadata e erros |
| `test/voice-capture-service.test.js` | PRE/FIELD/POST/CLIENT, confirmação, retry, leases e efeitos |
| `test/voice-capture-repository-fallback.test.js` | tenant/ator, CAS, tentativa e anexo exclusivo no fallback |
| `test/voice-capture-migration-contract.test.js` | expansão, FKs, índices e constraints por inspeção SQL |
| `test/voice-capture-api-surface.test.js` | rotas, autenticação, OpenAPI e compatibilidade aditiva por inspeção/client mock |
| `test/voice-capture-frontend.test.js` | superfícies, lifecycle, recorder, revisão, retomada e mobile contratual |
| `test/voice-capture-observability.test.js` | allowlist e ausência de conteúdo |
| `test/voice-capture-postgres-gate-contract.test.js` | contrato estático do seed, verificador e workflow PG16 |
| `test/voice-capture-visit-start.test.js` | transição tenant-safe/idempotente para IN_PROGRESS, UI, rota e OpenAPI |

Não existe `test/voice-capture-repository.test.js` nem `scripts/voice-capture-smoke.mjs`. Não se deve citar esses nomes como evidência.

## Evidência local registrada até esta revisão

Resultado consolidado local:

- `npm test`: 600/600;
- conjunto Voice Capture: 92/92;
- regressões explícitas das Fases 02–06: 164/164;
- build Vite/PWA: aprovado;
- build Manual: aprovado.
- storage com `ffprobe` real: 10/10.

Durante o hardening, também passaram execuções focadas, incluindo:

```bash
node --test test/voice-capture-service.test.js test/voice-capture-postgres-gate-contract.test.js
```

Resultado registrado para essa execução: 30/30.

Também houve execução focada de contratos/service/preparação/acesso com 50/50. Os smokes HTTP locais não executaram por restrição de rede do sandbox; precisam ser executados em CI/staging e não são considerados aprovados por esta matriz.

## Gate PostgreSQL 16 configurado

O job `voice-capture-gate-postgres` em `.github/workflows/validate.yml` contém:

1. serviço `postgres:16`;
2. aplicação do schema e migrations;
3. seed exclusivamente sintético;
4. reaplicação da migration 005 e comparação de contagens/schema;
5. drift strict;
6. `scripts/voice-capture-postgres-verify.mjs` em modo source;
7. PRE, FIELD, CLIENT e POST;
8. ausência de domínio pré-confirmação;
9. confirmação POST concorrente exactly-once;
10. isolamento tenant/ator e FKs negativas;
11. segunda preparação com seis evidências e score maior;
12. zero `VALIDATED_KNOWLEDGE` e LearningCandidate somente `CANDIDATE`;
13. backup, restore em outro banco e revalidação/fingerprint.

O verificador também inicia a visita de forma idempotente antes de FIELD/POST, comprovando que esses contextos são alcançáveis no lifecycle sintético.

Esse job está **configurado, não executado/registrado** nesta branch local. O teste estático do YAML não equivale ao PostgreSQL real. O verificador PG injeta duração determinística; a execução de `ffprobe` real é coberta localmente por WAV sintético, enquanto codecs produzidos pelo navegador continuam pertencendo ao staging.

## Núcleo da regressão executada localmente

```bash
npm test
node --test test/phase2-*.test.js
node --test test/phase3-*.test.js
node --test test/phase4-*.test.js
node --test test/phase5-*.test.js
node --test test/phase6-migration-contract.test.js test/phase6-visit-loop.test.js
npm run build
```

O build de `manual` e o build Vite/PWA também passaram. Estes smokes HTTP permanecem pendentes fora do sandbox:

```bash
npm run test:phase2:smoke
npm run test:phase5:smoke
npm run test:phase6:smoke
```

O gate final deve registrar cada evidência em `GATE_VOICE_CAPTURE_RESULTADO.md`.

## Roteiro de staging

Com produtor e áudio fictícios:

1. validar `/health` e migrations;
2. Cliente 360 → CLIENT_NOTE → revisar/confirmar;
3. visita planejada/preparada → PRE_VISIT → nova versão;
4. visita em andamento → FIELD_NOTE;
5. pós-visita → POST_VISIT → compromisso/outcome/learning;
6. nova preparação → comprovar preço, comparativo, sócio, compromisso, perguntas e provas;
7. falha/retry e fallback textual;
8. cross-tenant negativo por HTTP;
9. logs sem conteúdo;
10. viewport móvel e depois dispositivo físico.

## Critério de aprovação

O gate só pode ser aprovado depois de:

- suíte consolidada e builds verdes;
- job PostgreSQL 16 executado e evidência preservada;
- transcrição OpenAI real em staging com áudio fictício;
- fluxo integral pela interface;
- segunda preparação materialmente melhor;
- microfone físico em iOS e Android/PWA suportados;
- logs, tenancy e safety validados;
- nenhuma promoção automática de conhecimento.

Enquanto essas provas externas estiverem pendentes, esta matriz é cobertura implementada, não aprovação.
