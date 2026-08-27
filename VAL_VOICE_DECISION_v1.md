# VAL Voice Decision v1

> **Status da entrega:** contrato candidato em validação exclusiva no staging. Não autoriza produção, merge em `main` nem Passo 07.

## Escopo

Voice Decision combina:

- entrada por voz, com transcrição e governança existentes;
- resposta por voz, sob controle explícito do usuário;
- continuidade da Decision Interview;
- texto sempre disponível como fallback e referência acessível.

## Entrada por voz

```text
fala -> transcrição -> ASK ou REGISTER -> raciocínio -> resposta
```

Em ASK transitório, a interação é cancelada depois da transcrição e antes de qualquer promoção de memória. Em REGISTER, candidatos passam por revisão e confirmação.

O áudio recebido não altera o status epistemológico de uma informação. Transcrição, hipótese, fato candidato e memória confirmada continuam distintos.

## Saída por voz

A v1 usa a Web Speech API do navegador (`speechSynthesis`). A resposta da VAL fornece `voice_output.speakable_text`; ao reproduzi-lo, o frontend não faz uma nova requisição de TTS ao backend da VAL. Isso não significa processamento necessariamente offline: o navegador ou o sistema operacional pode usar rede e serviços próprios de voz conforme o dispositivo.

Quando a Decision Interview precisa de informação, o texto falável inclui a leitura, o próximo passo e as perguntas materiais da rodada. Ouvir a pergunta não a confirma nem a registra.

Controles esperados:

- Ouvir;
- Pausar;
- Continuar;
- Parar;
- Repetir.

O usuário inicia a reprodução. Não há autoplay.

## Política de persistência

`VAL_VOICE_OUTPUT_POLICY` deve declarar:

- implementação browser-native;
- `persistence: NONE`;
- `records_audio: false` e `stores_text_in_val: false` para a operação de reprodução;
- `sends_backend_request: false`: reproduzir não envia áudio nem nova requisição ao backend da VAL;
- `browser_service_may_use_network: true`: Web Speech pode recorrer a rede/serviço do navegador ou sistema operacional;
- nenhum efeito automático sobre memória;
- texto canônico como fonte da resposta.

Essas flags descrevem a camada de reprodução da VAL. Elas não afirmam que todo navegador sintetiza localmente, nem substituem a política de privacidade do navegador, do sistema operacional ou do dispositivo.

Ouvir, pausar, parar ou repetir não cria recomendação adicional, memória, interação de voz de entrada nem evento de confirmação.

## Seleção de voz

Quando disponível, o cliente prefere uma voz `pt-BR`; depois aceita outra voz em português; por fim usa a voz padrão do navegador. Nome, timbre e qualidade variam por sistema operacional e não fazem parte do contrato.

O texto falado deve:

- remover ruído visual incompatível com fala;
- preservar números, ressalvas e bloqueios de safety;
- ser limitado para não monopolizar o dispositivo;
- ser interrompível imediatamente.

## Estados de reprodução

```text
IDLE -> PLAYING -> PAUSED -> PLAYING
PLAYING|PAUSED -> STOPPED
ENDED -> IDLE
ERROR|UNAVAILABLE -> TEXT_FALLBACK
```

Uma nova resposta cancela a fala anterior. Fechar o painel também deve cancelar a reprodução ativa.

## Compatibilidade e fallback

Web Speech não é uniforme entre navegadores. A ausência de `speechSynthesis`, de vozes instaladas, de rede exigida pelo serviço do dispositivo ou uma falha de reprodução não bloqueia a resposta em texto.

Não há, nesta entrega:

- TTS no servidor;
- arquivo de áudio persistido;
- voz neural contratada;
- garantia de que a síntese ocorra offline;
- sincronização de velocidade entre dispositivos;
- garantia de reprodução em background.

## Acessibilidade

- controles com nome acessível e estado anunciado;
- `aria-pressed` ou equivalente para pausa;
- texto permanece visível;
- feedback de indisponibilidade sem esconder a resposta;
- alvo de toque adequado no mobile;
- não depender apenas de ícone ou som.

## Segurança

O texto falado é derivado da resposta já validada. A camada de voz não reescreve prescrição retida, não acrescenta conteúdo e não reduz avisos.

## Verificação

Testes unitários usam adapter injetável, sem depender de voz instalada no CI. Cloud browser valida controles e fallback; iPhone e Android físicos são obrigatórios para aprovar áudio, interrupção, teclado, microfone e coexistência com câmera.
