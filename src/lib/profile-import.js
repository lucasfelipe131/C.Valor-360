export async function saveImportedProfiles(records,fileName='Planilha Produtor 360'){
 const response=await fetch('/api/clients/from-survey/batch',{
  method:'POST',
  headers:{'Content-Type':'application/json'},
  body:JSON.stringify({records:records.map(record=>({answers:record.answers})),fileName}),
  signal:AbortSignal.timeout(60_000)
 })
 if(response.status===401){window.dispatchEvent(new Event('valor360:unauthorized'));throw new Error('Sua sessão expirou.')}
 const payload=await response.json().catch(()=>({}))
 if(!response.ok)throw new Error(payload.error||'Não foi possível atualizar as preferências dos produtores.')
 return payload
}
