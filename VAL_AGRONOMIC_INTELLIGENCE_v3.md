# VAL Agronomic Intelligence v3

## Direção de produto

A Inteligência Agronômica permanece uma página própria da VAL e conserva o layout aprovado. A evolução v3 torna explícida a escolha central: usar uma ferramenta especializada ou conversar com a VAL por voz, texto, foto ou arquivo, sem criar uma segunda plataforma nem copiar o layout do Manual.

## Arquitetura preservada

A página continua composta por hub nativo da VAL e workspace técnico embutido, same-origin. Domain logic, ferramentas e conhecimento do Manual são reutilizados; navegação, hierarquia e conversa pertencem à experiência VAL.

As cinco seções permanecem:

1. **Campo e Solo** — análises de solo, propriedades, talhões, culturas, mapas e histórico.
2. **Diagnóstico** — foto, observações, diagnóstico e histórico técnico.
3. **Decisão Técnica** — calculadoras, bulas, registros e ferramentas de decisão.
4. **Contexto** — mercado, commodities, clima e panorama.
5. **Conhecimento** — Manual, Biblioteca, fontes e histórico aprovado.

Os títulos agora possuem número, eyebrow, título orientado à decisão, subtítulo curto e separação visual. Os módulos existentes não foram removidos; continuam acessíveis por cards e drill-down.

## Hero operacional

O hero oferece quatro CTAs reais:

- `Falar com a VAL`: captura local, estado de gravação, parar, cancelar e entrega ao adapter.
- `Digitar / perguntar`: composer local e envio imediato.
- `Foto`: câmera/biblioteca, validação e intenção de diagnóstico.
- `Arquivo`: documentos técnicos, validação e intenção provável.

Os CTAs compartilham estados, erro acessível, sucesso, loading e telemetria mínima. Contexto material aparece sem poluir a tela. Em mobile, a grade reduz ações, mantém alvos de toque e composer a 16 px; em desktop, preserva a visão simultânea de propósito e entradas.

## Contexto e conversa

Produtor, propriedade, talhão e análise podem entrar por props explícitas ou contexto da página. A ação usa `ASK` e `persistenceMode=NONE`; conversa não equivale a memória. O componente não pergunta novamente por entidades já presentes no contrato e não inventa produtor quando a página abre sem contexto.

Arquivos recebidos da conversa podem aparecer como `initialFiles`, mas permanecem locais até confirmação explícita. Sem produtor, continuam sem vínculo. Vínculo, registro ou promoção de memória pertencem ao fluxo governado fora do hero.

## Orquestração de ferramentas

O Copilot pode fornecer `initialTool`. O adapter normaliza o descritor e abre o workspace existente:

| Intenção/alias | Ferramenta Manual | Página |
|---|---|---|
| mapeamento, `AREA_MAPPING` | `mapping` | `produtores` |
| calculadora | `calculators` | `calculadoras` |
| análise de solo | `soil` | `solo` |
| diagnóstico por imagem | `diagnosis` | `diagnostico` |
| NutriScan | `diagnosis`, modo `nutrition` | `diagnostico` |
| FitoScan / alias FitScan | `diagnosis`, modo `disease` | `diagnostico` |

O comando `valor360:navigate` v1 carrega somente IDs/nomes permitidos de produtor, propriedade, talhão e análise. O receptor revalida o contexto no workspace e pode responder `APPLIED`, `PARTIAL` ou `CONTEXT_REJECTED`. Não há envio de tenant/owner, nem confiança em contexto apenas porque veio da UI.

## Safety e governança

- IA solicita e interpreta; Orchestrator autoriza e executa.
- Foto é triagem e hipótese, não diagnóstico confirmado.
- Dose, mistura, compatibilidade, bula e prescrição continuam sob revisão técnica.
- ASK, abertura de ferramenta e visualização não gravam memória.
- Arquivo não é vinculado nem persistido sem fluxo explícito.
- A página não cria migrations nem altera políticas de storage.
- O iframe e o protocolo de navegação exigem same-origin.

## Compatibilidade

O workspace preserva tela cheia, retorno ao hub, status de integração, carregamento e iframe técnico. Os cards atuais de solo, propriedades/talhões, diagnóstico, registros, calculadoras, bulas, mercado, clima, Manual e Biblioteca permanecem disponíveis.

Esta rodada não altera `App.jsx`, Global Copilot, Voice Capture ou server. O contrato foi desenhado para esses adapters consumirem `onAsk`, `onCapture`, `initialTool` e `initialFiles` sem reconstruir motores.

## Evidência e pendências

Há cobertura automatizada AGRO_HERO_001–010, testes puros de contexto/roteamento, SSR do hero e regressões do workspace/contexto implícito. A cobertura prova markup, contratos, validação e wiring em código.

Ainda não constitui prova física de:

- permissão e qualidade de microfone em aparelho real;
- câmera traseira, seletor nativo e cancelamento em todos os navegadores;
- viewport, teclado virtual e safe areas em hardware mobile;
- transcrição/TTS ponta a ponta no ambiente publicado;
- aplicação visual do ack do Manual em todos os módulos;
- enforcement cross-tenant completo, que depende também do Orchestrator e do receptor.

Esses itens devem permanecer parciais no gate até UAT autorizado. Nenhuma promoção para produção deve se apoiar apenas nos testes SSR/lógicos.
