# VAL Turn Detection Tuning v1

## Evidência anterior

No staging físico anterior foram relatados corte de áudio, detecção agressiva e fallback para push-to-talk. O baseline usava `semantic_vad` com `eagerness: auto`.

## Alteração controlada

| Parâmetro | Antes | Depois |
|---|---|---|
| provider turn detection | `semantic_vad` | `semantic_vad` |
| eagerness | `auto` | `low` por padrão |
| create response | `true` | `true` |
| interrupt response | `true` | `true` |
| noise reduction | `near_field` | `near_field` |
| browser constraints | echo/noise/auto gain | mantidos |
| ordem de inicialização | sessão paga antes do microfone | microfone antes de reserva/credencial |

`VAL_REALTIME_VOICE_VAD_EAGERNESS` aceita `low`, `medium`, `high` ou `auto`, sem novo secret e sem mudar o modelo autorizado.

## Por que `low`

O problema observado é corte em pausas e fala hesitante. No contrato real usado pelo provider, semantic VAD expõe `eagerness`; não foram inventados `silence_duration_ms`, threshold ou prefix padding incompatíveis com essa API. `low` reduz a pressa para concluir o turno, com possível pequeno aumento de latência que deve ser medido fisicamente.

## Fixtures/UAT

`test/fixtures/val-turn-detection-uat-v1.json` cobre:

- pausa curta;
- fala hesitante;
- nome próprio;
- frase longa;
- interrupção;
- mudança de ideia;
- ruído moderado de campo.

Automação valida o contrato/configuração. Ela não reproduz microfone, Safari, vento, carro ou provider e não é evidência física.

## Critério físico pendente

Registrar por dispositivo: turnos produzidos, cortes, falsos finais, `speech_end → turn_detected`, barge-in e fallback. Somente depois comparar `auto` e `low` com a mesma fala e ambiente.

Resultado atual: **PARTIAL — tuning implementado e testado em contrato; áudio cortado depois da alteração ainda não medido fisicamente.**
