# Organizational Learning v1

Base: 7310a2b8ba16037405c0816edad0db4292c7abc8. Branch empilhada sobre Passo 10.

O modelo propõe. O banco registra. O resultado rotula. O motor aprende offline. O humano revisa e aprova. A VAL publica somente versões autorizadas e mantém comportamento de produção inalterado.

## API e controles

As rotas `/api/learning` usam sessão autenticada e membership ativa conferida no banco, flags da governança do Passo 08 e tenant fixo. Admin acessa organização; revisão técnica fica limitada à unidade autorizada; consultor lê apenas candidatos da própria carteira; gestão recebe agregados da unidade, sem evidências individuais ou ranking de pessoas.

- GET `/api/learning/center`: projeções paginadas, candidatos, padrões, datasets, shadow, drift, promoções, histórico e rollback.
- GET `/api/learning/candidates/:id`: detalhe com histórico de revisão.
- POST `/api/learning/candidates`: hipótese ancorada em outcomes canônicos.
- POST `/api/learning/candidates/:id/evidence`: evidência contrária vinculada, reduz confiança e reabre revisão.
- POST `/api/learning/candidates/:id/review`: transição explícita, estado esperado e evidências revisadas.
- POST `/api/learning/datasets`: extração offline por período, hash, exclusões e quality report.
- POST `/api/learning/shadow`: avaliação temporal sem escrita no score oficial.
- POST `/api/learning/drift`: comparação de períodos distintos com policy aprovada.
- POST `/api/learning/controls` e `/:id/review`: proposta/revisão independente de thresholds offline e relatório de regressão.
- POST `/api/learning/promotions` e `/:id/review`: versões de knowledge, prompt, policy, peso, modelo, pergunta ou regra; publicação e rollback explícitos.

Flags: organizational_learning_v1, learning_center_v1, shadow_ranker_v1, knowledge_promotion_v1 e drift_monitor_v1. Defaults habilitados apenas em staging/test/development. Registry incorpora oito policies versionadas e candidatos de modelo/prompt/policy.

## Limites materiais

Nenhum threshold real foi aprovado nesta entrega. Fixtures usam políticas sintéticas somente em banco de teste. Dataset real sem amostra suficiente não gera ranking nem promoção. Exibição histórica não é presumida. Métricas faltantes permanecem indisponíveis, sem inferir causalidade ou probabilidade de compra. Publicação no registro governado não ativa código, prompt, peso ou conhecimento de produção.

Nenhuma execução de K5 completo, UAT físico, alteração de secrets, merge ou promoção de produção é autorizada pelo Passo 11. Wait for CI permanece PENDING_WAIT_FOR_CI.
