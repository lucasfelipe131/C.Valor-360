# Visão gerencial e propriedades no roteiro

O roteiro mostra todas as propriedades da carteira autenticada, inclusive em dias sem visitas. Cada pin usa a localização cadastrada e identifica produtor e propriedade. A lista informa propriedades sem localização; não há geocodificação automática nem coordenadas demonstrativas como substituição. Dados explicitamente demonstrativos recebem a identificação DEMO. A consulta é única por carteira, com cancelamento ao trocar de usuário.

## Acesso gerencial

Em Administração, crie o perfil **Gerencial BI (consulta)**, cadastre a unidade e vincule o gestor e os consultores à mesma unidade. Nenhum vínculo é criado pela migração. Administradores e gestores existentes também podem abrir **Gestão → Visão gerencial**, desde que estejam vinculados a uma unidade.

O perfil `bi_viewer` recebe uma tela própria, sem carteira operacional ou Copiloto. O servidor bloqueia os demais endpoints operacionais e o proxy do Manual. Sessão, saída e troca da própria senha continuam disponíveis. Apenas administradores configuram unidades; cada alteração de vínculo gera auditoria.

As leituras validam organização, papel atual e unidade no PostgreSQL, em uma transação de leitura consistente. Unidades têm chave composta por organização; vínculos não atravessam organizações. O filtro de consultor só aceita membros da unidade. Sem unidade, o servidor retorna um estado de configuração vazio. Mudar a unidade de um consultor muda a carteira atual exibida; esta versão não reconstrói lotações históricas.

## Indicadores e bases

- Visitas: período pela data ocorrida/concluída, ou data agendada quando ainda não realizada; horário de Brasília. Filtros por consultor, município cadastrado e situação.
- Produtores: carteira ativa atual da unidade e dos filtros de consultor/município. Área e culturas ausentes permanecem ausentes. O período não filtra a data de cadastro dos produtores.
- Relatórios: última revisão confirmada do relato de cada visita; extrações e revisões pendentes não entram como evidência.
- Deslocamentos: somente traços GPS já registrados; filtros de período e consultor. Distância e duração são derivados dos segmentos consecutivos, sem ligar interrupções maiores que 120 segundos. Não representam jornada de trabalho, duração das visitas ou quilometragem por município. Sem segmentos válidos, o resultado é ausente, não zero.

Produtores DEMO ficam fora dos indicadores gerenciais. Não são criados fatos, contextos de IA, oportunidades ou metas automaticamente. Limites: período de até 366 dias e 5.000 registros por base; excedentes retornam erro para refinar a consulta, sem totais parciais silenciosos.

## Power BI

As abas exportam CSV UTF-8 com BOM, nomes estáveis de colunas, IDs para relacionar produtor/consultor/unidade e status de origem. Exportar relatórios inclui apenas visitas com relatos confirmados. Textos são escapados e neutralizados contra fórmulas em planilhas.

O arquivo pode ser aberto pelo conector [Texto/CSV do Power Query](https://learn.microsoft.com/en-us/power-query/connectors/text-csv). Esta versão não publica datasets, configura atualização agendada nem incorpora um relatório Microsoft Power BI. A próxima etapa pode conectar essas mesmas bases a um modelo de BI com autenticação, atualização e segurança por unidade.

## Validação

`test/management.test.js` executa o esquema e as migrações reais em PostgreSQL embarcado, com organizações, unidades e usuários sintéticos isolados. Cobre isolamento, papel revogado, vínculos, auditoria, filtros, exclusão de DEMO, relatos confirmados e ausência de GPS. Os testes montados do roteiro cobrem múltiplas propriedades do mesmo produtor, dias vazios, buscas, legendas seguras e respostas antigas após troca de carteira.
