# VAL NutriScan Integration v1

## Objetivo

Integrar o NutriScan existente ao ecossistema da VAL e ao Copilot, preservando a metodologia, os limites de triagem, a confirmação humana e o isolamento tenant. Não criar um segundo motor de diagnóstico.

Este documento registra o estado atual e o contrato ainda necessário para uma integração completa.

## Implementação atual confirmada

O NutriScan existe no Manual em:

- `manual/app/PhotoDiagnosis.tsx`, modo `nutrition`;
- `manual/app/api/diagnosis/route.ts`, prompt `METODOLOGIA NUTRISCAN`.

### Entrada

- uma a três imagens;
- JPEG, PNG ou WebP;
- captura por câmera ou seletor de arquivo;
- limite da UI de 15 MB por arquivo;
- resize para lado máximo de 1.600 px e JPEG 0,84;
- validação da API de até 5 MB por imagem base64 e 20 MB por request;
- cultura, estádio, órgão, posição no dossel, distribuição e observações.

### Metodologia

O prompt implementado:

1. descreve clorose, necrose, deformação, simetria e localização;
2. confronta folhas novas/velhas com mobilidade fisiológica;
3. usa cultura, estádio, órgão e distribuição;
4. testa alternativas como pH, compactação, raiz, água, herbicida e doença;
5. gera exatamente três deficiências ou causas nutricionais plausíveis.

### Saída estruturada

- resumo;
- qualidade da imagem;
- sintomas visíveis;
- três hipóteses ranqueadas;
- compatibilidade de 0 a 100, sem exigir soma de 100;
- severidade visual;
- evidências a favor e contra;
- etapas de confirmação;
- urgência;
- confundidores e evidências faltantes;
- próximos passos;
- nota de safety.

## Safety atual

- É triagem visual, não confirmação diagnóstica.
- Não recomenda marca, produto, ingrediente ativo ou dose.
- Reduz confiança quando a imagem ou o contexto não sustentam a hipótese.
- Orienta confirmação por vistoria, análise de solo/tecido ou laboratório.
- API autenticada, com rate limit, JSON schema estrito, `store: false` e timeout.

Esses limites não podem ser relaxados pelo Copilot.

## Estado de integração na VAL

### O que está implementado na branch

- A página agronômica abre `diagnostico` no Manual embutido.
- O capability router reconhece `IMAGE_DIAGNOSIS` e `NUTRISCAN`; o executor produz descritor governado para a ferramenta.
- O composer da VAL aceita imagens.
- `val_attachments` persiste imagens vinculadas a produtor com tenant, consultor, hash, status e `analysis`.
- A engine da VAL trata observações visuais como não confirmadas e não produz diagnóstico automático.
- `valor360:navigate` v1 normaliza `NutriScan`/`nutricao` para `tool=diagnosis`, `diagnosisMode=nutrition` e `page=diagnostico`.
- O receiver exige same-origin e `event.source === window.parent`, resolve contexto no workspace e responde com ack `APPLIED`, `PARTIAL` ou `CONTEXT_REJECTED`.
- `PhotoDiagnosis` recebe modo/contexto/request de navegação e oferece salvamento explícito do resultado.
- `photo_diagnosis` foi adicionado ao contrato de registros locais/remotos.

### Persistência metadata-only implementada

O resultado só é salvo depois do clique em `Salvar resultado revisado no histórico`. Executar o NutriScan, visualizar o ranking ou continuar a conversa não grava o registro automaticamente.

O tipo `photo_diagnosis` guarda:

- schema/metodologia `nutrition` e nome `NutriScan`;
- contexto de cliente, propriedade, talhão e análise resolvido no workspace;
- cultura, estádio, órgão, dossel, distribuição e observações;
- metadados das fotos: nome, MIME, tamanho e SHA-256;
- resultado estruturado;
- provenance com origem, request de navegação, datas e confirmação `USER_EXPLICIT`;
- safety `ASSISTED_TRIAGE_NOT_PRESCRIPTION` e review humano requerido;
- policy explícita `METADATA_ONLY`, `rawImagesStored=false` e `inlineBinaryStored=false`.

`manual/app/lib/photo-diagnosis-record.ts` sanitiza o registro antes do cache local, import/export e envio. `manual/app/api/records/route.ts` rejeita a requisição se encontrar imagem inline/binário e sanitiza novamente antes do PostgreSQL. O evento Manual → VAL continua removendo foto/imagem/base64/data URL.

### Gaps que permanecem

- A imagem/base64 do NutriScan não é persistida no registro `photo_diagnosis`.
- Salvar o resultado não cria nem atualiza `val_attachments`.
- Não existe vínculo NutriScan → attachment → propriedade/talhão.
- `val_attachments` não tem `property_id` ou `field_id`.
- O banco de imagens VAL e o histórico metadata-only do Manual continuam camadas separadas.

## Contrato de integração

Roteamento, deep-link contextual e persistência metadata-only estão implementados e validados em código. A integração ao banco de imagens continua proposta e não deve ser reportada como concluída.

### Roteamento

Mensagens como “analisa essa deficiência”, “roda o NutriScan” ou uma foto com intenção nutricional devem resolver:

