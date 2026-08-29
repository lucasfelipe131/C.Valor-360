# VAL Realtime Natural Voice — Architecture Decision v1

Status: `IMPLEMENTADA LOCALMENTE — STAGING/UAT PENDENTES`

Data: 2026-08-29

Baseline: `baca0d678979f376dd389de4e6f86bdb2a97b3a3`

## Decisão autorizada

Foi autorizado exclusivamente em staging: WebRTC, `gpt-realtime-2.1-mini`, teto de US$ 25, client secret efêmero e reutilização da chave backend existente. A flag continua desligada por padrão.

## Alternativas

| Alternativa | Experiência possível | iOS/PWA | Barge-in | Custo novo | Classificação honesta |
|---|---|---|---|---|---|
| manter Web Speech e melhorar fallback | turnos encadeados quando o browser suporta | não garantido | somente botão | não | Level 1–2 |
| OpenAI Realtime por WebRTC | áudio incremental, VAD, TTS streaming e interrupção | rota recomendada para browser | sim | sim, uso medido | candidato a Level 4 |
| WebSocket server-side | streaming controlado pelo servidor | mais trabalho de mídia no browser | possível | sim, uso + infraestrutura | candidato a Level 4 |
| stack própria STT/VAD/TTS | controle máximo | depende da implementação | possível | sim, infraestrutura/operação | candidato a Level 4 |

Não é aceitável fragmentar blobs e usar polling agressivo para rotular o resultado como realtime.

## Arquitetura implementada

1. O usuário autenticado inicia “Modo conversa”.
2. O backend valida sessão, tenant, entitlement e política de safety.
3. O backend cria client secret efêmero no provider, associando identificador estável e privacy-safe.
4. O navegador abre `RTCPeerConnection`, captura microfone com `getUserMedia` e recebe áudio remoto.
5. O data channel transporta eventos de sessão, transcript, turn detection, tool calls e métricas sem revelar a chave padrão.
6. VAD do servidor detecta início/fim de fala; interrupção cancela a resposta ativa.
7. Tool calls retornam ao Copilot canônico no navegador, que chama os routers/adapters autenticados existentes; o modelo não recebe execução irrestrita.
8. Falha de capability, conexão ou provider encerra tracks e volta explicitamente a Push-to-talk.

Referências oficiais:

- WebRTC e client secret efêmero: https://developers.openai.com/api/docs/guides/realtime-webrtc
- Voice agents, low latency e barge-in: https://developers.openai.com/api/docs/guides/voice-agents
- Conversas, VAD e sessões stateful: https://developers.openai.com/api/docs/guides/realtime-conversations
- Controles server-side e tools: https://developers.openai.com/api/docs/guides/realtime-server-controls
- Safety identifiers: https://developers.openai.com/api/docs/guides/safety-best-practices

## Segurança e tenancy obrigatórias

- chave padrão somente no servidor;
- client secret efêmero, curto e vinculado à sessão autenticada;
- `OpenAI-Safety-Identifier` derivado de identificador interno com hash;
- nenhuma credencial persistida no frontend ou logs;
- tools executadas apenas pelo backend sob tenant/actor atuais;
- troca de produtor invalida o contexto incompatível;
- fatos e memória continuam exigindo confirmação explícita;
- áudio e transcript não devem ser logados por padrão;
- encerramento/fallback deve parar todos os media tracks;
- rate limit, timeout, session cap e budget por tenant antes de staging.

## Impacto de custo conhecido

Preços oficiais consultados em 2026-08-29, por 1 milhão de tokens:

| Modelo | Áudio de entrada | Áudio em cache | Áudio de saída | Texto de entrada | Texto de saída |
|---|---:|---:|---:|---:|---:|
| `gpt-realtime-2.1` | US$ 32,00 | US$ 0,40 | US$ 64,00 | US$ 4,00 | US$ 24,00 |
| `gpt-realtime-2.1-mini` | US$ 10,00 | US$ 0,30 | US$ 20,00 | US$ 0,60 | US$ 2,40 |

Fonte oficial: https://developers.openai.com/api/docs/pricing

O custo por conversa real depende de duração, tokens de áudio, cache, tamanho do contexto e tool calls. Não há dados de uso suficientes para fixar um orçamento nesta etapa. Antes de habilitar staging, a implementação deve incluir medição e limites de gasto.

## Benefício esperado

- remove upload/transcrição/chat/TTS serial como critical path do modo conversa;
- permite first-audio incremental;
- suporta turn detection e barge-in reais;
- melhora compatibilidade do transporte ao usar WebRTC em vez de depender de `SpeechRecognition`;
- preserva Push-to-talk para áudios longos e fallback.

## Riscos

- novo consumo faturável de áudio e texto;
- nova superfície de sessão efêmera e WebRTC;
- integração cuidadosa de tools, memória e contexto comercial/agronômico;
- variação de autoplay/audio session entre Safari e PWA;
- necessidade de UAT físico iPhone e Android antes de qualquer aprovação;
- risco de resposta rápida porém genérica, mitigado por testes de specificity, grounding e decision quality.

## Sequência de ativação controlada

1. testes, builds e revisão local;
2. commit/push somente da branch de correção;
3. CI remoto verde;
4. ativar `VAL_REALTIME_VOICE_ENABLED=true` somente no serviço Railway staging;
5. desktop UAT;
6. iPhone e Android físicos;
7. manter gate reprovado enquanto a evidência física estiver ausente.

## Limite atual

Não houve chamada paga nesta etapa local. Consumo medido: US$ 0. Deploy, latência real e UAT físico ainda não foram executados; portanto a arquitetura é candidata a Level 4, não evidência de Level 4.
