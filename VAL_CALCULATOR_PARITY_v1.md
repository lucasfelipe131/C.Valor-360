# VAL Calculator Parity v1

## Objetivo

Comparar a versão atual das calculadoras do Manual do Agrônomo com a experiência VAL e definir a ação necessária sem duplicar motores.

## Baseline

- Fonte funcional: `manual/app/page.tsx`.
- Componentes especializados: `manual/app/NutrientRemovalCalculator.tsx`, `manual/app/ZarcPlanner.tsx` e `manual/app/agronomy-planning.ts`.
- Roteamento VAL: `server/decision-copilot/capability-router.js`.
- Executor inicial: `server/decision-copilot/capability-executor.js`.
- Protocolo contextual: `manual/app/valor360-navigation.ts`.
- Card atual: `src/components/copilot/DecisionCards.jsx`.
- Acesso atual pela Inteligência Agronômica: `src/pages/Agro.jsx`.

## Resultado de paridade

O Manual possui nove calculadoras funcionais. A VAL preserva acesso a todas por drill-down para o Manual embutido. O Copilot reconhece `CALCULATE`, usa `TOOL PATH` e solicita `CALCULATORS`. O executor em implementação calcula custo/ha quando custo total e área estão explícitos, pede os inputs ausentes e devolve um descritor de ferramenta. O protocolo `valor360:navigate` v1 abre a calculadora canônica solicitada, resolve contexto no workspace e retorna ack.

Esse adapter inicial não executa os nove motores do Manual dentro do chat. O resultado de custo/ha é uma capacidade determinística adicional e não prova paridade numérica com cada uma das nove calculadoras.

Portanto:

- **paridade de acesso:** existente, com protocolo contextual v1 implementado/validado em código;
- **execução no Copilot:** parcial para custo/ha;
- **paridade dos nove motores:** ainda ausente;
- **ação correta:** ampliar adapters/tools sobre os motores atuais, não criar reimplementação paralela.

## Matriz Manual × VAL

| Calculadora | Versão Manual atual | Versão VAL atual | Diferença | Ação |
|---|---|---|---|---|
| Regulagem de semeadora (`semeadora`) | População, sementes por metro, germinação, sobrevivência, patinagem, teste de coleta, voltas e sacos | `CALCULATE` roteia; protocolo v1 abre `semeadora` | Não calcula esse motor no chat | Expor função atual por adapter validado |
| População ideal (`populacao`) | Cultura, cultivar, local, ambiente produtivo, yield gap, germinação, emergência e espaçamento | Drill-down | Sem execução/resultado estruturado | Reusar `recommendPlantPopulation` e catálogo atual |
| Demanda de sementes (`sementes`) | Área, margem técnica, quantidade e embalagens | Drill-down | Sem execução no Copilot | Adapter determinístico com unidades explícitas |
| Previsão de colheita (`colheita`) | Data de plantio, cultivar, ciclo/GMR, região e janela estimada; cenário hídrico de milho | Drill-down | Sem execução no Copilot | Reusar `estimateRegionalHarvest`; não inferir dados faltantes |
| Zoneamento ZARC (`zoneamento`) | Consulta oficial por município, solo, ciclo e risco; fonte MAPA 2026/27 e fallback 2025/26 no código | Drill-down | Sem consulta in-chat | Adapter para `/api/zarc` com fonte, safra, data e fallback visíveis |
| Pulverização (`pulverizacao`) | Volume de calda, tanques e quantidade de produto; recomendação exportável | Drill-down | Sem execução no Copilot | Tool determinística; manter revisão, dose/unidade e safety |
| Fertilizantes (`fertilizante`) | Dose, área, preço, eficiência, total, sacaria, custo e comparação de até quatro fórmulas | Drill-down | Sem execução no Copilot | Adapter para motor/catálogo atual; declarar hipóteses e fontes |
| Extração e exportação (`reposicao`) | Cultura, produtividade, demanda de nutrientes, solo opcional e comparação de fórmulas | Drill-down | Sem execução no Copilot | Reusar `NutrientRemovalCalculator`; não tratar como prescrição |
| Cotação de insumos (`cotacao`) | Produtos, desconto por item, pagamento/vencimento e PDF | VAL possui ROI/value scenarios separado, além do drill-down | ROI VAL não equivale à cotação do Manual | Manter ambas e rotear pelo objetivo correto |

