// Shared boundary between explaining evidence and requesting a live observation.
// This does not supply facts or relax validation of generated claims.
const fold=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase()
export function requestsCurrentMarketValue(message=''){
 const s=fold(message)
 const commodity=/\b(?:soja|milho|trigo|sorgo|feijao|arroz|cevada|commodity|commodities|mercado)\b/.test(s)
 const value=/\b(?:cotacao|preco|referencia|valor)\b/.test(s)
 return commodity&&value&&/\b(?:traga|consulte|busque|mostre|informe|qual (?:e )?(?:o|a)|quanto (?:esta|custa|vale)|existe|temos)\b/.test(s)
  &&!/\b(?:diferenca|conceito|significa|equilibrio|hipotetic\w*|simul\w*)\b/.test(s)
}
export function isMarketEvidenceQuestion(message=''){
 const s=fold(message)
 // A mixed request for a current value must still use an authorized source.
 if(requestsCurrentMarketValue(s))return false
 const evidence=/\b(?:fonte|fontes|cotacao|preco|mercado|timestamp|captura|referencia)\b/.test(s)
 return evidence&&(/\b(?:como (?:devo |podemos |posso )?(?:apresent|compar|disting|valid|verific|interpret)\w*|quais campos|que ressalva|isso basta|devo confiar|pode ser usad\w*|da para comparar|sem chama\w* de atual)\b/.test(s)
  ||/\b(?:diferenca|conceito|significa)\b/.test(s))
}
export function isWeatherConceptQuestion(message=''){
 const s=fold(message)
 if(requestsCurrentMarketValue(s))return false
 if(/\b(?:qual (?:e )?a previsao|como esta|vai chover|esta chovendo|preveja|consulte|busque)\b/.test(s))return false
 return /\b(?:clima|tempo meteorologico|previsao de chuva)\b/.test(s)
  &&/\b(?:por que|diferenca|influencia|importam|basta para garantir|como revisar|conceito)\b/.test(s)
}
