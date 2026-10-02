export const isK5Synthetic=client=>client?.source==='k5_synthetic_fixture'
export const realBusinessClients=(clients=[])=>clients.filter(client=>!isK5Synthetic(client))
export function realBusinessRecords(records=[],clients=[]){
 const excluded=new Set(clients.filter(isK5Synthetic).flatMap(client=>[client.id,client.databaseId].filter(Boolean).map(String)))
 return records.filter(record=>!isK5Synthetic(record.client)&&!excluded.has(String(record.clientId??record.client_id)))
}
