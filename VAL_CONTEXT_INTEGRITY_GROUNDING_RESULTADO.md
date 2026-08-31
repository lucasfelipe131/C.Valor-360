# VAL CONTEXT INTEGRITY + GROUNDING + FAST FOLLOW-UP RECOVERY v1

## Classificação final

**VAL CONTEXT INTEGRITY = FAIL**

Data da avaliação: 2026-08-30  
Base autorizada: `5aee2cf0d2bac615ed4f6ec39791980f5cb4f487`  
Branch: `fix/val-context-integrity-grounding-v1`  
Checkpoint local: `551458f`  

O código da correção foi implementado e preservado em commit local, mas o gate não pode ser aprovado porque a publicação remota, o CI e o replay autenticado de staging não foram concluídos. O resultado histórico em `GATE_VAL_AI_COPILOT_v2_RESULTADO.md` não comprova esta nova integridade contextual e deve ser considerado superado para este gate.

Uma auditoria read-only concluída após o primeiro checkpoint também encontrou três bypasses reproduzíveis ainda não corrigidos: ação de card no frontend sem comparação 6D completa; fallback da biblioteca de objeções sem filtro tenant/owner nos eventos; e fallback de produtores/perfis de grãos sem isolamento completo por tenant. Por isso este pacote é um **handoff de correção incompleta**, não uma release candidata.

## Causa arquitetural encontrada

A composição anterior permitia contexto excessivamente amplo e reutilização de estado sem uma fronteira uniforme de tenant, owner, produtor, conversa, domínio e epoch. Alguns caminhos também aceitavam evidência sem proveniência completa ou relabelavam dados recebidos com o escopo do request. Isso tornava possíveis contaminação entre produtores/domínios, stale turns e afirmações não sustentadas.

A origem histórica exata dos trechos “repassar alguns fertilizantes”, “CPF financeira” e “travamento de um contrato de grãos” ainda não pôde ser vinculada a `sourceId` real. Essa comprovação depende do Context Trace no replay autenticado do staging e permanece requisito bloqueante.

## Correções implementadas

- `VALContextSelector` com domínio explícito e minimum sufficient context.
- Fronteira fail-closed de tenant + owner + producer + conversation + contextEpoch + domain.
- Rejeição recursiva de evidência de outro produtor e de aliases de escopo conflitantes.
- Proveniência canônica por evidência: tipo epistêmico, sourceType/sourceId, produtor, tenant, owner, timestamp, relevância e motivo de seleção.
- Hard assertion pré-modelo e verificação pós-resposta de grounding e relevância da pergunta.
- PROFILE restrito a evidência comportamental e resposta curta com camadas expansíveis.
- Separação entre continuidade conversacional e memória factual do produtor.
- Follow-up “Resume.” vinculado ao último turno concluído da mesma fronteira 6D.
- `contextEpoch` estrito, sem coerção de null/string/boolean/fracionário/negativo/unsafe.
- Caches derivados protegidos contra repopulação por carga antiga em voo.
- MARKET/GLOBAL exige marcador original, tenant/owner exatos e produtor ausente.
- Evidência de anexo exige vínculo único com o anexo autorizado.
- Context Trace seguro com selecionados e rejeitados, sem payload sensível em log global.
- Golden set CTX-001 a CTX-012, poison tests e testes de stale turn/follow-up.

## Evidências locais

- Auditoria final focada: **171/171 PASS**.
- Epoch: **190/190 PASS** nas regressões focadas; matriz adversarial **7/7 PASS**.
- MARKET/GLOBAL: **163/163 PASS**.
- Frontend/follow-up 6D e HTTP integrado: **72/72 PASS**.
- Vínculo de anexos: **38/38 PASS**.
- Regressão crítica posterior ao ajuste de compatibilidade de epoch: **PASS**.
- Builds Vite, Manual e PWA, bundle audit e performance local executados anteriormente: **PASS**.
- Golden performance local: 320 amostras, mas não representa HTTP/PostgreSQL/Railway e não comprova p95 PROFILE em staging.
- Regressão completa final: **FAIL** em um teste de readiness (`/ready` retornou 503 em vez de 200). Portanto a suíte completa não está verde nesta árvore final.

## Gate obrigatório

| Critério | Resultado | Observação |
|---|---:|---|
| Context producer isolation | FAIL | Fallback de produtores/perfis ainda permite registros cross-tenant/unscoped |
| Domain relevance | FAIL | Ação de card no frontend ainda pode aceitar domain/epoch de outro escopo |
| Source grounding | FAIL | Proteção técnica passa; origem histórica exata depende do replay de staging |
| Profile query | PASS local | Estrutura curta e evidência comportamental |
| Cross-producer poison | PASS local | Coberto pelo golden/adversarial set |
| Cross-domain poison | PASS local | Coberto pelo golden/adversarial set |
| Follow-up | FAIL | Caminho principal passa, mas a visibilidade/ação de card ainda não aplica a fronteira 6D completa |
| Latency | FAIL | Falta p95 PROFILE < 2 s em ambiente representativo |
| Anti-hallucination | FAIL | Fallback da biblioteca de objeções ainda pode carregar eventos de outro tenant/owner |
| Suíte completa | FAIL | Um teste final de readiness falhou |
| CI remoto | NOT EXECUTED | Branch não pôde ser publicada |
| Staging exato | NOT EXECUTED | Permitido somente após CI verde |
| Validação visual staging | NOT EXECUTED | Dependente de publicação/CI |
| UAT físico | NOT EXECUTED | Proibido nesta autorização |

## Publicação

O preflight obrigatório `git ls-remote origin HEAD` passou antes de qualquer alteração e retornou `f405617405fb66811207fdf006c2fbdaebfb8c9d`.

A tentativa autorizada de publicar `551458f` em `origin/fix/val-context-integrity-grounding-v1` falhou com:

```text
fatal: could not read Username for 'https://github.com': No such device or address
```

Por determinação expressa da autorização, o trabalho foi interrompido após a incapacidade de publicação. Nenhum workaround de credenciais foi tentado.

## Escopo preservado

- Produção não foi alterada.
- `main` não foi alterada.
- Nenhum UAT físico foi executado.
- Passo 07, Prompt Mestre, novas funções de Grãos, Crédito e GeoIntelligence não foram iniciados.

## Conclusão

**GATE = FAIL.**

Para uma futura retomada, o mínimo necessário é: corrigir e testar os três bypasses finais; restaurar autenticação Git; publicar o checkpoint corrigido; executar todos os checks remotos; corrigir/confirmar o readiness; obter p95 PROFILE representativo abaixo de 2 s; e reproduzir em staging, para Matheus Nascimento Jaeger, a pergunta exata “qual o perfil dele?”, registrando Context Trace e ausência dos três conteúdos contaminantes. Só então este documento poderá ser reclassificado como PASS.
