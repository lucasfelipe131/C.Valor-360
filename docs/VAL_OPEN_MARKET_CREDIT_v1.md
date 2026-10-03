# VAL SOG, mercado brasileiro e VAL CRED

A VAL SOG é a base principal de mercado do Copilot e do workspace de grãos. Registros da carteira autenticada, com fonte e data válidas, têm prioridade dentro da janela de atualidade de sete dias. Referências simuladas/sintéticas são identificadas e excluídas das respostas e oportunidades. Registros históricos mantêm a data original e a ressalva de idade.

O complemento público é brasileiro: DERAL/SEAB-PR, https://celepar7.pr.gov.br/sima/cotdiat.asp . O conector consulta a média estadual de compra pelo mercado atacadista de soja industrial tipo 1, milho amarelo tipo 1 e trigo pão PH 78, em BRL/saca de 60 kg. A média estadual não é oferta ao produtor nem cotação de São Luiz Gonzaga/RS ou de outra praça. Uma pergunta com praça explícita nunca recebe outra praça como substituição. Fonte e dia do boletim aparecem no Copilot e na SOG, sem inventar horário intradiário.

A consulta usa cache de 15 minutos, limite de 1 MB e seis segundos, sem enviar informações de produtores à fonte pública. O parser recusa mudanças no cabeçalho, no número de colunas, datas inválidas/futuras e médias ausentes. Falhas conservam o último boletim com sua data original. Não há coleta CEPEA nem feed americano como base padrão.

O servidor usa VAL_CRED_BASE_URL e VAL_CRED_TOKEN; o DCREDC149 usa VAL_BRIDGE_TOKEN e VAL_BRIDGE_TENANT_ID. O token dedicado atende /api/integrations/val/* e nunca vai para o navegador. A conexão preserva o contrato /api/v1/integrations/val/* e o resumo de crédito previamente existente.

Antes de consultar crédito, a VAL verifica o produtor na carteira autenticada. Um administrador verifica o vínculo na aba Crédito com ID e CPF/CNPJ do cadastro de crédito; ambos precisam corresponder. O vínculo é isolado por tenant, carteira e produtor, revogável e auditado. Não há associação por nome. Removê-lo não apaga solicitações. A consulta da aba usa GET /api/clients/:id/credit/context; link/unlink exigem administrador. O endpoint de resumo /credit permanece compatível com a integração anterior.

A integração lê até 20 solicitações vinculadas. Decisões só aparecem quando pertencem à revisão vigente. Perguntas específicas de crédito no Copilot consultam o mesmo vínculo e apresentam valor solicitado, estado registrado e datas; não aprovam crédito nem presumem recursos liberados.

Validação: amostra oficial DERAL de 02/10/2026, médias/colunas/data, cache e falhas, isolamento de carteira, prioridade VAL SOG, exclusão de simulações, praça explícita e evidência independente por grão; teste PostgreSQL em memória do vínculo, token, documento, revogação e revisão.
