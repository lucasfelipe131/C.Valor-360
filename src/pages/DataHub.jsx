import React,{useMemo,useRef,useState} from 'react'
import {ArrowRight,BrainCircuit,CheckCircle2,DatabaseZap,FileSpreadsheet,Lightbulb,RefreshCw,ShieldCheck,Sparkles,UploadCloud} from 'lucide-react'
import {parseImportFile,tableToObjects} from '../lib/smart-import'
import {buildCommercialIntelligence,detectColumns,summarizeLearning} from '../lib/commercial-intelligence'

const fieldLabels={client:'Cliente / produtor',value:'Valor do negócio',date:'Data',product:'Produto / categoria',status:'Status / resultado',municipality:'Município',culture:'Cultura',area:'Área'}

export default function DataHub({onImport,onNotify}){
 const inputRef=useRef(null)
 const [file,setFile]=useState(null)
 const [rows,setRows]=useState([])
 const [headers,setHeaders]=useState([])
 const [mapping,setMapping]=useState({})
 const [stage,setStage]=useState('drop')
 const [error,setError]=useState('')
 const [result,setResult]=useState(null)
 const [saving,setSaving]=useState(false)
 const intelligence=useMemo(()=>rows.length&&mapping.client?buildCommercialIntelligence(rows,mapping):[],[rows,mapping])
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
   const response=await fetch('/api/intelligence/imports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({summary,clients})})
   if(!response.ok)throw new Error('Não foi possível sincronizar a aprendizagem com o sistema.')
   onImport?.(clients);setResult({...summary,clients});setStage('done');onNotify?.(`${clients.length} produtores analisados pela Val.`)
  }catch(exception){setError(exception.message);setSaving(false)}
 }
 const reset=()=>{setFile(null);setRows([]);setHeaders([]);setMapping({});setResult(null);setStage('drop');setError('');setSaving(false)}
 return <div className="page-stack data-hub-page">
  <section className="data-hero"><div className="data-hero-copy"><span className="eyebrow">VAL LEARNING ENGINE</span><h2>Seus dados viram instinto comercial.</h2><p>A Val reconhece o histórico da carteira, aprende os padrões de compra e revela o próximo negócio com maior probabilidade de gerar valor.</p><div className="data-trust"><span><ShieldCheck/>Processamento protegido</span><span><BrainCircuit/>Aprendizado progressivo</span></div></div><div className="learning-orbit"><div><BrainCircuit/><b>{result?.clientCount||'IA'}</b><span>{result?'perfis recalibrados':'motor adaptativo'}</span></div><i/><i/><i/></div></section>
  <section className="learning-ribbon"><div><Sparkles/><span><small>SINAL ATIVO</small><b>A Val cruza recência, frequência, valor, conversão e diversidade.</b></span></div><p>Cada novo histórico recalibra o potencial relativo da sua própria carteira — sem usar uma régua genérica.</p></section>
  {stage==='drop'&&<section className="smart-drop panel" onDragOver={event=>event.preventDefault()} onDrop={event=>{event.preventDefault();analyze(event.dataTransfer.files[0])}}><div className="drop-icon"><UploadCloud/></div><span className="eyebrow">IMPORTAÇÃO INTELIGENTE</span><h2>Solte sua planilha. A Val entende o resto.</h2><p>Clientes, vendas, oportunidades ou negócios concluídos em Excel, CSV, TSV e JSON.</p><button className="primary-btn" onClick={()=>inputRef.current?.click()}><FileSpreadsheet size={18}/>Escolher planilha</button><input ref={inputRef} hidden type="file" accept=".xlsx,.csv,.tsv,.json" onChange={event=>event.target.files[0]&&analyze(event.target.files[0])}/><div className="drop-formats"><span>Excel .xlsx</span><span>Google Sheets .csv</span><span>CSV / TSV</span><span>JSON</span></div></section>}
  {stage==='reading'&&<section className="panel intelligence-loading"><RefreshCw/><h2>A Val está reconhecendo sua base...</h2><p>Identificando clientes, valores, datas, produtos e resultados.</p></section>}
  {stage==='map'&&<><section className="panel mapping-panel"><div className="panel-head"><div><span className="eyebrow">MAPEAMENTO AUTOMÁTICO</span><h3>{file?.name}</h3><p>{rows.length} linhas reconhecidas • confirme as colunas antes de aprender</p></div><span className="mapping-score"><CheckCircle2/>Mapeamento inteligente</span></div><div className="mapping-grid">{Object.entries(fieldLabels).map(([field,label])=><label key={field}><span>{label}{field==='client'&&<b> obrigatório</b>}</span><select value={mapping[field]||''} onChange={event=>setMapping(previous=>({...previous,[field]:event.target.value}))}><option value="">Não informado</option>{headers.map(header=><option key={header}>{header}</option>)}</select></label>)}</div></section>
   <section className="data-preview-grid"><article className="panel preview-table"><div className="panel-head"><div><span className="eyebrow">PRÉVIA</span><h3>Leitura dos dados</h3></div></div><div className="table-scroll"><table><thead><tr>{headers.slice(0,5).map(header=><th key={header}>{header}</th>)}</tr></thead><tbody>{rows.slice(0,5).map((row,index)=><tr key={index}>{headers.slice(0,5).map(header=><td key={header}>{String(row[header]??'').slice(0,38)}</td>)}</tr>)}</tbody></table></div></article><article className="panel opportunity-preview"><span className="eyebrow">PRIMEIROS SINAIS</span><h3>{intelligence.length} produtores identificados</h3><div className="signal-list">{intelligence.sort((a,b)=>b.commercial.score-a.commercial.score).slice(0,3).map(client=><div key={client.id}><span>{client.name}</span><b>{client.commercial.score}</b><small>{client.commercial.opportunity}</small></div>)}</div></article></section>
   {error&&<div className="form-error">{error}</div>}<div className="data-actions"><button className="ghost-btn" onClick={reset}>Cancelar</button><button className="primary-btn" disabled={saving} onClick={finish}>{saving?'Aprendendo...':'Incorporar à inteligência'}<ArrowRight size={17}/></button></div></>}
  {stage==='done'&&<section className="learning-result"><div className="result-glow"><DatabaseZap/></div><span className="eyebrow">APRENDIZAGEM CONCLUÍDA</span><h2>A Val ficou mais inteligente com a sua carteira.</h2><p>Os padrões foram incorporados ao Cliente 360, às prioridades e às recomendações comerciais.</p><div className="learning-metrics"><div><small>PRODUTORES</small><b>{result.clientCount}</b></div><div><small>NEGÓCIOS LIDOS</small><b>{result.rowCount}</b></div><div><small>ALTO POTENCIAL</small><b>{result.highPotential}</b></div><div><small>VOLUME HISTÓRICO</small><b>R$ {(result.totalRevenue/1000).toFixed(0)} mil</b></div></div><div className="learning-insight"><Lightbulb/><span><b>O que a Val aprendeu</b>Agora ela reconhece os seus maiores tickets, o ciclo de contato da carteira e as categorias com espaço para venda cruzada.</span></div><button className="primary-btn" onClick={reset}>Importar outra base</button></section>}
  {error&&stage==='drop'&&<div className="form-error">{error}</div>}
 </div>
}
