# Fase D — inovação responsável em conversão

Esta documentação acompanha as entregas visíveis da Fase D. Cada item é implementado em uma PR independente e mantém as regras universais da VAL: evidência rastreável, ausência de números inventados, revisão humana para conteúdo agronômico acionável e proibição de persuasão manipulativa.

## D1 — Radar de conversão proativo

### Proposta aprovada

Gerar, para cada carteira autenticada, uma lista diária de até cinco contas que merecem atenção. O radar usa somente dados já registrados: oportunidade aberta, etapa, próxima ação, prazo, visita futura, necessidade declarada e potencial comercial cadastrado.

A primeira versão não cria contatos, tarefas, oportunidades nem alterações no CRM. Ela apenas ordena os sinais e abre a conta escolhida para o consultor decidir.

### Contrato

O resultado contém:

- versão e horário de geração;
- quantidade de contas avaliadas;
- no máximo cinco itens;
- produtor, score operacional e prioridade;
- motivo textual derivado dos registros;
- próxima ação;
- oportunidade selecionada, quando existir;
- campos ausentes;
- evidências com fonte, identificador, data, qualidade e incerteza;
- política explícita de que não houve IA generativa, contato automático ou escrita automática.

### Dados utilizados

Permitidos:

- identificação da conta;
- oportunidade aberta, etapa, valor registrado, ação e prazo;
- visita futura e objetivo registrado;
- necessidade comercial declarada;
- potencial em aberto confirmado no cadastro.

Não utilizados:

- família, hobbies, time, preferências pessoais ou datas pessoais;
- dados financeiros pessoais;
- texto livre como gatilho de medo, culpa, vergonha ou falsa urgência;
- qualquer inferência de intenção não registrada.

### Regra de prioridade

O score combina etapa da oportunidade, prazo real, atualização, ação registrada, evidência, visita futura e potencial cadastrado. O score serve apenas para ordenar trabalho e nunca é apresentado como probabilidade de fechamento.

Prazo vencido só gera urgência quando existe uma data persistida. A ausência de data vira lacuna, não urgência fabricada.

### Experiência visível

O Dashboard passa a mostrar **Radar de conversão • Hoje**, com:

- até cinco cartões;
- prioridade e score;
- motivo baseado em registros;
- oportunidade e valor, quando conhecidos;
- próxima ação;
- quantidade de evidências;
- botões para abrir a conta e preparar a conversa.

O estado vazio explica quais dados precisam ser registrados e não preenche a lista com motivos genéricos.

### Execução

`server/portfolio-radar-bootstrap.js` acrescenta o radar à resposta protegida de `/api/intelligence`. O mesmo algoritmo puro é usado pela interface para manter a experiência imediata e testável. A implementação é determinística e continua funcionando sem OpenAI.
