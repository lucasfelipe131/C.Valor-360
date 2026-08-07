# VALOR 360

Plataforma de inteligência comercial e agronômica para gerar valor em cada relação.

## Conceito
**Cliente 360 + Inteligência Agronômica + VAL**

A **VAL (Value Agriculture Intelligence)** é o cérebro do projeto.

## Interface
O frontend foi criado para seguir a identidade aprovada:
- ícone **C** como assinatura;
- nome **VALOR 360**;
- azul-marinho, azul vivo e branco;
- verde reservado para valor, resultado e oportunidade;
- layout responsivo para desktop e iPhone.

## Dados incorporados
Esta versão já usa as respostas existentes da planilha **Projeto Produtor 360 – C.Vale** para montar a base inicial de clientes, perfis, IRT, NPS e preferências.

## Rodar localmente
```bash
npm install
npm run dev
```

## Publicar na Railway
1. Suba este projeto para o repositório GitHub.
2. Na Railway, escolha **New Project → Deploy from GitHub Repo**.
3. Selecione o repositório.
4. A Railway reconhecerá `railway.json`.
5. Gere o domínio público.

## Build
```bash
npm run build
npm run start
```

## Estrutura
- `src/` frontend React
- `src/data/` dados atuais do Produtor 360
- `database/schema.sql` modelo inicial PostgreSQL
- `docs/ARCHITECTURE.md` visão técnica
- `railway.json` configuração de deploy

## Estado
**Alpha 0.2 — frontend navegável**
