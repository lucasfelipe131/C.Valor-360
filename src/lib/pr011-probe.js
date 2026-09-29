const accounts=['uat.val.20260919.a@example.test','uat.val.20260919.b@example.test']
export const pr011Visible=(user,hostname)=>hostname==='val-web-staging-production.up.railway.app'&&user?.pr011Qa===true&&user.role==='consultant'&&!user.demo&&accounts.includes(user.email)
const ownA='/api/clients/k5-uat-producer-a/conversion-studio'
const ownB='/api/clients/k5-uat-portfolio-b-exclusive/conversion-studio'
const safeDenials=new Set(['Cliente não encontrado na base autorizada.','Produtor não encontrado na sua carteira autorizada.','Produtor não encontrado na carteira autorizada.','Produtor não encontrado na sua carteira.'])

// Only fixed routes and browser-managed credentials. No caller-supplied identity,
// headers, query parameters, producer content or tokens enter the result.
export async function runPr011Probe({fetchImpl=fetch,hostname,expectedEmail}){
 const options={credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)}
 const sessionResponse=await fetchImpl('/api/auth/session',options)
 const session=await sessionResponse.json()
 if(sessionResponse.status!==200||!session.authenticated||!pr011Visible(session.user,hostname)||session.user.email!==expectedEmail)throw new Error('Sessão UAT/staging não confirmada. Nenhuma prova executada.')
 const email=session.user.email
 const requests=email===accounts[0]?[['PR011_A_OWN',ownA,false],['PR011_A_TO_B',ownB,true]]:[['PR011_B_OWN',ownB,false]]
 const results=[]
 for(const [check,path,foreign] of requests){
  const response=await fetchImpl(path,{...options,signal:AbortSignal.timeout(15000)})
  const payload=await response.json().catch(()=>null)
  const cleanDenial=payload&&Object.keys(payload).length===1&&safeDenials.has(payload.error)
  const passed=foreign?response.status===404&&cleanDenial:response.status===200&&typeof payload?.client?.id==='string'&&Boolean(payload.client.id)
  results.push({check,path,httpStatus:response.status,result:passed?(foreign?'BLOCKED':'PASS'):'FAIL',...(foreign?{dataLeak:cleanDenial&&response.status===404?0:'NOT_EXCLUDED'}:{}),...(cleanDenial?{responseError:payload.error}:{}),checkedAt:new Date().toISOString()})
  if(!passed)break
 }
 return {sessionAuthenticated:true,email,role:session.user.role,results}
}
