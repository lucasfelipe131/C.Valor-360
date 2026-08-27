# VAL Conversation Memory Policy v1

## Regra central

Conversa não é memória confirmada.

## ASK

- `persistence_mode: NONE`.
- Pode usar memória confirmada, ContextSnapshot e respostas desta sessão.
- Resposta de Decision Interview recalcula a leitura apenas na sessão.
- Perguntar por texto, voz, foto ou arquivo não promove fatos.
- O histórico visual da thread não é consultado como fato fora do contrato de conversa.

## REGISTER

- `persistence_mode: CONFIRM_REQUIRED`.
- Exige produtor autorizado.
- Voz ou texto é transcrito/extraído em candidatos.
- O usuário revisa, edita, confirma ou rejeita cada item.
- Somente itens confirmados geram writes governados.
- A próxima solicitação relê o ContextSnapshot e recalcula as premissas.

## Estados epistemológicos

- fato confirmado → `FACT` / `verified`;
- inferência → `INFERENCE` / `proposed`;
- hipótese → `HYPOTHESIS` / `proposed`;
- perfis pendentes, propostos ou vencidos não personalizam respostas como verdade confirmada.

## Thread e escopo

Threads podem existir por conversa geral, produtor, oportunidade ou visita. Elas compartilham a memória canônica do produtor; não duplicam `val_memories`.

O armazenamento de interface é escopado por `storageScope` e limitado. Troca de tenant/owner remonta a superfície com outra chave.

## Proibições

A IA não autoriza, não muda tenant, não aprova memória, não prescreve e não executa ações críticas. O Orchestrator e as políticas determinísticas continuam como fronteira.

