import React,{useEffect,useMemo,useState} from 'react'
import {ArrowRight,BarChart3,Check,ClipboardCheck,Copy,Inbox,Link2,MessageCircle,Plus,Sparkles,UserRoundCheck,UsersRound} from 'lucide-react'
import SurveyForm from '../components/SurveyForm'
import QuestionnaireImport from '../components/QuestionnaireImport'

const statusLabel=status=>status==='respondido'?'Respondido':status==='integrado'?'Integrado ao 360':'Aguardando'

export default function Questionnaire({onCreate,onOpen,onNotify}){
 const [mode,setMode]=useState('central')
 const [surveys,setSurveys]=useState([])
 const [producerName,setProducerName]=useState('')
 const [loading,setLoading]=useState(false)
 const [error,setError]=useState('')
 const [created,setCreated]=useState(null)
 const [assistedResult,setAssistedResult]=useState(null)
 const [importedAnswers,setImportedAnswers]=useState({})
 const refresh=()=>fetch('/api/surveys').then(response=>response.ok?response.json():[]).then(setSurveys).catch(()=>setSurveys([]))
 useEffect(()=>{refresh()},[])
 const stats=useMemo(()=>({total:surveys.length,pending:surveys.filter(item=>item.status==='aguardando').length,answered:surveys.filter(item=>item.status!=='aguardando').length,irt:Math.round(surveys.filter(item=>item.result).reduce((sum,item)=>sum+Number(item.result.irt||0),0)/Math.max(surveys.filter(item=>item.result).length,1))}),[surveys])
 const createInvitation=async()=>{
  setLoading(true);setError('')
  try{
   const token=crypto.randomUUID().replace(/-/g,'').slice(0,16)
   const response=await fetch('/api/surveys/invitations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,producerName:producerName.trim(),consultantName:'Equipe VALOR 360'})})
   if(!response.ok)throw new Error('Não foi possível criar o convite agora.')
   const invitation=await response.json();const link=`${window.location.origin}/?responder=${invitation.token}`
   setCreated({...invitation,link});setProducerName('');refresh();onNotify?.('Link do Produtor 360 criado com sucesso.')
  }catch(exception){setError(exception.message)}finally{setLoading(false)}
 }
 const copyLink=async link=>{await navigator.clipboard.writeText(link);onNotify?.('Link copiado. Pronto para enviar ao produtor.')}
 const shareWhatsApp=invitation=>{const text=`Olá${invitation.producerName?`, ${invitation.producerName.split(' ')[0]}`:''}! Preparei um questionário rápido do Produtor 360 para entendermos melhor suas preferências e gerar mais valor para a propriedade. Leva de 5 a 7 minutos: ${invitation.link||`${window.location.origin}/?responder=${invitation.token}`}`;window.open(`https://wa.me/?text=${encodeURIComponent(text)}`,'_blank','noopener,noreferrer')}
 const integrate=async survey=>{
  if(!survey.result)return
  onCreate?.({...survey.result,id:survey.result.id||`${survey.token}-${Date.now()}`})
  await fetch(`/api/surveys/${survey.token}/integrate`,{method:'POST'}).catch(()=>null);refresh();onNotify?.(`${survey.result.name} incorporado ao Cliente 360.`)
 }
 const assistedSubmit=async payload=>{onCreate?.(payload.result);setAssistedResult(payload.result);onNotify?.('Perfil compilado e salvo na carteira.')}
 const reviewImported=answers=>{setImportedAnswers(answers);setAssistedResult(null);setMode('assistida');window.scrollTo({top:0,behavior:'smooth'})}
 return <div className="page-stack producer-lab">
  <section className="producer-hero"><div className="producer-hero-copy"><span className="eyebrow">PRODUTOR 360 • EXPERIENCE LAB</span><h2>O DNA que transforma relacionamento em estratégia.</h2><p>Convide, reconheça respostas externas e acompanhe a inteligência se formando em tempo real.</p><div className="producer-hero-actions"><button onClick={()=>setMode('central')}><Link2/>Criar link inteligente</button><button onClick={()=>setMode('importar')}><Sparkles/>Importar diagnóstico</button></div></div><div className="dna-visual"><div className="dna-core"><Sparkles/><b>360°</b><span>visão viva</span></div>{['Perfil','IRT','NPS','Valor','Canal'].map((label,index)=><i key={label} style={{'--i':index}}><span>{label}</span></i>)}</div></section>
  <nav className="producer-tabs"><button className={mode==='central'?'active':''} onClick={()=>setMode('central')}><Inbox/>Central de respostas</button><button className={mode==='importar'?'active':''} onClick={()=>setMode('importar')}><Sparkles/>Importar arquivo</button><button className={mode==='assistida'?'active':''} onClick={()=>{setImportedAnswers({});setAssistedResult(null);setMode('assistida')}}><ClipboardCheck/>Aplicação assistida</button></nav>
  {mode==='central'&&<>
   <section className="survey-stat-grid"><article><span><Link2/></span><small>CONVITES CRIADOS</small><b>{stats.total}</b><p>links individuais</p></article><article><span><UsersRound/></span><small>AGUARDANDO</small><b>{stats.pending}</b><p>produtores a responder</p></article><article><span><UserRoundCheck/></span><small>RECEBIDOS</small><b>{stats.answered}</b><p>diagnósticos completos</p></article><article><span><BarChart3/></span><small>IRT MÉDIO</small><b>{stats.irt||'—'}</b><p>respostas recebidas</p></article></section>
   <section className="invite-composer"><div className="invite-copy"><span className="eyebrow">NOVO CONVITE</span><h2>Crie uma experiência individual.</h2><p>Cada produtor recebe um link único, pensado para responder pelo celular.</p></div><div className="invite-form"><label>Nome do produtor <span>opcional</span><input value={producerName} onChange={event=>setProducerName(event.target.value)} placeholder="Ex.: João da Silva"/></label><button disabled={loading} onClick={createInvitation}><Plus/>{loading?'Criando...':'Gerar link do questionário'}</button></div></section>
   {created&&<section className="fresh-link"><div><span><Check/></span><div><small>CONVITE PRONTO</small><b>{created.producerName||'Questionário aberto'}</b><p>{created.link}</p></div></div><div><button onClick={()=>copyLink(created.link)}><Copy/>Copiar link</button><button className="whatsapp-btn" onClick={()=>shareWhatsApp(created)}><MessageCircle/>Enviar pelo WhatsApp</button></div></section>}
   {error&&<div className="form-error">{error}</div>}
   <section className="response-inbox panel"><div className="panel-head"><div><span className="eyebrow">CAIXA DE ENTRADA</span><h3>Respostas e convites</h3></div><button onClick={refresh}>Atualizar</button></div>{!surveys.length?<div className="inbox-empty"><Inbox/><h3>Os próximos perfis aparecerão aqui.</h3><p>Crie o primeiro link e envie ao produtor.</p></div>:<div className="survey-list">{surveys.map(survey=><article key={survey.token}><div className={`survey-status ${survey.status}`}><span/></div><div className="survey-person"><b>{survey.result?.name||survey.producerName||'Questionário aberto'}</b><small>Criado em {new Date(survey.createdAt).toLocaleDateString('pt-BR')} • {statusLabel(survey.status)}</small></div>{survey.result&&<div className="survey-profile"><span>{survey.result.primaryProfile}</span><b>IRT {survey.result.irt}</b></div>}<div className="survey-row-actions"><button title="Copiar link" onClick={()=>copyLink(`${window.location.origin}/?responder=${survey.token}`)}><Copy/></button>{survey.status==='respondido'&&<button className="integrate-btn" onClick={()=>integrate(survey)}>Incorporar ao 360 <ArrowRight/></button>}{survey.status==='integrado'&&<button className="integrated" onClick={()=>onOpen?.(survey.result)}><Check/>Ver perfil</button>}</div></article>)}</div>}</section>
  </>}
  {mode==='importar'&&<QuestionnaireImport onReview={reviewImported}/>}
  {mode==='assistida'&&!assistedResult&&<SurveyForm key={JSON.stringify(importedAnswers)} initialAnswers={importedAnswers} embedded onSubmit={assistedSubmit} submitLabel="Compilar perfil"/>}
  {mode==='assistida'&&assistedResult&&<section className="profile-result"><div className="result-glow"><Sparkles/></div><span className="eyebrow">PERFIL CALCULADO PELA VAL</span><h2>{assistedResult.name}</h2><p>As respostas foram compiladas e o Cliente 360 já está pronto para orientar a próxima melhor ação.</p><div className="result-profiles"><div><small>PERFIL PRINCIPAL</small><b>{assistedResult.primaryProfile}</b></div><div><small>PERFIL SECUNDÁRIO</small><b>{assistedResult.secondaryProfile}</b></div><div><small>IRT</small><b>{assistedResult.irt}</b></div><div><small>NPS</small><b>{assistedResult.nps}</b></div></div><button className="primary-btn" onClick={()=>onOpen?.(assistedResult)}>Abrir Cliente 360 <ArrowRight/></button></section>}
 </div>
}
