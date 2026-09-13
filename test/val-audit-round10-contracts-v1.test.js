import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {mkdtemp,rm} from 'node:fs/promises'
import {pathToFileURL} from 'node:url'
import {build} from 'esbuild'
import React from 'react'
import TestRenderer,{act} from 'react-test-renderer'
import {recognizeQuestionnaire} from '../src/lib/smart-import.js'
import matrix from '../src/data/profile-matrix.json' with {type:'json'}
import {buildGrainOpportunities} from '../server/grain-intelligence.js'
import {dateOnly} from '../server/grain-repository.js'
import {buildCommitmentLadders} from '../server/commitment-ladder.js'

const agora=new Date('2026-09-13T12:00:00Z')
const intencao=extra=>({id:'i1',clientId:'ivo',clientName:'Ivo Dallagnol',commodity:'soja',direction:'sell',season:'2026/27',
 volume:1000,volumeUnit:'t',targetPrice:130,priceUnit:'BRL/sc_60kg',deliveryLocation:'Palotina',status:'confirmed',
 confidence:80,source:'producer_confirmation',observedAt:'2026-09-10T12:00:00Z',...extra})
const cotacao=extra=>({id:'m1',commodity:'soja',marketKind:'spot',region:'Palotina',price:128,priceUnit:'BRL/sc_60kg',
 sourceName:'Boletim regional',sourceType:'manual_quote',confidence:80,observedAt:'2026-09-12T12:00:00Z',status:'active',...extra})

// GRAO-01: delivery_start é DATE no PostgreSQL e o driver devolve um objeto Date. Serializado virava
// "2026-08-01T00:00:00.000Z", e a conta de dias montava `${value}T23:59:59` em cima disso — data
// inválida, NaN, e o card escrevia "Janela de entrega começa em NaN dias".
test('Grãos — janela de entrega vencida avisa e nunca escreve NaN',()=>{
 for(const janela of ['2026-08-01','2026-08-01T00:00:00.000Z']){
  const [op]=buildGrainOpportunities({intentions:[intencao({deliveryStart:janela,deliveryEnd:'2026-08-31'})],marketSnapshots:[cotacao()]},{now:agora})
  assert.doesNotMatch(JSON.stringify(op),/NaN/,janela)
  assert.ok(op.reasons.some(motivo=>/já iniciou ou venceu/.test(motivo)),janela)
  assert.ok(op.warnings.some(aviso=>/janela de entrega está vencida/.test(aviso)),janela)
 }
})

test('Grãos — janela futura continua contando os dias corretamente',()=>{
 const [op]=buildGrainOpportunities({intentions:[intencao({deliveryStart:'2026-09-23'})],marketSnapshots:[cotacao()]},{now:agora})
 assert.ok(op.reasons.some(motivo=>/Janela de entrega começa em 11 dias/.test(motivo)),JSON.stringify(op.reasons))
 assert.equal(op.warnings.some(aviso=>/vencida/.test(aviso)),false)
})

test('Grãos — data impossível vira ausência declarada, não NaN',()=>{
 const [op]=buildGrainOpportunities({intentions:[intencao({deliveryStart:'sem data'})],marketSnapshots:[cotacao()]},{now:agora})
 assert.doesNotMatch(JSON.stringify(op),/NaN/)
 assert.ok(op.warnings.some(aviso=>/Sem janela de entrega/.test(aviso)))
})

// GRAO-02: matchingQuote só olhava commodity, praça e frescor. Um contrato futuro com entrega em
// maio/2028 servia de referência para uma entrega de agosto/2026 e a tela dizia que o preço-alvo
// tinha sido superado.
test('Grãos — cotação de outra janela de entrega não vence a da janela certa',()=>{
 const futuro=cotacao({id:'m2',marketKind:'futures',price:190,deliveryStart:'2028-05-01',deliveryEnd:'2028-05-31',sourceName:'Bolsa'})
 const [op]=buildGrainOpportunities({intentions:[intencao({deliveryStart:'2026-08-01',deliveryEnd:'2026-08-31'})],marketSnapshots:[futuro,cotacao()]},{now:agora})
 assert.equal(op.marketReference.sourceName,'Boletim regional')
 assert.equal(op.marketReference.price,128)
 assert.equal(op.reasons.some(motivo=>/atingiu ou superou o preço-alvo/.test(motivo)),false)
})

