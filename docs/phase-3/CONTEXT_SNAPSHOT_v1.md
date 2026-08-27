# ContextSnapshot v1

Versão runtime: `val.context_snapshot.v1`
Schema: `contracts/v1/context-snapshot.schema.json`

## Princípio

Contexto útil é o menor conjunto de informações autorizadas capaz de melhorar materialmente a decisão. O MCTX não envia todo o histórico ao modelo e não preenche lacunas por plausibilidade.

## Construção

`ValRepository.getClientContext` continua sendo a fonte-base. Depois da consulta tenant/carteira, o MCTX:

1. projeta `memoryHistory` em `MemoryRecord v1`;
2. revalida tenant, sujeito, ator, papel, escopo e ACL;
3. separa vigente, vencido, rejeitado, futuro e superseded;
4. ranqueia memória vigente pelo objetivo/pergunta, domínio, autoridade, estado, confiança, validade, recência e caráter estrutural;
5. limita a memória material a 24 registros;
6. detecta conflitos entre fontes materiais atuais;
7. explicita lacunas e stale data;
8. incorpora referências autorizadas das coleções relacionais do Cliente 360;
9. calcula confiança categórica e freshness;
10. gera um ID versionado, persiste uma entidade imutável em `val_context_snapshots` e liga a recomendação por FK no mesmo tenant.

## Seções

| Seção | Conteúdo |
|---|---|
| `facts` | fatos atuais e ativos; registro proposto nunca entra automaticamente aqui |
| `inferences` | inferências atuais, separadas da evidência |
| `hypotheses` | hipóteses e registros propostos |
| `validated_knowledge` | conhecimento promovido por governança; não é criado automaticamente nesta fase |
| `missing_information` | lacunas explícitas, com marca crítica quando aplicável |
| `conflicts` | versões atuais divergentes e refs que exigem confirmação |
| `stale_information` | memória expirada/superseded e fontes relacionais operacionalmente antigas |
| `behavioral_signals` | perfil como hipótese e suas evidências observáveis |
| `commercial_context` | negócios e oportunidades relevantes |
| `agronomic_context` | propriedades, relatórios, solo e NDVI relevantes |
| `relationship_context` | interações, visitas e dados relacionais reportados |
| `evidence_refs` | origem recuperável dos itens selecionados |
| `confidence` | `VERIFICADO`, `PROVÁVEL`, `HIPÓTESE` ou `INSUFICIENTE`, com fatores |
| `freshness` | situação temporal, versão da política e regras por domínio/fonte efetivamente avaliadas |
| `selection` | `selected_refs`, `excluded_refs`, `exclusion_reason_codes`, motivos determinísticos de seleção, contagens negada/inválida e latência |

## Relevância

O ranker atual é determinístico e versionado como `val.context.selection.v1`. Ele considera:

- objetivo e pergunta atual;
- domínio relacionado à decisão;
- estado epistemológico;
- autoridade da fonte;
- confiança registrada;
- validade e recência;
- relação com o produtor;
- caráter estrutural de informações como área, propriedade e culturas.

Os pesos são heurística de retrieval e não score de probabilidade. Um fato recente não vence automaticamente um fato estrutural antigo. Em empate, atualização e ordem estável resolvem a seleção.

## Supersessão

Se uma memória vigente aponta `supersedes_id`, a versão anterior é retirada de `facts` e aparece em `stale_information` como `SUPERSEDED`. O conteúdo anterior continua auditável. O snapshot vigente usa a nova versão.

## Lacunas

Sem histórico, o snapshot registra `historical_context`. Para pergunta agronômica sem análise de solo operacionalmente atual, registra `current_soil_analysis` como crítica. Para preparar visita sem visita/interação recente, registra `recent_interaction`. Lacuna não gera valor substituto.

## Conflitos

Duas fontes atuais, materiais e suficientemente confiáveis com a mesma chave/domínio e valores divergentes geram `REQUIRES_CONFIRMATION`. O MCTX não escolhe silenciosamente uma delas e reduz a confiança global.

## Freshness

`val.context.freshness.v1` é um registry por domínio e tipo de fonte, não um TTL universal:

- memória usa somente janela explícita (`valid_from`/`valid_until`) e metadados da origem;
- `AGRONOMIC + soil_analysis` usa uma regra própria baseada em `sampled_at`, atualmente com janela operacional de 730 dias;
- `BEHAVIORAL + behavioral_profile` usa `valid_until` explícito;
- uma fonte sem regra temporal configurada permanece `UNKNOWN`, mesmo que tenha data recente ou antiga.

Cada avaliação registra `policy_version`, `rule_id`, domínio, tipo de fonte, estratégia, datas avaliadas e `reason_code`. O marcador de solo é operacional e não substitui decisão do responsável agronômico.

## Compactação para o modelo

`contextSnapshotForModel` remove a seção operacional `selection` e reduz primeiro coleções menos prioritárias até o limite configurado. Lacunas, conflitos, confiança e freshness são preservados. O caminho legado de `compactValContext` continua disponível somente quando não há snapshot.

## Rastreabilidade da recomendação

- `val_context_snapshots` é a entidade de primeira classe, com payload imutável, tenant, ator, sujeito, objetivo, versões de política e auditoria indexável.
- `selected_refs`, `excluded_refs` e `exclusion_reason_codes` possuem colunas próprias e índices GIN.
- `val_recommendations.context_snapshot_id` usa FK composta com `tenant_id`; `context_snapshot_version` preserva o contrato.
- `val_recommendations.input_context.contextSnapshot` continua preservando uma cópia por compatibilidade com leitores existentes, mas não é a identidade canônica.
- a resposta da ValEngine inclui `contextSnapshotId` e `contextSnapshotVersion`.
- o VAL Core acrescenta o snapshot como `evidence_ref` sem alterar ResponseEnvelope v1.

## Tenancy

Nenhuma memória de outro tenant entra em fatos, conflitos, stale, evidências ou refs consideradas. Memórias de propriedade, talhão, visita e oportunidade só entram se a entidade estiver vinculada ao dossiê autorizado; memória organizacional permanece no mesmo tenant e ainda respeita ACL. O contador `unauthorized_count` permite detectar tentativas/anomalias sem registrar os IDs negados. Coleções relacionais continuam dependendo das queries tenant/carteira do repositório.

## Observabilidade

Eventos `context.snapshot.built`, `engine.context.ready` e `core.context.bound` compartilham `request_id`. São registrados snapshot ID, versão, contagens consideradas/selecionadas/excluídas, códigos de exclusão agregados, confiança e latência. Conteúdo, refs individuais, pergunta, perfil ou valor da memória não é copiado para logs.

## Limites deliberados do Passo 03

- sem embeddings ou busca vetorial;
- sem promoção automática de conversa;
- sem merge de produtores;
- sem reescrita do MIC;
- sem UI nova;
- sem mudança de prompt;
- sem policy agronômica definitiva de freshness além das regras operacionais versionadas;
- sem backfill ou classificação automática das memórias legadas.
