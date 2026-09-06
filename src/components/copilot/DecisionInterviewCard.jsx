import React,{useId} from 'react'
import {CheckCircle2,ListChecks,MessageCircleQuestion,ShieldCheck} from 'lucide-react'

// Entradas materiais que as ferramentas declaram por chave tecnica; o consultor precisa ler o que
// falta, nao o nome do campo.
const inputLabels={
 areaHa:'Área (ha)',populationSeedsHa:'População de plantas por hectare',populationPlantsHa:'População de plantas por hectare',bagSeeds:'Sementes por saco',
 spacingCm:'Espaçamento entre linhas (cm)',rowSpacingCm:'Espaçamento entre linhas (cm)',seedsPerMeter:'Sementes por metro',germinationPct:'Germinação (%)',
 totalCost:'Custo total',totalCostBrl:'Custo total (R$)',revenue:'Receita',price:'Preço',productivity:'Produtividade',
 image:'Foto ou imagem para o diagnóstico',client_id:'Produtor selecionado',topic:'Tema ou conceito da dúvida'
}
export const humanizeMaterialInput=key=>inputLabels[key]||String(key||'').replace(/[_-]+/g,' ').replace(/([a-z0-9])([A-Z])/g,'$1 $2').trim().replace(/\s+/g,' ').replace(/^\p{L}/u,letter=>letter.toUpperCase())

export default function DecisionInterviewCard({interview,onReply,onRegister}){
 const questions=Array.isArray(interview?.questions)?interview.questions.slice(0,3):[]
 const missing=Array.isArray(interview?.material_missing_information)?interview.material_missing_information.map(item=>String(item||'').trim()).filter(Boolean).slice(0,6):[]
 const titleId=`decision-interview-${useId().replace(/[^a-z0-9_-]/gi,'')}`
 if(interview?.status!=='NEEDS_INPUT')return null
 if(!questions.length){
  // Calculadora, diagnostico por imagem ou laudo sem entradas: o servidor devolve NEEDS_INPUT com
  // questions vazio e a lista tecnica em material_missing_information. Sem este bloco a tela so
  // mostrava a frase generica de "sem evidencia" e o consultor nao sabia o que complementar.
  if(!missing.length)return null
  return <section className="global-val-interview" aria-labelledby={titleId}>
   <header><ListChecks/><div><small>DADOS NECESSÁRIOS</small><h3 id={titleId}>Para concluir, preciso de {missing.length===1?'um dado':`${missing.length} dados`}.</h3><p>{interview.explanation||'Nenhum valor foi inventado; informe o que falta na mesma conversa.'}</p></div></header>
   <ul className="global-val-interview-missing">{missing.map((item,index)=><li key={`${item}-${index}`}><span>{index+1}</span><b>{humanizeMaterialInput(item)}</b></li>)}</ul>
  </section>
 }
 return <section className="global-val-interview" aria-labelledby={titleId}>
  <header><MessageCircleQuestion/><div><small>DECISION INTERVIEW</small><h3 id={titleId}>Antes de concluir, preciso de {questions.length===1?'uma resposta':`${questions.length} respostas`}.</h3><p>{interview.explanation}</p></div></header>
  <ol>{questions.map((item,index)=><li key={`${item.field}-${index}`}><span>{index+1}</span><div><b>{item.question}</b><small>{item.why}</small><button type="button" onClick={()=>onReply?.(item)}>Responder agora</button></div></li>)}</ol>
  <footer><ShieldCheck/><span><b>Usar só nesta conversa</b><small>Sua resposta recalcula a leitura, mas não altera a memória confirmada.</small></span><button type="button" onClick={onRegister}><CheckCircle2/>Registrar no histórico</button></footer>
 </section>
}
