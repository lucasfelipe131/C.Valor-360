# VAL Natural Realtime Voice — WebRTC Implementation v1

Data: 2026-08-29

Branch: `fix/val-realtime-natural-voice-v1`

Base: `baca0d678979f376dd389de4e6f86bdb2a97b3a3`

## Resultado técnico local

Foi implementado um transporte WebRTC browser → OpenAI Realtime, atrás de `VAL_REALTIME_VOICE_ENABLED` com default `false`. O modo legado Push-to-talk/Voice Capture permanece disponível e é o fallback seguro.

Fluxo:

1. usuário autenticado inicia Modo conversa;
2. backend valida tenant, tester, PostgreSQL, rate limit e orçamento;
3. backend emite client secret de 30 segundos para `gpt-realtime-2.1-mini`;
4. browser captura áudio com `getUserMedia`, abre `RTCPeerConnection` e data channel;
5. `semantic_vad` detecta turnos e inicia respostas;
6. áudio remoto toca incrementalmente;
7. nova fala cancela a resposta ativa (`interrupt_response=true`); também há cancelamento manual;
8. falha encerra tracks/conexão e oferece Push-to-talk.

## Estados de UI

`CONECTANDO`, `OUVINDO`, `PENSANDO`, `FALANDO`, `PAUSADO`, `FALLBACK` e `ERRO`. O indicador informa explicitamente quando o microfone está ativo; Pausar/Sair desligam a captura.

## Continuidade e capacidades

- usa `current_client`, ContextSnapshot, memória, visitas, compromissos, oportunidades, propriedades e estado conversacional canônicos;
- respostas de voz entram na mesma thread do Copilot;
- tool calls passam pelo `/api/val/chat` e routers/adapters já governados;
- memória chama somente a revisão existente; nenhuma gravação automática foi adicionada;
- transcrição é bastidor e não exige Enviar em cada turno.

## Fallback

- flag desligada: comportamento legado preservado;
- WebRTC/microfone/provider indisponível: mensagem diagnosticável + retry + Push-to-talk + texto;
- Voice Capture longo permanece separado.

## Evidência local

- testes: 985/985 PASS;
- build VAL/PWA: PASS;
- validação PWA: PASS;
- Manual: PASS após descartar cache Turbopack corrompido;
- bundle audit: PASS; inicial JS 217.273 bytes (69.481 gzip), maior chunk de aplicação 409.146 bytes (123.026 gzip);
- golden voice automatizado: PASS, com UAT físico explicitamente pendente.

Não houve sessão paga nem deploy nesta evidência.
