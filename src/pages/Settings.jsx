import React from 'react'
import {CheckCircle2,Database,Download,LogOut,ShieldCheck,Trash2,UserCog} from 'lucide-react'

export default function Settings({clients,visits,onLogout,onNotify}){
 const backup=()=>{
  const payload={version:'0.3.0',exportedAt:new Date().toISOString(),clients,visits,opportunities:JSON.parse(localStorage.getItem('valor360-opportunities')||'[]')}
  const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='valor360-backup.json';a.click();URL.revokeObjectURL(url);onNotify?.('Backup do piloto gerado com sucesso.')
 }
 const clear=()=>{if(window.confirm('Limpar os dados adicionados neste dispositivo e voltar à base piloto?')){['valor360-clients','valor360-visits','valor360-opportunities'].forEach(k=>localStorage.removeItem(k));window.location.reload()}}
 return <div className="page-stack">
  <section className="module-hero"><div><span className="eyebrow">AMBIENTE DO PILOTO</span><h2>Configurações e governança</h2><p>Controle de acesso, integridade dos dados e parâmetros da unidade.</p></div><span className="environment-badge"><i></i>Ambiente operacional</span></section>
  <section className="settings-grid"><article className="panel setting-card"><div className="setting-icon"><UserCog/></div><h3>Acesso atual</h3><div className="user-setting"><div className="user-avatar">LF</div><div><b>Lucas Felipe de Oliveira</b><span>Consultor • São Luiz Gonzaga/RS</span></div></div><button className="soft-btn danger-text" onClick={onLogout}><LogOut size={16}/>Encerrar sessão</button></article><article className="panel setting-card"><div className="setting-icon green-icon"><Database/></div><h3>Dados do piloto</h3><dl className="setting-list"><div><dt>Produtores</dt><dd>{clients.length}</dd></div><div><dt>Visitas</dt><dd>{visits.length}</dd></div><div><dt>Armazenamento</dt><dd>Este dispositivo</dd></div></dl><button className="soft-btn" onClick={backup}><Download size={16}/>Baixar backup JSON</button></article><article className="panel setting-card"><div className="setting-icon cyan-icon"><ShieldCheck/></div><h3>Governança da VAL</h3><ul className="guardrail-list"><li><CheckCircle2/>Premissas de ROI visíveis</li><li><CheckCircle2/>Decisão final do consultor</li><li><CheckCircle2/>Sem inventar dado agronômico</li></ul><span className="version-chip">Motor demonstrativo v0.3</span></article></section>
  <article className="panel admin-panel"><div><span className="eyebrow">ADMINISTRAÇÃO</span><h3>Próximas integrações corporativas</h3><p>Autenticação por unidade, importação automática do CRM, PostgreSQL e permissões por carteira estão previstas para a próxima fase.</p></div><div className="admin-actions"><button className="soft-btn danger-text" onClick={clear}><Trash2 size={16}/>Restaurar base piloto</button></div></article>
 </div>
}
