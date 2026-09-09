// O consultor abre a frase com vocativo, saudação e cortesia — e na voz isso é a regra, porque a
// transcrição começa pela palavra de acordar ("Val, qual a próxima visita?"). Cada porta que casa
// padrão contra a frase precisa remover esse preâmbulo antes, e cada porta nova que esquecia
// reintroduzia o mesmo defeito: a rodada 3 corrigiu no roteador de intenção, a 5 no seletor de
// contexto, e a 6 encontrou o mesmo buraco no classificador de fato estruturado e na Biblioteca.
// Uma lista enumerada de palavras nunca fecha; o que fecha é remover o preâmbulo num lugar só.
const GREETING='(?:oi+|ola|opa|e ai|eae|hey|ei|hi|hello|bom dia|boa tarde|boa noite|tudo bem|tudo bom|beleza|blz|salve)'
// Marcador de fala: a transcricao de voz comeca com ele o tempo todo ("entao, o que ele comprou",
// "e... deixa eu ver"). Nao carrega assunto e derrubava a allowlist ancorada em ^.
const FILLER='(?:entao|ent[aã]o|ai|ah+|ahn+|hum+|tipo assim|tipo|olha|deixa eu ver|deixe eu ver|vamos la|pois entao|pois e|entendi|e(?=\\.{2,}))'
// As formas mais longas vêm primeiro: a alternação casa a primeira que serve, e "desculpa"
// sozinha deixaria "incomodar" para trás.
const COURTESY='(?:desculpa(?:r?)\\s+(?:te\\s+)?incomodar|desculpe\\s+(?:te\\s+)?incomodar|sem querer incomodar|desculpa\\s+atrapalhar|desculpe\\s+atrapalhar|me tira uma duvida|tira uma duvida|so uma duvida|uma duvida|so uma pergunta|uma pergunta|so uma coisa|por gentileza|por favor|com licenca|se voce puder|se puder|desculpa|desculpe|rapidinho|minutinho)'
const PREAMBLE=new RegExp(`^(?:\\s*(?:${GREETING}|${COURTESY}|${FILLER}|val)\\b[\\s,!.:;-]*)+`,'u')

// Recebe a frase já normalizada (minúscula, sem acento) e devolve só a pergunta.
// Frase que é só cumprimento vira string vazia — quem chama decide o que fazer com isso.
export const stripMessagePreamble=(source='')=>String(source||'').replace(PREAMBLE,'').trim()

// Uma letra trocada tirava a pergunta da allowlist e a VAL passava a NEGAR ter o dado
// ("comprimisso", "obejcao", "proxma"). Corrige so o token de faceta, com uma edicao de distancia e
// tamanho minimo de 6 letras, para nao transformar palavra legitima em faceta por acidente.
const FACET_TOKENS=['proxima','proximo','objecao','objecoes','compromisso','compromissos','perfil','cadastrada','cadastrado','visita','visitas','compra','compras','comprou','cultura','culturas','hectare','hectares','pendente','agendada','comportamental']
// Palavras reais do dominio que ficam a uma edicao de um token de faceta e NAO podem ser
// "corrigidas": "pagamento a vista" nao e visita, "custo" nao e compra.
const FACET_LOOKALIKES=new Set(['vista','visto','vistas','conta','contas','custo','custos','compro','compre','compor','cultuar','perdi','perde'])
// Damerau: a troca de duas letras vizinhas ("obejcao") e o erro de digitacao mais comum e conta
// como UMA edicao, nao duas.
const editDistance=(left,right)=>{
 if(left===right)return 0
 if(!left.length||!right.length)return Math.max(left.length,right.length)
 const rows=[]
 for(let row=0;row<=left.length;row+=1)rows.push(Array.from({length:right.length+1},(_,column)=>row===0?column:column===0?row:0))
 for(let row=1;row<=left.length;row+=1)for(let column=1;column<=right.length;column+=1){
  const cost=left[row-1]===right[column-1]?0:1
  rows[row][column]=Math.min(rows[row][column-1]+1,rows[row-1][column]+1,rows[row-1][column-1]+cost)
  if(row>1&&column>1&&left[row-1]===right[column-2]&&left[row-2]===right[column-1])rows[row][column]=Math.min(rows[row][column],rows[row-2][column-2]+1)
 }
 return rows[left.length][right.length]
}
export const repairFacetTypos=(source='')=>String(source||'').split(' ').map(token=>{
 if(token.length<5||FACET_TOKENS.includes(token)||FACET_LOOKALIKES.has(token))return token
 const match=FACET_TOKENS.find(canonical=>canonical.length>=6&&Math.abs(canonical.length-token.length)<=1&&editDistance(token,canonical)===1)
 return match||token
}).join(' ')

