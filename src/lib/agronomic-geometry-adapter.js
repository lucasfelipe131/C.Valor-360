export const AGRONOMIC_GEOMETRY_ADAPTER_VERSION='AgronomicGeometryAdapter.v1'
export const AGRONOMIC_GEOMETRY_REF_PREFIX=`val-geometry:${AGRONOMIC_GEOMETRY_ADAPTER_VERSION}:`

const MAX_POLYGONS=50
const MAX_RINGS_PER_POLYGON=50
const MAX_POSITIONS=5_000
const EARTH_LATITUDE_METERS=110_540

export class AgronomicGeometryAdapterError extends Error{
 constructor(message,code='geometry_contract_invalid'){
  super(message);this.name='AgronomicGeometryAdapterError';this.code=code
 }
}

const text=(value,maximum=240)=>String(value??'').trim().slice(0,maximum)
const rounded=value=>Number(Number(value).toFixed(7))
const samePosition=(left,right)=>left[0]===right[0]&&left[1]===right[1]
const clone=value=>JSON.parse(JSON.stringify(value))
const fail=(message,code)=>{throw new AgronomicGeometryAdapterError(message,code)}

function coordinate(value,path){
 if(!Array.isArray(value)||value.length<2)fail(`Coordenada ausente ou incompleta em ${path}.`,'geometry_coordinate_invalid')
 const longitude=Number(value[0]);const latitude=Number(value[1])
 if(!Number.isFinite(longitude)||!Number.isFinite(latitude))fail(`Coordenada não numérica em ${path}.`,'geometry_coordinate_invalid')
 if(longitude< -180||longitude>180||latitude< -90||latitude>90)fail(`Coordenada fora de EPSG:4326 em ${path}.`,'geometry_coordinate_out_of_range')
 return [rounded(longitude),rounded(latitude)]
}

function normalizeRing(value,path,counter){
 if(!Array.isArray(value))fail(`Anel inválido em ${path}.`,'geometry_ring_invalid')
 const ring=[]
 value.forEach((item,index)=>{
  counter.count+=1
  if(counter.count>MAX_POSITIONS)fail(`A geometria excede ${MAX_POSITIONS} posições.`,'geometry_too_complex')
  const next=coordinate(item,`${path}[${index}]`)
  if(!ring.length||!samePosition(ring.at(-1),next))ring.push(next)
 })
 if(ring.length>1&&samePosition(ring[0],ring.at(-1)))ring.pop()
 if(new Set(ring.map(item=>item.join(','))).size<3)fail(`Anel com menos de três vértices únicos em ${path}.`,'geometry_ring_incomplete')
 ring.push([...ring[0]])
 return ring
}

function normalizePolygon(value,path,counter){
 if(!Array.isArray(value)||!value.length||value.length>MAX_RINGS_PER_POLYGON)fail(`Polígono inválido em ${path}.`,'geometry_polygon_invalid')
 return value.map((ring,index)=>normalizeRing(ring,`${path}[${index}]`,counter))
}

export function normalizeCanonicalGeometry(value){
 const candidate=value?.geometry&&typeof value.geometry==='object'?value.geometry:value
 if(!candidate||typeof candidate!=='object')fail('Geometria ausente.','geometry_missing')
 const counter={count:0}
 if(candidate.type==='Polygon')return {type:'Polygon',coordinates:normalizePolygon(candidate.coordinates,'geometry.coordinates',counter)}
 if(candidate.type==='MultiPolygon'){
  if(!Array.isArray(candidate.coordinates)||!candidate.coordinates.length||candidate.coordinates.length>MAX_POLYGONS)fail('MultiPolygon inválido.','geometry_multipolygon_invalid')
  return {type:'MultiPolygon',coordinates:candidate.coordinates.map((polygon,index)=>normalizePolygon(polygon,`geometry.coordinates[${index}]`,counter))}
 }
 fail('Somente Polygon e MultiPolygon são aceitos.','geometry_type_unsupported')
}

function geometryFromManual(input){
 if(input?.geometry)return normalizeCanonicalGeometry(input.geometry)
 if(Array.isArray(input?.points)){
  const coordinates=input.points.map(point=>[point?.lng,point?.lat])
  return normalizeCanonicalGeometry({type:'Polygon',coordinates:[coordinates]})
 }
 if(Array.isArray(input?.polygons)){
  const coordinates=input.polygons.map(polygon=>{
   const rings=Array.isArray(polygon?.[0])&&polygon[0]?.[0]&&typeof polygon[0][0]==='object'?polygon:[polygon]
   return rings.map(ring=>ring.map(point=>[point?.lng,point?.lat]))
  })
  return normalizeCanonicalGeometry({type:'MultiPolygon',coordinates})
 }
 fail('O Manual não forneceu pontos, polígonos ou GeoJSON.','geometry_missing')
}

