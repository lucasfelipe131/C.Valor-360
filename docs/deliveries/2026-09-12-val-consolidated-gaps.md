# Correções consolidadas da VAL — 12 de setembro de 2026

Escopo autorizado: os 12 ajustes do pedido consolidado e o complemento de venda de valor do requisito 6. Não inicia as etapas futuras chamadas Passo 7 a 12.

## Estado por requisito

| # | Implementação e evidência | Limitação / pendência |
|---|---|---|
| 1 | Saída para áreas globais limpa produtor ativo, cabeçalho e contexto da VAL. Cancela voz/respostas atrasadas. Histórico permanece para retomada explícita. Testes reais dos componentes App/Copilot em estados desktop/mobile. | Conferência autenticada com o cadastro real ainda pendente. |
| 2 | Entrada Inteligência do workspace encaminha ao copiloto do produtor, em vez do destino padrão Início. | Conferência visual autenticada pendente. |
| 3 | Início reutiliza SatelliteMap, propriedades canônicas e pins com nomes. Pin abre a propriedade; nome abre o produtor. Mapa permanece disponível sem pins. Roteiro reúne sugestões e agendamentos do dia; detalhes adicionais ficam recolhidos. | Sem localização cadastrada não há pin inventado; visita com várias propriedades exige escolha do destino. |
| 4 | Uma foto JPEG/PNG por produtor, com exibição e substituição. Conversão no navegador, limite 250 KB no servidor, tabela por tenant/tipo/entidade e autorização por carteira. Persistência e isolamento testados em PostgreSQL embarcado. | Upload real e comportamento do seletor de imagem no iPhone não conferidos. |
| 5 | Meu perfil em Configurações permite editar o próprio nome e foto. Foto separada do produtor; atualização de sessão após salvar. Integration 01 não foi alterado. | Apenas nome e foto são editados nesta entrega. Imagem exibida no editor do perfil. |
| 6 | Preparação combina evidências, próximo passo, pauta, resultado, três perguntas contextuais e pontos de registro. Recuperação útil quando a IA falha. Motor comercial existente fornece condução de problema/impacto/alternativas/valor, dados econômicos explícitos e defesa de valor antes do desconto. Resposta nova do consultor entra como relato atribuído, sem virar visita confirmada. Corrigida perda de relato na pergunta que combina visita e custo. | Teste sintético com comparação de custo e resposta de objeção passou; geração real por modelo, respostas indiretas sem referência à visita e registros reais de Genor não foram avaliados. Não se afirma que toda resposta terá qualidade de um agrônomo experiente. |
| 7 | Lateral recolhida libera toda a largura; botão Menu permite reabrir. CSS de margens e mínimos de largura corrigido; mapa mantém ResizeObserver. | Não foi possível reproduzir visualmente maximização/tela cheia interna no ambiente autenticado. Causa exata do corte verbalmente relatado ainda exige essa validação. |
| 8 | Consulta factual direta para área por cultura/safra e hobby, incluindo relatos; mantém declarações e períodos separados, não soma sobreposições e informa ausência. Corrigido reconhecimento de nomes em “quantos hectares X planta” e “hobby de X”. Mesma resposta fundamentada no envelope de voz. | Cobertura nova concentra-se em área/culturas/hobby; não demonstra ainda consulta universal de todo campo e narrativa. Genor/Antônio/Matheus foram fixtures, não cadastros reais. Sem áudio real. Latência medida foi HTTP local sem modelo, não ponta a ponta em produção. |
| 9 | Explicações gerais podem ter profundidade maior; catálogo e mecanismos de governança existentes preservados. Testes existentes cobrem conceitos, marca, variantes, fontes ausentes e continuidade técnica. | Não foi integrada atualização automática de bulas/fontes oficiais. Comparações atuais dependem de fonte verificável disponível. Qualidade técnica com modelo real ainda pendente. |
| 10 | Mantida separação entre dados do produtor e referência de mercado, com fonte, data e estado de atualidade da SOG. | Não há novo feed automático de grãos. Dados atuais dependem de snapshots autorizados válidos já disponíveis na SOG. Não se declara consulta externa atual funcionando sem essa fonte; nenhum serviço pago foi contratado. |
| 11 | Sugestões sem visitas cadastradas a partir de compromissos e relatos. Distingue hoje/vencido/sem data, exclui futuros/concluídos/cancelados, atualiza por foco/refresh. Reutiliza ordenação por proximidade da tarefa de mapas, dentro da prioridade, com revisão manual da sequência. Não cria visitas nem envia mensagens. | Proximidade é geométrica, não rota por estrada; disponibilidade e tempo de viagem não confirmados. Linguagem relativa (“próxima semana”) permanece sem data inferida. Resolução narrativa sem vínculo inequívoco pode exigir confirmar situação; atualização canônica de compromisso é preferível. |
| 12 | Retorno com destino no cabeçalho; histórico interno guarda página, produtor, aba, propriedade e rolagem. Busca/filtros de Clientes e posição do mapa preservados por sessão. Testes Gestão → Relatórios → voltar e troca A → B → voltar passaram em estados desktop/mobile. Editores de perfil, safra e mapeamento protegem a saída durante edição/salvamento. | Não há auditoria completa de perda de alterações em todos os formulários legados; validação visual dos fluxos propriedade/detalhes em tela pequena permanece pendente. |

