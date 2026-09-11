# VAL — preparação de visita com contexto persistido

Data: 11/09/2026.
Base do staging: `1ad10b95a1bbf07be5ffa91eb084b428b8611e9a`.
Branch: `fix/val-visit-context-reasoning-v1`.
Destino: `claude/continuacao-correcao-val-wiogh7` / `val-web-staging`.
Produção/main: `f405617405fb66811207fdf006c2fbdaebfb8c9d`, preservada.
PR #95/referência congelada: `5848574f24c4ddbe628b125856d54d9500f7fce9`, preservada.

## Causa reproduzida

O pedido “Me prepare para a próxima visita” em uma conversa nova recuperava a visita, mas o seletor removia seu relato e próximo compromisso. A projeção para o modelo também descartava oportunidades já selecionadas para VISIT. Dois roteadores impunham resposta determinística à preparação curta, impedindo síntese por IA. A validação final descartava a resposta composta e podia voltar à mensagem genérica de evidência insuficiente, mesmo com registros válidos.

## Correção

- Preparação mantém o conteúdo dos eventos autorizados, e perguntas apenas sobre identidade/data continuam com seleção mínima.
- Preparação curta habilita síntese por IA com instruções para cruzar relato, compromisso, prazo, mudança e próximo avanço. Os limites de execução e os controles de acesso permanecem ativos.
- Evidência de visita/interação/compromisso entra diretamente do snapshot selecionado. O pacote prioriza próximos passos e trechos de compromisso no fim de relatos longos, com tamanho limitado e referências de origem.
- Quando a síntese falha na validação ou o provedor está indisponível, uma preparação recuperável usa os registros que passaram individualmente no grounding, identifica o próximo passo registrado e orienta a retomada. O método fixo é classificado como STRATEGY; não constitui fato do produtor nem pode apoiar uma compra inventada.
- A relevância da preparação considera histórico e próximo passo, sem exigir repetição literal de “próxima”. Validação de fatos, proveniência, escopo e segurança técnica continua obrigatória.
- A entrevista considera relatos de visitas e interações antes de perguntar por dados que já foram informados.

## Validação

- `npm test`: **1804/1804 PASS**, zero falhas e zero testes ignorados.
- `npm run build`: PASS, incluindo preparação e verificação do PWA.
- `git diff --check`: PASS.
- Regressão HTTP sem chave de IA: conversa nova recupera relato e combinado, ação cita o próximo passo, outro produtor não recebe esse conteúdo, conta vazia não recebe fatos inventados, e alteração do registro aparece na consulta seguinte.
- Testes de seleção mínima, produtor/tenant/owner, relato longo e método que não pode sustentar fatos inventados.

## Limites

O caso foi reproduzido com registros sintéticos em servidor real de teste. Não houve leitura da conta autenticada do produtor citado pelo usuário nem chamada paga ao modelo nesta sessão; a qualidade de uma resposta real do provedor continua sujeita a validação de uso. Nenhuma migração, alteração de credenciais ou gravação em dados de produtores reais foi realizada.
