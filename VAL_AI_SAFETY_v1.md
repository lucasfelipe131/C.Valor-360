# VAL AI Safety v1

1. Tenant, ator, cliente e anexos são verificados antes do raciocínio.
2. Prompt, anexo e fala são dados não confiáveis e não alteram policy.
3. IA não autoriza acesso, não confirma memória, não executa ação e não cria compromisso.
4. ASK tem `persistence_mode=NONE`; REGISTER/POST_VISIT exigem confirmação.
5. Diagnóstico, produto, dose, mistura, aplicação e prescrição são bloqueados até revisão habilitada.
6. Knowledge high-risk entra somente como guardrail; Library e Manual não elevam confiança factual da conta.
7. `SAFETY_PRESERVED` é soberano sobre qualquer recomposição de linguagem ou qualidade.
8. Falha de provider não bloqueia a decisão segura e resulta em fallback auditável.
9. Contexto curto é escopado por sessão e produtor; troca de conta não carrega thread.
10. Logs e auditoria guardam identificadores, versões, hashes e status, não conteúdo privado integral.
