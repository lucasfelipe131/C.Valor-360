type Producer = {id:string;external_key:string|null;isDemo:boolean};
type Row = Record<string, unknown>;
const text=(value:unknown)=>typeof value==='string'?value.trim().slice(0,300):'';
// Read only actual declared registration fields. The producer name is an
// association, never a replacement for the name of a registry's holder.
export function producerMapRegistrations(producers:unknown,producer:Producer){
 const ids=new Set([producer.id,producer.external_key].filter(Boolean));
 const records=Array.isArray(producers)?producers as Row[]:[];
 return records.filter(row=>{
  if(!row||(!producer.isDemo&&String(row.isDemo)==='true'))return false;
  const bindings=[row.crmCode,row.canonicalProducerId].filter(id=>typeof id==='string'&&id.trim());
  return bindings.length?bindings.every(id=>ids.has(id as string)):typeof row.id==='string'&&ids.has(row.id);
 }).flatMap(row=>{
  const registrations=Array.isArray(row.registrations)?row.registrations as Row[]:[];
  return registrations.flatMap(registration=>{
   if(!registration||!text(registration.number))return [];
   const points=registration.points;
   if(!Array.isArray(points)||points.length<3||points.length>2500||points.some(p=>!p||typeof p.lat!=='number'||typeof p.lng!=='number'||!Number.isFinite(p.lat)||!Number.isFinite(p.lng)||Math.abs(p.lat)>90||Math.abs(p.lng)>180))return [];
   return [{id:text(registration.id),number:text(registration.number),ownerName:text(registration.ownerName),propertyName:text(registration.propertyName),producerName:text(row.name),registryOffice:text(registration.registryOffice),status:text(registration.status),points:points.map(p=>({lat:p.lat,lng:p.lng})),source:'Cadastro de matrículas do Manual do Agrônomo',isDemo:producer.isDemo}];
  });
 }).slice(0,300);
}
