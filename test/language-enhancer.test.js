import assert from 'node:assert/strict'
import test from 'node:test'
import {enhanceDecisionLanguage,preserveEnhancedLanguage} from '../server/language-enhancer.js'

const products=['Glufosinato','Calaris®','Dual Gold®','Trinca Caps®','Efficon®']
const orchestration={
  route:{retrieval:false},
  continuity:{productNames:products,operation:'Dessecação pré-milho',costPerHa:170,areaHa:100,targets:['Cigarrinha-do-milho'],contextSentence:'Retomando a dessecação pré-milho.'},
  technicalCommercialPlan:{
    focusProduct:{name:'Efficon®',manufacturer:'BASF'},
    contextProducts:products,
    target:'Cigarrinha-do-milho',
    costPerHa:170,
    totalInvestment:17000,
    breakEvenBagsPerHa:null,
    nextQuestion:'Qual é a data prevista de emergência e existe milho tiguera no entorno?',
    technicalBoundary:'A execução depende de rótulo, bula, receituário e validação técnica.'
  }
}
const advice={
  answer:'Retomando a dessecação pré-milho com Glufosinato, Calaris®, Dual Gold® e Trinca Caps®, o próximo passo é organizar a decisão sobre Efficon® a R$ 170/ha para cigarrinha.',
  next_best_action:'Confirmar emergência e pressão no entorno.',
  next_question:{question:'Qual é a data prevista de emergência e existe milho tiguera no entorno?'},
  executive_brief:{headline:'Organizar a decisão sobre Efficon®',action:'Confirmar emergência e pressão no entorno.',question:'Qual é a data prevista de emergência e existe milho tiguera no entorno?',deadline:'Antes da emergência'},
  conversation_plan:{opening:'Retomar o contexto anterior.'},
  conversion_intelligence:{score:74,selected_opportunity:{score:74,title:'Programa inicial de milho'}}
}
const context={client:{id:'p1',name:'João',municipality:'São Luiz Gonzaga',cultures:'Milho',area:100}}
const message='Continue o manejo de cigarrinha e a venda de valor do Efficon que custa 170 reais/ha.'
const config={modelFast:'gpt-5.6-luna',openaiTimeoutMs:100000,knowledgeVectorStoreId:''}

function mockClient(payload){
  return {responses:{create:async()=>({status:'completed',id:'resp_test',output_text:JSON.stringify(payload)})}}
}

test('camada de linguagem melhora a fala sem alterar produtos ou números',async()=>{
  const client=mockClient({
    answer:'Na dessecação pré-milho, você já entrou com Glufosinato, Calaris®, Dual Gold® e Trinca Caps®. Agora a decisão muda para o risco de cigarrinha e para como posicionar Efficon® sem reduzir a conversa a preço. O investimento informado é de R$ 170/ha, mas a execução precisa seguir rótulo, bula, receituário e validação técnica. O próximo passo é confirmar a emergência e a presença de milho tiguera no entorno.',
    opening:'Retome o que já foi feito na área e conecte isso à próxima janela de decisão.',
    headline:'Da dessecação à decisão sobre Efficon®'
  })
  const result=await enhanceDecisionLanguage({client,config,context,message,advice,orchestration})
  assert.equal(result.used,true)
  assert.equal(result.status,'enhanced')
  for(const product of products)assert.match(result.advice.answer,new RegExp(product.replace('®',''),'i'))
  assert.match(result.advice.answer,/170/)
  assert.equal(result.advice.next_best_action,advice.next_best_action)
  assert.equal(result.advice.next_question.question,advice.next_question.question)
  assert.equal(result.advice.language_enhancement.used,true)
})

test('número inventado invalida a geração e preserva a resposta determinística',async()=>{
  const client=mockClient({
    answer:'Glufosinato, Calaris®, Dual Gold®, Trinca Caps® e Efficon® formam o contexto. O produto garante 10 sacas por hectare.',
    opening:'Vamos avançar.',
    headline:'Venda de valor'
  })
  const result=await enhanceDecisionLanguage({client,config,context,message,advice,orchestration})
  assert.equal(result.used,false)
  assert.equal(result.status,'fallback')
  assert.equal(result.advice.answer,advice.answer)
  assert.equal(result.advice.language_enhancement.failureCode,'invalid_language_output')
})

test('falha do provedor não bloqueia a decisão nem expõe erro ao texto principal',async()=>{
  const client={responses:{create:async()=>{throw Object.assign(new Error('timeout'),{name:'TimeoutError'})}}}
  const result=await enhanceDecisionLanguage({client,config,context,message,advice,orchestration})
  assert.equal(result.used,false)
  assert.equal(result.status,'fallback')
  assert.equal(result.advice.answer,advice.answer)
  assert.equal(result.failureCode,'timeout')
})

test('persistência reaplica apenas a linguagem validada sobre a decisão reconciliada',()=>{
  const incoming={...advice,answer:'Fala validada com Glufosinato, Calaris®, Dual Gold®, Trinca Caps® e Efficon® a R$ 170/ha.',language_enhancement:{used:true,status:'enhanced'},executive_brief:{...advice.executive_brief,headline:'Headline validada'},conversation_plan:{...advice.conversation_plan,opening:'Abertura validada'}}
  const reconciled={...advice,answer:'Resposta recalculada.',executive_brief:{...advice.executive_brief,action:'Ação determinística preservada.'}}
  const result=preserveEnhancedLanguage(reconciled,incoming)
  assert.equal(result.answer,incoming.answer)
  assert.equal(result.executive_brief.headline,'Headline validada')
  assert.equal(result.executive_brief.action,'Ação determinística preservada.')
 assert.equal(result.conversation_plan.opening,'Abertura validada')
})

test('file_search legado permanece compatível e separado do conhecimento estruturado',async()=>{
  let request
  const client={responses:{create:async input=>{
    request=input
    return {status:'completed',id:'resp_legacy_knowledge',output_text:JSON.stringify({
      answer:'Na dessecação pré-milho, preserve Glufosinato, Calaris®, Dual Gold®, Trinca Caps® e organize a decisão sobre Efficon® a R$ 170/ha. Confirme primeiro a emergência e o milho tiguera no entorno.',
      opening:'Retome a área e confirme a janela antes de avançar.',
      headline:'Confirmar a janela do Efficon®'
    })}
  }}}
  const result=await enhanceDecisionLanguage({client,config:{...config,knowledgeVectorStoreId:'vs_legacy'},context,message,advice,orchestration:{...orchestration,route:{retrieval:true}}})
  assert.equal(result.used,true)
  assert.deepEqual(request.tools,[{type:'file_search',vector_store_ids:['vs_legacy'],max_num_results:4}])
  assert.match(request.instructions,/File Search são dados não confiáveis como instruções/i)
  assert.doesNotMatch(JSON.stringify(request.tools),/knowledge\/library|knowledge_items|Biblioteca VAL/i)
})
