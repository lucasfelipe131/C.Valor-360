# ADR-006 — ciclo visita → confirmação → aprendizado

Status: aceito localmente para validação da Fase 6.

## Contexto

A VAL já agenda visitas, prepara a conversa com os contratos das Fases 3–5 e mantém `interactions`, `opportunities`, `Commitment v1`, anexos e memória. O elo ausente era registrar o que ocorreu, obter confirmação humana e devolver o aprendizado autorizado à próxima preparação.

## Decisão

O ciclo evolui o monólito modular existente:

`Visit legado → PrepareVisit v1 → texto/áudio → VisitReport v1 candidato → revisão humana → Interaction + MemoryRecord + Commitment + Outcome + LearningCandidate → novo ContextSnapshot → próxima PrepareVisit`.

- `visits.status` continua compatível; `VisitLifecycle v1` é aditivo.
- toda regeneração da preparação cria uma versão append-only.
- transcrição e extração não são fatos.
- somente itens confirmados escrevem memória.
- outcome não se limita a venda.
- aprendizado nasce apenas como `LearningCandidate/CANDIDATE`.
- `ValEngine`, prompts e safety agronômico permanecem intactos.

## Alternativas rejeitadas

- novo sistema de visitas paralelo: duplicaria identidade, dados e regras.
- promover transcript a memória: viola confirmação humana e governança.
- concluir visita pela data: confunde agenda com execução.
- gerar `KnowledgeItem` diretamente: promoção pertence ao Passo 11.

## Consequências

Há seis estruturas aditivas e rotas v1 novas, mas APIs históricas permanecem iguais. A próxima preparação pode recuperar objeções, provas solicitadas, compromissos, outcomes, sinais observáveis, oportunidades e lacunas da visita confirmada.

## Reversibilidade

As rotas podem ser desabilitadas e as estruturas deixadas inertes sem tocar dados legados. Rollback físico só é aceitável em banco efêmero e está documentado em `MIGRATION_004_REVIEW.md`.
