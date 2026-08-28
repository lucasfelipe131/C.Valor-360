# VAL Voice Golden Set v1

Status da evidência automatizada em 28/08/2026: `PASS_AUTOMATED_CONTRACT` para `VOICE_CONVERSATION_GOLDEN_001` e `VOICE_CONVERSATION_GOLDEN_002`.

Status de UAT em dispositivo real: `NOT_EXECUTED_PHYSICAL_UAT`.

## Escopo da evidência

Este Golden Set verifica, de forma determinística e sem rede, contratos que sustentam continuidade conversacional: `ConversationState v1`, comandos naturais, FSM de voz, roteamento de capabilities, retenção de contexto e naturalidade heurística. O runner usa fixtures fixas e importa módulos de produção, mas não é uma execução E2E da conversa: o cliente/visita de G001 já vêm semeados; perguntas, tese e respostas avaliadas são controladas; G002 usa attachment sem bytes com resumo técnico pré-preenchido e uma síntese controlada.

Esta evidência não substitui UAT físico/humano nem comprova resolução real de nome, Decision Interview E2E, câmera/upload, análise visual ou resposta real do modelo. Ela também não prova qualidade acústica, reconhecimento de fala real, voz TTS instalada, latência de provedor/modelo, permissões do sistema, naturalidade percebida por uma pessoa ou comportamento em iPhone/Android físicos.

## VOICE_CONVERSATION_GOLDEN_001

| Passo | Entrada/Evento | Contrato exercitado | Critério automatizado | Evidência |
|---|---|---|---|---|
| 1 | “VAL, amanhã vou no Antônio.” | `ConversationState v1` com cliente/visita semeados | Antônio permanece como produtor atual na fixture; não testa o resolver de nomes | `G001.CONTEXT.CLIENT` |
| 2 | “Não é mais inseticida. Agora é nutrição.” | `advanceConversationState` | Assunto atual substituído por nutrição | `G001.CONTEXT.TOPIC_UPDATE` |
| 3 | “Ele comentou preço de novo.” | avanço do estado efêmero semeado | O sinal de preço da resposta controlada é preservado sem apagar nutrição; não testa resolução pronominal E2E | `G001.CONTEXT.PRICE_SIGNAL` |
| 4 | “Que informação tá faltando?” | fixture de pergunta material | Uma única pergunta controlada é registrada; não executa `buildDecisionInterview` | `G001.INTERVIEW.MINIMUM_ONLY` |
| 5 | Usuário informa a faixa inicial | fixture de tese conversacional | A tese controlada atualiza o estado sem persistência confirmada | `G001.THESIS.UPDATED`, `G001.MEMORY.NONE` |
| 6 | “Agora me manda só as três perguntas de ouro.” | comando natural local | A frase exata é reconhecida e retorna exatamente três perguntas em texto | `G001.GOLDEN.EXACT_COMMAND`, `G001.GOLDEN.THREE_TEXT` |
| 7 | “Agora fala elas pra mim.” | comando de saída + FSM de voz | As mesmas perguntas são selecionadas para áudio e a FSM percorre processamento, fala e rearm | `G001.GOLDEN.SAME_AUDIO`, `G001.VOICE.STATE_MACHINE` |
| 8 | “Registra que o filho vai participar.” | registro fail-closed | Abre revisão e exige confirmação; nenhuma memória é gravada pelo comando | `G001.REGISTER.CONFIRMATION` |
| 9 | Resposta contextual controlada | `CONVERSATIONAL_NATURALNESS` | A fixture textual autorada recebe avaliação heurística igual ou superior a `NATURAL`; não é avaliação humana nem saída real do modelo | `G001.NATURALNESS.AUTOMATED` |

Resultado automatizado: `PASS_AUTOMATED_CONTRACT`.

## VOICE_CONVERSATION_GOLDEN_002

| Passo | Entrada/Evento | Contrato exercitado | Critério automatizado | Evidência |
|---|---|---|---|---|
| 1 | Conversa sobre o Talhão Norte | `ConversationState v1` | Produtor e talhão permanecem no mesmo escopo autorizado | `G002.CONTEXT.SCOPE` |
| 2 | Attachment sintético pré-analisado, sem bytes | capability router/executor | Rota `TOOL`, capability `IMAGE_DIAGNOSIS` e consumo do resumo controlado; não testa câmera, upload ou visão | `G002.PHOTO.ROUTE`, `G002.PHOTO.EXECUTION` |
| 3 | Triagem técnica controlada | safety agronômico | A fixture exige revisão humana e não se apresenta como diagnóstico | `G002.PHOTO.SAFETY` |
| 4 | Retenção multimodal | contexto efêmero | Resultado técnico da imagem e sinal comercial de preço coexistem na mesma sessão | `G002.STATE.TECHNICAL_RESULT`, `G002.STATE.COMMERCIAL_CONTEXT` |
| 5 | “E isso muda a conversa com o produtor?” | referência curta + contexto | Follow-up resolve o mesmo produtor/talhão e solicita raciocínio contextual com histórico comercial | `G002.REFERENCE.CONTINUITY`, `G002.FOLLOW_UP.ROUTE` |
| 6 | Síntese controlada | tese conversacional | A fixture cruza observação técnica e contexto comercial sem promover memória; não é saída E2E do AI Reasoning/modelo | `G002.CROSS.RESULT`, `G002.MEMORY.NONE` |
| 7 | Resposta contextual controlada | `CONVERSATIONAL_NATURALNESS` | A fixture textual autorada recebe avaliação heurística igual ou superior a `NATURAL`; não é avaliação humana | `G002.NATURALNESS.AUTOMATED` |

Resultado automatizado: `PASS_AUTOMATED_CONTRACT`.

## Como reproduzir

```bash
node --test test/val-voice-golden-v1.test.js
node scripts/val-voice-golden.mjs
```

O primeiro comando valida os dois cenários e a separação formal de evidências. O segundo imprime um relatório JSON auditável, encerra com código diferente de zero diante de qualquer check reprovado e não grava conversa, áudio, imagem ou memória.

## O que ainda exige UAT real

| Evidência | Situação |
|---|---|
| Microfone real, permissão, fim de turno e transcrição pt-BR | `NOT_EXECUTED_PHYSICAL_UAT` |
| TTS audível, qualidade da voz, pausa, interrupção e rearm no dispositivo | `NOT_EXECUTED_PHYSICAL_UAT` |
| Câmera real, seleção/upload da foto e percepção de performance | `NOT_EXECUTED_PHYSICAL_UAT` |
| Conversa livre com resposta real do modelo e avaliação humana “parece uma pessoa?” | `NOT_EXECUTED_HUMAN_UAT` |
| iPhone/iOS/Safari/PWA e Android/Chrome/PWA físicos | `NOT_EXECUTED_PHYSICAL_UAT` |

Os cenários só podem ser classificados como UAT final `PASS` depois dessas execuções reais. O resultado automatizado, isoladamente, não aprova o gate de dispositivo, voz, câmera ou naturalidade humana.
