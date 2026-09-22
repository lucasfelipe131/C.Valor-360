import {readFileSync} from 'node:fs'
import {createHash} from 'node:crypto'

// Latent semantic analysis of the approved public corpus only. No session,
// producer text or user document is added to this fixed index.
let cached
const stop=new Set('a ao aos as com como da das de do dos e ele ela em entre essa esse esta este eu foi ha isso ja mais mas na nas no nos o os ou para pela pelo por que se sem ser sua suas seu seus tem um uma voce qual quais quem quando onde quanto porque sobre deve pode antes depois'.split(' '))
export function latentTokens(value){return String(value||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').match(/[a-z0-9]+/g)?.filter(w=>w.length>2&&!stop.has(w))||[]}
function index(){
 if(cached)return cached
 const raw=readFileSync(new URL('../../knowledge/library/v1/knowledge_items.jsonl',import.meta.url))
 const data=JSON.parse(readFileSync(new URL('../../knowledge/library/v1/latent-index.json',import.meta.url),'utf8'))
 if(createHash('sha256').update(raw).digest('hex')!==data.corpus_sha256)throw new Error('LATENT_INDEX_CORPUS_MISMATCH')
 return cached=data
}
export function retrieveLatentKnowledge(query){
 const data=index(),counts=new Map(),vector=Array(data.dimensions).fill(0)
 for(const word of latentTokens(query))counts.set(word,(counts.get(word)||0)+1)
 let known=0
 for(const [word,count] of counts){
  const term=data.terms[word];if(!term)continue
  known++
  const weight=(1+Math.log(count))*term.idf
  for(let i=0;i<vector.length;i++)vector[i]+=weight*term.vector[i]
 }
 const norm=Math.hypot(...vector)
 if(!norm)return {method:data.method,corpus_sha256:data.corpus_sha256,known_terms:known,results:[]}
 const results=data.documents.map(doc=>({id:doc.id,similarity:doc.vector.reduce((sum,value,i)=>sum+value*vector[i]/norm,0)})).filter(row=>row.similarity>0).sort((a,b)=>b.similarity-a.similarity||a.id.localeCompare(b.id))
 return {method:data.method,corpus_sha256:data.corpus_sha256,known_terms:known,results}
}
