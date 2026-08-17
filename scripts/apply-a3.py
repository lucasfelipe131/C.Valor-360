from pathlib import Path

path=Path('server/val-engine.js')
source=path.read_text()
start=source.find('export function compactValContext(context,max=30000){')
end=source.find('\nfunction safeError',start)
if start<0 or end<0:
    raise RuntimeError('A3: compactValContext não localizado')
replacement=r'''const VAL_CONTEXT_STOP_WORDS=new Set(['a','ao','aos','as','com','como','da','das','de','do','dos','e','em','esta','este','eu','me','meu','minha','na','nas','no','nos','o','os','ou','para','por','que','se','sem','ser','sobre','sua','suas','um','uma','uns','umas','val','valor','produtor','cliente','conta'])
const VAL_CONTEXT_DATE_KEYS=['updated_at','updatedAt','occurred_at','occurredAt','created_at','createdAt','scheduled_at','scheduledAt','observed_at','observedAt','reported_at','reportedAt','recorded_at','recordedAt','next_action_at','nextActionAt','date','at','assessedAt','confirmedAt','uploadedAt','validUntil','expires_at','expiresAt']
const VAL_CONTEXT_LIMITS=Object.freeze({businessHistory:30,visits:20,interactions:30,properties:20,fieldReports:12,soilAnalyses:12,ndviObservations:20,manualRecords:20,signals:15,memories:20,priorRecommendations:6,attachments:12,currentAttachments:3})

const normalizeContextSearch=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim()
export function valContextTopicTokens(message=''){
  const normalized=normalizeContextSearch(message)
  return [...new Set(normalized.split(' ').filter(token=>token.length>=3&&!VAL_CONTEXT_STOP_WORDS.has(token)))].slice(0,24)
}

function safeContextString(item){
  try{return normalizeContextSearch(JSON.stringify(item))}catch{return normalizeContextSearch(String(item??''))}
}

function dateTimestamp(value){
  if(value instanceof Date&&!Number.isNaN(value.getTime()))return value.getTime()
  if(typeof value==='number'&&value>1_000_000_000_000)return value
  if(typeof value!=='string'||!value.trim())return 0
  const parsed=Date.parse(value)
  return Number.isNaN(parsed)?0:parsed
}

function contextTimestamp(item,depth=0){
  if(!item||typeof item!=='object'||depth>2)return 0
  let newest=0
  for(const key of VAL_CONTEXT_DATE_KEYS)if(Object.prototype.hasOwnProperty.call(item,key))newest=Math.max(newest,dateTimestamp(item[key]))
  if(depth<2)for(const [key,value] of Object.entries(item)){
    if(value&&typeof value==='object'&&!Array.isArray(value)&&!/^(?:client|commercial|answers)$/i.test(key))newest=Math.max(newest,contextTimestamp(value,depth+1))
  }
  return newest
}

function contextRecencyScore(timestamp,nowMs){
  if(!timestamp)return 0
  const days=(nowMs-timestamp)/86_400_000
  if(days<0)return days>=-30?34:days>=-120?18:6
  if(days<=7)return 34
  if(days<=30)return 27
  if(days<=90)return 20
  if(days<=180)return 13
  if(days<=365)return 7
  return 2
}

function contextImportance(item,kind){
  let score=0
  const stage=normalizeContextSearch(item?.stage||item?.status)
  if(kind==='opportunities'){
    if(!/(?:fechado|closed|ganho|won|perdido|lost|descartado)/.test(stage))score+=20
    if(item?.next_action_at||item?.nextActionAt)score+=8
    if(Number(item?.estimated_value??item?.estimatedValue??item?.value)>0)score+=5
  }
  if(kind==='currentAttachments')score+=80
  if(kind==='attachments'&&['confirmed','stored','interpreted'].includes(String(item?.status||'')))score+=8
  if(Array.isArray(item?.evidence)&&item.evidence.length)score+=6
  if(item?.requires_agronomist===true||item?.requiresAgronomist===true)score+=5
  if(item?.validation?.status==='approved'||item?.validated===true)score+=6
  return score
}

function contextRelevanceScore(item,tokens,normalizedMessage,kind){
  if(!tokens.length)return contextImportance(item,kind)
  const text=safeContextString(item)
  let score=contextImportance(item,kind)
  let matched=0
  for(const token of tokens)if(text.includes(token)){matched+=1;score+=token.length>=8?30:token.length>=5?24:18}
  if(matched>1)score+=(matched-1)*10
  if(normalizedMessage.length>=8&&text.includes(normalizedMessage))score+=50
  for(let index=0;index<tokens.length-1;index++)if(text.includes(tokens[index]+' '+tokens[index+1]))score+=18
  return score
}

export function rankValContextItems(items=[],message='',{kind='generic',now=new Date()}={}){
  const list=Array.isArray(items)?items:[]
  const tokens=valContextTopicTokens(message)
  const normalizedMessage=normalizeContextSearch(message)
  const nowMs=now instanceof Date?now.getTime():dateTimestamp(now)||Date.now()
  return list.map((item,index)=>{
    const timestamp=contextTimestamp(item)
    const relevance=contextRelevanceScore(item,tokens,normalizedMessage,kind)
    const recency=contextRecencyScore(timestamp,nowMs)
    return {item,index,timestamp,relevance,score:relevance+recency}
  }).sort((left,right)=>right.score-left.score||right.relevance-left.relevance||right.timestamp-left.timestamp||left.index-right.index).map(entry=>entry.item)
}

function rankContextCollections(context,message,now){
  const ranked={...context}
  for(const key of Object.keys(VAL_CONTEXT_LIMITS))ranked[key]=rankValContextItems(context[key],message,{kind:key,now})
  return ranked
}

const takeRanked=(value,limit)=>Array.isArray(value)?value.slice(0,limit):[]
const contextSize=value=>JSON.stringify(value).length

function compactOpportunity(item){return {id:item.id,externalKey:item.external_key??item.externalKey,title:compactText(item.title,220),category:compactText(item.category,120),stage:item.stage,estimatedValue:Number(item.estimated_value??item.estimatedValue??0),probability:item.probability==null?null:Number(item.probability),nextAction:compactText(item.next_action??item.nextAction,500),nextActionAt:item.next_action_at??item.nextActionAt,updatedAt:item.updated_at??item.updatedAt,evidence:compactOpportunityEvidence(item.evidence)}}
function opportunityIndex(opportunities,titleLimit=30,stageLimit=24){return {fields:['título','etapa','valor','probabilidade','próxima ação em'],items:opportunities.map(item=>[compactText(item.title,titleLimit),compactText(item.stage,stageLimit),item.estimatedValue,item.probability,item.nextActionAt||null])}}

function trimLeastRelevantArrays(target,max){
  const trimOrder=['attachments','manualRecords','fieldReports','soilAnalyses','ndviObservations','signals','businessHistory','interactions','visits','properties','memories','priorRecommendations','currentAttachments']
  let changed=True
  while(contextSize(target)>max&&changed){
    changed=false
    for(const key of trimOrder){
      if(Array.isArray(target[key])&&target[key].length){target[key]=target[key].slice(0,-1);changed=true;if(contextSize(target)<=max)break}
    }
  }
  return target
}

export function compactValContext(context,max=30000,message='',options={}){
  const maxChars=Math.max(4_000,Number(max)||30_000)
  const now=options.now instanceof Date?options.now:new Date(options.now||Date.now())
  const ranked=rankContextCollections(context,message,now)
  const opportunities=rankValContextItems(context.opportunities,message,{kind:'opportunities',now}).map(compactOpportunity)
  const candidate={...ranked,opportunities,opportunityPortfolio:{total:opportunities.length,open:opportunities.filter(item=>!/(?:fechado|closed|ganho|won|perdido|lost|descartado)/i.test(String(item.stage||''))).length,totalOpenValue:opportunities.filter(item=>!/(?:fechado|closed|ganho|won|perdido|lost|descartado)/i.test(String(item.stage||''))).reduce((sum,item)=>sum+item.estimatedValue,0)}}
  if(contextSize(candidate)<=maxChars)return candidate

  const reduced={...candidate}
  for(const [key,limit] of Object.entries(VAL_CONTEXT_LIMITS))reduced[key]=takeRanked(candidate[key],limit)
  if(contextSize(reduced)<=maxChars)return reduced

  const titleLimit=Math.max(30,Math.min(100,Math.floor((maxChars-6_000)/Math.max(opportunities.length,1))-70))
  const {opportunities:ignored,...withoutOpportunities}=reduced
  const indexed=trimLeastRelevantArrays({...withoutOpportunities,opportunityIndex:opportunityIndex(opportunities,titleLimit,30)},maxChars)
  if(contextSize(indexed)<=maxChars)return indexed

  const client=context.client||{}
  const minimal=trimLeastRelevantArrays({
    client:{id:client.id,name:compactText(client.name,180),municipality:compactText(client.municipality,140),commercial:client.commercial},
    profile:{answers:context.profile?.answers||{},assessedAt:context.profile?.assessedAt,validUntil:context.profile?.validUntil},
    opportunityPortfolio:candidate.opportunityPortfolio,
    opportunityIndex:opportunityIndex(opportunities,30,24),
    signals:takeRanked(ranked.signals,5),manualRecords:takeRanked(ranked.manualRecords,5),fieldReports:takeRanked(ranked.fieldReports,3),memories:takeRanked(ranked.memories,5),attachments:takeRanked(ranked.attachments,6),currentAttachments:takeRanked(ranked.currentAttachments,3)
  },maxChars)
  if(contextSize(minimal)<=maxChars)return minimal

  // Último nível: preserva todo o índice de oportunidades e remove detalhes duplicados que já são enviados em blocos próprios do prompt.
  for(const limit of [24,18,12,8]){
    const emergency={client:{id:client.id,name:compactText(client.name,120)},opportunityPortfolio:candidate.opportunityPortfolio,opportunityIndex:opportunityIndex(opportunities,limit,16)}
    if(contextSize(emergency)<=maxChars)return emergency
  }
  return {client:{id:client.id,name:compactText(client.name,80)},opportunityPortfolio:candidate.opportunityPortfolio,opportunityIndex:{fields:['título'],items:opportunities.map(item=>[compactText(item.title,8)])}}
}'''
# Python literal leaked a boolean spelling in JS; normalize it deliberately.
replacement=replacement.replace('let changed=True','let changed=true').replace('changed=False','changed=false').replace('changed=True','changed=true')
source=source[:start]+replacement+source[end:]
old="JSON.stringify(compactValContext(context,this.config.maxContextChars))"
new="JSON.stringify(compactValContext(context,this.config.maxContextChars,message))"
if source.count(old)!=1:
    raise RuntimeError('A3: chamada compactValContext não encontrada de forma única')
