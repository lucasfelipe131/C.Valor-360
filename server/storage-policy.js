const manualEventPaths=new Set([
  '/api/v1/integrations/manual/events',
  '/api/integrations/manual/events'
])

export function publicStorageScope(pathname,method){
  if(method==='POST'&&manualEventPaths.has(pathname))return 'manual-event'
  // VAL Cred: webhook próprio (HMAC com VAL_CRED_WEBHOOK_SECRET), separado do Manual.
  if(method==='POST'&&pathname==='/api/v1/integrations/cred/events')return 'cred-event'
  if(method==='GET'&&/^\/api\/surveys\/[a-zA-Z0-9_-]+$/.test(pathname)&&pathname!=='/api/surveys/invitations')return 'public-survey'
  if(method==='POST'&&/^\/api\/surveys\/[a-zA-Z0-9_-]+\/submit$/.test(pathname))return 'public-survey'
  return null
}
