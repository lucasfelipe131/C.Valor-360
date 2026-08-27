# Auditoria de qualidade — Prepare Visit

Data: 24/08/2026  
Escopo: staging da VAL  
Fixture: `PREPARE_VISIT_GOLDEN_001_COSTA_BEBER`  
Base auditada: árvore `95b3e4e8c67d48474f1adc5a3eb54b2ba9990aa1`

## Cenário reproduzido antes da correção

Transcrição de teste:

> Vou visitar o Antonio para falar sobre inseticida no milho. O milho já foi plantado e já emergiu. A primeira aplicação está próxima agora. A precificação está um pouco diferente. Quero entender como tirar o produtor da zona de conforto para avançar a negociação.

A reprodução utilizou o pipeline real e determinístico da branch implantada: extração do Voice Capture, registros MMI confirmados, `ContextSnapshot v1`, MIC, MDI, MVV, MEX e `PrepareVisit v1`.

## Rastreamento por camada

| Camada | Entrada | Saída observada | Informação perdida | Informação distorcida | Informação genérica | Causa provável confirmada |
|---|---|---|---|---|---|---|
| VoiceInteraction | Transcrição completa | Cinco `FACT_CANDIDATE` | Diferença entre intenção do consultor, estágio agronômico e sinal comercial | “Precificação diferente” virou fato sem incerteza epistêmica | Cláusula sem regra vira fato por padrão | Fallback determinístico não considera o tipo `PRE_VISIT` e possui fallback universal para `FACT_CANDIDATE` |
| Fatos confirmados | Cinco candidatos revisados | Cinco registros confirmados | Semântica do fato | Todas as afirmações recebem o mesmo tipo lógico | Chave `voice.fact` | `memorySpec` classifica por categoria ampla, sem chave semântica |
| MMI | Registros confirmados | Conteúdo e proveniência preservados | Nenhuma perda textual | Intenção do consultor é armazenada como fato do produtor | Chaves amplas | Epistemologia e identidade semântica insuficientes no adapter de voz |
| MCTX | Cinco registros `voice.fact` | Cinco fatos + um conflito material | Complementaridade entre fatos | Fatos distintos são tratados como versões divergentes do mesmo fato | `REQUIRES_CONFIRMATION` | Agrupamento de conflito usa `subject + domain + key`; chaves de evento genéricas não são adequadas como identidade de atributo |
| BehavioralProfile | Contexto sem evidência comportamental | Pesos neutros, confiança `0,10` | Nenhuma | MVV posteriormente trata o primeiro peso empatado como analítico | Lacunas numeradas do questionário | `profileStrategy` não respeita o threshold de confiança do MIC |
| DecisionThesis | Snapshot com falso conflito | `DISCOVER_BEFORE_RECOMMENDING` e “fonte mestre” | Milho, emergência, janela e inseticida | Lacuna comportamental vira maior incerteza comercial | “Antes de recomendar...” | Qualquer conflito força descoberta; `highestUnknown` cai no primeiro item genérico de `missing_information` |
| ValuePlan | Tese já degradada | Perguntas de questionário, “Está caro”, compromisso abstrato | Timing e decisão de inseticida | Possível fricção vira objeção confirmada | “Obter o dado crítico” | Ordem de prioridade começa por lacunas MCTX/MIC; preço é detectado por palavra; não existem questões de decisão intermediárias |
| ActionPlan | ValuePlan genérico | “Confirmar informação crítica” | Próximo passo comercial contextual | Lacuna de perfil recebe máxima prioridade | Critério/fonte/data | MEX deriva candidatos literalmente de `missing_information` e `commitment_target` |
| PrepareVisit | Todos os artefatos | Objetivo com dump de memória e perguntas internas | Síntese de decisão | Proveniência vira texto ao usuário | “Fato confirmado pelo consultor” | Adapter concatena `voiceContext` ao objetivo e à tese; não existe avaliação de especificidade |
| UI | `PrepareVisit v1` | Interface simples com conteúdo fraco | “Por que agora” agronômico e prova útil | “Atenção” mistura agendamento com objeção | Fallbacks visuais | A UI projeta corretamente o contrato recebido; a causa principal está antes dela, com um ajuste de apresentação necessário para as novas saídas |

## Saída anterior material

- Objetivo: concatenação do objetivo da agenda com quatro trechos precedidos por “Fato confirmado pelo consultor”.
- MCTX: falso conflito entre cinco memórias da mesma interação.
- DecisionThesis: “Antes de recomendar, precisamos descobrir O perfil comportamental não possui evidência observável recuperável.”
- Perguntas: itens 7 e 8 do questionário, em vez das incertezas da negociação.
- Compromisso: “Obter o dado crítico ou agendar sua coleta.”
- Timing agronômico: ausente.

## Causa raiz

Não é um problema exclusivamente de prompt nem de CSS. A perda ocorre em quatro transições:

1. **Voice Capture → MMI:** classificação e chave semântica insuficientes.
2. **MMI → MCTX:** chave de evento genérica participa indevidamente da detecção de conflitos.
3. **MCTX/MIC → MDI/MVV:** lacunas genéricas têm precedência sobre incertezas materiais da decisão; perfil de baixa confiança ainda influencia prova.
4. **MVV → PrepareVisit:** adapter concatena proveniência e não possui gate de qualidade/especificidade.

## Plano de correção por camada

1. Preservar todos os contratos v1 e aplicar mudanças aditivas.
2. Tornar o fallback do Voice Capture consciente do contexto `PRE_VISIT` e preservar incerteza comercial.
3. Impedir que chaves de evento (`voice.fact` e equivalentes) gerem falsos conflitos; manter conflitos reais de atributos.
4. Criar no MDI `decision_questions`: até três incertezas capazes de mudar tese, estratégia ou próximo passo.
5. Fazer o MVV priorizar essas questões e adaptar apresentação ao perfil apenas acima do threshold de confiança.
6. Gerar objetivo, timing, tese, “evite”, compromisso e provas a partir da semântica recuperada, sem copiar proveniência.
7. Adicionar avaliador interno de especificidade e detector de linguagem genérica/interna.
8. Exibir `POR QUE AGORA` e `PROVA QUE VALE LEVAR` sem aumentar a complexidade da primeira camada.
9. Cobrir Costa Beber, contraste soja/fungicida, produtor novo, histórico, perfis, safety, tenancy e Voice Capture.

## Restrições preservadas

- Nenhuma recomendação de produto, dose, mistura ou manejo é inferida.
- Hipótese comercial não vira fato.
- Perfil altera abordagem, nunca fatos.
- Proveniência permanece interna e rastreável.
- Memória só muda após confirmação humana.
- Nenhum contrato de Fases 02–06 é substituído.
- Sem produção, `main` ou Passo 07.
