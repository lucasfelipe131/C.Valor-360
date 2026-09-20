// Vocabulario fechado da agronomia brasileira. Existe porque a rodada 13 tentou resolver duas
// perguntas - "esta palavra e nome cientifico?" e "esta palavra e termo tecnico ou marca?" - por
// morfologia de sufixo, e sufixo nao separa latim de portugues: o portugues DESCENDE do latim.
// Medido: -osa vale para perigosa e para speciosa, -is para gerais e para brasiliensis, -i para
// possui e para pachyrhizi. A melhor regra de sufixo testada ainda aceitava 23 de 78 palavras
// comuns do portugues como epiteto latino. Lista fechada nao tem esse problema: e verificavel
// item a item, e nome comercial nunca e genero cientifico.
// Generos correntes na agronomia brasileira: fitopatogenos, pragas, inimigos naturais, daninhas,
// nematoides, culturas e agentes biologicos. Conjunto fechado e auditavel - marca comercial nao e
// genero, entao esta lista nao pode liberar alegacao de marca por acidente.
export const scientificGenus=new Set(`
phakopsora cercospora corynespora septoria colletotrichum macrophomina sclerotinia fusarium
rhizoctonia phytophthora pythium alternaria botrytis ramularia microsphaera erysiphe oidium
diaporthe phomopsis cercosporidium mycosphaerella stemphylium curvularia bipolaris drechslera
puccinia ustilago claviceps magnaporthe pyricularia gaeumannomyces sclerotium athelia
xanthomonas pseudomonas ralstonia erwinia pectobacterium clavibacter spiroplasma candidatus
aspergillus penicillium trichoderma beauveria metarhizium purpureocillium pochonia isaria
cordyceps lecanicillium akanthomyces paecilomyces bacillus bradyrhizobium azospirillum rhizobium
streptomyces baculovirus nucleopolyhedrovirus granulovirus
spodoptera helicoverpa heliothis anticarsia chrysodeixis pseudoplusia rachiplusia agrotis
elasmopalpus diatraea alabama pectinophora sitophilus rhyzopertha tribolium plodia
euschistus nezara piezodorus dichelops edessa thyanta chinavia
bemisia trialeurodes aphis myzus rhopalosiphum schizaphis lipaphis therioaphis
frankliniella thrips caliothrips enneothrips scirtothrips
tetranychus mononychellus polyphagotarsonemus brevipalpus oligonychus panonychus
diabrotica cerotoma colaspis phyllophaga migdolus sphenophorus dichotomius
dalbulus cicadella mahanarva deois zulia empoasca bucephalogonia
anastrepha ceratitis grapholita cydia leucoptera hypothenemus
liriomyza agromyza atta acromyrmex solenopsis
meloidogyne pratylenchus heterodera globodera rotylenchulus helicotylenchus ditylenchus
aphelenchoides xiphinema tylenchulus scutellonema belonolaimus
trichogramma telenomus cotesia bracon chrysoperla orius geocoris podisus doru
eleusine digitaria brachiaria urochloa panicum cenchrus echinochloa cynodon sorghum
amaranthus bidens euphorbia commelina ipomoea richardia conyza ageratum galinsoga
chenopodium portulaca sida solanum datura raphanus brassica lolium avena
cyperus rottboellia chloris eragrostis setaria pennisetum melinis
glycine zea oryza triticum hordeum gossypium phaseolus vigna arachis helianthus
saccharum coffea citrus musa manihot solanum capsicum lycopersicon allium daucus
crotalaria canavalia mucuna cajanus stylosanthes leucaena gliricidia
pinus eucalyptus tectona khaya
pasteuria steinernema heterorhabditis xylella xanthomonas leifsonia
sphaceloma elsinoe verticillium thielaviopsis ceratocystis monilinia
apis bombus melipona scaptotrigona tetragonisca
`.trim().split(/\s+/).filter(Boolean))

