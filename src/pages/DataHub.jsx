import React,{useEffect,useMemo,useRef,useState} from 'react'
import {ArrowRight,BrainCircuit,CheckCircle2,DatabaseZap,FileSpreadsheet,Lightbulb,Pencil,RefreshCw,ShieldCheck,Sparkles,Trash2,UploadCloud,UsersRound} from 'lucide-react'
import {parseImportFile,tableToObjects} from '../lib/smart-import'
import {buildCommercialIntelligence,detectColumns,summarizeLearning} from '../lib/commercial-intelligence'
import ProducerProfileEditor from '../components/ProducerProfileEditor'

const fieldLabels={client:'Cliente / produtor',value:'Valor do negócio',date:'Data',product:'Produto / categoria',status:'Status / resultado',municipality:'Município',culture:'Cultura',area:'Área'}

export default function DataHub({clients=[],onImport,onUpdate,onDelete,onNotify}){
 const inputRef=useRef(null)
 const [file,setFile]=useState(null)
 const [rows,setRows]=useState([])
 const [headers,setHeaders]=useState([])
 const [mapping,setMapping]=useState({})
 const [stage,setStage]=useState('drop')
 const [error,setError]=useState('')
 const [result,setResult]=useState(null)
 const [saving,setSaving]=useState(false)
 const [editing,setEditing]=useState(null)
 const [deleting,setDeleting]=useState('')
 const [managedClientId,setManagedClientId]=useState(clients[0]?.id||'')
 const intelligence=useMemo(()=>rows.length&&mapping.client?buildCommercialIntelligence(rows,mapping):[],[rows,mapping])
 const managedClient=clients.find(client=>String(client.id)===String(managedClientId))||clients[0]
 useEffect(()=>{
  if(!clients.some(client=>String(client.id)===String(managedClientId))){setManagedClientId(clients[0]?.id||'');setEditing(null)}
 },[clients,managedClientId])
 const analyze=async selected=>{
  setError('');setFile(selected);setStage('reading')
  try{
   const parsed=await parseImportFile(selected)
   if(!parsed.rows)throw new Error('Para negócios, use Excel, CSV, TSV ou JSON em formato de tabela.')
   const objects=tableToObjects(parsed.rows);if(!objects.length)throw new Error('A planilha não possui linhas de dados reconhecíveis.')
   const foundHeaders=Object.keys(objects[0]);const detected=detectColumns(foundHeaders)
   setRows(objects);setHeaders(foundHeaders);setMapping(detected.mapping);setStage('map')
  }catch(exception){setError(exception.message||'Não consegui ler esta planilha.');setStage('drop')}
 }
 const finish=async()=>{
  if(!mapping.client){setError('Selecione a coluna que identifica o cliente ou produtor.');return}
  setSaving(true);setError('')
  try{
   const clients=buildCommercialIntelligence(rows,mapping);const summary=summarizeLearning(clients,rows.length,file.name)
   const rawRows=rows.slice(0,5000)
   const response=await fetch('/api/intelligence/imports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({summary:{...summary,rawRowCount:rows.length,rawRowsSent:rawRows.length,truncated:rows.length>rawRows.length},clients,rows:rawRows,mapping}),signal:AbortSignal.timeout(30000)})
   if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}
   const saved=await response.json().catch(()=>({}))
   if(!response.ok)throw new Error(saved.error||'Não foi possível incorporar a importação ao sistema.')
   const validatedClients=saved.clients||clients;const validatedSummary=saved.summary||summary
   onImport?.(validatedClients);setResult({...validatedSummary,clients:validatedClients});setStage('done');onNotify?.(`${validatedClients.length} produtores organizados na base.`)
  }catch(exception){setError(exception.name==='TimeoutError'?'A importação demorou além do limite. Verifique a conexão e tente novamente.':exception.message);setSaving(false)}
 }
 const reset=()=>{setFile(null);setRows([]);setHeaders([]);setMapping({});setResult(null);setStage('drop');setError('');setSaving(false)}
 const remove=async client=>{
  if(!window.confirm(`Excluir ${client.name} da sua carteira? O registro sairá das telas, mas continuará auditável no banco.`))return
  setDeleting(client.id);setError('')
  try{await onDelete?.(client.id);if(editing===client.id)setEditing(null)}catch(exception){setError(exception.message||'Não foi possível excluir o produtor.')}finally{setDeleting('')}
 }
 return <div className="page-stack data-hub-page">
  <section className="data-hero"><div className="data-hero-copy"><span className="eyebrow">VAL • CONTEXTO COMERCIAL</span><h2>Seus dados viram contexto verificável.</h2><p>A VAL organiza recência, frequência, valor, resultado e categorias para propor hipóteses que o consultor ainda precisa validar.</p><div className="data-trust"><span><ShieldCheck/>Processamento protegido</span><span><BrainCircuit/>Memória auditável</span></div></div><div className="learning-orbit"><div><BrainCircuit/><b>{result?.clientCount||'IA'}</b><span>{result?'contas organizadas':'motor auditável'}</span></div><i/><i/><i/></div></section>
  <section className="learning-ribbon"><div><Sparkles/><span><small>ÍNDICE DE TRIAGEM</small><b>A VAL cruza recência, frequência, valor, resultado e diversidade.</b></span></div><p>O índice é heurístico e relativo à base importada; não é probabilidade de compra nem potencial financeiro validado.</p></section>
  {stage==='drop'&&<section className="smart-drop panel" onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();analyze(event.dataTransfer.files[0])}}><div className="drop-icon"><UploadCloud/></div><span className="eyebrow">IMPORTAÇÃO ASSISTIDA</span><h2>Solte sua planilha e confirme o mapeamento.</h2><p>O parser reconhece colunas de clientes e negócios em Excel, CSV, TSV e JSON; você valida antes de incorporar.</p><button className="primary-btn" onClick={()=>inputRef.current?.click()}><FileSpreadsheet size={18}/>Escolher planilha</button><input ref={inputRef} hidden type="file" accept=".xlsx,.csv,.tsv,.json" onChange={event=>event.target.files[0]&&analyze(event.target.files[0])}/><div className="drop-formats"><span>Excel .xlsx</span><span>Google Sheets .csv</span><span>CSV / TSV</span><span>JSON</span></div></section>}
  {stage==='reading'&&<section className="panel intelligence-loading"><RefreshCw/><h2>A Val está reconhecendo sua base...</h2><p>Identificando clientes, valores, datas, produtos e resultados.</p></section>}
  {stage==='map'&&<><section className="panel mapping-panel"><div className="panel-head"><div><span className="eyebrow">MAPEAMENTO AUTOMÁTICO</span><h3>{file?.name}</h3><p>{rows.length} linhas reconhecidas • confirme as colunas antes de incorporar</p></div><span className="mapping-score"><CheckCircle2/>Mapeamento inteligente</span></div><div className="mapping-grid">{Object.entries(fieldLabels).map(([field,label])=><label key={field}><span>{label}{field==='client'&&<b> obrigatório</b>}</span><select value={mapping[field]||''} onChange={event=>setMapping(previous=>({...previous,[field]:event.target.value}))}><option value="">Não informado</option>{headers.map(header=><option key={header}>{header}</option>)}</select></label>)}</div></section>
   <section className="data-preview-grid"><article className="panel preview-table"><div className="panel-head"><div><span className="eyebrow">PRÉVIA</span><h3>Leitura dos dados</h3></div></div><div className="table-scroll"><table><thead><tr>{headers.slice(0,5).map(header=><th key={header}>{header}</th>)}</tr></thead><tbody>{rows.slice(0,5).map((row,index)=><tr key={index}>{headers.slice(0,5).map(header=><td key={header}>{String(row[header]??'').slice(0,38)}</td>)}</tr>)}</tbody></table></div></article><article className="panel opportunity-preview"><span className="eyebrow">PRIMEIROS SINAIS</span><h3>{intelligence.length} produtores identificados</h3><div className="signal-list">{intelligence.sort((a,b)=>b.commercial.score-a.commercial.score).slice(0,3).map(client=><div key={client.id}><span>{client.name}</span><b>Índice {client.commercial.score}</b><small>{client.commercial.opportunity}</small></div>)}</div></article></section>
   {error&&<div className="form-error" role="alert">{error}</div>}<div className="data-actions"><button className="ghost-btn" onClick={reset}>Cancelar</button><button className="primary-btn" disabled={saving} onClick={finish}>{saving?'Incorporando...':'Incorporar à inteligência'}<ArrowRight size={17}/></button></div></>}
  {stage==='done'&&<section className="learning-result"><div className="result-glow"><DatabaseZap/></div><span className="eyebrow">BASE INCORPORADA</span><h2>O contexto comercial foi atualizado.</h2><p>Os fatos históricos foram incorporados ao Cliente 360; sinais e hipóteses continuam sujeitos à validação do consultor.</p><div className="learning-metrics"><div><small>PRODUTORES</small><b>{result.clientCount}</b></div><div><small>REGISTROS LIDOS</small><b>{result.rowCount}</b></div><div><small>ÍNDICE ALTO</small><b>{result.highIndex??0}</b></div><div><small>VOLUME INFORMADO</small><b>R$ {(result.totalRevenue/1000).toFixed(0)} mil</b></div></div><div className="learning-insight"><Lightbulb/><span><b>O que a VAL registrou</b>Somente datas, valores, resultados e categorias presentes na base — campos ausentes permanecem desconhecidos.</span></div><button className="primary-btn" onClick={reset}>Importar outra base</button></section>}
  {error&&stage==='drop'&&<div className="form-error" role="alert">{error}</div>}
  <section className="panel producer-base-manager">
   <div className="panel-head"><div><span className="eyebrow">GESTÃO DA BASE</span><h3>Produtores deste login</h3><p>Edite nome, propriedade, compras, potencial e preferências; ou retire um produtor da carteira.</p></div><span className="mapping-score"><UsersRound/>{clients.length} produtores</span></div>
   {!clients.length?<div className="inbox-empty"><UsersRound/><h3>Esta carteira está zerada.</h3><p>Preencha o Produtor 360 ou importe uma base para começar.</p></div>:<>
    <label className="producer-manager-select"><span>Produtor para consultar ou editar</span><select value={managedClient?.id||''} onChange={event=>{setManagedClientId(event.target.value);setEditing(null)}}>{clients.map(client=><option key={client.id} value={client.id}>{client.name} — {client.municipality||'município a informar'}</option>)}</select><small>A carteira permanece recolhida; somente o cadastro selecionado é exibido.</small></label>
    {managedClient&&<div className="producer-manage-list"><article key={managedClient.id} className={editing===managedClient.id?'is-editing':''}>
     <div className="producer-manage-summary"><div><b>{managedClient.name}</b><small>{managedClient.municipality||'Município não informado'} • {managedClient.commercial?.property||'Propriedade não informada'}</small></div><div className="producer-manage-metrics"><span>Compras <b>R$ {Number(managedClient.commercial?.purchaseTotal||0).toLocaleString('pt-BR')}</b></span><span>Em aberto <b>R$ {Number(managedClient.commercial?.openPotential??managedClient.commercial?.openPipeline??0).toLocaleString('pt-BR')}</b></span></div><div className="producer-manage-actions"><button type="button" onClick={()=>setEditing(current=>current===managedClient.id?null:managedClient.id)}><Pencil/>Editar</button><button type="button" className="danger-text" disabled={deleting===managedClient.id} onClick={()=>remove(managedClient)}><Trash2/>{deleting===managedClient.id?'Excluindo…':'Excluir'}</button></div></div>
     {editing===managedClient.id&&<ProducerProfileEditor compact client={managedClient} onSave={async(id,input)=>{await onUpdate?.(id,input);setEditing(null);onNotify?.('Cadastro do produtor atualizado na nuvem.')}} onCancel={()=>setEditing(null)}/>}
    </article></div>}
   </>}
  </section>
 </div>
}
