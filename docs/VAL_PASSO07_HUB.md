# Passo 07 — Hub de dados e integrações

## Autorização e checkpoint

A autorização explícita do usuário em 2026-10-02 inicia o desenvolvimento do
Passo 07 e substitui as restrições anteriores de início. PR #107 permanece
aberto, draft e sem merge, congelado em
`3070dc0cf5d874b981e23487c99a8fcf7e886f42`.

```
K5_DEVELOPMENT_GATE = WAIVED_BY_USER
K5_RELEASE_GATE = PENDING
K5_EVIDENCE = PRESERVED
K5_NEXT_EXECUTION = BEFORE_FINAL_RELEASE
PRE_STEP_07_ENGINEERING_GATE = PASS_WITH_KNOWN_ISSUES
PRE_STEP_07_RELEASE_CERTIFICATION = PENDING
STEP_07_DEVELOPMENT = AUTHORIZED
PRODUCTION_RELEASE = NOT_AUTHORIZED
```

A rodada K5 foi interrompida após AG-001 a AG-004. AG-005 estava reservado e
não foi enviado. O checkpoint e as evidências anteriores foram preservados;
hash SHA-256 do checkpoint congelado:
`7b995a952adc2e966e85b5852a65f33c75a0aea0bbad2a75d78ad8d2aa139837`.
Não executar K5 por commit. A certificação de release continua pendente.

Branch: `feature/val-passo07-hub-integracoes-v1`.
Base do PR draft stacked: `integration/val-pr106-rodada14-20260920`.
Sem alteração de main, produção, secrets ou contratação externa.

## Responsabilidades

O Hub coordena recebimento, normalização, identidade, versão, proveniência,
auditoria e distribuição. `clients.id` continua sendo o produtor canônico.
`ValRepository.ingestEvent` continua materializando os domínios existentes,
agora podendo participar da transação do Hub. Não há novo CRM, memória,
ContextSnapshot, Prompt Mestre ou motor de IA. SOG, DCred, visitas,
oportunidades, mercado e documentos mantêm seus contratos atuais.

O ledger existente `integration_events` recebe colunas aditivas. Não há cópia
dos payloads para um segundo ledger. `integration_entity_links` guarda apenas
a relação entre ID externo e produtor existente. `integration_event_audit`
registra recebimentos, decisões, conflitos e tentativas em ordem sequencial.
Eventos históricos não são reprocessados nem reclassificados.

## Contrato e primeiro conector

`server/integration-hub/registry.js` define o registro versionado de source
systems e conectores. Somente `manual-do-agronomo` está habilitado. Novos
adaptadores devem declarar versão, autenticação, eventos e materializadores
de domínio existentes antes de serem registrados. Não há conexão ERP, CRM,
cooperativa, multinacional, clima, crédito ou feed pago nesta entrega.

As duas rotas Manual existentes permanecem: `/api/v1/integrations/manual/events`
e `/api/integrations/manual/events`. HMAC continua obrigatório para eventos
técnicos; o token existente mantém sua política anterior para os demais.
O owner é resolvido pelo acesso já existente antes da ingestão.

Eventos reais suportados: `manual.producer.updated`, `manual.workspace.updated`,
`manual.record.saved`, `soil_analysis.completed`, `agronomic.scan.completed`,
`field_report.completed`, `ndvi.observation`, `business.closed`, `business.lost`
e `business.updated`. Não se inventa publicação de um evento apenas porque
ele está no registro: o publisher atual de workspace emite eventos por produtor
e por análise de solo.

Envelope v1 preserva externalId, type, source, ownerUserId, occurredAt,
clientExternalKey, propertyExternalKey, fieldExternalKey e payload. A versão
de origem opcional `sourceVersion` é um inteiro seguro não negativo.
O publisher de workspace passa o timestamp persistido do snapshot como versão
e data observada; reenviar o mesmo snapshot conserva ambos. Publishers legados
sem versão usam observedAt/occurredAt. Ausência de versão após uma versão
explícita exige revisão. Identificadores de entrega não são reutilizáveis
com conteúdo, versão ou destino diferentes. O relógio de um reenvio legado
não muda sua identidade. Objetos são ordenados antes do hash; arrays mantêm ordem.

## Identidade, precedência e atomicidade

