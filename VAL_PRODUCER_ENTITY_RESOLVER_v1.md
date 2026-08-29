# ProducerEntityResolver v1

Contrato: `val.producer_entity_resolver.v1`
Compatibilidade: mantém `val.client_reference_resolution.v1` nas respostas existentes.

## Fontes autorizadas

O backend monta o índice apenas com clientes ativos do `tenant_id` e `consultant_id` autenticados. Campos leves:

- `client_id`/`external_key`;
- display name;
- município;
- aliases existentes;
- nomes de propriedades;
- organization/tenant apenas no índice interno.

Nenhum dossiê, memória, oportunidade ou fato agronômico entra no índice.

## Estratégia de match

| Match | Confiança nominal | Regra |
|---|---:|---|
| ID autorizado | 1,00 | Igualdade exata. |
| Nome normalizado exato | 1,00 | Remove acentos, pontuação e diferenças de caixa. |
| Alias exato | 0,98 | Somente alias existente no registro autorizado. |
| Propriedade exata | 0,96 | Nome da propriedade ligado ao cliente autorizado. |
| Prefixo | 0,92 | Tokens iniciais na mesma ordem. |
| Token | 0,90 | Primeiro nome ou sobrenome único. |
| Fuzzy de transcrição | ≥0,84 para 6+ caracteres; ≥0,90 para curtos | Levenshtein normalizado. Resultados a menos de 0,06 do primeiro permanecem ambíguos. |
| Contexto atual/anterior | 1,00 | ID precisa continuar presente na carteira autorizada. |

## Ambiguidade

João Pereira, João Silva e João Costa nunca são reduzidos silenciosamente a um único João. O endpoint responde `409 val_client_reference_ambiguous` com opções mínimas da carteira; a UI e o modo Realtime solicitam a escolha.

## Troca de cliente

Ao resolver outro cliente, `switchConversationClient`:

- limpa objetos e conhecimento específicos do anterior;
- zera facts, hypotheses, perguntas, tool results e turnos específicos;
- preserva uma lista mínima `recent_clients` de até seis referências;
- permite “volta para o produtor anterior” somente se o ID ainda estiver autorizado.

## Cache

`val.producer_entity_index_cache.v1` usa chave `tenant + owner`, TTL de 30 s e máximo de 250 escopos. Criação, importação, update e archive conhecidos invalidam o cache. Métricas são content-free.

## Testes

Cobertos: nome exato, acento, primeiro nome, sobrenome/token, alias, propriedade, erro de transcrição, homônimos, not found, troca de cliente, cliente anterior, current client e IDs cross-tenant injetados.
