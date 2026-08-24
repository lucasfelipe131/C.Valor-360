# VOICE CAPTURE — UAT NO STAGING

Status: **EM EXECUÇÃO — BLOQUEIO ENCONTRADO**

Data: 24/08/2026  
Ambiente: `https://val-web-staging-production.up.railway.app/`  
Escopo: somente staging; nenhuma alteração funcional realizada durante o UAT.

## Fixture controlado

- Usuário: `integration01@val.test`
- Produtor: `Produtor UAT Voice 01`
- Origem: `voice_uat_fixture`
- Dados exclusivamente fictícios
- Linha de base: 0 interações de voz e 0 memórias

## UAT-IOS-CLIENT-001 — Cliente 360 / gravação curta

Resultado: **FALHOU — BLOQUEADOR DO GATE**

Dispositivo físico:

- Identificador: `iPhone15,2` (modelo comercial a confirmar no fechamento)
- iOS: `26.5.2`
- Navegador: Safari
- Contexto: Cliente 360 → Registrar áudio
- Duração pretendida: 10–20 segundos

### Reprodução

1. Autenticar no staging pelo Safari do iPhone.
2. Abrir `Produtor UAT Voice 01` no Cliente 360.
3. Tocar em **Registrar áudio** e permitir o microfone.
4. Gravar um relato curto, parar e enviar.
5. Observar a rejeição durante a validação do áudio.

### Resultado observado

A interface exibiu:

> Não foi possível concluir agora. Não foi possível verificar a duração real do áudio.

O fluxo ofereceu `Cancelar`, `Digitar em vez disso` e `Tentar novamente`.

### Evidência de integridade após a falha

- Interação: `CREATED`
- Confirmação: `PENDING`
- Transcrição: `PENDING`
- `duration_seconds`: `null`
- `audio_ref`: `null`
- Anexos persistidos: 0
- Memórias persistidas: 0

A fala não confirmada não alterou a memória e não houve persistência parcial silenciosa.

### Severidade

**Crítica para aceitação / bloqueadora do gate.** A jornada nativa de microfone no Safari do iPhone não alcança transcrição e revisão.

### Causa provável

O Safari grava via `MediaRecorder` em MP4/M4A. O servidor aceita a assinatura do container, mas o `ffprobe` não obtém uma duração finita do arquivo produzido nessa sessão e devolve `audio_duration_unverified`. A hipótese precisa ser confirmada com fixture binário representativo do Safari antes de qualquer correção.

### Correção autorizada — aguardando reteste físico

Autorização explícita recebida após o registro da falha.

Implementação local:

1. A medição server-side consulta duração do container e do stream de áudio.
2. Quando o MP4/M4A fragmentado não informa duração nesses metadados, o servidor calcula a duração pelos timestamps reais dos pacotes de áudio.
3. O limite de 15 minutos continua aplicado à duração medida no servidor; o valor enviado pelo navegador não é aceito como autoridade.
4. Arquivos inválidos continuam falhando antes de qualquer persistência.

Validação local:

- testes focados de Voice Capture: 96/96 aprovados;
- suíte completa: 604/604 aprovada;
- build principal/PWA: aprovado;
- build Manual do Agrônomo: aprovado;
- testes novos: duração do stream, timeline de MP4 fragmentado e fallback independente do tempo declarado pelo Safari.

O caso permanece **FALHOU** até a publicação controlada no staging e o reteste no mesmo iPhone físico.

## Próximas evidências pendentes

- retry da mesma interação;
- fallback para texto;
- conclusão do Cliente 360;
- pré-visita, observação de campo, pós-visita e segunda preparação;
- negação de permissão, falha de upload e demais durações;
- iOS físico após correção;
- Android físico;
- privacidade, safety e cross-tenant em UAT autenticado.
