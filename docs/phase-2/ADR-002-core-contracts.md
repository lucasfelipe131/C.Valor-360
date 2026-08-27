# ADR-002 — VAL Core por contratos e composição explícita

- Status: implementado na branch da Fase 2; aceite condicionado ao gate
- Data: 2026-08-20
- Decisão anterior preservada: monólito modular evolutivo

## Contexto

O `ValEngine`, os repositórios e as APIs existentes já entregam valor e não devem ser recriados. O risco identificado na auditoria é a composição por efeitos colaterais de importação: `conversion-bootstrap.js` instala cinco wrappers e `innovation-bootstrap.js` instala o sexto, dependendo de uma ordem definida apenas pelos argumentos `--import` do comando de inicialização.

O Projeto Mestre exige envelopes versionados, roteamento, policies, execução determinística, tracing e degradação segura. Ele não exige microserviços nem troca da stack atual.

## Decisão

1. Criar o `ValCore` como adaptador ao redor do `ValEngine` atual.
2. Montar o `RequestEnvelope` somente no servidor. `organization_id`, ator e escopo nunca vêm do corpo do navegador.
3. Validar contrato, tenant, papel, carteira e vínculo entre envelope e input da engine antes de consultar contexto.
4. Classificar objetivos e ordenar módulos por regras determinísticas versionadas.
5. Executar o `ValEngine` por um adaptador obrigatório chamado `LEGACY_VAL_ENGINE`.
6. Produzir `ResponseEnvelope` com evidências, premissas, confiança, próximos passos e auditoria.
7. Preservar os payloads de `/api/val/chat` e `/api/val/recommendations` por unwrapping do mesmo `ResponseEnvelope`.
8. Adicionar `/api/v1/val/recommendations` como rota canônica, sem migrar o front-end nesta fase.
9. Remover os efeitos colaterais dos imports dos bootstraps. A instalação passa a ocorrer apenas em `server/start.js`, por `installValRuntimeComposition()`.
10. Manter temporariamente os seis wrappers de prototype. A substituição interna de cada wrapper é trabalho incremental posterior, protegido pelos characterization tests.

## Fronteira determinística e fronteira de IA

| Responsabilidade | Implementação desta fase |
|---|---|
| Contrato e versão | determinística |
| Tenant, ator, papel e escopo | determinística |
| Classificação das cinco rotas iniciais | determinística |
| Ordem, obrigatoriedade e timeout de módulo | determinística |
| Auditoria e correlation id | determinística |
| Recomendação comercial/técnica | `ValEngine` existente, com seus guardrails atuais |

A IA não escolhe tenant, ator, permissão, ID, policy, versão de contrato nem ordem de execução.

## Compatibilidade

O adaptador legado devolve o mesmo objeto retornado pelo `ValEngine`, acrescido apenas do `requestId` que as APIs já retornavam. Erros de domínio lançados pela engine mantêm identidade, mensagem e `statusCode`.

A rota canônica é aditiva. Nenhuma tela foi alterada para consumi-la.

## Consequências

- O runtime falha ao iniciar se `server.js` for carregado sem a composição explícita.
- A ordem `conversion → innovation` passa a ser declarada, inspecionável e idempotente.
- O Core já expõe o plano lógico dos módulos-alvo, mas a execução concreta continua delegada ao adaptador legado até que cada módulo seja extraído com segurança.
- Os eventos do Core usam a infraestrutura de observabilidade do Passo 01 e compartilham o mesmo `request_id` da API e do banco.
- Não há migration ou alteração de dados nesta fase.

## Alternativas não adotadas

- Reescrever o `ValEngine`: viola “evoluir, não reconstruir”.
- Migrar todas as APIs para envelopes de uma vez: quebraria o front-end e integrações.
- Manter `--import` no `package.json`: preservaria a dependência oculta de ordem.
- Criar microserviços: adicionaria custo operacional sem resolver os contratos.
- Aceitar `organization_id` do cliente: criaria uma superfície cross-tenant desnecessária.

## Rollback

O rollback é somente de código:

1. restaurar o comando de start e a chamada direta ao `ValEngine` a partir do commit anterior;
2. retirar a rota canônica e os módulos `server/core`;
3. executar a suíte de caracterização e os builds.

Não existe rollback de banco porque nenhuma migration, ID ou dado foi alterado.
