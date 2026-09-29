import React,{useRef,useState} from 'react'
import {pr011Visible,runPr011Probe} from '../lib/pr011-probe.js'

export default function Pr011QaProbe({currentUser}){
 const [report,setReport]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const inFlight=useRef(false)
 if(!pr011Visible(currentUser,window.location.hostname))return null
 const run=async()=>{
  if(inFlight.current)return
  inFlight.current=true;setBusy(true);setReport(null);setError('')
  try{setReport(await runPr011Probe({hostname:window.location.hostname,expectedEmail:currentUser.email}))}
  catch{setError('PROBE_NOT_COMPLETED: transporte ou sessão não confirmado. Não é prova de isolamento.')}
  finally{inFlight.current=false;setBusy(false)}
 }
 return <section className="panel" aria-label="PR011 QA Probe">
  <h3>PR011 QA Probe</h3>
  <p>Staging · sessão {currentUser.email} · {currentUser.role}. Consulta a rota real, sem alterar dados.</p>
  <button className="soft-btn" type="button" onClick={run} disabled={busy}>{busy?'Verificando…':'Executar prova PR011'}</button>
  {error&&<p role="alert">{error}</p>}
  {report&&<pre aria-label="Resultado PR011" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(report,null,2)}</pre>}
 </section>
}
