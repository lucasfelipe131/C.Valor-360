# K5 — fixtures sintéticas controladas

Base: PR #107, `451642143eadfbf549dbbe7075db29683f2cc677`. Nenhuma pergunta ou rubrica K5 é alterada. O histórico de 30 casos (10 PASS, 20 FAIL, 16 fallbacks) permanece intacto.

## Preparação

`server/k5-staging-fixtures.js` roda uma transação idempotente apenas na combinação exata de projeto, ambiente e serviço Railway de staging. Não há endpoint de produto, migration, coluna, segredo ou controle de UI novo. Contas devem existir, estar ativas, sem troca de senha pendente e com papel consultant. Não cria usuários nem lê ou altera credenciais. Colisão de identidade/owner/source aborta a transação. Seed repetido preserva edições.

`clients.source = k5_synthetic_fixture` é a marca canônica. Carteira do consultor A: Produtor UAT A e Produtor UAT B. Carteira do consultor B: terceiro produtor exclusivo. UUIDs determinísticos por tenant e chave da fixture; nenhuma fixture pertence ao administrador. Dados numéricos são entradas sintéticas documentadas no manifesto, não thresholds/oráculos novos. Hobby, aniversário e telefone não são inventados; hobby B permanece ausente. Duas fichas possuem alias Horizonte. Safras são linhas separadas; produtividade é meta, sem produtividade realizada. A possui visita Realizada sintética, zero irrigado explicitamente confirmado em observação cadastral e intenção sem contrato. Alterações de contato e respostas atrasadas são ações dos respectivos casos, não precondições fabricadas.

## Indicadores e rastreabilidade

Filtros aplicados a contagem de produtores/por usuário, visitas, oportunidades, análises, feedback relacionado, séries diárias de análises, BI gerencial, resumo da carteira, Home, relatórios e totais do pipeline. Registros operacionais continuam acessíveis. Audit events, usage events, logins e logs técnicos não são removidos. Contagens técnicas de uso não são métricas comerciais e permanecem visíveis.

O seed captura antes/depois pelas consultas reais do painel administrativo (apenas leitura interna de métricas, não uma sessão nem prova de PR011), incluindo valores de oportunidades e eventos comerciais. Divergência faz rollback. Eventos `k5_fixture_seeded` preservam origem e owner; evento de log `k5_fixture_preparation` registra mapa e comparação. Indicadores visuais ainda requerem conferência no staging publicado.

## Isolamento e limites de evidência

O seed exercita o repository/resolver com os dois owners consultores: leitura própria por ID, rejeição de ID estrangeiro, nome estrangeiro e contexto/follow-up estrangeiro. Não chama provedor. Isso complementa a prova de duas sessões autenticadas não administrativas; não a substitui. `PR011_READY` só pode ser declarado após essa prova autenticada.

## Reteste

Somente após todas as precondições PASS: exatamente AG-001 a AG-030 novamente, nova medição, até 60 chamadas internas, sem as outras 270 e sem repetição automática. Avaliação de IA não será registrada como média humana. Autorização de custo já fornecida pelo usuário.