export const agronomicTerm=new Set(`
glifosato glufosinato paraquate diquate atrazina mesotriona tembotriona nicosulfurom clorimurom
imazetapir imazapir imazaquim diclosulam flumioxazina sulfentrazona saflufenacil fomesafem
lactofem haloxifope cletodim setoxidim fluazifope quizalofope 24-d dicamba picloram triclopir
metsulfurom clorsulfurom tifensulfurom iodosulfurom halosulfurom pendimetalina trifluralina
smetolacloro acetocloro alacloro isoxaflutol clomazona hexazinona tebutiurom diurom ametrina
azoxistrobina piraclostrobina trifloxistrobina fluxapiroxade benzovindiflupir bixafem fluopiram
protioconazol tebuconazol epoxiconazol ciproconazol difenoconazol propiconazol metconazol
mancozebe clorotalonil oxicloreto carbendazim tiofanato picoxistrobina mandestrobina
fluazinam procimidona iprodiona boscalida piraziflumida inpirfluxam metominostrobina
tiametoxam imidacloprido acetamiprido clotianidina dinotefurano fipronil etiprole
clorantraniliprole ciantraniliprole flubendiamida tetraniliprole ciclaniliprole
abamectina emamectina espinosade espinetoram novalurom lufenurom teflubenzurom triflumurom
metoxifenozida tebufenozida cromafenozida piriproxifem buprofezina diafentiurom
lambdacialotrina cialotrina deltametrina bifentrina permetrina cipermetrina esfenvalerato
zetacipermetrina alfacipermetrina betaciflutrina acefato clorpirifos malationa dimetoato
metomil carbofurano carbossulfano tiodicarbe aldicarbe benfuracarbe
sulfoxaflor flupiradifurona afidopiropeno piriproxifem espiromesifeno espirodiclofeno
propargito enxofre oleo mineral vegetal
bacillus thuringiensis subtilis amyloliquefaciens beauveria bassiana metarhizium anisopliae
trichoderma harzianum asperellum purpureocillium lilacinum pochonia chlamydosporia
baculovirus bradyrhizobium azospirillum rizobio inoculante coinoculacao
estrobilurinas triazois carboxamidas benzimidazois ditiocarbamatos neonicotinoides
piretroides organofosforados carbamatos diamidas antranilamidas avermectinas espinosinas
reguladores fenilpirazois sulfonilureias imidazolinonas triazinas cloroacetamidas
inibidores protox epsps accase als fotossistema
irac frac hrac mip mid manejo resistencia refugio rotacao
plantio semeadura colheita dessecacao dessecante adubacao calagem gessagem
terraceamento plantabilidade germinacao emergencia estande populacao espacamento
florescimento enchimento maturacao senescencia ciclo cultivar hibrido transgenico
soqueira rebrota perfilhamento acamamento debulha
nematoide nematoides galhas cistos lesoes meloidogyne pratylenchus heterodera rotylenchulus
lagarta lagartas percevejo percevejos mosca branca tripes acaro acaros pulgao pulgoes
cigarrinha cigarrinhas vaquinha broca curuquere helicoverpa spodoptera anticarsia chrysodeixis
ferrugem mofo antracnose mancha manchas cercosporiose ramularia oidio mildio septoriose
macrophomina sclerotinia fusarium rhizoctonia phakopsora colletotrichum corynespora
daninha daninhas buva capim amargoso pe-de-galinha caruru picao trapoeraba corda-de-viola
nitrogenio fosforo potassio calcio magnesio enxofre boro zinco manganes cobre molibdenio
ureia sulfato cloreto fosfato calcario gesso npk micronutrientes macronutrientes
saturacao bases ctc materia organica textura argila fertilidade analise
pulverizacao pulverizador bico bicos ponta pontas calda vazao deriva gotas
adjuvante surfatante espalhante antideriva oleo emulsionavel suspensao concentrado
carencia reentrada receituario agronomico epi tripla lavagem
produtividade sacas arroba rendimento perda perdas quebra estande
plantio direto convencional cobertura palhada consorcio integracao pastagem lavoura floresta
irrigacao pivo gotejamento aspersao lamina evapotranspiracao
zarc janela semeadura vazio sanitario calendario
epsps als accase hppd ppo protox gaba fotossistema mitocondrial respiracao quitina
sintese enzima enzimas canais sodio cloro receptor receptores sitio alvo
bioinsumo bioinsumos antagonista antagonistas escalonamento novaluron
acido graxo carotenoide esterol tubulina octopamina ryr rianodina
feromonio entomopatogeno graminicida herbicida fungicida inseticida acaricida nematicida
biologico biologicos amostragem monitoramento armadilha limiar dano economico
protetor curativo sistemico translaminar contato ingestao residual
`.trim().split(/\s+/).filter(Boolean))

// O acervo curado foi usado como dicionario de agronomia e nao e um: 2580 palavras, e nenhum
// dos 36 ingredientes ativos e grupos quimicos medidos estava la.
const plain=word=>String(word||'').replace(/-/g,'')
export const knownAgronomicTerm=word=>functionWord.has(word)||agronomicTerm.has(word)||agronomicTerm.has(plain(word))||/^[ivx]{1,4}$/.test(word)||(word.length>4&&word.endsWith('s')&&agronomicTerm.has(word.slice(0,-1)))||(word.length>5&&word.endsWith('es')&&agronomicTerm.has(word.slice(0,-2)))

