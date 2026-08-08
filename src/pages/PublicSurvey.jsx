import React,{useEffect,useState} from 'react'
import {ArrowRight,CheckCircle2,Clock3,LockKeyhole,Sparkles,WifiOff} from 'lucide-react'
import Logo from '../components/Logo'
import SurveyForm from '../components/SurveyForm'

export default function PublicSurvey({token}){
 const [invitation,setInvitation]=useState(null)
 const [screen,setScreen]=useState('loading')
 const [result,setResult]=useState(null)
 const [error,setError]=useState('')
 useEffect(()=>{fetch(`/api/surveys/${encodeURIComponent(token)}`).then(async response=>{if(!response.ok)throw new Error('Este convite não foi encontrado.');return response.json()}).then(data=>{setInvitation(data);setScreen(data.status==='aguardando'?'welcome':'done');setResult(data.result||null)}).catch(exception=>{setError(exception.message);setScreen('error')})},[token])
 const submit=async payload=>{
  const response=await fetch(`/api/surveys/${encodeURIComponent(token)}/submit`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
  if(!response.ok)throw new Error((await response.json().catch(()=>({}))).error||'Não foi possível salvar as respostas.')
  setResult(payload.result);setScreen('done')
 }
 if(screen==='loading')return <div className="public-survey-shell"><div className="survey-loader"><span/><b>Preparando sua experiência...</b></div></div>
 if(screen==='error')return <div className="public-survey-shell"><section className="public-message error"><WifiOff/><h1>Convite indisponível</h1><p>{error}</p></section></div>
 if(screen==='done')return <div className="public-survey-shell"><section className="public-message success"><div className="success-orbit"><CheckCircle2/></div><span>RESPOSTAS RECEBIDAS</span><h1>Obrigado, {result?.name?.split(' ')[0]||invitation?.producerName||'produtor'}.</h1><p>Seu perfil foi compilado e já está disponível para a equipe preparar um atendimento mais útil para a sua propriedade.</p><div className="public-result-glimpse"><div><small>PERFIL PRINCIPAL</small><b>{result?.primaryProfile||'Compilado'}</b></div><div><small>RELACIONAMENTO</small><b>IRT {result?.irt??'—'}</b></div></div><small className="close-note">Você já pode fechar esta página.</small></section></div>
 if(screen==='form')return <div className="public-survey-shell form-mode"><header className="public-survey-header"><Logo/><span><LockKeyhole size={13}/>Conexão segura</span></header><SurveyForm producerName={invitation?.producerName} onSubmit={submit}/><footer className="public-survey-footer">C.Valor 360 • Conhecer para gerar valor</footer></div>
 return <div className="public-survey-shell welcome-mode"><div className="survey-aurora one"/><div className="survey-aurora two"/><section className="public-welcome"><Logo/><div className="welcome-orb"><Sparkles/></div><span className="welcome-kicker">PRODUTOR 360 • C.VALE</span><h1>Queremos conhecer o jeito único da sua propriedade.</h1><p>Suas respostas ajudam a criar um atendimento mais próximo, técnico e alinhado ao que realmente gera valor para você.</p><div className="welcome-facts"><span><Clock3/>5 a 7 minutos</span><span><LockKeyhole/>Uso exclusivo no atendimento</span></div>{invitation?.producerName&&<div className="welcome-name">Convite preparado para <b>{invitation.producerName}</b></div>}<button onClick={()=>setScreen('form')}>Começar agora <ArrowRight size={19}/></button><small>Não existem respostas certas ou erradas. Seja você.</small></section></div>
}
