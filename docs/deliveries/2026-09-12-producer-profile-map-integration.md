# Perfil integrado e marcadores de propriedades

Quatro ajustes autorizados na tarefa Desenho Guia Produtor VAL.

- Rótulos de mapa compartilhados por Início e roteiro: uma linha, 10 px no desktop e 9 px em telas pequenas, reticências e supressão de colisões por posição na tela. O nome completo do produtor e a propriedade permanecem no título acessível do marcador e no cartão selecionado. Os pontos não são deslocados para evitar colisões. Um toque em pins sobrepostos abre a escolha das propriedades próximas, com produtor e propriedade completos; lista e zoom continuam disponíveis.
- Miniatura: foto da propriedade, depois foto do produtor. Falhas de ambas retornam ao pin padrão. URLs de imagens usam exclusivamente os endpoints protegidos do cadastro; não há imagens inventadas, busca por nome ou fotos de outros produtores.
- O cadastro de fotos de propriedades reutiliza ProfileEditor, conversão, limites, tabela val_profile_photos e autorização por carteira da entrega concorrente de fotos. A migration 014 amplia o tipo de entidade da tabela existente. Sem segundo uploader, blobs duplicados na resposta da carteira ou migração de fotos do consultor. A leitura binária autentica cada acesso e responde private/no-store.
- Ver produtor no roteiro abre a visão geral do perfil com os IDs do produtor e da propriedade preservados. Data, filtro, seleção, visualização e distância de sugestões ficam no estado da sessão ativa da aplicação; o mapa reutiliza o armazenamento de centro/zoom por usuário. O retorno não reinicia GPS. Centro e zoom restaurados são preservados mesmo quando os pins chegam depois, por uma consulta assíncrona; Enquadrar continua funcionando por ação explícita.
- Cadastro ganha uma aba explícita. A aba Comercial incorpora o ValDecisionWorkspace existente, incluindo análise direta/estratégica, etapas, evidências, feedback, preparação e laboratório ValPanel. Os indicadores e registros comerciais existentes continuam disponíveis. VAL Insumos passa a selecionar um produtor para abrir esse mesmo perfil; análise avançada das visitas abre a aba Comercial. VAL Grãos/SOG continua funcional.

## Coordenação

Base inicial 379b34d inclui as fotos e os doze ajustes da tarefa Corrigir gaps da VAL e as correções do motor de Claude. Incorporada também a atualização b9b67c2/PR104 de sugestões compactas da página inicial, sem conflitos. Não foram alterados o motor comercial, VAL CORE, main ou PR95. Publicação autorizada exclusivamente no serviço val-web-staging, branch claude/continuacao-correcao-val-wiogh7.

A ferramenta send_message_to_thread não está exposta nesta sessão. Não foi possível enviar diretamente a atualização à origem 01a09684-f245-7412-b92c-281ee3bca3c4. A coordenação usou a base compartilhada e este registro de entrega.

## Validação efetiva

- Build Vite/PWA concluído, seguido de 1.854 testes aprovados após integrar b9b67c2.
- Banco PostgreSQL embarcado executando o schema e todas as migrations: persistência e remoção de foto de propriedade; isolamento entre propriedades, produtores, carteiras e tenants; foto do produtor preservada; resposta do roteiro contém URLs, sem duplicar os blobs.
- Componentes reais: pin/seleção, IDs e retorno, cadastro/comercial, navegação desktop/mobile, guardas de alterações não salvas, edição de talhões, CAR/KML e conservação de estado/GPS.
- Chromium com viewports de 1440 e 390 px, dados sintéticos apenas interceptados localmente: cinco propriedades de três produtores, duas propriedades de um mesmo produtor, três miniaturas carregadas, pin sem imagem, erro de imagem com e sem alternativa, quatro escalas de zoom por tela sem sobreposição dos rótulos visíveis. Sem erros JavaScript ou overflow horizontal. Também verificado toque real em pin padrão, pin com imagem indisponível e região sobreposta com miniatura, seguido da escolha exata da propriedade. Ver produtor → Comercial → análise direcionada ao produtor correto → laboratório → propriedade correta → Cadastro → retorno ao roteiro aprovado.
- Nenhum fixture foi inserido no staging. As imagens usadas no navegador foram fixtures de teste, não fotos de produtores reais. Não houve conferência em iPhone físico, upload autenticado real nem validação dos tiles externos de satélite (indisponíveis no ambiente local). O backend de fotos foi testado no banco embarcado; a qualidade das respostas do modelo não foi reavaliada por esta mudança de navegação/layout.

O estado do deploy deve ser confirmado pelo SHA em /ready e pelo resultado de implantação no Railway; alteração de código por si só não comprova publicação.
