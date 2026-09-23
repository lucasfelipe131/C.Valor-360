# SOG — Base técnica da praça de São Luiz Gonzaga/RS v1

Documento de referência da VAL Grãos para a praça de São Luiz Gonzaga e Missões. Cada afirmação carrega uma confiança declarada. Itens marcados **[confirmar]** precisam de validação da equipe local antes de entrar em uma negociação. Fonte estruturada: `server/data/sog-praca-sao-luiz-gonzaga.json`.

Atualizado em 23/09/2026. O repositório não recebeu arquivos de mercado nem relatórios em PDF ou planilha; esta base foi montada a partir de fontes públicas datadas e da estrutura já existente da SOG. Quando os relatórios internos forem entregues, eles substituem as fontes públicas aqui citadas.

## 1. A praça

- Município do Noroeste gaúcho, região das Missões. Cultura dominante: soja, milho e trigo, com arroz, canola e triticale em menor escala.
- A Coopatrigo tem sede na cidade e atua em 13 municípios (São Luiz Gonzaga, Santo Antônio das Missões, Garruchos, São Nicolau, Pirapó, Dezesseis de Novembro, Roque Gonzales, Rolador, Caibaté, Mato Queimado, Bossoroca, Capão do Cipó e Santiago). Confiança 85%.
- Porto de referência: Rio Grande/RS, a cerca de 600 km por rodovia **[confirmar rota]**. Corredores: BR-285 (Santo Ângelo, Cruz Alta, Passo Fundo) e RS-168/BR-392 em direção ao porto.
- Ramal ferroviário Santo Ângelo–Cruz Alta existe; o uso comercial para grãos deve ser confirmado **[confirmar]**.

## 2. Compradores e referências

| Comprador | Tipo | Observação | Confiança |
| --- | --- | --- | ---: |
| Coopatrigo | cooperativa | Sede na praça; cota soja, trigo, milho, arroz, canola, triguilho e triticale; pagamento de soja em 72 h | 85% |
| Cotrisal | cooperativa | Cotação diária de referência para o Noroeste (soja, milho, trigo pH 78) | 70% |
| Cotrisa (Santo Ângelo) | cooperativa | Vizinha; confirmar recebimento na praça | 50% |
| Cotrimaio (Três de Maio) | cooperativa | Fronteira Noroeste; confirmar alcance | 50% |
| Camera Agroalimentos | trading | Originação regional a partir de Santa Rosa | 50% |
| Tradings de porto (Bunge, Cargill, ADM, Bianchini) | trading | Preço interior = porto - frete - margem | 55% |
| Cerealistas e corretoras locais | corretora | Preencher com as usadas pela equipe **[confirmar]** | 30% |

## 3. Logística e base

- Diferença interior × porto de Rio Grande em 2026: R$ 21 a R$ 24 por saca (Agrolink, setembro/2026). Confiança 60%.
- Base calculada em 22/09/2026: Cotrisal Noroeste R$ 140,00 contra CEPEA Paranaguá R$ 161,52, ou seja, -R$ 21,52 por saca. Confiança 60%.
- Na colheita, milho e soja disputam armazém e caminhão; o frete sobe e a base piora. Diesel é o principal fator de variação.

## 4. Calendário da praça

| Cultura | Plantio | Colheita | Pressão de preço | Recuperação típica |
| --- | --- | --- | --- | --- |
| Soja | out–dez | mar–mai | mar–mai | jul–out |
| Milho | ago–out | jan–abr (Missões colhe antes) | jan–mar | jun–set |
| Trigo | mai–jul | set–nov | out–dez | mar–jun |

Sazonalidade é tendência histórica, não previsão. A SOG usa o calendário para explicar a janela, nunca para prometer preço.

## 5. Padrões de qualidade que mudam o preço líquido

- Soja: umidade 14%, impurezas 1%, avariados até 8%; esverdeados e ardidos descontam por tabela do comprador.
- Milho: umidade 14%, impurezas 1%; secagem cobrada por ponto de umidade.
- Trigo: base pH 78, umidade 13%; falling number e W definem a classe; DON e giberela geram desconto ou recusa.

