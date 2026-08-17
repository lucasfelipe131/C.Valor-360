# VAL — placar de calibração de mensagens

## Objetivo

Medir, de forma descritiva e auditável, quais frases e abordagens registradas pela VAL coincidiram com avanço real da sequência metodológica na interação seguinte.

A primeira versão não é machine learning e não altera o motor. Ela funciona em `shadow mode`.

## Fonte dos dados

O placar considera somente campos estruturados das recomendações dos últimos 12 meses:

- `methodology_state`;
- `next_question`;
- `conversation_plan.steps[].suggested_line`;
- `approach_plan`;
- `next_best_action`;
- feedback estruturado (`accepted`, `edited`, `rejected`, `scheduled`, `executed`, `won`, `lost`);
- etapa metodológica registrada na recomendação seguinte.

Notas livres do feedback ficam fora do placar e não viram feature.

## Definição de avanço

Existe avanço observado quando a recomendação seguinte registra uma etapa posterior na sequência canônica:

`preparar → alinhar → descobrir → dimensionar → construir_valor → propor → comprometer`

A ausência de uma interação seguinte permanece pendente. Não é rejeição nem fracasso.

## Amostra mínima

Cada etapa metodológica precisa de pelo menos 30 observações antes de receber o estado `benchmark_ready`. Até lá, a interface mostra “amostra em formação”.

Mesmo quando a amostra é suficiente, a taxa representa coincidência temporal, não causalidade.

## Contrato

`conversionInnovations.messageCalibration` contém:

- `version`;
- `generatedAt`;
- `mode=shadow`;
- `lookbackDays=365`;
- `minSample=30`;
- `sampleStatus`;
- `summary`;
- `segments`;
- `messages`;
- `policy`;
- `interpretation`;
- `guardrail`.

Cada mensagem agrega usos, interações seguintes, avanços, aceite, edição, rejeição, execução, ganho, perda e `evidenceIds`.

## Limites

O placar não pode:

- alterar prompt, modelo, score, rota ou próxima ação automaticamente;
- promover uma frase para produção sem avaliação offline e aprovação humana;
- usar nota livre, atributo pessoal, familiar ou financeiro como feature;
- tratar avanço posterior como prova de que a frase causou o resultado;
- enfraquecer a revisão técnica ou as regras contra pressão e urgência artificiais.
