import React from 'react'
import {ArrowUpRight,BookOpenCheck,CalendarCheck,CheckCircle2,CircleDollarSign,ClipboardCheck,Database,FileSearch,Leaf,Lightbulb,ShieldCheck,Sprout,Target,TrendingUp} from 'lucide-react'

const list=value=>Array.isArray(value)?value:[]
const text=(value,max=1800)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max)
const dateLabel=value=>{const parsed=new Date(value||'');return Number.isNaN(parsed.getTime())?'data não informada':parsed.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})}

function Card({className='',icon:Icon=Lightbulb,label,title,children,actionLabel,onAction}){
 return <section className={`val-chat-card ${className}`}>
  <header><span><Icon/></span><div><small>{label}</small><h3>{title}</h3></div></header>
  {children}
  {actionLabel&&<button type="button" className="val-chat-card-action" onClick={onAction}>{actionLabel}<ArrowUpRight/></button>}
 </section>
}

export function DecisionCard({reasoning={},answer='',action='',audioNode}){
 const path=text(reasoning.run?.path,20)
 return <Card className="val-decision-card" icon={Lightbulb} label="MINHA LEITURA" title={reasoning.client?.name||'Decisão em análise'}>
  {path&&<em className={`val-chat-path is-${path.toLowerCase()}`}>{path}</em>}
  <p className="val-chat-lead">{answer||'A orientação chegou sem uma leitura principal.'}</p>
  {action&&<div className="val-chat-next"><small>EU FARIA AGORA</small><b>{action}</b></div>}
  {audioNode}
 </Card>
}

export function PrepareVisitCard({reasoning={},questions=[],onOpen}){
 const thesis=reasoning.decision_thesis||{}
 return <Card className="val-prepare-card" icon={CalendarCheck} label="PREPARAÇÃO DE VISITA" title={reasoning.objective||'Próxima conversa com o produtor'} actionLabel="Abrir preparação completa" onAction={()=>onOpen?.('visits')}>
  <dl><div><dt>OBJETIVO</dt><dd>{reasoning.next_commitment||reasoning.recommended_strategy?.action||'Definir o compromisso-alvo da visita.'}</dd></div><div><dt>POR QUE AGORA</dt><dd>{thesis.WHAT_MATTERS||reasoning.situation_summary}</dd></div></dl>
  {questions.length>0&&<div className="val-card-questions"><small>PERGUNTAS DE OURO</small><ol>{questions.slice(0,3).map((item,index)=><li key={`${item.question}-${index}`}>{item.question}</li>)}</ol></div>}
  <div className="val-card-outcome"><CheckCircle2/><span><small>SAIA COM</small><b>{reasoning.next_commitment||'Uma decisão, um responsável e um próximo passo verificável.'}</b></span></div>
 </Card>
}

export function AgronomicInsightCard({reasoning={},onOpen}){
 const agronomy=reasoning.agronomic_context||{}
 const sources=Object.entries(agronomy.sources||{}).filter(([,value])=>Number(value)>0)
 const tool=String(reasoning.intent||'').toUpperCase()==='ANALYZE_SOIL'?'solo':''
 return <Card className="val-agronomic-card" icon={Sprout} label="ANÁLISE AGRONÔMICA" title={agronomy.status==='available'?'Contexto técnico disponível':'Leitura técnica com dados limitados'} actionLabel="Ver Inteligência Agronômica" onAction={()=>onOpen?.({page:'agro',tool,manualPage:tool})}>
  <p>{agronomy.safety_note||'Nenhuma prescrição técnica é executada automaticamente.'}</p>
  {sources.length>0&&<div className="val-source-chips">{sources.map(([key,value])=><span key={key}>{key.replaceAll('_',' ')} • {value}</span>)}</div>}
  {agronomy.human_review_required&&<div className="val-card-guardrail"><ShieldCheck/>Revisão humana técnica obrigatória antes de qualquer ação.</div>}
 </Card>
}

export function OpportunityCard({reasoning={},onOpen}){
 const commercial=reasoning.commercial_context||{}
 const title=text(commercial.opportunity?.title||commercial.opportunity_title||reasoning.objective)||'Oportunidade em análise'
 return <Card className="val-opportunity-card" icon={Target} label="OPORTUNIDADE" title={title} actionLabel="Abrir oportunidades" onAction={()=>onOpen?.('opportunities')}>
  <p>{reasoning.decision_thesis?.WHAT_MATTERS||reasoning.situation_summary}</p>
  {commercial.profile_strategy&&<div className="val-card-signal"><TrendingUp/><span><small>ABORDAGEM</small><b>{commercial.profile_strategy}</b></span></div>}
 </Card>
}

export function CommitmentCard({reasoning={},onOpen}){
 const commitment=text(reasoning.next_commitment||reasoning.recommended_strategy?.action)
 if(!commitment)return null
 return <Card className="val-commitment-card" icon={ClipboardCheck} label="PRÓXIMO PASSO" title="Compromisso sugerido" actionLabel="Abrir visitas e compromissos" onAction={()=>onOpen?.('visits')}>
  <p>{commitment}</p><small className="val-card-policy">Sugestão de execução; não é gravada como compromisso sem ação explícita do usuário.</small>
 </Card>
}

