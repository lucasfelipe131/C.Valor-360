# VAL Realtime — Cost Control v1

## Limite autorizado

- ambiente: staging isolado;
- modelo único: `gpt-realtime-2.1-mini`;
- teto: US$ 25, sem aumento automático;
- reserva conservadora: US$ 1 por sessão;
- duração máxima: 600 segundos;
- novas sessões são bloqueadas antes de ultrapassar a reserva disponível.

O modelo está hard-locked no backend e não pode ser substituído por variável de ambiente.

## Medição

Eventos sem conteúdo são gravados na tabela existente `usage_events`, sem migration:

- reserva da sessão;
- tokens de áudio/texto de entrada e saída;
- tokens em cache;
- uso da transcrição;
- custo estimado por resposta;
- finalização e motivo de desconexão.

Reservas abandonadas expiram após 15 minutos, impedindo bloqueio permanente do orçamento após crash. IDs de resposta são deduplicados.

## Preço codificado

Versão `openai.pricing.2026-08-29`, por 1 milhão de tokens: áudio input US$ 10; áudio input cached US$ 0,30; áudio output US$ 20; texto input US$ 0,60; texto input cached US$ 0,06; texto output US$ 2,40. A transcrição `gpt-transcribe` usa a referência de US$ 0,0045/minuto quando o provider relata duração.

Fonte: https://developers.openai.com/api/docs/pricing

## Estado atual

Consumo real nesta implementação local: **US$ 0,00**. Nenhuma chamada Realtime paga foi executada. O custo médio por minuto/sessão só poderá ser calculado após UAT controlado em staging.
