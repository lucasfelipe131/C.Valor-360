# VAL Realtime Natural Voice — Root Cause

Data da análise: 2026-08-29

Branch de correção: `fix/val-realtime-natural-voice-v1`

Baseline preservado: `baca0d678979f376dd389de4e6f86bdb2a97b3a3`

Tree preservada: `926460c776b324547eb8269d0660b4324ec10bee`

## Resultado

O modo chamado de “conversa contínua” no baseline não é uma sessão realtime de áudio. Ele é um encadeamento de turnos completos, dependente das APIs Web Speech do navegador:

```text
SpeechRecognition finito
→ transcript completo
→ POST /api/val/chat
→ resposta textual completa
→ speechSynthesis do navegador
→ nova captura finita
```

No iPhone/Safari observado, a capacidade de reconhecimento exigida por esse fluxo não ficou disponível e o frontend caiu em `FALLBACK` antes de abrir qualquer transporte realtime. O Voice Capture continuou funcional porque usa uma implementação diferente, baseada em `getUserMedia` + `MediaRecorder`.

Portanto, a causa não é simplesmente “permissão do microfone”. A causa estrutural é usar `SpeechRecognition`/`webkitSpeechRecognition` como único provider do modo conversa e chamar isso de realtime, sem transporte de áudio, VAD acústico, resposta incremental ou canal de interrupção.

## Evidência reproduzida

### Dispositivo e navegador

- dispositivo físico: iPhone;
- navegador: Safari;
- user agent registrado pelo staging: Safari Mobile, iPhone, `Version/26.5.2`, string de sistema `iPhone OS 18_7`;
- mensagens apresentadas: “Erro no modo conversa”, “Microfone desligado” e “O modo contínuo não está disponível agora”;
- fallback oferecido: “Apertar para falar”.

### Rede e backend no mesmo período

O staging recebeu o fluxo de Voice Capture:

| Operação | Resultado | Latência observada |
|---|---:|---:|
| criar voice interaction | 201 | 26 ms |
| enviar áudio | 200 | 789 ms |
| processar áudio | 200 | 2.513 ms |
| cancelar interaction | 200 | 55 ms |

O `POST /api/val/chat` associado à experiência foi encerrado pelo cliente com HTTP 499 após 38.548 ms. Não houve chamada a endpoint WebSocket, WebRTC ou sessão realtime porque nenhum desses endpoints existe no baseline.

Conclusões suportadas por essa evidência:

1. o dispositivo conseguiu conceder/capturar microfone no fluxo MediaRecorder;
2. o modo conversa falhou antes de estabelecer transporte realtime;
3. a resposta textual completa pode ocupar dezenas de segundos, e o TTS só começa depois dela;
4. `SPEECH_END_TO_FIRST_AUDIO` não pode atingir a meta de 1–2 s nesse critical path.

O telemetry atual não permite afirmar qual subcapacidade Web Speech faltou naquele instante — interface ausente, serviço de reconhecimento indisponível, Siri/configuração, contexto PWA ou erro de inicialização. Esse detalhe precisa ser capturado no cliente por capability diagnostics em uma futura implementação. Não há evidência para atribuir a falha somente a uma permissão negada.

## Evidência no código

| Componente | Estado do baseline | Impacto |
|---|---|---|
| entrada | `SpeechRecognition` ou `webkitSpeechRecognition` | disponibilidade varia por Safari/contexto/serviço |
| captura realtime | inexistente | não há áudio incremental |
| transporte | inexistente | não há WebRTC/WebSocket de áudio |
| detecção de turno | resultado final ou timer de 1.250 ms | não é VAD acústico/adaptativo |
| raciocínio | `/api/val/chat` não streaming | primeiro texto aguarda payload completo |
| TTS | `speechSynthesis` após texto completo | não há first-audio progressivo |
| barge-in | botão explícito | o microfone fica desligado enquanto a VAL fala |
| fallback | push-to-talk/texto | preserva uso, mas não é conversa contínua |
| feature flag | nenhuma no Railway | a falha não foi causada por flag remota conhecida |