## Grupos reais do Manual

| Grupo | Calculadoras |
|---|---|
| Plantabilidade | Regulagem de semeadora, População ideal, Demanda de sementes, Previsão de colheita, Zoneamento ZARC |
| Pulverização | Pulverização |
| Fertilizantes | Fertilizantes, Extração e exportação |
| Custos | Cotação de insumos |

## Catálogos encontrados

| Catálogo | Quantidade no baseline | Arquivo |
|---|---:|---|
| Fórmulas de fertilizantes | 99 | `manual/app/fertilizer-formulas.json` |
| Agrofit | 1.632 | `manual/app/agrofit-products.json` |
| Defensivos comerciais | 209 | `manual/app/commercial-agrochemicals.json` |
| Produtos foliares | 296 | `manual/app/foliar-products.json` |
| Cultivares de soja | 26 | `manual/app/cultivars.json` |
| Cultivares de milho | 29 | `manual/app/cultivars.json` |
| Cultivares de trigo | 25 | `manual/app/cultivars.json` |
| Cultivares de canola | 13 | `manual/app/cultivars.json` |

Alguns itens de catálogo possuem fonte vazia, e os JSONs não apresentam uma versão global homogênea. A VAL deve exibir fonte/vigência somente quando elas existirem e forem verificadas; quantidade no arquivo não comprova atualidade oficial.

## Persistência atual

O Manual possui `saveRecord` local + remoto. Os tipos incluem:

- `calculator`;
- `quote`;
- `spray_recommendation`;
- `fertilizer_comparison`.

O resultado salvo é owner-scoped e sincronizado com `/api/records`. Erro ou integração não configurada não é reportado como sincronização concluída.

O fato de uma calculadora produzir resultado não autoriza gravação automática em memória. Dentro do Copilot, calcular é `ASK`/tool result; registrar ou anexar ao histórico exige ação humana correspondente.

## Protocolo de abertura contextual v1

O comando `valor360:navigate` versão 1 suporta:

- aliases `calculator`, `calculators`, `calculate`, `calculadoras` e `calcular`;
- `calculator`/`calculatorKey` com um dos nove IDs canônicos;
- `requestId`;
- contexto opcional de cliente, propriedade, talhão e análise.

O Manual recebe o comando somente no modo embedded, com same-origin e `event.source === window.parent`. Cliente/talhão/análise são resolvidos no workspace antes da aplicação. O ack `valor360:navigation-result` devolve o mesmo `requestId`, calculadora aplicada, contexto resolvido, issues e status `APPLIED`, `PARTIAL` ou `CONTEXT_REJECTED`.

O protocolo seleciona a UI correta; ele não calcula os inputs nem substitui o adapter numérico.

## Contrato de adapter

O descritor `CALCULATORS`, a validação de inputs e o cálculo de custo/ha estão em implementação. O contrato abaixo define a ampliação necessária para os nove motores.

### Request

- `calculator_id` canônico;
- `tenant_id` e `actor_id` resolvidos pelo servidor;
- `client_id`, `property_id` e `field_id` opcionais, todos validados;
- inputs nomeados;
- valores e unidades separados;
- safra/local/data de referência quando relevantes;
- modo `preview` por padrão.

### Response

- valores calculados e unidades;
- inputs efetivamente usados;
- hipóteses/defaults;
- dados faltantes que podem mudar a decisão;
- warnings e limites;
- versão do motor/calculadora;
- fontes e vigência quando a ferramenta usar dados externos;
- ação de abrir a calculadora completa;
- token/ref de resultado, nunca persistência silenciosa.

### Regras

1. Tool primeiro; reasoning depois, se material.
2. Cálculo determinístico não deve ser refeito pelo modelo em texto.
3. Unidade ausente ou ambígua gera pergunta curta.
4. Não inventar cultivar, área, dose, preço, eficiência ou fonte.
5. ZARC e outros dados atuais mostram safra, data, fonte e eventual fallback.
6. Resultado de pulverização/fertilidade não substitui bula, prescrição ou responsável técnico.
7. Persistência e exportação exigem comando/ação humana.
8. Tenant e permissões são validados fora do modelo.

