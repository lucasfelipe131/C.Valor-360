# Fluxo de confirmação de voz

Status: fluxo implementado, CI/PG16 e staging técnico aprovados; jornada autenticada integral e dispositivo físico pendentes.

## Princípio

A fronteira de confiança é a confirmação humana. Áudio, transcript e candidatos podem ser persistidos para recuperação, mas não atualizam memória ou execução antes de a VoiceInteraction chegar a `CONFIRMED`.

## Jornada implementada

1. O consultor abre a ação de voz contextual.
2. A UI tenta iniciar o microfone; também permite arquivo de áudio e texto.
3. Ao parar, o hook mantém blob, duração e preview somente no navegador.
4. `POST /voice-interactions` cria o agregado.
5. O áudio é validado e enviado por `POST .../audio` ou o texto manual já cria um transcript lógico.
6. `POST .../process` transcreve, extrai e deixa candidatos em `PENDING_REVIEW`.
7. A UI mostra transcript e itens editáveis.
8. O consultor mantém, edita, remove/rejeita ou adiciona itens.
9. `POST .../confirm` revalida toda a revisão.
10. Somente itens confirmados geram efeitos.
11. A tela de sucesso informa o contexto concluído.

## Payload real de revisão

O request usa `items` e `additions`:

```json
{
  "items": [
    {
      "candidate_id": "uuid",
      "decision": "CONFIRMED",
      "statement": "Retornar com o comparativo de custo por hectare.",
      "due_at": "2026-08-27T23:59:59.999-03:00"
    },
    {
      "candidate_id": "uuid",
      "decision": "REJECTED"
    }
  ],
  "additions": [
    {
      "category": "FACT_CANDIDATE",
      "statement": "O sócio participa da decisão."
    }
  ],
  "outcome_type": "NO_DECISION",
  "no_action": false
}
```

Regras implementadas:

- todos os candidatos originais precisam de decisão explícita;
- editar substitui `statement` somente na revisão final; o candidato inicial permanece em `candidates`;
- remover na UI envia `decision: REJECTED`;
- adição cria novo `VoiceCandidate v1` com origem `consultant-addition:<interaction>`;
- itens revisados recebem `reviewed_by` e `reviewed_at`;
- até 50 itens originais, até 20 adições e no máximo 50 itens no total;
- texto vazio, ID duplicado/alheio, categoria inválida e conteúdo unsafe falham fechados;
- Commitment/NEXT_STEP podem receber `due_at`.

Não existem no payload público `revision`, `idempotency_key`, `edited_by` ou `edited_at`. Concorrência é protegida internamente por estado/revisão compare-and-set e transações.

## Tela de revisão

A UI agrupa candidatos pelas dez categorias do contrato, mostra marca epistemológica, transcript em painel expansível e oferece:

- **Confirmar tudo**;
- editar o texto;
- remover um item;
- adicionar informação;
- informar prazo quando necessário;
- retry/fallback em falhas;
- cancelar.

Em `POST_VISIT`, `NEXT_STEP` tem uma única fonte revisável. O consultor precisa manter/adicionar próximo passo ou marcar explicitamente `no_action`. Uma falha de confirmação retorna à revisão e preserva as edições locais.

## Efeito epistemológico

Categoria e epistemologia são independentes:

| `epistemic_status` confirmado | Persistência de memória |
|---|---|
| `FACT_CANDIDATE` | `memory_state: FACT`, `type: fact`, `status: verified` |
| `INFERENCE` | `memory_state: INFERENCE`, `type: inference`, `status: proposed` |
| `HYPOTHESIS` | `memory_state: HYPOTHESIS`, `type: inference`, `status: proposed` |

Confirmação humana valida que o consultor aprovou o registro; ela não transforma hipótese ou inferência em fato.

## Efeitos por contexto

### `PRE_VISIT`

Após confirmar:

1. a transação não pós-visita cria Interaction, memórias, commitments e oportunidades válidos;
2. o service reivindica um `preparation_claim_id`;
3. `prepareVisitExecution` gera nova preparação/context snapshot/action plan;
4. referências ficam em `related_artifacts`;
5. retries recuperam resultado ou conflito de preparação em andamento.

`PRE_VISIT` exige `visit_id` no service e nunca apaga preparação anterior.

### `POST_VISIT`

Na interface, uma visita `PLANNED`/`PREPARED` possui a ação **Iniciar visita**. A rota tenant-safe `POST /api/v1/visits/{visitId}/start` move a visita para `IN_PROGRESS`; nesse estado ficam acessíveis FIELD_NOTE e POST_VISIT. A transição é idempotente e estados terminais falham fechados.

O service primeiro valida toda a revisão e o próximo passo. Depois:

`VoiceInteraction → VisitReport v1 pendente → confirmação transacional do Visit Loop → Interaction/MMI + Commitment + oportunidade + Outcome + LearningCandidate`.

O Visit Report recebe `source_type: AUDIO` quando a captura contém gravação e `source_type: TEXT` quando o consultor usa o fallback digitado; em ambos os casos mantém `transcript_ref: voice-transcript:<uuid>`. Se outro fluxo já confirmou esse report, a VoiceInteraction fica pendente e retorna conflito; candidatos não são aplicados silenciosamente.

### `CLIENT_NOTE`, `FIELD_NOTE` e `GENERAL_CONTEXT`

Usam `confirmVoiceInteraction` do repositório para criar somente efeitos revisados. Podem criar Commitment e oportunidade quando o candidato é explícito e válido. Não criam Outcome ou LearningCandidate.

Uma observação agronômica é gravada como `REPORTED_OBSERVATION`, com revisão técnica requerida. Oportunidade técnica recebe evidência `REQUIRES_MIA`; nenhum produto, dose ou manejo é gerado.

## Atomicidade e idempotência

- repositório atualiza a VoiceInteraction com expected state/revision;
- confirmação não pós-visita grava Interaction, memórias, commitments, oportunidades e VoiceInteraction em uma transação;
- confirmação pós-visita usa a transação existente do Visit Loop e carrega `voiceConfirmation` junto;
- confirmação repetida de estado `CONFIRMED` recupera os efeitos já persistidos;
- duas confirmações concorrentes não devem duplicar efeitos;
- revisão inválida não cria nem mesmo VisitReport pendente;
- resposta perdida depois do commit pode ser recuperada por `GET`/reconfirmação.

## Cancelamento e retomada

`POST .../cancel` é permitido em estados não terminais e é idempotente para `CANCELLED`. Interação `CONFIRMED` não pode ser cancelada. Cancelamento aborta o controller local, marca áudio como rejeitado e impede resultado tardio por verificação de lease.

A UI persiste em `localStorage` apenas `interaction_id` e timestamp, com chave escopada e validade de sete dias. Áudio, transcript, candidato e texto manual não são persistidos localmente por esse mecanismo.

## Safety reaplicado na revisão

Edição, adição e próximo passo são verificados novamente. São bloqueados:

- instruções de prompt/comando;
- traços de tom, emoção, sotaque, gênero ou idade aparente;
- prescrição agronômica, dose ou manejo.

## Evidência e limites atuais

Testes automatizados cobrem revisão completa/incompleta, edição, adição, rejeição, limites, safety, concorrência, idempotência, PRE/POST e nenhuma escrita pré-confirmação.

Ainda faltam evidências de:

- fluxo real completo pela interface em staging;
- retry real pela interface implantada (a transcrição OpenAI real isolada já foi aprovada);
- retomada após reload em navegador implantado;
- usabilidade com microfone físico em iOS/Android/PWA.
