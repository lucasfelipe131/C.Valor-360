import React,{useEffect,useState} from 'react'
import {Plus,RefreshCw,ShieldCheck} from 'lucide-react'
import {fetchJsonResource,requestJsonResource} from '../hooks/useAsyncResource'
import '../val-management.css'

export default function ManagementUnits({currentUser}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[name,setName]=useState(''),[revision,setRevision]=useState(0),[assignments,setAssignments]=useState({})
 useEffect(()=>{
  const controller=new AbortController();let active=true
  setData(null);setError('')
  fetchJsonResource('/api/admin/management-units',{signal:controller.signal,timeoutMs:15000}).then(payload=>{if(active){setData(payload);setAssignments(Object.fromEntries(payload.members.map(member=>[member.id,member.unitId||''])))}}).catch(exception=>{if(active)setError(exception.message)})
  return()=>{active=false;controller.abort()}
 },[currentUser?.storageScope,revision])
 const save=async(method,body)=>{
  setBusy(true);setError('')
  try{await requestJsonResource('/api/admin/management-units',{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body),timeoutMs:15000});if(method==='POST')setName('');setRevision(value=>value+1)}catch(exception){setError(exception.message)}finally{setBusy(false)}
 }
 if(currentUser?.role!=='admin'||currentUser?.demo)return null
 return <section className="mg-panel mg-unit-admin"><div className="mg-panel-title"><div><span className="mg-eyebrow">ACESSO GERENCIAL</span><h2><ShieldCheck size={22}/>Unidades e equipes</h2><p>Crie o login com perfil “Gerencial BI (consulta)” acima. Vincule o gestor e seus consultores à mesma unidade para liberar a consulta.</p></div><button className="mg-button" onClick={()=>setRevision(value=>value+1)} disabled={busy}><RefreshCw size={16}/>Atualizar</button></div>
  <p className="mg-muted">Trocar a unidade muda a carteira visível ao gestor. Usuários sem unidade não recebem acesso à visão da equipe. Consultores mantêm a carteira individual.</p>
  <form className="mg-unit-create" onSubmit={event=>{event.preventDefault();save('POST',{name})}}><label>Nova unidade<input required maxLength={120} value={name} placeholder="Nome da unidade" onChange={event=>setName(event.target.value)}/></label><button className="mg-button mg-primary" disabled={busy}><Plus size={16}/>Criar unidade</button></form>
  {error&&<p role="alert" className="form-error">{error}</p>}
  {!data&&!error?<p role="status">Carregando unidades…</p>:data&&<div className="mg-table-wrap"><table><thead><tr><th>Usuário</th><th>Perfil</th><th>Unidade</th><th>Vínculo</th></tr></thead><tbody>{data.members.map(member=><tr key={member.id}><td><strong>{member.name}</strong><small>{member.email}</small></td><td>{({bi_viewer:'Gerencial BI (consulta)',admin:'Administrador',manager:'Gestor',consultant:'Consultor',technical_reviewer:'Revisor técnico'})[member.role]||member.role}</td><td><select aria-label={`Unidade de ${member.name}`} value={assignments[member.id]||''} disabled={busy} onChange={event=>setAssignments(value=>({...value,[member.id]:event.target.value}))}><option value="">Sem unidade</option>{data.units.map(unit=><option key={unit.id} value={unit.id}>{unit.name}</option>)}</select></td><td><button className="mg-button" disabled={busy||(assignments[member.id]||'')===(member.unitId||'')} onClick={()=>save('PUT',{userId:member.id,unitId:assignments[member.id]||null})}>Salvar vínculo</button></td></tr>)}</tbody></table></div>}
 </section>
}