source=source.replace(old,new,1)
path.write_text(source)

# Documentation
path=Path('docs/VAL_ENGINE.md')
docs=path.read_text()
marker='## Auditoria do roteamento de modelos\n'
section='''## Compactação orientada ao assunto atual\n\n`compactValContext()` não usa mais a posição original de uma lista como sinônimo de importância. Antes de aplicar qualquer limite, cada coleção é ordenada por dois sinais auditáveis e determinísticos:\n\n1. **relevância**: sobreposição entre os termos da solicitação atual e o conteúdo do registro, com bônus para combinações consecutivas e para oportunidades ainda abertas;\n2. **recência**: data mais nova localizada nos campos conhecidos de criação, atualização, observação, visita, interação ou próxima ação.\n\nA relevância tem peso suficiente para que um registro antigo sobre o assunto atual possa aparecer antes de um registro recente, porém alheio à pergunta. Em empates, vence o registro mais recente e, depois, a ordem original, garantindo resultado estável.\n\nA compactação continua em níveis: contexto completo, coleções priorizadas, índice compacto de oportunidades e contexto mínimo. Ao reduzir uma lista, os itens menos relevantes são retirados primeiro. Todas as oportunidades permanecem no índice compacto, inclusive quando o restante do dossiê precisa ser reduzido. O texto da solicitação é usado somente para ordenar registros; ele não cria fatos, evidências ou campos novos.\n\nO limite `maxContextChars` continua sendo verificado após cada nível. `decisionIntelligence`, `productIntelligence` e anexos atuais também são enviados em blocos próprios, portanto detalhes duplicados podem sair do último nível sem perda desses contratos.\n\n'''
if docs.count(marker)!=1:
    raise RuntimeError('A3: marcador de auditoria do roteamento não encontrado')
