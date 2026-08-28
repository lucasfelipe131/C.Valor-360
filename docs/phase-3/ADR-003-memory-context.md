# ADR-003 — Memória inteligente e contexto mínimo versionado

Status: aceito localmente para publicação controlada
Data: 2026-08-20
Escopo: Passo 03 — MMI + MCTX

## Contexto

A VAL já possui `val_memories`, contexto do Cliente 360, compactação, trilha de recomendações e motores que consomem `getClientContext`. Reconstruir essas peças criaria regressão e duplicidade. A lacuna é semântica e de governança: o legado não separa natureza da memória de estado epistemológico, correções não possuem FK explícita, o contexto não expõe conflitos/lacunas e a recomendação não aponta a uma versão rastreável do contexto.

## Decisão

1. Evoluir `val_memories` in-place por migration expand-only.
2. Manter `memory_type` legado e adicionar `memory_domain` e `memory_state` canônicos.
3. Criar `MemoryRecord v1` como projeção compatível, sem exigir regravação destrutiva do histórico.
4. Manter todos os novos campos de `val_memories` nullable na expansão e não executar backfill/classificação automática; somente novas escritas ou curadoria explícita preenchem a semântica canônica.
5. Ler até 250 versões autorizadas em `memoryHistory`, mantendo `memories` vigente para consumidores existentes.
6. Formalizar `ContextSnapshot v1` ao redor de `getClientContext`, sem trocar o repositório ou a ValEngine.
7. Persistir o snapshot como entidade imutável de primeira classe em `val_context_snapshots`; `val_recommendations.context_snapshot_id` referencia a tabela no mesmo tenant. A cópia em `input_context` é mantida somente por compatibilidade retroativa.
8. Uma correção cria nova memória, liga `supersedes_id`, encerra temporalmente a versão anterior usando o lifecycle legado já aceito (`expired`) e preserva conteúdo, origem e timestamps. O MCTX deriva `SUPERSEDED` pela relação entre versões, sem mudar a semântica física do campo `status`.
9. Filtrar tenant/sujeito/ACL antes de selecionar conteúdo ou produzir referências.
10. Enviar ao modelo somente a projeção compacta do snapshot. Motores determinísticos continuam recebendo o contexto autorizado completo.
11. Preservar RequestEnvelope e ResponseEnvelope v1; referências de snapshot são aditivas dentro da recomendação.

## Estados e domínios

Estados epistemológicos estáveis:

- `FACT`
- `INFERENCE`
- `HYPOTHESIS`
- `VALIDATED_KNOWLEDGE`

Domínios estáveis:

- `PRODUCER`
- `COMMERCIAL`
- `AGRONOMIC`
- `BEHAVIORAL`
- `RELATIONSHIP`
- `ORGANIZATIONAL`
- `STRATEGIC`

Status de lifecycle é separado: `PROPOSED`, `ACTIVE`, `REJECTED`, `EXPIRED`, `SUPERSEDED`.

## Seleção de contexto

A seleção considera objetivo/pergunta atual, relação com o domínio, estado epistemológico, autoridade da fonte, confiança, validade, recência e caráter estrutural. Recência não vence automaticamente um fato estrutural. O limite atual de memória material é 24 registros; coleções relacionais possuem limites próprios. Esses pesos são heurística versionada de retrieval, não probabilidade de negócio nem validade agronômica.

Freshness usa o registry `val.context.freshness.v1`, com regras independentes por domínio e tipo de fonte. A análise de solo possui uma regra operacional própria baseada em `sampled_at`; perfil comportamental usa validade explícita; memória usa janela de validade explícita. Fontes sem regra ficam `UNKNOWN`: não existe TTL universal nem promoção automática por recência. Datas da observação, atualização da fonte, versão da política e metadados ficam disponíveis para evolução governada.

## Privacidade e tenancy

- SQL restringe `tenant_id`, produtor e carteira.
- `MemoryRecord v1` revalida organização, sujeito, ator, papel, escopo e ACL.
- Memória organizacional só é recuperada com `acl.scope=organization` explícito; o default conservador não promove registros legados sem revisão.
- Registros negados não aparecem em `considered_refs`, `selected_refs` ou `excluded_refs`; somente uma contagem não sensível é preservada.
- Não há embeddings/vector search nesta fase. Se forem adicionados no futuro, o tenant deverá fazer parte obrigatória do filtro anterior à busca.
- Logs carregam request ID, snapshot ID, versão, contagens, confiança e latência; não carregam conteúdo de memória.

## Alternativas rejeitadas

- **Recriar a memória em nova tabela:** duplicaria fonte de verdade e exigiria migração big bang.
- **Event sourcing completo agora:** excede a fundação do Passo 03.
- **Promover conversas automaticamente:** viola a separação fato/hipótese e cria risco de invenção.
- **Vector database agora:** não é necessário para o volume atual e aumentaria superfície de vazamento.
- **Alterar prompts/front-end:** fora do escopo e desnecessário para o contrato.
- **Usar somente `input_context` como identidade do snapshot:** rejeitado porque não oferece entidade imutável, FK tenant-safe ou índices próprios para auditoria de seleção.

## Consequências

Positivas:

- recomendações passam a apontar a contexto versionado;
- correções são auditáveis;
- lacunas, conflitos e stale data deixam de ficar implícitos;
- motores e APIs existentes permanecem reutilizados;
- o desenho abre caminho para MMI/MCTX mais avançados sem antecipar o Passo 04.

Custos/riscos:

- aplicação nova requer migration expand aplicada antes do start;
- a tabela e os índices novos exigem migration antes do start do código novo;
- `input_context` cresce pelo snapshot completo;
- regras específicas de freshness e autoridade precisarão de owners e revisão contínua;
- constraints `NOT VALID` exigirão validação controlada em fase posterior após inventário real.

## Rollback

O rollback operacional é reverter a aplicação para `498ebf3` e deixar as colunas aditivas no banco. Não apagar snapshots, memórias ou colunas. O contract/drop, se algum dia necessário, exige fase própria, backup e aprovação explícita.
