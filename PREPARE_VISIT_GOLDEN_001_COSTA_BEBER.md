# PREPARE_VISIT_GOLDEN_001_COSTA_BEBER

## Entrada

- produtor: Antonio Carlos Costa Beber;
- objetivo: conversar sobre inseticida no milho e avançar a negociação;
- milho plantado e emergido;
- primeira aplicação próxima;
- precificação percebida como diferente;
- intenção do consultor: avançar sem começar por preço;
- histórico comercial e perfil analítico somente quando sustentados pela fixture.

O teste inclui memórias legadas com a chave ampla `voice.fact` para garantir compatibilidade retroativa.

## Saída golden aprovada

### Objetivo

> Entender se preço ou valor percebido está impedindo a decisão sobre inseticida no milho e construir valor antes de discutir condição comercial.

### Por que agora

> O milho já emergiu e a primeira aplicação está próxima, então a decisão tem janela operacional curta.

### Lembre

- Milho já plantado e emergido; primeira aplicação próxima.
- Preço ou condição comercial apareceu como possível ponto de fricção, mas ainda não está confirmado como objeção principal.

### Pergunte

1. Na primeira aplicação do milho, o que mais pesa na escolha do inseticida: segurança de controle, resultado que já conhece ou investimento por hectare?
2. Quando você compara nossa proposta com a alternativa que está avaliando, onde percebe hoje a principal diferença de valor?
3. Para avançar na decisão sobre inseticida agora, o que precisa ficar mais claro ou comprovado?

### Tese interna

> A hipótese é que preço não deve ser tratado primeiro: é preciso descobrir se a fricção vem de custo absoluto ou de valor ainda não demonstrado para a decisão sobre inseticida no milho.

### Evite

> Não comece defendendo preço. Primeiro descubra o que está sendo comparado e qual resultado justificaria a escolha.

### Saia com

> Sair sabendo qual critério define a escolha e com o próximo passo acordado antes da janela de aplicação.

## Evidência por camada após correção

| Camada | Resultado material |
|---|---|
| VoiceInteraction | `VISIT_INTENT`, `AGRONOMIC_STAGE`, `AGRONOMIC_TIMING` e `COMMERCIAL_SIGNAL` |
| MMI | Chaves semânticas para novos registros; legado continua legível |
| MCTX | Fatos complementares sem falso conflito |
| MIC | Analítico somente com confidence suficiente; desconhecido permanece neutro |
| MDI | Objetivo, tese e três questões de decisão |
| MVV | Perguntas naturais, prova existente e preço sem desconto automático |
| MEX | Compromisso contextual como prioridade |
| PrepareVisit | Síntese sem proveniência, timing, “Evite” e compromisso acionável |

## Safety

- “Inseticida” é o objeto da decisão informado pelo consultor, não recomendação de marca.
- Nenhum produto específico, dose, mistura, taxa ou manejo é inventado.
- A diferença de preço permanece hipótese comercial.
- Quality score da fixture analítica: `0,981`.

