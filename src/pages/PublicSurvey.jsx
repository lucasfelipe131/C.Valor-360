import React,{useEffect,useState} from 'react'
import {ArrowRight,CheckCircle2,Clock3,LockKeyhole,Sparkles,WifiOff} from 'lucide-react'
import Logo from '../components/Logo'
import SurveyForm from '../components/SurveyForm'

export default function PublicSurvey({token}){
 const [invitation,setInvitation]=useState(null)
 const [screen,setScreen]=useState('loading')
 const [result,setResult]=useState(null)
 const [error,setError]=useState('')
 useEffect(()=>{fetch(`/api/surveys/${encodeURIComponent(token)}`,{signal:AbortSignal.timeout(10000)}).then(async response=>{const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'Este convite não pôde ser consultado.');return payload}).then(data=>{setInvitation(data);setScreen(data.status==='aguardando'?'welcome':'done');setResult(null)}).catch(exception=>{setError(exception.name==='TimeoutError'?'O servidor demorou para responder. Tente novamente.':exception.message);setScreen('error')})},[token])
 const submit=async payload=>{
  const response=await fetch(`/api/surveys/${encodeURIComponent(token)}/submit`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(15000)})
  if(!response.ok)throw new Error((await response.json().catch(()=>({}))).error||'Não foi possível salvar as respostas.')
  setResult({name:payload.answers?.[1]||invitation?.producerName||''});setScreen('done')
 }
 if(screen==='loading')return <div className="public-survey-shell"><div className="survey-loader"><span/><b>Preparando sua experiência...</b></div></div>
 if(screen==='error')return <div className="public-survey-shell"><section className="public-message error"><WifiOff/><h1>Convite indisponível</h1><p>{error}</p></section></div>
 if(screen==='done')return <div className="public-survey-shell"><section className="public-message success"><div className="success-orbit"><CheckCircle2/></div><span>RESPOSTAS RECEBIDAS</span><h1>Obrigado, {result?.name?.split(' ')[0]||invitation?.producerName||'produtor'}.</h1><p>Suas respostas foram registradas para ajudar a equipe a preparar um atendimento mais útil. Qualquer tag é apenas uma síntese derivada das respostas, não um diagnóstico, e pode ser corrigida.</p><div className="public-result-glimpse"><div><small>STATUS</small><b>Recebido</b></div><div><small>PRÓXIMA ETAPA</small><b>Revisão da equipe</b></div></div><small className="close-note">Você já pode fechar esta página.</small></section></div>
 if(screen==='form')return <div className="public-survey-shell form-mode"><header className="public-survey-header"><Logo/><span><LockKeyhole size={13}/>Conexão segura</span></header><SurveyForm producerName={invitation?.producerName} onSubmit={submit}/><footer className="public-survey-footer">VAL • Inteligência que gera valor</footer></div>
 return <div className="public-survey-shell welcome-mode"><div className="survey-aurora one"/><div className="survey-aurora two"/><section className="public-welcome"><Logo/><div className="welcome-orb"><Sparkles/></div><span className="welcome-kicker">PRODUTOR 360 • VAL</span><h1>Queremos conhecer o contexto e as preferências da sua propriedade.</h1><p>Suas respostas ajudam a preparar um atendimento mais próximo e alinhado ao que gera valor para você. As perguntas pessoais são opcionais.</p><div className="welcome-facts"><span><Clock3/>7 a 10 minutos</span><span><LockKeyhole/>Uso no relacionamento comercial</span></div>{invitation?.producerName&&<div className="welcome-name">Convite preparado para <b>{invitation.producerName}</b></div>}<button onClick={()=>setScreen('form')}>Começar agora <ArrowRight size={19}/></button><small>Ao continuar, você confirma que leu esta finalidade. Você pode pedir correção ou exclusão das respostas à equipe responsável. Não existem respostas certas ou erradas.</small></section></div>
}
