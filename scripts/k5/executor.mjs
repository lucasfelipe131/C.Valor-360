import {K5_ACCOUNTS} from '../../server/k5-staging-fixtures.js'

// The transport is the ordinary authenticated application UI/handler adapter.
// This module has no credentials, network client or default paid authorization.
export function createK5Executor({readSession,readPolicy,submit,checkpoint,
 now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),authorizedSubmissions=0}={}){
 if(![readSession,readPolicy,submit,checkpoint].every(fn=>typeof fn==='function'))throw new Error('K5_ADAPTER_REQUIRED')
 if(!Number.isSafeInteger(authorizedSubmissions)||authorizedSubmissions<0)throw new Error('K5_AUTHORIZATION_INVALID')
 const identities=new Map();let queue=Promise.resolve(),used=0
 const waitUntil=async deadline=>{while(now()<deadline)await sleep(Math.min(60_000,deadline-now()))}
 async function execute({case_id,identity:canonicalIdentity,...input}){
  if(used>=authorizedSubmissions)throw new Error('K5_NEW_AUTHORIZATION_REQUIRED')
  if(!['A','B'].includes(canonicalIdentity))throw new Error('K5_CASE_IDENTITY_REQUIRED')
  const session=await readSession(canonicalIdentity)
  if(session?.role!=='consultant'||session?.email!==K5_ACCOUNTS[canonicalIdentity==='A'?0:1]||!session.id)throw new Error('K5_CANONICAL_IDENTITY_REQUIRED')
  const policy=await readPolicy(canonicalIdentity)
  if(!Number.isSafeInteger(policy?.limit)||policy.limit<1||!Number.isSafeInteger(policy?.windowMs)||policy.windowMs<1||policy.scope!=='identity'||policy.policy!=='fixed-window')throw new Error('K5_RATE_POLICY_UNAVAILABLE')
  let state=identities.get(session.id)
  if(!state||state.limit!==policy.limit||state.windowMs!==policy.windowMs){
   // Counts before this process (including isolation probes) are unknown.
   // Quarantine a complete server window on startup/policy change; do not
   // assume a fresh quota merely because K5 itself has sent zero requests.
   state={...policy,next:now()+policy.windowMs+1000,sent:[]};identities.set(session.id,state)
  }
  state.sent=state.sent.filter(time=>time>now()-policy.windowMs)
  const deadline=Math.max(state.next,state.sent.length>=policy.limit?state.sent.at(-policy.limit)+policy.windowMs+1000:0)
  await waitUntil(deadline)
  const submittedAt=now()
  // Consume a reservation BEFORE dispatch. A transport error is not proof
  // the server did not consume quota. Never automatically retry a request.
  used++;state.sent.push(submittedAt);state.next=submittedAt+Math.ceil(policy.windowMs/policy.limit)+1000
  const record={case_id,identity:canonicalIdentity,submitted_at:submittedAt,policy:{...policy},submissions_used:used,status:'RESERVED'}
  await checkpoint(record)
  let result
  try{result=await submit({case_id,identity:canonicalIdentity,...input})}
  catch{const failure={...record,status:'FAIL',reason_code:'TRANSPORT_ERROR'};await checkpoint(failure);return failure}
  const status=Number(result.http_status)
  const limited=status===429
  if(limited||Number(result.rate_remaining)===0){
   const retryMs=Number(result.retry_after_seconds)*1000
   // A 429 pauses the identity, but the failed case stays FAIL, never retried.
   state.next=Math.max(state.next,now()+policy.windowMs+1000,Number.isFinite(retryMs)?now()+retryMs+1000:0)
  }
  const completed={...result,...record,status:limited||status>=400||!Number.isFinite(status)?'FAIL':result.status||'CAPTURED',
   ...(limited?{reason_code:result.reason_code==='APPLICATION_RATE_LIMIT'?'APPLICATION_RATE_LIMIT':'UNEXPECTED_HTTP_429'}:{})}
  await checkpoint(completed);return completed
 }
 return {runCase:input=>{const result=queue.then(()=>execute(input));queue=result.catch(()=>{});return result},
  snapshot:()=>({submissions_used:used,authorized_submissions:authorizedSubmissions,identities:[...identities.values()].map(({limit,windowMs,next})=>({limit,windowMs,next}))})}
}
