const readBoolean=(value,fallback=false)=>value===undefined?fallback:/^(1|true|yes|on)$/i.test(String(value))

export const DEFAULT_TENANT_ID='00000000-0000-4000-8000-000000000001'

export function validateDefaultTenantId(value){
  const tenantId=String(value||DEFAULT_TENANT_ID).trim().toLowerCase()
  if(tenantId!==DEFAULT_TENANT_ID)throw new Error(`VAL_DEFAULT_TENANT_ID ainda deve ser ${DEFAULT_TENANT_ID} no piloto; o tenant informado não é provisionado por esta migração.`)
  return tenantId
}

export const config=Object.freeze({
  databaseUrl:String(process.env.DATABASE_URL||''),
  databaseSsl:readBoolean(process.env.PG_SSL,false),
  demoMode:readBoolean(process.env.VAL_DEMO_MODE,false),
  autoMigrate:readBoolean(process.env.AUTO_MIGRATE,false),
  defaultTenantId:validateDefaultTenantId(process.env.VAL_DEFAULT_TENANT_ID),
  openaiApiKey:String(process.env.OPENAI_API_KEY||''),
  openaiProject:String(process.env.OPENAI_PROJECT||''),
  openaiStoreResponses:readBoolean(process.env.OPENAI_STORE_RESPONSES,false),
  openaiTimeoutMs:Number(process.env.OPENAI_TIMEOUT_MS||100_000),
  openaiMaxRetries:Number(process.env.OPENAI_MAX_RETRIES||1),
  modelDaily:String(process.env.VAL_MODEL_DAILY||process.env.OPENAI_MODEL||'gpt-5.6-terra'),
  modelStrategic:String(process.env.VAL_MODEL_STRATEGIC||'gpt-5.6-sol'),
  modelFast:String(process.env.VAL_MODEL_FAST||'gpt-5.6-luna'),
  knowledgeVectorStoreId:String(process.env.VAL_KNOWLEDGE_VECTOR_STORE_ID||''),
  manualWebhookSecret:String(process.env.VAL_MANUAL_WEBHOOK_SECRET||''),
  integrationToken:String(process.env.VAL_INTEGRATION_TOKEN||''),
  adminEmail:String(process.env.VAL_ADMIN_EMAIL||''),
  adminPassword:String(process.env.VAL_ADMIN_PASSWORD||''),
  sessionSecret:String(process.env.VAL_SESSION_SECRET||''),
  sessionTtlSeconds:Number(process.env.VAL_SESSION_TTL_SECONDS||43_200),
  maxContextChars:Number(process.env.VAL_MAX_CONTEXT_CHARS||30000),
  maxOutputTokens:Number(process.env.VAL_MAX_OUTPUT_TOKENS||26_000),
  strategicMaxOutputTokens:Number(process.env.VAL_STRATEGIC_MAX_OUTPUT_TOKENS||32_000),
  aiRequestsPerTenMinutes:Number(process.env.VAL_AI_REQUESTS_PER_10_MINUTES||30),
  loginAttemptsPerTenMinutes:Number(process.env.VAL_LOGIN_ATTEMPTS_PER_10_MINUTES||8),
  maxBodyBytes:Number(process.env.VAL_MAX_BODY_BYTES||10_000_000)
})

export function getPublicEngineConfig(){
  return {
    aiConfigured:Boolean(config.openaiApiKey),
    databaseConfigured:Boolean(config.databaseUrl),
    manualIntegrationConfigured:Boolean(config.manualWebhookSecret||config.integrationToken),
    securityConfigured:Boolean(config.adminEmail&&config.adminPassword&&config.sessionSecret),
    demoMode:config.demoMode,
    knowledgeBaseConfigured:Boolean(config.knowledgeVectorStoreId),
    responseStorage:config.openaiStoreResponses?'openai-enabled':'application-only',
    models:{daily:config.modelDaily,strategic:config.modelStrategic,fast:config.modelFast}
  }
}
