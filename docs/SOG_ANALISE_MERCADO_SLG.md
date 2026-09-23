# SOG — Análise de mercado e target de fechamentos: praça de São Luiz Gonzaga/RS

Data da leitura: 23/09/2026. Fontes públicas datadas, listadas ao final. O repositório não continha arquivos de mercado nem relatórios internos; quando forem entregues, esta análise deve ser revisada com os números da equipe.

Este documento é leitura para apoiar conversa e decisão. Não é recomendação de investimento nem ordem de negociação. A decisão permanece com o consultor e o produtor.

## 1. Fotografia da praça em 22–23/09/2026

| Grão | Referência | Valor | Data | Confiança |
| --- | --- | ---: | --- | ---: |
| Soja | Cotrisal, Noroeste/RS, disponível | R$ 140,00/sc | 23/09 | 70% |
| Soja | Grão Direto, São Luiz Gonzaga | R$ 128,84/sc | 09/07 (desatualizada) | 40% |
| Soja | CEPEA/ESALQ Paranaguá | R$ 161,52/sc | 22/09 | 85% |
| Soja | Chicago nov/26 | US$ 13,25½/bu | 22/09 | 85% |
| Câmbio | Dólar venda | R$ 5,1027 | 22/09 | 85% |
| Milho | Cotrisal, Noroeste/RS | R$ 62,00/sc | 23/09 | 70% |
| Milho | Média RS | R$ 61,98/sc | 21/09 | 65% |
| Trigo | Cotrisal, pH 78 | R$ 75,00/sc | 23/09 | 70% |
| Trigo | CEPEA RS | R$ 1.419,84/t (≈ R$ 85,19/sc) | 22/09 | 85% |
| Trigo | CEPEA PR | R$ 1.532,17/t | 22/09 | 85% |

Base soja interior × Paranaguá: R$ 140,00 - R$ 161,52 = **-R$ 21,52 por saca**, dentro do intervalo de frete interior × Rio Grande observado em 2026 (R$ 21 a R$ 24). A base está "normal": não há prêmio local nem penalidade fora do padrão.

Conta de paridade (para checar a cotação local): 13,255 US$/bu × 36,74 bu/t = US$ 487/t; × R$ 5,10 = R$ 2.485/t = R$ 149/sc FOB antes de prêmio. Paranaguá a R$ 161,52 implica prêmio positivo; o interior a R$ 140 devolve o frete. Os números batem, então a cotação de R$ 140 é crível para a praça.

## 2. Leitura por cultura

### Soja

- Momento da praça: entressafra final e início do plantio 2026/27 (out–dez). Sem pressão de colheita; a base tende a se manter até a virada do ano.
- Preço atual cobre custo em boa parte das lavouras da região (custo de referência a confirmar com a equipe; a análise usa o custo que o consultor informar).
- Fatores de alta: câmbio acima de R$ 5,00; colheita tardia do RS aproveita preços de início de safra; La Niña fraca pode reduzir oferta no Sul.
- Fatores de baixa: prêmios de exportação recuam com a China comprando dos EUA; safra 2026/27 brasileira projetada grande; frete pressionado por diesel.
- Leitura SOG: **mercado "no preço" para travar parte da safra nova**, não para vender tudo. Quem ainda tem soja velha em armazém está na janela histórica de recuperação (jul–out) e deve escoar antes de dezembro.

### Milho

- Momento da praça: plantio 2026/27 já em 70% nas Missões; colheita precoce em jan–fev/2027.
- Preço estadual em torno de R$ 62 por saca, sustentado pela demanda de proteína animal e pelo déficit gaúcho.
- Fatores de alta: geada e granizo exigiram replantio; milho velho escasso no RS.
- Fatores de baixa: área +7,4% no RS; entrada de milho do Centro-Oeste e do Paraguai; safra grande no país.
- Leitura SOG: **vender milho velho agora** e **contratar a termo a primeira parcela da safra nova** para a janela precoce de jan–fev, quando as Missões colhem antes das demais regiões.

