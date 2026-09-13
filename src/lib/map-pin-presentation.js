// Only the protected, canonical photo endpoints can supply map thumbnails.
export function pinPhotoUrls(pin){
 return [...new Set([pin.propertyPhotoUrl,pin.producerPhotoUrl].filter(value=>typeof value==='string'&&/^\/api\/clients\/[^/?#]+(?:\/properties\/[^/?#]+)?\/profile-photo\?content=1(?:&[^#]*)?$/.test(value)))]
}

export function nearbyPropertyPins(pin,pins,project){
 const isProperty=item=>Boolean(item.propertyId)||String(item.id||'').startsWith('property:')
 if(!isProperty(pin)||!project)return [pin]
 const center=project(pin)
 return pins.filter(item=>{
  if(!isProperty(item))return false
  const point=project(item)
  return point&&center&&Math.hypot(point.x-center.x,point.y-center.y)<=40
 })
}

const intersects=(a,b)=>a.left<b.right&&a.right>b.left&&a.top<b.bottom&&a.bottom>b.top
// Pixel grid keeps label decluttering bounded even for large portfolios.
// O rotulo e centrado no pino. Descartar todo rotulo que passasse da borda deixava o pino mais a
// direita (e o mais a esquerda) sem nome — no telefone, com a tela estreita, isso acontecia sempre.
// Agora o rotulo desliza para dentro do mapa em vez de sumir; so some quando nao cabe de jeito
// nenhum ou quando esbarraria em outro. O deslocamento sai em `offsets`.
export function visiblePinLabels(entries,markers,bounds){
 const grid=new Map(),visible=new Set(),offsets=new Map(),size=64
 const cells=rect=>{const keys=[];for(let x=Math.floor(rect.left/size);x<=Math.floor(rect.right/size);x++)for(let y=Math.floor(rect.top/size);y<=Math.floor(rect.bottom/size);y++)keys.push(`${x}:${y}`);return keys}
 const occupy=item=>{for(const key of cells(item.rect)){if(!grid.has(key))grid.set(key,[]);grid.get(key).push(item)}}
 for(const marker of markers)if(intersects(marker.rect,bounds))occupy(marker)
 for(const item of [...entries].sort((a,b)=>Number(Boolean(b.active))-Number(Boolean(a.active))||Number(Boolean(b.selected))-Number(Boolean(a.selected)))){
  const r=item.rect
  if(!r.width||!r.height||r.top<bounds.top||r.bottom>bounds.bottom||r.width>bounds.width)continue
  const shift=r.left<bounds.left?bounds.left-r.left:r.right>bounds.right?bounds.right-r.right:0
  const placed=shift?{...r,left:r.left+shift,right:r.right+shift}:r
  if(cells(placed).some(key=>(grid.get(key)||[]).some(other=>other.id!==item.id&&intersects(placed,other.rect))))continue
  visible.add(item.id);if(shift)offsets.set(item.id,shift);occupy({id:item.id,rect:placed})
 }
 return Object.assign(visible,{offsets})
}
