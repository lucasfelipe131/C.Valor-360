# VAL Calculator Parity v1

## Resultado

As nove calculadoras atuais usam o contrato compartilhado `AgronomicCalculatorAdapter.v1`. O Manual chama diretamente as funções canônicas em `src/lib/agronomic-calculators.js`; o Copilot reconhece a intenção, extrai somente entradas explícitas e chama `executeAgronomicCalculator` por `server/agronomic-calculator-adapter.js`. A matemática não é reproduzida no prompt nem pelo modelo.

O ZARC é a única calculadora dependente de fonte atual. Manual e Copilot chamam `consultZarc`, em `server/zarc-provider.js`, que preserva a fonte pública oficial MAPA, safra, horário da consulta, dataset usado, cache de seis horas e falha fechada. Nenhum provider ou segredo novo foi criado.

Status técnico em código e teste: **PASS nas 9/9 calculadoras**. Publicação da branch, CI remoto e UAT físico continuam sendo gates separados.

## Matriz obrigatória

| CALCULADORA | IMPLEMENTAÇÃO CANÔNICA | ACESSO DIRETO | ACESSO COPILOT | INPUTS | OUTPUTS | PARIDADE | TESTE |
|---|---|---|---|---|---|---|---|
| Regulagem de semeadora (`semeadora`) | `calculatePlanter` | Manual / Calculadoras | `CALCULATE → TOOL → CALCULATORS` | população, espaçamento, germinação, sobrevivência, patinagem, embalagem, distância/linhas de teste, roda | plantas/m, sementes/m e /ha, distância, embalagens, sementes no teste, voltas | PASS | comparação direta/Copilot |
| População ideal (`populacao`) | `recommendPlantPopulation` em `src/lib/agronomic-planning.js` | Manual / Calculadoras | mesmo adapter canônico | cultura, cultivar/ciclo, data, município/UF, ambiente, yield gap, germinação, emergência, espaçamento | faixa/alvo de plantas, sementes/ha e /m, estabelecimento, warnings e premissas | PASS | comparação direta/Copilot + testes regionais |
| Demanda de sementes (`sementes`) | `calculateSeedDemand` | Manual / Calculadoras | mesmo adapter canônico | área, população de semeadura, margem, sementes/embalagem | sementes necessárias e embalagens | PASS | comparação direta/Copilot |
| Previsão de colheita (`colheita`) | `estimateRegionalHarvest` em `src/lib/agronomic-planning.js` | Manual / Calculadoras | mesmo adapter canônico | cultura, cultivar/ciclo/faixa, plantio, município/UF, latitude opcional, ajuste de colheita | data central, janela, ciclo decomposto, fonte da premissa e warnings | PASS | comparação direta/Copilot + testes regionais |
| Zoneamento ZARC (`zoneamento`) | `consultZarc` / `val.zarc_provider.v1` | Manual `/api/zarc` | mesmo provider canônico | cultura/safra, UF, município, classe de solo/AD, grupo de ciclo | janelas 20/30/40%, decêndios, portaria, safra, fonte, timestamp e dataset | PASS | provider sintético, igualdade e falha fechada |
| Pulverização (`pulverizacao`) | `calculateSpraying` | Manual / Calculadoras | mesmo adapter canônico | área, volume de calda, tanque, produto/dose/unidade opcional | calda total, tanques, área/tanque e total por produto | PASS | comparação direta/Copilot |
| Fertilizantes (`fertilizante`) | `calculateFertilizer` | Manual / Calculadoras | mesmo adapter canônico | área, dose kg/ha, embalagem, preço/unidade, eficiência, garantias | nutrientes kg/ha, pontos NPK, pontos ajustados, custo/ha, total e embalagens | PASS | comparação direta/Copilot |
| Extração e exportação (`reposicao`) | `calculateNutrientRemoval` + `NUTRIENT_PROFILES` | Manual / Calculadoras | mesmo adapter canônico | cultura, produtividade/unidade, base, créditos, eficiência e ajuste de solo | produtividade t/ha, demanda, metas por nutriente, coeficientes, fonte e nota técnica | PASS | comparação direta/Copilot e fontes preservadas |
| Cotação de insumos (`cotacao`) | `calculateQuote` | Manual / Calculadoras | mesmo adapter canônico | itens, quantidade, unidade, preço de sistema e desconto | preço final unitário, total por item, subtotal, desconto e total | PASS | comparação direta/Copilot |

## Fluxo canônico

1. `routeValIntent` identifica `CALCULATE` antes dos termos agronômicos amplos.
2. `routeSystemCapability` seleciona `TOOL` e `CALCULATORS`.
3. `identifyAgronomicCalculator` seleciona um dos nove IDs.
4. `parseAgronomicCalculatorRequest` extrai apenas valores e unidades presentes na solicitação.
5. `requiredCalculatorInputs` retorna `INPUT_REQUIRED` para lacunas materiais.
6. `executeAgronomicCalculator` chama a mesma função usada pelo Manual.
7. O Copilot recebe fatos estruturados e apenas explica o resultado; não recalcula a fórmula.

Pedidos genéricos como “roda a calculadora” abrem o catálogo e não inventam cultura, área, dose, cultivar, preço ou unidade. O cálculo histórico de custo/ha permanece compatível, mas é auxiliar e não é contado entre as nove calculadoras do Manual.

## Safety, persistência e tenancy

- O resultado do Copilot usa `persistence_mode: NONE`; salvar cálculo, cotação ou recomendação continua sendo ação humana explícita.
- Pulverização e fertilidade são cálculos técnicos, não prescrição automática. Bula vigente, registro, contexto agronômico e responsável técnico continuam obrigatórios.
- O adapter não recebe nem escolhe tenant; contexto, cliente e objeto ativo permanecem validados no servidor antes da execução.
- O ZARC não reutiliza memória como dado atual e não devolve janela quando o MAPA falha.
- Nenhuma migration, conta paga, secret ou integração externa nova foi necessária.

## Evidência automatizada

`test/agronomic-calculator-adapter.test.js` executa:

- inventário exato 9/9;
- mensagem real → `CALCULATE` → `TOOL` → motor correto;
- cálculo direto e via Copilot com igualdade profunda de outputs para as nove calculadoras;
- ZARC com fonte, data, safra, cache e falha fechada;
- `INPUT_REQUIRED` sem valores inventados;
- persistência `NONE` e fatos estruturados;
- inspeção estática de que a UI direta importa os módulos canônicos.

Resultado reproduzido desta bateria: **15/15 PASS**, incluindo nove subtestes de igualdade.

Os testes anteriores de planejamento regional continuam cobrindo 27 UFs, decomposição de colheita, estabelecimento e yield gap.

## Rollback

Reverter o adapter do Copilot e os imports compartilhados, mantendo o acesso ao Manual em `/tecnico?embedded=1&page=calculadoras`. Não há alteração de dados nem migration associada a esta ressalva. O rollback não deve remover calculadoras ou registros já salvos.

## Limite da evidência

Este documento fecha a paridade em código e teste automatizado. O gate geral só poderá usar essa evidência como definitiva depois de CI remoto, deploy Railway do mesmo SHA, regressão completa e UAT conversacional/físico exigidos no gate mestre.