test('Grãos — cotação sem janela declarada continua servindo de referência',()=>{
 const [op]=buildGrainOpportunities({intentions:[intencao({deliveryStart:'2026-10-01',deliveryEnd:'2026-10-31'})],marketSnapshots:[cotacao()]},{now:agora})
 assert.equal(op.marketReference.id,'m1')
 assert.equal(op.warnings.some(aviso=>/outra janela de entrega/.test(aviso)),false)
})

test('Grãos — quando só existe cotação de outra janela, ela é usada e a tela diz isso',()=>{
 const futuro=cotacao({id:'m2',marketKind:'futures',price:190,deliveryStart:'2028-05-01',deliveryEnd:'2028-05-31'})
 const [op]=buildGrainOpportunities({intentions:[intencao({deliveryStart:'2026-10-01',deliveryEnd:'2026-10-31'})],marketSnapshots:[futuro]},{now:agora})
 assert.equal(op.marketReference.id,'m2')
 assert.ok(op.warnings.some(aviso=>/outra janela de entrega/.test(aviso)&&/contrato futures/.test(aviso)),JSON.stringify(op.warnings))
})

// GRAO-03: o card renderizava só o primeiro aviso — "cotação vencida" e "reconfirme com o produtor"
// sumiam sem que nada indicasse que existiam outros.
test('Grãos — o card do roteiro mostra todos os avisos e conta os motivos que não couberam',()=>{
 const fonte=readFileSync(new URL('../src/components/SogWorkspace.jsx',import.meta.url),'utf8')
 assert.match(fonte,/\(opportunity\.warnings\|\|\[\]\)\.map\(warning=><p key=\{warning\} className="sog-warning">/)
 assert.doesNotMatch(fonte,/opportunity\.warnings\?\.\[0\]/)
 assert.match(fonte,/opportunity\.reasons\.length>3&&<li className="sog-more">/)
})

// GRAO-01, no repositório: a coluna DATE precisa sair como dia civil dos dois caminhos.
test('Grãos — o repositório normaliza a data de entrega para o dia civil',()=>{
 const fonte=readFileSync(new URL('../server/grain-repository.js',import.meta.url),'utf8')
 const dia=dateOnly
 assert.equal(dia(new Date('2026-08-01T00:00:00.000Z')),'2026-08-01')
 assert.equal(dia('2026-08-01'),'2026-08-01')
 assert.equal(dia('2026-08-01T00:00:00.000Z'),'2026-08-01')
 assert.equal(dia(null),null)
 assert.equal(dia(''),null)
 assert.equal(dia('amanhã'),null)
 assert.match(fonte,/deliveryStart:dateOnly\(row\.delivery_start\?\?row\.deliveryStart\)/)
})

// QUEST-01: a similaridade é sobreposição de palavras — "Não busco resultados técnicos" ficava
// quase igual a "Resultados técnicos, números e retorno financeiro", e a importação gravava a
// alternativa OPOSTA como resposta do produtor.
test('Questionário — resposta que nega não vira a alternativa afirmativa',()=>{
 const reconhece=(id,texto)=>recognizeQuestionnaire({rows:[[String(id),texto,'']],format:'CSV'}).answers
 for(const texto of ['Não busco resultados técnicos, números e retorno financeiro.','Nunca confio na pessoa que está recomendando.','Sem interesse em potencial de produtividade e inovação.','Jamais priorizo rapidez e facilidade para receber as informações.'])
  assert.deepEqual(reconhece(7,texto),{},texto)
})

test('Questionário — resposta afirmativa e paráfrase continuam sendo reconhecidas',()=>{
 const reconhece=(id,texto)=>recognizeQuestionnaire({rows:[[String(id),texto,'']],format:'CSV'}).answers
 assert.deepEqual(reconhece(7,'Resultados técnicos, números e retorno financeiro.'),{7:'Resultados técnicos, números e retorno financeiro.'})
 assert.deepEqual(reconhece(7,'Busco resultados técnicos e retorno financeiro.'),{7:'Resultados técnicos, números e retorno financeiro.'})
 assert.deepEqual(reconhece(7,'Confiança na pessoa que está recomendando.'),{7:'Confiança na pessoa que está recomendando.'})
})

test('Questionário — alternativa que já nega casa com resposta que nega',()=>{
 const negativas=matrix.filter(item=>/(^|\s)(n[ãa]o|nunca|nenhum)(\s|$)/i.test(String(item.Alternativa).normalize('NFD').replace(/\p{Diacritic}/gu,'')))
 if(!negativas.length)return
 const alvo=negativas[0]
 const answers=recognizeQuestionnaire({rows:[[String(alvo.Pergunta),alvo.Alternativa,'']],format:'CSV'}).answers
 assert.equal(answers[alvo.Pergunta],alvo.Alternativa)
})

// QUEST-03: 45 perguntas respondidas na frente do produtor moravam só no useState — sair da página
// ou trocar de aba dentro do próprio Produtor 360 apagava tudo sem uma palavra.
test('Questionário — respostas digitadas travam a saída e a troca de aba',async()=>{
 const directory=await mkdtemp(new URL('../.survey-guard-test-',import.meta.url).pathname)
 const anterior=globalThis.window
 const eventos=new EventTarget()
 const perguntas=[];let renderer
 globalThis.window={addEventListener:eventos.addEventListener.bind(eventos),removeEventListener:eventos.removeEventListener.bind(eventos),
  confirm:texto=>{perguntas.push(texto);return false},scrollTo:()=>{}}
 try{
  await build({entryPoints:['src/components/SurveyForm.jsx'],outfile:directory+'/form.js',bundle:true,platform:'node',format:'esm',packages:'external',loader:{'.css':'empty','.json':'json'},logLevel:'silent'})
  const SurveyForm=(await import(pathToFileURL(directory+'/form.js'))).default
  const sujo=[]
  const sair=()=>eventos.dispatchEvent(new Event('val:before-navigation',{cancelable:true}))
  await act(async()=>{renderer=TestRenderer.create(React.createElement(SurveyForm,{onSubmit:async()=>{},onDirtyChange:value=>sujo.push(value)}))})
  // Nada digitado: a saída é livre.
  assert.equal(sair(),true)
  assert.equal(perguntas.length,0)
  assert.equal(sujo.at(-1),false)
  const primeiro=renderer.root.findAllByType('input')[0]
  await act(async()=>primeiro.props.onChange({target:{value:'Fazenda Santa Rita - Antônio Nogueira'}}))
  // Com resposta digitada: a saída pergunta, e recusar cancela a navegação.
  assert.equal(sujo.at(-1),true)
  assert.equal(sair(),false)
  assert.equal(perguntas.length,1)
  assert.match(perguntas[0],/alterações não salvas no questionário/)
 }finally{
  if(renderer)await act(async()=>renderer.unmount())
  globalThis.window=anterior
  await rm(directory,{recursive:true,force:true})
 }
})

test('Questionário — a troca de aba do Produtor 360 passa pela confirmação',()=>{
 const fonte=readFileSync(new URL('../src/pages/Questionnaire.jsx',import.meta.url),'utf8')
 assert.match(fonte,/const leaveAssisted=next=>\{/)
 assert.match(fonte,/mode==='assistida'&&assistedDirty&&!window\.confirm\('Há respostas do questionário que ainda não foram enviadas\. Sair sem enviar\?'\)/)
 assert.match(fonte,/onDirtyChange=\{setAssistedDirty\}/)
 // Nenhuma aba escapa da guarda.
 assert.doesNotMatch(fonte,/onClick=\{\(\)=>setMode\('(central|importar)'\)\}/)
})

// PLAN-01: a bandeira de "compromisso assumido" era uma só para o plano inteiro. Assumir a
// prioridade 1 rotulava e desabilitava as prioridades 2 e 3, que não tinham compromisso nenhum.
test('Preparação de visita — o compromisso assumido pertence à ação, não ao plano',()=>{
 const tela=readFileSync(new URL('../src/components/visit/PrepareVisitSimple.jsx',import.meta.url),'utf8')
 assert.doesNotMatch(tela,/prepared\.accepted_commitment[^s]/)
 assert.equal((tela.match(/prepared\.accepted_commitments\?\.\[action\.action_id\]/g)||[]).length,3)
 const pagina=readFileSync(new URL('../src/pages/Visits.jsx',import.meta.url),'utf8')
 assert.match(pagina,/accepted_commitments:\{\.\.\.\(current\[visit\.id\]\?\.accepted_commitments\|\|\{\}\),\[action\.action_id\]:payload\.commitment\}/)
 // Reabrir a preparação reidrata o mapa com o que o servidor já tem gravado.
 assert.match(pagina,/const withAcceptedCommitments=payload=>/)
 assert.match(pagina,/\[visit\.id\]:withAcceptedCommitments\(payload\)/)
})

// PLAN-02: a preparação reaberta não citava o compromisso já assumido, e o segundo clique gravava
// a mesma pendência de novo na ficha do produtor.
test('Preparação de visita — a preparação devolve os compromissos já assumidos',()=>{
 const servico=readFileSync(new URL('../server/execution/service.js',import.meta.url),'utf8')
 assert.match(servico,/const existingCommitments=await repository\.listCommitments\(\{tenantId,ownerId,clientId:visit\.clientId\}\)/)
 assert.match(servico,/return \{visit:preparedVisit\|\|visit,commitments:planCommitments,/)
 // Compromisso cancelado não volta como se estivesse vivo.
 assert.match(servico,/String\(item\.status\|\|''\)\.toUpperCase\(\)!=='CANCELLED'/)
 // O mesmo bloqueio existe nos dois caminhos do repositório.
 const repo=readFileSync(new URL('../server/repository.js',import.meta.url),'utf8')
 assert.match(repo,/AND commitment\.action_id=\$3 AND commitment\.status<>'CANCELLED'/)
 assert.match(repo,/const already=commitment\.action_id\?store\.val\.commitments\.find\(/)
})

// ESC-01: o aceite era inferido por regex sobre JSON.stringify do registro inteiro. A nota do
// consultor "Produtor recusou. Proposta não aceita." casava /proposta.*aceit/ e o degrau "Proposta
// condicionada aceita" aparecia como Confirmado — em cima de uma recusa.
test('Escada — recusa escrita pelo consultor não confirma degrau nenhum',()=>{
 const recusa=buildCommitmentLadders({opportunities:[{id:'o1',title:'Programa de soja',stage:'Proposta',estimated_value:180000,
  evidence:[{type:'opportunity_workspace_event',note:'Produtor recusou. Proposta não aceita: o custo por hectare está acima do que ele paga hoje.'}]}]})
 const escada=recusa.ladders[0]
 assert.equal(escada.steps.every(step=>step.status!=='confirmed'),true,JSON.stringify(escada.steps.map(s=>[s.id,s.status])))
 assert.equal(escada.currentConfirmedCount,0)
})

test('Escada — nem a frase afirmativa em texto livre confirma: só o marcador tipado',()=>{
 const texto=buildCommitmentLadders({opportunities:[{id:'o1',title:'Programa de soja',stage:'Proposta',
  evidence:[{type:'opportunity_workspace_event',note:'Proposta condicionada aceita pelo produtor.'}]}]})
 assert.equal(texto.ladders[0].currentConfirmedCount,0)
 const tipado=buildCommitmentLadders({opportunities:[{id:'o1',title:'Programa de soja',stage:'Proposta',
  evidence:[{id:'ev-1',type:'conditional_proposal_agreed'}]}]})
 assert.equal(tipado.ladders[0].steps.find(step=>step.id==='conditional_proposal_agreed').status,'confirmed')
})

// ESC-02: o quadro grava perda como etapa 'Fechado' + status 'lost'. A escada olhava só o texto da
// etapa e deixava um negócio perdido de R$ 180.000 como oportunidade viva, com compromisso a cobrar.
test('Escada — negócio perdido pelo resultado gravado sai da escada',()=>{
 const perdido={id:'o1',title:'Programa de fertilidade',stage:'Fechado',estimated_value:180000,
  evidence:[{type:'opportunity_workspace_v1',status:'lost',lossReason:'Produtor fechou com o concorrente por preço.'}]}
 const viva={id:'o2',title:'Renovação de fungicida',stage:'Proposta',estimated_value:90000,evidence:[]}
 const result=buildCommitmentLadders({opportunities:[perdido,viva]})
 assert.deepEqual(result.ladders.map(item=>item.opportunityId),['o2'])
 assert.equal(result.closedExcludedCount,1)
 // Ganho continua na escada, com a decisão formalizada.
 const ganho={id:'o3',title:'Programa ganho',stage:'Fechado',estimated_value:70000,evidence:[{type:'opportunity_workspace_v1',status:'won'}]}
 const comGanho=buildCommitmentLadders({opportunities:[ganho]})
 assert.equal(comGanho.ladders[0].steps.find(step=>step.id==='decision_formalized').status,'confirmed')
 assert.equal(comGanho.ladders[0].audit.lost,false)
})

// ESC-04: com 8 oportunidades a escada devolvia 6 e sumia com 2 sem avisar.
test('Escada — o corte em seis escadas não é silencioso',()=>{
 const muitas=Array.from({length:8},(_,index)=>({id:`o${index}`,title:`Oportunidade ${index}`,stage:'Proposta',estimated_value:1000*(index+1),evidence:[]}))
 const result=buildCommitmentLadders({opportunities:muitas})
 assert.equal(result.ladders.length,6)
 assert.equal(result.totalOpportunities,8)
 assert.equal(result.shownCount,6)
 assert.equal(result.hiddenCount,2)
})

// ESC-05: text(value,max) recebia um texto de reserva no lugar do comprimento — slice(0,NaN)
// devolvia '' e a frase chegava como 'A etapa "" sugere avanço'.
test('Escada — a frase de origem do degrau nomeia a etapa',()=>{
 const result=buildCommitmentLadders({opportunities:[{id:'o1',title:'Sem evidência',stage:'Negociação',evidence:[]}]})
 const indicado=result.ladders[0].steps.find(step=>step.status==='indicated')
 assert.match(indicado.stageBasis,/A etapa “Negociação” sugere avanço/)
 const semEtapa=buildCommitmentLadders({opportunities:[{id:'o2',title:'Sem etapa',stage:'',evidence:[{id:'e',type:'context_confirmed'},{id:'f',type:'proof_agreed'},{id:'g',type:'pilot_or_comparison_agreed'}]}]})
 const indicadoSemEtapa=semEtapa.ladders[0].steps.find(step=>step.status==='indicated')
 if(indicadoSemEtapa)assert.match(indicadoSemEtapa.stageBasis,/A etapa “não informada” sugere avanço/)
})

// CONV-02 / MDM-01 / OBJ-01: o Estúdio de Conversão buscava /api/clients/:id/context, que devolve o
// complemento técnico e nunca teve conversionInnovations. Os seis painéis recebiam undefined e a
// tela dizia "Registre uma oportunidade" para um produtor que já tinha oportunidade registrada.
test('Estúdio de Conversão — a tela busca a rota que realmente monta o dossiê',()=>{
 const tela=readFileSync(new URL('../src/components/ConversionOpportunityStudio.jsx',import.meta.url),'utf8')
 assert.equal((tela.match(/\/conversion-studio`/g)||[]).length,2)
 assert.doesNotMatch(tela,/\$\{encodeURIComponent\(client\.id\)\}\/context`/)
 const servidor=readFileSync(new URL('../server.js',import.meta.url),'utf8')
 assert.match(servidor,/const studioMatch=url\.pathname\.match\(\/\^\\\/api\\\/clients\\\/\(\[\^\/\]\+\)\\\/conversion-studio\$\/\)/)
 // A rota do Estúdio usa getClientContext (o único ponto onde conversionInnovations é montado)...
 assert.match(servidor,/objective:'conversion_studio'/)
 assert.match(servidor,/conversionInnovations:context\.conversionInnovations\|\|\{\},opportunities:context\.opportunities\|\|\[\]/)
 // ...e a rota do Cliente 360 continua barata, com getTechnicalContext.
 assert.match(servidor,/if\(contextMatch&&request\.method==='GET'\)return json\(response,200,\{context:await repository\.getTechnicalContext/)
 // E ela é autenticada como todas as outras rotas de produtor.
 assert.match(servidor,/context\|conversion-studio\|overview\|property\|workspace\|season-plans/)
})

// OBJ-03: os motivos de similaridade eram unidos entre registros. Um grupo que junta a perda deste
// produtor com a de outro publicava "mesma conta" — verdade para um registro, falsa para o grupo.
test('Objeções — "mesma conta" só sobrevive quando todo o grupo é da mesma conta',()=>{
 const fonte=readFileSync(new URL('../server/objection-library.js',import.meta.url),'utf8')
 const linha=fonte.match(/ const sharedReasons=sets=>\{[\s\S]*?\n \}/)[0]
 const sharedReasons=new Function('return '+linha.replace(' const sharedReasons=','')+';')()
 // Dois registros, só um deles da conta atual: "mesma conta" cai.
 assert.deepEqual(sharedReasons([['mesma categoria','mesma conta'],['mesma categoria']]),['mesma categoria'])
 // Os dois da mesma conta: o motivo sobrevive.
 assert.deepEqual(sharedReasons([['mesma categoria','mesma conta'],['mesma categoria','mesma conta']]),['mesma categoria','mesma conta'])
 assert.deepEqual(sharedReasons([]),[])
 assert.deepEqual(sharedReasons([['mesma conta']]),['mesma conta'])
 assert.match(fonte,/similarityReasons:sharedReasons\(group\.similarityReasonSets\)/)
})

// OBJ-04: o cabeçalho anunciava 11 perdas semelhantes e a lista mostrava 8; as demais sumiam.
test('Objeções — o corte da lista não é silencioso',()=>{
 const fonte=readFileSync(new URL('../server/objection-library.js',import.meta.url),'utf8')
 assert.match(fonte,/objectionGroupsTotal:groups\.size,objectionsHidden:Math\.max\(0,groups\.size-objections\.length\)/)
 const painel=readFileSync(new URL('../src/components/ObjectionEvidencePanel.jsx',import.meta.url),'utf8')
 assert.match(painel,/data\.objectionsHidden>0&&/)
 assert.match(painel,/Mostrando \$\{objections\.length\} de \$\{data\.objectionGroupsTotal\} objeções registradas/)
})

// CAL-01: Number('') e Number(null) valem 0, então "nada medido" chegava como "0% de avanço" —
// falta de dado carimbada como nota zero, ao lado de segmentos medidos de verdade.
test('Calibração — falta de medição não vira 0%, e o 0% medido continua aparecendo',()=>{
 const fonte=readFileSync(new URL('../src/components/MessageCalibrationPanel.jsx',import.meta.url),'utf8')
 const linha=fonte.split('\n').find(item=>item.startsWith('const percent='))
 const percent=new Function('return '+linha.replace('const percent=','')+';')()
 for(const vazio of [null,undefined,''])assert.equal(percent(vazio),'Em formação',JSON.stringify(vazio))
 assert.equal(percent('texto'),'Em formação')
 // 0 medido é informação correta: houve interações observadas e nenhuma avançou de etapa.
 assert.equal(percent(0),'0%')
 assert.equal(percent('0'),'0%')
 assert.equal(percent(0.42),'42%')
 assert.equal(percent(1),'100%')
})

// CONV-01: radarCandidateScore olha oportunidade, visita, potencial e recência — nunca compromisso.
// Uma conta que só tem compromisso vencido pontuava ~0, caía fora dos 24 contextos carregados, e o
// cartão ACT_NOW "Compromisso vencido" (prioridade 92, a mais alta do produto) nunca era gerado.
// Medido: com 24 produtores o cartão aparecia, com 25 sumia.
test('Radar — conta com compromisso vencido entra na pré-seleção mesmo em carteira grande',()=>{
 const fonte=readFileSync(new URL('../server/conversion-bootstrap.js',import.meta.url),'utf8')
 assert.match(fonte,/const overdueIds=list\(intelligence\?\.overdueCommitmentClientIds\)\.slice\(0,MAX_OVERDUE_PRESELECTED\)/)
 assert.match(fonte,/const selectedIds=new Set\(\[\.\.\.list\(cached\?\.radar\?\.items\|\|preliminary\.items\)\.map\(item=>item\.clientId\),\.\.\.overdueIds,/)
 // Teto próprio: cada id extra é um contexto completo por requisição.
 assert.match(fonte,/const MAX_OVERDUE_PRESELECTED=12/)
 // Ordenado pelo prazo mais estourado primeiro, e falha de leitura não derruba o radar.
 assert.match(fonte,/\.sort\(\(left,right\)=>new Date\(left\.due_at\|\|left\.dueAt\|\|0\)-new Date\(right\.due_at\|\|right\.dueAt\|\|0\)\)/)
 assert.match(fonte,/\}catch\{return \[\]\}/)
 // A consulta fica no caminho do radar, não dentro de getIntelligence.
 assert.match(fonte,/intelligence\.overdueCommitmentClientIds=await overdueCommitmentClients\(this,ownerId,now\)/)
 const repo=readFileSync(new URL('../server/repository.js',import.meta.url),'utf8')
 assert.doesNotMatch(repo,/overdueCommitmentClientIds/)
})

test('Radar — o cache de 10 minutos enxerga a mudança de compromissos',()=>{
 const fonte=readFileSync(new URL('../server/conversion-bootstrap.js',import.meta.url),'utf8')
 // Sem os compromissos no fingerprint, a seleção mudaria sem mudar a chave e o cache serviria o
 // radar antigo — a correção pareceria intermitente.
 const impressao=fonte.match(/function radarFingerprint\([\s\S]*?digest\('hex'\)\.slice\(0,20\)/)[0]
 assert.match(impressao,/commitments:list\(intelligence\?\.overdueCommitmentClientIds\)/)
})

test('Radar — o que não coube no enriquecimento é contado',()=>{
 const fonte=readFileSync(new URL('../server/conversion-bootstrap.js',import.meta.url),'utf8')
 assert.match(fonte,/finalRadar\.contextsSkipped=Math\.max\(0,allClients\.length-contexts\.length\)/)
})
