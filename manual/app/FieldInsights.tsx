"use client";

import { useMemo, useState } from "react";
import type { MapPoint } from "./FieldMap";
import { saveRecord } from "./records";

export type VegetationIndex =
  | "NDVI"
  | "NDRE"
  | "GNDVI"
  | "NDMI"
  | "SAVI"
  | "EVI2";

export type InsightScene = {
  id: string;
  date: string;
  cloud: number;
};

type RasterStats = {
  mean: number;
  min: number;
  max: number;
  std: number;
  median: number;
  p10: number;
  p25: number;
  p75: number;
  p90: number;
  validPercent: number | null;
  count: number | null;
};

type TerrainSummary = {
  minimum: number;
  mean: number;
  maximum: number;
  range: number;
  meanSlope: number;
  maximumSlope: number;
  samples: number;
};

export const indexDefinitions: Record<
  VegetationIndex,
  {
    label: string;
    description: string;
    expression: string;
    assets: string[];
    rescale: string;
  }
> = {
  NDVI: {
    label: "NDVI · vigor geral",
    description: "Biomassa verde e uniformidade do dossel.",
    expression: "(B08-B04)/(B08+B04)",
    assets: ["B04", "B08"],
    rescale: "-1,1",
  },
  NDRE: {
    label: "NDRE · clorofila",
    description: "Resposta da vegetação em estádios com maior biomassa.",
    expression: "(B8A-B05)/(B8A+B05)",
    assets: ["B05", "B8A"],
    rescale: "-1,1",
  },
  GNDVI: {
    label: "GNDVI · verde/clorofila",
    description: "Sensibilidade ao verde e à atividade fotossintética.",
    expression: "(B08-B03)/(B08+B03)",
    assets: ["B03", "B08"],
    rescale: "-1,1",
  },
  NDMI: {
    label: "NDMI · umidade do dossel",
    description: "Variações relativas de água na vegetação.",
    expression: "(B8A-B11)/(B8A+B11)",
    assets: ["B8A", "B11"],
    rescale: "-1,1",
  },
  SAVI: {
    label: "SAVI · vegetação com solo exposto",
    description: "Reduz a influência do brilho do solo em cobertura baixa.",
    expression: "1.5*(B08-B04)/(B08+B04+0.5)",
    assets: ["B04", "B08"],
    rescale: "-1,1",
  },
  EVI2: {
    label: "EVI2 · biomassa densa",
    description: "Alternativa menos suscetível à saturação que o NDVI.",
    expression: "2.5*(B08-B04)/(B08+2.4*B04+1)",
    assets: ["B04", "B08"],
    rescale: "-1,1",
  },
};

function renderParams(itemId: string, index: VegetationIndex) {
  const definition = indexDefinitions[index];
  const params = new URLSearchParams({
    collection: "sentinel-2-l2a",
    item: itemId,
    expression: definition.expression,
    rescale: definition.rescale,
    colormap_name: "rdylgn",
    nodata: "0",
    asset_as_band: "true",
    unscale: "true",
    format: "png",
  });
  definition.assets.forEach((asset) => params.append("assets", asset));
  return params;
}

export function spectralTileUrl(itemId: string, index: VegetationIndex) {
  const params = renderParams(itemId, index);
  return `https://planetarycomputer.microsoft.com/api/data/v1/item/tiles/WebMercatorQuad/{z}/{x}/{y}@1x?${params.toString()}`;
}

export function spectralPreviewUrl(itemId: string, index: VegetationIndex) {
  const params = renderParams(itemId, index);
  params.set("max_size", "320");
  return `https://planetarycomputer.microsoft.com/api/data/v1/item/preview.png?${params.toString()}`;
}

function decimal(value: number, digits = 2) {
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number.isFinite(value) ? value : 0);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function pickNumber(source: Record<string, unknown>, names: string[], fallback = 0) {
  for (const name of names) {
    const value = Number(source[name]);
    if (Number.isFinite(value)) return value;
  }
  return fallback;
}