function ringAreaHa(ring){
 const open=ring.slice(0,-1)
 const meanLatitude=open.reduce((total,position)=>total+position[1],0)/open.length
 const longitudeMeters=111_320*Math.cos(meanLatitude*Math.PI/180)
 let twiceArea=0
 open.forEach((position,index)=>{
  const next=open[(index+1)%open.length]
  twiceArea+=(position[0]*longitudeMeters)*(next[1]*EARTH_LATITUDE_METERS)-(next[0]*longitudeMeters)*(position[1]*EARTH_LATITUDE_METERS)
 })
 return Math.abs(twiceArea)/2/10_000
}

export function canonicalGeometryAreaHa(value){
 const geometry=normalizeCanonicalGeometry(value)
 const polygons=geometry.type==='Polygon'?[geometry.coordinates]:geometry.coordinates
 return polygons.reduce((total,polygon)=>total+Math.max(0,ringAreaHa(polygon[0])-polygon.slice(1).reduce((holes,ring)=>holes+ringAreaHa(ring),0)),0)
}

function geometryFingerprint(geometry){
 const source=JSON.stringify(geometry)
 let hash=0xcbf29ce484222325n
 for(let index=0;index<source.length;index+=1){hash^=BigInt(source.charCodeAt(index));hash=BigInt.asUintN(64,hash*0x100000001b3n)}
 return hash.toString(16).padStart(16,'0')
}

function safeProvenance(value={}){
 const input=value&&typeof value==='object'&&!Array.isArray(value)?value:{}
 const details=input.details&&typeof input.details==='object'&&!Array.isArray(input.details)?input.details:{}
 return {
  source:text(input.source||'manual-do-agronomo',100),
  sourceRef:text(input.sourceRef,500)||null,
  sourceEventId:text(input.sourceEventId,180)||null,
  method:text(input.method||'manual-workspace',100),
  observedAt:text(input.observedAt,80)||null,
  capturedBy:text(input.capturedBy,180)||null,
  details:Object.fromEntries(Object.entries(details).slice(0,40).map(([key,item])=>[
   text(key,80),typeof item==='number'||typeof item==='boolean'?item:text(item,500)
  ]))
 }
}

const suppliedArea=value=>{const parsed=Number(value);return Number.isFinite(parsed)&&parsed>=0?Number(parsed.toFixed(6)):null}

export function manualToCanonicalValGeometry(input={}){
 const organizationId=text(input.organizationId,80)
 const propertyId=text(input.propertyId||input.propertyExternalKey,180)
 const fieldId=text(input.fieldId||input.fieldExternalKey,180)
 if(!organizationId)fail('A organização é obrigatória para canonicalizar a geometria.','geometry_organization_required')
 if(!propertyId||!fieldId)fail('Propriedade e talhão são obrigatórios para vincular a geometria.','geometry_link_required')
 const geometry=geometryFromManual(input)
 const geometryVersion=`agv1-${geometryFingerprint(geometry)}`
 const calculatedAreaHa=Number(canonicalGeometryAreaHa(geometry).toFixed(6))
 const manualAreaHa=suppliedArea(input.areaHa??input.area)
 return {
  adapterVersion:AGRONOMIC_GEOMETRY_ADAPTER_VERSION,
  geometryVersion,
  crs:'EPSG:4326',
  unit:{coordinates:'decimal_degrees',area:'ha'},
  link:{
   state:'LINKED_FIELD',organizationId,clientId:text(input.clientId,180)||null,clientExternalKey:text(input.clientExternalKey,180)||null,
   propertyId,propertyExternalKey:text(input.propertyExternalKey,180)||null,propertyName:text(input.propertyName,180)||null,
   fieldId,fieldExternalKey:text(input.fieldExternalKey,180)||null,sourceFieldId:text(input.sourceFieldId,180)||null,fieldName:text(input.fieldName,180)||null,revision:1,history:[]
  },
  geometry,
  measurements:{calculatedAreaHa,suppliedAreaHa:manualAreaHa,areaDeltaHa:manualAreaHa===null?null:Number((manualAreaHa-calculatedAreaHa).toFixed(6))},
  provenance:safeProvenance(input.provenance)
 }
}

