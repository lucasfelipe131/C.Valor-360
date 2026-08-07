import React,{useState} from 'react'
import questions from '../data/questions.json'
import { ClipboardList, Save } from 'lucide-react'
export default function Questionnaire(){
 const [answers,setAnswers]=useState({})
 return <div className="page-stack"><section className="module-hero"><div><span className="eyebrow">PRODUTOR 360</span><h2>Questionário atual</h2><p>As perguntas que já estão em uso permanecem como base do perfil. O consultor complementa os dados técnicos na ficha Cliente 360.</p></div></section>
 <article className="panel questionnaire"><div className="questionnaire-head"><ClipboardList/><div><h3>27 perguntas</h3><p>Versão atual do Projeto Produtor 360 — C.Vale</p></div></div>
 {questions.map(q=><label key={q.id}><span>{q.text}</span>{q.id>=19&&q.id<=24?<input type="number" min="0" max="10" value={answers[q.id]||''} onChange={e=>setAnswers({...answers,[q.id]:e.target.value})}/>:<textarea value={answers[q.id]||''} onChange={e=>setAnswers({...answers,[q.id]:e.target.value})} placeholder="Resposta do produtor"/></label>)}
 <button className="primary-btn" onClick={()=>alert('Questionário salvo no protótipo.')}><Save size={16}/>Salvar questionário</button></article></div>
}