function findStats(value: unknown, depth = 0): Record<string, unknown> | null {
  if (!value || depth > 8) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStats(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  const object = value as Record<string, unknown>;
  if (
    Number.isFinite(Number(object.mean)) &&
    (Number.isFinite(Number(object.std)) || Number.isFinite(Number(object.min)))
  ) {
    return object;
  }
  for (const child of Object.values(object)) {
    const found = findStats(child, depth + 1);
    if (found) return found;
  }
  return null;
}

function normalizeStats(payload: unknown): RasterStats {
  const source = findStats(payload);
  if (!source) throw new Error("A resposta não trouxe estatísticas válidas.");
  const mean = pickNumber(source, ["mean"]);
  const median = pickNumber(source, ["median", "percentile_50", "percentile_50.0"], mean);
  return {
    mean,
    min: pickNumber(source, ["min"], mean),
    max: pickNumber(source, ["max"], mean),
    std: pickNumber(source, ["std", "stdev", "standard_deviation"]),
    median,
    p10: pickNumber(source, ["percentile_10", "percentile_10.0"], median),
    p25: pickNumber(source, ["percentile_25", "percentile_25.0"], median),
    p75: pickNumber(source, ["percentile_75", "percentile_75.0"], median),
    p90: pickNumber(source, ["percentile_90", "percentile_90.0"], median),
    validPercent: Number.isFinite(Number(source.valid_percent))
      ? Number(source.valid_percent)
      : null,
    count: Number.isFinite(Number(source.count)) ? Number(source.count) : null,
  };
}

async function loadRasterStatistics(
  sceneId: string,
  index: VegetationIndex,
  points: MapPoint[],
) {
  const definition = indexDefinitions[index];
  const params = new URLSearchParams({
    collection: "sentinel-2-l2a",
    item: sceneId,
    expression: definition.expression,
    nodata: "0",
    asset_as_band: "true",
    unscale: "true",
    max_size: "1024",
  });
  definition.assets.forEach((asset) => params.append("assets", asset));
  [10, 25, 50, 75, 90].forEach((percentile) =>
    params.append("p", String(percentile)),
  );
  const ring = [...points.map((point) => [point.lng, point.lat]), [
    points[0].lng,
    points[0].lat,
  ]];
  const response = await fetch(
    `https://planetarycomputer.microsoft.com/api/data/v1/item/statistics?${params.toString()}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [ring] },
      }),
    },
  );
  if (!response.ok) {
    throw new Error(`Estatística satelital indisponível (${response.status}).`);
  }
  return normalizeStats(await response.json());
}

function pointInside(point: MapPoint, polygon: MapPoint[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const crosses =
      a.lat > point.lat !== b.lat > point.lat &&
      point.lng <
        ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat || 1e-12) +
          a.lng;
    if (crosses) inside = !inside;
  }
  return inside;
}

function terrainPoints(points: MapPoint[]) {
  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const samples = [...points];
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 5; column += 1) {
      const point = {
        lat: minLat + ((maxLat - minLat) * row) / 4,
        lng: minLng + ((maxLng - minLng) * column) / 4,
      };
      if (pointInside(point, points)) samples.push(point);
    }
  }
  const unique = new Map<string, MapPoint>();
  samples.forEach((point) =>
    unique.set(`${point.lat.toFixed(6)},${point.lng.toFixed(6)}`, point),
  );
  return Array.from(unique.values()).slice(0, 60);
}

function distanceMeters(a: MapPoint, b: MapPoint) {
  const radius = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const first = a.lat * rad;
  const second = b.lat * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(first) * Math.cos(second) * Math.sin(dLng / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

async function loadTerrain(points: MapPoint[]): Promise<TerrainSummary> {
  const samples = terrainPoints(points);
  const response = await fetch(
    `https://api.open-meteo.com/v1/elevation?latitude=${samples
      .map((point) => point.lat)
      .join(",")}&longitude=${samples.map((point) => point.lng).join(",")}`,
  );
  if (!response.ok) {
    throw new Error(`Altitude indisponível (${response.status}).`);
  }
  const payload = (await response.json()) as { elevation?: number[] | number };
  const values = (
    Array.isArray(payload.elevation) ? payload.elevation : [payload.elevation]
  )
    .map(Number)
    .filter(Number.isFinite);
  if (!values.length) throw new Error("A fonte de relevo não retornou altitude.");
  const slopes: number[] = [];
  for (let index = 0; index < points.length; index += 1) {
    const next = (index + 1) % points.length;
    const distance = distanceMeters(points[index], points[next]);
    if (distance > 0 && Number.isFinite(values[index]) && Number.isFinite(values[next])) {
      slopes.push((Math.abs(values[next] - values[index]) / distance) * 100);
    }
  }
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  return {
    minimum,
    mean: values.reduce((total, value) => total + value, 0) / values.length,
    maximum,
    range: maximum - minimum,
    meanSlope: slopes.length
      ? slopes.reduce((total, value) => total + value, 0) / slopes.length
      : 0,
    maximumSlope: slopes.length ? Math.max(...slopes) : 0,
    samples: values.length,
  };
}

function soilWaterEstimate(
  sandPercent: number,
  clayPercent: number,
  organicMatterPercent: number,
  depthCm: number,
  coarseFragmentsPercent: number,
) {
  if (
    sandPercent < 0 ||
    clayPercent < 0 ||
    sandPercent + clayPercent > 100 ||
    depthCm <= 0
  ) {
    return null;
  }
  const sand = sandPercent / 100;
  const clay = clayPercent / 100;
  const organicMatter = organicMatterPercent;
  const theta1500t =
    -0.024 * sand +
    0.487 * clay +
    0.006 * organicMatter +
    0.005 * sand * organicMatter -
    0.013 * clay * organicMatter +
    0.068 * sand * clay +
    0.031;
  const wiltingPoint = clamp(theta1500t + 0.14 * theta1500t - 0.02, 0.01, 0.8);
  const theta33t =
    -0.251 * sand +
    0.195 * clay +
    0.011 * organicMatter +
    0.006 * sand * organicMatter -
    0.027 * clay * organicMatter +
    0.452 * sand * clay +
    0.299;
  const fieldCapacity = clamp(
    theta33t + 1.283 * theta33t ** 2 - 0.374 * theta33t - 0.015,
    wiltingPoint,
    0.8,
  );
  const fineEarth = 1 - clamp(coarseFragmentsPercent, 0, 90) / 100;
  const available = Math.max(fieldCapacity - wiltingPoint, 0);
  const factor = depthCm * 10 * fineEarth;
  return {
    siltPercent: Math.max(100 - sandPercent - clayPercent, 0),
    wiltingPoint,
    fieldCapacity,
    available,
    wiltingStorageMm: wiltingPoint * factor,
    fieldCapacityStorageMm: fieldCapacity * factor,
    availableWaterMm: available * factor,
  };
}

function interpretation(index: VegetationIndex, stats: RasterStats) {
  const variability =
    Math.abs(stats.mean) > 0.05 ? Math.abs((stats.std / stats.mean) * 100) : 0;
  const uniformity =
    variability < 10
      ? "baixa variabilidade espacial"
      : variability < 20
        ? "variabilidade espacial moderada"
        : "alta variabilidade; priorize vistoria dirigida";
  if (index === "NDVI") {
    const vigor =
      stats.mean < 0.2
        ? "pouca cobertura verde"
        : stats.mean < 0.4
          ? "vigor baixo a intermediário"
          : stats.mean < 0.6
            ? "vigor intermediário"
            : "alto vigor relativo";
    return `${vigor}; ${uniformity}. Compare somente cenas da mesma cultura e estádio.`;
  }
  return `${indexDefinitions[index].description} O talhão apresenta ${uniformity}; confirme os contrastes em campo.`;
}

function DecimalInput({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
}) {
  return (
    <input
      aria-label={label}
      inputMode="decimal"
      type="text"
      value={value ? String(value).replace(".", ",") : ""}
      placeholder="0"
      onChange={(event) => {
        const next = event.target.value;
        if (!/^\d*(?:[.,]\d*)?$/.test(next)) return;
        const parsed = Number(next.replace(",", "."));
        onChange(Number.isFinite(parsed) ? parsed : 0);
      }}
    />
  );
}

export default function FieldInsights({
  producerName,
  fieldName,
  points,
  scenes,
  activeScene,
  index,
  onIndexChange,
}: {
  producerName: string;
  fieldName: string;
  points: MapPoint[];
  scenes: InsightScene[];
  activeScene?: InsightScene;
  index: VegetationIndex;
  onIndexChange: (index: VegetationIndex) => void;
}) {
  const [statistics, setStatistics] = useState<Record<string, RasterStats>>({});
  const [terrain, setTerrain] = useState<TerrainSummary | null>(null);
  const [compareSceneId, setCompareSceneId] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [sand, setSand] = useState(0);
  const [clay, setClay] = useState(0);
  const [organicMatter, setOrganicMatter] = useState(0);
  const [depth, setDepth] = useState(20);
  const [coarseFragments, setCoarseFragments] = useState(0);
  const [saveMessage, setSaveMessage] = useState("");

  const activeKey = activeScene ? `${activeScene.id}:${index}` : "";
  const activeStats = activeKey ? statistics[activeKey] : undefined;
  const compareKey = compareSceneId ? `${compareSceneId}:${index}` : "";
  const compareStats = compareKey ? statistics[compareKey] : undefined;
  const compareScene = scenes.find((scene) => scene.id === compareSceneId);
  const water = useMemo(
    () => soilWaterEstimate(sand, clay, organicMatter, depth, coarseFragments),
    [clay, coarseFragments, depth, organicMatter, sand],
  );

  async function loadScene(scene: InsightScene) {
    const key = `${scene.id}:${index}`;
    if (statistics[key]) return statistics[key];
    const result = await loadRasterStatistics(scene.id, index, points);
    setStatistics((current) => ({ ...current, [key]: result }));
    return result;
  }

  async function analyze() {
    if (!activeScene || points.length < 3) {
      setMessage("Selecione uma cena e mantenha o polígono com ao menos três pontos.");
      return;
    }
    setLoading(true);
    setMessage("");
    try {
      const tasks: Array<Promise<unknown>> = [loadScene(activeScene)];
      if (!terrain) tasks.push(loadTerrain(points).then(setTerrain));
      if (compareScene) tasks.push(loadScene(compareScene));
      await Promise.all(tasks);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Não foi possível concluir a análise.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function persist() {
    if (!activeScene || !activeStats) {
      setSaveMessage("Analise a cena antes de salvar.");
      return;
    }
    setSaveMessage("Salvando…");
    try {
      await saveRecord({
        type: "field_analysis",
        title: `${fieldName} · ${index} · ${new Date(
          activeScene.date,
        ).toLocaleDateString("pt-BR")}`,
        producerName,
        payload: {
          producerName,
          fieldName,
          index,
          scene: activeScene,
          statistics: activeStats,
          comparison: compareScene && compareStats
            ? { scene: compareScene, statistics: compareStats }
            : null,
          terrain,
          soilWater: water,
          savedAt: new Date().toISOString(),
        },
      });
      setSaveMessage("Interpretação salva no histórico em nuvem desta conta.");
    } catch (error) {
      setSaveMessage(error instanceof Error ? error.message : "Falha ao salvar.");
    }
  }

  const coefficient =
    activeStats && Math.abs(activeStats.mean) > 0.05
      ? Math.abs((activeStats.std / activeStats.mean) * 100)
      : 0;
  const delta =
    activeStats && compareStats ? activeStats.mean - compareStats.mean : null;

  return (
    <div className="field-insights">
      <div className="insight-heading">
        <div>
          <span className="eyebrow">INTERPRETAÇÃO ESPACIAL</span>
          <h3>Índices, relevo e água do solo</h3>
        </div>
        <select
          value={index}
          aria-label="Índice espectral exibido"
          onChange={(event) => onIndexChange(event.target.value as VegetationIndex)}
        >
          {(Object.keys(indexDefinitions) as VegetationIndex[]).map((key) => (
            <option key={key} value={key}>
              {indexDefinitions[key].label}
            </option>
          ))}
        </select>
      </div>
      <p className="insight-description">{indexDefinitions[index].description}</p>

      <div className="insight-compare">
        <label>
          <span>Comparar com outra data</span>
          <select
            value={compareSceneId}
            onChange={(event) => setCompareSceneId(event.target.value)}
          >
            <option value="">Sem comparação</option>
            {scenes
              .filter((scene) => scene.id !== activeScene?.id)
              .map((scene) => (
                <option key={scene.id} value={scene.id}>
                  {new Date(scene.date).toLocaleDateString("pt-BR")} · nuvens{" "}
                  {decimal(scene.cloud, 1)}%
                </option>
              ))}
          </select>
        </label>
        <button className="button primary" disabled={loading} onClick={() => void analyze()}>
          {loading ? "Processando…" : "Analisar talhão"}
        </button>
      </div>
      {message && <p className="field-error">{message}</p>}

      {activeStats && (
        <>
          <div className="insight-metrics">
            <div><span>Média</span><strong>{decimal(activeStats.mean, 3)}</strong></div>
            <div><span>Mediana</span><strong>{decimal(activeStats.median, 3)}</strong></div>
            <div><span>P10–P90</span><strong>{decimal(activeStats.p10, 2)}–{decimal(activeStats.p90, 2)}</strong></div>
            <div><span>Desvio padrão</span><strong>{decimal(activeStats.std, 3)}</strong></div>
            <div><span>Variação</span><strong>{decimal(coefficient, 1)}%</strong></div>
            <div>
              <span>Pixels válidos</span>
              <strong>
                {activeStats.validPercent !== null
                  ? `${decimal(activeStats.validPercent, 1)}%`
                  : activeStats.count
                    ? activeStats.count.toLocaleString("pt-BR")
                    : "—"}
              </strong>
            </div>
          </div>
          <div className="insight-reading">
            <strong>Leitura orientativa</strong>
            <p>{interpretation(index, activeStats)}</p>
            {delta !== null && compareScene && (
              <small>
                Variação da média em relação a{" "}
                {new Date(compareScene.date).toLocaleDateString("pt-BR")}:{" "}
                <b>{delta >= 0 ? "+" : ""}{decimal(delta, 3)}</b>.
              </small>
            )}
          </div>
        </>
      )}

      {terrain && (
        <section className="terrain-card">
          <header>
            <div>
              <span>RELEVO · COPERNICUS DEM GLO-90</span>
              <strong>Altitude e desnível estimados</strong>
            </div>
            <small>{terrain.samples} pontos</small>
          </header>
          <div>
            <p><span>Mínima</span><b>{decimal(terrain.minimum, 0)} m</b></p>
            <p><span>Média</span><b>{decimal(terrain.mean, 0)} m</b></p>
            <p><span>Máxima</span><b>{decimal(terrain.maximum, 0)} m</b></p>
            <p><span>Desnível</span><b>{decimal(terrain.range, 0)} m</b></p>
            <p><span>Declividade média</span><b>{decimal(terrain.meanSlope, 1)}%</b></p>
            <p><span>Declividade máxima</span><b>{decimal(terrain.maximumSlope, 1)}%</b></p>
          </div>
        </section>
      )}

      <section className="soil-water-card">
        <header>
          <span>ÁGUA DO SOLO · ESTIMATIVA PEDOTRANSFERÊNCIA</span>
          <strong>Ponto de murcha e capacidade de água disponível</strong>
        </header>
        <div className="soil-water-fields">
          <label><span>Areia (%)</span><DecimalInput label="Percentual de areia" value={sand} onChange={setSand} /></label>
          <label><span>Argila (%)</span><DecimalInput label="Percentual de argila" value={clay} onChange={setClay} /></label>
          <label><span>Matéria orgânica (%)</span><DecimalInput label="Matéria orgânica" value={organicMatter} onChange={setOrganicMatter} /></label>
          <label><span>Profundidade (cm)</span><DecimalInput label="Profundidade" value={depth} onChange={setDepth} /></label>
          <label><span>Fragmentos grossos (%)</span><DecimalInput label="Fragmentos grossos" value={coarseFragments} onChange={setCoarseFragments} /></label>
        </div>
        {sand + clay > 100 && (
          <p className="field-error">Areia + argila não pode ultrapassar 100%.</p>
        )}
        {water && sand + clay > 0 ? (
          <div className="soil-water-results">
            <div><span>Silte calculado</span><strong>{decimal(water.siltPercent, 1)}%</strong></div>
            <div><span>PMP · −1.500 kPa</span><strong>{decimal(water.wiltingPoint * 100, 1)}% vol.</strong></div>
            <div><span>Capacidade de campo · −33 kPa</span><strong>{decimal(water.fieldCapacity * 100, 1)}% vol.</strong></div>
            <div><span>Água disponível</span><strong>{decimal(water.availableWaterMm, 1)} mm</strong></div>
            <div><span>Armazenada no PMP</span><strong>{decimal(water.wiltingStorageMm, 1)} mm</strong></div>
            <div><span>Armazenada na CC</span><strong>{decimal(water.fieldCapacityStorageMm, 1)} mm</strong></div>
          </div>
        ) : (
          <p className="soil-water-empty">
            Preencha areia, argila e matéria orgânica da camada para calcular.
          </p>
        )}
        <small>
          Estimativa de Saxton &amp; Rawls (2006), não medição laboratorial. O
          NDVI e a altitude não determinam o ponto de murcha permanente.
        </small>
      </section>

      <div className="insight-actions">
        <button className="button secondary" onClick={() => void persist()}>
          Salvar interpretação
        </button>
        {saveMessage && <small>{saveMessage}</small>}
      </div>
    </div>
  );
}
