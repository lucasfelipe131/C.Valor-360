"use client";

import type { Map as LeafletMap, LayerGroup, TileLayer } from "leaflet";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  boundaryAsGeoJson,
  boundaryAsKml,
  normalizePolygon,
  parseBoundaryFile,
  polygonAreaHa,
  polygonCentroid,
  polygonPerimeterM,
  simplifyPolygon,
  type GeoPoint,
  type ImportedBoundary,
} from "./lib/field-geometry";
import styles from "./FieldMap.module.css";

export type MapPoint = GeoPoint;

export type MapReferencePolygon = {
  id: string;
  label: string;
  points: MapPoint[];
  color?: string;
  fillColor?: string;
};

export type BoundarySelection = {
  sourceKind: "sigef_wfs" | "car_wfs" | "sigef_file" | "car_file" | "other_file";
  sourceLabel: string;
  registry?: string;
  propertyName?: string;
  parcelCode?: string;
  propertyCode?: string;
  status?: string;
  ownerStatus: "not_provided" | "unverified_file_metadata";
  queriedAt?: string;
  properties?: Record<string, string>;
  points: MapPoint[];
};

type MappingStep = "locate" | "import" | "draw" | "review";
type ImportedSource = "car" | "sigef" | "other";

type SearchResult = {
  id: string;
  type: "municipality" | "address" | "coordinate";
  label: string;
  lat?: number;
  lng?: number;
  uf?: string;
  ibgeCode?: number;
  source: string;
  confidence: string;
};

type SigefFeature = {
  id: string;
  label: string;
  points: MapPoint[];
  registry: string;
  propertyCode: string;
  parcelCode: string;
  municipalityCode: string;
  status: string;
  informedStatus: string;
  approvalDate: string;
  tenure: "particular" | "publico";
  ownerAvailability: "not_provided";
  source: string;
  sourceUrl: string;
  confidence: string;
};

type CarFeature = {
  id: string;
  label: string;
  points: MapPoint[];
  propertyCode: string;
  status: string;
  createdAt: string;
  condition: string;
  uf: string;
  municipality: string;
  municipalityCode: string;
  fiscalModules: string;
  propertyType: string;
  declaredAreaHa: number | null;
  ownerAvailability: "not_provided";
  source: string;
  sourceUrl: string;
  confidence: string;
};

type OfficialResponse = {
  queriedAt: string;
  sigef: {
    status: "available" | "no_match" | "unavailable";
    features: SigefFeature[];
    note: string;
    source: string;
    sourceUrl: string;
  };
  car: {
    status: "available" | "no_match" | "unavailable";
    features: CarFeature[];
    note: string;
    source: string;
    sourceUrl: string;
  };
  privacy: { note: string };
};

const STEPS: Array<{ id: MappingStep; number: string; label: string }> = [
  { id: "locate", number: "1", label: "Localizar" },
  { id: "import", number: "2", label: "Importar" },
  { id: "draw", number: "3", label: "Desenhar" },
  { id: "review", number: "4", label: "Revisar" },
];

const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];

function formatNumber(value: number, maximumFractionDigits = 2) {
  return value.toLocaleString("pt-BR", { maximumFractionDigits });
}

function fileProperty(properties: Record<string, string>, candidates: string[]) {
  const normalized = Object.fromEntries(Object.entries(properties).map(([key, value]) => [
    key.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/[^a-z0-9]/g, ""),
    value,
  ]));
  return candidates.map((candidate) => normalized[candidate]).find(Boolean) ?? "";
}

function downloadText(content: string, fileName: string, mimeType: string) {
  const href = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 1_000);
}

