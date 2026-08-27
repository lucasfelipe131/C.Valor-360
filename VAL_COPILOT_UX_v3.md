# VAL Copilot UX v3

> **Status da entrega:** experiência candidata em validação exclusiva no staging. Não autoriza produção, merge em `main` nem Passo 07.

## Objetivo de experiência

O usuário deve chegar da dúvida à resposta em uma interação principal, sem perder a possibilidade de navegar diretamente aos módulos.

O Copilot é atalho inteligente e camada de orquestração, não substituto obrigatório da interface visual.

## Entradas

- Home;
- Produtor 360;
- Oportunidades;
- Visitas;
- Inteligência Agronômica;
- sidebar/topbar;
- atalho `Ctrl/Cmd + K` no desktop;
- botão central VAL no mobile.

Dentro do Produtor 360, o produtor é implícito e visível. Fora dele, perguntas dependentes de conta exigem seleção. Mercado/commodity diretos podem funcionar sem produtor.

## Desktop

Painel lateral mantém a página atual visível. O usuário pode consultar produtor, oportunidade, análise ou visita enquanto conversa.

O painel não deve empurrar conteúdo para fora do viewport nem abrir uma segunda navegação global.

## Mobile

Navegação principal:

- Hoje;
- Clientes;
- VAL;
- Mais.

VAL abre sheet/tela cheia com texto, voz, câmera e arquivo. Compositor, teclado e controles de áudio respeitam safe area e uso com uma mão.

## Modos

### Perguntar

- `persistence_mode: NONE`;
- texto/voz/anexo;
- resposta e Decision Interview;
- sem promoção de memória.

### Registrar informação

- Voice Capture ou texto;
- candidatos revisáveis;
- confirmação explícita;
- só depois atualizar memória/histórico.

## Resposta em camadas

Primeira camada:

- Minha leitura;
- Próximo passo;
- até três perguntas materiais.

Profundidade:

- Por quê?;
- evidências/provenance;
- agronomia;
- números;
- premissas/confidence.

`SIMPLE`, `BALANCED` e `ANALYTICAL` alteram densidade, não a tese nem os fatos.

## Decision Interview

Perguntas aparecem como parte da conversa, com explicação curta de por que importam. Responder continua no mesmo produtor e conversation ID.

Quando a resposta parece material, a UI oferece registrar ou manter somente na conversa. A opção padrão não é persistir. A resposta da entrevista muda somente a sessão daquele `conversation_id` e produtor; hipótese ou memória proposta não suprime uma pergunta como fato conhecido.

Depois de REGISTER revisado e confirmado, a solicitação seguinte recupera o snapshot atualizado e recompõe as premissas. Antes disso, `confirmed_memory_unchanged: true` permanece a leitura correta.

## Áudio

Nos modos Texto e Texto + áudio, a leitura textual permanece visível. No modo Áudio, o usuário inicia a reprodução pelos controles; se Web Speech estiver ausente, indeterminado ou falhar, a mesma leitura aparece como fallback textual. Há Ouvir, Pausar/Continuar, Parar e Repetir, sem autoplay e sem áudio sintetizado persistido pela VAL. Reproduzir não envia uma requisição de TTS ao backend da VAL, mas o navegador ou sistema operacional pode usar rede conforme seu serviço de voz.

## Current data

Mercado/commodity mostram fonte, praça, data/hora e freshness no texto principal e no texto falável, não apenas na área de evidências. Referência vencida recebe aviso; ausência de fonte recebe estado indisponível.

## Workspace agronômico

Cards e deep links abrem a capacidade técnica dentro do shell da VAL. O modo embedded/headless não mostra sidebar ou marca paralela.

## Feedback de progresso

FAST responde diretamente. DEEP pode mostrar etapas reais vindas do backend. A UI não afirma módulos que ainda não foram chamados: `capabilities_planned` mostra o plano, enquanto somente `capabilities_used` com o respectivo `capability_results` sustenta “consultado”, progresso ou evidência.

## Acessibilidade

- foco inicial e retorno ao elemento de abertura;
- Escape fecha quando seguro;
- labels para ícones/controles;
- status e erros anunciados;
- navegação por teclado;
- contraste e alvos de toque;
- texto como fallback de voz;
- anexos removíveis com nome acessível.

## Estados de erro

- produtor necessário;
- current data indisponível/desatualizado;
- provider profundo em fallback;
- timeout com retry;
- voz indisponível com texto preservado;
- anexo inválido;
- sessão expirada.

## UAT mínimo

Desktop autenticado:

- abrir em cada superfície sem sair da página;
- contexto certo ao trocar produtor;
- mercado sem produtor;
- FAST última visita;
- DEEP comercial + agronômico;
- provenance e módulos ainda navegáveis.

Mobile físico em iOS e Android:

- teclado/safe area;
- microfone e cancelamento;
- câmera/arquivo;
- ouvir/pausar/continuar/parar/repetir;
- rotação, background/foreground e rede instável.

Teste de CSS ou viewport em cloud browser não substitui hardware físico para o gate de voz mobile.
