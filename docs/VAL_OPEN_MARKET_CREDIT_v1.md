# Mercado aberto e integração VAL CRED

A SOG e o Copilot compartilham referências públicas do boletim diário USDA AMS Iowa (https://www.ams.usda.gov/mnreports/ams_2850.pdf). A consulta é realizada no servidor, com cache de 15 minutos, limite de tamanho e tempo. Não envia dados de produtores à fonte pública. Preserva mercado disponível/futuro, praça dos EUA, USD/bushel, mês do contrato e data de publicação. O relatório diário não informa horário intradiário. As referências internacionais não são ofertas brasileiras nem entram em comparações com intenções em BRL/saca. Registros locais continuam com seus dados originais. CEPEA não é coletado.

Falhas mantêm a data original do último boletim disponível e mostram a idade da referência. Dados sintéticos ou antigos nunca recebem a data da consulta como data da cotação. O Banco Central SGS 10813 é uma consulta opcional de câmbio; falha não cria uma taxa nem altera o preço USDA.

O servidor usa VAL_CRED_BASE_URL e VAL_CRED_TOKEN; o DCREDC149 usa VAL_BRIDGE_TOKEN e VAL_BRIDGE_TENANT_ID. O token dedicado só atende /api/integrations/val/* e nunca vai para o navegador. A conexão não usa a senha administrativa do DCREDC149.

Antes de consultar crédito, a VAL verifica se o produtor pertence à carteira autenticada. Um administrador verifica o vínculo na aba Crédito usando o ID e CPF/CNPJ do cadastro de crédito; os dois identificadores precisam corresponder. O vínculo é isolado por tenant, carteira e produtor, pode ser revogado e gera auditoria. Nenhum vínculo é criado por semelhança de nome. Remover um vínculo não apaga solicitações de crédito.

A integração consulta até 20 solicitações do cadastro vinculado. Análise e decisão só são expostas se a análise pertence à revisão vigente da solicitação. A VAL apresenta estado registrado, valor solicitado e datas. Não aprova crédito, não altera solicitações e não presume disponibilidade de recursos. Perguntas específicas de crédito no Copilot seguem o mesmo vínculo e contrato de evidências.

Validação: testes do parser USDA, falhas/cache, isolamento de carteira, unidades/moedas, evidência independente por grão; teste PostgreSQL em memória do token, vínculo/documento, revogação e revisão da análise. A conexão sem vínculo retorna NOT_LINKED, não uma dívida ou limite presumido.
