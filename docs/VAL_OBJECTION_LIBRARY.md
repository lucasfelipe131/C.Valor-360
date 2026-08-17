# VAL — Biblioteca de objeções fundada em evidência

## Objetivo

Mostrar ao consultor quais objeções realmente apareceram em negócios parecidos da própria carteira e quais movimentos foram registrados antes de um fechamento posterior. A biblioteca não cria scripts, não presume causalidade e não substitui a descoberta do contexto atual.

## Fonte e escopo

A consulta usa `business_events` dos últimos 12 meses, restritos ao mesmo `tenant_id` e ao `consultant_id` autenticado. Entram somente eventos com `outcome` igual a `lost` ou `won`.

Uma perda só entra quando possui `loss_reason` estruturado. Notas livres não são promovidas a objeção. A semelhança considera mesma conta, produto, categoria, termos técnicos em comum e etapa registrada. Quando existe oportunidade em foco, eventos sem relação mínima são excluídos.

## Evidências

Cada ocorrência usa `business-loss:<id>`. Um movimento associado a fechamento usa também `business-win:<id>` e, quando houver, `recommendation:<id>`.

A biblioteca mostra “o que funcionou” apenas quando o evento `business.closed` traz um campo comercial explícito, como `whatWorked`, ou quando existe uma recomendação da VAL marcada como usada ou executada entre a perda e um fechamento posterior semelhante. A interface sempre informa que sequência temporal não prova causalidade.

## Contrato

`conversionInnovations.objectionLibrary` contém versão, data, foco, objeções, perdas semelhantes consideradas, total de eventos analisados, política, estado vazio, guardrails e eventual `loadError`.

## Segurança comercial

A biblioteca não usa família, hobbies, preferências pessoais, notas pessoais ou informações financeiras pessoais. Não transforma objeções em medo, culpa, vergonha, falsa urgência ou escassez. Sem evidência de resposta associada a avanço, a VAL se abstém de oferecer script e orienta a confirmação da objeção atual.

## Falha segura

A consulta da carteira usa cache de cinco minutos. Se ela falhar, o dossiê continua abrindo com o histórico disponível da conta e a limitação fica visível.
