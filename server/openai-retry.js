export function normalizeOpenAIMaxRetries(value,fallback=1){
  const parsed=Number(value)
  if(!Number.isFinite(parsed))return Math.max(0,Math.floor(Number(fallback)||0))
  return Math.max(0,Math.floor(parsed))
}

export function buildOpenAIRetryPolicy(value,{fallback=1}={}){
  const maxRetries=normalizeOpenAIMaxRetries(value,fallback)
  return Object.freeze({
    maxRetries,
    maxAttempts:maxRetries+1,
    backoff:'openai-sdk-exponential',
    retryable:'connection, timeout, 408, 409, 429 e 5xx',
    cancelledRequestsRetry:false
  })
}
