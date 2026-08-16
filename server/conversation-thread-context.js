import {extractProductMentions} from './conversation-orchestrator-runtime.js'

const array=value=>Array.isArray(value)?value:[]
const clean=(value,max=3000)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const questionOf=item=>clean(item?.user_question||item?.userQuestion||item?.question)
const technicalCommercial=/\b(?:manejo|inseticida|herbicida|fungicida|cigarrinha|enfezamento|desseca[cç][aã]o|produto|dose|aplica[cç][aã]o|venda|valor|pre[cç]o|custo|proposta|negocia[cç][aã]o)\b/i
const continuation=/^(?:pode\s+)?(?:seguir|continue|continuar|prossiga|avan[cç]e|pr[oó]ximo|e agora|ent[aã]o|como sigo|fa[cç]a isso|monte|aprofunde)\b|\b(?:pode seguir|siga com isso|continue a conversa|retome o assunto|pr[oó]ximo passo)\b/i
const reset=/\b(?:novo assunto|outra conta|outro produtor|ignore a conversa anterior|desconsidere o anterior|mudar de assunto)\b/i

function activeAnchor(history=[]){
  const productAnchor=history.find(item=>extractProductMentions(questionOf(item)).length>0)
  if(productAnchor)return productAnchor
  return history.find(item=>technicalCommercial.test(questionOf(item)))||null
}

export function prepareConversationThread(context={},message=''){
  const history=array(context.priorRecommendations)
  if(!history.length||reset.test(String(message||'')))return {context,message:String(message||''),anchor:null,continued:false}
  const anchor=activeAnchor(history)
  if(!anchor)return {context,message:String(message||''),anchor:null,continued:false}
  const latest=history[0]
  const latestQuestion=questionOf(latest)
  const anchorQuestion=questionOf(anchor)
  const latestHasProducts=extractProductMentions(latestQuestion).length>0
  const needsContinuation=continuation.test(clean(message))||(!extractProductMentions(message).length&&clean(message).length<=180)
  const combinedLatest=latestHasProducts||latest===anchor
    ?latest
    :{...latest,user_question:`${latestQuestion}\nContexto técnico-comercial ativo das conversas anteriores: ${anchorQuestion}`}
  const priorRecommendations=[combinedLatest,...history.slice(1)]
  const effectiveMessage=needsContinuation
    ?`${clean(message)}\nContinue a sequência técnica e comercial já iniciada. Contexto ativo: ${anchorQuestion}`
    :String(message||'')
  return {
    context:{...context,priorRecommendations},
    message:effectiveMessage,
    originalMessage:String(message||''),
    anchor:{id:anchor.id||null,question:anchorQuestion,products:extractProductMentions(anchorQuestion).map(item=>item.name),createdAt:anchor.created_at||anchor.createdAt||null},
    continued:needsContinuation
  }
}
