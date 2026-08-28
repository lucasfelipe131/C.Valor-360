# VAL Multimodal Composer v1

## Estrutura

O composer permanece fixo na parte inferior e oferece, na ordem de trabalho:

- voz;
- foto;
- arquivo;
- texto;
- enviar.

No mobile as ações são ícones; descrições ficam em `aria-label` e nos fluxos abertos.

## Voz

Com produtor selecionado, o composer reutiliza Voice Capture em modo `transient`:

1. captura iniciada pelo usuário;
2. upload e transcrição;
3. texto enviado à conversa;
4. interação transitória cancelada;
5. nenhuma promoção de memória.

Sem produtor, o composer usa Web Speech efêmero quando o navegador suporta. O texto reconhecido vai para ASK e não é armazenado como VoiceInteraction. Se o browser não oferece a API, a UI informa o fallback sem simular sucesso.

## Foto e arquivo

- Tipos permitidos: JPEG, PNG, WebP, GIF, PDF, Word, Excel, CSV e TXT.
- Limite: 6 MB por arquivo e até três por pergunta.
- Com produtor: upload para `/api/val/attachments`, escopado por tenant/owner/client.
- Sem produtor: o arquivo permanece local e a VAL pergunta a qual produtor vincular.
- `Deixar sem vínculo` abre o fluxo headless da Inteligência Agronômica; nenhum dado entra em memória de produtor.

## Saída

Preferências disponíveis: Texto, Áudio, Texto + áudio. A reprodução exige ação explícita do usuário e não usa autoplay.

## Safety

Anexo ou voz não alteram memória durante ASK. REGISTER continua separado e exige revisão explícita dos candidatos antes da confirmação.

