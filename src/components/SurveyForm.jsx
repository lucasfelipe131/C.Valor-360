import React,{useEffect,useMemo,useState} from 'react'
import {ArrowLeft,ArrowRight,Check,ChevronRight,ClipboardList,ShieldCheck,Sparkles} from 'lucide-react'
import questions from '../data/questions.json'
import matrix from '../data/profile-matrix.json'
import {calculateProfile} from '../lib/profile'
import {useNavigationGuard} from '../lib/use-navigation-guard'
import {activeStorageScope} from '../lib/storage-scope.js'
import {clearSurveyDraft,readSurveyDraft,writeSurveyDraft} from '../lib/survey-draft.js'

const sections=[
 {title:'Sua propriedade',kicker:'CONTEXTO',subtitle:'Vamos começar conhecendo a sua realidade.',from:0,to:6},
 {title:'Suas preferências nesta decisão',kicker:'PREFERÊNCIAS',subtitle:'Não existe resposta certa. Marque o que mais combina com você hoje.',from:6,to:18},
 {title:'Nossa relação',kicker:'RELACIONAMENTO',subtitle:'Sua percepção nos ajuda a criar um atendimento melhor.',from:18,to:24},
 {title:'Valor para você',kicker:'ESCUTA ATIVA',subtitle:'Conte o que devemos manter e o que podemos transformar.',from:24,to:27},
 {title:'Preferências pessoais',kicker:'CONHECER MELHOR',subtitle:'Campos opcionais para tornar o relacionamento mais próximo e respeitoso.',from:27,to:45}
]

export function buildOptionMap(){return matrix.reduce((map,item)=>{(map[item.Pergunta]??=[]).push(item.Alternativa);return map},{})}

