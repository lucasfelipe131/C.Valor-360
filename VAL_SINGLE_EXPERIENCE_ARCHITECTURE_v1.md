# Arquitetura da experiência única — VAL v1

## Princípio

O consultor interage com uma única copiloto. MMI, MCTX, MIC, MDI, MVV, MEX, VIS, MIA, Voice Capture e Biblioteca continuam internos. A simplificação acontece depois do raciocínio, não em lugar dele.

## Fluxo

```text
Consultor (texto ou voz)
  -> autenticação + tenant
  -> Voice Capture / interação
  -> confirmação humana
  -> MMI + MCTX
  -> seleção governada de conhecimento (máx. 3)
  -> MIC + MDI + MVV + safety/MIA
  -> MEX + VIS
  -> Home / Prepare Visit / Cliente 360 / Pós-visita
  -> Outcome -> LearningCandidate (sem promoção automática)
```

## Uma experiência, quatro momentos

| Momento | Primeira ação | Resultado visível |
|---|---|---|
| Home | “Falar com a VAL” | Até três prioridades e o próximo movimento |
| Preparar Visita | “Adicionar contexto” | Objetivo, por que agora, até três perguntas, estratégia, evite e compromisso |
| Cliente 360 | “Registrar informação” | Memória viva, mudança, compromisso e próximo passo |
| Pós-visita | “Me conte como foi” | Candidatos revisáveis; persistência apenas após confirmação |

Na Home, a confirmação de uma entrada `GENERAL_CONTEXT` é seguida por uma chamada ao pipeline existente da VAL. A resposta curta usa o mesmo contexto autorizado e a mesma engine; se a análise falhar, a memória confirmada permanece salva e a interface informa a degradação sem inventar orientação.

## Roteamento

O usuário comum não escolhe motor, metodologia ou etapa. O objetivo, a entidade, o momento da jornada e o contexto autenticado definem o pipeline. Atalhos avançados e análises permanecem disponíveis em camadas secundárias.

## Contratos preservados

- `RequestEnvelope v1` não recebe novos módulos em campos fechados.
- `ContextSnapshot v1` não recebe conhecimento externo no topo nem em `validated_knowledge`.
- `DecisionThesis`, `ValuePlan`, `ActionPlan` e `PrepareVisit` mantêm campos obrigatórios e versões.
- Knowledge possui contrato próprio e seleção compacta com provenance.
- Nenhuma migration é necessária para o catálogo versionado desta entrega.

## Isolamento e safety

- fatos, áudio, transcrição e artefatos continuam filtrados por `organization_id` e ator;
- a Biblioteca externa é global, somente leitura e sem dados de produtor;
- a consulta recebe contexto já autorizado, mas o catálogo não persiste esse contexto;
- conteúdo recuperado é dado não confiável e não altera system prompt, tools ou policies;
- knowledge geral não confirma fatos nem resolve conflitos do produtor;
- claims técnicos de alto risco exigem autoridade adequada e revisão humana;
- observação agronômica não vira produto, dose, mistura ou prescrição.

## Explicabilidade

A primeira camada mostra a decisão. “Por que a VAL está sugerindo isso?” abre fatos utilizados, hipóteses, lacunas, referências e confiança. Conteúdo integral de documentos e scores internos não aparecem na jornada operacional.

## Rollback

O rollback funcional é voltar a branch de staging ao HEAD anterior `e3580b7`. Como não há migration nem recurso pago novo, o catálogo e a UX são revertidos junto com o código, sem transformar ou apagar dados existentes.

## Preparação para Demo Mode

A arquitetura mantém `VAL_DEMO_MODE` separado do acesso autenticado e não conecta o futuro modo público a dados reais. Uma demonstração futura deverá usar tenant, produtor, visitas, áudio e resultados totalmente fictícios, sem reaproveitar sessão ou credencial do staging/produção. QR Code e exposição pública não fazem parte desta entrega.
