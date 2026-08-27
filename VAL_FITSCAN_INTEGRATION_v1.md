# VAL FitoScan Integration v1

## Nomenclatura e resultado

O nome canônico é **FitoScan** e o modo existente é `disease`. `FitScan` permanece somente alias de entrada, normalizado antes da execução; não existe um segundo produto ou motor.

A integração formal VAL Attachment → handoff → FitoScan → resultado → attachment de origem usa `AgronomicScanProvenance.v1` e está implementada em código, incluindo recuperação do último resultado no Copilot.

Status técnico: **PASS**. Qualidade fitopatológica e câmera em dispositivo físico continuam pendentes no gate mestre.

## Fluxo implementado

1. A VAL cria um attachment vinculado ou explicitamente `UNLINKED`.
2. O handoff efêmero `valor360:session-media` v2 entrega o arquivo ativo e sua referência formal.
3. O Manual valida origin/parent/request, MIME, tamanho, quantidade e associação.
4. O FitoScan chama o motor já existente em `manual/app/api/diagnosis` com `mode=disease`.
5. A gravação exige ação humana e emite `agronomic.scan.completed` assinado.
6. O servidor resolve e valida novamente attachment, tenant, responsável e contexto agronômico.
7. `analysis.scanResults` e `analysis.latestScanResult` recebem o resultado e a referência formal.
8. “Me mostra o último FitoScan” só retorna resultado metadata-only do cliente e carteira autenticados.

## Provenance preservada

- `contract_version = AgronomicScanProvenance.v1`;
- attachment, organização e responsável autenticado;
- cliente interno/externo, quando houver;
- propriedade/talhão, quando presentes e validados;
- associação `LINKED_CLIENT` ou `UNLINKED`;
- `analysis_type = FITOSCAN`;
- timestamps de attachment/resultado;
- `result_reference` e `source_event_id`;
- origem, handoff, storage binário, storage do resultado e review humano.

O filename não substitui `attachment_id`. O binário não é copiado para evento, registro, contexto ou resposta estruturada.

## Safety

- Triagem fitopatológica por imagem, não diagnóstico confirmado.
- Exatamente três doenças/danos plausíveis, com evidências a favor/contra e confundidores.
- Nome científico só quando defensável.
- Sem prescrição automática, marca, ingrediente ativo ou dose.
- Resultado mantém `ASSISTED_TRIAGE_NOT_PRESCRIPTION` e revisão humana obrigatória.
- Hipótese não entra em `CONFIRMED_MEMORY` automaticamente.

## Tenancy e `UNLINKED`

- Todas as leituras/atualizações do attachment são tenant- e owner-scoped.
- Cliente, propriedade e talhão precisam pertencer à cadeia resolvida no servidor.
- `UNLINKED` continua sem cliente e nunca é projetado no contexto de um cliente.
- Claims divergentes de organização, responsável, associação, hash ou contexto falham fechados.
- A recuperação do último resultado usa metadados e `latestScanResult`, sem binário.

## Evidência automatizada

- `test/agronomic-scan-provenance.test.js`: FitoScan normalizado, provenance, linked/UNLINKED, isolamento e ausência de falso resultado.
- `test/unlinked-media-handoff.test.js`: protocolo v2 e ACK seguro.
- `test/manual-photo-diagnosis.test.js`: alias, salvamento explícito, sanitizer, safety e metadata-only.
- `test/agro-copilot-context.test.js`: navegação/handoff no ecossistema.

A bateria focada reproduziu **27/27 PASS**; o teste específico de provenance reproduziu **5/5 PASS**. A ausência de FitoScan para um cliente retorna `NO_DATA`, nunca resultado de outro tenant ou um sucesso vazio.

## Migration

`20260827_007_attachment_scan_provenance_expand.sql` relaxa apenas a obrigatoriedade de cliente para suportar `UNLINKED` e adiciona índice parcial. Não exclui nem reescreve dados.

## Rollback

Reverter o handoff/evento e manter o FitoScan no Manual, preservando attachments e registros confirmados. Não remover a associação nullable enquanto houver rows `UNLINKED`.

## Limite da evidência

O gate ainda exige câmera/upload em iPhone e Android reais, qualidade de casos controlados/licenciados, falhas de rede/rate limit, resposta no Copilot e revisão agronômica. Testes automatizados não substituem UAT físico.
