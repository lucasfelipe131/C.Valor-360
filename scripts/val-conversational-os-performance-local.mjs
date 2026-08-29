import {performance} from 'node:perf_hooks'
import {resolveAuthorizedClientReference} from '../server/decision-copilot/producer-entity-resolver.js'
import {routeGlobalIntent} from '../server/decision-copilot/global-intent-router.js'
import {resolveValNaturalCommand} from '../src/lib/val-natural-commands.js'

const portfolio=Array.from({length:500},(_,index)=>({id:`client-${index}`,name:index===274?'Antônio Carlos Costa Beber':`Produtor ${String(index).padStart(3,'0')}`,municipality:'Staging'}))
const iterations=2_000
const percentile=(values,ratio)=>{const ordered=[...values].sort((a,b)=>a-b);return Number(ordered[Math.max(0,Math.ceil(ordered.length*ratio)-1)].toFixed(3))}
const run=(name,operation)=>{
 const samples=[]
 for(let index=0;index<iterations;index+=1){const started=performance.now();operation();samples.push(performance.now()-started)}
 return {name,samples:iterations,p50_ms:percentile(samples,.5),p90_ms:percentile(samples,.9),p95_ms:percentile(samples,.95)}
}

const exact=()=>resolveAuthorizedClientReference({reference:'Antônio Carlos Costa Beber',authorizedClients:portfolio})
const fuzzy=()=>resolveAuthorizedClientReference({reference:'Antonio Carlos Costa Bebo',authorizedClients:portfolio})
const client=exact().client
const result={contract_version:'val.conversational_os_component_benchmark.v1',clock:'node.performance.monotonic',scope:'LOCAL_COMPONENT_ONLY',iterations,results:[
 run('OPEN_CLIENT_EXACT',()=>routeGlobalIntent({message:'Abra o produtor Antônio Carlos Costa Beber.',client:exact().client})),
 run('SEARCH_CLIENT_FUZZY',fuzzy),
 run('NAVIGATE_AGRONOMY',()=>routeGlobalIntent({message:'Abra Inteligência Agronômica.',client})),
 run('PREPARE_VISIT',()=>routeGlobalIntent({message:'Prepare a visita do Antônio.',client})),
 run('FOLLOW_UP_RESUME',()=>resolveValNaturalCommand('Resume isso em uma linha, mantendo o mesmo produtor.')),
]}
console.log(JSON.stringify(result,null,2))
