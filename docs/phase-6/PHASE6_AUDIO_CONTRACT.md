# Contrato de áudio da Fase 6

O fluxo é `attachment → TranscriptionProvider → VisitTranscript v1 → VisitReport v1 candidato → confirmação`.

MIME types aceitos: MPEG/MP3, MP4/M4A, WAV, WebM e OGG. O áudio deve existir em `val_attachments`, pertencer ao mesmo produtor, tenant e consultor e respeitar o limite já existente de 6 MB.

`TranscriptionProvider` recebe referência autorizada e devolve texto, referência do provedor e idioma. Nesta fase:

- o runtime usa provider indisponível e falha com `503` seguro;
- testes usam provider mock determinístico;
- não há credencial, custo ou integração externa;
- falha persiste somente metadata/status `FAILED`, sem consolidar report ou memória;
- transcript concluído ainda é apenas origem candidata;
- conteúdo de áudio/transcript não é permitido nos logs.

Uma integração operacional futura deverá implementar a mesma porta, manter timeouts/retry controlados, política de retenção e revisão de privacidade, sem mudar o contrato público.
