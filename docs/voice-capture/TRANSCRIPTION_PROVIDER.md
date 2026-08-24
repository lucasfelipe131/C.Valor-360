# TranscriptionProvider

Status: porta e adapters implementados em `server/voice-capture/transcription-provider.js`; integração real em staging ainda não comprovada.

## Objetivo

`TranscriptionProvider` desacopla o Voice Capture do fornecedor e do modelo. Ele somente transforma bytes de áudio validados em transcript e metadata. Extração, memória, Visit Report e confirmação ficam fora dessa porta.

## Interface implementada

Forma semântica do JavaScript atual:

```ts
interface TranscriptionProvider {
  name: string;
  model: string;
  version: string;
  requiresVerifiedDuration: boolean;
  transcribe(input: {
    bytes?: Buffer | Uint8Array;
    buffer?: Buffer | Uint8Array;
    mimeType: string;
    originalName?: string;
    language?: string;
    durationSeconds?: number;
    signal?: AbortSignal;
  }): Promise<{
    text: string;
    provider: string;
    model: string;
    version: string;
    provider_reference: string | null;
    language: string | null;
    duration_seconds: number | null;
    confidence: number | null;
    status: "COMPLETED";
    error: null;
  }>;
}
```

Tenant, ator e autorização não são argumentos da porta: o `VoiceCaptureService` e o storage já os validaram antes da chamada. A porta não acessa banco nem sessão.

## Adapters implementados

### OpenAI

`OpenAITranscriptionProvider` usa o SDK server-side e `client.audio.transcriptions.create` com:

- arquivo multipart criado a partir dos bytes;
- `model` configurável, padrão `gpt-transcribe`;
- `response_format: json`;
- idioma normalizado para o código primário, quando informado;
- `maxRetries: 0` no SDK; retry é governado pela VoiceInteraction;
- timeout entre 5 e 120 segundos;
- `AbortSignal` quando fornecido.

Ele não recebe dossiê do produtor, histórico, prompt da VAL nem secret pelo input. A chave pertence ao cliente OpenAI criado no servidor.

### Mock

`MockTranscriptionProvider` permite texto determinístico, falha controlada e metadata em testes. Ele é injetado diretamente; não existe seleção de mock por variável de ambiente no runtime.

### Indisponível

Sem `OPENAI_API_KEY`, o servidor usa `UnavailableTranscriptionProvider`. O processamento de áudio falha de modo recuperável, preserva `audio_ref` e oferece retry/texto. Ele não inventa transcript local.

## Configuração real

| Variável | Uso | Sensível |
|---|---|---:|
| `OPENAI_API_KEY` | habilita cliente OpenAI server-side | sim |
| `OPENAI_PROJECT` | projeto opcional do cliente OpenAI | potencialmente |
| `OPENAI_TIMEOUT_MS` | timeout base; voz limita a 120 s | não |
| `VAL_VOICE_TRANSCRIPTION_MODEL` | modelo de transcrição, padrão `gpt-transcribe` | não |
| `VAL_VOICE_EXTRACTION_MODEL` | modelo separado da extração estruturada | não |
| `VAL_VOICE_MAX_AUDIO_BYTES` | limite configurável, teto 6.000.000 | não |
| `VAL_VOICE_MAX_DURATION_SECONDS` | limite configurável, teto 900 | não |
| `VAL_VOICE_REQUESTS_PER_10_MINUTES` | rate limit das operações de voz | não |

Não existem no código atual `VAL_TRANSCRIPTION_PROVIDER`, `VAL_TRANSCRIPTION_MODEL`, `VAL_TRANSCRIPTION_TIMEOUT_MS` ou `VAL_VOICE_MAX_BYTES`.

## Validação antes da rede

O pipeline valida antes do provider:

1. sessão, tenant, ator, carteira, produtor e visita;
2. estado da interação;
3. posse do `audio_ref`;
4. MIME e assinatura binária;
5. base64/data URL;
6. tamanho máximo de 6.000.000 bytes;
7. duração positiva e no máximo 900 segundos;
8. duração real pelo `ffprobe` no storage;
9. filename sanitizado.

Formatos aceitos pelo storage e pelo adapter:

- `audio/mpeg` e `audio/mp3`;
- `audio/mp4` e `audio/x-m4a`;
- `audio/wav` e `audio/x-wav`;
- `audio/webm`;
- `audio/ogg`.

Aceitação na lista não substitui a validação real do container pelo `ffprobe` nem a prova em staging para cada codec.

## Resultado e persistência

Cada tentativa é gravada em `val_voice_transcripts` com:

- `attempt_no` monotônico por interação;
- provider, model, `provider_version` e referência opaca;
- status;
- transcript somente em tentativa concluída;
- idioma, duração e confidence quando disponíveis;
- código de erro seguro;
- timestamps.

Confidence ausente permanece `null`. O adapter pode derivá-la apenas de `response.confidence` ou `logprobs` fornecidos; não usa valor inventado.

## Retry, concorrência e cancelamento

Falhas classificadas como timeout, rate limit, indisponibilidade/conexão e status 5xx são marcadas como recuperáveis. Arquivo vazio, formato inválido, tamanho e duração não são retry automático.

O retry reutiliza `voice_interaction_id` e `audio_ref`, acrescenta uma tentativa e incrementa `retry_count`. Um lease UUID por etapa é persistido em `related_artifacts.processing_lease`. Antes e depois do provider, o service verifica estado e lease; worker expirado ou abortado não pode persistir sobre um retry mais novo.

O endpoint `POST .../cancel` solicita abort do controller local. Como um provedor remoto pode já ter recebido bytes, cancelamento não equivale a garantia de interrupção no terceiro; ele garante que resultado tardio não seja promovido pelo service quando o estado/lease já mudou.

## Erros reais

`TranscriptionProviderError` expõe somente mensagem segura, `code`, `statusCode`, `safeToRetry` e metadata sanitizada. Códigos possíveis incluem:

- `transcription_provider_unavailable`;
- `unsupported_audio`;
- `empty_audio`;
- `audio_too_large`;
- `invalid_audio_duration`;
- `audio_too_long`;
- códigos sanitizados como `authentication`, `rate_limit`, `timeout`, `cancelled` e `provider_unavailable`.

O `VoiceCaptureService` converte falha da tentativa em `FAILED_TRANSCRIPTION` e responde com `voice_transcription_failed`; corpo bruto do provider, transcript parcial, header ou chave não são retornados.

## Transcript não confiável

O transcript retornado pela porta é dado do usuário. A etapa seguinte:

- o delimita como `<untrusted_transcript>` em `input_text`;
- usa schema estrito de candidatos;
- bloqueia instruções de prompt, atributos sensíveis/vocais e prescrição;
- não executa ferramentas ou comandos presentes na fala;
- exige confirmação humana para todo candidato.

## Evidência

Testes automatizados cobrem multipart do SDK com cliente simulado, metadata, erro HTTP sanitizado, provider ausente e arquivo inválido. Testes de service cobrem sucesso com mock, falha, retry, cancelamento, lease expirado e worker tardio.

Ainda pendente para o gate:

- chamada real com chave exclusiva de staging e áudio fictício;
- verificação dos codecs realmente produzidos pelos navegadores-alvo;
- execução dos codecs realmente gerados pelos navegadores no container de staging; o `ffprobe` real já passou localmente com WAV sintético;
- latência e UX de retry no ambiente implantado;
- confirmação de que nenhum conteúdo aparece nos logs externos do staging.

Referência oficial: [Speech to text — OpenAI API](https://developers.openai.com/api/docs/guides/speech-to-text).
