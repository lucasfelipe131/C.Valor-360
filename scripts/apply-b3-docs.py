from pathlib import Path

path=Path('docs/VAL_ENGINE.md')
source=path.read_text()
marker='## API da VAL\n'
addition='''## Estado assíncrono compartilhado no frontend

`src/hooks/useAsyncResource.js` é a fonte única para o contrato `{loading, data, error}` das leituras principais. O hook cancela a solicitação anterior, impede que uma resposta atrasada substitua dados mais novos, aplica o orçamento de tempo definido pela tela e normaliza timeout, cancelamento e falha real. A leitura de JSON e o tratamento de sessão expirada também ficam centralizados.

As telas `ValPanel`, `ValDecisionWorkspace`, `SogWorkspace`, `AccessManagement` e `ProducerBusinessOverview` usam esse contrato. Estados de mutação, como salvar formulário, alterar acesso ou enviar feedback, continuam separados porque representam uma ação diferente do carregamento da página.

Cada recurso mantém sua própria mensagem e seu próprio orçamento de tempo, mas usa a mesma mecânica de cancelamento e erro. O timeout precisa ser definido ao declarar o recurso, e não diretamente em chamadas `fetch` dispersas pelo componente.

'''
if source.count(marker)!=1:
    raise RuntimeError('marcador da API não encontrado de forma única')
path.write_text(source.replace(marker,addition+marker,1))
