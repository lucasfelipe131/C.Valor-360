import React,{useEffect,useMemo,useState} from 'react'
import {BrainCircuit,ChevronDown,LoaderCircle,RefreshCw,ShieldCheck,Sparkles} from 'lucide-react'
import {fetchJsonResource,useAsyncResource} from '../hooks/useAsyncResource'
import CommitmentLadderPanel from './CommitmentLadderPanel'
import ObjectionEvidencePanel from './ObjectionEvidencePanel'
import ValueScenarioPanel from './ValueScenarioPanel'
import '../conversion-studio.css'
import '../objection-evidence.css'

export default function ConversionOpportunityStudio({clients=[],onClient,onPrepare}){
 const [selectedId,setSelectedId]=useState(clients[0]?.id||'')
 const {data,loading,error,run}=useAsyncResource({initialData:null,initialLoading:Boolean(clients[0]),timeoutMs:30_000,timeoutMessage:'O dossiê demorou além do esperado.',fallbackMessage:'Não foi possível carregar o estúdio de conversão.'})
 const client=useMemo(()=>clients.find(item=>String(item.id)===String(selectedId))||clients[0]||null,[clients,selectedId])

 useEffect(()=>{if(!selectedId&&clients[0]?.id)setSelectedId(clients[0].id)},[clients,selectedId])
 useEffect(()=>{
  if(!client?.id)return
  run(({signal})=>fetchJsonResource(`/api/clients/${encodeURIComponent(client.id)}/context`,{signal,fallbackMessage:'Não foi possível carregar o dossiê deste produtor.'}),{keepData:false})
 },[client?.id,run])

 const reload=()=>client?.id&&run(({signal})=>fetchJsonResource(`/api/clients/${encodeURIComponent(client.id)}/context`,{signal,fallbackMessage:'Não foi possível atualizar o dossiê deste produtor.'}),{keepData:true})
 const selectClient=event=>{
  const id=event.target.value
  setSelectedId(id)
  const next=clients.find(item=>String(item.id)===String(id))
  if(next)onClient?.(next)
 }

 if(!clients.length)return null
 const innovations=data?.conversionInnovations||{}
 const prepare=()=>onPrepare?.(client)

 return <section className="conversion-studio" aria-labelledby="conversion-studio-title">
  <header className="conversion-studio-head">
   <div>
    <span className="conversion-studio-kicker"><BrainCircuit/>ESTÚDIO DE CONVERSÃO</span>
    <h3 id="conversion-studio-title">Da conversa ao próximo “sim” verificável</h3>
    <p>A VAL organiza compromissos, objeções e valor econômico usando somente o que está registrado no dossiê.</p>
   </div>
   <div className="conversion-studio-controls">
    <label><small>PRODUTOR</small><span><select value={client?.id||''} onChange={selectClient}>{clients.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown/></span></label>
    <button type="button" onClick={reload} disabled={loading}><RefreshCw className={loading?'is-spinning':''}/><b>Atualizar</b></button>
   </div>
  </header>

  {loading&&!data&&<div className="conversion-studio-loading" role="status"><LoaderCircle/><div><b>Montando o dossiê de conversão…</b><small>Verificando compromissos, perdas, números e evidências confirmadas.</small></div></div>}
  {error&&<div className="conversion-studio-error">{error}</div>}

  {!loading&&data&&<>
   <CommitmentLadderPanel data={innovations.commitmentLadders} client={client} onPrepare={prepare}/>
   <ValueScenarioPanel data={innovations.valueScenarios} onPrepare={prepare}/>
   <ObjectionEvidencePanel data={innovations.objectionLibrary}/>
  </>}

  <footer className="conversion-studio-foot"><ShieldCheck/><span><b>Avanço sem pressão ou promessa artificial</b><small>A VAL não cria premissas financeiras, não promete resultado agronômico e não transforma precedentes em scripts.</small></span><Sparkles/></footer>
 </section>
}
