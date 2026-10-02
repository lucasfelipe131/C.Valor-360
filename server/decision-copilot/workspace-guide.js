const fold=value=>String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim()
const guides={
 dashboard:['Início','Consulte as próximas visitas e prioridades. Abra um produtor para preparar a conversa ou acesse Visitas para organizar a agenda.'],
 clients:['Carteira','Busque o produtor pelo nome e abra seu perfil. No Produtor 360 você encontra os dados, o relacionamento e as informações comerciais dessa conta.'],
 client360:['Produtor 360','Use as guias do produtor para consultar o perfil, as informações comerciais e o mapa. Confira o nome da conta antes de editar dados ou registrar uma informação.'],
 datahub:['Base Inteligente','Escolha a importação desejada, envie o arquivo e revise o resultado antes de confirmar. Confira o produtor e os campos reconhecidos para evitar vincular dados à conta errada.'],
 visits:['Visitas','Consulte a agenda ou use Nova visita para planejar uma visita. Escolha o produtor e revise a data. A preparação e o registro da visita ficam neste módulo.'],
 opportunities:['Oportunidades','Acompanhe o funil comercial, abra uma oportunidade para revisar seus dados e confirme as alterações no formulário. Posso ajudar a preparar a abordagem comercial.'],
 val:['Análise avançada','Selecione o contexto e aprofunde a análise comercial ou de grãos. Posso ajudar a interpretar a resposta e identificar as informações que faltam.'],
 agro:['Inteligência Agronômica','Escolha uma ferramenta de campo: mapas e talhões, análise de solo, diagnóstico por foto ou calculadoras. Se a análise for de uma conta, confira o produtor selecionado.'],
 questionnaire:['Coletar preferências','Selecione o produtor e preencha as preferências pelo formulário. Revise as respostas antes de concluir para manter o perfil atualizado.'],
 reports:['Relatórios','Consulte os indicadores e relatórios disponíveis e ajuste os filtros da tela. Posso explicar um indicador ou ajudar a interpretar os dados que você informar.'],
 management:['Visão gerencial','Consulte os indicadores e relatórios da unidade dentro do seu acesso. Use os filtros da tela para delimitar a análise.'],
 settings:['Preferências','Revise as opções da sua conta e as configurações disponíveis. Uma mudança deve ser confirmada no próprio formulário.'],
 admin:['Administração','Gerencie os acessos e consulte as métricas disponíveis. Revise o usuário e as permissões antes de confirmar qualquer alteração.'],
 copilot:['Copiloto VAL','Pergunte por texto ou ative Modo conversa. Você pode navegar pelas guias enquanto fala; o painel compacto mantém os controles do microfone e o produtor da conversa.']
}
const tools={
 produtores:['Mapas e talhões','Selecione o produtor e a propriedade, confira a safra e use as ferramentas do mapa para consultar ou editar as áreas. Revise o desenho antes de salvar.'],
 mapping:null,mapa:null,
 solo:['Análise de solo','Abra ou envie a análise de solo, confira os valores e as unidades e revise a interpretação antes de usá-la no planejamento.'],soil:null,
 calculadoras:['Calculadoras','Escolha a calculadora e informe os dados e unidades solicitados. Confira as premissas antes de usar o resultado.'],calculators:null,
 diagnostico:['Diagnóstico por foto','Envie uma foto nítida e informe o contexto solicitado. Confira as hipóteses e as informações que faltam antes de definir o manejo.'],diagnosis:null,
 bulas:['Bulas e registros','Busque o produto e confira a bula e o registro aplicáveis. Posso ajudar a ler o documento que você selecionar.'],
 clima:['Clima e mercado','Consulte a localidade, a data e a fonte dos dados. Posso explicar os indicadores e ajudar a comparar cenários.'],
 biblioteca:['Documentos','Consulte os documentos disponíveis ou selecione o material que deseja analisar. Confira a origem e a data do documento.'],
 manual:['Manual do Agrônomo','Escolha a ferramenta ou o conteúdo técnico no menu do Manual. Posso orientar a navegação e explicar as informações da ferramenta escolhida.']
}
for(const [alias,key] of Object.entries({mapping:'produtores',mapa:'produtores',soil:'solo',calculators:'calculadoras',diagnosis:'diagnostico'}))tools[alias]=tools[key]
const tabs={overview:'Produtor',commercial:'Comercial',agronomy:'Agronomia',grains:'Grãos',credit:'Crédito',map:'Geo',documents:'Documentos'}

// Guidance is about existing controls, never inferred screen values or a write.
export function workspaceGuide({message='',workspaceContext=null,role='consultant'}={}){
 const text=fold(message)
 const explicitHelp=/^(?:val[, ]+)?(?:me )?(?:ajuda|ajude|oriente|guie)\b.*\b(?:aqui|tela|guia|modulo|sistema|navegar)\b/.test(text)||/\b(?:como (?:uso|usar|utilizo|utilizar|navego|navegar)|o que (?:posso|consigo) fazer|para que serve|onde estou)\b.*(?:aqui|tela|guia|modulo|sistema|\?$)/.test(text)
 if(!explicitHelp)return null
 const page=String(workspaceContext?.current_module||'copilot')
 const guide=guides[page]
 if(!guide)return null
 if((page==='admin'&&role!=='admin')||(page==='management'&&!['admin','manager','bi_viewer'].includes(role)))return {page,label:'Acesso restrito',summary:'Seu acesso não permite essa área. Posso orientar o uso das guias disponíveis no seu menu.'}
 const tool=page==='agro'?tools[String(workspaceContext?.current_tool||'')]:null
 const [label,instructions]=tool||guide
 const tab=page==='client360'?tabs[String(workspaceContext?.current_tab||'')]:null
 return {page,label,summary:`Você está em ${label}${tab?`, na guia ${tab}`:''}. ${instructions} Para navegar por voz, diga, por exemplo, “Abra Visitas” ou “Abra Relatórios”.`}
}
