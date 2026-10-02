const readBoolean=(value,fallback=false)=>value===undefined?fallback:/^(1|true|yes|on)$/i.test(String(value))
// Um valor numérico inválido (ex.: VAL_SESSION_TTL_SECONDS=12h) virava NaN e desligava silenciosamente a autenticação ou o rate-limit.
const readNumber=(name,fallback)=>{const raw=process.env[name];if(raw===undefined||String(raw).trim()==='')return fallback;const value=Number(raw);if(!Number.isFinite(value)||value<=0){console.warn(`${name}=${raw} não é um número válido; usando ${fallback}.`);return fallback}return value}

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
  openaiTimeoutMs:readNumber('OPENAI_TIMEOUT_MS',100_000),
  openaiMaxRetries:process.env.OPENAI_MAX_RETRIES===undefined||String(process.env.OPENAI_MAX_RETRIES).trim()===''?1:Number.isInteger(Number(process.env.OPENAI_MAX_RETRIES))&&Number(process.env.OPENAI_MAX_RETRIES)>=0?Number(process.env.OPENAI_MAX_RETRIES):1,
  modelDaily:String(process.env.VAL_MODEL_DAILY||process.env.OPENAI_MODEL||'gpt-5.6-terra'),
  modelStrategic:String(process.env.VAL_MODEL_STRATEGIC||'gpt-5.6-sol'),
  modelFast:String(process.env.VAL_MODEL_FAST||'gpt-5.6-luna'),
  knowledgeVectorStoreId:String(process.env.VAL_KNOWLEDGE_VECTOR_STORE_ID||''),
  manualWebhookSecret:String(process.env.VAL_MANUAL_WEBHOOK_SECRET||''),
  integrationToken:String(process.env.VAL_INTEGRATION_TOKEN||''),
  adminEmail:String(process.env.VAL_ADMIN_EMAIL||''),
  adminPassword:String(process.env.VAL_ADMIN_PASSWORD||''),
  sessionSecret:String(process.env.VAL_SESSION_SECRET||''),
  sessionTtlSeconds:readNumber('VAL_SESSION_TTL_SECONDS',43_200),
  maxContextChars:readNumber('VAL_MAX_CONTEXT_CHARS',30000),
  maxOutputTokens:readNumber('VAL_MAX_OUTPUT_TOKENS',26_000),
  strategicMaxOutputTokens:readNumber('VAL_STRATEGIC_MAX_OUTPUT_TOKENS',32_000),
  aiRequestsPerTenMinutes:readNumber('VAL_AI_REQUESTS_PER_10_MINUTES',30),
  loginAttemptsPerTenMinutes:readNumber('VAL_LOGIN_ATTEMPTS_PER_10_MINUTES',8),
  maxBodyBytes:readNumber('VAL_MAX_BODY_BYTES',10_000_000)
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