## Renderização no Copilot

O resultado deve usar um card de cálculo com:

- conclusão curta;
- valores principais e unidades;
- inputs usados;
- hipóteses/lacunas;
- aviso técnico aplicável;
- `Ver números`;
- `Editar entradas`;
- `Abrir calculadora completa`;
- `Registrar`, somente quando permitido.

O `CalculationCard` atual é genérico e abre a área agronômica. O executor pode devolver custo/ha e required inputs, mas ainda não representa a execução das nove ferramentas.

## FAST/TOOL/DEEP path

- Cálculo com entradas completas: `TOOL PATH`, sem carregar a engine completa.
- Entrada faltante material: pergunta de 1–3 itens.
- Interpretação do resultado no contexto do produtor: tool result + `CONTEXT PATH` ou `DEEP PATH`, somente se puder mudar a recomendação.
- Consulta ZARC/dado atual: `TOOL PATH` + fonte live/oficial.

## Testes existentes

`test/agronomy-planning.test.js` cobre:

- regionalização;
- decomposição da previsão de colheita;
- recomendação de população;
- guard de yield gap;
- presença das nove calculadoras e agrupamento.

Esses testes validam parte dos motores e o contrato estático, não a execução pelo Copilot.

`test/manual-current-capabilities.test.js` valida o protocolo v1 para calculadoras, seleção de `fertilizante`, aliases, rejeição de versão incompatível, same-origin/parent, ack e preservação das nove ferramentas. Esse teste integrou o conjunto novo 8/8; a suíte relevante do Manual passou em 43/43 e o build do Manual foi aprovado.

## Testes adicionais para paridade no Copilot

- Cada `calculator_id` chega ao motor correto.
- Comando v1 seleciona a calculadora canônica e preserva `requestId` no ack.
- Mensagem de mesma origem enviada por janela diferente de `window.parent` é ignorada.
- Contexto inexistente no workspace retorna `PARTIAL`/`CONTEXT_REJECTED`, não sucesso falso.
- Custo total + área calculam custo/ha; falta de qualquer input retorna `INPUT_REQUIRED`.
- Inputs/unidades completos produzem o mesmo resultado da UI do Manual.
- Unidade ambígua pergunta, não assume.
- Alterar uma entrada altera o resultado de forma determinística.
- Resultado não é persistido em `ASK`.
- Registro/export exige confirmação e preserva owner/tenant.
- ZARC mostra fonte, safra e fallback real.
- Falha da fonte atual não retorna dados antigos como atuais.
- Cotação do Manual e ROI da VAL não são confundidos.
- Cross-tenant/cross-client falha fechado.
- Safety de dose, mistura, compatibilidade e prescrição permanece.
- Card abre o módulo tradicional no mesmo contexto.
- Mobile e desktop funcionam.

## Rollback

Desabilitar o executor/deep-link contextual e conservar o acesso simples a `/tecnico?embedded=1&page=calculadoras`. Não remover calculadoras, registros existentes ou catálogos. Nenhuma migration destrutiva é necessária para essa estratégia.

## Gate de paridade

| Item | Baseline |
|---|---|
| Nove calculadoras presentes no Manual | Aprovado |
| Acesso pela VAL | Aprovado via Manual embutido |
| Roteamento `CALCULATE` / `TOOL PATH` | Em implementação |
| Protocolo contextual v1 + ack | Implementado/validado em código |
| Execução de custo/ha | Em implementação |
| Execução dos nove motores | Pendente |
| Resultado estruturado no chat | Parcial para custo/ha; pendente para os nove motores |
| Igualdade numérica Manual/adapter | Pendente de implementação/teste |
| Safety/tenancy do fluxo atual | Preservados; precisam ser revalidados no adapter |

A paridade total não deve ser declarada enquanto os nove motores não forem executados pelos adapters e comparados numericamente com o Manual. Deep-link contextual validado e custo/ha isolado não bastam para esse gate. UAT físico/mobile do deep-link no staging também permanece pendente.
