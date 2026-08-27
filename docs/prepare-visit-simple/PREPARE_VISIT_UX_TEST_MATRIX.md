# Matriz de testes — Prepare Visit Simple

| # | Cenário | Evidência esperada |
|---|---|---|
| 1 | Consultor SIMPLE | Essencial compreensível sem abrir detalhes |
| 2 | Consultor ANALYTICAL | Números e evidências acessíveis |
| 3 | Consultor BALANCED | Síntese + análise, números sob demanda |
| 4 | Mesmo caso em três modos | Mesmo objetivo, tese, perguntas, estratégia e compromisso |
| 5 | Preferência do consultor | Não entra na API nem altera fatos |
| 6 | Perfil do produtor | Continua orientando abordagem e provas |
| 7 | Dez recomendações internas | No máximo três prioridades visíveis |
| 8 | Pouco histórico | Mensagem curta e uma lacuna útil; sem texto genérico |
| 9 | Voz pré-visita | Revisão/confirmação e preparação recalculada |
| 10 | Estou saindo agora | Uma tela com objetivo, lembrete, três perguntas, evite e compromisso |
| 11 | Mobile | Uma coluna, alvos de toque e modal com safe area |
| 12 | Drill-down técnico | Tese, números, riscos e agronomia continuam disponíveis |
| 13 | Regressão Fases 2–6 | Suíte completa verde |
| 14 | Tenancy e safety | Gates existentes permanecem verdes |
| 15 | Build/PWA/Manual | Artefatos compilam e verificam |
| 16 | Entrada pelo Centro de Decisão | “Preparar visita” abre a jornada focada, não uma resposta genérica |
| 17 | Produtor sem visita | Agendamento abre preselecionado, sem criar preparação órfã |

## UAT visual no staging

Validar com produtor fictício e sessão autenticada:

1. ler a camada essencial sem scroll excessivo;
2. responder em 10–20 segundos por que ir, o que perguntar, como abordar e com qual compromisso sair;
3. alternar os três modos e comprovar que o conteúdo decisório não muda;
4. abrir análise e números;
5. testar voz confirmada e recálculo;
6. testar “Estou saindo agora” em viewport móvel.
