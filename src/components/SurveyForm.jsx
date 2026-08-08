import React,{useMemo,useState} from 'react'
import {ArrowLeft,ArrowRight,Check,ChevronRight,ClipboardList,ShieldCheck,Sparkles} from 'lucide-react'
import questions from '../data/questions.json'
import matrix from '../data/profile-matrix.json'
import {calculateProfile} from '../lib/profile'

const sections=[
 {title:'Sua propriedade',kicker:'CONTEXTO',subtitle:'Vamos começar conhecendo a sua realidade.',from:0,to:6},
 {title:'Seu DNA de decisão',kicker:'PREFERÊNCIAS',subtitle:'Não existe resposta certa. Marque o que mais combina com você.',from:6,to:18},
 {title:'Nossa relação',kicker:'RELACIONAMENTO',subtitle:'Sua percepção nos ajuda a criar um atendimento melhor.',from:18,to:24},
 {title:'Valor para você',kicker:'ESCUTA ATIVA',subtitle:'Conte o que devemos manter e o que podemos transformar.',from:24,to:27}
]

export function buildOptionMap(){return matrix.reduce((map,item)=>{(map[item.Pergunta]??=[]).push(item.Alternativa);return map},{})}

export default function SurveyForm({initialAnswers={},producerName='',onSubmit,embedded=false,submitLabel='Enviar respostas'}){
 const [step,setStep]=useState(0)
 const [answers,setAnswers]=useState(()=>({...initialAnswers,...(producerName&&!initialAnswers[1]?{1:producerName}:{})}))
 const [error,setError]=useState('')
 const [sending,setSending]=useState(false)
 const optionMap=useMemo(buildOptionMap,[])
 const current=sections[step]
 const currentQuestions=questions.slice(current.from,current.to)
 const answered=questions.filter(question=>String(answers[question.id]??'').trim()!=='').length
 const progress=Math.round(answered/questions.length*100)
 const update=(id,value)=>{setAnswers(previous=>({...previous,[id]:value}));setError('')}
 const validateStep=()=>{
  const missing=currentQuestions.filter(question=>String(answers[question.id]??'').trim()==='')
  if(missing.length){setError(`Faltam ${missing.length} ${missing.length===1?'resposta':'respostas'} nesta etapa.`);return false}
  return true
 }
 const next=()=>{if(validateStep()){setStep(value=>Math.min(value+1,sections.length-1));window.scrollTo({top:0,behavior:'smooth'})}}
 const finish=async()=>{
  if(!validateStep())return
  setSending(true);setError('')
  try{await onSubmit?.({answers,result:calculateProfile(answers,matrix,embedded?'Aplicação assistida':'Questionário externo')})}
  catch(exception){setError(exception?.message||'Não foi possível enviar agora. Tente novamente.');setSending(false)}
 }
 const field=question=>{
  const options=[...new Set(optionMap[question.id]||[])]
  if(options.length)return <div className="choice-grid">{options.map((option,index)=><button type="button" className={answers[question.id]===option?'choice-card selected':'choice-card'} key={option} onClick={()=>update(question.id,option)}><span>{String.fromCharCode(65+index)}</span><b>{option}</b><i>{answers[question.id]===option&&<Check size={14}/>}</i></button>)}</div>
  if(question.id>=19&&question.id<=24)return <div className="number-scale">{Array.from({length:11},(_,value)=><button type="button" key={value} className={Number(answers[question.id])===value?'selected':''} onClick={()=>update(question.id,value)}>{value}</button>)}<div className="scale-hints"><span>Baixa</span><span>Alta</span></div></div>
  if(question.id>=25)return <textarea value={answers[question.id]||''} onChange={event=>update(question.id,event.target.value)} placeholder="Escreva com suas palavras..." rows="4"/>
  return <input value={answers[question.id]||''} onChange={event=>update(question.id,event.target.value)} placeholder={question.id===1?'Seu nome completo':question.id===2?'Município e localidade':question.id===3?'Ex.: 240 hectares':'Digite sua resposta'}/>
 }
 return <div className={embedded?'survey-form embedded':'survey-form'}>
  <div className="survey-progress"><div><span>ETAPA {step+1} DE {sections.length}</span><b>{progress}% concluído</b></div><div className="survey-progress-track"><i style={{width:`${progress}%`}}/></div><div className="survey-dots">{sections.map((section,index)=><button type="button" key={section.title} className={index===step?'active':index<step?'done':''} onClick={()=>index<step&&setStep(index)}>{index<step?<Check size={12}/>:index+1}</button>)}</div></div>
  <section className="survey-stage">
   <div className="survey-section-title"><div className="survey-section-icon">{step===3?<Sparkles/>:step===2?<ShieldCheck/>:<ClipboardList/>}</div><div><span>{current.kicker}</span><h2>{current.title}</h2><p>{current.subtitle}</p></div></div>
   <div className="survey-question-list">{currentQuestions.map((question,index)=><article className="survey-question" key={question.id}><div className="question-number">{String(question.id).padStart(2,'0')}</div><label><strong>{question.text.replace(/^\d+\.\s*/,'')}</strong>{field(question)}</label></article>)}</div>
   {error&&<div className="survey-error">{error}</div>}
   <div className="survey-navigation">{step>0?<button type="button" className="ghost-btn" onClick={()=>setStep(value=>value-1)}><ArrowLeft size={17}/>Voltar</button>:<span/>}{step<sections.length-1?<button type="button" className="survey-next" onClick={next}>Continuar<ChevronRight size={18}/></button>:<button type="button" className="survey-next finish" disabled={sending} onClick={finish}>{sending?'Compilando...':submitLabel}<ArrowRight size={18}/></button>}</div>
  </section>
 </div>
}
