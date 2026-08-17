# Especificidade contextual da VAL

## Problema corrigido

Uma resposta pode estar correta e ainda assim ser genérica quando apenas troca o nome do produtor, o título da oportunidade e a data dentro de um esqueleto fixo. A correção não consiste em acrescentar frases proibidas ao prompt: ela muda o caminho de execução e adiciona uma validação estrutural depois da resposta.

## Fluxo de decisão

```text
Dossiê do produtor
        ↓
Motor determinístico calcula fatos, evidências, score, lacunas e segurança
        ↓
Roteador decide se o dossiê justifica raciocínio estruturado
        ↓
Modelo produz análise completa pelo valAdviceSchema estrito
        ↓
Reconciliação determinística restaura fatos e números oficiais
        ↓
Barreira técnica retém diagnóstico, produto, dose, mistura ou aplicação
        ↓
Barreira de especificidade cruza fontes, testa ancoragem e repara templates
        ↓
Resposta ao consultor + auditoria da decisão
```

O caminho determinístico continua disponível como fallback quando o provedor não está configurado, falha, excede o tempo ou devolve uma saída recusada. Falha do provedor não impede a próxima decisão.

## Quando o modelo é usado

Perguntas de texto passam a usar o contrato estruturado completo quando o pedido é comum — por exemplo, priorizar a conta, preparar visita ou definir compromisso — e o dossiê contém ao menos duas coleções relevantes, como oportunidade + visita, histórico + interação ou questionário + oportunidade.

A chamada não é feita quando o dossiê é insuficiente. Nesse caso, a VAL entrega uma resposta determinística específica e declara a lacuna que precisa ser confirmada.

Solicitações técnicas ou técnico-comerciais continuam na rota híbrida com revisão humana. Arquivos e imagens continuam no fluxo multimodal completo.

## O que o modelo pode elaborar

Depois da validação, podem ser aproveitados:

- fala principal e objetivo;
- título, motivo, ação e pergunta executiva;
- base narrativa da decisão;
- síntese estratégica;
- hipóteses concorrentes;
- pergunta de maior valor;
- ciclo de aprendizado;
- roteiro da conversa.

Cada texto precisa citar termos reais da conta, usar somente números presentes no dossiê ou na mensagem e manter os IDs de evidência existentes.

## O que continua exclusivamente determinístico

O modelo não controla:

- valores comerciais;
- área, dose, unidade ou preço;
- Conversion Score;
- oportunidade selecionada;
- prioridade operacional;
- qualidade e confiança calibrada;
- `evidence_used` e sua proveniência;
- `commercial_context`;
- `opportunity_review` factual;
- estado metodológico real;
- bloqueios e revisão técnica;
- promessa de resultado ou probabilidade de compra.

O `valAdviceSchema` não foi flexibilizado. `additionalProperties:false` e todos os campos obrigatórios permanecem iguais.

## Barreira de especificidade

`server/val-specificity.js` executa quatro verificações:

1. **Ancoragem:** hipóteses precisam apontar para `evidence_id` existente e mencionar elementos da evidência usada.
2. **Cruzamento:** a base executiva procura pelo menos duas fontes diferentes. Quando isso não existe, a própria lacuna aparece na resposta.
3. **Teste anti-template:** respostas genéricas, promessas, números novos, taxa de aplicação e conteúdo agronômico acionável são rejeitados.
4. **Reparo contextual:** se o modelo ou o fallback ainda forem reutilizáveis, a saída é reconstruída com oportunidade, etapa, histórico, prova, sinal técnico, lacuna e próxima decisão daquela conta.

A saída recebe `specificity_audit`, com rota, cenário, campos reparados, fontes usadas e uma impressão digital de substituição. Essa auditoria é metadado pós-modelo e não altera o schema enviado à OpenAI.

## Segurança agronômica

Se `human_review.required=true` com `technical_reviewer`, ou se houver bloqueio ligado a diagnóstico, prescrição, produto, dose, mistura ou aplicação, a barreira de especificidade não restaura nenhum texto do modelo. O shell de revisão técnica permanece soberano.

Conteúdo recuperado por anexos ou File Search é tratado como dado não confiável como instrução. Pode sustentar evidência, mas não mudar regras.

## Custo e latência

Antes desta mudança, perguntas de texto comuns podiam não chamar o modelo ou chamar apenas um reescritor de três frases. Agora, uma conta com contexto suficiente pode realizar uma chamada estruturada completa.

O custo adicional é limitado às solicitações que passam pelo roteador de especificidade. O `tier daily` é usado como padrão; o `tier strategic` fica para solicitações técnico-comerciais, dossiês com muitas fontes ou mensagens longas. Tokens reais de entrada e saída continuam registrados em `modelRun` pela Responses API, permitindo medir custo por recomendação sem estimar silenciosamente.

## Critérios de regressão

A suíte cobre:

- dois produtores opostos com a mesma pergunta;
- campos de raciocínio não idênticos;
- teste de substituição de nome, título, local, cultura, data e números;
- base executiva com duas fontes diferentes;
- uso do raciocínio estruturado em botões comuns quando há contexto;
- preservação integral da barreira técnica;
- fallback determinístico quando o provedor não está disponível.