Arquivos canônicos auditados:

- `src/hooks/useRealtimeConversation.js`;
- `src/lib/realtime-conversation.js`;
- `src/components/copilot/ValRealtimeConversation.jsx`;
- `src/hooks/useSpeechSynthesis.js`;
- `src/hooks/useVoiceRecorder.js`;
- `src/components/GlobalValCopilot.jsx`;
- `VAL_REALTIME_VOICE_CONVERSATION_v1.md`.

## Compatibilidade Safari/iOS

O Safari possui suporte a reconhecimento de fala em determinadas versões e condições, mas esse suporte depende de capacidades e serviços do sistema, e já teve diferenças entre Safari normal e aplicações adicionadas à tela inicial. Isso torna a Web Speech API inadequada como única fundação garantida para o modo de conversa da VAL.

Referências primárias:

- WebKit, suporte a SpeechRecognition no Safari 14.1 e dependência de Siri: https://webkit.org/blog/11648/new-webkit-features-in-safari-14-1/
- WebKit bug 225298, histórico de indisponibilidade em home-screen web apps: https://bugs.webkit.org/show_bug.cgi?id=225298
- WebKit STP 166, correção de encerramento após um único enunciado: https://webkit.org/blog/13964/release-notes-for-safari-technology-preview-166/
- WebKit Safari 18.4, mudanças de captura WebRTC e user activation: https://webkit.org/blog/16574/webkit-features-in-safari-18-4/

## Causa raiz

### Proximal

`useRealtimeConversation` só inicia quando entrada Web Speech e saída `speechSynthesis` estão disponíveis. Caso contrário, emite o motivo genérico `VOICE_UNAVAILABLE`. O staging físico atingiu esse caminho e não registrou qual capability falhou.

### Estrutural

O baseline implementa Voice Turn encadeado, não Realtime Voice. Ele não contém os componentes necessários ao objetivo autorizado:

- stream bidirecional de áudio;
- sessão realtime stateful;
- VAD/turn detection real;
- transcript parcial/final do transporte;
- áudio de saída incremental;
- cancelamento da resposta ao detectar fala;
- canal seguro de eventos e tool calls;
- first-audio independente do término da resposta textual inteira.

### Latência

O maior gargalo comprovado é aguardar o pipeline completo de `/api/val/chat` e só então iniciar TTS. O HTTP 499 após 38,548 s demonstra um caso fisicamente inutilizável. Otimizações locais de rearm ou do silêncio de 1.250 ms não corrigem esse critical path.

## Limite de correção sem novo custo

Sem adotar um transporte/provider realtime, é possível melhorar diagnóstico, mensagens, retry e fallback, mas não cumprir honestamente:

- conversa sem envio manual e robusta em iOS/PWA;
- VAD adaptativo;
- áudio de saída incremental;
- barge-in espontâneo;
- `SPEECH_END_TO_FIRST_AUDIO` próximo de 1–2 s;
- classificação Natural Realtime Voice.

Essas melhorias isoladas continuariam sendo Voice Turn/Voice Capture aprimorado e não devem ser rotuladas como realtime.

## Resolução autorizada

Após esta análise, foi autorizado exclusivamente em staging o modelo `gpt-realtime-2.1-mini`, WebRTC, endpoint autenticado de client secret efêmero e teto de US$ 25. A correção local implementa esse desenho atrás de flag default-off, sem novo secret permanente e preservando Push-to-talk.

A causa raiz está tecnicamente endereçada no código. CI remoto, deploy e UAT físico permanecem obrigatórios para provar que Safari/PWA e Android estabelecem a sessão, executam VAD/barge-in e atingem latência aceitável.

Status: `ROOT_CAUSE_CONFIRMED / LOCAL_IMPLEMENTATION_COMPLETE / PHYSICAL_UAT_PENDING`.
