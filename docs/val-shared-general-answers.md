# Continuidade e respostas gerais da VAL

A conversa mantém separação por tenant, usuário, produtor, conversa e época de
contexto. Uma resposta curta de cultura completa somente a última pergunta
agronômica aceita no servidor nesse mesmo escopo. Trocar de produtor, iniciar
outro assunto ou mencionar dados privados impede essa complementação.

A ordem de resposta geral é: definição ou Biblioteca governada; resposta geral
válida no PostgreSQL; IA configurada quando falta cobertura. A resposta da IA
passa pela validação de relevância, escopo e restrições técnicas. Uma falha admite
uma reformulação; saída rejeitada não entra no cache. Doses, prescrições, fatos
individuais e dados atuais continuam exigindo as fontes e ferramentas adequadas.

`val_shared_knowledge_answers` contém apenas texto de explicação geral, modelo,
hashes da pergunta e resposta, revisão da política, origem e validade. Não contém
pergunta original, nomes, produtor, tenant, usuário, conversa ou transcrição.
Não é memória confirmada nem fonte para ContextSnapshot, Grãos, Crédito ou NBA.
O compartilhamento admite somente perguntas públicas reconhecidas pelo
vocabulário conservador, sem dados de caso, nomes desconhecidos ou conteúdo DEMO.
Perguntas fora dessa política ainda podem usar IA, mas não publicam conteúdo no
cache compartilhado.

O prazo máximo é de sete dias. Mudanças de modelo, política ou Biblioteca
invalidam a chave; expiração, hash divergente, origem alterada ou falha na
validação descartam a linha. O cache não promove uma explicação a fato:
`UNVERIFIED_MODEL_KNOWLEDGE` e a indicação visível de ausência de fonte verificada
permanecem tanto na geração quanto no reaproveitamento. Cada usuário recebe um
envelope novo no próprio escopo. Leituras repetidas contabilizam zero chamadas
de geração. Requisições simultâneas ao mesmo processo compartilham a geração.

Se o banco falhar, a VAL continua pelo caminho de geração permitido; a gravação
do cache é opcional para a entrega. Sem IA ou sem resposta validável, mantém
ausência de dados explícita. A migração 011 é somente expansiva e não altera
cadastros de produtores. A voz consulta a mesma ferramenta do chat para dúvidas
gerais e deve conservar os indicadores de origem.
