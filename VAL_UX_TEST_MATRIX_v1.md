# Matriz de testes UX — VAL Copiloto v1

| ID | Jornada | Cenário | Evidência esperada | Estado |
|---|---|---|---|---|
| UX-01 | Home | usuário simples abre a VAL | até 3 prioridades e ação de voz; sem motores | PASS automatizado; UAT autenticado pendente |
| UX-02 | Home | nenhuma prioridade material | lacuna clara, sem card inventado | PASS automatizado |
| UX-03 | Home | falar sem escolher método | confirmação `GENERAL_CONTEXT` -> `/api/val/chat` -> resposta curta | PASS automatizado; UAT autenticado pendente |
| UX-04 | Prepare | SIMPLE | entende objetivo, perguntas, abordagem e compromisso sem detalhes | PASS automatizado |
| UX-05 | Prepare | ANALYTICAL | acessa números/evidências sem mudar a tese | PASS automatizado |
| UX-06 | Prepare | Golden Questions | 2–3, específicas e naturais | PASS automatizado |
| UX-07 | Prepare | “Estou saindo agora” | resumo cabe praticamente em uma tela | PASS automatizado; visual físico pendente |
| UX-08 | Cliente 360 | abrir produtor | memória/mudança/próximo passo antes do cadastro | PASS automatizado; UAT autenticado pendente |
| UX-09 | Cliente 360 | registrar áudio | revisão e atualização da memória viva após confirmar | PASS de serviço/contrato; UAT autenticado pendente |
| UX-10 | Pós-visita | “Me conte como foi” | voz é a ação principal; candidatos revisáveis | PASS de serviço/contrato; UAT físico pendente |
| UX-11 | Pós-visita | retry/fallback | erro claro, mesma interação, texto disponível | PASS automatizado |
| UX-12 | Profundidade | consultor simples/analítico | mesma inteligência, apresentação diferente | PASS automatizado |
| UX-13 | Agronomia | timing/observação | aparece contextual, sem painel obrigatório | PASS automatizado |
| UX-14 | Knowledge | item aplicável | influencia saída, sem dump | PASS automatizado |
| UX-15 | Mobile/PWA | uma mão, teclado e safe-area | sem overflow, alvo de toque e fluxo curto | REPROVADO: iOS físico não retestado; Android ausente |
| UX-16 | Navegação | Clientes/Produtor360 e VAL/Manual | um destino operacional inequívoco; ferramentas em drill-down | PASS automatizado; UAT autenticado pendente |

Evidência automatizada: `test/val-copilot-ux.test.js`, `test/prepare-visit-simple-ux.test.js`, `test/voice-capture-frontend.test.js` e suíte integral. Teste de fonte/CSS não substitui iOS/Android real; por isso UX-15 mantém o gate geral reprovado.
