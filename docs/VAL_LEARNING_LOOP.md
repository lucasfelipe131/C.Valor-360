# Loop de aprendizado da VAL

Este documento define como feedback e resultado operacional devem alimentar um ranker **offline**, auditável e reversível. Ele não autoriza autoalteração de prompt, retreinamento silencioso nem mudança direta do comportamento em produção.

> O modelo propõe. O banco registra. O resultado rotula. O ranker aprende offline. Pessoas aprovam a promoção.

## 1. Evento de entrada

O ponto de entrada atual é:

```text
POST /api/val/feedback
```

Payload aceito hoje:

```json
{
  "recommendationId": "uuid-da-recomendacao",
  "rating": 5,
  "outcome": "accepted",
  "value": null,
  "reason": null,
  "notes": "Usei a abordagem e combinei o próximo passo."
}
```

Os outcomes aceitos e normalizados pelo servidor são:

```text
accepted
edited
rejected
scheduled
executed
won
lost
```

Aliases de interface, como `used`, `adapted` e `discarded`, são normalizados antes da persistência.

A persistência do feedback deve produzir, para consumo offline, um evento lógico chamado:

```text
val.feedback.recorded
```

Esse nome descreve o contrato futuro do pipeline; não implica a existência de uma fila externa nesta versão.

### Envelope recomendado

```json
{
  "event": "val.feedback.recorded",
  "occurredAt": "2026-08-17T12:00:00.000Z",
  "tenantId": "tenant",
  "ownerId": "consultor",
  "recommendationId": "uuid",
  "clientId": "produtor",
  "feedback": {
    "rating": 5,
    "outcome": "accepted",
    "value": null,
    "reason": null
  },
  "recommendationSnapshot": {
    "createdAt": "2026-08-17T11:00:00.000Z",
    "selectedOpportunityId": "oportunidade",
    "priorityScore": 78,
    "priorityBand": "esta_semana",
    "methodologyStage": "dimensionar",
    "suggestedLineId": "hash-estavel",
    "nextActionCode": "quantificar_impacto",
    "tier": "daily",
    "model": "modelo-ou-rules",
    "dataQuality": 82,
    "confidenceLevel": "moderate",
    "evidenceIds": ["e1", "e2"]
  }
}
```

O snapshot precisa refletir somente informações conhecidas **no momento da recomendação**. Campos atualizados depois não podem voltar no tempo e contaminar as features do treino.

## 2. Ligação com resultados posteriores

Feedback imediato não prova conversão. O pipeline offline deve vincular a recomendação aos eventos posteriores já previstos no sistema:

```text
business.updated
business.closed
business.lost
visita realizada
próxima recomendação do mesmo produtor
mudança confirmada de methodology_state
```

A junção deve usar IDs persistidos e ordem temporal. Similaridade de texto, nome do produtor ou aproximação manual não são chaves suficientes.

### Hierarquia dos rótulos

| Camada | Rótulos | O que mede |
|---|---|---|
| Reação | `accepted`, `edited`, `rejected` | Utilidade percebida pelo consultor. |
| Execução | `scheduled`, `executed` | Se a recomendação virou ação ou compromisso. |
| Progresso | avanço real de `methodology_state` | Se a conversa passou por uma porta objetiva. |
| Resultado | `won`, `lost`, `business.closed`, `business.lost` | Desfecho comercial observado. |

Um `accepted` não deve ser convertido em `won`. Um `scheduled` não prova execução. Uma recomendação sem feedback permanece **sem rótulo**, não rejeitada.

## 3. Dataset elegível para o ranker

Uma linha de avaliação é elegível quando contém:

- recomendação persistida e efetivamente exibida;
- snapshot de contexto e versão do motor;
- oportunidade selecionada e candidatas consideradas;
- `evidence_used` rastreável;
- feedback ou resultado posterior com data;
- tenant e proprietário consistentes;
- nenhuma divergência de idempotência.

Devem ser excluídos ou marcados separadamente:

- modo demonstrativo sem identidade persistida;
- resposta cancelada antes de ser exibida;
- recomendação retida por revisão técnica e nunca liberada;
- feedback de teste automatizado;
- resultado importado sem vínculo verificável com a recomendação;
- registro com unidade, valor ou estágio contraditórios;
- duplicata do mesmo evento.

## 4. Features permitidas

O ranker pode usar, desde que conhecidas no momento da recomendação:

- componentes do score determinístico;
- etapa e idade da oportunidade;
- prazo da próxima ação;
- qualidade, frescor e cobertura das evidências;
- estágio metodológico;
- canal e tipo de ação registrada;
- tier e rota escolhidos;
- quantidade de lacunas e contradições;
- histórico agregado de aceite, edição e execução da mesma categoria;
- sinais técnicos somente como presença, validade e status de revisão, nunca como diagnóstico inferido.

Não usar como alavanca ou feature de persuasão:

- informação familiar;
- vulnerabilidade financeira pessoal;
- religião, saúde, política ou atributo sensível;
- medo, vergonha, culpa ou pressão percebida;
- hobbies, time ou preferências pessoais sem finalidade operacional legítima;
- texto livre que revele segredo ou dado pessoal além do necessário.

## 5. Primeira versão do ranker offline

A primeira versão deve ser um ranker de comparação, não um agente autônomo.

Entrada:

```text
uma conta + oportunidades candidatas + features conhecidas naquele momento
```

Saída:

```text
ordem das candidatas + score do ranker + explicação das principais features
```

O ranker não pode:

- criar oportunidade;
- alterar preço, crédito ou condição;
- liberar revisão técnica;
- escrever no CRM;
- substituir o Conversion Score em produção sem aprovação;
- transformar score em probabilidade de compra sem calibração específica.

### Ciclo de promoção

```text
extração versionada
→ validação de qualidade
→ treino temporal offline
→ avaliação em holdout futuro
→ shadow mode
→ comparação com a regra atual
→ revisão humana
→ promoção versionada
→ monitoramento e rollback
```

A versão candidata deve rodar primeiro em **shadow mode**: produz ranking para comparação, mas a interface continua usando a regra vigente.

## 6. Métricas visíveis ao time

Toda métrica precisa mostrar numerador, denominador, período, versão do motor e tamanho da amostra.

### Cobertura do aprendizado

- recomendações exibidas;
- recomendações com algum feedback;
- recomendações com outcome operacional;
- recomendações vinculadas a `won` ou `lost`;
- percentual sem rótulo;
- tempo mediano entre recomendação e primeiro feedback;
- tempo mediano entre recomendação e resultado.

### Aceite, edição e rejeição

```text
taxa de aceite = accepted / feedbacks válidos
taxa de edição = edited / feedbacks válidos
taxa de rejeição = rejected / feedbacks válidos
```

Também exibir por:

- tier;
- estágio metodológico;
- tipo de próxima ação;
- faixa de qualidade dos dados;
- faixa de confiança;
- versão do prompt e do motor.

### Execução e avanço

- `scheduled / recomendações com feedback`;
- `executed / recomendações com feedback`;
- percentual que avançou pelo menos uma porta metodológica;
- percentual que regrediu ou ficou parado;
- tempo até o próximo compromisso;
- diferença entre linha sugerida, linha editada e ação registrada.

### Acerto de prioridade

O acerto de prioridade deve medir se a oportunidade colocada no topo apresentou avanço real em comparação às candidatas que estavam disponíveis no mesmo instante.

Métricas recomendadas:

- **Top-1 progress rate:** primeira oportunidade que avançou entre as candidatas;
- **Precision@K:** proporção das K primeiras que avançaram;
- **NDCG@K:** qualidade da ordenação quando houver mais de um desfecho;
- **regret de ranking:** diferença entre o valor observado da oportunidade escolhida e a melhor candidata conhecida depois;
- taxa de oportunidade prioritária encerrada como inválida ou desatualizada.

A janela de observação, o valor de K, o conceito de “avanço” e a atribuição de resultado são **decisões de produto pendentes**. Não fixar valores no código ou na documentação sem aprovação.

### Calibração

O Conversion Score atual ordena trabalho; ele não é probabilidade. Portanto:

- não exibir Brier Score, probabilidade prevista ou “chance de fechamento” para o score atual;
- comparar faixas do score com frequência observada de avanço, deixando explícito que é análise descritiva;
- somente calcular calibração probabilística depois de existir um modelo treinado para probabilidade e um contrato próprio;
- monitorar estabilidade por período, categoria, unidade e qualidade dos dados.

## 7. Painel interno mínimo

O painel do time deve mostrar:

1. cobertura e tamanho da amostra;
2. aceite, edição e rejeição;
3. execução e avanço metodológico;
4. acerto de prioridade por versão;
5. motivos padronizados de rejeição e perda;
6. divergências de segurança e revisões técnicas pendentes;
7. comparação entre regra vigente e ranker em shadow mode;
8. alertas de queda de qualidade, mudança de distribuição e amostra insuficiente.

Nenhum gráfico deve ocultar denominador pequeno. Quando a amostra não sustentar uma leitura, mostrar **amostra insuficiente**, sem extrapolar.

## 8. Divisão de treino e prevenção de vazamento

- dividir por tempo: treino no passado, avaliação no futuro;
- manter eventos do mesmo produtor e da mesma oportunidade no mesmo lado do corte quando necessário;
- não usar desfecho futuro como feature;
- não misturar duplicatas ou reimportações entre treino e teste;
- medir separadamente versões diferentes do motor;
- preservar tenant e controle de acesso durante extração;
- exportar somente identificadores pseudonimizados quando o nome não for necessário.

## 9. Retenção, thresholds e aprovação

Esta documentação não define:

- período de retenção do dataset;
- amostra mínima para promover um ranker;
- janela de atribuição de conversão;
- valor de K;
- threshold de ganho necessário;
- quais times podem visualizar notas livres.

Esses pontos exigem decisão conjunta de Produto, Comercial, Segurança, Jurídico/LGPD e responsável técnico. Até lá:

- feedback permanece no banco operacional conforme a política vigente;
- nenhuma promoção automática é permitida;
- notas livres não entram no treino por padrão;
- o ranker futuro permanece offline e em shadow mode;
- a regra atual continua sendo a autoridade de produção.

## 10. Critérios para uma versão candidata

Uma versão candidata só pode ser apresentada para aprovação quando:

- o dataset passou por validação de IDs, datas, unidades e duplicatas;
- as métricas mostram denominadores;
- a comparação temporal foi executada;
- os grupos com pouca amostra estão marcados;
- segurança e revisão técnica não regrediram;
- não houve uso de atributo pessoal indevido;
- existe explicação das principais features;
- existe plano de rollback;
- o resultado em shadow mode foi revisado por pessoas responsáveis.
