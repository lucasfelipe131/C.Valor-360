# VAL — Identidade Visual e Verbal

## 1. Marca

**Nome oficial:** VAL  
**Assinatura institucional:** Inteligência que gera valor.  
**Descrição funcional:** Inteligência comercial e agronômica aplicada.

A marca do produto deve aparecer somente como **VAL**. O nome anterior “VALOR 360” não deve ser utilizado em interfaces, materiais, títulos, ícones ou comunicações públicas.

## 2. Ideia central

A VAL conecta informações dispersas e transforma contexto em decisão. O símbolo representa dois caminhos — campo e inteligência — convergindo em um ponto de decisão. Os três nós representam:

1. contexto e evidências;
2. inteligência e interpretação;
3. decisão e geração de valor.

## 3. Personalidade

- Estratégica, sem ser fria.
- Agronômica, sem parecer uma marca de insumos.
- Tecnológica, sem recorrer ao visual genérico de robôs.
- Segura, clara e orientada à ação.
- Próxima do consultor e respeitosa com o produtor.

## 4. Paleta principal

| Token | Cor | Hex | Uso |
|---|---|---:|---|
| VAL Ink | Verde-grafite | `#071B19` | Fundos institucionais, sidebar e ícone |
| VAL Forest | Verde profundo | `#0E3530` | Superfícies escuras e gradientes |
| VAL Emerald | Esmeralda | `#00C896` | Ações, seleção e inteligência ativa |
| VAL Emerald Dark | Esmeralda escuro | `#009F78` | Texto de destaque e contraste em fundo claro |
| VAL Blue | Azul tecnológico | `#2D8CFF` | Dados, conexão e camadas de IA |
| VAL Lime | Lima | `#C8F25E` | Oportunidade, progresso e pontos de decisão |
| VAL Canvas | Branco esverdeado | `#F4F8F6` | Fundo principal |
| VAL Text | Verde-chumbo | `#10231F` | Texto principal |
| VAL Muted | Cinza orgânico | `#6C7F78` | Texto secundário |
| VAL Line | Cinza esverdeado | `#DCE8E4` | Bordas e divisores |

### Gradiente de inteligência

```css
linear-gradient(135deg, #009F78, #00C896 52%, #2D8CFF)
```

O gradiente deve ser reservado para ações prioritárias, seleção ativa e representações da inteligência da VAL.

## 5. Tipografia

**Interface e comunicação:** Manrope Variable.

- Títulos: peso 760–820, espaçamento negativo sutil.
- Texto: peso 450–600.
- Rótulos: peso 760–820, caixa alta e espaçamento amplo.
- Wordmark: `VAL` em peso 820, caixa alta e espaçamento de `0.19em`.

## 6. Sistema de logotipo

### Principal

Símbolo + wordmark **VAL** + assinatura “INTELIGÊNCIA QUE GERA VALOR”.

### Reduzido

Somente o símbolo, usado em:

- ícone PWA;
- avatar do produto;
- navegação móvel;
- favicon;
- carregamentos e espaços inferiores a 96 px.

### Área de proteção

Manter ao redor do logo uma distância mínima equivalente a um dos nós circulares do símbolo.

### Não fazer

- Não adicionar “360” ao nome.
- Não transformar o símbolo em folha isolada.
- Não aplicar sombras pesadas ou efeitos metálicos.
- Não usar verde agrícola genérico sem o azul tecnológico.
- Não distorcer, inclinar ou separar os caminhos do símbolo.
- Não usar a assinatura em tamanhos em que ela fique ilegível.

## 7. Linguagem

A VAL não se apresenta como chatbot. Ela se apresenta como inteligência aplicada ao negócio.

### Mensagem principal

> O contexto certo muda a conversa. A decisão certa muda o resultado.

### Estrutura recomendada

- Situação: o que está acontecendo.
- Evidência: quais dados sustentam a leitura.
- Implicação: por que isso importa.
- Próxima ação: o que o consultor deve fazer agora.

### Vocabulário preferencial

Contexto, decisão, evidência, oportunidade, relacionamento, campo, potencial, ação, valor, confiança e prioridade.

### Evitar

Mágica, resposta perfeita, certeza absoluta, robô, algoritmo infalível e recomendação automática sem validação.

## 8. Aplicação no produto

- A sidebar usa VAL Ink e o gradiente de inteligência somente no item ativo.
- A tela de acesso é a principal expressão institucional da marca.
- Cards permanecem claros para favorecer leitura e produtividade.
- Verde sinaliza ação e inteligência ativa; azul sinaliza conexão e dados; lima sinaliza oportunidade.
- Estados críticos continuam usando cores semânticas de segurança e não devem ser convertidos para a paleta da marca.
- Componentes devem manter contraste mínimo WCAG AA e foco visível.

## 9. Compatibilidade da migração

Chaves internas com prefixo `valor360` podem permanecer temporariamente para preservar sessões, cache e dados locais. Elas não fazem parte da marca pública. A remoção deve ocorrer somente por migração versionada, com leitura dos identificadores antigos e gravação segura nos novos.