As consultas sempre restringem tenant e owner. UUID canônico, chave externa,
aliases conhecidos e IDs externos previamente vinculados podem resolver a
identidade. Mais de um candidato, produtor arquivado ou referência não resolvida
exige revisão. Nome sozinho nunca prova identidade. Um novo produtor só nasce
pelo fluxo Manual de cadastro já existente, com chave e ID estáveis e sem
colisão de nome na carteira. O vínculo conserva UUID e chave canônica; aliases
e proveniência registram a identidade de origem.

No retorno VAL → Manual, o bootstrap conserva o ID Manual já vinculado e a
chave externa canônica. A conciliação não usa nomes nem códigos CRM compartilhados
como prova suficiente. A vista duplicada de bootstraps anteriores só é retirada
quando é exatamente reconstruível, sem dados locais adicionais ou referências
de solo; trabalho local e ambiguidades permanecem para revisão. Eventos de
conflito já recebidos continuam no histórico, mesmo após corrigir a origem.

Um lock transacional por tenant/owner/source serializa entregas e retries;
outras carteiras continuam independentes. O materializador usa savepoint na
mesma transação do ledger. Uma falha desfaz integralmente as alterações de
domínio e conserva o evento e o diagnóstico seguro. Se a própria conexão
PostgreSQL cair, não há confirmação: o remetente pode reenviar o evento.

| Decisão | Comportamento |
| --- | --- |
| NEWER / PROCESSED | Materializa atomicamente e registra o vínculo canônico. |
| OLDER | Conserva a entrega sem aplicar dados antigos. |
| DUPLICATE | Registra o reenvio; não repete gravações de domínio. |
| CONFLICT | Conserva o original; apresenta o conflito em revisão. |
| REVIEW_REQUIRED | Não materializa identidade ambígua, destino arquivado ou dado conflitante. |
| REJECTED | Erro permanente de validação; sem retry automático. |
| FAILED | Falha transitória; retry idempotente elegível e limitado. |

Versão explícita precede data observada. Mesma versão com conteúdo diferente
exige revisão. Dados aprovados não podem ser rebaixados por dados pendentes.
Fatos canônicos de outra origem e edições locais posteriores não são
silenciosamente sobrescritos por mudanças no cadastro recebido. Regras
específicas de solo, geometria e aprovação técnica permanecem no domínio.
Somente eventos processados entram nos registros Manual do contexto da VAL.

## Operação, segurança e retries

Gestão → Hub / Integrações mostra o conector, saúde baseada nos resultados de
ingestão, última sincronização, volumes, erros, revisão, tentativas e latência.
Não é um teste ativo de conectividade externa. A API exige sessão autenticada;
os parâmetros nunca substituem tenant/owner da sessão. BI viewer mantém o
bloqueio gerencial existente. Mesmo administradores veem apenas sua própria
carteira nesta versão. A API não retorna payloads nem mensagens de exceção.
Uma transferência de carteira não expõe o cadastro atual ao owner anterior;
o histórico das entregas continua no escopo original.

GET `/api/integration-hub/overview` aceita filtro de estado e paginação.
GET `/api/integration-hub/events/:id` retorna proveniência e auditoria segura.
POST `/api/integration-hub/events/:id/retry` reutiliza o evento persistido;
não recebe payload substituto. Falhas transitórias admitem até cinco tentativas
totais, com backoff de 30, 60, 120 e 240 segundos. O painel permite solicitar
retry após o prazo. Não há worker externo ou agendamento pago. Se um registro chegar antes do
cadastro do produtor, fica preservado para revisão e retry. A confirmação de
um produtor reavalia até 25 registros pendentes de identidade exata no mesmo
tenant/owner/source, reutilizando seus eventos. Ambiguidades e conflitos não
entram nessa reavaliação automática. Revisões restantes são
resolvidas corrigindo a origem e enviando uma nova versão; esta entrega não
autoriza fusão manual de produtores nem edição arbitrária de payloads.

## Validação

`test/integration-hub.test.js` executa sobre PGlite na suíte normal e sobre
PostgreSQL 16 real no job phase1 de CI. O segundo também exercita o servidor
HTTP real, assinatura HMAC e sessões distintas. `test/integration-hub-ui.test.js`
testa navegação, filtros, proveniência, retry e erros de sessão. Os testes
existentes do Manual, isolamento, contexto e demais domínios continuam ativos.
Todos os fixtures são sintéticos e locais/CI, sem provider calls.