export function MarketCard({reasoning={},onOpen}){
 const current=reasoning.premises?.current_data||{}
 const source=current.source||reasoning.commercial_context?.source||null
 const status=text(current.status||reasoning.commercial_context?.current_data_status||'SOURCE_REQUIRED',40)
 return <Card className="val-market-card" icon={CircleDollarSign} label="MERCADO / COMMODITY" title={status==='CURRENT'?'Referência atual identificada':'Situação da referência atual'} actionLabel="Abrir ambiente de mercado" onAction={()=>onOpen?.('val')}>
  <div className="val-market-status"><span className={`is-${status.toLowerCase()}`}>{status.replaceAll('_',' ')}</span>{source&&<b>{source.commodity||source.name||source.source_name||'Fonte autorizada'}</b>}</div>
  {source?<dl><div><dt>Fonte</dt><dd>{source.source_name||source.name||source.id||'Identificada'}</dd></div><div><dt>Data</dt><dd>{dateLabel(source.observed_at||source.observedAt||source.date)}</dd></div><div><dt>Praça / unidade</dt><dd>{[source.region||source.location,source.price_unit||source.unit].filter(Boolean).join(' • ')||'não informada'}</dd></div></dl>:<p>A VAL não transforma memória antiga em preço, clima ou notícia atual.</p>}
 </Card>
}

export function EvidenceCard({facts=[],onOpen}){
 if(!list(facts).length)return null
 return <Card className="val-evidence-inline-card" icon={FileSearch} label="EVIDÊNCIAS" title={`${facts.length} referência${facts.length===1?'':'s'} usada${facts.length===1?'':'s'}`} actionLabel={onOpen?'Ver todas no painel':null} onAction={onOpen}>
  <ul>{facts.slice(0,4).map((item,index)=><li key={item.id||index}><span>{item.source_type||item.sourceType||'fonte'}</span>{item.statement||item.claim_supported||item.title}</li>)}</ul>
 </Card>
}

export function KnowledgeCard({items=[]}){
 if(!list(items).length)return null
 return <Card className="val-knowledge-card" icon={BookOpenCheck} label="BIBLIOTECA / MANUAL" title="Conhecimento usado na leitura">
  <ul>{items.slice(0,4).map((item,index)=><li key={item.id||item.knowledge_item_id||index}><Database/>{item.title||item.source_ref||item.id||'Referência governada'}</li>)}</ul>
 </Card>
}

export function ConfirmationCard({title='Informação para confirmar',children,actions=null}){
 return <Card className="val-confirmation-card" icon={ClipboardCheck} label="CONFIRMAÇÃO" title={title}>{children}{actions&&<footer>{actions}</footer>}</Card>
}

export function CalculationCard({reasoning={},onOpen}){
 return <Card className="val-calculation-card" icon={CircleDollarSign} label="VALOR / ROI" title="Leitura econômica" actionLabel="Abrir ferramentas de cálculo" onAction={()=>onOpen?.({page:'agro',tool:'calculators',manualPage:'calculadoras'})}><p>{reasoning.recommended_strategy?.reading||reasoning.situation_summary}</p><small>Hipóteses e unidades devem ser confirmadas antes de usar o resultado em proposta.</small></Card>
}

export function DiagnosisCard({reasoning={},onOpen}){
 return <Card className="val-diagnosis-card" icon={Leaf} label="DIAGNÓSTICO" title="Leitura do material enviado" actionLabel="Abrir diagnóstico completo" onAction={()=>onOpen?.({page:'agro',tool:'diagnosis',manualPage:'diagnostico'})}><p>{reasoning.situation_summary||reasoning.recommended_strategy?.reading}</p><small>Diagnóstico assistido não substitui validação agronômica responsável.</small></Card>
}

export function GenericToolCard({title,summary,status='EXECUTED',onOpen}){
 const normalized=text(status,40)||'EXECUTED'
 const presentation={
  EXECUTED:{label:'FERRAMENTA EXECUTADA',action:'Abrir análise completa',detail:'Resultado governado pelo orquestrador; nenhuma autorização foi delegada ao modelo.'},
  INPUT_REQUIRED:{label:'DADOS NECESSÁRIOS',action:'Abrir ferramenta',detail:'A VAL precisa dos dados indicados antes de calcular ou diagnosticar.'},
  CATALOG:{label:'CAPACIDADES AGRONÔMICAS',action:'Ver Inteligência Agronômica',detail:'Catálogo informativo: disponibilidade não significa execução, fonte atual ou paridade completa.'},
  READY:{label:'MATERIAL RECEBIDO',action:'Abrir ferramenta',detail:'O material foi recebido, mas a análise ainda precisa ser executada e revisada.'},
  CONTEXT_REQUIRED:{label:'CONTEXTO NECESSÁRIO',action:'Selecionar produtor',detail:'Selecione explicitamente um produtor autorizado; a VAL não consultou memória privada sem esse contexto.'},
  NO_DATA:{label:'FONTE NÃO DISPONÍVEL',action:'Abrir módulo',detail:'Nenhum dado atual foi presumido; conecte ou consulte uma fonte autorizada.'}
 }[normalized]||{label:'RESULTADO DA FERRAMENTA',action:'Abrir módulo',detail:'Estado informado pelo orquestrador; nenhuma autorização foi delegada ao modelo.'}
 return <Card className="val-tool-result-card" icon={ClipboardCheck} label={presentation.label} title={title||'Resultado estruturado'} actionLabel={presentation.action} onAction={onOpen}><p>{summary}</p><small>{presentation.detail}</small></Card>
}
