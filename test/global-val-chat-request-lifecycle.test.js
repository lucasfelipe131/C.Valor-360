import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import test from 'node:test'

const component=readFileSync(new URL('../src/components/GlobalValCopilot.jsx',import.meta.url),'utf8')
const section=(start,end)=>{
 const from=component.indexOf(start)
 const to=component.indexOf(end,from+start.length)
 assert.notEqual(from,-1,`trecho inicial ausente: ${start}`)
 assert.notEqual(to,-1,`trecho final ausente: ${end}`)
 return component.slice(from,to)
}

test('request conversacional tem ownership monotônico separado de upload e timeout de 30 s',()=>{
 const lifecycle=section('const cancelUploadRun=','useEffect(()=>{if(contextClient')
 const ask=section('const ask=async','const selectClarification=')

 assert.match(component,/const uploadRunRef=useRef\(\{generation:0,controller:null,targetClientId:''\}\)/)
 assert.match(component,/const chatRunRef=useRef\(\{generation:0,controller:null,threadKey:''\}\)/)
 assert.match(lifecycle,/const cancelChatRun=.*chatRunRef\.current\.controller\?\.abort\(\).*generation:chatRunRef\.current\.generation\+1/)
 assert.match(lifecycle,/const beginChatRun=activeThreadKey=>[\s\S]*previous\.controller\?\.abort\(\)[\s\S]*generation=previous\.generation\+1[\s\S]*chatRunRef\.current=\{generation,controller,threadKey:activeThreadKey\}/)
 assert.match(ask,/const \{generation,controller\}=beginChatRun\(activeThreadKey\)/)
 assert.match(ask,/const isCurrent=\(\)=>chatRunRef\.current\.generation===generation&&chatRunRef\.current\.controller===controller&&chatRunRef\.current\.threadKey===activeThreadKey/)
 assert.match(ask,/window\.setTimeout\(\(\)=>\{timedOut=true;controller\.abort\(\)\},30_000\)/)
 assert.match(ask,/fetch\('\/api\/val\/chat',[\s\S]*signal:controller\.signal/)
 assert.doesNotMatch(ask,/120_000/)
 assert.match(component,/useEffect\(\(\)=>\(\)=>\{uploadRunRef\.current\.controller\?\.abort\(\);const current=chatRunRef\.current;current\.controller\?\.abort\(\);chatRunRef\.current=\{generation:current\.generation\+1,controller:null,threadKey:''\}\},\[\]\)/)
})

test('callbacks stale não podem alterar autenticação, conversa, erro, progresso ou busy da geração nova',()=>{
 const ask=section('const ask=async','const selectClarification=')
 const parsed=ask.indexOf('const rawPayload=await response.json().catch(()=>null)')
 const firstGuard=ask.indexOf("if(!isCurrent())return {responseText:'',suppressSpeech:true,cancelled:true}",parsed)
 const unauthorized=ask.indexOf("window.dispatchEvent(new Event('valor360:unauthorized'))",parsed)
 const normalized=ask.indexOf('const payload=normalizeValChatPayload(rawPayload)',parsed)
 const secondGuard=ask.indexOf("if(!isCurrent())return {responseText:'',suppressSpeech:true,cancelled:true}",firstGuard+1)
 const selected=ask.indexOf('setSelectedId(resolvedClient.id)',normalized)
 const workspaceAction=ask.indexOf('onWorkspaceAction?.(payload.workspaceAction)',normalized)
 const assistantAppend=ask.indexOf('setThreads(current=>',normalized)

 for(const [label,index] of Object.entries({parsed,firstGuard,unauthorized,normalized,secondGuard,selected,workspaceAction,assistantAppend}))assert.notEqual(index,-1,`${label} ausente`)
 assert.ok(parsed<firstGuard&&firstGuard<unauthorized,'401 e demais efeitos só podem ocorrer para a geração atual')
 assert.ok(normalized<secondGuard&&secondGuard<selected&&secondGuard<workspaceAction&&secondGuard<assistantAppend,'a resposta normalizada precisa ser revalidada antes de escrever')

 const catchBlock=ask.slice(ask.indexOf('}catch(requestError){'),ask.indexOf('}finally{'))
 assert.match(catchBlock,/^\}catch\(requestError\)\{\s*if\(!isCurrent\(\)\|\|\(requestError\?\.name==='AbortError'&&!timedOut\)\)return \{responseText:'',suppressSpeech:true,cancelled:true\}/)
 assert.match(catchBlock,/if\(timedOut&&requestError\?\.name!=='TimeoutError'\)\{const timeoutError=new Error\('A análise ultrapassou 30 segundos\. Tente novamente\.'\);timeoutError\.name='TimeoutError';requestError=timeoutError\}/)
 assert.ok(catchBlock.indexOf('if(!isCurrent()')<catchBlock.indexOf('setClarification(clarificationTurn)'))
 assert.ok(catchBlock.indexOf('if(!isCurrent()')<catchBlock.indexOf('setError(requestError.name'))
 assert.match(ask,/\}finally\{stopProgress\(\);window\.clearTimeout\(timeoutId\);controller\.abort\(\);if\(isCurrent\(\)\)\{chatRunRef\.current=\{generation,controller:null,threadKey:activeThreadKey\};setProgress\(null\);setBusy\(false\)\}\}/)
 assert.match(ask,/onProgress:value=>\{if\(isCurrent\(\)\)setProgress\(value\)\}/)
})

