from pathlib import Path


def patch(path, replacements):
    source = Path(path).read_text()
    for old, new, label in replacements:
        count = source.count(old)
        if count != 1:
            raise RuntimeError(f'{path}: {label} apareceu {count} vezes')
        source = source.replace(old, new, 1)
    Path(path).write_text(source)


patch('src/components/ValDecisionWorkspace.jsx', [
    (
        "import {createValProgressRequestId,initialValProgress,startValProgressPolling} from '../lib/val-progress-client'\n",
        "import {createValProgressRequestId,initialValProgress,startValProgressPolling} from '../lib/val-progress-client'\nimport {fetchJsonResource,useAsyncResource} from '../hooks/useAsyncResource'\n",
        'import'
    ),
    (
        " const [status,setStatus]=useState({loading:true,data:null,error:''})\n",
        " const {state:status,run:loadStatus}=useAsyncResource({initialData:null,initialLoading:true,timeoutMs:8_000,timeoutMessage:'A VAL está operando com contexto local.',fallbackMessage:'A VAL está operando com contexto local.'})\n",
        'estado'
    ),
    (
        """ useEffect(()=>{
  const controller=new AbortController()
  fetch('/api/val/status',{signal:typeof AbortSignal.timeout==='function'?AbortSignal.any([controller.signal,AbortSignal.timeout(8000)]):controller.signal})
   .then(async result=>{const payload=await result.json().catch(()=>({}));if(!result.ok)throw new Error(payload.error||'Status indisponível.');return payload})
   .then(data=>setStatus({loading:false,data,error:''}))
   .catch(fetchError=>{if(fetchError.name!=='AbortError')setStatus({loading:false,data:null,error:fetchError.message})})
  return()=>controller.abort()
 },[])
""",
        """ useEffect(()=>{
  loadStatus(({signal})=>fetchJsonResource('/api/val/status',{signal,fallbackMessage:'A VAL está operando com contexto local.'}),{keepData:false})
 },[loadStatus])
""",
        'efeito'
    )
])

patch('src/components/ValPanel.jsx', [
    (
        "import ValProgressFeedback from './ValProgressFeedback'\n",
        "import ValProgressFeedback from './ValProgressFeedback'\nimport {fetchJsonResource,useAsyncResource} from '../hooks/useAsyncResource'\n",
        'import'
    ),
    (
        " const [status,setStatus]=useState({loading:true,data:null,error:''})\n",
        " const {state:status,run:loadStatus}=useAsyncResource({initialData:null,initialLoading:true,timeoutMs:8_000,timeoutMessage:'A VAL está operando com contexto local.',fallbackMessage:'A VAL está operando com contexto local.'})\n",
        'estado'
    ),
    (
        """ useEffect(()=>{
  const controller=new AbortController()
  const signal=typeof AbortSignal.any==='function'?AbortSignal.any([controller.signal,AbortSignal.timeout(8000)]):controller.signal
  fetch('/api/val/status',{signal})
   .then(async result=>{
    if(result.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}
    if(!result.ok)throw new Error('status indisponível')
    return result.json()
   })
   .then(data=>setStatus({loading:false,data,error:''}))
   .catch(fetchError=>{if(fetchError.name!=='AbortError')setStatus({loading:false,data:null,error:'A VAL está operando com contexto local.'})})
  return()=>controller.abort()
 },[])
""",
        """ useEffect(()=>{
  loadStatus(({signal})=>fetchJsonResource('/api/val/status',{signal,fallbackMessage:'A VAL está operando com contexto local.'}),{keepData:false})
 },[loadStatus])
""",
        'efeito'
    )
])
