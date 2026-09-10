# VAL — correção do modo conversa

Data: 10/09/2026. Base validada do staging: `f8a16481d222182c595b93c843d01a34631e7995`.
Branch da correção: `fix/val-conversation-reliability-v1`.
Destino: `claude/continuacao-correcao-val-wiogh7`, serviço `val-web-staging`.
Produção/main permanecem fora desta alteração (`f405617405fb66811207fdf006c2fbdaebfb8c9d`).
Referência congelada `fix/val-context-integrity-grounding-v1` preservada (`5848574f24c4ddbe628b125856d54d9500f7fce9`).

## Problema e alterações

- A voz tinha `max_output_tokens:512` e retornava o motivo técnico da falha pedindo repetição. O limite passa a 4096, configurável por `VAL_REALTIME_VOICE_MAX_OUTPUT_TOKENS` entre 1024 e 4096. A extensão da fala continua curta por instrução. Cada novo turno passa por ferramenta governada, sem chamadas paralelas; a resposta final reutiliza seu resultado.
- Turnos incompletos não entram como respostas concluídas. Há uma recuperação automática antes de qualquer áudio e uma tentativa manual preservando a pergunta. Chamadas duplicadas e eventos de turnos anteriores são descartados. Pausa, interrupção e limite de uso permanecem respeitados.
- Troca de produtor só retoma uma resposta quando o novo servidor confirma o mesmo `response_id`, produtor, conversa e epoch. Texto de um escopo não é transportado para outro. Respostas já registradas pelo backend não duplicam a gravação do turno de voz.
- Perguntas naturais por nome, nomes parciais e qualificadores passam pela carteira autorizada. Município e propriedade precisam pertencer ao mesmo candidato. Homônimos exigem escolha; referência incompatível não reutiliza o produtor ativo.
- Pedir uma descrição do produtor responde com contexto autorizado; perguntas gerais continuam independentes de registros privados. Referências de continuidade a área/talhão preservam somente o objeto autorizado.
- Conhecimento geral admite explicações de produtos, princípios de manejo e conceitos de dose. Composição de marca conhecida vem do catálogo existente do Manual do Agrônomo, identificado como local e sem confirmação de atualidade. Indicação, dose recomendada, registro e dados atuais continuam exigindo evidência adequada.
- O fallback geral usa orçamento suficiente, uma recuperação limitada para saída incompleta e cancelamento. Texto parcial não vira resposta ou cache. Um aviso regulatório isolado não substitui a explicação de um conceito. Menções a CTC, pH ou margem não apagam o restante da pergunta.
- A interface de voz compacta a esfera, mantém controles acessíveis e distingue processamento, fala, recuperação e resposta interrompida. Pergunta, opções de identificação e limitações do backend acompanham o resultado falado.

## Validação

- `npm test`: **1779/1779 PASS**, zero falhas, zero testes ignorados.
- `npm run build`: PASS; build Vite e preparação/verificação PWA concluídos.
- `git diff --check`: PASS.
- Novos testes HTTP reproduziram sete falhas em oito cenários no código anterior; todos passaram após a correção.
- Revisão independente encontrou e corrigiu três casos adicionais: qualificador de propriedade descartado, formas comuns de consultar composição e conceitos de dose bloqueados por aviso genérico.
- Cobertura inclui troca de produtor, nomes ambíguos/incompatíveis, isolamento de tenant/owner, cancelamento, falha antes/depois de áudio, recuperação limitada, ausência de duplicação e paridade de calculadoras.

## Limites de verificação

Os testes de provedor usam respostas simuladas e não certificam todas as respostas futuras da IA. A consulta a registros reais no staging depende de login; este ambiente não recebeu credenciais. O navegador de validação abriu a página pública do staging, mas bloqueou a prévia local (`ERR_BLOCKED_BY_CLIENT`). Não houve UAT em iPhone físico nem medição real de latência de áudio. Essas verificações continuam necessárias; nenhuma taxa de acerto universal é declarada.

Nenhuma migração, alteração de credenciais, gravação de dados de produtores, ampliação de acesso ou mudança em produção integra este pacote.

Referência técnica: [OpenAI Realtime client secrets](https://developers.openai.com/api/reference/resources/realtime/subresources/client_secrets/methods/create), consultada em 09/09/2026, para limite de saída e política de ferramentas.
