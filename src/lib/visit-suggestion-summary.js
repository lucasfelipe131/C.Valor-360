const normalized=value=>String(value??'').replace(/\s+/g,' ').trim()
const actionable=/\b(?:combin\w*|compromisso|pend[eê]ncia|pendente|retomar|retornar|confirmar|apresentar|comparativo|avaliar|levar|enviar|revisar)\b/i
const dependent=/^(?:isso|essa|esse|ela|ele|tamb[eé]m|por isso|portanto|assim|mas|e)\b/i

// Extract a complete recorded sentence, never invent a synthesis or silently
// truncate a clause. Ambiguous/multi-topic text remains behind explicit details.
export function summarizeVisitSuggestion(row={}){
 const full=String(row.reason??row.description??row.objective??'').trim()
 const text=normalized(full)
 const sentences=text.split(/(?<=[.!?])\s+/)
 const short=text.length<=150&&sentences.length===1?text:''
 const candidates=sentences.filter(sentence=>sentence.length<=150&&actionable.test(sentence)&&!dependent.test(sentence)&&!sentence.includes('?'))
 const reason=short||(candidates.length===1?candidates[0]:'Confira a pendência registrada antes de preparar a visita.')
 const next=normalized(row.nextCommitment??row.next_commitment??row.nextStep)
 const nextStep=next&&next.length<=110&&!dependent.test(next)&&!next.includes('?')&&next!==reason?next:''
 return {reason,nextStep,full,nextFull:next,extracted:Boolean(short||candidates.length===1)}
}
