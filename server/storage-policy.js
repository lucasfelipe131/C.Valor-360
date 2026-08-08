const manualEventPaths=new Set([
  '/api/v1/integrations/manual/events',
  '/api/integrations/manual/events'
])

export function publicStorageScope(pathname,method){
  if(method==='POST'&&manualEventPaths.has(pathname))return 'manual-event'
  if(method==='GET'&&/^\/api\/surveys\/[a-zA-Z0-9_-]+$/.test(pathname)&&pathname!=='/api/surveys/invitations')return 'public-survey'
  if(method==='POST'&&/^\/api\/surveys\/[a-zA-Z0-9_-]+\/submit$/.test(pathname))return 'public-survey'
  return null
}
