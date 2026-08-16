import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const workspace=readFileSync(new URL('../src/components/ValWorkspace.jsx',import.meta.url),'utf8')
const center=readFileSync(new URL('../src/components/ValDecisionWorkspace.jsx',import.meta.url),'utf8')
const styles=readFileSync(new URL('../src/val-decision-center.css',import.meta.url),'utf8')

test('VAL Insumos abre o novo centro de decisão e preserva o laboratório antigo',()=>{
 assert.match(workspace,/import ValDecisionWorkspace from '\.\/ValDecisionWorkspace'/)
 assert.match(workspace,/<ValDecisionWorkspace clients=\{clients\}/)
 assert.match(center,/import ValPanel from '\.\/ValPanel'/)
 assert.match(center,/MODO ESPECIALISTA PRESERVADO/)
 assert.match(center,/<ValPanel clients=\{clients\}/)
})

test('as sete barreiras aparecem como funcionalidades visíveis',()=>{
 for(const label of [
  'Contexto conectado',
  'Qualidade dos dados',
  'Conversion Score',
  'Próxima melhor ação',
  'Evidência explicável',
  'Aprendizado controlado',
  'Governança humana'
 ])assert.ok(center.includes(label),`Barreira ausente: ${label}`)
 assert.match(center,/AS SETE BARREIRAS DE DIFERENCIAÇÃO/)
 assert.match(center,/vdc-layer-grid/)
})

test('o layout usa os contratos reais da Conversion Core',()=>{
 for(const field of [
  'conversion_intelligence',
  'selected_opportunity',
  'data_quality',
  'learning',
  'executive_brief',
  'evidence_used',
  'human_review'
 ])assert.ok(center.includes(field),`Contrato não consumido: ${field}`)
 assert.match(center,/ordenação operacional, não probabilidade de compra/i)
 assert.match(center,/IA somente para linguagem/)
})

test('centro executa análise e feedback nos endpoints protegidos',()=>{
 assert.match(center,/fetch\('\/api\/val\/chat'/)
 assert.match(center,/clientId:client\.id,client,message:question,mode,requestedStage/)
 assert.match(center,/fetch\('\/api\/val\/feedback'/)
 assert.match(center,/recommendationId:response\.recommendationId/)
 assert.match(center,/valor360:unauthorized/)
})

test('experiência é responsiva e possui hierarquia visual própria',()=>{
 for(const selector of [
  '.vdc-hero',
  '.vdc-command-center',
  '.vdc-layer-grid',
  '.vdc-metric-grid',
  '.vdc-decision-grid',
  '.vdc-evidence-grid',
  '.vdc-learning-strip',
  '.vdc-expert-access'
 ])assert.ok(styles.includes(selector),`Seletor ausente: ${selector}`)
 assert.match(styles,/@media \(max-width:680px\)/)
 assert.match(styles,/grid-template-columns:repeat\(7,minmax/)
 assert.match(styles,/--vdc-score-angle/)
})

test('o layout oferece ações comerciais orientadas à conversão',()=>{
 for(const action of ['Priorizar a conta','Preparar visita','Sair do preço','Fechar próximo passo'])assert.ok(center.includes(action),`Ação rápida ausente: ${action}`)
 for(const stage of ['Descobrir','Dimensionar','Construir valor','Propor','Comprometer'])assert.ok(center.includes(stage),`Etapa ausente: ${stage}`)
})
