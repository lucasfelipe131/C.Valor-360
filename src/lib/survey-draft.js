// As 45 respostas da aplicação assistida moravam só no useState. Sair da página e trocar de aba já
// perguntavam antes de descartar (QUEST-03), mas a MORTE da sessão — 12h vencidas, logout em outra
// aba, bloqueio pelo admin — desmontava a árvore inteira sem uma palavra: a consultora, com o
// produtor na frente, voltava ao login e encontrava o formulário zerado.
//
// Aqui não cabe perguntar "deseja sair?": a sessão acabou de verdade, e segurar o formulário
// montado manteria dados do produtor numa tela cuja credencial o servidor já revogou. O que
// resolve é preservar o rascunho e devolvê-lo no reingresso.
//
// sessionStorage, nunca localStorage: o rascunho morre com a aba, como o resto do cache técnico.
// A chave carrega o escopo do usuário porque a aba pode receber outro login no mesmo aparelho — as
// respostas de um produtor nunca podem reaparecer para outra pessoa.
const PREFIX='valor360-survey-draft:'
const store=()=>{try{return typeof sessionStorage==='undefined'?null:sessionStorage}catch{return null}}
const text=value=>String(value??'').trim()

export const surveyDraftKey=scope=>text(scope)?`${PREFIX}${text(scope)}`:''

export function readSurveyDraft(scope){
 const memory=store();const key=surveyDraftKey(scope)
 if(!memory||!key)return null
 try{
  const parsed=JSON.parse(memory.getItem(key)||'null')
  return parsed&&typeof parsed==='object'&&parsed.answers&&typeof parsed.answers==='object'?parsed:null
 }catch{return null}
}

export function writeSurveyDraft(scope,{answers,seed=''}={}){
 const memory=store();const key=surveyDraftKey(scope)
 if(!memory||!key)return false
 // Rascunho vazio não é rascunho: gravá-lo faria a tela oferecer retomar um formulário em branco.
 if(!answers||!Object.keys(answers).length)return clearSurveyDraft(scope)
 try{memory.setItem(key,JSON.stringify({answers,seed:text(seed),savedAt:new Date().toISOString()}));return true}
 catch{return false}
}

export function clearSurveyDraft(scope){
 const memory=store();const key=surveyDraftKey(scope)
 if(!memory||!key)return false
 try{memory.removeItem(key);return true}catch{return false}
}

export const hasSurveyDraft=scope=>Boolean(readSurveyDraft(scope))

// Outro login na mesma aba não pode nem ver nem herdar o rascunho de quem estava antes.
export function purgeForeignSurveyDrafts(scope){
 const memory=store()
 if(!memory)return 0
 try{
  const keep=surveyDraftKey(scope)
  const stale=Object.keys(memory).filter(key=>key.startsWith(PREFIX)&&key!==keep)
  stale.forEach(key=>memory.removeItem(key))
  return stale.length
 }catch{return 0}
}
