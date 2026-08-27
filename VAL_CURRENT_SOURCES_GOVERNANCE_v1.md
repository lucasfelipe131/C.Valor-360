# VAL Current Sources Governance v1

Data da auditoria: 27/08/2026
Contrato: `CurrentSourceGovernance.v1`
Escopo: staging `val-web-staging`; nenhuma conta, assinatura, credencial ou fonte nova foi criada.

## Decisão

Os três domínios não compartilham o mesmo grau de autorização. O mercado do Copilot possui um caminho governado por referências cadastradas por usuário autorizado. Clima e bulas possuem implementações úteis no Manual, mas não possuem evidência suficiente de autorização/freshness para serem apresentadas pelo Copilot como fonte atual. Nesses dois domínios, a falha fechada atual é correta e permanece.

| Domínio / consumidor | Provider e fonte | Freshness e timestamp | Falha / cache | Autoridade, tenancy e custo | Situação |
|---|---|---|---|---|---|
| Clima / Manual | Open-Meteo Forecast API; BigDataCloud somente para reverse geocoding | cache 15 min; `forecast.current.time` é o tempo do modelo; `updatedAt` é a consulta | `502` sem previsão inventada; `s-maxage=900`, SWR 1.800 s; geocode 24 h | modelo meteorológico, não observação oficial de campo; coordenadas públicas, sem contexto do produtor; nenhuma credencial presente | `TECHNICALLY_PRESENT_AUTHORIZATION_BLOCKED` |
| Clima / Copilot | nenhum adapter autorizado conectado | não aplicável | `422 val_current_source_unavailable`; não usa memória como clima atual | sem tráfego cross-tenant e sem custo novo | **BLOQUEIO EXTERNO** |
| Mercado / Copilot | `sog_market_snapshots`, com `source_name`, `source_type`, URL opcional e `observed_at` | `CURRENT` ≤24 h; `DATED` ≤168 h; depois `STALE`; data aparece na resposta e no texto falável | sem origem/data: `UNAVAILABLE`; sem cache de feed externo | fonte declarada pelo usuário; consulta por `tenant_id + owner_user_id`; nenhuma negociação automática; custo novo zero | `GOVERNED_INPUT_AVAILABLE` |
| Mercado / Manual | HTML de Notícias Agrícolas + RSS do Google News; CME identificado como referência subjacente | cache 15 min; data/hora da sessão da cotação e `publishedAt` das notícias | falhas parciais são omitidas; preço não é inventado; SWR 30 min | referência informativa; parsing HTML não é feed licenciado/executável; nenhum dado de produtor; sem credencial | `REFERENCE_ONLY_NOT_COPILOT_AUTHORITY` |
| Bulas / Manual | catálogo local derivado de Agrofit (1.632 itens), consulta pública ADAPAR e link ao MAPA Agrofit | catálogo local sem data de extração: `observed_at=unknown`; índice ADAPAR 6 h; produto `no-store`, com `consultedAt` | ADAPAR retorna `502`; catálogo local nunca vira bula corrente | MAPA Agrofit é a autoridade federal; ADAPAR é referência estadual; revisão técnica obrigatória; dados públicos e custo novo zero | `MANUAL_REFERENCE_PRESENT_COPILOT_BLOCKED` |
| Bulas / Copilot | nenhum feed versionado de bula vigente | não aplicável | `422 val_current_source_unavailable`; não prescreve a partir do catálogo local | safety e revisão humana preservados | **BLOQUEIO EXTERNO** |

## Recursos externos necessários

1. **CLIMA-EXT-001:** comprovação/aprovação de termos para uso comercial do provider climático já existente (ou autorização explícita de outro provider contratado), incluindo limite, SLA, atribuição e custo. Só depois pode existir adapter de clima atual no Copilot.
2. **MARKET-EXT-001:** para preço automático amplo, feed licenciado com credenciais, símbolos, praça/unidade, atraso, direitos de redistribuição e custo aprovados. Até lá, o Copilot usa apenas snapshots autorizados e identificados.
3. **BULAS-EXT-001:** feed/export oficial, versionado e permitido do Agrofit/MAPA — ou processo formal de snapshot datado com owner de revisão — contendo vigência, cultura, alvo, modalidade, formulação, restrições e bula. O HTML atual da ADAPAR não substitui esse contrato.

Nenhum desses recursos foi contratado, simulado ou representado por secret fictício. A ausência não é convertida em `PASS` de disponibilidade; ela é tratada como governança fechada com bloqueio externo explícito.

## Autoridade e safety

- Para defensivos, Agrofit/MAPA e a bula vigente prevalecem. Similaridade cadastral não prova equivalência, dose, eficácia ou segurança.
- Clima é previsão de modelo e deve carregar coordenada, tempo do dado, tempo da consulta e incerteza; não autoriza operação agronômica por si só.
- Mercado é referência informativa. Unidade, praça, vencimento, atraso e fonte devem permanecer visíveis; nenhuma resposta executa compra ou venda.

## Evidência reproduzida

- `test/current-source-governance.test.js` verifica os campos obrigatórios, URLs existentes, timestamp, cache, falha fechada, escopo tenant/owner e ausência de segredo inventado.
- `test/market-capability-integrity.test.js`, `test/market-session-p1.test.js` e `test/current-data-attachment-dispatch.test.js` cobrem freshness, voz, owner isolation e bloqueio de clima/bulas.
- Fontes públicas conferidas na data da auditoria: documentação oficial do Open-Meteo, consulta Agrofit/MAPA, ADAPAR e página de delayed quotes do CME Group. O CME declara atraso mínimo de 10 minutos para suas cotações públicas; a UI do Manual já as apresenta apenas como indicativas.