## 6. Leitura de mercado em 22–23/09/2026

Referências datadas e com fonte, para comparação e não para execução:

| Grão | Referência | Valor | Data |
| --- | --- | ---: | --- |
| Soja | Cotrisal, Noroeste/RS, disponível | R$ 140,00/sc | 23/09/2026 |
| Soja | Grão Direto, São Luiz Gonzaga, disponível | R$ 128,84/sc | 09/07/2026 (desatualizada) |
| Soja | CEPEA/ESALQ Paranaguá | R$ 161,52/sc | 22/09/2026 |
| Soja | Chicago nov/26 | US$ 13,25½/bu | 22/09/2026 |
| Câmbio | Dólar venda | R$ 5,1027 | 22/09/2026 |
| Milho | Cotrisal, Noroeste/RS | R$ 62,00/sc | 23/09/2026 |
| Milho | Média RS | R$ 61,98/sc | 21/09/2026 |
| Trigo | Cotrisal, pH 78 | R$ 75,00/sc | 23/09/2026 |
| Trigo | CEPEA RS | R$ 1.419,84/t (≈ R$ 85,19/sc) | 22/09/2026 |
| Trigo | CEPEA PR | R$ 1.532,17/t | 22/09/2026 |

Contexto:

- Soja: plantio 2026/27 começa com preços considerados atrativos; risco de La Niña fraca para o Sul; prêmios de exportação tendem a recuar com a China retomando compras dos EUA. A diferença Mato Grosso × RS pode chegar a R$ 15–20 por saca e estados de colheita tardia podem aproveitar preços de início de colheita.
- Milho: plantio 2026/27 em 60% no RS e cerca de 70% nas Missões; área estimada em 896.401 ha (+7,42%); geada e granizo exigiram replantio pontual; mercado cauteloso com preços sustentados.
- Trigo: colheita iniciando no oeste do RS; produtividade projetada pela Conab em 2.978 kg/ha (-7,5%); chuva excessiva trouxe giberela e oídio; expectativa de R$ 1.350 a R$ 1.500 por tonelada na colheita.

## 7. Como a SOG usa esta base

1. O motor `sog-analysis-v1` lê o calendário, a base e as dicas por cultura para personalizar a análise do pedido do produtor.
2. As referências desta base aparecem apenas como briefing datado. A comparação de preço usa as cotações registradas pela equipe com fonte e horário, conforme a governança da SOG.
3. Quando os relatórios internos chegarem, o JSON da praça recebe os novos valores com data e fonte, e este documento registra a versão.

## 8. Fontes públicas consultadas

- Cotrisal, cotações de 23/09/2026: https://www.cotrisal.com.br/
- Grão Direto, soja em São Luiz Gonzaga: https://www.graodireto.com.br/ofertas/soja/rs/sao-luiz-gonzaga/
- Coopatrigo, todas as cotações: https://www.coopatrigo.com.br/novo/todas-as-cotacoes/
- Brasil 61, soja e trigo com CEPEA em 22/09/2026: https://brasil61.com/n/soja-sobe-no-interior-do-parana-e-recua-em-paranagua-nesta-terca-feira-22-pagr266543
- Notícias Agrícolas, Chicago: https://www.noticiasagricolas.com.br/cotacoes-mercado-futuro/soja
- O Correio News, milho no RS em 21/09/2026: https://www.ocorreionews.com.br/2026/09/21/plantio-avanca-e-clima-mantem-atencao-no-milho/
- Forbes Agro / Emater, colheita de trigo no RS: https://forbes.com.br/forbes-agro/2026/09/rio-grande-do-sul-comeca-a-colheita-de-trigo-diz-emater-2/
- BRA 1, plantio da soja 2026/27: https://www.bra1.com.br/agronegocio/id-690890/plantio_da_soja_2026_27_comeca_com_precos_atrativos_e_clima_no_rs_em_alerta
- Agrolink, frete e custos na soja: https://www.agrolink.com.br/noticias/frete-e-custos-pesam-sobre-mercado-da-soja_518394.html
- Emater/RS, cotações semanais: https://www.emater.tche.br/site/info-agro/precos_semanais.php
