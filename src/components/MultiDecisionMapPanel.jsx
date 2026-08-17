import React,{useEffect,useMemo,useState} from 'react'
import {BadgeDollarSign,BriefcaseBusiness,Building2,CheckCircle2,CircleHelp,Compass,Database,Landmark,Plus,Save,ShieldCheck,UsersRound,Wrench,X} from 'lucide-react'
import {fetchJsonResource,useAsyncResource} from '../hooks/useAsyncResource'
import '../multi-decision-map.css'
import '../multi-decision-register.css'

const text=(value,fallback='Não confirmado')=>String(value??fallback).replace(/\s+/g,' ').trim()||fallback
const roleIcon={technical:Wrench,financial:Landmark,commercial:BriefcaseBusiness,operational:Building2,executive:UsersRound,other:Compass,unclassified:CircleHelp}
const roleLabel={technical:'Técnico',financial:'Financeiro',commercial:'Comercial',operational:'Operacional',executive:'Executivo',other:'Outro papel',unclassified:'Papel a confirmar'}
const closed=stage=>/^(?:fechado|ganho|conclu[ií]do|closed|won|perdido|cancelado|lost)$/i.test(text(stage,''))
const opportunityId=item=>String(item?.id||item?.external_key||item?.externalKey||item?.title||'')
const emptyForm={opportunityId:'',name:'',role:'',perspective:'',riskPosture:'',influence:'',confirmed:false}

