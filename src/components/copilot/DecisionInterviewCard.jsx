import React from 'react'
import {CheckCircle2,MessageCircleQuestion,ShieldCheck} from 'lucide-react'

export default function DecisionInterviewCard({interview,onReply,onRegister}){
 const questions=Array.isArray(interview?.questions)?interview.questions.slice(0,3):[]
 if(interview?.status!=='NEEDS_INPUT'||!questions.length)return null
 return <section className="global-val-interview" aria-labelledby={`decision-interview-${String(interview?.session_context?.conversation_id||'current').replace(/[^a-z0-9_-]/gi,'')}`}>
  <header><MessageCircleQuestion/><div><small>DECISION INTERVIEW</small><h3 id={`decision-interview-${String(interview?.session_context?.conversation_id||'current').replace(/[^a-z0-9_-]/gi,'')}`}>Antes de concluir, preciso de {questions.length===1?'uma resposta':`${questions.length} respostas`}.</h3><p>{interview.explanation}</p></div></header>
  <ol>{questions.map((item,index)=><li key={`${item.field}-${index}`}><span>{index+1}</span><div><b>{item.question}</b><small>{item.why}</small><button type="button" onClick={()=>onReply?.(item)}>Responder agora</button></div></li>)}</ol>
  <footer><ShieldCheck/><span><b>Usar só nesta conversa</b><small>Sua resposta recalcula a leitura, mas não altera a memória confirmada.</small></span><button type="button" onClick={onRegister}><CheckCircle2/>Registrar no histórico</button></footer>
 </section>
}
