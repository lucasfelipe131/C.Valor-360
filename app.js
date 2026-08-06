const clients = {
  joao: {id:'joao', initials:'JS', name:'João da Silva', city:'São Luiz Gonzaga', area:'482 ha', cultures:'Soja • Milho', profile:'Analítico', secondary:'Conservador', irt:88, nps:9, potential:'R$ 84 mil', last:'34 dias', risk:'Médio', opportunity:'Programa de manejo de plantas daninhas', channel:'Visita presencial com dados e comparativos', objection:'Custo inicial', style:'Use números, histórico, ROI e provas de campo. Evite promessas genéricas.'},
  carlos: {id:'carlos', initials:'CM', name:'Carlos Martins', city:'Roque Gonzales', area:'310 ha', cultures:'Soja • Trigo', profile:'Relacional', secondary:'Conservador', irt:91, nps:10, potential:'R$ 61 mil', last:'42 dias', risk:'Baixo', opportunity:'Renovação de pacote tecnológico', channel:'Conversa presencial e acompanhamento próximo', objection:'Mudança de fornecedor', style:'Comece pelo relacionamento, valide segurança e use histórias de produtores semelhantes.'},
  pedro: {id:'pedro', initials:'PO', name:'Pedro Oliveira', city:'Santo Antônio das Missões', area:'640 ha', cultures:'Soja • Milho', profile:'Inovador', secondary:'Analítico', irt:76, nps:8, potential:'R$ 39 mil', last:'19 dias', risk:'Baixo', opportunity:'Biológicos e tratamento de sementes', channel:'WhatsApp + visita técnica', objection:'Comprovação local', style:'Apresente novidade com teste controlado, benchmark e métricas claras.'}
};
let currentClient = clients.joao;

const screens = [...document.querySelectorAll('.screen')];
const navItems = [...document.querySelectorAll('.nav-item')];
const title = document.getElementById('pageTitle');
const subtitle = document.getElementById('pageSubtitle');
const screenMeta = {
  dashboard:['Visão do dia','Decisões comerciais orientadas por valor.'],
  clientes:['Clientes','Conheça o produtor antes de oferecer uma solução.'],
  cliente:['Cliente 360','Perfil, contexto, oportunidades e relacionamento.'],
  preparar:['Preparar visita','Roteiro personalizado pela VAL.'],
  roteiro:['Roteiro','Priorize tempo, distância e potencial.'],
  oportunidades:['Oportunidades','Transforme lacunas em propostas de valor.'],
  indicadores:['Indicadores','Meça comportamento, execução e geração de valor.']
};

function showScreen(id){
  screens.forEach(s=>s.classList.toggle('active',s.id===id));
  navItems.forEach(n=>n.classList.toggle('active',n.dataset.screen===id));
  const meta=screenMeta[id]||['C.Valor 360',''];
  title.textContent=meta[0]; subtitle.textContent=meta[1];
  window.scrollTo({top:0,behavior:'smooth'});
}

navItems.forEach(n=>n.onclick=()=>showScreen(n.dataset.screen));
document.querySelectorAll('[data-screen-jump]').forEach(b=>b.onclick=()=>showScreen(b.dataset.screenJump));

function renderClients(filter=''){
  const grid=document.getElementById('clientGrid');
  const list=Object.values(clients).filter(c=>(c.name+c.city+c.cultures).toLowerCase().includes(filter.toLowerCase()));
  grid.innerHTML=list.map(c=>`<article class="client-card" data-client="${c.id}">
    <div class="row"><div class="avatar">${c.initials}</div><span class="tag">${c.profile}</span></div>
    <h3>${c.name}</h3><p>${c.city} • ${c.area} • ${c.cultures}</p>
    <p>IRT ${c.irt} • Último contato: ${c.last}</p>
    <div class="potential">${c.potential}</div><small>potencial estimado</small>
  </article>`).join('');
  grid.querySelectorAll('[data-client]').forEach(el=>el.onclick=()=>openClient(el.dataset.client));
}
renderClients();
document.getElementById('clientSearch').oninput=e=>renderClients(e.target.value);

function openClient(id){
  currentClient=clients[id];
  const c=currentClient;
  document.getElementById('clientDetail').innerHTML=`<div class="client-hero">
    <div><p class="eyebrow">CLIENTE 360</p><h2>${c.name}</h2><p>${c.city} • ${c.area} • ${c.cultures}</p>
    <div class="client-meta"><span class="tag">${c.profile}</span><span class="tag">${c.secondary}</span><span class="tag">IRT ${c.irt}</span><span class="tag">NPS ${c.nps}</span></div></div>
    <div class="client-actions"><button class="primary" id="prepareBtn">Preparar visita com a VAL</button></div></div>
    <div class="tabs">
      <div class="insight"><span>Oportunidade prioritária</span><strong>${c.opportunity}</strong></div>
      <div class="insight"><span>Potencial estimado</span><strong>${c.potential}</strong></div>
      <div class="insight"><span>Objeção provável</span><strong>${c.objection}</strong></div>
      <div class="insight"><span>Risco de relacionamento</span><strong>${c.risk}</strong></div>
    </div>
    <div class="grid-2" style="margin-top:16px">
      <article class="panel"><p class="eyebrow">COMO SE COMUNICAR</p><h3>${c.channel}</h3><p>${c.style}</p></article>
      <article class="panel"><p class="eyebrow">PRÓXIMA MELHOR AÇÃO</p><h3>Conduzir diagnóstico e quantificar custo da situação atual</h3><p>Objetivo: sair da visita com compromisso de avaliação técnica ou proposta.</p></article>
    </div>`;
  document.getElementById('prepareBtn').onclick=prepareVisit;
  showScreen('cliente');
}

