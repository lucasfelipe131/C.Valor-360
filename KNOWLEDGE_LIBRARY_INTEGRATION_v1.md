# Integração da Biblioteca VAL v1

## Pacote canônico

O runtime usa somente os artefatos estruturados versionados:

- `knowledge_items.jsonl` — 100 itens;
- `source_registry.json` — 30 fontes;
- `scenario_bank.jsonl` — 30 fixtures;
- `ingestion_manifest.json`, `taxonomy.md` e `README.md`.

PDF e DOCX são documentação humana; não entram no prompt nem no retrieval de runtime.

## Ingestão

O loader é determinístico e fail-closed. Valida IDs, duplicidade, referências, enums, risco, autoridade, geografia e contagens. Campos ausentes permanecem `null`. O valor bruto e o status de origem são preservados para auditoria.

Risco ausente ou fora do enum nunca cai para `LOW`: o item é marcado como desconhecido, bloqueado no retrieval e invalida a ingestão estrita. Ausência de `valid_from`, `valid_until` e `review_at` não expira artificialmente o catálogo, mas produz `FRESHNESS_UNKNOWN` e caveat explícito. Quando datas existirem, o relógio do request aplica validade e revisão em todos os caminhos de runtime.

`APPROVED_EXTERNAL` não vira `ACTIVE` silenciosamente. Uma policy explícita de staging permite uso de itens de baixo risco como apoio à decisão; itens `HIGH` permanecem `GUARDRAIL_ONLY` e exigem revisão humana.

## Retrieval governado

Filtros e sinais:

- objetivo/mensagem;
- cultura, estágio e categoria confirmados;
- oportunidade e problema;
- perfil observável;
- módulos-alvo;
- risco, autoridade e escopo geográfico;
- validade, supersessão e status.

Saída máxima: três itens. O resultado registra IDs, versão, fontes, razão da seleção, caveat geográfico e política. Itens não aplicáveis não são enviados ao modelo.

Conceitos explícitos no objetivo atual têm precedência sobre referências históricas a outras culturas ou categorias. O adapter exige o conjunto canônico completo de `source_refs`, reaplica status, eligibility e lifecycle e preserva caveats até o MDI/MVV/modelo.

## Uso

```text
Contexto autorizado
  -> seleção MCA governada
  -> MDI: tese e incertezas
  -> MVV: pergunta, prova, estratégia e compromisso
  -> MIA/safety: guardrail técnico
```

Knowledge nunca entra em MMI, nunca confirma fato do produtor e nunca elimina lacuna. A engine recebe projeção curta e não confiável; IDs de fonte produzidos pelo modelo fora da seleção/registry são rejeitados.

Knowledge também não é misturado a `evidence_refs` factuais. Um item só recebe `used_in` quando muda materialmente uma justificativa, estratégia, prova, pergunta ou guardrail; mera seleção não satisfaz `KNOWLEDGE_USAGE`.

## Custo e operação

Esta versão não cria tabela, API pública, vector store ou recurso pago. `npm run knowledge:sync` não faz parte do gate. O catálogo é lido localmente e pode ser revertido junto com a branch. Quando `VAL_KNOWLEDGE_VECTOR_STORE_ID` já existe, o `file_search` legado permanece compatível, limitado e tratado como fonte não confiável; a Biblioteca VAL v1 estruturada nunca é enviada ou sincronizada para esse vector store.

## Observabilidade

Somente policy version, status, quantidade, IDs pseudonimizados/permitidos e reason codes podem ser registrados. Statement, áudio, transcrição e trechos de fonte não entram em logs.
