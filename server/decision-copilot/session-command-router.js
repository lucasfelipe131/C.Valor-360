export const sessionCommandRouterVersion='val.session_command_router.v1'

export const sessionCommands=Object.freeze([
 'SUMMARIZE','REPEAT','EXPLAIN','GOLDEN_QUESTIONS','OUTPUT_TEXT','OUTPUT_AUDIO',
 'SHOW_NUMBERS','REGISTER_LAST','DO_NOT_REGISTER','DEEPEN','BRIEF'
])

const normalize=value=>String(value??'')
 .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
 .toLocaleLowerCase('pt-BR').replace(/\s+/g,' ').trim().slice(0,500)

const rules=Object.freeze([
 ['OUTPUT_TEXT',/^(?:agora\s+)?(?:por escrito|so texto|apenas texto)[.!?]*$/],
 ['OUTPUT_AUDIO',/^(?:agora\s+)?(?:fala comigo|fala (?:elas|isso) (?:para|pra) mim|por audio|em audio|so audio)[.!?]*$/],
 ['GOLDEN_QUESTIONS',/^(?:(?:mostra|manda|traga)(?:\s+para|\s+pra)?(?:\s+mim)?|(?:(?:so|apenas)\s+)?me\s+(?:mostra|manda)|quero|so|apenas)?\s*(?:as\s+)?perguntas de ouro[.!?]*$/],
 ['SHOW_NUMBERS',/^(?:me\s+)?mostra(?:r)?\s+(?:os\s+)?numeros[.!?]*$/],
 ['DO_NOT_REGISTER',/^(?:nao|não)\s+(?:registra|registre|salva|grave|anote)[.!?]*$/],
 ['REGISTER_LAST',/^(?:registra|registre|salva|grave|anote)(?:\s+isso)?[.!?]*$/],
 ['SUMMARIZE',/^(?:resume|resuma|faz um resumo|resumo)[.!?]*$/],
 ['REPEAT',/^(?:repete|repita|diga de novo)[.!?]*$/],
 ['EXPLAIN',/^(?:explica|explique)(?:\s+melhor|\s+isso)?[.!?]*$/],
 ['DEEPEN',/^(?:aprofunda|aprofunde|va mais fundo)[.!?]*$/],
 ['BRIEF',/^(?:so|apenas)\s+(?:o\s+)?essencial[.!?]*$/]
])

const localCommands=new Set(['OUTPUT_TEXT','OUTPUT_AUDIO','DO_NOT_REGISTER'])

export function normalizeSessionCommand(value){
 const normalized=String(value??'').trim().toUpperCase()
 const canonical=normalized==='EXPLAIN_WHY'?'EXPLAIN':normalized
 return sessionCommands.includes(canonical)?canonical:null
}

export function routeSessionCommand(message='',commandHint=''){
 const source=normalize(message)
 const hinted=normalizeSessionCommand(commandHint)
 if(!source&&!hinted)return null
 const match=hinted?[hinted,null]:rules.find(([,pattern])=>pattern.test(source))
 if(!match)return null
 const command=match[0]
 return Object.freeze({
  version:sessionCommandRouterVersion,
  command,
  scope:'SESSION_CONTEXT',
  persistence_mode:command==='REGISTER_LAST'?'CONFIRM_REQUIRED':'NONE',
  local_only:localCommands.has(command),
  requires_previous_turn:!localCommands.has(command)&&command!=='DO_NOT_REGISTER'
 })
}
