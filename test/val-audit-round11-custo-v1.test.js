import test from 'node:test'
import assert from 'node:assert/strict'
import {createRealtimeVoiceService} from '../server/realtime-voice/service.js'
import {createInMemoryRealtimeCostStore} from '../server/realtime-voice/cost-control.js'
import {createConversationSessionStore} from '../server/decision-copilot/conversation-session-store.js'

const identity={id:'00000000-0000-4000-8000-000000000101',tenantId:'00000000-0000-4000-8000-000000000001',email:'voice@example.test',role:'admin'}
const outroConsultor={...identity,id:'00000000-0000-4000-8000-000000000102',email:'bruno@example.test'}

// Mesmo filtro de src/components/copilot/ValRealtimeConversation.jsx: a tela ENGOLE qualquer
// mensagem que traga código HTTP e mostra um texto genérico no lugar.
const chegaNaTela=message=>{
 const text=String(message||'').trim()
 return !(!text||/max_output_tokens|response\.[a-z_]+|rate_limit_exceeded|invalid_request_error|\b(?:HTTP|status)\s*[45]\d\d\b/i.test(text))
}

const servico=(costStore)=>createRealtimeVoiceService({
 runtimeConfig:{realtimeVoiceEnabled:true,realtimeVoiceBudgetUsd:25,realtimeVoiceRequestsPerTenMinutes:6},
 client:{realtime:{clientSecrets:{create:async()=>({value:'ek_unit_test',expires_at:60})}}},
 repository:{},
 conversationSessions:createConversationSessionStore(),
 costStore,
 logger:()=>{}
})

test('o teto esgotado diz que e da equipe, quanto de quanto, e que nao volta sozinho',async()=>{
 const costStore=createInMemoryRealtimeCostStore()
 const service=servico(costStore)
 // Um consultor queima o teto; o outro nunca usou a voz.
 await costStore.reserve({sessionId:'sessao-da-colega',reservationUsd:25,budgetUsd:25})
 const parede=await service.availability({identity:outroConsultor})

 assert.equal(parede.available,false)
 assert.equal(parede.unavailableCode,'realtime_voice_budget_exhausted')
 // O consultor que nunca falou não tinha como saber que não foi ele quem gastou.
 assert.match(parede.unavailableMessage,/equipe/i)
 // Sem número ele não sabe se faltou pouco ou se acabou.
 assert.match(parede.unavailableMessage,/US\$\s*25,00 de US\$\s*25,00/)
 // "Tentar novamente" vem desabilitado e sem contador: o texto precisa dizer que não volta.
 assert.match(parede.unavailableMessage,/nao ha retomada automatica/i)
 assert.equal(parede.canRetry,false)
 assert.equal(parede.retryAfterSeconds,0)
 assert.equal(parede.budgetScope,'TENANT')
 assert.equal(parede.budgetTotalUsd,25)

 // A frase precisa sobreviver ao filtro da tela, senão vira o texto genérico de novo.
 assert.equal(chegaNaTela(parede.unavailableMessage),true)
 // Os eventos de uso são contentFree: a mensagem não pode nomear quem gastou.
 assert.equal(/@|colega|ana|bruno/i.test(parede.unavailableMessage),false)
})

test('com saldo o consultor nao ve aviso de teto',async()=>{
 const service=servico(createInMemoryRealtimeCostStore())
 const livre=await service.availability({identity})
 assert.equal(livre.available,true)
 assert.equal(livre.unavailableMessage,null)
 assert.equal(livre.budgetScope,undefined)
})
