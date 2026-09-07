# Produtor de demonstração VAL

`Produtor Demonstração VAL — Rafael Missões (FICTÍCIO)` usa a chave `val-demo-rafael-missoes-v1`. Todos os dados são sintéticos, incluindo pessoas, relações, polígonos, valores e amostras. As coordenadas representam uma composição fictícia na zona rural de São Luiz Gonzaga; não comprovam posse, acesso ou localização real de uma propriedade.

Inclui duas propriedades, quatro talhões com geometria canônica (três na propriedade principal), três safras por talhão, perfil calculado com o questionário e matriz atuais, histórico comercial, oportunidades, cenário econômico, compromissos propostos, cinco visitas em estados diferentes, um relato pendente de revisão, quatro análises de solo com 36 medidas, 12 observações NDVI simuladas e perfil/intenção de grãos. Não inclui prescrição, cotação de mercado, fonte oficial, contato real, mensagem enviada ou confirmação humana inventada. A visita histórica concluída é um estado de demonstração explicitamente identificado.

O seed exige tenant e proprietário existentes, ativos e com vínculo de carteira. Só aceita `staging` ou `test`. Executa uma única transação com lock de escopo e INSERTs parametrizados. Os identificadores determinísticos incluem tenant e proprietário. Se o produtor já existir, retorna o cadastro sem alterar nada, inclusive edições, arquivamento, datas e exclusões de registros relacionados. Não executa migration nem usa armazenamento local como substituto do PostgreSQL.

Para revisar a quantidade de registros sem conexão com banco:

```sh
VAL_DEMO_ENVIRONMENT=staging VAL_DEMO_TENANT_ID=<uuid-tenant> VAL_DEMO_OWNER_ID=<uuid-login> node scripts/seed-demo-producer.mjs --dry-run
```

Para persistir, forneça `VAL_DEMO_DATABASE_URL` via ambiente seguro, apontando para um banco cujo nome contenha `staging`, `stage`, `sandbox`, `test` ou `gate`, e use `--apply`. O script não lê `DATABASE_URL`, não revela credenciais e não permite exceção por confirmação para um nome de banco de produção. Migrations devem estar aplicadas previamente.

Integração interna autenticada: `seedDemoProducer({database: repository.db, tenantId: repository.tenantId, ownerId: authenticatedOwnerId, environment: trustedServerEnvironment})`. Ambiente, tenant e proprietário devem vir do servidor, nunca do corpo da requisição. A rota deve estar disponível somente em staging/test e usar as mesmas proteções de autenticação e CSRF das demais escritas. Cada login autorizado recebe sua própria demonstração.

Perguntas para testar a VAL: “Qual o perfil do Rafael e como preparar a conversa?”, “O que ficou combinado na última visita?”, “Compare as safras e os talhões”, “Qual o potencial comercial e o próximo passo?”, “Que dados faltam para investigar a variação de vigor?” e “Como está a intenção de venda de soja?”. Solo e NDVI devem continuar identificados como simulados e sem aprovação técnica.

Verificação focada: `node --test test/demo-producer.test.js`. Os testes cobrem integridade do cenário, geometria/áreas, contratos de relato, isolamento, repetição com edição e exclusão, rollback, bloqueio de produção e execução sem conexão por padrão. A persistência real deve ser verificada no staging após a execução autorizada.
