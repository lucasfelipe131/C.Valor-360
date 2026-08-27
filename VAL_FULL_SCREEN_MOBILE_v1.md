# VAL Full-Screen Mobile v1

## Contrato de layout

- Altura: `100dvh`.
- Sem Topbar ou navegação inferior enquanto a VAL está aberta.
- Header mínimo com voltar, identidade, produtor e ações compactas.
- Composer fixo com safe area inferior.
- Textarea em 16 px para evitar zoom involuntário no iOS.
- Conversa é a única região principal de scroll.
- Painel contextual vira sheet; histórico vira drawer de tela inteira.

## Ações do composer

Somente voz, foto, arquivo, texto e enviar permanecem visíveis. Preferência de densidade/saída fica em ação secundária.

## Acessibilidade

- Botões possuem `aria-label` quando o texto é ocultado.
- Foco volta à página ao abrir.
- Modais de Voice Capture mantêm focus trap próprio.
- Estados de processamento usam `role=status`; erros usam `role=alert`.

## UAT físico obrigatório

Antes de promoção, executar em iOS/Safari/PWA e Android/Chrome:

1. abrir e voltar;
2. trocar produtor;
3. enviar texto;
4. gravar, parar, cancelar e transcrever voz;
5. ouvir resposta;
6. tirar foto e selecionar biblioteca;
7. anexar PDF/arquivo;
8. responder Decision Interview;
9. revisar REGISTER;
10. abrir/fechar contexto e histórico;
11. verificar teclado, scroll, safe area, orientação e legibilidade.

CSS responsivo não substitui este UAT físico.

