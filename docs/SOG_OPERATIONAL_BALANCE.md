# Saldo operacional mínimo

O saldo é a soma determinística do saldo inicial, entradas e saídas registradas. Não usa projeção de safra, intenção comercial ou cotação como estoque. Não implica conector ERP/CTRM nem contratos/fixações/entregas empresariais completos.

Cada parcela preserva ID, produtor, grão, unidade, tipo, quantidade decimal com até três casas, origem, referência individual e timestamp com fuso. Quantidades são somadas em milésimos inteiros; grãos e unidades não são misturados ou convertidos implicitamente.

O login determina tenant/owner, e a carteira autoriza o produtor na mesma transação que lê/grava. O lock por produtor serializa retries. ID ou par origem/referência repetido com o mesmo conteúdo é idempotente; conteúdo divergente retorna 409. Uma abertura por grão/unidade é exigida. A API é append-only, sem rota de edição ou exclusão de parcelas.

Rotas protegidas: GET `/api/grains/balance?clientId=…`, POST `/api/grains/movements`. A aba Saldo da SOG permite consultar parcelas e registrar movimento com origem. Sem banco protegido disponível, retorna indisponibilidade explícita; não inventa saldo.

Homologação: somente produtores fictícios e origem/referências identificadas como SINTÉTICO. Exemplo: abertura 1000, entrada A 200, entrada B 300, saída C 150, saldo 1350 sc 60 kg. Isso prova a função de reconciliação, não uma posição comercial real.