document.querySelectorAll('.priority-card').forEach(el=>el.onclick=()=>openClient(el.dataset.client));
document.querySelectorAll('[data-action="prepare-joao"]').forEach(el=>el.onclick=()=>{currentClient=clients.joao;prepareVisit()});

function prepareVisit(){
  const c=currentClient;
  document.getElementById('prepareContent').innerHTML=`<div class="hero"><div><p class="eyebrow">ROTEIRO GERADO PELA VAL</p><h2>${c.name}</h2><p>Perfil ${c.profile} + ${c.secondary}. O foco da conversa é ${c.opportunity.toLowerCase()}.</p></div><button class="primary">Iniciar visita</button></div>
  <div class="prepare-grid" style="margin-top:16px">
    <article class="prepare-card"><p class="eyebrow">1. OBJETIVO</p><h3>Levar o produtor a reconhecer o impacto econômico da situação atual</h3><p>Compromisso esperado: autorizar avaliação técnica e avançar para uma proposta mensurável.</p></article>
    <article class="prepare-card"><p class="eyebrow">2. ABERTURA PERSONALIZADA</p><h3>“João, trouxe alguns dados para comparar o custo do manejo atual com o custo das perdas que podem estar passando despercebidas.”</h3></article>
    <article class="prepare-card"><p class="eyebrow">3. PERGUNTAS SPIN</p><ol><li>Como está estruturado o manejo hoje?</li><li>Onde estão ocorrendo os maiores escapes ou retrabalhos?</li><li>Que impacto isso teve em produtividade, aplicação ou tempo?</li><li>Quanto valeria reduzir esse risco já nesta safra?</li></ol></article>
    <article class="prepare-card"><p class="eyebrow">4. REFRAME CHALLENGER</p><h3>“O maior custo pode não estar no produto mais caro, mas na perda que não está sendo medida.”</h3><p>Use dados, comparativos e um caso semelhante. Não apresente produto antes de validar o problema.</p></article>
    <article class="prepare-card"><p class="eyebrow">5. PROVA DE VALOR</p><ul><li>Custo por hectare</li><li>Perda evitada em sacas</li><li>ROI esperado</li><li>Risco do status quo</li></ul></article>
    <article class="prepare-card"><p class="eyebrow">6. FECHAMENTO</p><h3>“Faz sentido medirmos isso em uma área e compararmos o resultado?”</h3><p>Registrar responsável, prazo e próxima ação.</p></article>
    <article class="prepare-card full"><p class="eyebrow">ALERTA DA VAL</p><h3>Evite iniciar falando de preço ou catálogo.</h3><p>${c.style}</p></article>
  </div>`;
  showScreen('preparar');
}

const drawer=document.getElementById('valDrawer'), overlay=document.getElementById('overlay');
function openVal(){drawer.classList.add('open');overlay.classList.add('show')}
function closeVal(){drawer.classList.remove('open');overlay.classList.remove('show')}
document.getElementById('valOpen').onclick=openVal;
document.getElementById('valClose').onclick=closeVal;
overlay.onclick=closeVal;
function respond(prompt){
  const p=prompt.toLowerCase(); let ans='';
  if(p.includes('quem devo')) ans='Priorize João da Silva. Ele está há 34 dias sem contato, possui potencial estimado de R$ 84 mil e uma oportunidade clara em manejo de plantas daninhas. Prepare uma conversa baseada em dados e ROI.';
  else if(p.includes('joão')||p.includes('abordar')) ans='João é Analítico com traço Conservador. Comece com dados e diagnóstico. Mostre o custo da situação atual, use um comparativo confiável e proponha um teste mensurável. Evite começar por preço.';
  else if(p.includes('risco')) ans='O maior risco atual é a perda de ritmo de relacionamento com quatro clientes sem contato há mais de 45 dias. Sugestão: agendar retorno e registrar um próximo compromisso objetivo.';
  else ans='Para responder com precisão, a VAL cruzaria perfil, histórico, cultura, potencial, estágio da oportunidade e última interação. Neste protótipo, posso demonstrar preparação de visita, priorização e venda de valor.';
  document.getElementById('valResponse').innerHTML=`<div class="val-answer"><b>VAL</b><br>${ans}</div>`;
}
document.querySelectorAll('.quick').forEach(b=>b.onclick=()=>respond(b.dataset.prompt));
document.getElementById('valSend').onclick=()=>respond(document.getElementById('valPrompt').value);
document.getElementById('valPrompt').addEventListener('keydown',e=>{if(e.key==='Enter')respond(e.target.value)});
document.getElementById('mobileMenu').onclick=()=>document.querySelector('.sidebar').classList.toggle('open');
