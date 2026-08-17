# VAL — Biblioteca de objeções fundada em evidência

## Objetivo

Mostrar ao consultor quais objeções realmente apareceram em negócios parecidos da própria carteira e quais movimentos foram registrados antes de um fechamento posterior. A biblioteca não cria scripts, não presume causalidade e não substitui a descoberta do contexto atual.

## Fonte e escopo

A consulta usa `business_events` dos últimos 12 meses, restritos ao mesmo `tenant_id` e ao `consultant_id` autenticado. Entram somente eventos com `outcome` igual a `lost` ou `won`.

Uma perda só entra quando possui `loss_reason` estruturado. Notas livres não são promovidas a objeção. A semelhança considera, nesta ordem:

- mesma conta;
- mesmo produto;
- mesma categoria;
- termos técnicos em comum com a oportunidade atual;
- mesma etapa, quando registrada no payload.

Quando existe uma oportunidade em foco, eventos sem relação mínima são excluídos. Sem oportunidade em foco, a biblioteca pode mostrar o histórico geral da conta selecionada.

## Evidências

Cada ocorrência é apresentada com identificador no formato `business-loss:<id>`. Um movimento associado a fechamento usa também `business-win:<id>` e, quando houver, `recommendation:<id>`.

A biblioteca pode mostrar “o que funcionou” apenas em duas situações:

1. O evento `business.closed` possui campo comercial explícito, como `whatWorked`, `workedApproach`, `successfulApproach`, `responseThatWorked`, `resolution` ou `proofUsed`.
2. Existe uma recomendação da VAL marcada como usada ou executada entre a perda e um fechamento posterior semelhante.

Mesmo nesses casos, a interface informa que a sequência temporal não prova causalidade nem garante repetição do resultado.

## Contrato de saída

`conversionInnovations.objectionLibrary` contém:

- `version`;
- `generatedAt`;
- `lookbackDays`;
- `focus`;
- `objections`;
- `lossEventsConsidered`;
- `portfolioEventsConsidered`;
- `policy`;
- `emptyReason`;
- `guardrails`;
- `loadError`, quando a leitura da carteira completa falha.

Cada objeção contém tipo, quantidade de ocorrências, categorias, produtos, data mais recente, motivos de similaridade, `evidenceIds`, tamanho da amostra e um precedente observado opcional.

## Regra de segurança comercial

A biblioteca não usa família, hobbies, preferências pessoais, notas pessoais ou informações financeiras pessoais. Não transforma objeções em medo, culpa, vergonha, falsa urgência ou escassez. Sem evidência de resposta associada a avanço, a VAL se abstém de oferecer um script e orienta o consultor a confirmar a objeção atual.

## Falha segura

A leitura da carteira inteira usa cache de cinco minutos. Se a consulta falhar, o dossiê continua abrindo e a biblioteca trabalha apenas com o histórico já disponível da conta, mostrando a limitação na interface.
