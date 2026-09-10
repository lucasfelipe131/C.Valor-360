import { NextRequest, NextResponse } from "next/server";
import { sessionFromRequest } from "../../../lib/access";
import { BRAZIL_UFS, queryCarAtPoint, querySigefTenureAtPoint, mergeSigefSources, validGeoBounds } from "../../../lib/official-geodata";
import { officialBoundaryCache } from "../../../lib/official-boundary-cache";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await sessionFromRequest(request);
    if (!session) return NextResponse.json({ error: "Sessão expirada." }, { status: 401 });

    const latitude = Number(request.nextUrl.searchParams.get("lat"));
    const longitude = Number(request.nextUrl.searchParams.get("lng"));
    const uf = String(request.nextUrl.searchParams.get("uf") ?? "").toUpperCase();
    if (!request.nextUrl.searchParams.get("lat")?.trim() || !request.nextUrl.searchParams.get("lng")?.trim() || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
        !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      return NextResponse.json({ error: "Coordenada inválida." }, { status: 400 });
    }
    if (!BRAZIL_UFS.has(uf)) {
      return NextResponse.json({ error: "Informe uma UF brasileira válida antes da consulta." }, { status: 400 });
    }

    const rawBounds = request.nextUrl.searchParams.get("bbox");
    const bounds = rawBounds === null ? undefined : rawBounds.split(",").map(Number);
    if (bounds && (!validGeoBounds(bounds) || longitude < bounds[0] || longitude > bounds[2] || latitude < bounds[1] || latitude > bounds[3])) {
      return NextResponse.json({error:"Aproxime o mapa para consultar uma área válida."}, {status:400});
    }
    const viewport = bounds && validGeoBounds(bounds) ? bounds : undefined;
    const source=request.nextUrl.searchParams.get('source');
    if(source&&!['car','sigef-particular','sigef-publico'].includes(source))return NextResponse.json({error:'Camada inválida.'},{status:400});
    const refresh=request.nextUrl.searchParams.get('refresh')==='1';
    const point={lat:latitude,lng:longitude};
    const extent=viewport?`viewport:${viewport.map(value=>value.toFixed(7)).join(',')}`:`point:${latitude},${longitude}`;
    const queryCar=()=>officialBoundaryCache.query(`car:${uf}:${extent}`,()=>queryCarAtPoint(point,uf,fetch,viewport),{refresh});
    const querySigef=(tenure:'particular'|'publico')=>officialBoundaryCache.query(`sigef-${tenure}:${uf}:${extent}`,()=>querySigefTenureAtPoint(point,uf,tenure,fetch,viewport),{refresh});
    if(source){
      const item=source==='car'?await queryCar():await querySigef(source==='sigef-particular'?'particular':'publico');
      const isCar=source==='car';
      return NextResponse.json({sourceKey:source,point,uf,bounds:viewport,scope:viewport?'viewport_reference':'containing_point',queriedAt:item.queriedAt,cache:item.cache,result:{...item.result,queriedAt:item.queriedAt,source:isCar?'SICAR · Consulta Pública do CAR':'SIGEF/INCRA · Acervo Fundiário',sourceUrl:isCar?'https://consultapublica.car.gov.br/publico/imoveis/index':'https://acervofundiario.incra.gov.br/',note:item.result.status==='unavailable'?'A fonte não respondeu com limites utilizáveis. Tente atualizar.':item.result.status==='no_match'?'Nenhum limite retornado nesta área.':item.result.limited?'Consulta parcial. Aproxime o mapa para ver mais detalhes.':'Limites de referência obtidos na fonte oficial.'}},{headers:{'Cache-Control':'private, no-store, max-age=0'}});
    }
    const queriedAt = new Date().toISOString();
    const [sigefPrivate,sigefPublic,carItem]=await Promise.all([querySigef('particular'),querySigef('publico'),queryCar()]);
    const sigef=mergeSigefSources([sigefPrivate.result,sigefPublic.result],Boolean(viewport)),car=carItem.result;
    return NextResponse.json({
      point: { lat: latitude, lng: longitude },
      queriedAt,
      scope: viewport ? "viewport_reference" : "containing_point",
      uf,
      ...(viewport ? {bounds:viewport} : {}),
      sigef: {
        ...sigef,
        queriedAt:[sigefPrivate.queriedAt,sigefPublic.queriedAt].sort()[0],
        label: "Parcela certificada",
        source: "SIGEF/INCRA · Acervo Fundiário",
        sourceUrl: "https://acervofundiario.incra.gov.br/",
        note: sigef.status === "unavailable"
          ? "O SIGEF não disponibilizou limites utilizáveis nesta consulta. Tente atualizar."
          : sigef.status === "no_match"
            ? viewport ? "Nenhuma parcela retornada nesta área da UF." : "Nenhuma parcela certificada foi encontrada contendo exatamente este ponto."
            : sigef.failedSources ? "Consulta parcial: parte do serviço SIGEF não respondeu. Atualize para tentar novamente." : "Limite certificado localizado no serviço OGC oficial do INCRA.",
      },
      car: {
        ...car,
        queriedAt:carItem.queriedAt,
        status: car.status,
        label: "Cadastro autodeclarado",
        source: "SICAR · Consulta Pública do CAR",
        sourceUrl: "https://consultapublica.car.gov.br/publico/imoveis/index",
        note: car.status === "unavailable"
          ? "O SICAR não disponibilizou limites utilizáveis nesta consulta. Tente atualizar."
          : car.status === "no_match"
            ? viewport ? "Nenhum CAR retornado nesta área da UF." : "Nenhum limite declarado no CAR foi encontrado contendo exatamente este ponto."
            : "Limite autodeclarado localizado no WFS público oficial do SICAR; escolha um candidato antes de usar.",
      },
      privacy: {
        owner: "not_available",
        note: "O endpoint geográfico consultado não disponibiliza proprietário. Nenhum titular é inferido pelo sistema.",
      },
    }, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    console.error("geospatial:official-boundaries", error);
    return NextResponse.json({
      error: "A fonte oficial não respondeu dentro do limite seguro. O desenho e os arquivos existentes foram preservados.",
      source: "SICAR e SIGEF/INCRA",
      retryable: true,
    }, { status: 502 });
  }
}
