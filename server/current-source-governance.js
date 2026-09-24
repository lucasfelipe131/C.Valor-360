export const CURRENT_SOURCE_GOVERNANCE_VERSION='CurrentSourceGovernance.v1'

const records=Object.freeze([
 Object.freeze({
  id:'weather-manual-open-meteo',domain:'CLIMA',consumer:'MANUAL',provider:'Open-Meteo Forecast API + BigDataCloud reverse geocoding',
  source:'https://api.open-meteo.com/v1/forecast',freshness:'Forecast response cached for 15 minutes; stale-while-revalidate for 30 minutes.',
  timestamp:'Weather observation/model time is forecast.current.time; updatedAt is the VAL fetch time.',
  failure_behavior:'HTTP 502 with no fabricated forecast; reverse-geocoding failure falls back to an unnamed current location.',
  cache:'Open-Meteo: s-maxage=900, stale-while-revalidate=1800. Reverse geocoding: revalidate=86400.',
  authority:'Forecast-model provider; not a Brazilian official field observation or agronomic prescription.',
  tenant_implications:'Coordinates are request input and responses use a shared public cache; no producer context is sent.',
  cost:'No credential is present. Commercial-use entitlement is not evidenced in code or environment.',
  integration_status:'TECHNICALLY_PRESENT_AUTHORIZATION_BLOCKED',current_claim_allowed:false,
  external_blocker:'Provide approved commercial-use terms/account for the existing provider, or authorize a different contracted provider; then connect a governed adapter to the Copilot.'
 }),
 Object.freeze({
  id:'market-copilot-owner-snapshot',domain:'MERCADO',consumer:'COPILOT',provider:'SOG market snapshots entered by an authorized VAL user',
  source:'sog_market_snapshots.source_name/source_type/source_url',freshness:'CURRENT <=24h; DATED >24h and <=168h; STALE >168h; invalid or missing time is UNKNOWN.',
  timestamp:'observed_at from the declared source is mandatory and is rendered with the source.',
  failure_behavior:'UNAVAILABLE/NO_DATA when source or observed_at is absent; stale data is labeled historical and never called today.',
  cache:'PostgreSQL/fallback read; no external feed cache. Results are queried per request and bounded.',
  authority:'User-declared authorized reference. It is not an exchange-wide live feed and never authorizes trading.',
  tenant_implications:'Rows are scoped by tenant_id and owner_user_id; no ownerless or cross-owner fallback.',
  cost:'No external account or paid feed was added.',
  integration_status:'GOVERNED_INPUT_AVAILABLE',current_claim_allowed:true,
  external_blocker:'For automatic exchange-wide live prices, provide a licensed feed, credentials, permitted symbols/uses and latency terms.'
 }),
 Object.freeze({
  id:'market-manual-reference-feed',domain:'MERCADO',consumer:'MANUAL',provider:'Notícias Agrícolas HTML + Google News RSS; CME named as underlying delayed reference',
  source:'https://www.noticiasagricolas.com.br/ and Google News RSS',freshness:'Fetch cache 15 minutes; quotes retain source page session date/time; news retain publishedAt.',
  timestamp:'updatedAt is fetch time; quote date/time and news publishedAt are shown separately.',
  failure_behavior:'Promise.allSettled omits failed feeds; empty/error UI does not manufacture a price or old news.',
  cache:'s-maxage=900, stale-while-revalidate=1800.',
  authority:'Reference-only UI. HTML parsing is brittle and is not a licensed executable-price feed.',
  tenant_implications:'Public reference data only; no producer or tenant context is transmitted.',
  cost:'No credential or paid subscription is present.',
  integration_status:'REFERENCE_ONLY_NOT_COPILOT_AUTHORITY',current_claim_allowed:false,
  external_blocker:'Provide licensed market-data authority and redistribution terms before treating this as an automatic Copilot source.'
 }),
 Object.freeze({
  id:'labels-manual-agrofit-adapar',domain:'BULAS',consumer:'MANUAL',provider:'Local Agrofit-derived catalog + live ADAPAR public HTML lookup + link to MAPA Agrofit',
  source:'MAPA Agrofit is the canonical federal registry; ADAPAR is the live state lookup already used by the Manual.',
  freshness:'Local 1,632-product catalog has no extraction timestamp and is never current. ADAPAR target index caches 6 hours; product lookup is no-store.',
  timestamp:'ADAPAR response returns consultedAt for product lookup; local catalog evidence reports observed_at=unknown.',
  failure_behavior:'ADAPAR lookup returns HTTP 502; Copilot returns val_current_source_unavailable and never substitutes the local catalog as a current label.',
  cache:'ADAPAR target index in memory for 6 hours; product details no-store; local catalog ships with the release.',
  authority:'MAPA Agrofit is federal authority. ADAPAR is an official state reference. Technical claims still require the current label and qualified review.',
  tenant_implications:'Public regulatory data only; no producer context is sent. Any saved decision remains tenant-scoped by the consuming workflow.',
  cost:'No credential or paid service is present; no formal machine-readable update entitlement is evidenced.',
  integration_status:'MANUAL_REFERENCE_PRESENT_COPILOT_BLOCKED',current_claim_allowed:false,
  external_blocker:'Provide an authorized, versioned Agrofit/MAPA feed or approved dated export/update process (including permitted use and review owner) before enabling current-label answers in Copilot.'
 }),
 Object.freeze({
  id:'knowledge-approved-source-request',domain:'BULAS',consumer:'COPILOT',provider:'Fonte oficial registrada e aprovada por um revisor nomeado da própria organização (val_knowledge_source_requests).',
  source:'URL oficial em https sob gov.br ou embrapa.br, com o trecho citado e a data de consulta gravados no momento da aprovação.',
  freshness:'A vigência é declarada na aprovação (source.valid_until). Vencida, a resposta deixa de ser servida e a dúvida volta a ser recusa regulada.',
  timestamp:'accessed_at é quando o revisor consultou a fonte; approved_at é quando ele assumiu a responsabilidade. Os dois viajam na citação.',
  failure_behavior:'Sem fonte aprovada e vigente o Copilot mantém a recusa regulada. Sem PostgreSQL a fila não existe e o comportamento é o anterior a este caminho.',
  cache:'Nenhum cache externo: a leitura é da própria tabela, escopada por tenant.',
  authority:'A autoridade é do documento oficial citado, não do modelo. O texto entregue é o excerto literal, e a responsabilidade técnica é da pessoa nomeada em approved_by.',
  tenant_implications:'Escopo por tenant. O pedido recusa produtor colado, e o grounding continua barrando afirmação sobre indivíduo nomeado mesmo com a fonte aprovada.',
  cost:'Nenhuma credencial ou serviço pago. A curadoria é humana e o custo é o tempo do revisor.',
  integration_status:'HUMAN_APPROVED_SOURCE_AVAILABLE',current_claim_allowed:true,
  external_blocker:'Nenhum para este caminho, que é curadoria humana e não feed automático. A busca automática de fontes permanece bloqueada — ver research-governed-lookup.'
 }),
 Object.freeze({
  id:'research-governed-lookup',domain:'PESQUISA',consumer:'COPILOT',provider:'OpenAI Responses API, ferramenta web_search, na mesma conta e cliente já usados pela VAL (server/knowledge/web-research.js).',
  source:'Allow-list configurável (VAL_WEB_RESEARCH_DOMAINS). Padrão: gov.br, embrapa.br e universidades com pesquisa agronômica. O filtro é pedido ao provedor e conferido de novo em cada citação devolvida.',
  freshness:'Busca feita na hora da pergunta. A citação guarda endereço e título; a data de coleta é a da resposta.',
  timestamp:'Cada trecho da resposta vem com url_citation do provedor. Resposta sem nenhuma citação é descartada.',
  failure_behavior:'Falha do provedor, citação fora da lista, resposta sem citação ou conteúdo prescritivo descartam a pesquisa e o Copilot segue o caminho anterior (memória do modelo marcada como não verificada, ou recusa).',
  cache:'Sem cache. A resposta pesquisada não entra em val_shared_knowledge_answers, que é compartilhada entre tenants e só aceita conhecimento não verificado.',
  authority:'Síntese do modelo a partir das páginas encontradas: tem fonte, não tem revisor, e sai marcada assim. Dúvida regulada nunca é respondida pela pesquisa — ela só sugere fontes oficiais candidatas ao revisor, e jamais responde ao consultor sem aprovação humana.',
  tenant_implications:'A pergunta do consultor sai para o provedor. O caminho é o geral, sem produtor selecionado nem memória privada; o grounding segue barrando afirmação sobre indivíduo nomeado.',
  cost:'Cobrada por busca na conta OpenAI da organização. Entra no mesmo teto de IA geral por consultor (US$ 5 por login). A taxa por busca é estimativa conservadora em VAL_WEB_RESEARCH_CALL_COST_USD e deve ser ajustada pelo preço vigente.',
  integration_status:'IMPLEMENTED_DISABLED_BY_FLAG',current_claim_allowed:false,
  external_blocker:'Nenhum provedor a contratar. Para ligar: VAL_WEB_RESEARCH_ENABLED=true, confirmar a allow-list e ajustar o custo por busca ao preço vigente. Assunto regulado continua exigindo candidata DRAFT aprovada por uma pessoa, com ou sem a flag.'
 })
])

export const CURRENT_SOURCE_GOVERNANCE=records

export function currentSourceGovernance({domain,consumer}={}){
 const normalizedDomain=String(domain||'').trim().toUpperCase()
 const normalizedConsumer=String(consumer||'').trim().toUpperCase()
 return records.filter(record=>(!normalizedDomain||record.domain===normalizedDomain)&&(!normalizedConsumer||record.consumer===normalizedConsumer))
}
