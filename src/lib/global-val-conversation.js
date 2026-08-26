export const VAL_CHAT_MESSAGE_LIMIT=3000

const marketIntents=new Set(['ASK_MARKET','ASK_COMMODITY','CHECK_MARKET'])
const commodityCodes=['soja','milho','trigo','sorgo','feijao','arroz','cevada']
const clean=(value,max=20_000)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const normalize=value=>clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('pt-BR')
const boundedLimit=value=>Math.max(1,Math.min(VAL_CHAT_MESSAGE_LIMIT-1,Number(value)||VAL_CHAT_MESSAGE_LIMIT-1))
const clip=(value,max)=>{
 const text=clean(value)
 if(text.length<=max)return text
 if(max<=1)return text.slice(0,max)
 return `${text.slice(0,max-1).trimEnd()}…`
}

export const isMarketIntent=intent=>marketIntents.has(String(intent||'').toUpperCase())

export function normalizeValChatPayload(value){
 const source=value&&typeof value==='object'?value:null
 if(!source)return null
 const candidates=[source,source.recommendation,source.result,source.data,source.response]
 return candidates.find(candidate=>candidate?.advice&&typeof candidate.advice==='object')||null
}

function lastCommodity(value=''){
 const source=normalize(value)
 let selected='';let selectedAt=-1
 for(const commodity of commodityCodes){
  const matcher=new RegExp(`\\b${commodity}\\b`,'g');let match
  while((match=matcher.exec(source))){if(match.index>=selectedAt){selected=commodity;selectedAt=match.index}}
 }
 return selected
}

function seasonFrom(value=''){
 const matches=[...clean(value).matchAll(/\b(20\d{2})\s*[\/_-]\s*((?:20)?\d{2})\b/g)]
 const match=matches.at(-1)
 if(!match)return ''
 const end=match[2].length===2?match[2]:match[2].slice(-2)
 return `${match[1]}/${end}`
}

export const isContextualContinuation=prompt=>{
 const source=clean(prompt)
 if(/\b(?:prepar|roteiro|antes da)\w*\b.*\b(?:visita|conversa|negoci(?:ar|a[cç][aã]o|a[cç][oõ]es))\b|\b(?:visita|conversa|negoci(?:ar|a[cç][aã]o|a[cç][oõ]es))\b.*\b(?:prepar|roteiro)\w*\b/i.test(source))return false
 return /\b(?:isso|isto|aquilo|ele|ela|eles|elas|dele|dela|deles|delas|ess[ae]|ess[ae]s|ness[ae]|ness[ae]s|dess[ae]|dess[ae]s)\b/i.test(source)
  ||Boolean(lastCommodity(source)&&/^\s*(?:e|agora|mas|quanto\s+a)\b/i.test(source))
}

export function latestAssistantAnchor(thread=[]){
 const turns=Array.isArray(thread)?thread:[]
 for(let index=turns.length-1;index>=0;index-=1){
  const turn=turns[index]
  if(turn?.role!=='assistant')continue
  const reasoning=turn?.payload?.advice?.ai_reasoning||{}
  let objective=clean(reasoning.objective,1200)
  if(!objective){
   for(let userIndex=index-1;userIndex>=0;userIndex-=1){
    if(turns[userIndex]?.role==='user'){
     objective=clean(turns[userIndex].text,1200)
     break
    }
   }
  }
  return {
   intent:String(reasoning.intent||''),
   objective,
   at:String(turn.at||''),
   index
  }
 }
 return null
}

const timestamp=anchor=>{
 const value=Date.parse(anchor?.at||'')
 return Number.isFinite(value)?value:0
}

export function selectMarketContinuation({prompt,localThread=[],globalThread=[],hasClient=false}={}){
 if(!isContextualContinuation(prompt))return null
 const local=latestAssistantAnchor(localThread)
 const global=hasClient?latestAssistantAnchor(globalThread):null
 const candidates=[local,global].filter(anchor=>isMarketIntent(anchor?.intent)&&anchor?.objective)
 if(!candidates.length)return null
 return candidates.sort((left,right)=>timestamp(right)-timestamp(left))[0]
}

