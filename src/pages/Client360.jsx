import React,{useState} from 'react'
import { ArrowLeft, BrainCircuit, MapPin, Sprout, BadgeDollarSign, HeartHandshake, MessageSquare, Target, FlaskConical, ClipboardPlus, Save } from 'lucide-react'
const Section=({title,children})=><article className="panel detail-section"><h3>{title}</h3>{children}</article>
export default function Client360({client,onBack,onPrepare,onSaved}){
 const storageKey=`valor360-tech-${client.id}`
 const [tech,setTech]=useState(()=>{
  try{return JSON.parse(localStorage.getItem(storageKey))||{property:client.commercial?.property||'',crops:client.cultures||'',area:client.area||'',weeds:'',diseases:'',insects:'',soil:'',goal:'',competitors:'',notes:''}}catch{return {property:'',crops:client.cultures||'',area:client.area||''}}
 })
 const save=()=>{localStorage.setItem(storageKey,JSON.stringify(tech));onSaved?.()}
 return <div className="page-stack">
  <button className="back-btn" onClick={onBack}><ArrowLeft size={17}/>Voltar</button>
  <section className="client-hero">
   <div><span className="eyebrow">CLIENTE 360</span><h2>{client.name}</h2><p><MapPin size={15}/>{client.municipality} • {client.area} • {client.cultures}</p><div className="tag-row"><span>{client.primaryProfile}</span><span>{client.secondaryProfile}</span><span>IRT {client.irt}</span><span>NPS {client.nps}</span></div></div>
   <div className="hero-actions"><button onClick={onPrepare}><BrainCircuit size={17}/>Preparar com a VAL</button></div>
  </section>
  <section className="four-grid">
   <div className="mini-stat"><HeartHandshake/><small>Relacionamento</small><b>{client.irtBand}</b></div>
   <div className="mini-stat"><MessageSquare/><small>Atendimento preferido</small><b>{client.servicePreference}</b></div>
   <div className="mini-stat"><Target/><small>Oportunidade</small><b>{client.commercial?.opportunity}</b></div>
   <div className="mini-stat"><BadgeDollarSign/><small>Potencial</small><b>R$ {Number(client.commercial?.potential||0).toLocaleString('pt-BR')}</b></div>
  </section>
  <div className="detail-grid">
   <Section title="Como esse produtor quer ser atendido"><dl className="info-list">
    <div><dt>Canal</dt><dd>{client.servicePreference}</dd></div><div><dt>Frequência</dt><dd>{client.contactFrequency}</dd></div>
    <div><dt>Conteúdo</dt><dd>{client.contentPreference}</dd></div><div><dt>Pós-venda</dt><dd>{client.postSalePreference}</dd></div>
   </dl></Section>
   <Section title="Como ele decide"><dl className="info-list">
    <div><dt>Principal influência</dt><dd>{client.decisionDriver}</dd></div><div><dt>Apresentação técnica</dt><dd>{client.technicalPresentation}</dd></div>
    <div><dt>Confiança</dt><dd>{client.trustDriver}</dd></div><div><dt>Nova tecnologia</dt><dd>{client.innovationBehavior}</dd></div>
   </dl></Section>
  </div>
  <div className="detail-grid">
   <Section title="NPS e percepção de valor"><dl className="info-list">
    <div><dt>NPS</dt><dd>{client.nps} — {client.npsClass}</dd></div><div><dt>Mais valorizado</dt><dd>{client.valuedAspect}</dd></div>
    <div><dt>Para nota 10</dt><dd>{client.missingFor10||'—'}</dd></div><div><dt>Necessidade adicional</dt><dd>{client.additionalNeed||'—'}</dd></div>
   </dl></Section>
   <Section title="Escalas do relacionamento"><div className="score-bars">
    {Object.entries(client.scoresScale||{}).map(([k,v])=><div key={k}><span>{({trust:'Confiança',contact:'Contato',value:'Valor',innovation:'Inovação',continuity:'Continuidade',recommendation:'Recomendação'})[k]}</span><div><i style={{width:(Number(v||0)*10)+'%'}}></i></div><b>{v}/10</b></div>)}
   </div></Section>
  </div>
  <Section title="Complemento técnico preenchido pelo consultor">
   <div className="form-grid">
    <label>Propriedade<input value={tech.property} onChange={e=>setTech({...tech,property:e.target.value})}/></label>
    <label>Área / culturas<input value={tech.area+' • '+tech.crops} onChange={()=>{}} readOnly/></label>
    <label>Principais plantas daninhas<input value={tech.weeds} onChange={e=>setTech({...tech,weeds:e.target.value})} placeholder="Ex.: buva, pé-de-galinha"/></label>
    <label>Doenças recorrentes<input value={tech.diseases} onChange={e=>setTech({...tech,diseases:e.target.value})}/></label>
    <label>Insetos / pragas<input value={tech.insects} onChange={e=>setTech({...tech,insects:e.target.value})}/></label>
    <label>Resumo de solo<input value={tech.soil} onChange={e=>setTech({...tech,soil:e.target.value})}/></label>
    <label>Meta do produtor<input value={tech.goal} onChange={e=>setTech({...tech,goal:e.target.value})}/></label>
    <label>Concorrentes / categorias fora da C.Vale<input value={tech.competitors} onChange={e=>setTech({...tech,competitors:e.target.value})}/></label>
    <label className="wide">Observações<textarea value={tech.notes} onChange={e=>setTech({...tech,notes:e.target.value})}/></label>
   </div>
   <button className="primary-btn" onClick={save}><Save size={16}/>Salvar complemento</button>
  </Section>
 </div>
}
