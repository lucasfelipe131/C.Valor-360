# VAL_REBRAND_UAT_CHECKLIST

Roteiro de aceite. Rodar com carteira real, não em modo demonstrativo — vários itens
só se provam com produtor, visita e oportunidade de verdade.

```bash
npm run build
DATABASE_URL=... VAL_ADMIN_EMAIL=... VAL_ADMIN_PASSWORD=... VAL_SESSION_SECRET=... npm start
```

Legenda: ☐ a validar · ✅ validado automaticamente · ⚠️ não validável neste ambiente

---

## 1. Identidade

| # | Caso | Esperado | Status |
|---|---|---|---|
| 1.1 | Abrir o Login | Marca oficial em destaque: V marfim + folha oliva, wordmark VAL, assinatura INTELIGÊNCIA QUE GERA VALOR | ☐ |
| 1.2 | Entrar e olhar a sidebar | Lockup compacto da marca oficial sobre floresta | ✅ |
| 1.3 | Abrir no celular | Símbolo + VAL no cabeçalho | ✅ |
| 1.4 | Aba do navegador | Favicon = símbolo VAL sobre floresta | ✅ |
| 1.5 | Instalar como PWA | Ícone maskable com zona segura; `theme_color` `#0D1F15` | ✅ |
| 1.6 | Abrir Inteligência Agronômica | Dentro do iframe, mesma identidade — nenhum azul da marca anterior | ✅ |
| 1.7 | Procurar a logo antiga | Nenhuma ocorrência do traço azul/verde-água em nenhuma superfície | ✅ |

## 2. Navegação por workspaces

| # | Caso | Esperado | Status |
|---|---|---|---|
| 2.1 | Percorrer os cinco workspaces | Comercial, Produtor, Inteligência, Campo e Gestão abrem seu primeiro módulo | ✅ |
| 2.2 | Conferir a subnavegação | Só os módulos do workspace ativo aparecem, indentados sob o título dele | ✅ |
| 2.3 | Procurar cada módulo do inventário | Os 13 continuam alcançáveis | ✅ |
| 2.4 | Entrar como consultor (não admin) | Administração não aparece | ✅ |
| 2.5 | Recolher a sidebar | Vira só ícones, com tooltip; o estado sobrevive ao recarregar | ☐ |
| 2.6 | Abrir a VAL e fechar | Volta para o mesmo workspace, não para a Home | ✅ |

## 3. Contexto do produtor — o coração do aceite

| # | Caso | Esperado | Status |
|---|---|---|---|
| 3.1 | Abrir um produtor | Trilha mostra Produtor › Cliente 360 › nome do produtor | ✅ |
| 3.2 | **Trocar de produtor** | Timeline, contexto, oportunidades e Copiloto trocam **por inteiro** | ☐ **crítico** |
| 3.3 | Sair do produtor para Visitas e voltar | O produtor em foco continua o mesmo — não pula para o primeiro da carteira | ☐ **crítico** |
| 3.4 | Abrir o Copiloto dentro do produtor | A VAL já sabe de quem se trata; não é preciso repetir o nome | ☐ |
| 3.5 | Procurar dado de outro produtor no painel | Nada de outro produtor aparece | ✅ |
| 3.6 | Sair e entrar com outro login | Nenhum resíduo da carteira anterior | ☐ **crítico** |

## 4. Split View

| # | Caso | Esperado | Status |
|---|---|---|---|
| 4.1 | Abrir um produtor com histórico | Painel à direita com Timeline, Contexto e Copiloto | ☐ |
| 4.2 | Ler a Timeline | Visitas, transições de oportunidade, compromissos e atualizações de contexto, do mais recente ao mais antigo | ☐ |
| 4.3 | Produtor com registro sem data | O registro **não** aparece na linha; o rodapé diz quantos ficaram fora | ☐ |
| 4.4 | Alternar as três abas | Troca sem sair da página e sem recarregar dado | ✅ |
| 4.5 | Recolher o painel | A área principal ocupa a largura; o estado sobrevive ao recarregar | ☐ |
| 4.6 | Abrir em tablet (1024) | O painel vira seção empilhada, com o mesmo conteúdo | ✅ |
| 4.7 | Usar um atalho do Copiloto | Abre o Copiloto já com o produtor e a pergunta | ☐ |
| 4.8 | Produtor sem perfil medido | A VAL diz que não mediu, em vez de supor um perfil | ✅ |

