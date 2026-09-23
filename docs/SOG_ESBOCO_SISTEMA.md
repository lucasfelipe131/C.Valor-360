# SOG — Esboço do sistema de oportunidades de grãos

Versão 0.5 do esboço. Escopo: produtores da praça de São Luiz Gonzaga/RS e Missões, dentro da VAL Grãos do VALOR 360.

## 1. Objetivo

Transformar o pedido de cada produtor ("quero vender 3 mil sacas até março, preciso de caixa em outubro") em uma leitura de mercado personalizada, três alvos de fechamento e dicas explicáveis, sem executar operação e sem inventar cotação.

## 2. O que já existe e o que este esboço acrescenta

| Camada | Já existia (0.4) | Acrescentado (0.5) |
| --- | --- | --- |
| Produtor | Cliente 360 + perfil de grãos (armazenagem, logística, praças) | Uso do perfil na análise (armazenagem e local de entrega padrão) |
| Intenção | Registro com evidência, confiança e estados | Intenções ativas do produtor aparecem na análise |
| Mercado | Cotação registrada com fonte, praça, horário | Briefing da praça datado + cotação de porto para calcular base |
| Regra | `sog-rules-v1`: score de oportunidade | `sog-analysis-v1`: análise por pedido, escada de alvos, cenários, dicas |
| Praça | — | Perfil estruturado de São Luiz Gonzaga (calendário, compradores, logística, qualidade) |
| Interface | Oportunidades, Intenções, Mercado, Produtores, Alimentação | Guia **Análise** com formulário do pedido, resultado, briefing e compradores |

## 3. Fluxo

```text
Produtor pede  ──►  Consultor registra o pedido na guia Análise
                     (grão, volume, preço-alvo, custo, objetivo, janela, caixa, armazenagem)
                             │
                             ▼
              POST /api/grains/analysis  (sessão autenticada)
                             │
        ┌────────────────────┼─────────────────────┐
        ▼                    ▼                     ▼
 Cotações registradas   Perfil + intenções    Perfil da praça
 (fonte e horário)      do produtor           (calendário, base, dicas)
        └────────────────────┼─────────────────────┘
                             ▼
                     sog-analysis-v1
   leitura de mercado • base × porto • margem sobre custo
   três alvos escalonados por objetivo • cenários • dicas • alertas • lacunas
                             │
                             ▼
       Consultor conversa com o produtor e registra a intenção confirmada
       (a análise não cria contrato, ordem nem fechamento)
```

## 4. Motor `sog-analysis-v1`

Entradas do pedido: produtor, grão, direção (venda ou compra), volume, preço-alvo, custo por saca, objetivo (`caixa`, `margem`, `risco`, `equilibrio`), janela de entrega, local, armazenagem própria, necessidade de caixa e data, qualidade do lote e o pedido em texto livre.

Saída:

- `headline`: frase de direção.
- `marketReading`: referência usada (com atualidade e praça), cotação de porto, base, distância ao alvo, margem sobre custo.
- `closingTargets`: Alvo 1 (gatilho imediato), Alvo 2 (preço do produtor), Alvo 3 (esticada condicional), cada um com parcela, volume, receita, gatilho e condição.
- `ladder`: preço médio e receita da escada.
- `scenarios`: pessimista, base e otimista para o volume total.
- `tips`: dicas da praça e dicas específicas do pedido (caixa, armazenagem, alvo atingido, alvo distante, preço abaixo do custo, compra).
- `reasons`, `alerts`, `assumptions`, `dataGaps`: tudo explicável e auditável.
- `humanReviewRequired: true` e `automaticTrading: false`.

Regras de proteção:

- Sem cotação registrada não há alvo; o motor declara a lacuna.
- Cotação vencida (mais de 7 dias) mantém os alvos apenas como indicativos.
- Praça da cotação diferente do local de entrega gera alerta de frete e base.
- Alvo 1 nunca fica abaixo de custo mais 3% quando o custo é informado.
- Fora da praça mapeada, as dicas regionais não são aplicadas.

Distribuição das parcelas por objetivo:

| Objetivo | Alvo 1 | Alvo 2 | Alvo 3 |
| --- | ---: | ---: | ---: |
| Fazer caixa | 50% | 30% | 20% |
| Melhor preço médio | 25% | 35% | 40% |
| Reduzir risco | 40% | 35% | 25% |
| Equilíbrio | 34% | 33% | 33% |

## 5. Perfil da praça

Arquivo `server/data/sog-praca-sao-luiz-gonzaga.json`, documentado em `knowledge/approved/sog-praca-sao-luiz-gonzaga-v1.md`. Contém aliases dos municípios da área da Coopatrigo, compradores com confiança declarada, frete e base históricos, calendário por cultura (plantio, colheita, pressão, recuperação), padrões de qualidade, dicas de fechamento e o briefing de mercado datado com fontes.

O briefing é leitura, não cotação. O painel avisa quando passa de 7 dias.

## 6. APIs

| Rota | Método | Função |
| --- | --- | --- |
| `/api/grains/bootstrap` | GET | carteira, perfis, intenções, cotações e oportunidades |
| `/api/grains/profiles` | PUT | perfil de grãos do produtor |
| `/api/grains/intents` | POST | intenção com evidência |
| `/api/grains/intents/:id` | PATCH | evolução do estado |
| `/api/grains/market` | POST | cotação com fonte e horário |
| `/api/grains/market-brief` | GET | briefing da praça + última cotação registrada por grão |
| `/api/grains/analysis` | POST | análise personalizada do pedido do produtor |

Todas exigem sessão e registram evento de uso (`sog_analysis_requested` para a análise).

## 7. Hospedagem: GitHub + Railway

- Código no GitHub em `lucasfelipe131/C.Valor-360`. O workflow `Validate` roda `npm test` e `npm run build` em cada pull request e em `main`.
- Railway: projeto **VAL- VALOR 360** (workspace GATE PROJECTS), serviços `web` e `Postgres`, domínio `cvalor360.up.railway.app`. O serviço `web` está conectado ao repositório na branch `main`; cada merge em `main` gera deploy com `npm run db:migrate` antes do start.
- Este esboço não exige migração de banco: a análise é calculada por requisição e o perfil da praça é um arquivo versionado. O `Dockerfile` já copia `server/` e `knowledge/`.
- Sequência para publicar: abrir pull request da branch `claude/sleepy-euler-szr0uo`, aguardar o workflow verde, fazer merge em `main`, acompanhar o deploy na Railway e conferir `/live` e a guia **Análise** em VAL Grãos.

## 8. Próximas etapas

1. Receber os relatórios e arquivos de mercado da equipe e substituir as fontes públicas do perfil da praça.
2. Conector de cotações (Coopatrigo, Cotrisal, CEPEA) com registro automático como `market_feed`, mantendo fonte e horário.
3. Persistir análises geradas para comparar previsto × realizado e calibrar as parcelas por objetivo.
4. Custo de produção por produtor no perfil de grãos, para o Alvo 1 sair do custo real.
5. Notificação quando uma cotação registrada atinge um alvo em aberto.
