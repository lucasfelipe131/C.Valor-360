# Gate — Voice Capture da VAL

Data da decisão: 2026-08-23 (`America/Sao_Paulo`).

## Resultado

**GATE VOICE CAPTURE REPROVADO**

O VCE está implementado, integrado aos módulos existentes e implantado exclusivamente no staging. A classificação é reprovada porque o gate exige todas as evidências e ainda não foram concluídos: (a) a jornada autenticada completa, da gravação à confirmação e à segunda preparação, pela interface implantada; e (b) o teste de microfone em dispositivos físicos iOS e Android/PWA. Testes automatizados de UI, CSS e lifecycle não substituem essas duas provas humanas.

Esta reprovação não indica falha conhecida de código, CI, banco, transcrição ou safety. Ela impede uma aprovação baseada somente em automação.

## Escopo e rastreabilidade

| Item | Evidência |
|---|---|
| base aprovada | `integration/val-v1-staging@b5967758428dc501d97407bb50d2cdb200c4ade7`, árvore `3ecc2252fec5ac3a4d410039812037fcc6e3b764` |
| branch | `feature/voice-capture`, criada da integração e não de `main` |
| implementação local auditada | `d54973bc99e3b3067b26f11b559bb7c12b4a2686`, árvore `e59d068582603dba0e5d468006c5eb06d0a9f911` |
| implementação remota auditada | `089e226a5c98f6c33e8d0fdd345e70919dc9e194`, mesma árvore da implementação local |
| PR | [#86 — Voice Capture](https://github.com/lucasfelipe131/C.Valor-360/pull/86), mantido em DRAFT contra `integration/val-v1-staging` |
| CI final da implementação | [Validate #178](https://github.com/lucasfelipe131/C.Valor-360/actions/runs/32679897601), concluído com sucesso |
| staging | [VAL — staging](https://val-web-staging-production.up.railway.app/), serviço `val-web-staging` no projeto isolado `VAL - STAGING INTEGRATION 01` |
| banco | PostgreSQL 16 exclusivo de staging, um volume, cinco migrations verificadas |
| deploy auditado | `c3f8482d-851c-48fc-9cb7-95b709949e5c`; commit `089e226…`, PostgreSQL `16.15`, migrations `001–005` presentes e `/live` em `200` |

O nome de ambiente padrão exibido pela Railway dentro do projeto isolado não representa a produção da VAL. Nenhum deploy, banco, secret ou dado de produção foi acessado ou alterado.

## Evidência executada

- `npm test`: **601/601**;
- conjunto Voice Capture: **93/93**;
- regressões explícitas das Fases 02–06: **164/164**;
- build principal/PWA e build Manual: aprovados;
- `ffprobe` real com WAV sintético e validações de storage: **10/10**;
- limite do storage: 6.000.000 bytes aceitos e 6.000.001 rejeitados; limite HTTP configurado retorna JSON `413` sem destruir a conexão;
- PostgreSQL 16 no CI: migrations em ordem e reaplicação sem drift, isolamento tenant/ator, atomicidade, PRE/FIELD/CLIENT/POST, segunda preparação melhor, backup e restore em outro banco;
- ausência de promoção automática para `KnowledgeItem`/conhecimento validado;
- Railway: aplicação ativa, cinco migrations reconhecidas e health interno `/live` em `200`;
- OpenAI real no staging: transcrição concluída com `provider=openai`, `model=gpt-transcribe`, idioma `pt`, sem expor transcript ou chave na saída do smoke;
- áudio fictício/público usado somente no smoke do provider: [Pt-br-saudade.ogg, por Aliphee, CC BY-SA 4.0](https://commons.wikimedia.org/wiki/File:Pt-br-saudade.ogg).

Nenhum produtor, conversa ou dado real foi usado no smoke de voz. O smoke do provider foi isolado e não criou `VoiceInteraction`; o staging permaneceu com zero interações de voz, Outcomes e LearningCandidates antes da jornada humana.

## Avaliação dos 18 critérios do gate

| # | Critério | Estado | Evidência ou lacuna |
|---:|---|---|---|
| 1 | consultor grava pelo celular | **REPROVADO** | UI, hook, recorder e CSS aprovados por teste; falta microfone em dispositivo físico |
| 2 | pré-visita aceita áudio | **PARCIAL** | service, UI e PG16 aprovados; falta jornada autenticada implantada |
| 3 | pós-visita aceita áudio | **PARCIAL** | Visit Report/Outcome/Learning aprovados por teste e PG16; falta jornada autenticada implantada |
| 4 | Cliente 360 aceita áudio | **PARCIAL** | CLIENT_NOTE e UI aprovados; falta confirmação funcional implantada |
| 5 | transcrição funciona | **APROVADO TÉCNICO** | provider OpenAI real aprovado; E2E da aplicação ainda pendente |
| 6 | falha degrada com segurança | **APROVADO EM AUTOMAÇÃO** | áudio preservado, retry, lease, cancelamento e fallback cobertos; UI real pendente |
| 7 | informação exige confirmação | **APROVADO** | domínio permanece inalterado até `CONFIRMED` |
| 8 | memória só muda após confirmação | **APROVADO** | testes locais e PostgreSQL 16 |
| 9 | Commitment nasce da confirmação | **APROVADO** | contrato, transação e gate PostgreSQL 16 |
| 10 | oportunidade pode ser detectada | **APROVADO** | candidato e evidência `REQUIRES_MIA`, sem prescrição |
| 11 | MMI/MCTX recebem corretamente | **APROVADO** | memória, ContextSnapshot e nova versão de PrepareVisit no gate PG16 |
| 12 | perfil usa apenas sinais observáveis | **APROVADO** | tom, emoção, sotaque, gênero e idade são bloqueados |
| 13 | safety agronômico permanece | **APROVADO** | observação relatada não vira produto, dose ou manejo |
| 14 | cross-tenant permanece bloqueado | **APROVADO TÉCNICO** | service, repositório, FKs e PG16 aprovados; negativo HTTP implantado pendente |
| 15 | segunda preparação melhora | **APROVADO TÉCNICO** | PG16 comprovou seis evidências e score maior; falta repetição pela UI para fechar UX |
| 16 | UX permanece simples | **REPROVADO** | launcher contextual, recorder e revisão responsiva existem; falta avaliação humana em mobile físico |
| 17 | suíte completa passa | **APROVADO** | 601/601 e regressões 02–06 verdes |
| 18 | builds passam | **APROVADO** | principal/PWA e Manual verdes localmente e no CI |

## Controles preservados

- nenhuma gravação automática ou secreta;
- transcript tratado como dado não confiável, nunca como instrução de sistema;
- nenhuma inferência psicológica, vocal ou sensível;
- nenhuma recomendação agronômica automática;
- nenhuma escrita material antes da confirmação humana;
- áudio bruto temporariamente em storage abstrato sobre attachment/PostgreSQL, com object storage privado documentado como destino futuro;
- nenhum recurso pago adicional criado;
- nenhuma chave OpenAI em código, commit, relatório ou chat;
- nenhuma alteração em `main`, produção ou Passo 07.

## Condições objetivas para uma nova avaliação

1. executar no staging, com produtor exclusivamente fictício, PRE_VISIT → revisão → confirmação → FIELD_NOTE → POST_VISIT → Commitment/Outcome/LearningCandidate → segunda preparação;
2. confirmar na interface que edição, remoção, adição, cancelamento, retry e fallback textual funcionam;
3. repetir a captura com microfone físico em iOS e Android/PWA suportados, incluindo permissão negada e reconexão;
4. validar codecs realmente gerados por esses navegadores no container de staging;
5. executar negativos HTTP cross-tenant para áudio e transcript;
6. inspecionar logs do fluxo integral para confirmar a ausência de áudio, transcript e secrets;
7. registrar duração, clareza, quantidade de toques e eventuais gaps sem redesign amplo;
8. reemitir este gate somente se todas as provas forem aprovadas.

## Parada obrigatória

O trabalho termina nesta branch e neste staging. O PR permanece DRAFT. Não promover para produção, não fazer merge em `main` e não iniciar o Passo 07 sem autorização explícita.

**GATE VOICE CAPTURE REPROVADO**