function assertCanonicalValue(value,{expectedOrganizationId}={}){
 if(!value||typeof value!=='object'||Array.isArray(value))fail('Envelope canônico inválido.','geometry_contract_invalid')
 if(value.adapterVersion!==AGRONOMIC_GEOMETRY_ADAPTER_VERSION)fail('Versão do adapter de geometria não suportada.','geometry_adapter_version_unsupported')
 const geometry=normalizeCanonicalGeometry(value.geometry)
 const expectedVersion=`agv1-${geometryFingerprint(geometry)}`
 if(value.geometryVersion!==expectedVersion)fail('A versão não corresponde ao conteúdo da geometria.','geometry_version_mismatch')
 const organizationId=text(value.link?.organizationId,80)
 if(!organizationId)fail('Envelope canônico sem organização.','geometry_organization_required')
 if(expectedOrganizationId&&organizationId!==text(expectedOrganizationId,80))fail('Geometria pertence a outra organização.','cross_tenant_geometry_denied')
 if(!['LINKED_FIELD','UNLINKED'].includes(value.link?.state))fail('Estado de vínculo da geometria inválido.','geometry_link_state_invalid')
 if(value.link.state==='LINKED_FIELD'&&(!text(value.link.propertyId,180)||!text(value.link.fieldId,180)))fail('Vínculo de propriedade/talhão incompleto.','geometry_link_required')
 return {...clone(value),geometry}
}

export function rebindCanonicalValGeometry(value,input={}){
 const canonical=assertCanonicalValue(value,{expectedOrganizationId:input.organizationId})
 const state=input.state==='UNLINKED'?'UNLINKED':'LINKED_FIELD'
 const revision=Math.max(1,Number(canonical.link.revision)||1)+1
 const history=[...(Array.isArray(canonical.link.history)?canonical.link.history:[]),{
  from:canonical.link.state,to:state,at:text(input.at,80)||new Date().toISOString(),reason:text(input.reason,240)||'USER_EXPLICIT'
 }].slice(-50)
 const link=state==='UNLINKED'
  ?{state,organizationId:canonical.link.organizationId,clientId:null,clientExternalKey:null,propertyId:null,propertyExternalKey:null,propertyName:null,fieldId:null,fieldExternalKey:null,sourceFieldId:null,fieldName:null,revision,history}
  :{state,organizationId:canonical.link.organizationId,clientId:text(input.clientId,180)||null,clientExternalKey:text(input.clientExternalKey,180)||null,propertyId:text(input.propertyId,180),propertyExternalKey:text(input.propertyExternalKey,180)||null,propertyName:text(input.propertyName,180)||null,fieldId:text(input.fieldId,180),fieldExternalKey:text(input.fieldExternalKey,180)||null,sourceFieldId:text(input.sourceFieldId,180)||null,fieldName:text(input.fieldName,180)||null,revision,history}
 if(state==='LINKED_FIELD'&&(!link.propertyId||!link.fieldId))fail('O novo vínculo exige propriedade e talhão.','geometry_link_required')
 return {...canonical,link}
}

export function canonicalValToManualGeometry(value,options={}){
 const canonical=assertCanonicalValue(value,options)
 const polygons=(canonical.geometry.type==='Polygon'?[canonical.geometry.coordinates]:canonical.geometry.coordinates).map(polygon=>polygon.map(ring=>ring.slice(0,-1).map(([lng,lat])=>({lat,lng}))))
 return {
  adapterVersion:canonical.adapterVersion,geometryVersion:canonical.geometryVersion,
  geometry:canonical.geometry,points:canonical.geometry.type==='Polygon'?polygons[0][0]:[],polygons,
  area:canonical.measurements.calculatedAreaHa,calculatedAreaHa:canonical.measurements.calculatedAreaHa,
  suppliedAreaHa:canonical.measurements.suppliedAreaHa,unit:'ha',link:canonical.link,provenance:canonical.provenance
 }
}

export function encodeCanonicalGeometryRef(value){
 const canonical=assertCanonicalValue(value)
 return `${AGRONOMIC_GEOMETRY_REF_PREFIX}${JSON.stringify(canonical)}`
}

export function decodeCanonicalGeometryRef(value,options={}){
 const source=String(value||'')
 if(!source.startsWith(AGRONOMIC_GEOMETRY_REF_PREFIX))fail('Referência de geometria desconhecida.','geometry_ref_invalid')
 try{return assertCanonicalValue(JSON.parse(source.slice(AGRONOMIC_GEOMETRY_REF_PREFIX.length)),options)}catch(error){
  if(error instanceof AgronomicGeometryAdapterError)throw error
  fail('Referência de geometria corrompida.','geometry_ref_invalid')
 }
}
