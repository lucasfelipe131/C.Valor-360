# VAL Voice Decision Copilot v2

Status: implementado na branch `feature/val-master-evolution-vnext`; promoção condicionada ao gate final.

## Objetivo

A voz é uma entrada da mesma conversa da VAL, não um questionário separado. O fluxo preserva o contexto ativo, transcreve a fala, roteia a intenção e devolve uma resposta que pode ser lida, ouvida ou apresentada nos dois formatos. A fala, por si só, não confirma memória.

## Fluxos disponíveis

### Produtor selecionado

1. O navegador solicita permissão e grava o áudio.
2. O backend cria uma interação de voz vinculada ao tenant, consultor e produtor autenticados.
3. O áudio é transcrito e a transcrição entra na thread como uma pergunta transitória.
4. Intent, contexto de sessão e capacidades são recalculados para a solicitação.
5. A resposta volta para a mesma conversa. O usuário pode continuar por texto ou voz.
6. A interação transitória é cancelada/descartada após o uso; somente `REGISTER`, revisado e confirmado, pode promover fatos.

### Sem produtor selecionado

O hero e o Copilot usam transcrição efêmera autenticada. O áudio é validado, transcrito e descartado. Não há vínculo automático, memória, `LearningCandidate` nem escolha implícita do primeiro produtor da carteira.

## Comandos naturais de sessão

Os comandos abaixo reutilizam a thread e não reiniciam o contexto:

- `Resume`, `Repete` e `Só as Perguntas de Ouro` são resolvidos localmente a partir da última resposta.
- `Agora por escrito`, `Agora fala comigo` e `Texto + áudio` alteram apenas a preferência do consultor naquele escopo de armazenamento.
- `Explica melhor`, `Aprofunda`, `Me mostra os números` e `Por que você acha isso?` solicitam nova leitura ao orquestrador usando o contexto da sessão.
- `Registra` abre o fluxo de revisão; `Não registra` mantém o conteúdo apenas na conversa.

Nenhum comando de sessão contorna autorização, tenancy, confirmação de memória, safety ou prescrição.

## Decision Interview

Quando faltam dados materiais, a VAL pergunta de uma a três questões por rodada. As respostas ficam em `SESSION_CONTEXT` e são enviadas como contexto separado, com `persistence_mode: NONE`. A pergunta seguinte reutiliza essas respostas, enquanto a memória confirmada continua sendo carregada apenas das fontes autorizadas. Uma resposta já fornecida não deve ser perguntada novamente.

## Resposta por áudio

A preferência é `Texto`, `Áudio` ou `Texto + áudio`. A leitura usa Web Speech no dispositivo, prioriza voz `pt-BR` e oferece ouvir, pausar, parar e repetir. O áudio sintetizado não é gravado nem enviado ao backend da VAL. A voz concreta depende das vozes instaladas no navegador/sistema operacional; por isso, a personalidade desejada é sustentada sobretudo pela redação: calma, direta, próxima, segura e sem teatralidade.

## Safety, privacidade e limites

- A transcrição não infere emoção, personalidade, gênero, idade, sotaque ou intenção pela prosódia.
- ASK e respostas da entrevista não alteram memória.
- REGISTER exige revisão e confirmação humana.
- Resultados agronômicos continuam assistivos; dose, mistura, compatibilidade e prescrição mantêm revisão e fonte.
- Falha de microfone, navegador incompatível, áudio vazio, arquivo acima do limite ou transcrição indisponível falham de forma explícita e preservam o texto como alternativa.
- Não existe TTS progressivo nesta versão. A síntese começa quando a resposta textual validada está disponível.

## Observabilidade

O pipeline mede `AUTH`, `INTENT`, `CONTEXT`, `MEMORY`, `MCA`, `MIA`, `TOOL`, `MODEL`, `VALIDATION`, `TTS`, `TTFR` e `TOTAL`, com agregações p50, p75, p90 e p95. `TTS` é nulo quando o áudio é sintetizado somente no navegador, evitando fabricar uma duração de servidor.

## Evidência exigida antes de promover

Testes automatizados validam contratos, estados, isolamento e continuidade. O gate final ainda deve registrar UAT físico em microfone real, reprodução de áudio, cancelamento, permissão negada e viewport mobile. Automação de navegador não substitui essa prova física.