### Trigo

- Momento da praça: colheita iniciando no oeste do RS; pressão de outubro–dezembro pela frente.
- Diferença de ~R$ 10 por saca entre a cotação local pH 78 (R$ 75) e o indicador CEPEA RS (R$ 85) reflete frete, margem e prazo; o Paraná paga cerca de R$ 112/t a mais.
- Risco central é qualidade: giberela e oídio após chuva excessiva geram desconto por pH e DON.
- Leitura SOG: **classificar antes de cotar**; fechar trigo padrão na pré-colheita se cobrir o custo; **segurar trigo de qualidade** para mar–jun quando houver armazenagem.

## 3. Target de dicas para os fechamentos

O motor `sog-analysis-v1` transforma cada pedido em três alvos escalonados. Os alvos abaixo são o exemplo calculado com a fotografia de 23/09 para uma venda de soja; a ferramenta recalcula com a cotação registrada do dia.

| Alvo | Preço (R$/sc) | Condição | Parcela por objetivo |
| --- | ---: | --- | --- |
| Alvo 1 — gatilho imediato | 140,00 | Executável hoje na referência registrada; cobre custo mais 3% | caixa 50% • equilíbrio 34% • margem 25% • risco 40% |
| Alvo 2 — preço do produtor | 150,00 | Preço-alvo declarado; ordem de venda no comprador | caixa 30% • equilíbrio 33% • margem 35% • risco 35% |
| Alvo 3 — esticada condicional | 156,00 | Só com evento confirmado (câmbio, Chicago, prêmio); rebaixar em 30 dias se não vier | caixa 20% • equilíbrio 33% • margem 40% • risco 25% |

Regras de fechamento que a SOG aplica e o consultor deve levar para a mesa:

1. **Escalonar sempre.** Três parcelas no mínimo; nunca concentrar na colheita.
2. **Comparar duas cotações com fonte** antes de fechar, uma delas de porto ou indicador, para checar a base.
3. **Converter prazo em preço.** Pagamento em 72 h, à vista ou 30 dias muda o preço equivalente; pedir a condição junto com o valor.
4. **Classificar o lote.** Umidade, impureza, pH e DON definem o preço líquido; cotação é para grão padrão.
5. **Caixa primeiro.** O volume que cobre a necessidade de caixa fecha no Alvo 1; o restante fica com ordens nos alvos superiores.
6. **Armazenagem decide o tempo.** Sem armazém na colheita, fixar preço antes da entrega; com armazém, carregar parcelas para a janela de recuperação (soja jul–out, milho jun–set, trigo mar–jun).
7. **Registrar a decisão.** Toda parcela fechada vira intenção confirmada na SOG, com evidência e data; a análise não fecha nada sozinha.
8. **Data-limite para o Alvo 3.** Se o evento não vier em 30 dias, rebaixar para o Alvo 2 em vez de esperar indefinidamente.

## 4. Riscos que mudam esta leitura

- Clima: La Niña fraca e curta no Sul, ainda o principal risco de oferta para soja e milho.
- Comércio: acordo China–EUA reduz prêmio brasileiro de exportação.
- Logística: diesel e disputa por armazém e caminhão na colheita mantêm o frete pressionado.
- Qualidade do trigo: chuva excessiva na maturação.
- Dado velho: a cotação do Grão Direto para São Luiz Gonzaga é de julho; usar apenas como piso histórico.

## 5. Como manter a leitura viva

1. Registrar diariamente na SOG a cotação da Coopatrigo, da Cotrisal e o indicador CEPEA, com fonte e horário. A análise usa apenas cotações registradas.
2. Atualizar `server/data/sog-praca-sao-luiz-gonzaga.json` a cada semana com o briefing; o painel avisa quando o briefing passa de 7 dias.
3. Quando os relatórios internos forem entregues, incorporar custo de produção médio da carteira e as praças de entrega reais para calibrar os alvos.

## 6. Fontes

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
