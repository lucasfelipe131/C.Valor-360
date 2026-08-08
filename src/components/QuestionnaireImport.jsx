import React,{useRef,useState} from 'react'
import {ArrowRight,CheckCircle2,FileSearch,FileText,Link2,LoaderCircle,ScanSearch,Sheet,UploadCloud} from 'lucide-react'
import {parseImportFile,recognizeQuestionnaire} from '../lib/smart-import'

export default function QuestionnaireImport({onReview}){
 const inputRef=useRef(null)
 const [googleUrl,setGoogleUrl]=useState('')
 const [report,setReport]=useState(null)
 const [loading,setLoading]=useState(false)
 const [error,setError]=useState('')
 const inspect=async file=>{
  setLoading(true);setError('');setReport(null)
  try{if(file.size>20_000_000)throw new Error('O arquivo excede 20 MB. Divida-o antes de importar.');const source=await parseImportFile(file);const recognized=recognizeQuestionnaire(source);if(!recognized.recordCount)throw new Error('Não encontrei respostas compatíveis com o Produtor 360 neste arquivo.');setReport({...recognized,fileName:file.name})}
  catch(exception){setError(exception.message||'Não consegui interpretar este arquivo.')}
  finally{setLoading(false)}
 }
 const inspectGoogle=async()=>{
  if(!googleUrl.trim()){setError('Cole o link compartilhado da planilha.');return}
  setLoading(true);setError('');setReport(null)
  try{
   const response=await fetch('/api/import/google-sheet',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:googleUrl}),signal:AbortSignal.timeout(12000)})
   if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}
   const data=await response.json();if(!response.ok)throw new Error(data.error||'Não consegui acessar esta planilha.')
   setReport({...recognizeQuestionnaire({rows:data.rows,format:'Google Sheets'}),fileName:'Planilha Google'})
  }catch(exception){setError(exception.name==='TimeoutError'?'A planilha demorou além do limite. Verifique o compartilhamento e tente novamente.':exception.message)}finally{setLoading(false)}
 }
 return <section className="question-import-studio">
  <div className="import-studio-head"><div><span className="eyebrow">IMPORTAÇÃO ASSISTIDA</span><h2>Importe respostas feitas fora do sistema.</h2><p>O parser sugere correspondências entre perguntas, alternativas e escalas; o consultor revisa tudo antes de compilar.</p></div><div className="scan-emblem"><ScanSearch/><span>RECONHECIMENTO<br/>MULTIFORMATO</span></div></div>
  <div className="import-source-grid"><button className="import-source" onClick={()=>inputRef.current?.click()}><span><UploadCloud/></span><div><b>Enviar arquivo</b><small>Excel, CSV, TSV, JSON, TXT ou PDF</small></div><ArrowRight/></button><input hidden ref={inputRef} type="file" accept=".xlsx,.csv,.tsv,.json,.txt,.pdf" onChange={event=>event.target.files[0]&&inspect(event.target.files[0])}/><div className="google-import"><span><Sheet/></span><div><b>Planilhas Google</b><small>O link precisa estar liberado para visualização.</small><div><input value={googleUrl} onChange={event=>setGoogleUrl(event.target.value)} placeholder="Cole o link compartilhado..."/><button onClick={inspectGoogle}><Link2 size={15}/>Analisar</button></div></div></div></div>
  <div className="format-cloud"><span><FileText/>PDF pesquisável</span><span><Sheet/>Excel .xlsx</span><span><FileSearch/>CSV / TSV</span><span>JSON</span><span>TXT</span></div>
  {loading&&<div className="recognition-loading"><LoaderCircle/><span><b>A Val está lendo o documento</b>Comparando campos, perguntas e alternativas...</span></div>}
  {error&&<div className="form-error" role="alert">{error}</div>}
  {report&&<div className="recognition-report"><div className="recognition-score"><div style={{'--recognition':`${report.confidence*3.6}deg`}}><span><b>{report.confidence}%</b><small>1º perfil</small></span></div></div><div className="recognition-copy"><span className="eyebrow">LEITURA CONCLUÍDA • {report.format}</span><h3>{report.recordCount>1?`${report.recordCount} produtores encontrados`:`${report.recognized.length} de 27 respostas sugeridas`}</h3><p>{report.recordCount>1?'Cada linha será revisada individualmente antes de entrar na carteira.':report.requiredMissing?.length?`${report.requiredMissing.length} campos obrigatórios ainda precisam de revisão.`:'As respostas obrigatórias estão prontas para revisão.'}</p>{report.recordCount>1&&<div className="import-record-list">{report.records.map((record,index)=><span key={`${record.producerName}-${index}`}><b>{record.producerName}</b><small>{record.recognized.length}/27 campos reconhecidos</small></span>)}</div>}<div className="recognized-chips">{report.recognized.slice(0,5).map(item=><span key={item.id}><CheckCircle2/>{String(item.value).slice(0,32)}</span>)}</div><button className="primary-btn" onClick={()=>onReview(report.records.map(record=>({answers:record.answers,producerName:record.producerName})))}>Revisar {report.recordCount>1?`${report.recordCount} perfis`:'e compilar'} <ArrowRight size={16}/></button></div></div>}
 </section>
}
