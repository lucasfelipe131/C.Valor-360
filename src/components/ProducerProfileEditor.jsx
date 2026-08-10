import React,{useEffect,useState} from 'react'
import {Save,UserRoundPen} from 'lucide-react'

const relationshipKeys=['preferredName','birthday','family','spouse','children','favoriteTeam','likesFishing','fishingStyle','hobbies','leisure','favoriteFoods','favoriteDrinks','events','communicationNotes','personalValues','negotiationPreferences','importantDates','personalNotes']
const commercialKeys=['phone','email','property','purchaseCurrentSeason','purchasePreviousSeason','potentialTotal','openPotential','walletShare','mainCategories','competitors','commercialNotes']
const cleanObject=(value,keys)=>Object.fromEntries(keys.map(key=>[key,key==='likesFishing'?Boolean(value?.[key]):value?.[key]??'']))
const editorValue=client=>({
 name:client?.name||'',municipality:client?.municipality||'',area:client?.area||'',cultures:client?.cultures||'',servicePreference:client?.servicePreference||'',
 commercial:cleanObject(client?.commercial,commercialKeys),relationship:cleanObject(client?.relationship,relationshipKeys)
})

export default function ProducerProfileEditor({client,onSave,onCancel,compact=false}){
 const [form,setForm]=useState(()=>editorValue(client))
 const [saving,setSaving]=useState(false)
 const [error,setError]=useState('')
 useEffect(()=>{setForm(editorValue(client));setError('')},[client?.id])
 const base=(key,value)=>setForm(current=>({...current,[key]:value}))
 const nested=(group,key,value)=>setForm(current=>({...current,[group]:{...current[group],[key]:value}}))
 const submit=async event=>{
  event.preventDefault();setSaving(true);setError('')
  try{await onSave?.(client.id,form)}catch(exception){setError(exception.message||'Não foi possível salvar o produtor.')}finally{setSaving(false)}
 }
 return <form className={`producer-profile-editor ${compact?'is-compact':''}`} onSubmit={submit}>
  <header><span><UserRoundPen/></span><div><b>Cadastro completo do produtor</b><small>Dados pessoais e comerciais ficam disponíveis para a VAL no contexto deste login.</small></div></header>
  <fieldset><legend>Identificação e propriedade</legend><div className="form-grid producer-edit-grid">
   <label>Nome completo<input required value={form.name} onChange={event=>base('name',event.target.value)}/></label>
   <label>Como prefere ser atendido<input value={form.servicePreference} onChange={event=>base('servicePreference',event.target.value)}/></label>
   <label>Município / localidade<input value={form.municipality} onChange={event=>base('municipality',event.target.value)}/></label>
   <label>Área cultivada<input value={form.area} onChange={event=>base('area',event.target.value)} placeholder="Ex.: 480 ha"/></label>
   <label>Culturas<input value={form.cultures} onChange={event=>base('cultures',event.target.value)} placeholder="Ex.: soja, milho"/></label>
   <label>Propriedade<input value={form.commercial.property} onChange={event=>nested('commercial','property',event.target.value)}/></label>
   <label>Telefone / WhatsApp<input value={form.commercial.phone} onChange={event=>nested('commercial','phone',event.target.value)}/></label>
   <label>E-mail<input type="email" value={form.commercial.email} onChange={event=>nested('commercial','email',event.target.value)}/></label>
  </div></fieldset>
  <fieldset><legend>Visão global de compras e potencial</legend><div className="form-grid producer-edit-grid">
   <label>Compras — safra atual (R$)<input type="number" min="0" step="0.01" value={form.commercial.purchaseCurrentSeason} onChange={event=>nested('commercial','purchaseCurrentSeason',event.target.value)}/></label>
   <label>Compras — safra anterior (R$)<input type="number" min="0" step="0.01" value={form.commercial.purchasePreviousSeason} onChange={event=>nested('commercial','purchasePreviousSeason',event.target.value)}/></label>
   <label>Potencial total estimado (R$)<input type="number" min="0" step="0.01" value={form.commercial.potentialTotal} onChange={event=>nested('commercial','potentialTotal',event.target.value)}/></label>
   <label>Potencial em aberto (R$)<input type="number" min="0" step="0.01" value={form.commercial.openPotential} onChange={event=>nested('commercial','openPotential',event.target.value)}/></label>
   <label>Participação na carteira (%)<input type="number" min="0" max="100" step="0.1" value={form.commercial.walletShare} onChange={event=>nested('commercial','walletShare',event.target.value)}/></label>
   <label>Categorias principais<input value={form.commercial.mainCategories} onChange={event=>nested('commercial','mainCategories',event.target.value)}/></label>
   <label>Concorrentes / compras externas<input value={form.commercial.competitors} onChange={event=>nested('commercial','competitors',event.target.value)}/></label>
   <label className="wide">Observações comerciais<textarea rows="3" value={form.commercial.commercialNotes} onChange={event=>nested('commercial','commercialNotes',event.target.value)}/></label>
  </div></fieldset>
  <fieldset><legend>Relacionamento e preferências pessoais</legend><div className="form-grid producer-edit-grid">
   <label>Como prefere ser chamado<input value={form.relationship.preferredName} onChange={event=>nested('relationship','preferredName',event.target.value)}/></label>
   <label>Aniversário<input value={form.relationship.birthday} onChange={event=>nested('relationship','birthday',event.target.value)} placeholder="Ex.: 18 de agosto"/></label>
   <label>Time do coração<input value={form.relationship.favoriteTeam} onChange={event=>nested('relationship','favoriteTeam',event.target.value)}/></label>
   <label>Gosta de pescaria?<select value={form.relationship.likesFishing?'sim':'nao'} onChange={event=>nested('relationship','likesFishing',event.target.value==='sim')}><option value="nao">Não informado / não</option><option value="sim">Sim</option></select></label>
   <label>Tipo de pescaria<input value={form.relationship.fishingStyle} onChange={event=>nested('relationship','fishingStyle',event.target.value)}/></label>
   <label>Hobbies<input value={form.relationship.hobbies} onChange={event=>nested('relationship','hobbies',event.target.value)}/></label>
   <label>Família<input value={form.relationship.family} onChange={event=>nested('relationship','family',event.target.value)}/></label>
   <label>Cônjuge<input value={form.relationship.spouse} onChange={event=>nested('relationship','spouse',event.target.value)}/></label>
   <label>Filhos<input value={form.relationship.children} onChange={event=>nested('relationship','children',event.target.value)}/></label>
   <label>Lazer / tempo livre<input value={form.relationship.leisure} onChange={event=>nested('relationship','leisure',event.target.value)}/></label>
   <label>Comidas preferidas<input value={form.relationship.favoriteFoods} onChange={event=>nested('relationship','favoriteFoods',event.target.value)}/></label>
   <label>Bebidas preferidas<input value={form.relationship.favoriteDrinks} onChange={event=>nested('relationship','favoriteDrinks',event.target.value)}/></label>
   <label>Eventos e esportes<input value={form.relationship.events} onChange={event=>nested('relationship','events',event.target.value)}/></label>
   <label>Datas importantes<input value={form.relationship.importantDates} onChange={event=>nested('relationship','importantDates',event.target.value)}/></label>
   <label className="wide">Preferências de comunicação<textarea rows="3" value={form.relationship.communicationNotes} onChange={event=>nested('relationship','communicationNotes',event.target.value)}/></label>
   <label className="wide">Valores pessoais importantes<textarea rows="3" value={form.relationship.personalValues} onChange={event=>nested('relationship','personalValues',event.target.value)}/></label>
   <label className="wide">Preferências de negociação<textarea rows="3" value={form.relationship.negotiationPreferences} onChange={event=>nested('relationship','negotiationPreferences',event.target.value)}/></label>
   <label className="wide">Outras características e observações<textarea rows="4" value={form.relationship.personalNotes} onChange={event=>nested('relationship','personalNotes',event.target.value)}/></label>
  </div></fieldset>
  {error&&<div className="form-error" role="alert">{error}</div>}
  <div className="producer-editor-actions">{onCancel&&<button type="button" className="ghost-btn" onClick={onCancel}>Cancelar</button>}<button className="primary-btn" disabled={saving}><Save size={16}/>{saving?'Salvando…':'Salvar cadastro completo'}</button></div>
 </form>
}