test('nova pergunta isola o turno pendente e troca de escopo cancela a anterior sem stale writes',()=>{
 const ask=section('const ask=async','const selectClarification=')
 const switches=section('const chooseClient=','const uploadFiles=')

 assert.match(ask,/if\(!prompt&&!turnAttachments\.length\)return/)
 assert.doesNotMatch(ask,/\|\|busy\)return/)
 assert.match(ask,/const supersedesActiveChat=Boolean\(chatRunRef\.current\.controller\)/)
 assert.match(ask,/const turnAttachments=supersedesActiveChat\?\[\]:attachments\.slice\(0,3\)/)
 assert.match(ask,/const activeReply=supersedesActiveChat\?null:replyingTo/)
 assert.match(ask,/const continuation=!supersedesActiveChat/)
 assert.match(ask,/const latestUser=supersedesActiveChat\?null:/)
 assert.match(ask,/const sessionObjective=supersedesActiveChat\?prompt:/)
 assert.match(ask,/if\(supersedesActiveChat&&naturalCommandNeedsSettledResponse\(requestedNaturalCommand\)\)[\s\S]*Este comando não foi executado[\s\S]*blocked:true/)
 assert.match(ask,/if\(naturalCommand\?\.local\)\{\s*if\(!supersedesActiveChat\)\{cancelChatRun\(\);cancelRealtimeClarification\(\)\}/)
 assert.match(ask,/if\(!turnOptions\.retry\)cancelRealtimeClarification\(\)/)
 assert.match(switches,/const chooseClient=id=>\{if\(uploading\)return;cancelChatRun\(\);cancelRealtimeClarification\(\);/)
 assert.match(switches,/const newConversation=.*if\(uploading\)return\s*cancelChatRun\(\);cancelRealtimeClarification\(\)/s)
 assert.match(switches,/const selectHistory=item=>\{if\(uploading\)return;cancelChatRun\(\);cancelRealtimeClarification\(\);/)
 assert.match(component,/<select ref=\{clientSelectRef\}[\s\S]*?disabled=\{uploading\}>/)
 assert.match(component,/<textarea ref=\{messageInput\}[\s\S]*?disabled=\{uploading\}/)
 assert.match(component,/className="is-send"[\s\S]*?disabled=\{uploading\|\|\(!message\.trim\(\)&&!attachments\.length\)\}/)
 assert.match(component,/<ValRealtimeConversation\s+disabled=\{busy\|\|uploading\}/)
 assert.equal((component.match(/disabled=\{busy\|\|uploading\} aria-label="(?:Tirar ou escolher foto|Anexar arquivo)"/g)||[]).length,2)
})

test('override factual de um turno não troca o produtor selecionado na interface',()=>{
 const ask=section('const ask=async','const selectClarification=')
 assert.match(ask,/const changesConversationScope=Boolean\(resolvedClient\?\.id&&payload\.conversationResolution\?\.request_override!==true\)/)
 assert.match(ask,/if\(changesConversationScope\)\{setSelectedId\(resolvedClient\.id\)/)
 assert.doesNotMatch(ask,/if\(resolvedClient\?\.id\)\{setSelectedId\(resolvedClient\.id\)/)
})