- capability: `NUTRISCAN`;
- methodology: `nutrition`;
- tool/deep-link: adapter para a área `diagnostico` e `/api/diagnosis`;
- reasoning: somente depois do resultado da ferramenta, se material.

Se a intenção entre nutrição e doença estiver ambígua, a VAL deve fazer uma pergunta curta ou oferecer as metodologias; não escolher silenciosamente.

### Contexto

Quando houver contexto autorizado, o comando v1 pode transportar e o Manual precisa revalidar:

- produtor;
- propriedade;
- talhão;
- cultura e safra;
- estádio;
- análise de solo relevante;
- observações confirmadas.

O preenchimento automático precisa ser exibido e editável. O Manual resolve IDs/nomes contra produtores, talhões e análises do workspace; contexto rejeitado aparece no ack e não pode entrar no diagnóstico.

### Persistência e vínculo

- Sem produtor: o usuário ainda pode salvar explicitamente um registro metadata-only sem vínculo; isso não promove memória confirmada.
- Com produtor: o contexto resolvido pode acompanhar o registro, mas a foto não entra automaticamente em `val_attachments`.
- Propriedade/talhão: somente IDs efetivamente resolvidos no workspace entram no payload.
- Resultado: metodologia, versão, data, contexto, output, safety, hashes e confirmação humana são persistidos.
- Base64/binário: rejeitados pela API e removidos por sanitização em todas as fronteiras do registro.
- Integração futura ao banco de imagens deve usar refs/IDs e manter essa proteção; não deve duplicar base64.

## Card na conversa

O card NutriScan deve mostrar, de forma curta:

- `MINHA LEITURA`;
- `O QUE MAIS ME CHAMOU ATENÇÃO`;
- três hipóteses e respectivos escores de compatibilidade;
- `O QUE AINDA FALTA`;
- `PRÓXIMO PASSO`;
- aviso de triagem;
- ações `Ver evidências`, `Abrir diagnóstico completo`, `Vincular` e `Confirmar revisão`, conforme permissão.

Não deve transformar compatibilidade em certeza nem apresentar prescrição.

## Provenance do registro

- `methodology = nutrition`;
- nome `NutriScan`;
- `schemaVersion = manual-photo-diagnosis-v1`;
- `analyzedAt`;
- `savedAt` e confirmação `USER_EXPLICIT`;
- `navigationRequestId`, quando a abertura veio da VAL;
- nome, MIME, tamanho e SHA-256 das evidências, sem a imagem;
- cultura/estádio/órgão/distribuição usados;
- safety e review humano requerido;
- tenant/workspace do registro e contexto autorizado efetivamente resolvido.

Attachment refs não fazem parte do registro atual porque as imagens ainda não entram no banco VAL.

## Testes obrigatórios

- Foto abre captura/upload e aceita somente MIME/tamanho permitidos.
- Uma, duas e três imagens funcionam; quatro falham.
- Intenção NutriScan chama `mode=nutrition`.
- Contexto de produtor/talhão é herdado e exibido.
- Sem clique de salvar, nenhum `photo_diagnosis` é criado.
- Clique explícito salva metadados/hash/contexto/provenance/safety e o resultado.
- Sem produtor, salvamento explícito cria registro sem vínculo e sem memória confirmada.
- Payload com data URL/base64/chave binária recebe erro 400.
- Cache, import/export e leitura sanitizam registros legados ou malformados.
- Resultado contém exatamente três hipóteses.
- Imagem insuficiente reduz conclusão e explica lacunas.
- Nenhum resultado recomenda marca, ingrediente ativo ou dose.
- Cross-client e cross-tenant falham fechados.
- Comando v1 vindo de outra janela, origin ou versão incompatível é ignorado/rejeitado.
- Ack preserva `requestId` e informa `APPLIED`, `PARTIAL` ou `CONTEXT_REJECTED`.
- Erro/timeout/rate limit aparecem como erro, nunca sucesso vazio.
- Mobile/câmera e desktop/upload funcionam.
- Histórico mostra somente registros salvos/revisados daquele escopo.

## Validação executada

- `test/manual-photo-diagnosis.test.js` valida os quatro scans, nome canônico, clique explícito, `photo_diagnosis`, provenance/safety, metadados/hash e ausência de data URL/preview.
- `test/manual-current-capabilities.test.js` valida alias/roteamento NutriScan, contexto do workspace, same-origin/parent e ack.
- Novos testes: 8/8 aprovados.
- Suíte relevante do Manual: 43/43 aprovada.
- `npm run build` do Manual: aprovado.

UAT físico de câmera/upload em dispositivo e ambiente publicado permanece pendente.

## Rollback

Desabilitar o deep-link contextual e manter `diagnostico` acessível no Manual embutido. O tipo `photo_diagnosis` pode permanecer metadata-only; nenhum attachment é criado por esse fluxo. Não apagar resultados já confirmados. Nenhuma migration destrutiva faz parte deste contrato.

## Gate

A metodologia, o safety, a navegação contextual e o histórico metadata-only estão implementados/validados em código. O gate de experiência ainda exige UAT físico. A integração das imagens ao banco VAL permanece gap declarado e não deve ser marcada como aprovada.
