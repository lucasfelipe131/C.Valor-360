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
| noise reduction | `near_field` | `far_field` (2026-09-01) |
| browser constraints | echo/noise/auto gain | mantidos |
| ordem de inicialização | sessão paga antes do microfone | microfone antes de reserva/credencial |

`VAL_REALTIME_VOICE_VAD_EAGERNESS` aceita `low`, `medium`, `high` ou `auto`, sem novo secret e sem mudar o modelo autorizado.

## Por que `low`

O problema observado é corte em pausas e fala hesitante. No contrato real usado pelo provider, semantic VAD expõe `eagerness`; não foram inventados `silence_duration_ms`, threshold ou prefix padding incompatíveis com essa API. `low` reduz a pressa para concluir o turno, com possível pequeno aumento de latência que deve ser medido fisicamente.

## Por que `far_field` (2026-09-01)

Relato físico novo: usuário sem fone de ouvido, saída pelo alto-falante do notebook/caixinha, áudio da VAL "cortando" no meio da fala. `near_field` é o perfil documentado pelo provider para microfone próximo à boca (headset/fone) — não é o caso aqui. `far_field` é o perfil do mesmo contrato pensado para microfone captando a uma distância maior (notebook, sala), que é o cenário real de uso em campo já coberto por `TD-007` (`ruido_de_campo`) no UAT. A troca não altera `eagerness`, `interrupt_response` nem `create_response` — ataca um eixo diferente (perfil acústico de entrada) do que a tunagem anterior (pressa para concluir turno).

Isto reduz, mas não elimina por software, o eco acústico entre a caixinha e o microfone: o cancelamento de eco em si depende do `echoCancellation:true` do navegador (já habilitado em `getUserMedia`) somado a este perfil de ruído do provider. Sem headset, algum resíduo de eco pode continuar sendo captado em volumes altos — isso não tem solução puramente de software sem hardware de AEC dedicado.

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

Resultado atual: **PARTIAL — tuning de `eagerness` e `noise_reduction` implementado e testado em contrato; áudio cortado com uso real (caixinha, sem fone) ainda não medido fisicamente após a troca para `far_field`.**