export function sessionRepliesForAsk({replies=[],activeReply,intent}={}){
 if(!activeReply?.question)return []
 const requestedIntent=String(intent||'')
 return (Array.isArray(replies)?replies:[]).filter(item=>!requestedIntent||item?.intent===requestedIntent)
}

function boundedReplyText({prefix,replies,maxLength=VAL_CHAT_MESSAGE_LIMIT-1}={}){
 const limit=boundedLimit(maxLength)
 const safePrefix=clip(prefix,Math.min(900,limit))
 const normalized=(Array.isArray(replies)?replies:[]).slice(-6).map((item,index)=>({
  index:index+1,
  answer:clean(item?.answer),
  field:clean(item?.field,80).replace(/[^a-z0-9_-]/gi,'_')||'material_response'
 })).filter(item=>item.answer)
 const blocks=normalized.map(item=>`Resposta ${item.index} [${item.field}]: ${item.answer}.`)
 if(!blocks.length)return safePrefix
 const full=[safePrefix,...blocks].filter(Boolean).join('\n')
 if(full.length<=limit)return full
 const contentBudget=Math.max(1,limit-safePrefix.length-blocks.length)
 if(blocks.length===1)return [safePrefix,clip(blocks[0],contentBudget)].filter(Boolean).join('\n').slice(0,limit)
 const olderBudget=Math.floor(contentBudget*.42)
 const perOlder=Math.max(1,Math.floor(olderBudget/(blocks.length-1)))
 const selected=blocks.slice(0,-1).map(block=>clip(block,perOlder))
 const recentBudget=Math.max(1,contentBudget-selected.reduce((total,block)=>total+block.length,0))
 selected.push(clip(blocks.at(-1),recentBudget))
 return [safePrefix,...selected].filter(Boolean).join('\n').slice(0,limit)
}

export function buildSessionReplyMessage({objective,replies,maxLength}={}){
 return boundedReplyText({
  prefix:`Solicitação original: ${clean(objective,700)}. Contexto informado apenas nesta sessão; não promover a memória:`,
  replies,
  maxLength
 })
}

export function buildRegisterPrefill(replies=[],maxLength=VAL_CHAT_MESSAGE_LIMIT-1){
 if(!Array.isArray(replies)||!replies.length)return ''
 const latest=[...replies].reverse().find(item=>item?.answer)||replies.at(-1)||{}
 const objective=clean(latest.objective||replies.find(item=>item?.objective)?.objective,700)
 const commodity=clean(latest.commodity||lastCommodity(objective),40)
 const season=clean(latest.season||seasonFrom(objective),40)
 const intent=clean(latest.intent||replies.find(item=>item?.intent)?.intent,80)
 const metadata=[
  'VAL_SESSION_REGISTER_V1',
  `Objetivo: ${objective||'não informado'}.`,
  `Intenção: ${intent||'não informada'}.`,
  `Commodity: ${commodity||'não informada'}.`,
  `Safra: ${season||'não informada'}.`,
  'Revise e confirme somente as respostas abaixo:'
 ].join('\n')
 const result=boundedReplyText({
  prefix:metadata,
  replies,
  maxLength
 })
 return `${result}\nFIM_VAL_SESSION_REGISTER_V1`.slice(0,boundedLimit(maxLength))
}

export function buildMarketContinuationMessage({objective,prompt,maxLength=VAL_CHAT_MESSAGE_LIMIT-1}={}){
 const limit=boundedLimit(maxLength)
 const prefix='Objetivo global anterior: '
 const separator='. Continuação no contexto do produtor: '
 const safeObjective=clip(objective,Math.min(900,Math.max(1,limit-prefix.length-separator.length-1)))
 const available=Math.max(1,limit-prefix.length-safeObjective.length-separator.length)
 return `${prefix}${safeObjective}${separator}${clip(prompt,available)}`.slice(0,limit)
}

export const limitValChatMessage=(value,maxLength=VAL_CHAT_MESSAGE_LIMIT-1)=>clip(value,boundedLimit(maxLength))
