# Pós-visita v2

## Experiência principal

**Me conte como foi** usa o Voice Capture já versionado. O consultor fala naturalmente; a VAL transcreve, extrai candidatos e exige revisão.

```text
gravar/enviar
  -> validar
  -> transcrever
  -> extrair candidatos
  -> editar/remover/adicionar
  -> confirmar
  -> persistir
  -> Commitment / Outcome / LearningCandidate
  -> próxima preparação
```

## Candidatos

`FACT_CANDIDATE`, `OBJECTION`, `COMMITMENT_CANDIDATE`, `OPPORTUNITY_CANDIDATE`, `NEXT_STEP`, `BEHAVIORAL_SIGNAL`, `AGRONOMIC_OBSERVATION`, `EXPECTATION`, `HYPOTHESIS` e `MISSING_INFORMATION`.

Nenhum candidato é verdade antes da confirmação. Observação de campo não vira prescrição. Sinal comportamental usa comportamento/decisão observável, nunca voz, emoção, sotaque, gênero ou idade aparente.

## Resultado visível

Após a confirmação, a interface resume objeção, oportunidade, compromisso, próximo passo e efeito esperado na próxima visita. O formulário legado não compete com esta primeira ação; seu lifecycle permanece preservado para compatibilidade.

## Resiliência

Falha de transcrição ou IA mantém a interação pendente quando seguro, oferece retry e fallback para texto e não promove memória parcial.

## Teste central

A visita 2 deve reutilizar apenas informações confirmadas da visita 1: objeção, decisor, oportunidade, prova solicitada, compromisso, outcome e lacunas. LearningCandidate nunca vira KnowledgeItem automaticamente.
