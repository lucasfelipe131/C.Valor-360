import React,{useMemo,useState} from 'react'
import questions from '../data/questions.json'
import matrix from '../data/profile-matrix.json'
import {ArrowRight,CheckCircle2,ClipboardList,Save,Sparkles} from 'lucide-react'

const slug=value=>value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'')

export default function Questionnaire({onCreate,onOpen}){
 const [answers,setAnswers]=useState({19:8,20:8,21:8,22:8,23:9,24:9})
 const [result,setResult]=useState(null)
 const [error,setError]=useState('')
 const optionMap=useMemo(()=>matrix.reduce((map,item)=>{(map[item.Pergunta]??=[]).push(item.Alternativa);return map},{}),[])
 const answered=Object.values(answers).filter(value=>String(value).trim()).length
 const update=(id,value)=>setAnswers({...answers,[id]:value})
 const field=q=>{
  const options=[...new Set(optionMap[q.id]||[])]
  if(options.length)return <select value={answers[q.id]||''} onChange={e=>update(q.id,e.target.value)}><option value="">Selecione a resposta...</option>{options.map(option=><option key={option}>{option}</option>)}</select>
  if(q.id>=19&&q.id<=24)return <div className="scale-field"><input type="range" min="0" max="10" value={answers[q.id]??0} onChange={e=>update(q.id,e.target.value)}/><b>{answers[q.id]??0}</b></div>
  if(q.id>=25)return <textarea value={answers[q.id]||''} onChange={e=>update(q.id,e.target.value)} placeholder="Resposta do produtor"/>
  return <input value={answers[q.id]||''} onChange={e=>update(q.id,e.target.value)} placeholder={q.id===1?'Nome completo':q.id===2?'Município/localidade':'Digite a resposta'}/>
 }
 const save=e=>{
  e.preventDefault();if(!String(answers[1]||'').trim()){setError('Informe o nome do produtor para concluir o perfil.');return}
  const score={Conservador:0,Analítico:0,Inovador:0,Relacional:0,Digital:0}
  matrix.forEach(item=>{if(answers[item.Pergunta]===item.Alternativa)score[item.Perfil]=(score[item.Perfil]||0)+1})
  const ranking=Object.entries(score).sort((a,b)=>b[1]-a[1])
  const scale=[19,20,21,22,23].map(id=>Number(answers[id]||0));const irt=Math.round(scale.reduce((a,b)=>a+b,0)/Math.max(scale.length,1)*10)
  const client={id:`${slug(String(answers[1]))}-${Date.now()}`,name:String(answers[1]),municipality:String(answers[2]||'A definir'),area:String(answers[3]||'A definir'),cultures:String(answers[4]||'A definir'),relationshipTime:String(answers[5]||'A definir'),primaryProfile:ranking[0][1]?ranking[0][0]:'A classificar',secondaryProfile:ranking[1][1]?ranking[1][0]:'A aprofundar',scores:Object.fromEntries(Object.entries(score).map(([k,v])=>[slug(k),v])),irt,irtBand:irt>=80?'Relacionamento estratégico':irt>=60?'Relacionamento em desenvolvimento':'Relacionamento em atenção',nps:Number(answers[24]||0),npsClass:Number(answers[24]||0)>=9?'Promotor':Number(answers[24]||0)>=7?'Neutro':'Detrator',valuedAspect:String(answers[25]||'A registrar'),missingFor10:String(answers[26]||''),additionalNeed:String(answers[27]||''),decisionParticipants:String(answers[6]||''),decisionDriver:String(answers[7]||''),technicalPresentation:String(answers[8]||''),planningStyle:String(answers[9]||''),innovationBehavior:String(answers[10]||''),servicePreference:String(answers[11]||''),contactFrequency:String(answers[12]||''),firstActionProblem:String(answers[13]||''),trustDriver:String(answers[14]||''),eventPreference:String(answers[15]||''),buyingBehavior:String(answers[16]||''),contentPreference:String(answers[17]||''),postSalePreference:String(answers[18]||''),scoresScale:{trust:answers[19],contact:answers[20],value:answers[21],innovation:answers[22],continuity:answers[23],recommendation:answers[24]},commercial:{potential:0,lastContactDays:0,priority:'Nova',opportunity:String(answers[27]||'Diagnóstico inicial'),property:'A cadastrar'}}
  setResult(client);setError('');onCreate?.(client);window.scrollTo({top:0,behavior:'smooth'})
 }
 if(result)return <div className="page-stack"><section className="profile-result"><div className="result-glow"><Sparkles/></div><span className="eyebrow">PERFIL CALCULADO PELA VAL</span><h2>{result.name}</h2><p>O questionário foi salvo e o Cliente 360 já está pronto para ser complementado.</p><div className="result-profiles"><div><small>PERFIL PRINCIPAL</small><b>{result.primaryProfile}</b></div><div><small>PERFIL SECUNDÁRIO</small><b>{result.secondaryProfile}</b></div><div><small>IRT</small><b>{result.irt}</b></div><div><small>NPS</small><b>{result.nps}</b></div></div><button className="primary-btn" onClick={()=>onOpen(result)}>Abrir Cliente 360 <ArrowRight size={17}/></button></section></div>
 return <form className="page-stack" onSubmit={save}><section className="module-hero questionnaire-hero"><div><span className="eyebrow">PRODUTOR 360</span><h2>Transforme respostas em estratégia comercial.</h2><p>As 27 perguntas atuais geram o DNA do produtor, IRT, NPS e orientações para a VAL.</p></div><div className="progress-card"><b>{Math.round(answered/27*100)}%</b><span>{answered} de 27 respostas</span><div><i style={{width:`${answered/27*100}%`}}></i></div></div></section>
  <QuestionSection title="1. Identificação e propriedade" subtitle="Dados essenciais para localizar o contexto do produtor" questions={questions.slice(0,6)} render={field}/>
  <QuestionSection title="2. DNA comercial do produtor" subtitle="Critérios de decisão, relacionamento, tecnologia e comunicação" questions={questions.slice(6,18)} render={field}/>
  <QuestionSection title="3. Índice de relacionamento" subtitle="Escalas que compõem o IRT e o NPS" questions={questions.slice(18,24)} render={field}/>
  <QuestionSection title="4. Percepção de valor" subtitle="O que manter, melhorar e transformar em oportunidade" questions={questions.slice(24)} render={field}/>
  {error&&<div className="form-error">{error}</div>}<div className="question-actions"><span><CheckCircle2 size={17}/>As respostas ficam salvas somente neste dispositivo.</span><button className="primary-btn" type="submit"><Save size={16}/>Calcular perfil e salvar</button></div>
 </form>
}

function QuestionSection({title,subtitle,questions,render}){return <article className="panel question-section"><div className="question-section-head"><ClipboardList/><div><h3>{title}</h3><p>{subtitle}</p></div></div><div className="question-fields">{questions.map(q=><label key={q.id}><span>{q.text.replace(/^\d+\.\s*/, '')}</span>{render(q)}</label>)}</div></article>}