export default function MultiDecisionMapPanel({data,client,opportunities=[],onSaved}){
 const actors=Array.isArray(data?.actors)?data.actors:[]
 const available=useMemo(()=>opportunities.filter(item=>item&&!closed(item.stage)),[opportunities])
 const [editing,setEditing]=useState(false)
 const [form,setForm]=useState(emptyForm)
 const [notice,setNotice]=useState('')
 const {loading:saving,error:saveError,run:saveParticipant,clearError}=useAsyncResource({timeoutMs:20_000,timeoutMessage:'O registro demorou além do esperado.',fallbackMessage:'Não foi possível registrar este participante.'})

 useEffect(()=>{
  const first=opportunityId(available[0])
  setForm(current=>available.some(item=>opportunityId(item)===current.opportunityId)?current:{...current,opportunityId:first})
 },[available])

 const change=event=>{
  const {name,value,type,checked}=event.target
  setForm(current=>({...current,[name]:type==='checkbox'?checked:value}))
  setNotice('')
  clearError()
 }

 const closeForm=()=>{
  setEditing(false)
  setNotice('')
  clearError()
  setForm(current=>({...emptyForm,opportunityId:current.opportunityId}))
 }

 const submit=async event=>{
  event.preventDefault()
  const opportunity=available.find(item=>opportunityId(item)===form.opportunityId)
  if(!opportunity||!client?.id||!text(form.role,''))return
  if(!form.confirmed){setNotice('Confirme que este papel foi informado em uma conversa ou registro real.');return}
  const participant={
   id:`decision-participant:${Date.now()}:${Math.random().toString(36).slice(2,10)}`,
   type:'decision_participant',
   name:text(form.name,'').slice(0,160),
   role:text(form.role,'').slice(0,140),
   perspective:text(form.perspective,'').slice(0,260),
   riskPosture:text(form.riskPosture,'').slice(0,180),
   influence:text(form.influence,'').slice(0,120),
   confirmed:true,
   source:'consultant_confirmed',
   observedAt:new Date().toISOString(),
   uncertainty:'Os campos refletem o que foi informado e confirmado pelo consultor; não autorizam inferir influência, intenção ou comportamento.'
  }
  const evidence=[...(Array.isArray(opportunity.evidence)?opportunity.evidence:[]),participant].slice(-30)
  const payload={
   clientId:client.id,
   candidateKey:opportunity.candidateKey||opportunity.candidate_key||opportunity.title,
   title:opportunity.title,
   category:opportunity.category||'',
   hypothesis:opportunity.hypothesis||'',
   value:opportunity.estimated_value??opportunity.estimatedValue??opportunity.value??null,
   stage:opportunity.stage||'Diagnóstico',
   nextAction:opportunity.next_action||opportunity.nextAction||'',
   nextActionAt:opportunity.next_action_at||opportunity.nextActionAt||null,
   evidence
  }
  const result=await saveParticipant(({signal})=>fetchJsonResource('/api/opportunities',{signal,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),fallbackMessage:'Não foi possível salvar o participante na oportunidade.'}),{keepData:false})
  if(!result)return
  setNotice('Participante confirmado e vinculado à oportunidade.')
  setForm(current=>({...emptyForm,opportunityId:current.opportunityId}))
  await onSaved?.()
 }

 if(!data)return null
 return <section className="decision-map-panel" aria-labelledby="decision-map-title">
  <header><div><span><UsersRound/>MAPA DE DECISORES</span><h4 id="decision-map-title">Quem precisa estar alinhado para a decisão avançar</h4><p>A VAL exibe somente pessoas e papéis registrados. Interesse, influência e postura de risco não são inferidos.</p></div><div className="decision-map-head-actions"><b className={data.strategic?'is-strategic':''}>{data.strategic?'Conta com decisão compartilhada':actors.length===1?'Um participante confirmado':'Mapa em formação'}</b><button type="button" onClick={()=>setEditing(value=>!value)} disabled={!available.length}><Plus/>Registrar participante</button></div></header>

  {editing&&<form className="decision-register-form" onSubmit={submit}>
   <div className="decision-register-title"><div><small>DADO CONFIRMADO</small><h5>Vincular participante a uma oportunidade</h5><p>Registre somente o que foi informado diretamente. Nome é opcional; papel e confirmação da fonte são obrigatórios.</p></div><button type="button" onClick={closeForm} aria-label="Fechar registro"><X/></button></div>
   <div className="decision-register-grid">
    <label className="is-wide"><span>Oportunidade</span><select name="opportunityId" value={form.opportunityId} onChange={change} required>{available.map(item=><option key={opportunityId(item)} value={opportunityId(item)}>{item.title} • {item.stage}</option>)}</select></label>
    <label><span>Nome ou identificação</span><input name="name" value={form.name} onChange={change} placeholder="Opcional" maxLength={160}/></label>
    <label><span>Papel na decisão *</span><input name="role" value={form.role} onChange={change} list="decision-role-options" placeholder="Ex.: responsável técnico" maxLength={140} required/><datalist id="decision-role-options"><option value="Responsável técnico"/><option value="Compras"/><option value="Financeiro"/><option value="Operacional"/><option value="Diretoria"/><option value="Sócio ou proprietário"/></datalist></label>
    <label className="is-wide"><span>Critério ou perspectiva confirmada</span><textarea name="perspective" value={form.perspective} onChange={change} placeholder="O que essa pessoa precisa comprovar para avançar?" maxLength={260}/></label>
    <label><span>Postura de risco declarada</span><input name="riskPosture" value={form.riskPosture} onChange={change} placeholder="Somente se foi informada" maxLength={180}/></label>
    <label><span>Influência registrada</span><input name="influence" value={form.influence} onChange={change} placeholder="Ex.: aprova tecnicamente" maxLength={120}/></label>
   </div>
   <label className="decision-register-confirm"><input type="checkbox" name="confirmed" checked={form.confirmed} onChange={change}/><span><CheckCircle2/><b>Confirmo que o papel foi informado em conversa ou registro real.</b><small>Não inclua família, hobbies, dificuldades pessoais ou informação financeira pessoal como alavanca comercial.</small></span></label>
   {(saveError||notice)&&<p className={`decision-register-message ${saveError?'is-error':'is-success'}`}>{saveError||notice}</p>}
   <div className="decision-register-actions"><button type="button" onClick={closeForm}>Cancelar</button><button type="submit" disabled={saving||!form.role.trim()||!form.confirmed}><Save/>{saving?'Salvando…':'Salvar participante'}</button></div>
  </form>}

  {!available.length&&<div className="decision-register-disabled"><CircleHelp/><span>Registre uma oportunidade ativa antes de vincular participantes à decisão.</span></div>}

  {actors.length===0?<div className="decision-map-empty"><CircleHelp/><div><b>Nenhum decisor estruturado</b><p>{text(data.emptyReason)}</p></div></div>:<div className="decision-actor-grid">{actors.map(actor=>{
   const Icon=roleIcon[actor.roleCategory]||CircleHelp
   return <article key={actor.id}>
    <div className="decision-actor-head"><span><Icon/></span><div><small>{roleLabel[actor.roleCategory]||'Papel registrado'}</small><h5>{text(actor.name,actor.role||'Participante')}</h5><p>{text(actor.role)}</p></div></div>
    <dl><div><dt>Critério ou perspectiva</dt><dd>{text(actor.perspective)}</dd></div><div><dt>Postura de risco</dt><dd>{text(actor.riskPosture)}</dd></div><div><dt>Influência registrada</dt><dd>{text(actor.influence)}</dd></div></dl>
    {actor.missing?.length>0&&<p className="decision-actor-gaps"><CircleHelp/>Falta confirmar: {actor.missing.join(', ')}</p>}
    <span className="decision-evidence"><Database/>{actor.evidenceIds.join(' • ')}</span>
   </article>
  })}</div>}

  <div className="decision-next-alignment"><BadgeDollarSign/><div><small>PRÓXIMO ALINHAMENTO</small><h5>{text(data.nextAlignment?.action)}</h5><blockquote>“{text(data.nextAlignment?.question)}”</blockquote><p>Comprovação esperada: {text(data.nextAlignment?.evidenceNeeded)}</p></div></div>

  <footer><ShieldCheck/><p>{text(data.guardrail)}</p></footer>
 </section>
}
