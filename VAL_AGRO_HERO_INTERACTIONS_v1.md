# VAL Agro Hero Interactions v1

## Objetivo

O head da Inteligência Agronômica deixa de ser decorativo e oferece quatro entradas operacionais no próprio hero: voz, texto, foto e arquivo. A página entrega a ação e o contexto ao adapter do Copilot, sem reconstruir a engine, criar memória ou prescrever.

## Contrato implementado

`Agro` aceita os callbacks `onAsk`, `onCapture`, `onTelemetry` e `onContextChange`.

- Texto é entregue a `onAsk`.
- Voz, foto e arquivo são entregues a `onCapture`; `onAsk` é fallback de compatibilidade.
- O payload usa `val.agro_hero_action.v1`, `mode=ASK`, `source=agro_hero` e `persistenceMode=NONE`.
- O arquivo binário permanece em `attachment.file` somente para o adapter autorizado consumir.
- Nenhum CTA chama banco, memória, tenant ou API de prescrição diretamente.

Cada ação percorre os estados `idle`, `loading`, `success` ou `error`, com fase e mensagem reais. Toda transição tenta emitir `agro_hero_interaction`, contendo somente ação, estado, fase, presença/tipos de contexto, código de erro e data. Prompt, nome/conteúdo de arquivo, tenant e owner não entram na telemetria do hero.

## Fluxos

### Voz

O clique chama `getUserMedia` no mesmo gesto de ativação, mostra solicitação/gravação, permite parar ou cancelar e encerra todas as tracks. Ao parar, o componente cria o arquivo de áudio em memória e o entrega para transcrição pelo adapter. Permissão negada, microfone ausente/ocupado, navegador incompatível, áudio vazio e limite de tamanho possuem erro específico.

Essa prova é de contrato e código. Microfone, reprodução e acústica ainda exigem UAT físico em aparelhos homologados.

### Texto

O clique abre e focaliza um composer no próprio hero. Envio vazio falha localmente. O texto é limitado a 3.000 caracteres e mantém o contexto da página.

### Foto

O clique aciona diretamente um `input[type=file]` local com `capture=environment` e tipos JPEG, PNG ou WebP. Não há timeout, drawer intermediário ou redirecionamento antes do seletor. A foto validada é entregue com intenção provável `IMAGE_DIAGNOSIS`.

### Arquivo

O clique aciona diretamente o seletor local. São aceitos foto, PDF, Word, Excel, CSV ou TXT, até 6 MB. Tipo inválido, arquivo vazio e excesso de tamanho falham antes do callback. Nome contendo solo, fertilidade ou laudo sugere `ANALYZE_SOIL`; os demais entram como documento agronômico a confirmar.

`initialFiles` aceita até três anexos já mantidos na sessão. O hero mostra nome, validação, intenção provável e se existe contexto de produtor. Nada é enviado ou salvo automaticamente: o usuário precisa escolher `Interpretar agora`, remover o item ou selecionar novamente. Sem produtor, o texto declara `Sem vínculo; uso somente nesta conversa`.

## Contexto

`val.agro_hero_context.v1` transporta somente entidades normalizadas:

- `producer` e `clientId`;
- `property`;
- `field`/talhão;
- `analysis`;
- ferramenta agronômica ativa.

A prioridade do objeto ativo é análise, talhão, propriedade e ferramenta. Rótulos aparecem em chips no hero. Campos `tenantId`, `ownerId`, `organizationId` ou equivalentes são descartados pelo contrato local; autorização e isolamento continuam responsabilidade obrigatória do Orchestrator e do módulo receptor.

## Abertura de ferramenta pelo Copilot

`initialTool` aceita `id`, `page` e `mode`. Mudanças no descritor selecionam a ferramenta e recarregam o iframe embutido. Depois do `load`, a página envia `valor360:navigate` v1 com `requestId`, página, ferramenta/modo normalizados e contexto permitido.

O `postMessage` usa exatamente `window.location.origin`. O Manual também revalida `event.origin`, `event.source` e os IDs contra o workspace autenticado. O comando não inclui tenant, owner ou workspace. Aliases aceitos incluem mapeamento, calculadoras, solo, diagnóstico, NutriScan e FitoScan; `FitScan` é apenas alias de entrada para FitoScan/doenças.

## Matriz de teste

| ID | Evidência automatizada |
|---|---|
| AGRO_HERO_001 | CTA de voz, chamada direta ao microfone, parar e cancelar |
| AGRO_HERO_002 | CTA de texto e composer SSR funcional |
| AGRO_HERO_003 | input de foto/câmera no próprio gesto |
| AGRO_HERO_004 | seletor técnico, arquivo de sessão e confirmação explícita |
| AGRO_HERO_005 | produtor, propriedade, talhão e análise preservados |
| AGRO_HERO_006 | erros de microfone tratados |
| AGRO_HERO_007 | MIME, vazio e limite de upload tratados |
| AGRO_HERO_008 | regras mobile, toque e composer legível |
| AGRO_HERO_009 | quatro CTAs em desktop, estados e telemetria |
| AGRO_HERO_010 | payload local sem campos cross-tenant e sem persistência |

Os testes são de lógica, SSR e contrato estático compatíveis com o runner atual. Eles não equivalem a UAT físico de microfone, câmera, seletor nativo, orientação, áudio ou aparelho mobile.

## Limites de promoção

- O adapter principal precisa consumir `attachment.file`, transcrever voz e apresentar a resposta continuável.
- UAT físico deve validar permissões, cancelamento do seletor, câmera traseira, acústica e layout em aparelho.
- O Orchestrator continua responsável por auth, permissionamento, tenancy, persistência, safety e confirmação de memória.
- O receiver técnico pode responder `APPLIED`, `PARTIAL` ou `CONTEXT_REJECTED`; o contexto rejeitado nunca deve ser assumido como aplicado.
- Esta implementação não faz merge, deploy, migration, produção ou Passo 07.
