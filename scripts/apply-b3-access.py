from pathlib import Path

path = Path('src/components/AccessManagement.jsx')
source = path.read_text()


def replace(old, new, label):
    global source
    count = source.count(old)
    if count != 1:
        raise RuntimeError(f'{label} apareceu {count} vezes')
    source = source.replace(old, new, 1)


replace("import React,{useEffect,useState} from 'react'\n", "import React,{useCallback,useEffect,useState} from 'react'\n", 'import React')
replace(
    "import {Check,Copy,KeyRound,LoaderCircle,Pencil,Plus,RefreshCw,ShieldCheck,UserCheck,UserX,UsersRound} from 'lucide-react'\n",
    "import {Check,Copy,KeyRound,LoaderCircle,Pencil,Plus,RefreshCw,ShieldCheck,UserCheck,UserX,UsersRound} from 'lucide-react'\nimport {fetchJsonResource,requestJsonResource,useAsyncResource} from '../hooks/useAsyncResource'\n",
    'import do hook'
)
replace(
    """ const [users,setUsers]=useState([])
 const [form,setForm]=useState(emptyForm)
 const [editing,setEditing]=useState(null)
 const [draft,setDraft]=useState(null)
 const [temporary,setTemporary]=useState(null)
 const [loading,setLoading]=useState(true)
 const [saving,setSaving]=useState(false)
 const [error,setError]=useState('')
 const load=()=>{setLoading(true);setError('');return fetch(accessApi,{signal:AbortSignal.timeout(10000)}).then(async response=>{if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'Não foi possível carregar os acessos.');setUsers(payload.users||[])}).catch(exception=>setError(exception.message)).finally(()=>setLoading(false))}
 useEffect(()=>{if(currentUser?.role==='admin')load()},[currentUser?.role])
""",
    """ const {data:usersData,loading,error,run:loadUsers,setData:setUsers,setError}=useAsyncResource({initialData:[],initialLoading:true,timeoutMs:10_000,timeoutMessage:'A consulta de acessos demorou além do limite.',fallbackMessage:'Não foi possível carregar os acessos.'})
 const users=usersData||[]
 const [form,setForm]=useState(emptyForm)
 const [editing,setEditing]=useState(null)
 const [draft,setDraft]=useState(null)
 const [temporary,setTemporary]=useState(null)
 const [saving,setSaving]=useState(false)
 const load=useCallback(()=>loadUsers(async({signal})=>{const payload=await fetchJsonResource(accessApi,{signal,fallbackMessage:'Não foi possível carregar os acessos.'});return payload.users||[]},{keepData:true}),[loadUsers])
 useEffect(()=>{if(currentUser?.role==='admin')load()},[currentUser?.role,load])
""",
    'estado principal'
)
replace(
    "const response=await fetch(accessApi,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form),signal:AbortSignal.timeout(15000)});const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'Não foi possível liberar o acesso.');",
    "const payload=await requestJsonResource(accessApi,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(form),timeoutMs:15_000,fallbackMessage:'Não foi possível liberar o acesso.'});",
    'criação'
)
replace(
    "const response=await fetch(accessApi,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(15000)});const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'Não foi possível atualizar o acesso.');",
    "const payload=await requestJsonResource(accessApi,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),timeoutMs:15_000,fallbackMessage:'Não foi possível atualizar o acesso.'});",
    'atualização'
)
replace(
    "const response=await fetch(`${accessApi}/reset-password`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:user.id}),signal:AbortSignal.timeout(15000)});const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||'Não foi possível redefinir a senha.');",
    "const payload=await requestJsonResource(`${accessApi}/reset-password`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:user.id}),timeoutMs:15_000,fallbackMessage:'Não foi possível redefinir a senha.'});",
    'redefinição'
)
path.write_text(source)
