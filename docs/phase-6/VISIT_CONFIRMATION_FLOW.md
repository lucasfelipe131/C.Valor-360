# Fluxo de confirmação da visita

1. O consultor aciona “Registrar visita”.
2. Escreve o relato ou referencia um áudio permitido.
3. A VAL transcreve quando aplicável e gera candidatos estruturados.
4. A tela mostra resumo, compromissos, próximo passo, oportunidades e lacunas.
5. O consultor pode confirmar, editar, remover e adicionar.
6. Compromisso com data ambígua é bloqueado até correção explícita.
7. A visita só conclui com próximo passo explícito; `NO_ACTION` é válido.
8. Uma transação grava report confirmado, interação, memórias aprovadas, compromissos, oportunidade, outcome e LearningCandidate.
9. A resposta confirma: “Visita registrada. Sua próxima preparação já foi atualizada.”

Idempotência de criação usa `(tenant_id, visit_id, idempotency_key)`. A leitura/escrita exige tenant, carteira e ator autorizados. Texto, áudio e transcript não entram em telemetria.

Em retry após confirmação, o banco falha fechado para nova confirmação concorrente; a leitura de `learning-context` permite recuperar o estado material já persistido.
