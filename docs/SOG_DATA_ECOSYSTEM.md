# SOG — ecossistema de alimentação e direção comercial

## Objetivo

A SOG (Sistema de Operações de Grãos) é o domínio da VAL Grãos para reunir evidências de originação, referências de mercado e direcionamento comercial. Ela reutiliza o produtor do Cliente 360 e não mistura intenções, cotações ou operações com o pipeline de insumos.

O primeiro ciclo operacional cobre:

1. perfil comercial de grãos do produtor;
2. intenção de venda ou compra registrada com evidência;
3. referência de mercado identificada por fonte, praça e horário;
4. oportunidade calculada por regra determinística e explicável.

Contratos, fixações, posição, saldos e entregas permanecem como próximos domínios. A interface os identifica como não conectados; nenhum dado é simulado.

## Fluxo de dados

```text
Cliente 360
  produtor, município, culturas, perfil e carteira
        |
        v
Perfil SOG + intenção registrada
  volume, preço-alvo, janela, local, fonte e confiança
        |
        +-------------------+
                            v
Referência de mercado --> Motor sog-rules-v1
  preço, unidade, praça,     confirmação + atualidade +
  fonte, horário, confiança preço + janela de entrega
                            |
                            v
                    Direcionamento comercial
                    score + motivos + alertas + ação
```

O motor não grava uma intenção inferida e não cria contrato, ordem ou fechamento. A equipe confirma e executa a ação fora do cálculo.

## Fontes implementadas

| Entrada | Origem atual | Controle |
| --- | --- | --- |
| Produtor | Cliente 360 | mesmo tenant, login e carteira |
| Perfil de grãos | formulário SOG | fonte, data e confirmação explícita |
| Intenção | formulário SOG | estado, evidência, confiança e histórico |
| Mercado | formulário SOG | fonte obrigatória, horário, praça e URL opcional |
| Direcionamento | `sog-rules-v1` | motivos, alertas, completude e referência usada |

As APIs internas usam a sessão autenticada do VALOR 360 e aplicam as mesmas validações da interface. Conectores externos de ERP/CTRM, feeds de mercado e importação em lote ainda não estão habilitados.

## Persistência

- `sog_producer_profiles`: extensão do Cliente 360 para culturas trabalhadas, armazenagem, logística e praças usuais.
- `sog_negotiation_intents`: intenção do produtor, volume, preço-alvo, entrega, evidência, confiança e estado.
- `sog_market_snapshots`: fotografia imutável de preço, unidade, praça, fonte e momento observado.

Todas as consultas exigem `tenant_id`, `owner_user_id` e vínculo do produtor com a carteira do consultor. A exclusão do usuário ou do produtor aplica as regras de cascata previstas no banco.

## Estados da intenção

```text
draft ------> monitoring

confirmed ------> negotiating ------> closed

draft / monitoring / confirmed / negotiating ------> cancelled
```

- `draft`: sinal preliminar, sem confirmação do produtor;
- `monitoring`: relato acompanhado pelo consultor; exige um novo registro confirmado antes de negociar;
- `confirmed`: confirmação direta do produtor, com confiança mínima de 80%;
- `negotiating`: a equipe iniciou a condução comercial;
- `closed` ou `cancelled`: encerramento do histórico.

Uma atualização genérica não promove `draft` diretamente para `confirmed`. Uma nova confirmação deve entrar com sua evidência.

## Regra de oportunidade `sog-rules-v1`

O score vai de 0 a 100 e soma quatro blocos:

| Bloco | Peso máximo | Evidência |
| --- | ---: | --- |
| Prontidão | 30 | estado, confiança, volume e local |
| Mercado | 25 | cotação, fonte e atualidade |
| Alinhamento de preço | 30 | diferença entre preço-alvo e referência, convertida para R$/t quando necessário |
| Janela | 15 | proximidade da entrega |

Faixas:

- 75–100: prioridade alta;
- 55–74: em validação;
- 35–54: monitorar;
- 0–34: completar dados.

Guardrails reduzem a prioridade quando a intenção não foi confirmada, tem confiança baixa, está antiga ou possui janela vencida. Cotações vencidas não sustentam alinhamento integral de preço. A praça divergente gera alerta para validar frete e base.

## APIs internas

- `GET /api/grains/bootstrap`
- `PUT /api/grains/profiles`
- `POST /api/grains/intents`
- `PATCH /api/grains/intents/:id`
- `POST /api/grains/market`

Todas são protegidas pela sessão e registram eventos de uso. A API não oferece endpoint de execução automática de negócio.

## Próxima evolução segura

1. homologar fontes externas de cotações e política de atualização;
2. criar importação revisável de intenções, com idempotência e relatório de rejeições;
3. integrar ERP/CTRM para contratos, fixações, posição, saldos e entregas;
4. registrar resultado das abordagens para calibrar as regras sem apagar a explicação original;
5. disponibilizar visão gerencial agregada respeitando o escopo de carteira.
