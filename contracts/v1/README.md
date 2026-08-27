# Contratos canônicos v1 do VAL Core

Os contratos desta pasta são aditivos e versionados. Eles não substituem os payloads públicos históricos.

- `request-envelope.schema.json`: envelope interno montado pelo servidor. Tenant, ator e escopo nunca são aceitos do corpo enviado pelo navegador.
- `response-envelope.schema.json`: resposta canônica do endpoint `/api/v1/val/recommendations`.
- `memory-record.schema.json`: registro canônico aditivo da MMI; separa natureza da memória, estado epistemológico, origem, validade, confiança, ACL e supersessão.
- `context-snapshot.schema.json`: contexto mínimo, autorizado e rastreável selecionado pelo MCTX, persistido como entidade de primeira classe com auditoria de refs selecionadas/excluídas e políticas de freshness por domínio/fonte.
- `behavioral-profile.schema.json`: saída probabilística, explicável e rastreável do MIC.
- `questionnaire-definition.schema.json`: contrato do Produtor 360 (27 perguntas no núcleo, 26 obrigatórias e 18 complementares opcionais).
- `decision-thesis.schema.json`: tese posicionada ou bloqueio explícito para descoberta do MDI.
- `value-plan.schema.json`: estratégia do MVV com no máximo três perguntas materiais.
- `action-plan.schema.json`: até três prioridades determinísticas do MEX, rastreáveis ao snapshot, tese e plano de valor.
- `commitment.schema.json`: compromisso formal com owner, prazo, critério, lifecycle e evidência.
- `insight-card.schema.json`: unidade acionável e expirável do VIS, filtrada por tenant, ator e papel.
- `prepare-visit.schema.json`: apresentação de preparação vinculada à visita e aos contratos das Fases 3–5.
- `visit-lifecycle.schema.json`: lifecycle explícito e auditável da visita, sem inferir conclusão pela data.
- `visit-transcript.schema.json`: resultado rastreável da porta de transcrição; nunca consolida fatos diretamente.
- `visit-report.schema.json`: interpretação candidata e revisável do relato pós-visita.
- `outcome.schema.json`: resultado comercial, técnico ou relacional ligado à visita e às evidências.
- `learning-candidate.schema.json`: hipótese de aprendizado em estado governado; a Fase 6 cria somente `CANDIDATE`.
- `voice-candidate.schema.json`: item extraído de transcript não confiável; separa categoria de estado epistêmico e exige confirmação humana em todos os casos.
- `voice-interaction.schema.json`: captura transversal tenant-safe para pré-visita, campo, pós-visita, Cliente 360 e contexto geral, com estados granulares de transcrição, extração, retry, revisão e confirmação.
- `knowledge-item.schema.json`: item externo estruturado com lifecycle, autoridade, risco, geografia, fontes e policy de uso; nunca representa fato do produtor.
- `knowledge-source.schema.json`: registro curado e versionado das fontes que sustentam KnowledgeItems.
- `knowledge-selection.schema.json`: seleção determinística de no máximo três itens, com motivos, caveats e provenance; não contém dump do catálogo.
- contratos antigos permanecem disponíveis em `/api/val/chat` e `/api/val/recommendations` por meio do adaptador legado.

## VoiceInteraction v1

A VCE é uma camada de captura, não um cérebro paralelo. O fluxo canônico é áudio ou texto manual → transcrição → extração candidata → revisão humana → confirmação → módulos existentes. O transcript é sempre dado não confiável: não altera policies, prompts ou instruções e não executa ferramentas.

Endpoints aditivos, todos protegidos pelo cookie `valor360_session`:

- `POST /api/v1/voice-interactions`: cria a interação; aceita fallback `manual_text` sem exigir áudio.
- `POST /api/v1/voice-interactions/{voiceInteractionId}/audio`: valida e armazena conscientemente um áudio de até 6 MB e 900 segundos.
- `POST /api/v1/voice-interactions/{voiceInteractionId}/process`: transcreve quando necessário e organiza candidatos; retry reutiliza a mesma interação.
- `GET /api/v1/voice-interactions/{voiceInteractionId}`: recupera somente no tenant, ator e carteira autorizados.
- `POST /api/v1/voice-interactions/{voiceInteractionId}/confirm`: confirma, edita, rejeita ou adiciona candidatos antes de qualquer escrita material.
- `POST /api/v1/voice-interactions/{voiceInteractionId}/cancel`: cancela uma captura não confirmada.

Áudio, base64, texto do transcript, prompts e secrets nunca entram em logs, telemetria ou payloads de erro. O acesso cross-tenant é negado sem revelar conteúdo. Áudio bruto permanece atrás de referência opaca de storage; transcrição e fatos confirmados possuem ciclos de retenção independentes. Uma observação agronômica confirmada continua sendo relato e não se transforma em prescrição sem o fluxo técnico apropriado.

Uma futura versão deve receber novo identificador e novos arquivos. Os schemas v1 não podem ser alterados de forma incompatível.
