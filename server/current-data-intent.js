// Shared boundary between explaining evidence and requesting a live observation.
// This does not supply facts or relax validation of generated claims.
const fold=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
const questionClause=value=>value.split(/[.;]/).map(part=>part.trim()).filter(Boolean).at(-1)||''
export function requestsCurrentMarketValue(message=''){
 const s=fold(message)
 const commodity=/\b(?:soja|milho|trigo|sorgo|feijao|arroz|cevada|commodity|commodities|mercado|cambio|dolar|euro)\b/.test(s)
 const value=/\b(?:cotacao|preco|referencia|valor)\b/.test(s)
 const explicitCurrentLookup=/\b(?:traga|consulte|busque|mostre|informe)\b[^.!?;]{0,100}\b(?:cotacao|preco|referencia|valor)\b[^.!?;]{0,100}\b(?:hoje|agora|atual)\b/.test(s)
 if(commodity&&value&&explicitCurrentLookup)return true
 return commodity&&value&&/\b(?:traga|consulte|busque|mostre|informe|qual (?:e )?(?:o|a)|quanto (?:esta|custa|vale)|existe|temos)\b/.test(s)
  &&!/\b(?:diferenca|conceito|significa|equilibrio|hipotetic\w*|simul\w*)\b/.test(s)
}
export function isMarketEvidenceQuestion(message=''){
 const s=fold(message)
 const question=questionClause(s)
 // A mixed request for a current value must still use an authorized source.
 if(requestsCurrentMarketValue(s))return false
 const evidence=/\b(?:fonte|fontes|cotacao|preco|mercado|timestamp|captura|referencia|cambio|dolar|euro|frete|armazenagem)\b/.test(s)
 return evidence&&(/\b(?:como (?:devo |podemos |posso )?(?:apresent|compar|disting|valid|verific|interpret)\w*|quais campos|que ressalva|isso basta|devo confiar|pode ser usad\w*|da para comparar|sem chama\w* de atual)\b/.test(s)
  ||/\b(?:diferenca|conceito|significa)\b/.test(s)
  ||/^(?:(?:voce )?pode(?: me)? |(?:me )?ajude a )?(?:explicar?|entender|comparar?|relacionar?|distinguir|interpretar?)\b/.test(s)
  ||/^(?:como|por que|(?:quais|que) (?:(?:os|a) )?(?:limites|cuidados|criterios|parte))\b/.test(question)&&!/\b(?:esta|custa|vale|subiu|caiu|hoje|agora)\b/.test(question)
  ||/\bcomo (?:mostrar|explicar|apresentar|comparar|avaliar)\b/.test(question)&&/\b(?:limitacao|limites|criterios|premissas|evidencias)\b/.test(question))
}

// Asking how a tool should be used is not a request to execute it. Concrete
// references, attachments and supplied quantities still take the tool path.
export function isGeneralToolMethodQuestion(message=''){
 const s=fold(message)
 const question=questionClause(s)
 return (/^(?:como|por que|quais (?:sao )?(?:os )?(?:limites|cuidados|criterios)|o que (?:posso|podemos))\b/.test(question)||/\b(?:e|sao) (?:equivalente[s]?|o mesmo que)\b/.test(question))
  &&/\b(?:calcul\w*|analise de solo|laudo|diagnostico|foto|imagem)\b/.test(s)
  &&!/[0-9]/.test(s)
  &&!/\b(?:este|esta|esse|essa|deste|desta|desse|dessa|aquele|aquela|anex\w*|dele|dela|meu|minha|selecionad[oa]|atual)\b/.test(question)
}
export function isWeatherConceptQuestion(message=''){
 const s=fold(message)
 if(requestsCurrentMarketValue(s))return false
 if(/\b(?:qual (?:e )?a previsao|como esta|vai chover|esta chovendo|preveja|consulte|busque)\b/.test(s))return false
 return /\b(?:clima|tempo meteorologico|previsao de chuva)\b/.test(s)
  &&/\b(?:por que|diferenca|influencia|importam|basta para garantir|como revisar|conceito)\b/.test(s)
}
