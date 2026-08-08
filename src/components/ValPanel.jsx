import React,{useEffect,useMemo,useState} from 'react'
import {BrainCircuit,ChevronRight,MessageSquareText,Route,Send,Sparkles,Target,TrendingUp} from 'lucide-react'

function approach(client){
 const profile=client?.primaryProfile||''
 if(profile==='Analítico')return 'Comece com dados, custo por hectare e uma comparação objetiva. Torne as premissas de ROI visíveis.'
 if(profile==='Relacional')return 'Comece pela confiança, retome o histórico da relação e mostre acompanhamento próximo.'
 if(profile==='Conservador')return 'Demonstre segurança, histórico e risco controlado. Proponha um teste pequeno e mensurável.'
 if(profile==='Inovador')return 'Apresente novidade com benchmark e uma métrica clara para validar o ganho.'
 return 'Use perguntas abertas, valide o problema e combine um próximo compromisso específico.'
}

function planFor(client){return {
 objective:`Validar a necessidade em “${client?.commercial?.opportunity||'diagnóstico da propriedade'}” e sair com uma próxima ação mensurável.`,
 opening:`${client?.name?.split(' ')[0]||'Produtor'}, antes de falarmos de produto, quero entender onde está o maior impacto técnico e econômico para esta safra.`,
 questions:['Como essa situação é manejada hoje?','Onde aparecem perdas, retrabalho ou risco?','Qual é o impacto por hectare ou em produtividade?','O que precisaria ficar comprovado para avançarmos?'],
 reframe:'O maior custo nem sempre está no investimento, mas na perda que permanece invisível no manejo atual.',
 close:'Faz sentido medirmos isso em uma área e compararmos o resultado com o manejo atual?'
}}

export default function ValPanel({clients,selectedClient,onSelect}){
 const [selected,setSelected]=useState(selectedClient?.id||clients[0]?.id||'')
 const [question,setQuestion]=useState('')
 const [reply,setReply]=useState('Selecione um produtor e eu preparo a próxima melhor ação.')
 const [showPlan,setShowPlan]=useState(false)
 useEffect(()=>{if(selectedClient?.id)setSelected(selectedClient.id)},[selectedClient])
 const client=useMemo(()=>clients.find(c=>c.id===selected)||clients[0],[clients,selected])
 const plan=useMemo(()=>planFor(client),[client])
 const ask=type=>{
  const prompt=String(type||question).toLowerCase();setShowPlan(prompt.includes('visita')||prompt.includes('roteiro'))
  if(prompt.includes('oportunidade'))setReply(`${client.name}: priorize ${client.commercial?.opportunity||'o diagnóstico inicial'}. Potencial mapeado de R$ ${Number(client.commercial?.potential||0).toLocaleString('pt-BR')}. Valide o impacto antes de apresentar a solução.`)
  else if(prompt.includes('risco'))setReply(`${client.name}: o principal risco é conduzir uma abordagem genérica. ${approach(client)}`)
  else if(prompt.includes('mensagem'))setReply(`Mensagem sugerida: “Olá, ${client.name.split(' ')[0]}. Separei uma análise curta sobre ${String(client.commercial?.opportunity||'a próxima safra').toLowerCase()}. Podemos conversar 20 minutos para validar se faz sentido para sua área?”`)
  else setReply(`${client.name}: ${approach(client)} O objetivo é sair da interação com um compromisso claro, responsável e prazo.`)
  setQuestion('')
 }
 return <section className="val-console">
   <div className="val-intro"><div className="val-orb"><BrainCircuit size={34}/></div><div><span className="eyebrow">VAL — VALUE AGRICULTURE INTELLIGENCE</span><h2>Sua inteligência comercial do agro.</h2><p>A VAL cruza perfil, relacionamento, contexto técnico e oportunidade para orientar a próxima melhor ação.</p></div><span className="val-status"><i></i>Contexto ativo</span></div>
   <div className="val-controls"><select value={selected} onChange={e=>{setSelected(e.target.value);setShowPlan(false)}}>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select><div className="quick-prompts"><button onClick={()=>ask('abordagem')}><MessageSquareText size={16}/>Como abordar?</button><button onClick={()=>ask('oportunidade')}><Target size={16}/>Maior oportunidade</button><button onClick={()=>ask('visita roteiro')}><Route size={16}/>Preparar visita</button><button onClick={()=>ask('mensagem')}><Send size={16}/>Criar mensagem</button></div></div>
   <div className="val-answer"><Sparkles size={18}/><p>{reply}</p></div>
   {showPlan&&<div className="val-plan-grid"><article><small>01 • OBJETIVO</small><b>{plan.objective}</b></article><article><small>02 • ABERTURA</small><b>“{plan.opening}”</b></article><article className="wide"><small>03 • PERGUNTAS SPIN</small><ol>{plan.questions.map(q=><li key={q}>{q}</li>)}</ol></article><article><small>04 • REFRAME</small><b>{plan.reframe}</b></article><article><small>05 • FECHAMENTO</small><b>“{plan.close}”</b></article></div>}
   <div className="val-input"><input value={question} onChange={e=>setQuestion(e.target.value)} placeholder="Pergunte à VAL sobre este produtor..." onKeyDown={e=>e.key==='Enter'&&ask(question)}/><button onClick={()=>ask(question)}><Send size={17}/></button></div>
   <button className="secondary-cta" onClick={()=>onSelect?.(client)}>Abrir Cliente 360 <ChevronRight size={16}/></button>
 </section>
}
