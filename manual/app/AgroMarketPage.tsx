"use client";

import { useEffect, useMemo, useState } from "react";

type MarketQuote = {
  symbol: string;
  name: string;
  unit: string;
  date: string;
  time: string;
  change: number | null;
  changePercent: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  source: string;
};

type NewsItem = {
  title: string;
  link: string;
  publishedAt: string;
  source: string;
  topic: "Mercado" | "Fertilizantes" | "Agro";
};

type AgroFeed = {
  updatedAt: string;
  markets: MarketQuote[];
  news: NewsItem[];
  notices: {
    markets: string;
    fertilizers: string;
  };
};

type NewsFilter = "Todos" | NewsItem["topic"];

const sourceLinks = [
  {
    name: "Notícias Agrícolas",
    description: "Notícias, análises e cotações do agronegócio.",
    href: "https://www.noticiasagricolas.com.br/",
  },
  {
    name: "CME Group",
    description: "Contratos e especificações oficiais de grãos em Chicago.",
    href: "https://www.cmegroup.com/markets/agriculture/grains.html",
  },
  {
    name: "ANDA",
    description: "Indicadores e informações do setor de fertilizantes.",
    href: "https://anda.org.br/",
  },
];

function quoteNumber(value: number | null) {
  if (value === null) return "Indisponível";
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function dateTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Data não informada"
    : new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
}

export default function AgroMarketPage() {
  const [feed, setFeed] = useState<AgroFeed | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [filter, setFilter] = useState<NewsFilter>("Todos");

  async function loadFeed() {
    setStatus("loading");
    try {
      const response = await fetch("/api/agro", { cache: "no-store" });
      if (!response.ok) throw new Error(`Falha ${response.status}`);
      setFeed((await response.json()) as AgroFeed);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }

  useEffect(() => {
    void loadFeed();
  }, []);

  const visibleNews = useMemo(
    () =>
      feed?.news.filter((item) => filter === "Todos" || item.topic === filter) ??
      [],
    [feed, filter],
  );

  return (
    <>
      <div className="page-heading market-heading">
        <span className="eyebrow">MERCADO E INFORMAÇÃO</span>
        <h1>Agro agora</h1>
        <p>
          Chicago, fertilizantes, insumos e notícias recentes reunidos com data
          e fonte para consulta.
        </p>
        <button className="button secondary" onClick={() => void loadFeed()}>
          {status === "loading" ? "Atualizando…" : "Atualizar dados"}
        </button>
      </div>

      <section className="market-quote-section">
        <div className="section-heading compact">
          <div>
            <span className="eyebrow">COMMODITIES</span>
            <h2>Referências de Chicago</h2>
          </div>
          {feed?.updatedAt && (
            <small>Atualizado {dateTime(feed.updatedAt)}</small>
          )}
        </div>
        <div className="market-quote-grid">
          {status === "loading" &&
            ["Soja", "Milho", "Trigo"].map((name) => (
              <article className="market-quote-card loading-card" key={name}>
                <span>{name}</span>
                <strong>Carregando…</strong>
              </article>
            ))}
          {feed?.markets.map((quote) => (
            <article className="market-quote-card" key={quote.symbol}>
              <div>
                <span>{quote.symbol}</span>
                <small>{quote.source}</small>
              </div>
              <h3>{quote.name}</h3>
              <strong>{quoteNumber(quote.close)}</strong>
              <b>{quote.unit}</b>
              {quote.changePercent !== null && (
                <span
                  className={
                    quote.changePercent >= 0
                      ? "market-change positive"
                      : "market-change negative"
                  }
                >
                  {quote.changePercent >= 0 ? "+" : ""}
                  {quoteNumber(quote.changePercent)}% ·{" "}
                  {quote.change !== null
                    ? `${quote.change >= 0 ? "+" : ""}${quoteNumber(
                        quote.change,
                      )} cents`
                    : ""}
                </span>
              )}
              <div className="market-range">
                <span>
                  Mín. <b>{quoteNumber(quote.low)}</b>
                </span>
                <span>
                  Máx. <b>{quoteNumber(quote.high)}</b>
                </span>
              </div>
              <small>
                Sessão {quote.date || "não informada"}{" "}
                {quote.time ? `· ${quote.time}` : ""}
              </small>
            </article>
          ))}
        </div>
        <small className="legal-note market-note">
          {feed?.notices.markets ??
            "As cotações serão exibidas somente quando a fonte responder."}
        </small>
      </section>

      <section className="content-panel news-panel">
        <div className="news-toolbar">
          <div>
            <span className="eyebrow">NOTÍCIAS DO AGRO</span>
            <h2>O que movimenta o mercado</h2>
          </div>
          <div className="news-filters" aria-label="Filtrar notícias">
            {(["Todos", "Mercado", "Fertilizantes", "Agro"] as NewsFilter[]).map(
              (item) => (
                <button
                  key={item}
                  className={filter === item ? "active" : ""}
                  onClick={() => setFilter(item)}
                >
                  {item}
                </button>
              ),
            )}
          </div>
        </div>

        {status === "error" && (
          <div className="feed-empty">
            <strong>Não foi possível atualizar as notícias agora.</strong>
            <p>
              As fontes abaixo continuam disponíveis para consulta direta; o
              sistema não exibirá notícia antiga como se fosse atual.
            </p>
          </div>
        )}

        {status === "ready" && !visibleNews.length && (
          <div className="feed-empty">
            <strong>Nenhuma notícia recente neste filtro.</strong>
            <p>Tente outra categoria ou atualize os dados.</p>
          </div>
        )}

        <div className="news-list">
          {visibleNews.map((item) => (
            <a
              href={item.link}
              target="_blank"
              rel="noreferrer"
              className="news-row"
              key={`${item.link}-${item.title}`}
            >
              <span className={`news-topic ${item.topic.toLowerCase()}`}>
                {item.topic}
              </span>
              <div>
                <h3>{item.title}</h3>
                <p>
                  {item.source} · {dateTime(item.publishedAt)}
                </p>
              </div>
              <b aria-hidden="true">↗</b>
            </a>
          ))}
        </div>
        <small className="legal-note market-note">
          {feed?.notices.fertilizers ??
            "O mercado de insumos será mostrado por fontes recentes, sem preços estimados."}
        </small>
      </section>

      <section className="source-directory">
        {sourceLinks.map((source) => (
          <a
            key={source.name}
            href={source.href}
            target="_blank"
            rel="noreferrer"
          >
            <strong>{source.name}</strong>
            <span>{source.description}</span>
            <b>Consultar fonte ↗</b>
          </a>
        ))}
      </section>
    </>
  );
}
