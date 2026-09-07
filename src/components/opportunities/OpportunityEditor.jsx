import React,{useEffect,useRef,useState} from 'react'
import {X,Save,LoaderCircle} from 'lucide-react'
import {BUSINESS_TYPES,OPPORTUNITY_STAGES,opportunityValue} from '../../lib/opportunity-workspace.js'

export function OpportunityDialog({title,children,onClose,busy=false,className=''}){
 const ref=useRef(null)
 useEffect(()=>{const previous=document.activeElement;ref.current?.showModal();return()=>previous?.focus?.()},[])
 return <dialog ref={ref} className={'opp-dialog '+className} onCancel={event=>{event.preventDefault();if(!busy)onClose()}} aria-label={title}>
  <header><div><span>OPORTUNIDADES</span><h2>{title}</h2></div><button type="button" className="opp-icon-button" aria-label="Fechar janela" disabled={busy} onClick={onClose}><X size={20}/></button></header>
  {children}
 </dialog>
}
const localDate=value=>{
 if(!value)return ''
 const date=new Date(value);if(!Number.isFinite(date.getTime()))return ''
 return new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16)
}
export default function OpportunityEditor({item=null,stage='Diagnóstico',mode='edit',clients=[],onSave,onClose}){
 const [draft,setDraft]=useState(()=>({
  clientId:item?.clientId||'',title:item?.title||'',stage:item?.stage||stage,
  candidateKey:item?.candidateKey||'manual:'+crypto.randomUUID(),databaseId:item?.databaseId,
  value:opportunityValue(item)??'',crop:item?.crop||'',season:item?.season||'',businessType:item?.businessType||'',
  volume:item?.volume??'',volumeUnit:item?.volumeUnit||'',status:item?.status||(stage==='Fechado'?'':'open'),
  lossReason:item?.lossReason||'',hypothesis:item?.hypothesis||'',waitingProducer:item?.waitingProducer===true,
  nextAction:item?.nextAction||'',nextActionAt:localDate(item?.nextActionAt),nextActionDone:item?.nextActionDone===true,
  returnNote:'',expectedUpdatedAt:item?.updatedAt||null,mutationId:crypto.randomUUID()
 }))
 const [busy,setBusy]=useState(false),[error,setError]=useState('')
 const inFlight=useRef(false)
 const update=(key,value)=>setDraft(current=>({...current,[key]:value,mutationId:crypto.randomUUID(),...(key==='stage'?{status:value==='Fechado'?'':'open'}:{})}))
 const submit=async event=>{
  event.preventDefault();if(inFlight.current)return
  inFlight.current=true;setBusy(true);setError('')
  try{
   await onSave({...draft,workspaceVersion:1,value:draft.value===''?null:Number(draft.value),volume:draft.volume===''?null:Number(draft.volume),nextActionAt:draft.nextActionAt?new Date(draft.nextActionAt).toISOString():null})
   onClose()
  }catch(exception){setError(exception.message||'Não foi possível salvar. Seus campos foram preservados.')}
  finally{inFlight.current=false;setBusy(false)}
 }
 const title=mode==='return'?'Registrar retorno':item?'Detalhes da oportunidade':'Nova oportunidade'
 return <OpportunityDialog title={title} onClose={onClose} busy={busy}>
  <form onSubmit={submit} className="opp-editor">
   <fieldset disabled={busy}>
    <div className="opp-form-grid">
     <label className="opp-form-wide">Produtor<select required value={draft.clientId} disabled={!!item} onChange={e=>update('clientId',e.target.value)}><option value="">Selecione o produtor</option>{clients.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
     <label className="opp-form-wide">Oportunidade<input required maxLength={220} value={draft.title} onChange={e=>update('title',e.target.value)}/></label>
     <label>Tipo de negócio<select value={draft.businessType} onChange={e=>update('businessType',e.target.value)}><option value="">Não informado</option>{BUSINESS_TYPES.map(t=><option key={t}>{t}</option>)}</select></label>
     <label>Etapa<select value={draft.stage} onChange={e=>update('stage',e.target.value)}>{OPPORTUNITY_STAGES.map(s=><option key={s}>{s}</option>)}</select></label>
     <label>Cultura<input list="opp-cultures" maxLength={120} value={draft.crop} onChange={e=>update('crop',e.target.value)}/><datalist id="opp-cultures">{['Soja','Milho','Trigo','Canola'].map(c=><option key={c} value={c}/>)}</datalist></label>
     <label>Safra<input maxLength={60} value={draft.season} onChange={e=>update('season',e.target.value)}/></label>
     <label>Valor informado (R$)<input type="number" min="0" step="0.01" value={draft.value} onChange={e=>update('value',e.target.value)}/><small>Em branco: valor ainda não estimado.</small></label>
     <label>Volume<div className="opp-volume-input"><input aria-label="Volume" type="number" min="0" step="any" value={draft.volume} onChange={e=>update('volume',e.target.value)}/><select aria-label="Unidade do volume" required={draft.volume!==''} value={draft.volumeUnit} onChange={e=>update('volumeUnit',e.target.value)}><option value="">Unidade</option>{['sc','t','kg','L','un'].map(u=><option key={u}>{u}</option>)}</select></div></label>
     {draft.stage==='Fechado'&&<label className="opp-form-wide">Resultado<select required value={draft.status} onChange={e=>update('status',e.target.value)}><option value="">Selecione o resultado</option><option value="won">Ganho</option><option value="lost">Perdido</option><option value="archived">Arquivado</option>{item?.status==='closed'&&<option value="closed">Fechado — resultado não informado</option>}</select><small>O fechamento comercial não confirma faturamento, entrega ou pagamento.</small></label>}
     {draft.status==='lost'&&<label className="opp-form-wide">Motivo da perda<textarea required maxLength={2000} value={draft.lossReason} onChange={e=>update('lossReason',e.target.value)}/></label>}
     <label className="opp-form-wide">Necessidade / contexto registrado<textarea maxLength={4000} value={draft.hypothesis} onChange={e=>update('hypothesis',e.target.value)}/></label>
     <label className="opp-form-wide">Próxima ação<input maxLength={2000} required={!!draft.nextActionAt} value={draft.nextAction} onChange={e=>update('nextAction',e.target.value)}/></label>
     <label>Prazo<input type="datetime-local" value={draft.nextActionAt} onChange={e=>update('nextActionAt',e.target.value)}/><small>Horário deste dispositivo.</small></label>
     <div className="opp-checks"><label><input type="checkbox" checked={draft.nextActionDone} onChange={e=>update('nextActionDone',e.target.checked)}/>Ação concluída</label><label><input type="checkbox" checked={draft.waitingProducer} onChange={e=>update('waitingProducer',e.target.checked)}/>Aguardando produtor</label></div>
     <label className="opp-form-wide">{mode==='return'?'Retorno do produtor':'Registro desta alteração'}<textarea required={mode==='return'} maxLength={4000} value={draft.returnNote} onChange={e=>update('returnNote',e.target.value)}/></label>
    </div>
   </fieldset>
   {!clients.length&&<p className="opp-notice">Cadastre um produtor na sua carteira para criar uma oportunidade.</p>}
   {error&&<p role="alert" className="opp-error">{error}</p>}
   <footer><button type="button" className="opp-button" disabled={busy} onClick={onClose}>Cancelar</button><button type="submit" className="opp-button primary" disabled={busy||!clients.length}>{busy?<LoaderCircle size={16} className="is-spinning"/>:<Save size={16}/>} {busy?'Salvando…':'Salvar oportunidade'}</button></footer>
  </form>
 </OpportunityDialog>
}
