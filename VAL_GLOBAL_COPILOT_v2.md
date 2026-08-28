# VAL Global Copilot v2

A VAL pode ser aberta pela barra lateral, cabeçalho, botão central mobile ou `Ctrl/Cmd + K`, sem redirecionar a página atual.

Superfícies: Hoje, Clientes, Produtor 360, Visitas, Oportunidades, Agronomia e mobile. Dentro do Produtor 360, o cliente é implícito; fora dele, a VAL solicita a seleção do produtor antes de usar contexto de conta.

Entradas: texto, voz transitória, foto e arquivo. A fala de pergunta é cancelada após transcrição e não confirma memória. O modo `Registrar informação` usa Voice Capture e exige revisão humana.

Ao trocar o produtor, anexos, erro e conversa visível mudam de thread. A thread usa um `conversation_id` de sessão por produtor; recomendações de outra thread ou conta não entram no carry-over.

A resposta é curta por padrão e oferece camadas de tese, fatos, fontes, segurança e premissas. Perguntas-douradas aparecem somente como pergunta; motivo, lacuna, impacto e referências ficam internos.