## Coordenação

O trabalho anterior foi preservado no commit f3ebb49. A branch `feature/val-roadmap-management-v1` da tarefa de mapas foi integrada no commit 823df83; base compartilhada 918acbb. Durante a publicação, o staging avançou para 9335181 com correções de navegação e cotações antigas. Essas mudanças foram integradas e novamente verificadas. Componentes e algoritmo de rota existentes foram reutilizados; não foi criado outro motor comercial nem outro mapa.

O recurso `send_message_to_thread` não está exposto nesta sessão. Portanto, não foi possível enviar o relatório à origem 01a09684-f245-7412-b92c-281ee3bca3c4 nem consultar diretamente o estado vivo da tarefa 6a9e0b5c-4794-83e9-8741-074a48cffcd0. A coordenação técnica foi feita pelas branches compartilhadas.

## Verificação

- Suíte antes da integração concorrente: 1.835 testes aprovados. Após integrar 9335181: 1.839 de 1.840 aprovados na primeira rodada; o único erro foi readiness enquanto o build ainda atualizava o carimbo de versão. Com o build terminado, o teste de readiness passou. A CI valida o conjunto novamente de forma sequencial.
- Build Vite/PWA concluído.
- Integração de fotos e sugestões: banco PGlite com migrations do projeto, incluindo a nova tabela de fotos.
- Preparação HTTP: histórico longo, troca de combinado, isolamento de produtores, objeção de preço, falta de custo da alternativa e nova resposta do consultor. Asserções sobre conteúdo e ausência de números inventados, além dos títulos.
- Fatos HTTP: área de milho de Genor TEST, hobby em relato e soja de Matheus TEST, com alvo anterior diferente; resposta e envelope de voz conferidos. Medições locais observadas aproximadamente 16–90 ms; isso não mede transcrição, geração de fala, rede externa ou modelo em staging.
- Testes de navegação usam App e Copilot reais com fronteiras do navegador/serviços simuladas. Não são teste visual de dispositivos físicos.
- Navegador disponível abriu a página pública do staging, mas não havia sessão autenticada. Prévia local foi bloqueada pelo navegador (`ERR_BLOCKED_BY_CLIENT`). Nenhuma credencial foi inventada ou obtida fora do fluxo de autenticação.
- Não foram acessados os registros reais dos produtores nem confirmada a grafia no cadastro. Datas relatadas verbalmente não foram convertidas em fatos.

Esta entrega implementa correções verificáveis, mas não declara os 12 requisitos integralmente validados. Permanecem as pendências explicitadas acima, especialmente fontes atuais, cobertura universal de consulta e validação real de voz/layout.
