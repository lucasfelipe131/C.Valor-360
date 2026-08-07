import React, {useMemo, useState} from 'react'
import { BrainCircuit, Sparkles, Send, Target, Route, MessageSquareText } from 'lucide-react'
function advice(c){
 const p=c?.primaryProfile||''
 const s=c?.secondaryProfile||''
 let style='Conduza uma conversa consultiva com perguntas abertas e valide o próximo compromisso.'
 if(p==='Analítico') style='Priorize dados, comparativos, custo por hectare, ROI e evidências. Evite promessas genéricas.'
 if(p==='Relacional') style='Comece pela conexão e confiança. Use histórias de produtores semelhantes e acompanhamento próximo.'
 if(p==='Conservador') style='Mostre histórico, segurança, risco controlado e referências já validadas. Sugira testes pequenos.'
 if(p==='Inovador') style='Apresente novidade, potencial e benchmark, mas transforme entusiasmo em indicador mensurável.'
 if(s==='Digital') style += ' Use WhatsApp, materiais curtos e respostas rápidas.'
 return style
}
export default function ValPanel({clients,onSelect}){
 const [selected,setSelected]=useState(clients[0]?.id||'')
 const [question,setQuestion]=useState('')
 const [reply,setReply]=useState('Selecione um produtor e eu preparo a próxima melhor ação.')
 const client=useMemo(()=>clients.find(c=>c.id===selected)||clients[0],[clients,selected])
 const ask=(q)=>{
   const base=advice(client)
   const answer=`${client.name}: ${base} Oportunidade atual: ${client.commercial?.opportunity||'a mapear'}. O objetivo é sair da interação com um compromisso claro e mensurável.`
   setReply(answer); setQuestion('')
 }
 return <section className="val-console">
   <div className="val-intro">
     <div className="val-orb"><BrainCircuit size={34}/></div>
     <div><span className="eyebrow">VAL — VALUE AGRICULTURE INTELLIGENCE</span><h2>Sua inteligência comercial do agro.</h2><p>A VAL cruza perfil, relacionamento, contexto técnico e oportunidade para orientar a próxima melhor ação.</p></div>
   </div>
   <div className="val-controls">
     <select value={selected} onChange={e=>setSelected(e.target.value)}>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
     <div className="quick-prompts">
       <button onClick={()=>ask('abordagem')}><MessageSquareText size={16}/>Como abordar?</button>
       <button onClick={()=>ask('oportunidade')}><Target size={16}/>Maior oportunidade</button>
       <button onClick={()=>ask('visita')}><Route size={16}/>Preparar visita</button>
     </div>
   </div>
   <div className="val-answer"><Sparkles size={18}/><p>{reply}</p></div>
   <div className="val-input"><input value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Pergunte à VAL..." onKeyDown={e=>e.key==='Enter'&&ask(question)}/><button onClick={()=>ask(question)}><Send size={17}/></button></div>
   <button className="secondary-cta" onClick={()=>onSelect?.(client)}>Abrir Cliente 360</button>
 </section>
}
