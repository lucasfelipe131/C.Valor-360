from pathlib import Path


def patch(path, replacements):
    source = Path(path).read_text()
    for old, new, label in replacements:
        count = source.count(old)
        if count != 1:
            raise RuntimeError(f'{path}: {label} apareceu {count} vezes')
        source = source.replace(old, new, 1)
    Path(path).write_text(source)


patch('src/components/ProducerBusinessOverview.jsx', [
    (
        "import {\n BadgeDollarSign,BarChart3,CalendarClock,Cloud,DatabaseZap,FileBarChart,\n Layers3,MapPinned,ShoppingCart,Target,TrendingUp,WalletCards\n} from 'lucide-react'\n",
        "import {\n BadgeDollarSign,BarChart3,CalendarClock,Cloud,DatabaseZap,FileBarChart,\n Layers3,MapPinned,ShoppingCart,Target,TrendingUp,WalletCards\n} from 'lucide-react'\nimport {fetchJsonResource,useAsyncResource} from '../hooks/useAsyncResource'\n",
        'import'
    ),
    (
        """ const [state,setState]=useState({loading:true,data:null,error:''})
 useEffect(()=>{
  const controller=new AbortController();setState(current=>({...current,loading:true,error:''}))
  fetch(`/api/clients/${encodeURIComponent(client.id)}/overview`,{signal:typeof AbortSignal.any==='function'?AbortSignal.any([controller.signal,AbortSignal.timeout(12000)]):controller.signal})
   .then(async response=>{if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'Não foi possível consolidar as métricas.');return payload})
   .then(data=>setState({loading:false,data,error:''}))
   .catch(error=>{if(error.name!=='AbortError')setState(current=>({...current,loading:false,error:error.name==='TimeoutError'?'A consolidação demorou além do limite.':error.message}))})
  return()=>controller.abort()
 },[client.id,refreshToken])
""",
        """ const {state,run:loadOverview}=useAsyncResource({initialData:null,initialLoading:true,timeoutMs:12_000,timeoutMessage:'A consolidação demorou além do limite.',fallbackMessage:'Não foi possível consolidar as métricas.'})
 useEffect(()=>{
  loadOverview(({signal})=>fetchJsonResource(`/api/clients/${encodeURIComponent(client.id)}/overview`,{signal,fallbackMessage:'Não foi possível consolidar as métricas.'}),{keepData:true})
 },[client.id,refreshToken,loadOverview])
""",
        'estado e carregamento'
    )
])

patch('src/components/SogWorkspace.jsx', [
    (
        "} from 'lucide-react'\n",
        "} from 'lucide-react'\nimport {requestJsonResource,useAsyncResource} from '../hooks/useAsyncResource'\n",
        'import'
    ),
    (
        """async function api(path,options={}){
 const response=await fetch(path,{...options,headers:{...(options.body?{'Content-Type':'application/json'}:{}),...options.headers},signal:AbortSignal.timeout(15_000)})
 if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}
 const payload=await response.json().catch(()=>({}))
 if(!response.ok)throw new Error(payload.error||'Não foi possível concluir a operação na SOG.')
 return payload
}
""",
        """async function api(path,options={}){
 const {timeoutMs=15_000,...requestOptions}=options
 return requestJsonResource(path,{...requestOptions,headers:{...(requestOptions.body?{'Content-Type':'application/json'}:{}),...requestOptions.headers},timeoutMs,timeoutMessage:'A operação na SOG demorou além do limite.',fallbackMessage:'Não foi possível concluir a operação na SOG.'})
}
""",
        'cliente HTTP'
    ),
    (
        """ const [workspace,setWorkspace]=useState(emptyWorkspace);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [notice,setNotice]=useState('');const [tab,setTab]=useState('opportunities');const [modal,setModal]=useState(null);const [profileTarget,setProfileTarget]=useState(null);const [search,setSearch]=useState('')
 const load=useCallback(async()=>{setLoading(true);setError('');try{setWorkspace(await api('/api/grains/bootstrap'))}catch(exception){setError(exception.message)}finally{setLoading(false)}},[])
""",
        """ const {data:workspaceData,loading,error,run:loadWorkspace}=useAsyncResource({initialData:emptyWorkspace,initialLoading:true,timeoutMs:15_000,timeoutMessage:'A SOG demorou além do limite para carregar a carteira.',fallbackMessage:'Não foi possível carregar a base da SOG.'})
 const workspace=workspaceData||emptyWorkspace
 const [notice,setNotice]=useState('');const [tab,setTab]=useState('opportunities');const [modal,setModal]=useState(null);const [profileTarget,setProfileTarget]=useState(null);const [search,setSearch]=useState('')
 const load=useCallback(()=>loadWorkspace(({signal})=>api('/api/grains/bootstrap',{signal,timeoutMs:0}),{keepData:true}),[loadWorkspace])
""",
        'estado principal'
    )
])
