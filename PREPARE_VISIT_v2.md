# Prepare Visit v2

## Primeira camada fixa

```text
PREPARAR VISITA
PRODUTOR
OBJETIVO
POR QUE AGORA
LEMBRE
PERGUNTE (máximo 3)
ESTRATÉGIA
EVITE
SAIA COM
```

O conteúdo deve caber em uma leitura de 10–20 segundos. Objetivo é tese operacional, nunca dump de memória, transcrição ou provenance.

## Pipeline

1. Recuperar memória, histórico, compromissos, oportunidades, voz confirmada e contexto agronômico.
2. Separar fato, hipótese, sinal comercial, conhecimento externo e lacuna.
3. Selecionar no máximo três KnowledgeItems aplicáveis.
4. MIC adapta forma e prova apenas com sinais observáveis e confiança suficiente.
5. MDI produz de uma a três `decision_questions` internas.
6. MVV transforma essas incertezas em Perguntas de Ouro naturais.
7. MEX produz até três ações e um compromisso contextual.
8. O adapter mostra síntese; detalhes ficam em “Ver análise” e “Ver números e evidências”.

## Knowledge

Knowledge pode orientar pergunta, prova, estratégia ou guardrail. Não pode:

- confirmar cultura, área, estágio, objeção, decisor ou resultado;
- ocultar informação faltante;
- elevar sozinho confiança do contexto;
- gerar prescrição técnica;
- aparecer como dump.

O artefato mantém apenas IDs/referências compactas dos itens realmente usados.

## Atalhos operacionais

- **Falar com a VAL** usa `PRE_VISIT`, exige revisão/confirmação e reapresenta a preparação recalculada.
- **Estou saindo agora** mostra objetivo, lembre, até três perguntas, evite e compromisso em uma tela curta.
- **Resumo em 60 segundos** mostra situação, oportunidade, risco, perguntas e compromisso.

Esses atalhos são projeções do mesmo `PrepareVisit`; não criam tese, fatos ou recomendação paralelos.

## Qualidade

As nove dimensões internas são: `CONTEXT_SPECIFICITY`, `DECISION_RELEVANCE`, `QUESTION_QUALITY`, `HISTORY_USAGE`, `BEHAVIOR_ADAPTATION`, `AGRONOMIC_TIMING_USAGE`, `KNOWLEDGE_USAGE`, `ACTIONABILITY` e `NON_GENERIC_LANGUAGE`.

`KNOWLEDGE_USAGE` é aprovado quando um item material foi selecionado e efetivamente influenciou uma saída com provenance. `NO_APPLICABLE_KNOWLEDGE` é neutro. Item irrelevante usado ou item material ignorado falha.

## Profundidade

- SIMPLE: síntese e três prioridades.
- BALANCED: síntese + evidências principais.
- ANALYTICAL: números, histórico, premissas, cenários e fontes.

A DecisionThesis é a mesma nos três modos. A preferência do consultor altera apresentação; o BehavioralProfile do produtor altera abordagem, nunca fatos.

## Safety

Timing agronômico altera a conversa, não autoriza prescrição. Produto, dose, mistura, compatibilidade, eficácia e recomendação acionável continuam sujeitos à evidência apropriada e revisão humana/MIA.
