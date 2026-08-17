# VALOR 360

CRM e inteligência de decisão comercial e agronômica para gerar valor em cada relação.

## VAL — Value Agriculture Intelligence

A VAL cruza cliente, negócios, visitas, relatórios de campo, análises de solo e sinais NDVI para preparar a próxima conversa. A saída é estruturada e auditável: objetivo, próxima pergunta, plano SPIN, hipótese de valor, comparação entre agir/esperar/manter, evidências, incerteza, possível compromisso e limites de segurança.

Ela não se “retreina sozinha”. O modelo raciocina; o PostgreSQL memoriza; eventos e feedback alimentam avaliação controlada; pessoas aprovam mudanças e decisões relevantes.

## O que está implementado na versão 0.4

- interface Ultra responsiva para web e celular;
- Responses API com Structured Outputs e `store:false` por padrão;
- roteamento entre `gpt-5.6-terra`, `gpt-5.6-sol` e `gpt-5.6-luna`;
- fallback demonstrativo sem chave;
- PostgreSQL canônico para clientes, histórico de negócios importado, memória, recomendações e feedback; o quadro de oportunidades ainda é local no piloto;
- questionários e respostas persistidos no PostgreSQL fora do modo demonstrativo;
- migração preservando tabelas do MVP 0.3;
- webhook HMAC idempotente para o Manual do Agrônomo;
- persistência especializada de relatórios de campo, solo, medições e NDVI;
- importação comercial validada novamente no servidor;
- autenticação mínima fail-closed para o piloto;
- VAL Grãos com SOG operacional: perfil de grãos, intenções com evidência, referências de mercado rastreáveis e priorização determinística;
- revisão humana obrigatória para diagnóstico, prescrição, dose, mistura e conteúdo agronômico sensível;
- dataset dourado e testes locais independentes da Evals API.

O modo atual continua sendo **piloto de uma organização**. Antes de múltiplas empresas são obrigatórios identidade corporativa, papéis, tenant na sessão, Row-Level Security testada e isolamento de arquivos/geometrias.

## Ativação segura

Nunca coloque segredos no frontend, no GitHub ou em mensagens. Configure-os no ambiente privado do servidor nesta ordem:

1. `DATABASE_URL` e execute `npm run db:migrate`.
2. `VAL_ADMIN_EMAIL`, `VAL_ADMIN_PASSWORD` (mínimo 12 caracteres) e `VAL_SESSION_SECRET` (mínimo 32 caracteres).
3. `VAL_MANUAL_WEBHOOK_SECRET` para a integração servidor-servidor.
4. Somente depois, adicione `OPENAI_API_KEY`.
5. Faça o deploy e confirme `/health` e **Configurações → Engine da VAL**.

Use `.env.example` como referência. A chave da OpenAI fica exclusivamente no backend; uma chave presente sem banco e autenticação não libera a IA.

## Desenvolvimento

```bash
npm install
npm test
npm run build
npm run dev
```

O modo demo só é permitido quando `VAL_DEMO_MODE=true` é definido explicitamente. Sem essa variável, o servidor falha fechado enquanto acesso e banco não estiverem configurados.

## Deploy na Railway

O `railway.json` executa o build, roda a migração antes do deploy e inicia o servidor Node. Configure todos os segredos no projeto da Railway antes de liberar o domínio.

Antes de qualquer publicação, siga o checklist em [`docs/DEPLOY_CHECKLIST.md`](docs/DEPLOY_CHECKLIST.md). O build carimba e valida automaticamente o nome do cache do PWA para impedir que uma release nova reutilize arquivos de uma versão anterior.

## Estrutura principal

- `src/`: aplicação React responsiva.
- `server/val-engine.js`: roteamento, OpenAI e barreira determinística.
- `server/sales-playbook.js`: contrato estruturado e método operacional da VAL.
- `server/ingestion.js`: contrato e validação de eventos.
- `server/repository.js`: persistência PostgreSQL e modo demo.
- `server/grain-intelligence.js`: validação e regras explicáveis da SOG.
- `server/grain-repository.js`: persistência isolada do domínio de grãos.
- `database/schema.sql`: banco canônico e migração do MVP anterior.
- `knowledge/approved/`: materiais aprovados para a base semântica.
- `evals/`: casos dourados independentes de fornecedor.
- `docs/VAL_ENGINE.md`: arquitetura, contratos e limites.
- `docs/SOG_DATA_ECOSYSTEM.md`: fontes, fluxo, score, APIs e governança da VAL Grãos.
- `docs/DEPLOY_CHECKLIST.md`: validações obrigatórias antes e depois de cada publicação.

## Limites atuais

Object storage, antivírus/OCR, ingestão direta de PDF/Excel técnico, PostGIS, processamento de raster/COG, RLS multiempresa, identidade corporativa e avaliação online com casos reais ainda são camadas de produção, não funcionalidades concluídas. A integração atual do Manual recebe JSON estruturado. NDVI gera triagem; não determina causa. Conteúdo técnico acionável é retido e a receita ou recomendação agronômica final continua sendo responsabilidade de profissional habilitado.

O índice gerado pela importação comercial é somente uma ordenação heurística da base. Campo ausente permanece desconhecido: sem data não há recência; sem resultado classificado não há conversão; sem valor não há ticket. O índice não é probabilidade de compra nem potencial financeiro.
