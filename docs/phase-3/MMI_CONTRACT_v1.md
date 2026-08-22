# MMI Contract v1

Versão runtime: `val.memory.v1`
Schema: `contracts/v1/memory-record.schema.json`

## Finalidade

`MemoryRecord v1` é a projeção canônica e versionada de uma memória material da VAL. Ele evolui `val_memories`; não substitui a tabela, não muda IDs e não transforma conversa em fato.

## Campos

| Campo | Regra |
|---|---|
| `memory_id` | ID estável da memória existente. |
| `organization_id` | Tenant obrigatório e primeira barreira de retrieval. |
| `subject_type` / `subject_id` | Sujeito da memória: produtor, propriedade, talhão, organização, usuário, visita ou oportunidade. |
| `memory_type` | Domínio canônico: `PRODUCER`, `COMMERCIAL`, `AGRONOMIC`, `BEHAVIORAL`, `RELATIONSHIP`, `ORGANIZATIONAL` ou `STRATEGIC`. |
| `memory_state` | Estado epistemológico: `FACT`, `INFERENCE`, `HYPOTHESIS` ou `VALIDATED_KNOWLEDGE`. |
| `key` / `content` | Identidade semântica e conteúdo material. `content` projeta o `value` legado. |
| `source_ref` / `source_type` | Origem recuperável; legado sem origem externa fica explícito como `legacy_unattributed`. |
| `observed_at` / `source_updated_at` | Datas informadas pela origem; não são sintetizadas pela migration. |
| `freshness_policy_version` / `freshness_metadata` | Política por domínio/fonte e metadados não sensíveis usados na avaliação temporal; não existe TTL universal. |
| `confidence` | 0–100 ou `null`; nunca é preenchida por plausibilidade linguística. |
| `status` | Lifecycle: `PROPOSED`, `ACTIVE`, `REJECTED`, `EXPIRED`, `SUPERSEDED`. |
| `valid_from` / `valid_until` | Janela de validade temporal. |
| `supersedes_id` | Versão anterior corrigida, sempre no mesmo tenant. |
| `created_at` / `updated_at` / `created_by` | Auditoria temporal e autoria quando disponível. |
| `evidence_refs` | Referências estruturadas que sustentam a memória. |
| `acl` | Escopo e restrições por papel/ator. O filtro relacional de tenant/carteira continua obrigatório. |

## Regras epistemológicas

1. `FACT` exige origem recuperável e não pode ser inferido de conversa livre.
2. `INFERENCE` deve permanecer distinguível da evidência que a sustenta.
3. `HYPOTHESIS` nunca é apresentada como confirmação.
4. `VALIDATED_KNOWLEDGE` exige promoção governada futura; o Passo 03 não promove nenhum legado automaticamente.
5. `status` não substitui `memory_state`: uma hipótese pode estar ativa e um fato pode estar superseded.
6. Perfil comportamental é hipótese baseada em sinais observáveis, não verdade psicológica.
7. Simuladas, saída do modelo e texto de conversa não viram conhecimento validado.

## Compatibilidade conservadora do legado

A migration não atualiza nem classifica nenhuma linha existente. Os novos campos permanecem `NULL` até uma nova escrita ou curadoria explícita. Para permitir leitura sem quebrar consumidores, o adaptador runtime usa o fallback mais restritivo, sem persistir a projeção:

| Legado sem campo canônico | Projeção runtime não persistida |
|---|---|
| `memory_state IS NULL` | `HYPOTHESIS`; nunca `FACT`, `INFERENCE` ou `VALIDATED_KNOWLEDGE` por heurística |
| `memory_domain IS NULL` | `PRODUCER` como bucket neutro; nenhum domínio especializado é inferido da chave ou do tipo legado |
| `subject_type/subject_id IS NULL` com `client_id` | sujeito resolvido para o cliente já autorizado pela query |
| sem origem externa | `source_type=legacy_unattributed` e `source_ref=val_memories:<id>` |

Campos canônicos explícitos são respeitados. Nenhuma linha é atualizada/apagada e nenhum ID é alterado pela expansão.

## Escrita e correção

Uma nova versão deve ser inserida; a anterior recebe `valid_until` e o status físico legado `expired`, enquanto a nova aponta `supersedes_id` para ela. A projeção MMI expõe a anterior como `SUPERSEDED` pela relação entre versões. A FK `(tenant_id, supersedes_id)` impede referência cross-tenant. Exclusão destrutiva não é mecanismo padrão de correção.

Exemplo:

```text
memory-old: planted_area_ha=500, ACTIVE
memory-new: planted_area_ha=620, ACTIVE, supersedes_id=memory-old
memory-old: status legado expired; projeção v1 SUPERSEDED; conteúdo e origem preservados
```

## Retrieval autorizado

A memória só pode ser considerada quando todos os controles aplicáveis são satisfeitos:

1. `organization_id` igual ao tenant configurado;
2. sujeito igual ao produtor, organização ou entidade vinculada no dossiê autorizado — propriedade, talhão, visita ou oportunidade;
3. ator e papel reconhecidos;
4. escopo da requisição compatível;
5. ACL compatível; memória organizacional exige `acl.scope=organization` explícito e não é liberada pelo default legado;
6. vínculo relacional de carteira já comprovado pelo repositório.

Registro negado é descartado antes de produzir conteúdo, `source_ref`, conflito ou evidência. Nesta versão não existe busca vetorial.

## Compatibilidade

O array legado `context.memories` permanece vigente. A nova coleção `context.memoryHistory` é aditiva. RequestEnvelope/ResponseEnvelope v1 não foram modificados. Prompts, UI, Manual e ValEngine determinística não foram reconstruídos.

## Observabilidade

O snapshot registra `selected_refs`, `excluded_refs` e `exclusion_reason_codes`, além dos motivos de seleção. Logs recebem somente contagens e códigos agregados, snapshot ID, versão, confiança e latência. Conteúdo material e refs individuais não são logados.
