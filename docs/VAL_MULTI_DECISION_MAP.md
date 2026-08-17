# VAL — mapa de múltiplos decisores

## Objetivo

Permitir que o consultor registre mais de um papel de decisão por oportunidade estratégica e enxergue quem precisa estar alinhado antes da proposta final. O mapa não infere pessoas, influência, postura de risco ou critério de decisão.

## Registro visível

No Estúdio de Conversão, o botão **Registrar participante** abre um formulário ligado a uma oportunidade ativa. O papel é obrigatório; nome, critério, postura de risco e influência permanecem opcionais para não estimular preenchimento inventado.

O consultor precisa confirmar explicitamente que o papel veio de conversa ou registro real. O sistema salva a informação dentro de `opportunities.evidence` como:

```json
{
  "id": "decision-participant:<identificador>",
  "type": "decision_participant",
  "name": "",
  "role": "Responsável técnico",
  "perspective": "",
  "riskPosture": "",
  "influence": "",
  "confirmed": true,
  "source": "consultant_confirmed",
  "observedAt": "2026-08-17T12:00:00.000Z",
  "uncertainty": "..."
}
```

O contrato generativo `valAdviceSchema` não é alterado. O registro usa a API protegida existente `POST /api/opportunities`, preserva os demais campos e evidências da oportunidade e recarrega o dossiê após salvar.

## Leitura pelo motor

`buildMultiDecisionMap()` aceita participantes estruturados já existentes e também evidências `decision_participant`. Para evidência criada manualmente, `confirmed` precisa ser exatamente `true`; caso contrário, o participante não aparece no mapa.

Cada ator mostra:

- nome ou identificação, quando informado;
- papel;
- categoria do papel;
- critério ou perspectiva confirmada;
- postura de risco declarada;
- influência registrada;
- lacunas;
- `evidenceIds` rastreáveis.

## Segurança e ética comercial

O formulário orienta explicitamente a não registrar família, hobbies, dificuldades pessoais ou informação financeira pessoal como alavanca. A existência de uma pessoa no mapa não autoriza inferir poder, comportamento ou concordância. O mapa serve para alinhar critérios e responsabilidades, nunca para pressionar participantes.

## Limites

- exige uma oportunidade ativa;
- não envia contato;
- não altera etapa automaticamente;
- não transforma papel administrativo em aceite;
- não libera recomendação agronômica acionável;
- não usa IA generativa para criar participantes.
