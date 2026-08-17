# VAL — ciclo de expansão pós-conversão

## Objetivo

Transformar um fechamento comprovado no início de uma nova descoberta comercial, sem criar oportunidade, contato ou ordem automaticamente.

## Gatilho

O ciclo só é acionado quando o dossiê contém um evento recente `business.closed`, `won` ou equivalente ganho, com data válida nos últimos 12 meses. Atualização de cadastro, proposta, intenção ou oportunidade em andamento não aciona o ciclo.

## Domínio de insumos

Quando o negócio fechado identifica um produto existente no catálogo oficial, a VAL reutiliza a Ponte de Valor para localizar candidatas de comparação. Essas candidatas são pontos de descoberta, não recomendação agronômica.

A interface sempre informa que similaridade cadastral não prova equivalência, adequação, desempenho ou superioridade. Cultura, alvo, modalidade, formulação, restrições, bula vigente, dose e execução continuam sujeitos à fonte vigente e à revisão técnica humana.

## Domínio de grãos

O motor consulta o workspace SOG apenas depois do fechamento. O cache é isolado por tenant e consultor por cinco minutos.

A ordem de preferência é:

1. intenção ativa já registrada para a mesma conta, cruzada com referências de mercado pelo motor determinístico de grãos;
2. perfil SOG confirmado, quando ainda não existe intenção ativa — nesse caso a VAL sugere somente uma pergunta de descoberta.

Perfil de cultura não equivale a intenção de compra ou venda. Volume, preço, janela, praça e origem precisam ser confirmados antes de criar ou priorizar uma negociação.

## Contrato

`conversionInnovations.postConversionExpansion` contém:

- `version`;
- `generatedAt`;
- `status`;
- `trigger` com `evidenceIds` do fechamento;
- até quatro `candidates` de insumos e grãos;
- `nextAction`;
- `policy`;
- `emptyReason`;
- `guardrail`.

Cada candidata apresenta domínio, motivo, próxima descoberta, pergunta, evidências e limites.

## Segurança comercial

- nenhuma oportunidade é criada automaticamente;
- nenhum contato é enviado;
- nenhuma ordem de grãos é criada;
- nenhuma candidata de produto vira prescrição;
- não há promessa de resultado, equivalência ou retorno;
- não há urgência sem janela ou cotação real;
- nenhuma informação pessoal, familiar ou financeira pessoal é usada como alavanca.