## 5. Home como centro operacional

| # | Caso | Esperado | Status |
|---|---|---|---|
| 5.1 | Abrir a Home com agenda cheia | Visitas de hoje, preparadas, oportunidades e pendências com números reais | ☐ |
| 5.2 | Clicar em cada contador | Leva ao módulo que resolve aquilo | ✅ |
| 5.3 | Ler Próximas visitas | Horário, produtor, local e objetivo reais, em ordem | ☐ |
| 5.4 | Visita já preparada | O botão diz "Abrir preparação" | ☐ |
| 5.5 | Carteira vazia | Zeros com explicação; nenhuma urgência inventada | ✅ |
| 5.6 | Conferir "Pendências" | Conta visitas em andamento e aguardando revisão — não é alerta fabricado | ✅ |

## 6. Busca global

| # | Caso | Esperado | Status |
|---|---|---|---|
| 6.1 | Buscar nome de produtor | Aparece como Produtor e abre o Produtor 360 | ☐ |
| 6.2 | Buscar "calculadora" | Aparece como Ferramenta e abre a Inteligência Agronômica nela | ✅ |
| 6.3 | Buscar objetivo de visita | Aparece como Visita | ☐ |
| 6.4 | Buscar "config" | Aparece como Módulo | ✅ |
| 6.5 | Buscar algo inexistente | Diz que não achou na carteira desta sessão | ✅ |
| 6.6 | Buscar com acento e sem acento | Mesmo resultado | ✅ |

## 7. Mobile

| # | Caso | Esperado | Status |
|---|---|---|---|
| 7.1 | Abrir em 375, 390 e 430 | Sem arraste horizontal em nenhum módulo | ✅ |
| 7.2 | Barra inferior | Início, Produtores, +, Copiloto, Mais — cinco, sem corte | ✅ |
| 7.3 | Tocar no "+" | Falar com a VAL, Agendar visita, Novo produtor, Nova oportunidade | ✅ |
| 7.4 | Tocar em "Mais" | Os cinco workspaces com seus módulos | ✅ |
| 7.5 | Abrir uma calculadora no celular | Campos empilhados; preencher sem arrastar de lado | ⚠️ requer o app embutido instalado |
| 7.6 | Abrir o Produtor 360 no celular | Painel contextual vira seção abaixo, sem perder conteúdo | ☐ |

## 8. Preservação funcional

| # | Caso | Esperado | Status |
|---|---|---|---|
| 8.1 | Agendar visita | Funciona igual | ☐ |
| 8.2 | Preparar visita com a VAL | Funciona igual | ☐ |
| 8.3 | Iniciar visita e registrar por voz | Funciona igual | ☐ |
| 8.4 | Registrar observação de campo | Funciona igual | ☐ |
| 8.5 | Importar planilha na Base Inteligente | Funciona igual | ☐ |
| 8.6 | Criar link de preferências e importar respostas | Funciona igual | ☐ |
| 8.7 | Simulador de cenário em Oportunidades | Funciona igual | ☐ |
| 8.8 | Exportar PDF em Relatórios | Funciona igual | ☐ |
| 8.9 | Backup JSON em Configurações | Funciona igual | ☐ |
| 8.10 | Administração: usuários e métricas | Funciona igual | ☐ |
| 8.11 | Ctrl/Cmd+K | Abre o Copiloto | ✅ |
| 8.12 | Conversa por voz em tempo real | Funciona igual | ☐ |

## 9. Acessibilidade

| # | Caso | Esperado | Status |
|---|---|---|---|
| 9.1 | Navegar só de teclado | Todos os destinos alcançáveis; foco visível | ☐ |
| 9.2 | Skip link | "Pular para o conteúdo" continua funcionando | ✅ |
| 9.3 | Abas do painel contextual com teclado | `role="tablist"` com `aria-selected` e `aria-controls` | ✅ |
| 9.4 | Leitor de tela na navegação | Workspace e módulo ativos anunciados | ⚠️ não auditado |
| 9.5 | Contraste | Preservado por construção na migração cromática | ✅ |

---

## Critério de aprovação

O rebrand só é aprovado se:

1. **nenhum item da seção 8 regredir** — preservação funcional é inviolável;
2. **3.2, 3.3 e 3.6 passarem** — a fronteira de produtor é o gate de segurança;
3. nenhuma logo antiga aparecer em nenhuma superfície;
4. nenhuma tela exigir arraste horizontal em 375px.
