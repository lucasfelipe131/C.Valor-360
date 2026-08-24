# Política de armazenamento e retenção de voz

Status: adapter temporário implementado; política de retenção documentada, sem exclusão automática. Não autoriza recurso pago.

## Separação de dados

1. **áudio bruto**: bytes conscientemente enviados pelo consultor;
2. **transcript**: derivado falível, armazenado por tentativa;
3. **candidatos/revisão**: extração inicial e decisão humana;
4. **efeitos confirmados**: dados governados pelos módulos da VAL.

Excluir uma classe no futuro não implica apagar automaticamente as demais.

## Porta implementada

O código usa `VoiceAudioStorage`:

```ts
interface VoiceAudioStorage {
  name: string;
  version: string;
  store(input): Promise<{
    audio_ref: string;
    attachment_id: string;
    storage_provider: string;
    storage_version: string;
    mime_type: string;
    size_bytes: number;
    duration_seconds: number;
  }>;
  load(input): Promise<{
    audio_ref: string;
    bytes: Buffer;
    mimeType: string;
    sizeBytes: number;
    originalName: string;
  }>;
  mark?(input): Promise<unknown>;
}
```

Não existem na porta atual métodos `putAuthorizedAudio`, `openAuthorizedAudio`, `statAuthorizedAudio`, `markRetentionState` ou `deleteAuthorizedAudio`.

## Adapter temporário real

`RepositoryAttachmentVoiceStorage` reutiliza `val_attachments`:

- bytes ficam em `content_base64`;
- SHA-256 é calculado pelo repositório;
- `audio_ref` é `attachment:<uuid>`;
- cada VoiceInteraction recebe anexo próprio, mesmo se o conteúdo for idêntico (`deduplicate: false`);
- `store` exige organização, ator e produtor;
- `load` revalida organização, ator e produtor;
- `mark` aceita somente `interpreted`, `confirmed`, `stored` ou `rejected` e grava metadata em allowlist.

Esta é uma ponte. Base64 em PostgreSQL aumenta volume de tabela, WAL, backup e restore e não é a arquitetura definitiva.

## Limites e validação

| Controle | Implementação |
|---|---|
| body HTTP geral | `VAL_MAX_BODY_BYTES`, padrão 10.000.000 bytes |
| áudio decodificado | `VAL_VOICE_MAX_AUDIO_BYTES`, teto/padrão 6.000.000 bytes |
| duração | `VAL_VOICE_MAX_DURATION_SECONDS`, teto/padrão 900 s |
| transporte atual | JSON com data URL base64 |
| MIME | allowlist de oito aliases/tipos de áudio |
| assinatura | RIFF/WAVE, OggS, EBML/WebM, MP4 `ftyp`, ID3/frame MPEG |
| duração confiável | `ffprobe` server-side em arquivo temporário modo `0600` |
| nome | normalização NFKC e remoção de caracteres de caminho/controle |

O valor de duração enviado pelo navegador é validado, mas a duração persistida é a medida pelo servidor. Ausência de `ffprobe` falha com 503 recuperável; arquivo não reproduzível falha fechado.

O arquivo temporário do probe é criado em diretório `mkdtemp` e removido no `finally`. Ele não é o storage permanente.

## Persistência por tabela

### `val_attachments`

Mantém bytes/base64, hash, nome, MIME, tamanho, status, análise segura, tenant, consultor e produtor.

### `val_voice_interactions`

Mantém referência opaca, `audio_attachment_id`, duração, estados, candidatos e artefatos. Não contém uma segunda cópia dos bytes.

### `val_voice_transcripts`

Mantém uma tentativa por `attempt_no`, texto concluído, metadata do provider, status e erro seguro.

## Controle de acesso

Toda leitura de áudio passa pelo repositório com `tenantId`, `ownerId/actorId` e, no storage, produtor esperado. O fallback e o PostgreSQL retornam não encontrado quando ator/produtor não têm acesso. A API não oferece rota pública de download nem URL assinada nesta versão.

As FKs da migration relacionam áudio com `(tenant_id, attachment_id, actor_id, client_id)`. Transcript relaciona tenant, interação, criador, cliente e visita.

## Estados operacionais do anexo

- `received`: criado pelo upload;
- `interpreted`: extração chegou à revisão;
- `confirmed`: confirmação concluída;
- `rejected`: interação cancelada ou anexo órfão de corrida de upload;
- `stored`: permitido pelo adapter para compatibilidade, mas não é a transição principal do fluxo de voz.

Esses estados não são uma política completa de retenção.

## Retenção inicial

Não existe job de deleção, campo de legal hold nem método de exclusão na porta atual. Os prazos abaixo são **proposta de elegibilidade**, não comportamento implementado:

| Classe | Elegibilidade proposta | Implementação atual |
|---|---|---|
| áudio confirmado | 30 dias após confirmação | permanece armazenado |
| áudio cancelado/rejeitado | 7 dias após estado terminal | permanece armazenado |
| áudio com falha recuperável | revisar após 30 dias | permanece para retry |
| transcript confirmado | revisar/minimizar após 180 dias | permanece armazenado |
| transcript rejeitado | revisar após 30 dias | permanece armazenado |
| efeitos confirmados | política do módulo de destino | preservados |

Ativar deleção exige política jurídica/organizacional, legal hold, auditoria, backup/restore e autorização explícita.

## Backup e restore

O job `voice-capture-gate-postgres` foi configurado para:

- PostgreSQL 16;
- migrations em ordem;
- reaplicação da migration 005 sem drift;
- verificador runtime com fixtures sintéticas;
- `pg_dump` custom;
- restore em banco diferente;
- comparação de catálogo, dados e referências.

O job foi executado com sucesso no Validate #178, incluindo reaplicação sem drift, backup e restore em outro PostgreSQL 16.

## Falhas e concorrência

- upload inválido falha antes de criar attachment;
- se dois uploads concorrem, somente um pode vincular a interação; o anexo perdedor é marcado `rejected`;
- falha de transcrição preserva áudio;
- bytes ausentes/corrompidos falham antes do provider;
- retry de processamento reutiliza `audio_ref`;
- não há idempotency key de upload: um novo upload físico concorrente pode criar anexo órfão, mitigado pela marcação descrita acima.

## Destino preferido

Object storage privado deve substituir o adapter temporário, com metadata no PostgreSQL, objeto privado por ambiente, criptografia, lifecycle e deleção verificáveis. A troca precisa manter `audio_ref` opaco e passar a mesma suíte de contrato.

Nenhum recurso de object storage foi criado porque isso pode gerar custo adicional e exige nova autorização.

## Fora de escopo

- gravação automática ou secreta;
- mídia pública;
- base64 como decisão definitiva;
- exclusão automática;
- recurso pago sem autorização;
- cópia de áudio ou conversa real de produtor/cliente para staging;
- secret junto da mídia.
