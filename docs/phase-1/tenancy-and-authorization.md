# MSP, tenancy e autorização

## Convenção atual

O repositório não usa `organization_id`; o nome canônico atual é `tenant_id`. `organizations.id` identifica a organização e `memberships` liga usuário, papel e tenant.

O piloto permanece travado em `00000000-0000-4000-8000-000000000001`. `server/config.js` e `manual/app/lib/tenant.ts` rejeitam qualquer segundo tenant. Isso é uma trava operacional, não substitui isolamento.

## Pontos de uso

| Área | Mecanismo atual | Fundação acrescentada |
|---|---|---|
| Sessão principal | token contém tenant e só aceita o tenant piloto | teste negativo explícito |
| Repositórios VAL | instância recebe tenant; SQL usa `$1` | guard impede override do chamador antes de DB/fallback |
| Acesso e SOG | repositórios fixos no tenant | mantidos, cobertos pelo baseline |
| Manual embutido | identidade HMAC derivava usuário | identidade agora inclui tenant assinado |
| Workspace/records Manual | somente `workspace_id` | migration expand e queries por `tenant_id + workspace_id` |
| Webhook Manual | servidor escolhe tenant fixo | continua sem aceitar tenant do payload |
| Logs | tenant poderia aparecer bruto | somente hash curto `tenant_ref` |

## Matriz Role × Resource × Operation × Scope

Esta matriz descreve o que o código **efetivamente impõe hoje**, não o alvo futuro.

| Papel | Recurso | Operações atuais | Escopo efetivo |
|---|---|---|---|
| `admin` | usuários e memberships | listar, criar, alterar, bloquear, resetar senha | organização piloto |
| `admin` | métricas administrativas | leitura | organização piloto |
| `admin` | produtores, visitas, oportunidades e VAL | mesmas operações funcionais dos demais papéis | carteira do próprio login nas rotas normais |
| `manager` | produtores, visitas, oportunidades e VAL | leitura/escrita exposta pelas rotas protegidas | carteira do próprio login; visão de equipe ainda não implementada |
| `consultant` | produtores, visitas, oportunidades e VAL | leitura/escrita exposta pelas rotas protegidas | carteira do próprio login |
| `technical_reviewer` | dados técnicos e VAL | hoje recebe as mesmas rotas gerais | carteira do próprio login; fila de revisão exclusiva ainda não existe |
| qualquer sessão VAL | Manual | `admin` vira `admin`; demais viram `tester` | tenant assinado e workspace do usuário |
| HMAC/token de integração | eventos Manual | ingestão idempotente | owner ativo do tenant piloto |
| público | questionário por token | ler/submeter convite válido | convite com tenant resolvido pelo servidor, nunca pelo payload |

## Riscos cross-tenant mapeados

| Risco | Severidade | Controle do Passo 01 |
|---|---:|---|
| parâmetro `tenantId` sobrescrever instância de repositório | crítica | guard 403 e teste sem escrita |
| workspace do Manual colidir entre organizações | crítica | tenant na identidade, tabela e query |
| evento de integração escolher organização no payload | crítica | tenant continua definido no servidor |
| cookie de tenant diferente | crítica | sessão principal e Manual filtram tenant fixo |
| logs exporem ID/usuário | alta | referências SHA-256, allowlist de campos |
| métricas/identidade global do Manual em cenário multi-org | alta | segunda organização bloqueada; fechar modelo antes de habilitar |
| ausência de RLS | alta | defesa em aplicação agora; RLS exige ADR e rollout posterior |

Nenhuma segunda organização pode ser provisionada até testes com PostgreSQL real, contrato de identidade do Manual e decisão de RLS serem aprovados.
