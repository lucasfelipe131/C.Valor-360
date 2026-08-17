# VAL — Biblioteca de objeções fundada em evidência

## Objetivo

Mostrar ao consultor quais objeções realmente apareceram em negócios parecidos da própria carteira e quais movimentos foram registrados antes de um fechamento posterior. A biblioteca não cria scripts, não presume causalidade e não substitui a descoberta do contexto atual.

## Fonte e escopo

A consulta usa `business_events` dos últimos 12 meses, restritos ao mesmo `tenant_id` e ao `consultant_id` autenticado. Entram somente eventos com resultado `lost` ou `won`.

Uma perda só entra quando possui `loss_reason` estruturado. Notas livres não são promovidas a objeção. A semelhança considera:

- mesma conta;
- mesmo produto;
- mesma categoria;
- termos técnicos em comum com a oportunidade atual;
- mesma etapa, quando registrada no payload.

Quando existe uma oportunidade em foco, eventos sem relação mínima são excluídos. A interface mostra o foco utilizado e por que cada grupo foi considerado semelhante.

## Evidências

Cada ocorrência usa um identificador `business-loss:<id>`. Um movimento associado a fechamento usa também `business-win:<id>` e, quando aplicável, `recommendation:<id>`.

A biblioteca mostra “o que funcionou” somente quando:

1. o fechamento possui um campo comercial explícito, como `whatWorked`, `workedApproach`, `successfulApproach`, `responseThatWorked`, `resolution`, `proofUsed` ou `decisionReason`; ou
2. existe uma recomendação da mesma conta, marcada como utilizada ou executada, entre a perda e o fechamento posterior.

Uma recomendação do produtor atualmente aberto nunca é atribuída a uma perda de outro produtor. Mesmo com uma sequência auditável, a interface informa que ordem temporal não prova causalidade nem garante repetição do resultado.

## Contrato

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

## Segurança comercial

A biblioteca não usa família, hobbies, preferências pessoais, notas pessoais ou informações financeiras pessoais. Não transforma objeções em medo, culpa, vergonha, falsa urgência ou escassez. Sem evidência de resposta associada a avanço, a VAL se abstém de oferecer um script e orienta o consultor a confirmar a objeção atual.

## Falha segura

A leitura da carteira usa cache de cinco minutos, isolado por tenant e consultor. Se a consulta falhar, o dossiê continua abrindo com o histórico já disponível da conta e a limitação fica visível no Estúdio de Conversão.
