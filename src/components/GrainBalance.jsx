import React,{useEffect,useState} from 'react'
import {requestJsonResource} from '../hooks/useAsyncResource'

const unitLabel={sc_60kg:'sc 60 kg',t:'t',kg:'kg'}
const kindLabel={opening:'Saldo inicial',entry:'Entrada',exit:'Saída'}
const localTime=()=>new Date(Date.now()-new Date().getTimezoneOffset()*60_000).toISOString().slice(0,16)
const blank=()=>({id:crypto.randomUUID(),commodity:'soja',unit:'sc_60kg',kind:'opening',quantity:'',origin:'',reference:'',occurredAt:localTime()})
const request=(path,options={})=>requestJsonResource(path,{...options,headers:{'Content-Type':'application/json'},timeoutMs:15000,fallbackMessage:'Não foi possível consultar ou registrar o saldo.'})

function ProducerLedger({clientId}){
 const [data,setData]=useState(null),[form,setForm]=useState(blank),[error,setError]=useState(''),[notice,setNotice]=useState(''),[saving,setSaving]=useState(false)
 const read=signal=>request(`/api/grains/balance?clientId=${encodeURIComponent(clientId)}`,{signal})
 useEffect(()=>{const controller=new AbortController();read(controller.signal).then(setData).catch(exception=>{if(!controller.signal.aborted)setError(exception.message)});return()=>controller.abort()},[clientId])
 const change=event=>{setNotice('');setForm(current=>({...current,[event.target.name]:event.target.value}))}
 const submit=async event=>{
  event.preventDefault();setSaving(true);setError('');setNotice('')
  try{
   const saved=await request('/api/grains/movements',{method:'POST',body:JSON.stringify({...form,clientId,occurredAt:new Date(form.occurredAt).toISOString()})})
   setData(await read())
   setNotice(saved.idempotent?'Movimento já registrado: saldo preservado, sem duplicação.':'Movimento registrado e saldo conciliado.')
  }catch(exception){setError(exception.message)}finally{setSaving(false)}
 }
 return <>
  {error&&<p className="sog-form-error" role="alert">{error}</p>}
  {notice&&<p role="status">{notice}</p>}
  {!data&&!error&&<p role="status">Carregando saldo protegido…</p>}
  {data&&<>
   {!data.balances.length&&<p>Nenhum saldo inicial registrado para este produtor.</p>}
   <div className="sog-metrics">{data.balances.map(balance=><article className="sog-metric" key={`${balance.commodity}:${balance.unit}`}><div><small>{balance.commodity} • {unitLabel[balance.unit]}</small><b>{balance.current}</b><p>{balance.opening} + {balance.entries} − {balance.exits} = {balance.current}</p></div></article>)}</div>
   <form className="sog-form" onSubmit={submit}>
    <h4>Registrar movimento</h4>
    <p>O registro é imutável. Use uma referência exclusiva por movimento; reenvios da mesma origem e referência não alteram o saldo.</p>
    <div className="sog-form-grid">
     <label className="sog-field"><span>ID do movimento</span><input name="id" value={form.id} onChange={change} required maxLength={80}/></label>
     <label className="sog-field"><span>Grão do saldo</span><select name="commodity" value={form.commodity} onChange={change}>{['soja','milho','trigo','sorgo','feijao','arroz','cevada'].map(x=><option key={x}>{x}</option>)}</select></label>
     <label className="sog-field"><span>Unidade do saldo</span><select name="unit" value={form.unit} onChange={change}>{Object.entries(unitLabel).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
     <label className="sog-field"><span>Tipo de movimento</span><select name="kind" value={form.kind} onChange={change}>{Object.entries(kindLabel).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
     <label className="sog-field"><span>Quantidade</span><input name="quantity" value={form.quantity} onChange={change} type="number" min={form.kind==='opening'?0:0.001} max="999999999.999" step="0.001" required/></label>
     <label className="sog-field"><span>Data e hora do movimento</span><input name="occurredAt" value={form.occurredAt} onChange={change} type="datetime-local" required/></label>
     <label className="sog-field"><span>Origem do movimento</span><input name="origin" value={form.origin} onChange={change} required maxLength={240}/></label>
     <label className="sog-field"><span>Evidência / referência do movimento</span><input name="reference" value={form.reference} onChange={change} required maxLength={240}/></label>
    </div>
    <footer><button type="button" disabled={saving} onClick={()=>{setForm({...blank(),commodity:form.commodity,unit:form.unit,kind:'entry',origin:form.origin});setNotice('');setError('')}}>Novo movimento</button><button type="submit" disabled={saving}>{saving?'Salvando movimento…':'Salvar movimento'}</button></footer>
   </form>
   <h4>Parcelas do saldo</h4>
   <div className="sog-intent-list">{data.movements.map(movement=><article key={movement.id}><header><b>{kindLabel[movement.kind]} • {movement.quantity} {unitLabel[movement.unit]} • {movement.commodity}</b></header><p>ID: {movement.id}</p><p>Produtor: {movement.producerId}</p><p>Origem: {movement.origin}</p><p>Referência: {movement.reference}</p><p>Data: {new Date(movement.occurredAt).toLocaleString('pt-BR')} ({movement.occurredAt})</p></article>)}</div>
  </>}
 </>
}
export default function GrainBalance({producers}){
 const [clientId,setClientId]=useState('')
 return <section className="sog-panel" aria-label="Saldo operacional rastreável"><header className="sog-panel-head"><div><h3>Saldo operacional rastreável</h3><p>Saldo inicial + entradas − saídas. Grãos e unidades diferentes permanecem separados; não são projeções de produção.</p></div></header><label className="sog-field"><span>Produtor do saldo</span><select value={clientId} onChange={event=>setClientId(event.target.value)}><option value="">Selecione um produtor</option>{producers.map(producer=><option key={producer.id} value={producer.id}>{producer.name}</option>)}</select></label>{clientId&&<ProducerLedger key={clientId} clientId={clientId}/>}</section>
}