path.write_text(docs.replace(marker,section+marker,1))

Path('test/val-context-relevance.test.js').write_text(r'''import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {compactValContext,rankValContextItems,valContextTopicTokens} from '../server/val-engine.js'

const now=new Date('2026-08-17T12:00:00.000Z')

test('tokens do assunto removem palavras genéricas e preservam termos técnicos',()=>{
 assert.deepEqual(valContextTopicTokens('Preciso falar com o produtor sobre cigarrinha e Efficon no milho.'),['preciso','falar','cigarrinha','efficon','milho'])
})

test('registro antigo e relevante vence registro recente sem relação com a pergunta',()=>{
 const items=[
  {id:'recente',summary:'Planejamento de trigo e armazenagem',updatedAt:'2026-08-16T12:00:00.000Z'},
  {id:'relevante',summary:'Histórico de cigarrinha no milho e conversa sobre Efficon',updatedAt:'2025-01-10T12:00:00.000Z'}
 ]
 const ranked=rankValContextItems(items,'manejo de cigarrinha com Efficon',{kind:'interactions',now})
 assert.deepEqual(ranked.map(item=>item.id),['relevante','recente'])
})

test('entre registros igualmente relevantes, o mais recente vem primeiro e o empate é estável',()=>{
 const items=[
  {id:'antigo',summary:'cigarrinha no milho',updatedAt:'2026-01-01T12:00:00.000Z'},
  {id:'novo',summary:'cigarrinha no milho',updatedAt:'2026-08-16T12:00:00.000Z'},
  {id:'sem-data-a',summary:'cigarrinha no milho'},
  {id:'sem-data-b',summary:'cigarrinha no milho'}
 ]
 const first=rankValContextItems(items,'cigarrinha no milho',{kind:'visits',now})
 const second=rankValContextItems(items,'cigarrinha no milho',{kind:'visits',now})
 assert.deepEqual(first.map(item=>item.id),['novo','antigo','sem-data-a','sem-data-b'])
 assert.deepEqual(second,first)
})

test('compactação corta depois de ordenar e respeita o limite configurado',()=>{
 const businessHistory=Array.from({length:80},(_,index)=>({id:`hist-${index}`,summary:index===79?'cigarrinha Efficon milho':'assunto sem relação '+index,updatedAt:index===79?'2024-01-01T00:00:00.000Z':'2026-08-16T00:00:00.000Z',detail:'registro '.repeat(120)}))
 const context={client:{id:'p1',name:'Produtor Teste'},businessHistory,visits:[],interactions:[],properties:[],fieldReports:[],soilAnalyses:[],ndviObservations:[],manualRecords:[],signals:[],memories:[],priorRecommendations:[],attachments:[],currentAttachments:[],opportunities:[]}
 const compact=compactValContext(context,12_000,'cigarrinha Efficon',{now})
 assert.ok(JSON.stringify(compact).length<=12_000)
 assert.equal(compact.businessHistory?.[0]?.id,'hist-79')
})

test('índice compacto mantém todas as oportunidades em ordem relevante',()=>{
 const opportunities=Array.from({length:200},(_,index)=>({id:`opp-${index}`,title:index===199?'Efficon para cigarrinha':`Oportunidade ${index}`,stage:index%4===0?'Fechado':'Diagnóstico',estimated_value:index*1000,probability:null,next_action_at:'2026-09-01T12:00:00.000Z',evidence:[{summary:'evidência '.repeat(20)}]}))
 const context={client:{id:'p1',name:'Produtor Teste'},opportunities,businessHistory:Array.from({length:40},()=>({detail:'histórico '.repeat(300)})),visits:[],interactions:[],properties:[],fieldReports:[],soilAnalyses:[],ndviObservations:[],manualRecords:[],signals:[],memories:[],priorRecommendations:[],attachments:[],currentAttachments:[]}
 const compact=compactValContext(context,30_000,'Efficon cigarrinha',{now})
 const items=compact.opportunities||compact.opportunityIndex?.items||[]
 assert.equal(items.length,200)
 const firstTitle=Array.isArray(items[0])?items[0][0]:items[0].title
 assert.match(firstTitle,/Efficon/i)
 assert.ok(JSON.stringify(compact).length<=30_000)
})

test('engine entrega a mensagem atual ao compactador',()=>{
 const engine=readFileSync(new URL('../server/val-engine.js',import.meta.url),'utf8')
 assert.match(engine,/compactValContext\(context,this\.config\.maxContextChars,message\)/)
 assert.doesNotMatch(engine,/businessHistory:\(candidate\.businessHistory\|\|\[\]\)\.slice\(0,30\)/)
})
''')

Path('scripts/apply-a3.py').unlink(missing_ok=True)
Path('.github/workflows/apply-a3.yml').unlink(missing_ok=True)
print('A3 aplicado com sucesso.')
