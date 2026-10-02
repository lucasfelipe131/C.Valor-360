# K5 — proteção adicional de assunto

Base: d7fcc6f3438914f512de2e0e67cd8f7c41496ffe, publicado pela execução de remediação anterior no PR #107.

Na revisão offline foi reproduzido um falso aceite: a pergunta "População maior sempre compensa um plantio atrasado de milho?" podia receber "A fotossíntese transforma energia luminosa em energia química." O matcher antigo retorna true quando sua lista de anchors discriminantes está vazia; isso não é prova positiva de assunto para a nova exceção lexical.

A exceção agora exige ao menos um anchor material. Quando o conjunto discriminante está vazio, usa a extração mais ampla já existente para cobertura curada, mantendo a exigência de TODOS os anchors. O wrapper booleano legado e todas as barreiras de safety, escopo, provenance e temporalidade permanecem intactos. Nenhum ID de caso ou resposta esperada é usado em produção.

A regressão reproduz o falso aceite antes da correção, prova o bloqueio depois e preserva a resposta pertinente sobre população e plantio. As regressões da remediação anterior foram preservadas. Testes focados: 77/77 PASS. A suíte completa também é exigida na CI Linux: a execução local Windows encontrou testes de interface com caminhos POSIX incompatíveis e ausência de ffmpeg, sem equivalência a prova física.

Nenhuma chamada faturável foi executada nesta correção. PR permanece DRAFT; sem main, produção, secrets, merge ou Passo 07.