// Classe fechada do portugues: determinante, pronome, adverbio, conjuncao e quantificador. Comecar
// a oracao em maiuscula e gramatica, entao estas palavras aparecem capitalizadas o tempo todo sem
// serem nome proprio. Antes quem as protegia era o vocabulario do acervo curado - por acaso, e ele
// protegia tambem tres marcas reais (Premio, Score, Certeza) que por acaso estavam la.
export const functionWord=new Set(`
nenhum nenhuma nenhuns nenhumas todo toda todos todas cada qualquer quaisquer algum alguma alguns
algumas outro outra outros outras mesmo mesma mesmos mesmas tanto tanta tantos tantas tal tais
muito muita muitos muitas pouco pouca poucos poucas varios varias ambos ambas certo certa
este esta estes estas esse essa esses essas aquele aquela aqueles aquelas isso isto aquilo
quando onde como porque pois porem contudo todavia entretanto embora caso enquanto conforme
apenas somente tambem ainda sempre nunca jamais talvez quase geralmente normalmente idealmente
tipicamente comumente frequentemente raramente possivelmente provavelmente certamente
antes depois durante sobre entre contra desde para com sem sob apos perante
primeiro segundo terceiro ultimo proximo anterior posterior
nao mais menos melhor pior maior menor igual diferente
existe existem havia houve deve devem pode podem precisa precisam costuma costumam
deveria deveriam poderia poderiam seria seriam teria teriam faria fariam iria iriam daria
haveria precisaria precisariam conseguiria valeria custaria bastaria convem conviria
nesse neste nessa nesta naquele naquela nisso nisto aqui ali assim entao logo
`.trim().split(/\s+/).filter(Boolean))

// Infinitivos do portugues correntes numa pergunta de consultor. Classe grande mas fechada, e a
// unica coisa que separa "manejar" de "Premier": as duas terminam em -ar, as duas podem vir depois
// de "para". A rodada 13 tentou separar pela POSICAO e custou 100 perguntas que a VAL respondia.
export const verbInfinitive=new Set(`
agir manejar combater enfrentar controlar atacar mitigar tratar prevenir evitar eliminar erradicar
proteger aplicar pulverizar dessecar semear plantar colher adubar calcariar gessar irrigar
monitorar amostrar identificar reconhecer diagnosticar avaliar medir calcular estimar prever
planejar programar escalonar priorizar decidir escolher selecionar comparar classificar
rotacionar alternar intercalar consorciar integrar diversificar
reduzir aumentar melhorar otimizar maximizar minimizar economizar investir gastar custar
vender comprar negociar precificar cotar faturar cobrar pagar financiar antecipar
registrar anotar lancar cadastrar atualizar corrigir revisar conferir validar
acompanhar visitar atender orientar recomendar sugerir propor apresentar explicar
entender compreender aprender ensinar mostrar demonstrar comprovar confirmar
usar utilizar empregar adotar implantar instalar configurar ajustar regular calibrar
misturar diluir preparar dosar fracionar armazenar transportar descartar lavar
resistir tolerar suportar aguentar durar persistir permanecer
germinar emergir brotar florescer frutificar amadurecer secar
atrasar adiantar acelerar retardar interromper suspender retomar continuar
perder ganhar recuperar compensar substituir trocar repor
fazer poder dever querer saber ver ter ser estar ir vir dar por
haver dizer falar ouvir sentir pensar achar precisar conseguir tentar buscar procurar
obter alcancar atingir chegar passar ficar deixar levar trazer tirar colocar
abrir fechar comecar iniciar terminar acabar parar seguir manter mudar
existir ocorrer acontecer surgir aparecer desaparecer
funcionar operar rodar trabalhar produzir gerar criar formar construir montar
contribuir influir interferir impactar afetar prejudicar beneficiar favorecer
depender variar diferir divergir coincidir combinar casar
incluir excluir conter abranger cobrir atingir limitar restringir liberar permitir
exigir requerer demandar necessitar dispensar
justificar explicar fundamentar sustentar embasar
esperar aguardar adiar antecipar programar agendar marcar
lidar abordar auxiliar consultar declarar desligar ligar entregar enumerar perguntar responder
pontuar repetir respeitar girar puxar empurrar apertar soltar
cortar quebrar romper furar rasgar juntar somar dividir multiplicar subtrair
anotar apontar assinalar destacar ressaltar enfatizar lembrar esquecer notar reparar
cuidar zelar vigiar observar inspecionar fiscalizar auditar certificar homologar
negar recusar aceitar concordar discordar contestar questionar duvidar
chover ventar gear nevar orvalhar amanhecer anoitecer esfriar esquentar aquecer resfriar
encher esvaziar transbordar escorrer infiltrar percolar drenar encharcar
brotar enraizar enraizar perfilhar afilhar espigar granar encher vingar
pegar largar prender soltar amarrar desamarrar erguer baixar subir descer entrar sair
voltar retornar repassar revisitar reavaliar recalcular refazer reaplicar reiniciar
`.trim().split(/\s+/).filter(Boolean))
