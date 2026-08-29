# VAL End-to-End Voice UAT v1

## Estado

Plano pronto; execução física da árvore nova: **NOT EXECUTED**. A árvore não foi publicada nem implantada no Railway. Não usar esta matriz como evidência de iPhone/Android.

## Pré-condições

- branch/commit da correção publicados sem alterar main;
- CI remoto verde;
- Railway `VAL - STAGING INTEGRATION 01 / val-web-staging` no SHA da correção;
- `VAL_REALTIME_VOICE_ENABLED=true` apenas para testers autorizados;
- orçamento Realtime dentro do teto de US$ 25;
- runtime metadata, PostgreSQL e IA prontos.

## UAT “dia inteiro por voz”

| Etapa | Frase | Evidência esperada | Estado atual |
|---|---|---|---|
| Abrir cliente | “VAL, abre o Antônio.” | entidade única ou desambiguação; UI sincronizada | PASS automatizado |
| Retomar contexto | “Qual foi a última visita?” | FAST, mesmo cliente | PASS regressão |
| Preparar | “Prepara uma visita pra amanhã.” | contexto + Decision Interview | PASS contrato; físico pendente |
| Mudar foco | “Agora muda o foco pra nutrição.” | session context, sem write | PASS conversa; físico pendente |
| Registrar | “Registra que o filho vai participar.” | proposta e confirmação | PASS fluxo existente |
| Solo | “Me mostra a análise de solo dele.” | abre adapter canônico | PASS roteamento; físico pendente |
| Cálculo | “Calcula isso por hectare.” | solicita inputs e usa calculadora | PASS regressão |
| Mapa | “Abre o mapa da fazenda.” | navegação Agronomia | PASS automatizado |
| Mercado | “Quanto está a soja hoje?” | fonte + timestamp | PASS regressão |
| Cruzar contexto | “Isso muda a abordagem?” | cliente + live data + reasoning | PASS regressão; físico pendente |
| Voltar cliente | “Volta para o produtor anterior.” | referência recente, sem fatos cruzados | PASS automatizado |

## Turn detection físico

Executar TD-001–TD-007 do fixture em:

- iPhone real: modelo, iOS, Safari e PWA;
- Android real: modelo, Android, Chrome e PWA;
- ambiente silencioso e ruído moderado;
- três repetições por caso.

Registrar `speech_end`, `turn_detected`, transcript, entity resolution, intent, first text, first audio, resposta completa, falsos cortes e fallback.

## Barge-in

Enquanto a VAL fala: “Espera. Volta no milho.” PASS somente se áudio parar, novo turno for capturado e contexto permanecer.

## Multimodal

Na mesma thread: voz → foto → diagnóstico → “Isso muda a conversa?”; depois voz → PDF de solo → interpretação. Confirmar provenance, tenant e ausência de memória automática.

## Saída obrigatória do avaliador

- Naturalidade: ROBOTIC / MOSTLY_ROBOTIC / ACCEPTABLE / NATURAL / VERY_NATURAL.
- Percepção: gravador / chatbot por voz / conversando com a VAL.
- Número de vezes que precisou procurar manualmente uma função.
- PASS/PARTIAL/FAIL por caso, com evidência física.