export default function FieldMap({
  points,
  onChange,
  ndviTileUrl,
  referencePolygons = [],
  contextMunicipality = "",
  onBoundaryUse,
}: {
  points: MapPoint[];
  onChange: (points: MapPoint[]) => void;
  ndviTileUrl?: string;
  referencePolygons?: MapReferencePolygon[];
  contextMunicipality?: string;
  onBoundaryUse?: (selection: BoundarySelection) => void;
}) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const baseLayerRef = useRef<TileLayer | null>(null);
  const drawingRef = useRef<LayerGroup | null>(null);
  const ndviRef = useRef<LayerGroup | null>(null);
  const pointsRef = useRef(points);
  const onChangeRef = useRef(onChange);
  const stepRef = useRef<MappingStep>(points.length >= 3 ? "review" : "locate");
  const historyRef = useRef<MapPoint[][]>([]);
  const contextMunicipalityRef = useRef(contextMunicipality);
  const officialLookupRef = useRef<(lat: number, lng: number) => void>(() => undefined);
  const [ready, setReady] = useState(false);
  const [baseStyle, setBaseStyle] = useState<"map" | "satellite">("satellite");
  const [selectedPoint, setSelectedPoint] = useState<number | null>(null);
  const [step, setStep] = useState<MappingStep>(points.length >= 3 ? "review" : "locate");
  const [query, setQuery] = useState(contextMunicipality);
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchMessage, setSearchMessage] = useState("");
  const [locationUf, setLocationUf] = useState("");
  const [anchorPoint, setAnchorPoint] = useState<MapPoint | null>(null);
  const [municipalityBoundary, setMunicipalityBoundary] = useState<MapReferencePolygon | null>(null);
  const [officialFeatures, setOfficialFeatures] = useState<SigefFeature[]>([]);
  const [selectedOfficialId, setSelectedOfficialId] = useState("");
  const [carFeatures, setCarFeatures] = useState<CarFeature[]>([]);
  const [selectedCarId, setSelectedCarId] = useState("");
  const [officialMessage, setOfficialMessage] = useState("");
  const [officialLoading, setOfficialLoading] = useState(false);
  const [officialQueriedAt, setOfficialQueriedAt] = useState("");
  const [importSource, setImportSource] = useState<ImportedSource>("car");
  const [importedBoundaries, setImportedBoundaries] = useState<ImportedBoundary[]>([]);
  const [selectedImportId, setSelectedImportId] = useState("");
  const [importMessage, setImportMessage] = useState("");
  const [drawingMessage, setDrawingMessage] = useState("");

  const selectedOfficial = officialFeatures.find((item) => item.id === selectedOfficialId) ?? officialFeatures[0];
  const selectedCar = carFeatures.find((item) => item.id === selectedCarId) ?? carFeatures[0];
  const selectedImport = importedBoundaries.find((item) => item.id === selectedImportId) ?? importedBoundaries[0];
  const areaHa = useMemo(() => polygonAreaHa(points), [points]);
  const perimeterM = useMemo(() => polygonPerimeterM(points), [points]);
  const centroid = useMemo(() => polygonCentroid(points), [points]);

  function changeStep(next: MappingStep) {
    stepRef.current = next;
    setStep(next);
    setSelectedPoint(null);
    if (next === "draw") setDrawingMessage("Modo desenho ativo: clique no mapa para adicionar os vértices em sequência.");
  }

  function commitPoints(nextPoints: MapPoint[]) {
    const normalized = normalizePolygon(nextPoints);
    if (JSON.stringify(normalized) === JSON.stringify(pointsRef.current)) return;
    historyRef.current = [...historyRef.current.slice(-19), pointsRef.current.map((point) => ({ ...point }))];
    pointsRef.current = normalized;
    onChangeRef.current(normalized);
  }

  useEffect(() => {
    pointsRef.current = points;
    onChangeRef.current = onChange;
  }, [onChange, points]);

  useEffect(() => {
    if (contextMunicipality && contextMunicipality !== contextMunicipalityRef.current) {
      setQuery(contextMunicipality);
      setSearchResults([]);
      setSearchMessage("");
    }
    contextMunicipalityRef.current = contextMunicipality;
  }, [contextMunicipality]);

  useEffect(() => {
    let mounted = true;
    if (!elementRef.current || mapRef.current) return;

    void import("leaflet").then((module) => {
      if (!mounted || !elementRef.current || mapRef.current) return;
      const L = module.default;
      const initial = pointsRef.current[0] ?? { lat: -28.41, lng: -54.96 };
      const map = L.map(elementRef.current, {
        zoomControl: true,
        attributionControl: true,
      }).setView([initial.lat, initial.lng], pointsRef.current.length ? 15 : 11);
      map.on("click", (event) => {
        const clicked = {
          lat: Number(event.latlng.lat.toFixed(7)),
          lng: Number(event.latlng.lng.toFixed(7)),
        };
        if (stepRef.current === "draw") {
          setSelectedPoint(pointsRef.current.length);
          commitPoints([...pointsRef.current, clicked]);
          return;
        }
        if (stepRef.current === "locate") {
          setAnchorPoint(clicked);
          officialLookupRef.current(clicked.lat, clicked.lng);
        }
      });
      mapRef.current = map;
      setReady(true);
      window.setTimeout(() => map.invalidateSize(), 80);
    });

    return () => {
      mounted = false;
      setReady(false);
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;
    void import("leaflet").then((module) => {
      if (cancelled || !mapRef.current) return;
      const L = module.default;
      baseLayerRef.current?.remove();
      const layer = baseStyle === "satellite"
        ? L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
            maxZoom: 19,
            attribution: "Imagem © Esri, Maxar, Earthstar Geographics e colaboradores",
          })
        : L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: "© OpenStreetMap",
          });
      layer.addTo(map);
      layer.bringToBack();
      baseLayerRef.current = layer;
    });
    return () => { cancelled = true; };
  }, [baseStyle, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;
    void import("leaflet").then((module) => {
      if (cancelled || !mapRef.current) return;
      const L = module.default;
      drawingRef.current?.remove();
      const group = L.layerGroup().addTo(map);
      if (municipalityBoundary?.points.length) {
        L.polygon(municipalityBoundary.points.map((point) => [point.lat, point.lng]), {
          color: "#f8fafc", fillOpacity: 0.015, weight: 2, dashArray: "4 8",
        }).bindTooltip(municipalityBoundary.label).addTo(group);
      }
      referencePolygons.forEach((reference) => {
        if (reference.points.length < 2) return;
        const coordinates = reference.points.map((point) => [point.lat, point.lng] as [number, number]);
        const layer = reference.points.length >= 3
          ? L.polygon(coordinates, {
              color: reference.color ?? "#f59e0b", fillColor: reference.fillColor ?? "#fbbf24",
              fillOpacity: 0.12, weight: 2, dashArray: "7 6",
            })
          : L.polyline(coordinates, { color: reference.color ?? "#f59e0b", weight: 2, dashArray: "7 6" });
        layer.bindTooltip(reference.label || "Área de referência").addTo(group);
      });
      importedBoundaries.forEach((boundary) => {
        const active = boundary.id === selectedImport?.id;
        const layer = L.polygon(boundary.points.map((point) => [point.lat, point.lng]), {
          color: active ? "#22d3ee" : "#0891b2", fillColor: "#06b6d4",
          fillOpacity: active ? 0.18 : 0.07, weight: active ? 3 : 2, dashArray: "8 5",
          bubblingMouseEvents: false,
        }).bindTooltip(`${boundary.label} · arquivo importado`).addTo(group);
        layer.on("click", () => setSelectedImportId(boundary.id));
      });
      officialFeatures.forEach((feature) => {
        const active = feature.id === selectedOfficial?.id;
        const layer = L.polygon(feature.points.map((point) => [point.lat, point.lng]), {
          color: active ? "#fb923c" : "#a855f7", fillColor: active ? "#fb923c" : "#a855f7",
          fillOpacity: active ? 0.2 : 0.08, weight: active ? 3 : 2, bubblingMouseEvents: false,
        }).bindTooltip(`${feature.label} · SIGEF/INCRA`).addTo(group);
        layer.on("click", () => setSelectedOfficialId(feature.id));
      });
      carFeatures.forEach((feature) => {
        const active = feature.id === selectedCar?.id;
        const layer = L.polygon(feature.points.map((point) => [point.lat, point.lng]), {
          color: active ? "#34d399" : "#16a34a", fillColor: "#22c55e",
          fillOpacity: active ? 0.2 : 0.07, weight: active ? 3 : 2, dashArray: "6 4",
          bubblingMouseEvents: false,
        }).bindTooltip(`${feature.label} · CAR/SICAR`).addTo(group);
        layer.on("click", () => setSelectedCarId(feature.id));
      });
      points.forEach((point, index) => {
        const marker = L.circleMarker([point.lat, point.lng], {
          radius: selectedPoint === index ? 9 : 7,
          color: selectedPoint === index ? "#ef4444" : "#d5f45c",
          fillColor: selectedPoint === index ? "#fff7ed" : "#092d25",
          fillOpacity: 1, weight: selectedPoint === index ? 3 : 2, bubblingMouseEvents: false,
        }).bindTooltip(`P${index + 1}`, { permanent: true, direction: "top" }).addTo(group);
        marker.on("click", () => setSelectedPoint(index));
      });
      if (points.length >= 3) {
        L.polygon(points.map((point) => [point.lat, point.lng]), {
          color: "#d5f45c", fillColor: "#5b9f4c", fillOpacity: 0.18, weight: 3,
        }).addTo(group);
      } else if (points.length === 2) {
        L.polyline(points.map((point) => [point.lat, point.lng]), { color: "#d5f45c", weight: 2 }).addTo(group);
      }
      if (anchorPoint) {
        L.circleMarker([anchorPoint.lat, anchorPoint.lng], {
          radius: 7, color: "#ffffff", fillColor: "#2563eb", fillOpacity: 1, weight: 3,
        }).bindTooltip("Ponto da consulta oficial", { direction: "top" }).addTo(group);
      }
      drawingRef.current = group;
      const officialCandidatePoints = [
        ...(selectedCar?.points ?? []),
        ...(selectedOfficial?.points ?? []),
      ];
      const focusPoints = officialCandidatePoints.length
        ? [...points, ...officialCandidatePoints]
        : step === "import" && selectedImport?.points.length
          ? [...points, ...selectedImport.points]
          : step === "locate" && municipalityBoundary?.points.length
            ? municipalityBoundary.points
            : [...points, ...referencePolygons.flatMap((reference) => reference.points)];
      if (focusPoints.length) {
        map.fitBounds(L.latLngBounds(focusPoints.map((point) => [point.lat, point.lng])), { padding: [28, 28], maxZoom: 17 });
      }
    });
    return () => { cancelled = true; };
  }, [anchorPoint, carFeatures, importedBoundaries, municipalityBoundary, officialFeatures, points, ready, referencePolygons, selectedCar, selectedImport, selectedOfficial, selectedPoint, step]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;
    void import("leaflet").then((module) => {
      if (cancelled || !mapRef.current) return;
      const L = module.default;
      ndviRef.current?.remove();
      const group = L.layerGroup().addTo(map);
      if (ndviTileUrl && points.length >= 3) {
        L.tileLayer(ndviTileUrl, {
          opacity: 0.72, maxZoom: 19, attribution: "Sentinel-2 · Microsoft Planetary Computer",
        }).addTo(group);
      }
      ndviRef.current = group;
    });
    return () => { cancelled = true; };
  }, [ndviTileUrl, points, ready]);

  async function searchLocation() {
    if (query.trim().length < 3) {
      setSearchMessage("Digite um município, endereço ou duas coordenadas.");
      return;
    }
    setSearching(true);
    setSearchMessage("");
    try {
      const response = await fetch(`/api/geospatial/search?q=${encodeURIComponent(query.trim())}`, { cache: "no-store" });
      const data = await response.json() as { results?: SearchResult[]; error?: string };
      if (!response.ok) throw new Error(data.error || "Busca indisponível.");
      setSearchResults(data.results ?? []);
      if (!data.results?.length) setSearchMessage("Nenhum resultado. Tente município/UF ou latitude, longitude.");
    } catch (error) {
      setSearchMessage(error instanceof Error ? error.message : "Não foi possível buscar a localização.");
    } finally {
      setSearching(false);
    }
  }

  async function chooseLocation(result: SearchResult) {
    setSearchResults([]);
    setQuery(result.label);
    if (result.uf) setLocationUf(result.uf);
    setSearchMessage(`${result.source} · ${result.confidence}`);
    if (result.ibgeCode) {
      try {
        const response = await fetch(`/api/geospatial/ibge-boundary?code=${result.ibgeCode}`, { cache: "no-store" });
        const data = await response.json() as { points?: MapPoint[]; source?: string; error?: string };
        if (!response.ok || !data.points?.length) throw new Error(data.error || "Malha municipal indisponível.");
        setMunicipalityBoundary({ id: `ibge-${result.ibgeCode}`, label: `${result.label} · limite municipal IBGE`, points: data.points });
        setAnchorPoint(null);
        setSearchMessage(`${data.source ?? "IBGE"} · limite oficial exibido somente para localização. Clique dentro do imóvel para consultar CAR e SIGEF.`);
      } catch (error) {
        setSearchMessage(error instanceof Error ? error.message : "Não foi possível abrir a malha municipal.");
      }
      return;
    }
    if (Number.isFinite(result.lat) && Number.isFinite(result.lng)) {
      const selected = { lat: Number(result.lat), lng: Number(result.lng) };
      setAnchorPoint(selected);
      mapRef.current?.flyTo([selected.lat, selected.lng], result.type === "address" ? 16 : 15);
    }
  }

  async function lookupOfficial(lat: number, lng: number) {
    if (!locationUf) {
      setOfficialMessage("Selecione a UF e clique novamente no ponto exato da área.");
      return;
    }
    setOfficialLoading(true);
    setOfficialMessage("Consultando os serviços geográficos oficiais do SICAR e INCRA…");
    setOfficialFeatures([]);
    setSelectedOfficialId("");
    setCarFeatures([]);
    setSelectedCarId("");
    try {
      const response = await fetch(`/api/geospatial/official-boundaries?lat=${lat}&lng=${lng}&uf=${locationUf}`, { cache: "no-store" });
      const data = await response.json() as OfficialResponse & { error?: string };
      if (!response.ok) throw new Error(data.error || "Fonte oficial indisponível.");
      setOfficialFeatures(data.sigef.features ?? []);
      setSelectedOfficialId(data.sigef.features?.[0]?.id ?? "");
      setCarFeatures(data.car.features ?? []);
      setSelectedCarId(data.car.features?.[0]?.id ?? "");
      setOfficialQueriedAt(data.queriedAt);
      setOfficialMessage(`${data.car.note} ${data.sigef.note} ${data.privacy.note}`);
    } catch (error) {
      setOfficialMessage(error instanceof Error ? error.message : "Consulta oficial indisponível. O desenho foi preservado.");
    } finally {
      setOfficialLoading(false);
    }
  }

  officialLookupRef.current = (lat, lng) => { void lookupOfficial(lat, lng); };

  function useOfficialBoundary() {
    if (!selectedOfficial) return;
    if (points.length && !window.confirm("Usar este limite certificado no lugar do desenho atual? Você poderá reverter a alteração.")) return;
    commitPoints(selectedOfficial.points);
    onBoundaryUse?.({
      sourceKind: "sigef_wfs",
      sourceLabel: selectedOfficial.source,
      registry: selectedOfficial.registry,
      propertyName: selectedOfficial.label,
      parcelCode: selectedOfficial.parcelCode,
      propertyCode: selectedOfficial.propertyCode,
      status: selectedOfficial.status,
      ownerStatus: "not_provided",
      queriedAt: officialQueriedAt,
      points: selectedOfficial.points,
    });
    changeStep("review");
    setDrawingMessage("Limite certificado adotado explicitamente. Confira área, perímetro e confrontação visual antes de salvar.");
  }

  function useCarBoundary() {
    if (!selectedCar) return;
    if (points.length && !window.confirm("Usar este limite declarado no CAR no lugar do desenho atual? Você poderá reverter a alteração.")) return;
    commitPoints(selectedCar.points);
    onBoundaryUse?.({
      sourceKind: "car_wfs",
      sourceLabel: selectedCar.source,
      propertyCode: selectedCar.propertyCode,
      status: selectedCar.condition || selectedCar.status,
      ownerStatus: "not_provided",
      queriedAt: officialQueriedAt,
      properties: {
        municipio: selectedCar.municipality,
        cod_municipio_ibge: selectedCar.municipalityCode,
        area_declarada_ha: selectedCar.declaredAreaHa === null ? "" : String(selectedCar.declaredAreaHa),
        data_criacao: selectedCar.createdAt,
        tipo_imovel: selectedCar.propertyType,
      },
      points: selectedCar.points,
    });
    changeStep("review");
    setDrawingMessage("Limite autodeclarado do CAR adotado explicitamente. Confira sobreposições e confrontação; ele não comprova domínio.");
  }

  function importBoundary(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) {
      setImportMessage("O arquivo excede 12 MB. Simplifique ou exporte somente o imóvel/talhão desejado.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const boundaries = parseBoundaryFile(String(reader.result), file.name).slice(0, 50);
        if (!boundaries.length) throw new Error("Nenhum polígono foi encontrado.");
        const importId = Date.now();
        setImportedBoundaries(boundaries.map((boundary) => ({ ...boundary, id: `${importId}-${boundary.id}` })));
        setSelectedImportId(`${importId}-${boundaries[0].id}`);
        setImportMessage(`${boundaries.length} polígono(s) lido(s) de ${file.name}. Selecione e compare antes de usar; nada foi substituído automaticamente.`);
      } catch (error) {
        setImportMessage(error instanceof Error ? error.message : "KML/GeoJSON inválido.");
      }
    };
    reader.onerror = () => setImportMessage("Não foi possível ler o arquivo.");
    reader.readAsText(file);
  }

  function useImportedBoundary() {
    if (!selectedImport) return;
    if (points.length && !window.confirm("Substituir o desenho atual por este polígono importado? Você poderá reverter a alteração.")) return;
    commitPoints(selectedImport.points);
    const registry = fileProperty(selectedImport.properties, ["registromatricula", "matricula", "registro"]);
    const propertyName = fileProperty(selectedImport.properties, ["nomearea", "nomedoimovel", "name", "nome"]);
    const parcelCode = fileProperty(selectedImport.properties, ["parcelacodigo", "codigoparcela"]);
    const propertyCode = fileProperty(selectedImport.properties, ["codigoimovel", "codigodoimovel"]);
    onBoundaryUse?.({
      sourceKind: importSource === "car" ? "car_file" : importSource === "sigef" ? "sigef_file" : "other_file",
      sourceLabel: importSource === "car" ? "Arquivo indicado como SICAR pelo usuário" : importSource === "sigef" ? "Arquivo indicado como SIGEF pelo usuário" : "Arquivo geográfico fornecido pelo usuário",
      registry, propertyName, parcelCode, propertyCode,
      status: fileProperty(selectedImport.properties, ["status", "situacao"]),
      ownerStatus: "unverified_file_metadata",
      properties: selectedImport.properties,
      points: selectedImport.points,
    });
    changeStep("review");
    setDrawingMessage("Polígono importado adotado. A origem declarada do arquivo não substitui validação no órgão emissor.");
  }

  function removeSelectedPoint() {
    if (selectedPoint === null) return;
    commitPoints(points.filter((_, index) => index !== selectedPoint));
    setSelectedPoint(null);
  }

  function undoLastPoint() {
    if (!points.length) return;
    commitPoints(points.slice(0, -1));
    setSelectedPoint(null);
  }

  function revertDrawing() {
    const previous = historyRef.current.pop();
    if (!previous) return;
    pointsRef.current = previous;
    onChangeRef.current(previous);
    setSelectedPoint(null);
    setDrawingMessage("Alteração revertida.");
  }

  function clearDrawing() {
    if (!points.length || !window.confirm("Remover todos os pontos deste desenho? Você poderá reverter uma vez.")) return;
    commitPoints([]);
    setSelectedPoint(null);
  }

  function closeDrawing() {
    if (points.length < 3) {
      setDrawingMessage("Adicione pelo menos três pontos para fechar o perímetro.");
      return;
    }
    const normalized = normalizePolygon(points);
    if (JSON.stringify(normalized) !== JSON.stringify(points)) commitPoints(normalized);
    changeStep("review");
    setDrawingMessage("Perímetro fechado automaticamente entre o último e o primeiro ponto.");
  }

  function simplifyDrawing() {
    if (points.length < 5) {
      setDrawingMessage("O desenho já tem poucos vértices e não precisa ser simplificado.");
      return;
    }
    const simplified = simplifyPolygon(points, 1.5);
    if (simplified.length === points.length) {
      setDrawingMessage("Nenhum ponto redundante foi encontrado com tolerância segura de 1,5 m.");
      return;
    }
    commitPoints(simplified);
    setDrawingMessage(`${points.length - simplified.length} ponto(s) redundante(s) removido(s), preservando o formato.`);
  }

  return (
    <div className={`field-map-shell ${styles.shell}`}>
      <div className={styles.workflow} aria-label="Etapas do mapeamento">
        {STEPS.map((item) => (
          <button key={item.id} type="button" className={step === item.id ? styles.activeStep : ""} onClick={() => changeStep(item.id)}>
            <b>{item.number}</b><span>{item.label}</span>
          </button>
        ))}
      </div>

      {step === "locate" && (
        <aside className={styles.sidePanel} aria-label="Localizar área">
          <div className={styles.panelHeading}><b>Localize antes de mapear</b><small>Município, endereço ou “latitude, longitude”</small></div>
          <div className={styles.searchRow}>
            <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void searchLocation(); }} placeholder="Ex.: São Luiz Gonzaga/RS" />
            <button type="button" onClick={() => void searchLocation()} disabled={searching}>{searching ? "…" : "Buscar"}</button>
          </div>
          {!!searchResults.length && <div className={styles.searchResults}>{searchResults.map((result) => (
            <button type="button" key={result.id} onClick={() => void chooseLocation(result)}><b>{result.label}</b><small>{result.source} · {result.confidence}</small></button>
          ))}</div>}
          {searchMessage && <p className={styles.status}>{searchMessage}</p>}
          <label className={styles.ufField}><span>UF da consulta CAR/SIGEF</span><select value={locationUf} onChange={(event) => setLocationUf(event.target.value)}><option value="">Selecione</option>{UFS.map((uf) => <option key={uf}>{uf}</option>)}</select></label>
          <p className={styles.instruction}>Com a UF selecionada, clique no ponto exato do imóvel. A consulta usa BBOX mínimo e mantém somente limites que contêm o clique.</p>
          {anchorPoint && <button type="button" className={styles.primaryAction} onClick={() => void lookupOfficial(anchorPoint.lat, anchorPoint.lng)} disabled={officialLoading}>{officialLoading ? "Consultando fontes oficiais…" : "Consultar CAR e SIGEF neste ponto"}</button>}
          {officialMessage && <p className={styles.status}>{officialMessage}</p>}
          {!!carFeatures.length && <><small className={styles.boundaryGroupTitle}>CAR/SICAR · limites autodeclarados</small><div className={styles.boundaryList}>{carFeatures.map((feature) => (
            <button type="button" key={feature.id} className={feature.id === selectedCar?.id ? styles.selectedBoundary : ""} onClick={() => setSelectedCarId(feature.id)}>
              <b>{feature.label}</b><span>{feature.municipality || locationUf} · {feature.condition || feature.status || "situação não informada"}</span><small>{feature.declaredAreaHa === null ? "Área não informada" : `${formatNumber(feature.declaredAreaHa)} ha declarados`}</small>
            </button>
          ))}</div></>}
          {selectedCar && <div className={styles.sourceCard}><b>Limite declarado no CAR</b><span>SICAR · código {selectedCar.propertyCode || "não informado"}</span><span>{selectedCar.condition || selectedCar.status || "Situação não informada"} · confiança: autodeclaração contendo o ponto consultado</span><span>Proprietário: não disponibilizado pela fonte · CAR não comprova domínio</span>{officialQueriedAt && <span>Consulta: {new Date(officialQueriedAt).toLocaleString("pt-BR")}</span>}<a href={selectedCar.sourceUrl} target="_blank" rel="noreferrer">Abrir Consulta Pública do CAR</a><button type="button" onClick={useCarBoundary}>Comparar e usar este limite declarado</button></div>}
          {!!officialFeatures.length && <><small className={styles.boundaryGroupTitle}>SIGEF/INCRA · parcelas certificadas</small><div className={styles.boundaryList}>{officialFeatures.map((feature) => (
            <button type="button" key={feature.id} className={feature.id === selectedOfficial?.id ? styles.selectedBoundary : ""} onClick={() => setSelectedOfficialId(feature.id)}>
              <b>{feature.label}</b><span>{feature.registry || "Matrícula não informada"} · {feature.status}</span><small>Código {feature.parcelCode || feature.propertyCode || "não informado"}</small>
            </button>
          ))}</div></>}
          {selectedOfficial && <div className={styles.sourceCard}><b>Fonte oficial verificada</b><span>SIGEF/INCRA · parcela certificada</span><span>Status: {selectedOfficial.status || "certificada"} · confiança: limite oficial contendo o ponto consultado</span><span>Proprietário: não disponibilizado pela fonte</span>{officialQueriedAt && <span>Consulta: {new Date(officialQueriedAt).toLocaleString("pt-BR")}</span>}<a href={selectedOfficial.sourceUrl} target="_blank" rel="noreferrer">Abrir Acervo Fundiário</a><button type="button" onClick={useOfficialBoundary}>Comparar e usar este limite</button></div>}
          <div className={styles.officialLinks}><a href="https://consultapublica.car.gov.br/publico/estados/downloads" target="_blank" rel="noreferrer">Downloads oficiais SICAR</a><a href="https://sigef.incra.gov.br/" target="_blank" rel="noreferrer">Consultar SIGEF</a><a href="https://meuimovelrural.sistema.gov.br/" target="_blank" rel="noreferrer">Meu Imóvel Rural</a></div>
        </aside>
      )}

      {step === "import" && (
        <aside className={styles.sidePanel} aria-label="Importar limite">
          <div className={styles.panelHeading}><b>Importe e compare</b><small>KML ou GeoJSON, sem substituir o desenho automaticamente</small></div>
          <label className={styles.ufField}><span>Origem declarada do arquivo</span><select value={importSource} onChange={(event) => setImportSource(event.target.value as ImportedSource)}><option value="car">SICAR · cadastro autodeclarado</option><option value="sigef">SIGEF · conferir certificação</option><option value="other">Outro arquivo geográfico</option></select></label>
          <label className={styles.fileAction}>Selecionar KML ou GeoJSON<input type="file" accept=".kml,.geojson,.json,application/vnd.google-earth.kml+xml,application/geo+json" onChange={importBoundary} /></label>
          {importMessage && <p className={styles.status}>{importMessage}</p>}
          {!!importedBoundaries.length && <div className={styles.boundaryList}>{importedBoundaries.map((boundary) => (
            <button type="button" key={boundary.id} className={boundary.id === selectedImport?.id ? styles.selectedBoundary : ""} onClick={() => setSelectedImportId(boundary.id)}><b>{boundary.label}</b><span>{formatNumber(polygonAreaHa(boundary.points))} ha · {boundary.points.length} vértices</span></button>
          ))}</div>}
          {selectedImport && <div className={styles.sourceCard}><b>{importSource === "car" ? "CAR autodeclarado" : importSource === "sigef" ? "Arquivo indicado como SIGEF" : "Arquivo do usuário"}</b><span>Confiança: depende da procedência do arquivo</span><span>Proprietário/detentor, se houver: metadado não verificado</span><button type="button" onClick={useImportedBoundary}>Comparar e usar este polígono</button></div>}
          <p className={styles.caution}>O sistema não acessa contas, não contorna captcha e não consulta ou inventa proprietário. CAR pode conter sobreposições ou geometrias autodeclaradas; valide no órgão competente.</p>
        </aside>
      )}

      {(step === "draw" || step === "review") && (
        <aside className={styles.sidePanel} aria-label={step === "draw" ? "Desenhar perímetro" : "Revisar perímetro"}>
          <div className={styles.panelHeading}><b>{step === "draw" ? "Desenho assistido" : "Revisão técnica"}</b><small>{step === "draw" ? "Adicione vértices, corrija e feche" : "Confira geometria e exporte uma cópia"}</small></div>
          <div className={styles.metrics}>
            <span><b>{formatNumber(areaHa)} ha</b>Área calculada</span>
            <span><b>{formatNumber(perimeterM < 1_000 ? perimeterM : perimeterM / 1_000)} {perimeterM < 1_000 ? "m" : "km"}</b>Perímetro</span>
            <span><b>{points.length}</b>Vértices</span>
            <span><b>{centroid ? `${centroid.lat.toFixed(5)}, ${centroid.lng.toFixed(5)}` : "—"}</b>Centroide</span>
          </div>
          <div className={styles.editActions}>
            <button type="button" onClick={undoLastPoint} disabled={!points.length}>Desfazer último</button>
            <button type="button" onClick={revertDrawing} disabled={!historyRef.current.length}>Reverter alteração</button>
            <button type="button" onClick={simplifyDrawing} disabled={points.length < 5}>Simplificar</button>
            <button type="button" onClick={removeSelectedPoint} disabled={selectedPoint === null}>Remover selecionado</button>
            <button type="button" onClick={clearDrawing} disabled={!points.length}>Limpar</button>
            <button type="button" className={styles.primaryAction} onClick={closeDrawing} disabled={points.length < 3}>Fechar e revisar</button>
          </div>
          {drawingMessage && <p className={styles.status}>{drawingMessage}</p>}
          {step === "review" && points.length >= 3 && <div className={styles.exportActions}><button type="button" onClick={() => downloadText(boundaryAsGeoJson(points, { source: "Manual do Agrônomo" }), "talhao.geojson", "application/geo+json")}>Exportar GeoJSON</button><button type="button" onClick={() => downloadText(boundaryAsKml(points), "talhao.kml", "application/vnd.google-earth.kml+xml")}>Exportar KML</button></div>}
        </aside>
      )}

      <div ref={elementRef} className="field-map" />
      <div className="map-style-switch" aria-label="Visualização do mapa">
        <button className={baseStyle === "satellite" ? "active" : ""} onClick={() => setBaseStyle("satellite")} type="button">Satélite</button>
        <button className={baseStyle === "map" ? "active" : ""} onClick={() => setBaseStyle("map")} type="button">Mapa</button>
      </div>
      {!!points.length && <div className={`map-point-list ${styles.pointList}`} aria-label="Pontos do desenho">{points.map((point, index) => (
        <button type="button" key={`${point.lat}-${point.lng}-${index}`} className={selectedPoint === index ? "active" : ""} onClick={() => setSelectedPoint(index)} title={`${point.lat.toFixed(7)}, ${point.lng.toFixed(7)}`}>P{index + 1}</button>
      ))}</div>}
      <span className={`map-hint ${styles.hint}`}>{step === "locate" ? "Clique no local exato para consultar limites oficiais; o desenho existente não será alterado." : step === "draw" ? "Clique no mapa para adicionar vértices. O fechamento entre o último e o primeiro é automático." : step === "import" ? "O polígono importado aparece em azul; escolha “usar” somente depois de comparar." : selectedPoint === null ? "Revise área, perímetro e centroide; selecione um ponto para corrigi-lo." : `Ponto P${selectedPoint + 1} selecionado.`}</span>
    </div>
  );
}
