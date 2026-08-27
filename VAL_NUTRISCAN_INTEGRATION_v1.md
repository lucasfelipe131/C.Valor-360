# VAL NutriScan Integration v1

## Resultado

O NutriScan existente permanece o único motor nutricional (`mode=nutrition`). A integração formal VAL Attachment → handoff → NutriScan → resultado → attachment de origem usa `AgronomicScanProvenance.v1` e está implementada em código, com evidência automatizada de vínculo, `UNLINKED`, isolamento por tenant/owner e recuperação do último resultado.

Status técnico: **PASS**. Qualidade agronômica e câmera em dispositivo físico continuam pendentes no gate mestre.

## Fluxo implementado

1. A VAL persiste a imagem em `val_attachments`, vinculada ao produtor ou com associação explícita `UNLINKED`.
2. O host entrega ao Manual o lote efêmero `valor360:session-media` v2, com o arquivo para uso ativo e uma referência paralela ao attachment.
3. O Manual revalida origin, parent, request, tipo, tamanho, quantidade e associação antes de preparar a foto.
4. O NutriScan executa o motor existente em `manual/app/api/diagnosis`.
5. Somente a ação humana de salvar cria o registro metadata-only e emite o evento técnico assinado `agronomic.scan.completed`.
6. O servidor resolve novamente tenant, responsável, cliente, propriedade e talhão; não confia nos IDs declarados pelo browser.
7. O resultado é gravado em `analysis.scanResults` e `analysis.latestScanResult` do attachment de origem.
8. “Me mostra o último NutriScan” consulta apenas attachments metadata-only daquele tenant, consultor e cliente; `UNLINKED` não entra implicitamente no contexto de um produtor.

## Provenance preservada

- `contract_version = AgronomicScanProvenance.v1`;
- `attachment_id`;
- `organization_id`;
- `client_id` interno e `client_external_key`, quando vinculados;
- `property_id` e `field_id`, quando presentes e revalidados;
- associação `LINKED_CLIENT` ou `UNLINKED`;
- `analysis_type = NUTRISCAN`;
- data do attachment e do resultado;
- `result_reference` e `source_event_id`;
- origem Manual, handoff v2, storage binário e storage do resultado;
- safety e revisão humana obrigatória.

Filename e texto não são usados como identidade. O binário não é duplicado em evento, registro ou ContextSnapshot.

## Safety

- Triagem visual assistida, não confirmação diagnóstica nem prescrição.
- Exatamente três hipóteses plausíveis, com evidências, lacunas e confundidores.
- Sem recomendação automática de marca, ingrediente ativo ou dose.
- Resultado exige revisão de responsável técnico e, quando material, vistoria/análise de solo ou tecido.
- A execução da ferramenta não promove hipótese para memória confirmada.

## Tenancy e autorização

- Consultas e updates usam `tenant_id + consultant_id + attachment_id`.
- Attachment vinculado precisa resolver para o mesmo cliente do evento.
- Propriedade/talhão precisam pertencer ao mesmo cliente e à mesma cadeia autorizada.
- Attachment `UNLINKED` não pode receber cliente, propriedade ou talhão implicitamente.
- Divergência de organização, responsável, cliente, propriedade, talhão, associação ou hash falha fechada.
- O contexto do Copilot recebe somente metadados; `content_base64` nunca entra.

## Evidência automatizada

- `test/agronomic-scan-provenance.test.js`: contrato, fluxo linked/UNLINKED, tenant/owner, evento assinado, recuperação do último NutriScan e ausência de binário no contexto.
- `test/unlinked-media-handoff.test.js`: protocolo v2, one-shot, ACK mínimo e associação explícita.
- `test/manual-photo-diagnosis.test.js`: salvamento humano, sanitizer, safety e ausência de inline binary.
- `test/agro-copilot-context.test.js`: handoff e navegação contextual.

A bateria focada de provenance/handoff/diagnóstico reproduziu **27/27 PASS**; o teste específico de provenance reproduziu **5/5 PASS** depois da recuperação do último scan.

## Migration

`20260827_007_attachment_scan_provenance_expand.sql` apenas amplia compatibilidade: permite `client_id` nulo para `UNLINKED` e cria índice parcial. Não apaga nem reescreve dados, não cria uma segunda tabela de imagens e não é uma migration destrutiva.

## Rollback

Reverter o protocolo v2/evento de scan e manter o diagnóstico dentro do Manual. Preservar attachments e registros já confirmados; não apagar dados. A reversão do `DROP NOT NULL` não deve ocorrer enquanto existirem rows `UNLINKED`.

## Limite da evidência

Ainda são obrigatórios no staging: câmera/upload físico, uma a três imagens, qualidade visual licenciada, timeout/rate limit, retorno no Copilot, TTS quando solicitado e inspeção humana. Nenhum desses itens é substituído pelos testes de código.
