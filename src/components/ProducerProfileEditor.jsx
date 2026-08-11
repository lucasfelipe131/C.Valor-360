import React,{useEffect,useState} from 'react'
import {Save,UserRoundPen} from 'lucide-react'
import CurrencyInput from './CurrencyInput'

const relationshipKeys=['preferredName','birthday','family','spouse','children','favoriteTeam','likesFishing','fishingStyle','hobbies','leisure','favoriteFoods','favoriteDrinks','events','communicationNotes','personalValues','negotiationPreferences','importantDates','personalNotes']
const commercialKeys=['phone','email','property','purchaseCurrentSeason','purchasePreviousSeason','potentialTotal','openPotential','walletShare','targetShare','creditLimit','creditUsed','grossMarginPercent','paymentTerms','decisionWindow','commercialRisk','mainCategories','competitors','commercialNotes']
const cleanObject=(value,keys)=>Object.fromEntries(keys.map(key=>[key,key==='likesFishing'?Boolean(value?.[key]):value?.[key]??'']))
const finite=value=>Number.isFinite(Number(value))?Math.max(0,Number(value)):0
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
 const currentPurchases=finite(form.commercial.purchaseCurrentSeason)
 const totalPotential=finite(form.commercial.potentialTotal)
 const openPotential=Math.max(0,totalPotential-currentPurchases)
 const calculatedShare=totalPotential>0?Math.min(100,currentPurchases/totalPotential*100):0
 const availableCredit=Math.max(0,finite(form.commercial.creditLimit)-finite(form.commercial.creditUsed))
 const submit=async event=>{
  event.preventDefault();setSaving(true);setError('')
  try{await onSave?.(client.id,{...form,commercial:{...form.commercial,openPotential}})}catch(exception){setError(exception.message||'Não foi possível salvar o produtor.')}finally{setSaving(false)}
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
   <label>Compras — safra atual<CurrencyInput value={form.commercial.purchaseCurrentSeason} onChange={value=>nested('commercial','purchaseCurrentSeason',value)}/></label>
   <label>Compras — safra anterior<CurrencyInput value={form.commercial.purchasePreviousSeason} onChange={value=>nested('commercial','purchasePreviousSeason',value)}/></label>
   <label>Potencial total estimado<CurrencyInput value={form.commercial.potentialTotal} onChange={value=>nested('commercial','potentialTotal',value)}/></label>
   <label>Potencial em aberto — automático<CurrencyInput value={openPotential} readOnly/><small>Potencial total menos compras da safra atual.</small></label>
   <label>Share realizado — automático<input readOnly value={`${calculatedShare.toLocaleString('pt-BR',{maximumFractionDigits:1})}%`}/><small>Compras atuais divididas pelo potencial total.</small></label>
   <label>Share atual informado (%)<input type="number" min="0" max="100" step="0.1" value={form.commercial.walletShare} onChange={event=>nested('commercial','walletShare',event.target.value)}/></label>
   <label>Meta de share (%)<input type="number" min="0" max="100" step="0.1" value={form.commercial.targetShare} onChange={event=>nested('commercial','targetShare',event.target.value)}/></label>
   <label>Margem bruta estimada (%)<input type="number" min="0" max="100" step="0.1" value={form.commercial.grossMarginPercent} onChange={event=>nested('commercial','grossMarginPercent',event.target.value)}/></label>
   <label>Limite de crédito<CurrencyInput value={form.commercial.creditLimit} onChange={value=>nested('commercial','creditLimit',value)}/></label>
   <label>Crédito utilizado<CurrencyInput value={form.commercial.creditUsed} onChange={value=>nested('commercial','creditUsed',value)}/></label>
   <label>Crédito disponível — automático<CurrencyInput value={availableCredit} readOnly/></label>
   <label>Condição de pagamento preferida<input value={form.commercial.paymentTerms} onChange={event=>nested('commercial','paymentTerms',event.target.value)}/></label>
   <label>Janela de decisão / compra<input value={form.commercial.decisionWindow} onChange={event=>nested('commercial','decisionWindow',event.target.value)} placeholder="Ex.: setembro, pré-plantio"/></label>
   <label>Categorias principais<input value={form.commercial.mainCategories} onChange={event=>nested('commercial','mainCategories',event.target.value)}/></label>
   <label>Concorrentes / compras externas<input value={form.commercial.competitors} onChange={event=>nested('commercial','competitors',event.target.value)}/></label>
   <label className="wide">Riscos e travas comerciais<textarea rows="3" value={form.commercial.commercialRisk} onChange={event=>nested('commercial','commercialRisk',event.target.value)}/></label>
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
