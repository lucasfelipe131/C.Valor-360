# InsightCard v1

Versão estável: `val.insight_card.v1`.

Categorias:

- `ACT_NOW` — compromisso vencido ou sinal material imediato;
- `PREPARE` — visita próxima ou preparação necessária;
- `FOLLOW_UP` — compromisso ativo ou decisão a acompanhar;
- `LEARN` — resultado disponível para revisão organizacional.

Todo card ativo explica `why_now`, sugere `recommended_action`, possui expiração, confiança, estado epistemológico e evidências. Cards de baixa confiança são `HYPOTHESIS`; cards expirados, resolvidos, não autorizados ou incompatíveis com o papel são descartados.

O feed principal contém no máximo cinco cards. A prioridade `val.insight_priority.experimental.v1` não é KPI nem probabilidade de venda. O VIS deriva cards das fontes atuais e não mantém tabela paralela nesta fase.
