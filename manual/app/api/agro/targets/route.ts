import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADAPAR_BASE = "https://celepar07web.pr.gov.br/agrotoxicos/";
const TARGET_INDEX_URL = `${ADAPAR_BASE}facapesquisa.asp`;
const PRODUCT_SEARCH_URL = `${ADAPAR_BASE}resultadoPesquisa.asp`;
const CACHE_MS = 6 * 60 * 60 * 1000;

type OfficialTarget = {
  id: string;
  scientificName: string;
  commonNames: string;
  label: string;
  source: string;
};

const targetCache = globalThis as typeof globalThis & {
  manualAgronomoTargetIndex?: {
    expiresAt: number;
    promise: Promise<OfficialTarget[]>;
  };
};

function decodeEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (_, entity: string) => {
      if (entity.startsWith("#x")) {
        return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
      }
      if (entity.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(entity.slice(1), 10));
      }
      return named[entity.toLocaleLowerCase("pt-BR")] ?? `&${entity};`;
    },
  );
}

function plainText(value: string) {
  return decodeEntities(
    value
      .replace(/<br\s*\/?\s*>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

function normalized(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

async function responseText(response: Response) {
  const bytes = await response.arrayBuffer();
  const contentType = response.headers.get("content-type") ?? "";
  const decoder = /utf-?8/i.test(contentType)
    ? new TextDecoder("utf-8")
    : new TextDecoder("windows-1252");
  return decoder.decode(bytes);
}

async function loadTargets() {
  const current = targetCache.manualAgronomoTargetIndex;
  if (current && current.expiresAt > Date.now()) return current.promise;

  const promise = fetch(TARGET_INDEX_URL, {
    cache: "no-store",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "User-Agent": "Manual-do-Agronomo/1.0",
    },
    signal: AbortSignal.timeout(20_000),
  }).then(async (response) => {
    if (!response.ok) throw new Error(`ADAPAR_TARGETS_${response.status}`);
    const html = await responseText(response);
    const select = html.match(
      /<select\b[^>]*name=["']select9["'][^>]*>([\s\S]*?)<\/select>/i,
    )?.[1];
    if (!select) throw new Error("ADAPAR_TARGETS_PARSE");

    return Array.from(
      select.matchAll(/<option\b[^>]*value=["']?([^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/option>/gi),
    )
      .map((match) => ({ id: plainText(match[1]), label: plainText(match[2]) }))
      .filter((item) => item.id && item.id !== "null" && item.label)
      .map((item) => {
        const separator = item.label.indexOf(" - ");
        const scientificName = separator >= 0
          ? item.label.slice(0, separator).trim()
          : item.label;
        const commonNames = separator >= 0
          ? item.label.slice(separator + 3).trim()
          : "";
        return {
          ...item,
          scientificName,
          commonNames,
          source: `${ADAPAR_BASE}consultas/frm_con_AlvoBiologico.asp?CodAlvo=${encodeURIComponent(item.id)}&prt=com`,
        };
      });
  });

  targetCache.manualAgronomoTargetIndex = {
    expiresAt: Date.now() + CACHE_MS,
    promise,
  };
  promise.catch(() => {
    targetCache.manualAgronomoTargetIndex = undefined;
  });
  return promise;
}

function parseProducts(html: string) {
  const products = Array.from(html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi))
    .map((row) => {
      const cells = Array.from(
        row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi),
      ).map((cell) => plainText(cell[1]));
      if (cells.length < 4 || cells[0] === "Marca Comercial") return null;
      const linkMatch = row[1].match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/i);
      const rawLink = linkMatch ? decodeEntities(linkMatch[1]) : "";
      const source = rawLink && !rawLink.toLocaleLowerCase("pt-BR").startsWith("javascript:")
        ? new URL(rawLink, ADAPAR_BASE).toString()
        : "";
      return {
        name: cells[0],
        status: cells[1],
        toxicologicalClass: cells[2],
        registrant: cells[3],
        source,
      };
    })
    .filter((product): product is NonNullable<typeof product> => Boolean(product?.name));

  return products.sort((first, second) => {
    const rank = (status: string) => {
      const value = normalized(status);
      if (value === "liberado") return 0;
      if (value.startsWith("liberado com restricao")) return 1;
      if (value.includes("suspenso")) return 2;
      if (value.includes("cancelado")) return 3;
      return 2;
    };
    return rank(first.status) - rank(second.status) ||
      first.name.localeCompare(second.name, "pt-BR");
  });
}

async function loadProducts(target: OfficialTarget) {
  const form = new URLSearchParams({
    criterioAgrotoxico: "",
    criterioIngredienteAtivo: "",
    criterioRegistrante: "",
    criterioClassificacaoToxicologica: "",
    criterioPraga: target.label,
    criterioSituacao: "",
    criterioClasse: "",
    criterioCulturaInfestada: "",
    criterioExpurgo: "",
    criterioAplicacaoAerea: "",
    criterioTratamentoSementes: "",
    descIngrediente: "",
    select9: target.id,
    select11: "null",
    select6: "null",
    select1: "",
    select8: "null",
    select5: "null",
    select10: "null",
    select4: "null",
    submit1: "Pesquisar",
  });
  const response = await fetch(PRODUCT_SEARCH_URL, {
    method: "POST",
    cache: "no-store",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: TARGET_INDEX_URL,
      "User-Agent": "Manual-do-Agronomo/1.0",
    },
    body: form,
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`ADAPAR_PRODUCTS_${response.status}`);
  return parseProducts(await responseText(response));
}

export async function GET(request: NextRequest) {
  try {
    const targets = await loadTargets();
    const targetId = request.nextUrl.searchParams.get("id")?.trim();
    if (targetId) {
      const target = targets.find((item) => item.id === targetId);
      if (!target) {
        return NextResponse.json({ error: "Alvo não encontrado." }, { status: 404 });
      }
      const products = await loadProducts(target);
      return NextResponse.json({
        target,
        products,
        total: products.length,
        released: products.filter((item) => normalized(item.status).startsWith("liberado")).length,
        source: TARGET_INDEX_URL,
        consultedAt: new Date().toISOString(),
      });
    }

    const query = normalized(request.nextUrl.searchParams.get("q") ?? "");
    if (query.length < 2) {
      return NextResponse.json({ items: [], count: 0, totalTargets: targets.length });
    }
    const tokens = query.split(" ").filter(Boolean);
    const matches = targets.filter((target) => {
      const haystack = normalized(`${target.scientificName} ${target.commonNames}`);
      return tokens.every((token) => haystack.includes(token));
    });
    return NextResponse.json({
      items: matches.slice(0, 80),
      count: matches.length,
      totalTargets: targets.length,
      source: TARGET_INDEX_URL,
    });
  } catch (error) {
    console.error("agro:targets", error);
    return NextResponse.json(
      { error: "A base oficial de alvos não respondeu agora. Tente novamente em instantes." },
      { status: 502 },
    );
  }
}
