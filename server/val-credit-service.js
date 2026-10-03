const fault=(status,message,code)=>Object.assign(new Error(message),{status,code})
export function createValCreditService({baseUrl=process.env.VAL_CRED_BASE_URL,token=process.env.VAL_CRED_TOKEN,fetchImpl=fetch}={}){
 let origin=null
 try{const url=new URL(baseUrl);if(url.protocol==='https:'&&!url.username&&!url.password&&url.pathname==='/')origin=url.origin}catch{}
 const configured=Boolean(origin&&token?.length>=32)
 async function call(operation,scope,input){
  if(!configured)return {contract:'val.credit.v1',status:'NOT_CONFIGURED',...scope,requests:[]}
  if(!scope.tenantId||!scope.ownerId||!scope.clientId)throw fault(403,'Carteira e produtor obrigatórios.','credit_scope_required')
  const url=new URL(`/api/integrations/val/${operation}`,origin)
  const mutation=operation!=='context'
  if(!mutation)for(const [key,value] of Object.entries(scope))url.searchParams.set(key,value)
  const response=await fetchImpl(url,{method:mutation?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(5000),headers:{Authorization:`Bearer ${token}`,'x-val-tenant-id':scope.tenantId,...(mutation?{'Content-Type':'application/json'}:{})},...(mutation?{body:JSON.stringify({...input,...scope})}:{})})
  if(Number(response.headers.get('content-length'))>250_000)throw fault(502,'Resposta de crédito acima do limite.','credit_response_invalid')
  let bytes=0;const chunks=[]
  for await(const chunk of response.body){bytes+=chunk.length;if(bytes>250_000)throw fault(502,'Resposta de crédito acima do limite.','credit_response_invalid');chunks.push(chunk)}
  let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{throw fault(502,'Resposta de crédito inválida.','credit_response_invalid')}
  if(!response.ok)throw fault(response.status===422||response.status===409?response.status:502,data.error||'A VAL CRED não respondeu à consulta.','credit_upstream_error')
  if(!mutation){
   if(data.contract!=='val.credit.v1'||!['LINKED','NOT_LINKED'].includes(data.status)||Object.keys(scope).some(key=>data[key]!==scope[key])||!Array.isArray(data.requests))throw fault(502,'A resposta de crédito não corresponde ao produtor autorizado.','credit_scope_mismatch')
   // The bridge exposes recorded decisions; it cannot issue or approve credit.
   return {contract:data.contract,status:data.status,...scope,producer:data.producer?{id:data.producer.id,name:data.producer.name}:null,requests:data.requests.slice(0,20).map(r=>({id:r.id,title:r.title,status:r.status,principal:Number.isFinite(r.principal)?r.principal:null,revision:r.revision,observedAt:r.observedAt,analysisStatus:r.analysisStatus,analyzedAt:r.analysis?.observedAt||null,decision:r.analysisStatus==='CURRENT_REVISION'&&r.decision?{value:r.decision.value,observedAt:r.decision.observedAt}:null})),fetchedAt:data.fetchedAt,humanReviewRequired:true}
  }
  return data
 }
 return {configured,applicationUrl:origin,read:scope=>call('context',scope),link:(scope,input)=>call('link',scope,input),unlink:scope=>call('unlink',scope)}
}

export function creditPresentation(context,{tenantId,ownerId,clientId}={}){
 const action='Consulte a aba Crédito do produtor para abrir a VAL CRED e revisar a solicitação.'
 const base={dataPath:'CREDIT_REQUEST',primaryFound:false,sourceRef:null,factsUsed:[],action,doNotDo:'Não considerar uma solicitação ou decisão registrada como dinheiro disponível.',missing:'Solicitação de crédito vinculada e consultada na VAL CRED.'}
 if(context.status!=='LINKED')return {...base,answer:context.status==='NOT_LINKED'?'Informação ausente: este produtor ainda não possui vínculo verificado com a VAL CRED.':'Informação ausente: a VAL CRED não pôde ser consultada agora.'}
 if(!context.requests.length)return {...base,answer:'Informação ausente: não há solicitação de crédito registrada no cadastro vinculado da VAL CRED.'}
 const statements=context.requests.slice(0,3).map(r=>{
  const date=new Date(r.observedAt).toLocaleDateString('pt-BR')
  const amount=r.principal===null?'valor não informado':`valor solicitado ${Number(r.principal).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}`
  const analysis=r.analysisStatus==='OUTDATED_REVISION'?'análise anterior à revisão atual':r.analysisStatus==='CURRENT_REVISION'?'análise da revisão atual':'sem análise registrada'
  return {r,statement:`Crédito registrado na VAL CRED em ${date}: ${r.title}, ${amount}, situação ${r.status}; ${analysis}${r.decision?`; decisão registrada ${r.decision.value} em ${new Date(r.decision.observedAt).toLocaleDateString('pt-BR')}`:''}.`}
 })
 const factsUsed=statements.map(({r,statement})=>({id:`val-cred-${r.id}-${r.revision}`,source_type:'credit_request',statement,observed_at:r.observedAt,presented_as:'HISTORICAL_REFERENCE',tenant_id:tenantId,owner_id:ownerId,producer_id:clientId,epistemic_type:'FACT'}))
 return {...base,primaryFound:true,sourceRef:factsUsed[0].id,factsUsed,answer:statements.map(row=>row.statement).join(' '),keyUncertainty:'A solicitação não comprova liberação ou saldo disponível.',whatToValidate:'Revise a versão vigente da solicitação na VAL CRED antes de uma decisão financeira.'}
}
