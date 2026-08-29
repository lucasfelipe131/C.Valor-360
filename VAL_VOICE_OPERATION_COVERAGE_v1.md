# VAL Voice Operation Coverage v1

Data: 2026-08-29
Escala: 0–100% de cobertura de contrato/código. Não representa aprovação física.

## Score

`VOICE_OPERATION_COVERAGE = 74%` para as oito prioridades iniciais, com peso igual: Clientes 75, Prepare 85, Visitas 65, Pós-visita 55, Oportunidades 60, Agronomia 75, Ferramentas 85 e Mercado 90.

| Jornada | Read via voice | Action via voice | Confirmação | Score | Gap principal |
|---|---|---|---|---:|---|
| Home | Sim | abrir/navegar | não | 80% | sessão hands-free não persiste fisicamente entre páginas comprovada |
| Clientes | Sim | abrir/procurar | não | 75% | filtros reais por voz ainda sem adapter |
| Produtor 360 | Sim | abrir/sincronizar contexto | não | 85% | navegação fina de seções ainda parcial |
| Visitas | Sim | abrir/preparar | write sim | 65% | criação/edição/conclusão completa por voz parcial |
| Preparar Visita | Sim | adapter canônico | persistência sim | 85% | UAT natural e físico pendente |
| Pós-visita | Sim | Voice Capture existente | sim | 55% | “terminei a visita” não orquestra todo o lifecycle realtime |
| Oportunidades | Sim | abrir módulo/contexto | write sim | 60% | filtro, seleção e update específicos incompletos |
| Agronomia | Sim | abrir ferramentas | técnico conforme ação | 75% | seleção de propriedade/talhão por voz parcial |
| Análise de solo | Sim | abrir/analisar | revisão técnica | 80% | UAT físico de arquivo/voz pendente |
| Mapeamento | Sim | abrir | write sim | 70% | edição geométrica por voz não implementada |
| Diagnóstico | Sim | abrir/analisar anexo | revisão técnica | 75% | navegação multimodal física pendente |
| NutriScan | Sim | adapter existente | revisão técnica | 75% | UAT realtime + foto pendente |
| FitoScan | Sim | adapter existente | revisão técnica | 75% | UAT realtime + foto pendente |
| 9 calculadoras | Sim | execução canônica | inputs materiais | 90% | UAT de tool call por voz pendente |
| Mercado/commodities | Sim | provider atual | não | 90% | latência física e continuidade com cliente pendentes |
| Conhecimento/Manual/Biblioteca | Sim | retrieval governado | safety | 80% | navegação direta por seção parcial |

## Interpretação

- PASS de código: operação possui contrato e teste automatizado.
- PARTIAL: a leitura existe, mas nem todo o write/lifecycle tem adapter de voz.
- UAT físico continua obrigatório para Continuous Voice, VAD, barge-in, áudio, câmera e percepção de naturalidade.
