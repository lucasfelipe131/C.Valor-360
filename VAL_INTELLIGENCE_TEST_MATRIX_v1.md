# Matriz de testes de inteligência — VAL Copiloto v1

| ID | Camada | Invariante | Teste/evidência | Estado local |
|---|---|---|---|---|
| INT-01 | MMI | voz não confirmada não altera memória | Voice Capture service/migration | PASS |
| INT-02 | MCTX | Knowledge externo não entra em fatos/validated_knowledge | teste de integração Knowledge | PASS |
| INT-03 | MIC | perfil usa sinais observáveis e threshold | behavioral profile + Prepare quality | PASS |
| INT-04 | MDI | tese possui 1–3 incertezas materiais | Costa Beber + contrastes | PASS |
| INT-05 | MVV | perguntas são específicas, no máximo 3 | quality/golden | PASS |
| INT-06 | MEX | até 3 ações e compromisso contextual | ActionPlan/Prepare | PASS |
| INT-07 | VIS | visita 2 usa confirmação da visita 1 | phase6 + voice loop | PASS |
| INT-08 | Knowledge | catálogo contém 100/30/30 válidos | library integrity | PASS |
| INT-09 | Knowledge | seleção máx. 3, determinística e explicável | retrieval tests | PASS |
| INT-10 | Knowledge | lifecycle, autoridade, risco e geografia bloqueiam item inadequado | governance tests | PASS |
| INT-11 | Knowledge | fonte inventada e prompt injection são rejeitados | security tests PT-BR/EN | PASS |
| INT-12 | Quality | nona dimensão `KNOWLEDGE_USAGE` não reduz as oito anteriores | Prepare quality + efeito causal | PASS |
| INT-13 | MIA | observação/timing influencia conversa sem prescrição | agronomic safety/golden | PASS |
| INT-14 | Manual | HMAC e aprovação técnica permanecem | ingestion + `manual/integration-smoke.mjs` | PASS |
| INT-15 | Tenancy | produtor, áudio, transcript e artefato não cruzam tenant | phase/voice/cross-tenant | PASS |
| INT-16 | Learning | LearningCandidate não promove knowledge | phase6/voice | PASS |
| INT-17 | Observabilidade | logs não contêm conteúdo sensível da biblioteca/voz | observability tests | PASS |
| INT-18 | Compatibilidade | Fases 02–06, APIs, migrations, PWA e builds passam | suíte/gates completos | PASS local |

## Comandos de gate

```bash
node --test
node --test test/phase2-*.test.js
node --test test/phase3-*.test.js
node --test test/phase4-*.test.js
node --test test/phase5-*.test.js
node --test test/phase6-migration-contract.test.js test/phase6-visit-loop.test.js
node --test test/voice-capture-*.test.js
node --test test/technical-safety-audit.test.js
npm run test:phase2:smoke
npm run test:phase5:smoke
npm run test:phase6:smoke
npm run build
npm run pwa:verify
(cd manual && npm run build)
node manual/integration-smoke.mjs
```

Nenhum `knowledge:sync` ou recurso externo faz parte desta versão.

## Evidência da rodada local

- suíte completa, fases, Voice, knowledge, quality, safety e tenancy: verdes;
- smokes Fase 02, 05 e 06: verdes;
- build Vite/PWA e build Manual: verdes;
- smoke vertical Manual -> VAL: verde;
- `git diff --check` e sintaxe dos módulos alterados: verdes;
- warning conhecido: chunk Vite acima de 500 kB, não bloqueante.

## Evidência remota e staging

- GitHub Actions `Validate #185`: `success` no commit remoto `91430010212a3cf3dc5aac6c1d70983b64df26bd`;
- Railway deployment `bd35a9ab-5ab2-4772-a9bc-8543d4339b9a`: `SUCCESS` na mesma árvore validada localmente;
- `/health`, `/ready` e landing: HTTP `200`;
- cinco migrations: `already-applied`; nenhuma migration desta entrega;
- logs de build/deploy sem erro severo ou conteúdo sensível detectado.

UAT físico de voz não é contado como teste de inteligência local e permanece bloqueio separado no gate final.
