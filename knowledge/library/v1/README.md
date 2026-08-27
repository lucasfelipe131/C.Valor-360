# Biblioteca de Conhecimento VAL v1

Pacote inicial de conhecimento externo curado para alimentar o MCA/MAO/MVV/MIA/MDP/MGO da VAL.

## Conteúdo
- `100` KnowledgeItems em `knowledge_items.jsonl`
- `30` fontes em `source_registry.json`
- `30` cenários de teste/aplicação em `scenario_bank.jsonl`
- `taxonomy.md` com taxonomia e regras de ingestão
- `VAL_Biblioteca_Mestre_v1.docx` com versão humana de leitura

## Regra de ingestão
1. Esta biblioteca NÃO deve ser despejada diretamente em prompt de sistema.
2. Cada item deve entrar como KnowledgeItem versionado, com source_ids e authority.
3. Evidência geográfica (por exemplo, pesquisas com produtores dos EUA) não deve ser universalizada para o Brasil.
4. Claims agronômicos de alto risco exigem fonte oficial/científica vigente e revisão do MIA/MGO.
5. Cases e cenários são exemplos de comportamento, não fatos agronômicos.
6. LearningCandidates internos da VAL não devem virar KnowledgeItems sem governança.

## Níveis de autoridade
- A: fonte oficial, extensão universitária, órgão regulador ou framework público de alta autoridade.
- B: pesquisa acadêmica/universitária ou survey institucional.
- C: metodologia comercial proprietária/estabelecida; usar como framework, não como verdade universal.
- D: hipótese/case interno, exige validação.

## Status
`APPROVED_EXTERNAL` significa aprovado para consulta da VAL respeitando escopo/risco; não significa autorização automática para prescrição ou uso regulatório.
