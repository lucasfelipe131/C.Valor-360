# VAL System Voice Audit v1

| Module | Function | Read via voice? | Action via voice? | Confirmation? | Supported | Gap | Priority |
|---|---|---:|---:|---:|---|---|---:|
| Home | abrir VAL / perguntar | sim | sim | não | PASS código | UAT físico | P1 |
| Clientes | localizar produtor | sim | sim | não | PASS código | filtros avançados | P0 |
| Clientes | filtrar pendências | parcial | não | não | PARTIAL | adapter de filtro | P1 |
| Produtor 360 | abrir conta | sim | sim | não | PASS código | UAT cross-client | P0 |
| Produtor 360 | última visita/área/decisor | sim | leitura | não | PASS regressão | latência física | P0 |
| Visitas | abrir/preparar | sim | sim | não para abrir | PASS código | UAT natural | P0 |
| Visitas | criar visita | parcial | proposta | sim | PARTIAL | adapter create + confirmação | P1 |
| Visitas | concluir compromisso | parcial | não executa | sim | PARTIAL | adapter update canônico | P1 |
| Pós-visita | relato longo | sim | Voice Capture | sim | PASS existente | entrada realtime no lifecycle | P1 |
| Oportunidades | ler riscos/pipeline | sim | parcial | não | PASS read | filtro/seleção operacional | P1 |
| Oportunidades | update próximo passo | parcial | não executa | sim | PARTIAL | adapter update | P2 |
| Agronomia | abrir hub | sim | sim | não | PASS código | UAT físico | P1 |
| Propriedades/talhões | mostrar mapa | sim | sim | não | PASS open | seleção/edição por voz | P1 |
| Solo | abrir/interpretar | sim | sim | revisão técnica | PASS adapter | UAT arquivo + voz | P1 |
| Diagnóstico | foto/NutriScan/FitoScan | sim | sim | revisão técnica | PASS adapters | UAT multimodal | P1 |
| Calculadoras | executar 9 cálculos | sim | sim | inputs materiais | PASS regressão | UAT de voz | P1 |
| Mercado | soja/preços atuais | sim | sim | não | PASS provider | percepção de latência | P1 |
| Clima | fonte atual | sim quando provider existe | sim | não | FAIL-CLOSED | provider pode estar ausente | P2 |
| Bulas | fonte oficial | sim quando provider existe | sim | safety | FAIL-CLOSED | provider pode estar ausente | P2 |
| Biblioteca/Manual | buscar conhecimento | sim | parcial | safety | PASS read | deep-link fino | P2 |
| Relatórios | consultar indicadores | parcial | não | não | PARTIAL | intents/adapters | P3 |
| Configurações/Admin | operação | não | não | sim | NOT_PLANNED | fora da prioridade inicial | P3 |

## Achados

1. A presença global já existia no Topbar, Sidebar e navegação mobile; não foi criada outra VAL.
2. O maior gap estrutural era a falta de um contrato único entre linguagem natural, cliente autorizado e ação de UI.
3. Leitura e ferramentas estavam mais maduras que writes operacionais.
4. O novo router fecha OPEN/SEARCH/NAVIGATE/PREPARE; writes permanecem propositalmente parciais até terem adapter e confirmação completos.
5. UAT físico continua necessário e não foi substituído por fixtures.
