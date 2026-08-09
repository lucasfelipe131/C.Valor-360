import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type NewsItem = {
  title: string;
  link: string;
  publishedAt: string;
  source: string;
  topic: "Mercado" | "Fertilizantes" | "Agro";
};

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

const rssFeeds = [
  {
    url:
      "https://news.google.com/rss/search?q=site%3Anoticiasagricolas.com.br%20%28soja%20OR%20milho%20OR%20trigo%20OR%20Chicago%29%20when%3A7d&hl=pt-BR&gl=BR&ceid=BR%3Apt-419",
    topic: "Mercado" as const,
    fallbackSource: "Notícias Agrícolas",
  },
  {
    url:
      "https://news.google.com/rss/search?q=%28fertilizantes%20OR%20insumos%20agr%C3%ADcolas%29%20Brasil%20when%3A14d&hl=pt-BR&gl=BR&ceid=BR%3Apt-419",
    topic: "Fertilizantes" as const,
    fallbackSource: "Mercado de insumos",
  },
  {
    url:
      "https://news.google.com/rss/search?q=agroneg%C3%B3cio%20Brasil%20when%3A7d&hl=pt-BR&gl=BR&ceid=BR%3Apt-419",
    topic: "Agro" as const,
    fallbackSource: "Notícias do agro",
  },
];

const marketSymbols = [
  {
    symbol: "ZS",
    name: "Soja",
    slug: "soja",
    unit: "¢/bushel",
  },
  {
    symbol: "ZC",
    name: "Milho",
    slug: "milho",
    unit: "¢/bushel",
  },
  {
    symbol: "ZW",
    name: "Trigo",
    slug: "trigo",
    unit: "¢/bushel",
  },
];

function decodeXml(value: string) {
  return value
    .replace(/^<!\[CDATA\[|\]\]>$/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function xmlValue(item: string, tag: string) {
  const match = item.match(
    new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"),
  );
  return match?.[1] ? decodeXml(match[1]) : "";
}

function parseRss(
  xml: string,
  topic: NewsItem["topic"],
  fallbackSource: string,
) {
  const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? [];
  return items.slice(0, 12).flatMap((item): NewsItem[] => {
    const title = xmlValue(item, "title");
    const link = xmlValue(item, "link");
    const publishedAt =
      xmlValue(item, "pubDate") || xmlValue(item, "dc:date");
    const source = xmlValue(item, "source") || fallbackSource;
    if (!title || !link) return [];
    return [{ title, link, publishedAt, source, topic }];
  });
}

async function loadNews() {
  const results = await Promise.allSettled(
    rssFeeds.map(async (feed) => {
      const response = await fetch(feed.url, {
        headers: {
          Accept: "application/rss+xml, application/xml, text/xml",
          "User-Agent": "Manual-do-Agronomo/1.0",
        },
        next: { revalidate: 900 },
      });
      if (!response.ok) throw new Error(`RSS ${response.status}`);
      return parseRss(
        await response.text(),
        feed.topic,
        feed.fallbackSource,
      );
    }),
  );

  const seen = new Set<string>();
  return results
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .filter((item) => {
      const key = item.title
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      const aTime = Date.parse(a.publishedAt) || 0;
      const bTime = Date.parse(b.publishedAt) || 0;
      return bTime - aTime;
    })
    .slice(0, 18);
}

function parseNumber(value: string | undefined) {
  if (!value || value === "N/D") return null;
  const parsed = Number(
    value
      .replace("%", "")
      .replace(/\./g, "")
      .replace(",", ".")
      .trim(),
  );
  return Number.isFinite(parsed) ? parsed : null;
}

async function loadMarketQuote(
  item: (typeof marketSymbols)[number],
): Promise<MarketQuote> {
  const url = `https://www.noticiasagricolas.com.br/cotacoes-mercado-futuro/${item.slug}`;
  const response = await fetch(url, {
    headers: { Accept: "text/html", "User-Agent": "Manual-do-Agronomo/1.0" },
    next: { revalidate: 900 },
  });
  if (!response.ok) throw new Error(`Cotação ${response.status}`);
  const html = await response.text();
  const table = html.match(/<div class="superior">([\s\S]*?)<\/table>/i)?.[1] ?? "";
  const rows = table.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
  const cells = (rows[1]?.match(/<td\b[^>]*>([\s\S]*?)<\/td>/gi) ?? []).map(
    (cell) => decodeXml(cell),
  );
  if (cells.length < 8) throw new Error("Tabela de cotação não reconhecida");
  const update =
    html.match(
      /Última Atualiza[cç][aã]o:\s*(\d{2}\/\d{2}\/\d{4})\s*(\d{2}:\d{2})/i,
    ) ?? [];
  return {
    symbol: item.symbol,
    name: `${item.name} · ${cells[0]}`,
    unit: item.unit,
    date: update[1] || "",
    time: update[2] || "",
    change: parseNumber(cells[2]),
    changePercent: parseNumber(cells[3]),
    close: parseNumber(cells[1]),
    open: parseNumber(cells[4]),
    high: parseNumber(cells[5]),
    low: parseNumber(cells[6]),
    source: "Notícias Agrícolas · CME Group",
  };
}

async function loadMarkets() {
  const results = await Promise.allSettled(marketSymbols.map(loadMarketQuote));
  return results.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
}

export async function GET() {
  const [news, markets] = await Promise.all([loadNews(), loadMarkets()]);
  return NextResponse.json(
    {
      updatedAt: new Date().toISOString(),
      markets,
      news,
      notices: {
        markets:
          "Cotações indicativas e possivelmente atrasadas. Confirme vencimento, unidade e preço executável antes de negociar.",
        fertilizers:
          "O mercado de fertilizantes é apresentado por notícias recentes; não há preço inventado nem tabela comercial fixa.",
      },
    },
    {
      headers: {
        "Cache-Control":
          "public, s-maxage=900, stale-while-revalidate=1800",
      },
    },
  );
}