export default function SurveyForm({initialAnswers={},producerName='',onSubmit,embedded=false,submitLabel='Enviar respostas',onDirtyChange,draftScope:scopeOverride}){
 // O questionario publico nao tem sessao, entao activeStorageScope() nao tem o que devolver e o
 // rascunho nao era gravado: o produtor perdia as 45 respostas em qualquer recarga. Ele ja tem um
 // escopo - o token que esta na URL. A aplicacao assistida nao passa a prop e segue como antes.
 const draftScope=scopeOverride??activeStorageScope()
 const restored=useMemo(()=>readSurveyDraft(draftScope),[draftScope])
 const [step,setStep]=useState(0)
 const seedSignature=JSON.stringify({initialAnswers,producerName})
 // O rascunho só volta para a MESMA abertura do formulário: com outra importação de respostas, o
 // componente é remontado com outra semente e o rascunho antigo não se aplica.
 const [answers,setAnswers]=useState(()=>restored&&restored.seed===seedSignature?{...restored.answers}:({...initialAnswers,...(producerName&&!initialAnswers[1]?{1:producerName}:{})}))
 const [error,setError]=useState('')
 const [sending,setSending]=useState(false)
 // 45 perguntas respondidas na frente do produtor moravam so no useState: sair da pagina, ou trocar
 // de aba dentro do proprio Produtor 360, desmontava o componente e apagava tudo sem uma palavra.
 const seeded=useMemo(()=>({...initialAnswers,...(producerName&&!initialAnswers[1]?{1:producerName}:{})}),[initialAnswers,producerName])
 const dirty=useMemo(()=>questions.some(question=>String(answers[question.id]??'')!==String(seeded[question.id]??'')),[answers,seeded])
 useNavigationGuard(dirty,{busy:sending,label:'questionário',onBlocked:()=>setError('Aguarde o envio das respostas terminar.')})
 useEffect(()=>{onDirtyChange?.(dirty)},[dirty,onDirtyChange])
 useEffect(()=>()=>onDirtyChange?.(false),[onDirtyChange])
 // Gravado a cada tecla, nao na saida: a expiracao de sessao desmonta a arvore inteira sem passar
 // por guarda de navegacao nenhuma, e o cleanup do proprio componente ja zerou o sinal de sujo.
 // Sem escopo de usuario nao grava nada - o questionario publico nao tem sessao.
 useEffect(()=>{
  if(!draftScope)return
  if(dirty)writeSurveyDraft(draftScope,{answers,seed:seedSignature})
  else clearSurveyDraft(draftScope)
 },[answers,dirty,draftScope,seedSignature])
 const optionMap=useMemo(buildOptionMap,[])
 const current=sections[step]
 const currentQuestions=questions.slice(current.from,current.to)
 const requiredQuestions=questions.filter(question=>question.id<=26)
 const answered=requiredQuestions.filter(question=>String(answers[question.id]??'').trim()!=='').length
 const progress=Math.round(answered/requiredQuestions.length*100)
 const update=(id,value)=>{setAnswers(previous=>({...previous,[id]:value}));setError('')}
 const validateStep=()=>{
  const missing=currentQuestions.filter(question=>question.id<=26&&String(answers[question.id]??'').trim()==='')
  if(missing.length){setError(`Faltam ${missing.length} ${missing.length===1?'resposta':'respostas'} nesta etapa.`);return false}
  return true
 }
 const next=()=>{if(validateStep()){setStep(value=>Math.min(value+1,sections.length-1));window.scrollTo({top:0,behavior:'smooth'})}}
 const finish=async()=>{
  if(!validateStep())return
  setSending(true);setError('')
  try{await onSubmit?.({answers,result:calculateProfile(answers,matrix,embedded?'Aplicação assistida':'Questionário externo')});clearSurveyDraft(draftScope)}
  catch(exception){setError(exception?.message||'Não foi possível enviar agora. Tente novamente.');setSending(false)}
 }
 const field=question=>{
  const options=[...new Set(optionMap[question.id]||[])]
  if(options.length)return <div className="choice-grid">{options.map((option,index)=><button type="button" className={answers[question.id]===option?'choice-card selected':'choice-card'} key={option} onClick={()=>update(question.id,option)}><span>{String.fromCharCode(65+index)}</span><b>{option}</b><i>{answers[question.id]===option&&<Check size={14}/>}</i></button>)}</div>
  if(question.id>=19&&question.id<=24)return <div className="number-scale">{Array.from({length:11},(_,value)=><button type="button" key={value} className={Number(answers[question.id])===value?'selected':''} onClick={()=>update(question.id,value)}>{value}</button>)}<div className="scale-hints"><span>Baixa</span><span>Alta</span></div></div>
  if(question.id>=25)return <textarea value={answers[question.id]||''} onChange={event=>update(question.id,event.target.value)} placeholder={question.id>=27?'Opcional — compartilhe apenas se quiser.':'Escreva com suas palavras...'} rows="4"/>
  return <input value={answers[question.id]||''} onChange={event=>update(question.id,event.target.value)} placeholder={question.id===1?'Seu nome completo':question.id===2?'Município e localidade':question.id===3?'Ex.: 240 hectares':'Digite sua resposta'}/>
 }
 return <div className={embedded?'survey-form embedded':'survey-form'}>
  <div className="survey-progress"><div><span>ETAPA {step+1} DE {sections.length}</span><b>{progress}% obrigatório concluído</b></div><div className="survey-progress-track"><i style={{width:`${progress}%`}}/></div><div className="survey-dots">{sections.map((section,index)=><button type="button" key={section.title} className={index===step?'active':index<step?'done':''} onClick={()=>index<step&&setStep(index)}>{index<step?<Check size={12}/>:index+1}</button>)}</div></div>
  <section className="survey-stage">
   <div className="survey-section-title"><div className="survey-section-icon">{step===3?<Sparkles/>:step===2?<ShieldCheck/>:<ClipboardList/>}</div><div><span>{current.kicker}</span><h2>{current.title}</h2><p>{current.subtitle}</p></div></div>
   <div className="survey-question-list">{currentQuestions.map(question=><article className="survey-question" key={question.id}><div className="question-number">{String(question.id).padStart(2,'0')}</div><label><strong>{question.text.replace(/^\d+\.\s*/,'')}{question.id>=27?' (opcional)':''}</strong>{field(question)}</label></article>)}</div>
   {error&&<div className="survey-error" role="alert">{error}</div>}
   <div className="survey-navigation">{step>0?<button type="button" className="ghost-btn" onClick={()=>setStep(value=>value-1)}><ArrowLeft size={17}/>Voltar</button>:<span/>}{step<sections.length-1?<button type="button" className="survey-next" onClick={next}>Continuar<ChevronRight size={18}/></button>:<button type="button" className="survey-next finish" disabled={sending} onClick={finish}>{sending?'Compilando...':submitLabel}<ArrowRight size={18}/></button>}</div>
  </section>
 </div>
}
