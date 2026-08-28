# VAL Market & Commodity Access v1

> **Status da entrega:** contrato candidato em validação exclusiva no staging. Não autoriza produção, merge em `main` nem Passo 07.

## Escopo

Mercado e commodities continuam disponíveis como módulo navegável e passam a ser consultáveis pelo Copilot.

Esta versão reutiliza referências do workspace SOG/Grãos registradas por usuário autorizado. Ela não adiciona feed externo, scraping, assinatura ou recurso pago.

## Dado mínimo

Uma referência elegível contém:

- commodity;
- preço e unidade;
- praça/região;
- tipo de mercado;
- fonte identificada;
- tipo e URL da fonte, quando disponível;
- `observedAt`;
- confidence;
- status ativo.

Preço sem fonte ou data não entra na resposta atual.

Fonte e data/hora precisam aparecer no texto principal e no `voice_output.speakable_text`, além de `source`, `facts_used` e demais metadados. Proveniência escondida em uma camada técnica não basta para apresentar um número como atual.

## Freshness

Classificação determinística atual:

- `CURRENT`: até 24 horas;
- `DATED`: mais de 24 horas e até 168 horas;
- `STALE`: mais de 168 horas;
- `UNKNOWN`: data inválida ou ausente;
- `UNAVAILABLE`: nenhuma referência elegível.

Uma referência `DATED` ou `STALE` pode ser mostrada como histórico, com aviso explícito. Ela não pode ser chamada de preço “de hoje”.

## Consulta sem produtor

“Qual a última cotação de soja?” usa `LIVE_DATA` e pode responder sem selecionar conta, sempre com fonte e data.

Sem commodity explícita, a resposta diz que se trata da referência mais recente **entre as referências autorizadas registradas**. Ela não sugere que o item seja a cotação mais recente de todo o mercado.

A resposta inclui:

- valor/unidade;
- praça;
- fonte;
- data/hora;
- freshness;
- variação somente contra referência comparável da mesma carteira.

Se não houver referência autorizada, a VAL diz que não encontrou e orienta abrir Mercado para registrar/atualizar a fonte.

## Cruzamento com produtor

“Isso muda a conversa com João?” exige DEEP e contexto explícito. O raciocínio pode cruzar:

- preço-alvo;
- intenção e volume confirmados;
- janela de entrega;
- praça/frete;
- oportunidade;
- histórico comercial;
- compromissos.

A cotação não confirma intenção, volume ou decisão do produtor.

Respostas da Decision Interview sobre preço-alvo, volume, janela ou praça permanecem no mesmo produtor e conversa até REGISTER revisado e confirmado. Só depois a solicitação seguinte recompõe as premissas a partir da memória confirmada.

## Proveniência

`source` contém ID, nome, URL opcional, `observed_at`, região e freshness. `facts_used` mantém a referência separada de memória do produtor.

No envelope de execução, `MARKET_COMMODITY` pode aparecer em `capabilities_planned` quando selecionado pelo router. Ele só aparece em `capabilities_used` quando a consulta autorizada foi de fato executada e contribuiu para a resposta; `capability_results` registra sucesso, indisponibilidade ou falha. Capacidade planejada não é fonte.

## Segurança comercial

- nenhuma operação automática;
- nenhuma recomendação de compra/venda como fato inevitável;
- diferença de preço não autoriza desconto;
- dados de uma carteira não atravessam owner/tenant;
- número sem unidade não é comparado;
- regiões/unidades incompatíveis exigem ressalva ou normalização explícita.

## Limites

- “atual” significa atual segundo a referência registrada, não visão total do mercado;
- ausência de feed live deve ser visível;
- notícias e clima exigem adapters próprios e não estão implicitamente cobertos pela cotação SOG;
- fonte cadastrada pelo usuário continua sujeita à confidence e validação da organização.

## Testes

- roteamento market/commodity;
- consulta sem produtor;
- fonte/data obrigatórias;
- CURRENT/DATED/STALE/UNKNOWN/UNAVAILABLE;
- seleção da referência mais recente elegível;
- variação comparável;
- cruzamento com produtor muda para DEEP;
- source e observed_at chegam à resposta;
- fonte e data/hora aparecem no texto principal e no texto falável;
- planned/used/results não tratam adapter indisponível como fonte consultada;
- isolamento por owner/tenant;
- dado antigo nunca aparece como “hoje”.
