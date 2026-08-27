# VAL Agronomic Linking v1

> **Status da entrega:** contrato candidato em validação exclusiva no staging. Não autoriza produção, merge em `main` nem Passo 07.

## Finalidade

Uma análise agronômica pode nascer antes de o consultor saber a qual produtor, propriedade ou talhão ela pertence. Vincular e desvincular são mudanças de contexto; não são criação ou exclusão do conteúdo técnico.

## Estados

- `UNLINKED`;
- `LINKED_TO_CLIENT`;
- `LINKED_TO_PROPERTY`;
- `LINKED_TO_FIELD`.

O estado mais específico deve ser coerente com os IDs presentes. Um talhão exige propriedade e produtor; uma propriedade exige produtor.

## Contrato no payload SoilAnalysis

- `linkState`;
- `linkVersion`, inteiro crescente;
- `linkHistory[]`;
- `linkProvenance`;
- `producerId`, `property`/`propertyId` e `fieldId`, quando aplicáveis.

Cada item de `linkHistory` registra, sem conteúdo sensível desnecessário:

- versão;
- estado anterior e novo;
- referências anterior e nova;
- ator;
- timestamp;
- ação `LINK`, `RELINK` ou `UNLINK`;
- origem da confirmação.

## Identidade estável

A identidade lógica da análise não muda quando o vínculo muda. A publicação ao VALOR 360 usa um `externalId` estável derivado da análise, não um fingerprint do vínculo.

O upsert canônico é escopado por `tenant + source + external_id`.

## Transições

```text
UNLINKED -> LINKED_TO_CLIENT -> LINKED_TO_PROPERTY -> LINKED_TO_FIELD
qualquer LINKED_* -> outro LINKED_*        (RELINK)
qualquer LINKED_* -> UNLINKED              (UNLINK)
```

Todas exigem ação explícita do usuário. Detecção de nome no documento pode sugerir vínculo, nunca confirmá-lo silenciosamente.

Uma resposta em Decision Interview pode ajudar a propor o alvo apenas dentro da sessão. Ela não muda `linkState`, não cria vínculo e não entra em memória confirmada sem a ação de vínculo/REGISTER revisada e confirmada. Depois da confirmação, a solicitação seguinte recompõe o snapshot e as premissas com o vínculo atual.

## Desvincular sem apagar

UNLINK:

- zera referências de client/property/field no registro canônico;
- mantém análise, amostras e medições;
- mantém laboratório, método, datas e documento/provenance permitidos;
- incrementa `linkVersion`;
- acrescenta histórico;
- não apaga eventos anteriores de auditoria;
- deixa de incluir a análise no contexto daquele produtor a partir do próximo snapshot.

Reimportar ou republicar a análise desvinculada não pode ressuscitar o vínculo anterior.

## Publicação Manual -> VAL

`soil_analysis.completed` é publicado inclusive para análise desvinculada. IDs externos de cliente/propriedade/talhão ficam vazios quando `linkState=UNLINKED`.

No backend, o upsert atualiza referências para `NULL` no UNLINK e substitui as medições da versão de forma idempotente, sem duplicar ou apagar a identidade lógica.

## Tenancy e autorização

- análise, alvo e ator devem pertencer ao mesmo tenant/workspace;
- o servidor resolve o alvo; IDs do cliente não concedem acesso;
- tentativa cross-tenant falha antes da mutação;
- vínculo de propriedade/talhão incompatível é rejeitado;
- leitura desvinculada continua escopada ao dono/workspace autorizado.

## Proveniência

`linkProvenance` descreve quem confirmou o vínculo e por qual superfície. Não afirma que o conteúdo agronômico foi tecnicamente validado. Vínculo e validação são dimensões separadas.

## UI

A análise oferece:

- Vincular análise;
- Alterar vínculo;
- Desvincular;
- estado atual visível;
- aviso de que desvincular preserva o conteúdo.

## Testes

- salvar análise sem produtor;
- vincular em cada nível;
- alterar vínculo e incrementar versão;
- desvincular e preservar medições;
- republicar UNLINK sem ressuscitar vínculo;
- idempotência pelo mesmo `externalId`;
- histórico e provenance;
- contexto do produtor inclui somente vínculo atual;
- resposta de sessão não cria vínculo nem memória confirmada;
- cross-tenant e alvo incompatível bloqueados.

O gate não deve inferir vínculo auditável apenas porque um `<select>` aceita valor vazio.
