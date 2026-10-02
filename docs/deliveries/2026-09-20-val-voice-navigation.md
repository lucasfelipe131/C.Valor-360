# VAL — conversa persistente e auxílio de navegação

Base: `ed1270f5397f6129379d35edeff1ca3f433b1edb` (candidata do PR #107).
Branch isolada: `fix/val-voice-navigation-assistant-20260920`.

## Problema confirmado

A criação da sessão de voz pode responder HTTP 409 com
`realtime_voice_context_epoch_mismatch`. O serviço já produzia `currentContext`
depois de verificar o escopo autorizado, e o browser já sabia reconciliá-lo uma
vez. O catch interno de `handleApi` descartava esse campo; somente o catch
externo o serializava. Por isso a retomada terminava em “Sincronize o contexto”.
O catch interno agora preserva o campo exclusivamente para esse código.

A navegação para módulos globais também fechava o copiloto e criava outra
conversa. Com a voz explicitamente iniciada, a navegação mantém a conversa,
inclusive quando pausada. O contexto da página continua independente; trocar
explicitamente de produtor continua renovando o escopo da voz e rejeitando
eventos antigos. Encerrar, fechar o copiloto ou sair da conta libera o microfone.

## Comportamento entregue

- Painel compacto com estado do microfone, produtor da conversa, pausa,
  retomada, encerramento e botão “Ajuda da VAL nesta tela”.
- Voz e histórico acompanham as guias sem abrir outra sessão por mera navegação.
- “Como uso esta tela?” usa o módulo, a ferramenta e a guia atuais; as
  orientações vêm de um catálogo de operações existentes, sem inventar valores
  visíveis na tela ou consultar um provider para essa ajuda.
- Comandos de navegação chegam às guias existentes, incluindo preferências,
  documentos, Manual, clima e mercado. Administração e visão gerencial respeitam
  o papel do usuário.
- Agronomia, comercial, consultas, anexos, memória revisada e demais funções
  continuam utilizando os fluxos existentes. Navegação e ajuda não gravam dados.

## Validação local

- Suíte completa: **2.148 PASS**, zero fail, skip, todo ou cancelled.
- Build Vite e verificação do service worker/manifesto: PASS.
- HTTP real comprova que o 409 devolve o contexto de sincronização e que erros
  de escopo não o expõem. O serviço de voz desse teste é sintético; não houve
  sessão paga nem acesso a microfone real.
- App/React/hook reais com fronteiras de navegador simuladas: navegação entre
  módulos em desktop/mobile, retorno ao Início, pausa/retomada, contexto de
  ajuda, comando falado para Relatórios, troca explícita de produtor e descarte
  de eventos tardios.

## Publicação

Nenhum deploy, redeploy, merge, mudança de source, variável, usuário ou banco.
PR #107 e branches ligadas ao staging preservados. A pausa de publicações do
staging compartilhado continua válida. A integração/publicação desta alteração
precisa de uma janela coordenada; não há publicação agendada.

O teste físico de áudio e a revisão visual em aparelho real permanecem para a
homologação. Os resultados locais não equivalem a UAT físico. Os limites de
duração e orçamento da voz existentes foram mantidos.
