import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'
import {buildCommitmentLadders} from '../server/commitment-ladder.js'

const context={
 opportunities:[
  {id:'o1',title:'Programa de milho',stage:'Proposta',estimated_value:120000,evidence:[{id:'ev-context',type:'context_confirmed'},{id:'ev-proof',type:'proof_agreed'}],updated_at:'2026-08-16T12:00:00Z'},
  {id:'o2',title:'Negócio perdido',stage:'Perdido',estimated_value:900000,evidence:[]}
 ]
}

test('escada sugere o próximo sim mínimo sem transformar etapa em aceite',()=>{
 const result=buildCommitmentLadders(context,{now:Date.parse('2026-08-17T12:00:00Z')})
 assert.equal(result.ladders.length,1)
 const ladder=result.ladders[0]
 assert.equal(ladder.steps.find(step=>step.id==='context_confirmed').status,'confirmed')
 assert.equal(ladder.steps.find(step=>step.id==='proof_agreed').status,'confirmed')
 assert.equal(ladder.nextMinimumCommitment.stepId,'pilot_or_comparison_agreed')
 assert.equal(ladder.nextMinimumCommitment.consentRequired,true)
 assert.equal(ladder.audit.stageDoesNotEqualConsent,true)
})

test('etapa administrativa aparece somente como indicação pendente',()=>{
 const result=buildCommitmentLadders({opportunities:[{id:'o3',title:'Sem evidência',stage:'Negociação',evidence:[]}]})
 const ladder=result.ladders[0]
 assert.ok(ladder.steps.some(step=>step.status==='indicated'&&step.requiresConfirmation))
 assert.ok(ladder.steps.every(step=>step.status!=='confirmed'))
 assert.match(ladder.steps.find(step=>step.status==='indicated').stageBasis,/não comprova aceite/)
})

test('guardrails proíbem pressão artificial e preservam revisão técnica',()=>{
 const result=buildCommitmentLadders(context)
 assert.ok(result.guardrails.some(item=>/consentimento explícito/i.test(item)))
 assert.ok(result.guardrails.some(item=>/revisão habilitada/i.test(item)))
 assert.ok(result.guardrails.some(item=>/medo, culpa, vergonha/i.test(item)))
})

test('produção carrega o bootstrap de inovação depois do Conversion Core',()=>{
 const packageJson=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'))
 const bootstrap=readFileSync(new URL('../server/innovation-bootstrap.js',import.meta.url),'utf8')
 assert.match(packageJson.scripts.start,/conversion-bootstrap\.js --import \.\/server\/innovation-bootstrap\.js server\.js/)
 assert.match(bootstrap,/commitmentLadders:buildCommitmentLadders/)
})

test('Dashboard mostra o estúdio e a escada de compromissos',()=>{
 const dashboard=readFileSync(new URL('../src/pages/Dashboard.jsx',import.meta.url),'utf8')
 const studio=readFileSync(new URL('../src/components/ConversionOpportunityStudio.jsx',import.meta.url),'utf8')
 const ladder=readFileSync(new URL('../src/components/CommitmentLadderPanel.jsx',import.meta.url),'utf8')
 assert.match(dashboard,/ConversionOpportunityStudio/)
 assert.match(studio,/ESTÚDIO DE CONVERSÃO/)
 assert.match(ladder,/PRÓXIMO COMPROMISSO/)
 assert.match(ladder,/Consentimento explícito obrigatório/)
})
