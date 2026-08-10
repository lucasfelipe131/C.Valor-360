import React,{useState} from 'react'
import {KeyRound,LockKeyhole,LogOut,ShieldCheck} from 'lucide-react'
import Logo from '../components/Logo'

export default function PasswordChange({user,onChange,onLogout}){
 const [currentPassword,setCurrentPassword]=useState('')
 const [newPassword,setNewPassword]=useState('')
 const [confirmation,setConfirmation]=useState('')
 const [saving,setSaving]=useState(false)
 const [error,setError]=useState('')
 const submit=async event=>{
  event.preventDefault();setError('')
  if(newPassword!==confirmation){setError('A confirmação não corresponde à nova senha.');return}
  setSaving(true)
  try{await onChange({currentPassword,newPassword})}catch(exception){setError(exception.message||'Não foi possível trocar a senha.');setSaving(false)}
 }
 return <main className="password-change-shell"><section className="password-change-card"><Logo/><span className="eyebrow">PRIMEIRO ACESSO</span><div className="password-change-icon"><KeyRound/></div><h1>Crie sua senha pessoal.</h1><p>Olá, <b>{user?.name||user?.email}</b>. A senha temporária será invalidada assim que a troca for concluída.</p><form onSubmit={submit}><label>Senha temporária<input type="password" autoComplete="current-password" required value={currentPassword} onChange={event=>setCurrentPassword(event.target.value)}/></label><label>Nova senha<input type="password" autoComplete="new-password" required minLength="8" value={newPassword} onChange={event=>setNewPassword(event.target.value)} placeholder="Maiúscula, minúscula e número"/></label><label>Confirme a nova senha<input type="password" autoComplete="new-password" required minLength="8" value={confirmation} onChange={event=>setConfirmation(event.target.value)}/></label>{error&&<div className="form-error" role="alert">{error}</div>}<button className="primary-btn" disabled={saving}><LockKeyhole/>{saving?'Protegendo acesso…':'Salvar nova senha'}</button></form><div className="password-change-note"><ShieldCheck/><span>A carteira deste login começa zerada e fica isolada no PostgreSQL.</span></div><button type="button" className="password-exit" onClick={onLogout}><LogOut/>Sair e voltar depois</button></section></main>
}
