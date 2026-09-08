// O consultor abre a frase com vocativo, saudação e cortesia — e na voz isso é a regra, porque a
// transcrição começa pela palavra de acordar ("Val, qual a próxima visita?"). Cada porta que casa
// padrão contra a frase precisa remover esse preâmbulo antes, e cada porta nova que esquecia
// reintroduzia o mesmo defeito: a rodada 3 corrigiu no roteador de intenção, a 5 no seletor de
// contexto, e a 6 encontrou o mesmo buraco no classificador de fato estruturado e na Biblioteca.
// Uma lista enumerada de palavras nunca fecha; o que fecha é remover o preâmbulo num lugar só.
const GREETING='(?:oi+|ola|opa|e ai|eae|hey|ei|hi|hello|bom dia|boa tarde|boa noite|tudo bem|tudo bom|beleza|blz|salve)'
// As formas mais longas vêm primeiro: a alternação casa a primeira que serve, e "desculpa"
// sozinha deixaria "incomodar" para trás.
const COURTESY='(?:desculpa(?:r?)\\s+(?:te\\s+)?incomodar|desculpe\\s+(?:te\\s+)?incomodar|sem querer incomodar|desculpa\\s+atrapalhar|desculpe\\s+atrapalhar|me tira uma duvida|tira uma duvida|so uma duvida|uma duvida|so uma pergunta|uma pergunta|so uma coisa|por gentileza|por favor|com licenca|se voce puder|se puder|desculpa|desculpe|rapidinho|minutinho)'
const PREAMBLE=new RegExp(`^(?:\\s*(?:${GREETING}|${COURTESY}|val)\\b[\\s,!.:;-]*)+`,'u')

// Recebe a frase já normalizada (minúscula, sem acento) e devolve só a pergunta.
// Frase que é só cumprimento vira string vazia — quem chama decide o que fazer com isso.
export const stripMessagePreamble=(source='')=>String(source||'').replace(PREAMBLE,'').trim()
