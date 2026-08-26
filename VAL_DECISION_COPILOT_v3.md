# VAL Decision Copilot v3

> **Status da entrega:** contrato candidato em validação exclusiva no staging. Este documento não autoriza deploy em produção, merge em `main` nem início do Passo 07.

## Objetivo

O VAL Decision Copilot é uma camada de orquestração sobre as capacidades existentes da plataforma. Ele reduz a distância entre uma dúvida e a função adequada sem substituir Clientes, Visitas, Oportunidades, Inteligência Agronômica, Mercado, relatórios, calculadoras, bulas, Manual ou Biblioteca.

Duas experiências permanecem válidas:

1. quem sabe onde quer ir navega diretamente ao módulo;
2. quem sabe o que precisa resolver pergunta ou fala com a VAL.

Este documento é normativo para a v3. A aprovação de cada item depende do gate e dos testes; a existência deste documento não comprova conclusão operacional.

## Princípios

- A IA pensa; a VAL governa; o humano decide.
- A seleção de tenant, ator, escopo e permissão acontece antes do raciocínio.
- ASK não promove conversa a memória.
- REGISTER e POST_VISIT exigem revisão e confirmação.
- Informação atual exige fonte e data; ausência de fonte produz indisponibilidade, não invenção.
- Safety determinístico prevalece sobre fluência, score e tentativa de recomposição.
- A resposta deve depender daquele produtor e daquele momento.
- Módulos continuam visíveis e acessíveis fora do chat.

## Pipeline canônico

```text
input
  -> Intent Router v2
  -> autorização / tenancy
  -> System Capability Router v1
  -> FAST ou DEEP
  -> execução dos adapters autorizados + resultado por capacidade
  -> contexto confirmado + contexto da sessão
  -> memória / histórico / agronomia / conhecimento / dados atuais
  -> síntese, quando necessária
  -> Decision Interview, quando falta dado material
  -> quality + safety
  -> resposta em texto e, por opção do usuário, áudio local
```

O `System Capability Router` escolhe capacidades, não permissões. Cada adapter continua responsável por validar escopo e falhar fechado.

## Contrato de resposta

`AIReasoningResult v1` continua sendo o envelope auditável. A v3 acrescenta, sem remover campos anteriores:

- `run.path`: `FAST` ou `DEEP`;
- `run.capabilities_planned`: capacidades selecionadas pelo router;
- `run.capabilities_used`: somente capacidades efetivamente executadas e usadas na resposta;
- `run.capability_results`: resultado auditável de cada execução, inclusive indisponibilidade ou falha;
- `run.latency_breakdown`;
- `premises.session_context` separado de memória confirmada;
- `premises.current_data`;
- `reasoning_confidence`;
- `decision_interview`;
- `voice_output`, sempre com `persistence: NONE`.

`capabilities_planned` não comprova consulta. A UI, a telemetria e o texto de progresso só podem afirmar que uma fonte ou módulo foi consultado quando isso estiver sustentado por `capabilities_used` e pelo respectivo `capability_results`.

## Premissas por produtor

Cada solicitação recompõe as premissas com o snapshot autorizado, perfil, histórico, oportunidades, dados agronômicos e memória confirmada do produtor selecionado. Somente fatos/memórias em estado confirmado ou verificado podem sustentar premissas permanentes. Hipóteses, propostas e respostas anteriores da conversa podem ajudar a continuidade da sessão, mas não se tornam fatos permanentes sem REGISTER revisado e confirmado.

Depois de um REGISTER confirmado, a solicitação seguinte recupera novamente o snapshot e recompõe as premissas. Até essa confirmação, a resposta da Decision Interview permanece limitada ao mesmo `conversation_id` e produtor.

Por isso, a mesma pergunta pode produzir teses diferentes para produtores diferentes. Trocar apenas o nome sem alterar contexto não é personalização suficiente.

## Formas de acesso

- Home, Produtor 360, Oportunidades, Visitas e Inteligência Agronômica podem abrir o Copilot.
- Desktop usa painel lateral sem abandonar a página.
- Mobile usa sheet/tela cheia com VAL como ação central.
- Texto, voz, foto e arquivo são entradas complementares.
- A resposta mostra leitura e próximo passo primeiro; evidências, números e agronomia ficam em profundidade progressiva.

## Limites honestos desta versão

- Voz de saída usa Web Speech do navegador. A reprodução não envia uma requisição de TTS ao backend da VAL, mas o navegador ou sistema operacional pode usar rede conforme seu próprio serviço de voz. Não há garantia de processamento exclusivamente local nem de uma voz específica instalada.
- Mercado usa referências autorizadas já registradas na carteira. Não há feed externo novo ou recurso pago incluído nesta entrega.
- Em mercado, fonte e data/hora aparecem no texto principal e no texto falável; metadata isolada não basta para tratar um valor como atual.
- FAST reduz trabalho computacional por contrato, mas redução de latência só pode ser aprovada após medição comparativa em staging.
- O workspace técnico preserva o Manual como capacidade; a experiência headless não transforma conteúdo técnico em memória ou prescrição.
- Decision Interview usa regras determinísticas e sinais de confiança; ele não substitui confirmação humana.

## Não objetivos

- decidir permissão por IA;
- executar compra, venda, aplicação, dose ou mistura;
- esconder módulos atrás do chat;
- promover LearningCandidate ou conversa a conhecimento aprovado;
- criar outro cérebro, produto ou identidade paralela;
- alterar produção, `main`, secrets ou iniciar Passo 07.

## Evidência mínima de conclusão

A v3 só pode ser considerada concluída com a matriz obrigatória de 30 testes, os 24 critérios do gate, builds principal e Manual, CI, staging autenticado, medição FAST/DEEP e UAT mobile físico para voz/câmera/áudio.
