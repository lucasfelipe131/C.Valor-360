export type GeoPoint = {
  lat: number;
  lng: number;
};

export type ImportedBoundary = {
  id: string;
  label: string;
  points: GeoPoint[];
  properties: Record<string, string>;
};

const EARTH_RADIUS_M = 6_371_008.8;

function samePoint(a: GeoPoint, b: GeoPoint) {
  return Math.abs(a.lat - b.lat) < 1e-10 && Math.abs(a.lng - b.lng) < 1e-10;
}

export function normalizePolygon(points: GeoPoint[]) {
  const normalized: GeoPoint[] = [];
  points.forEach((point) => {
    const lat = Number(point?.lat);
    const lng = Number(point?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;
    const next = { lat: Number(lat.toFixed(7)), lng: Number(lng.toFixed(7)) };
    if (!normalized.length || !samePoint(normalized[normalized.length - 1], next)) {
      normalized.push(next);
    }
  });
  if (normalized.length > 1 && samePoint(normalized[0], normalized[normalized.length - 1])) {
    normalized.pop();
  }
  return normalized;
}

function projected(points: GeoPoint[]) {
  const meanLat = points.reduce((sum, point) => sum + point.lat, 0) / Math.max(1, points.length);
  const radians = (meanLat * Math.PI) / 180;
  return points.map((point) => ({
    x: point.lng * 111_320 * Math.cos(radians),
    y: point.lat * 110_540,
  }));
}

export function polygonAreaHa(rawPoints: GeoPoint[]) {
  const points = normalizePolygon(rawPoints);
  if (points.length < 3) return 0;
  const xy = projected(points);
  let twiceArea = 0;
  xy.forEach((point, index) => {
    const next = xy[(index + 1) % xy.length];
    twiceArea += point.x * next.y - next.x * point.y;
  });
  return Math.abs(twiceArea) / 2 / 10_000;
}

function haversineMeters(a: GeoPoint, b: GeoPoint) {
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const latitudeDelta = toRadians(b.lat - a.lat);
  const longitudeDelta = toRadians(b.lng - a.lng);
  const startLatitude = toRadians(a.lat);
  const endLatitude = toRadians(b.lat);
  const h =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) * Math.cos(endLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function polygonPerimeterM(rawPoints: GeoPoint[]) {
  const points = normalizePolygon(rawPoints);
  if (points.length < 2) return 0;
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + haversineMeters(point, next);
  }, 0);
}

export function polygonCentroid(rawPoints: GeoPoint[]) {
  const points = normalizePolygon(rawPoints);
  if (!points.length) return null;
  if (points.length < 3) {
    return {
      lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
      lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
    };
  }
  let factorSum = 0;
  let latitudeSum = 0;
  let longitudeSum = 0;
  points.forEach((point, index) => {
    const next = points[(index + 1) % points.length];
    const factor = point.lng * next.lat - next.lng * point.lat;
    factorSum += factor;
    longitudeSum += (point.lng + next.lng) * factor;
    latitudeSum += (point.lat + next.lat) * factor;
  });
  if (Math.abs(factorSum) < 1e-12) {
    return {
      lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
      lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
    };
  }
  return {
    lat: latitudeSum / (3 * factorSum),
    lng: longitudeSum / (3 * factorSum),
  };
}

function pointSegmentDistance(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  if (!deltaX && !deltaY) return Math.hypot(point.x - start.x, point.y - start.y);
  const ratio = Math.max(0, Math.min(1,
    ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) /
      (deltaX * deltaX + deltaY * deltaY),
  ));
  return Math.hypot(
    point.x - (start.x + ratio * deltaX),
    point.y - (start.y + ratio * deltaY),
  );
}

export function simplifyPolygon(rawPoints: GeoPoint[], toleranceMeters = 2) {
  const points = normalizePolygon(rawPoints);
  if (points.length <= 4 || toleranceMeters <= 0) return points;
  const xy = projected(points);
  const keep = new Set<number>([0, points.length - 1]);
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [start, end] = stack.pop() as [number, number];
    let farthestDistance = 0;
    let farthestIndex = -1;
    for (let index = start + 1; index < end; index += 1) {
      const distance = pointSegmentDistance(xy[index], xy[start], xy[end]);
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthestIndex = index;
      }
    }
    if (farthestIndex > start && farthestDistance > toleranceMeters) {
      keep.add(farthestIndex);
      stack.push([start, farthestIndex], [farthestIndex, end]);
    }
  }
  const simplified = points.filter((_, index) => keep.has(index));
  return simplified.length >= 3 ? simplified : points;
}

function stringProperties(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => ["string", "number", "boolean"].includes(typeof item))
      .slice(0, 40)
      .map(([key, item]) => [key.slice(0, 80), String(item).slice(0, 300)]),
  );
}

function ringsFromGeometry(geometry: unknown): GeoPoint[][] {
  if (!geometry || typeof geometry !== "object") return [];
  const item = geometry as { type?: string; coordinates?: unknown };
  if (item.type === "Polygon" && Array.isArray(item.coordinates)) {
    const exterior = item.coordinates[0];
    if (!Array.isArray(exterior)) return [];
    return [normalizePolygon(exterior.map((coordinate) => {
      const pair = coordinate as [unknown, unknown];
      return { lng: Number(pair?.[0]), lat: Number(pair?.[1]) };
    }))];
  }
  if (item.type === "MultiPolygon" && Array.isArray(item.coordinates)) {
    return item.coordinates.flatMap((polygon) =>
      ringsFromGeometry({ type: "Polygon", coordinates: polygon }),
    );
  }
  return [];
}

export function parseGeoJsonBoundaries(raw: unknown): ImportedBoundary[] {
  const features = raw && typeof raw === "object" && (raw as { type?: string }).type === "FeatureCollection"
    ? ((raw as { features?: unknown[] }).features ?? [])
    : [raw];
  const boundaries: ImportedBoundary[] = [];
  features.forEach((feature, featureIndex) => {
    const candidate = feature && typeof feature === "object" ? feature as Record<string, unknown> : {};
    const geometry = candidate.type === "Feature" ? candidate.geometry : candidate;
    const properties = candidate.type === "Feature" ? stringProperties(candidate.properties) : {};
    ringsFromGeometry(geometry).forEach((points, ringIndex) => {
      if (points.length < 3) return;
      const label = properties.nome_area || properties.name || properties.NOME || `Polígono ${featureIndex + 1}`;
      boundaries.push({
        id: `import-${featureIndex}-${ringIndex}`,
        label,
        points,
        properties,
      });
    });
  });
  return boundaries.sort((a, b) => polygonAreaHa(b.points) - polygonAreaHa(a.points));
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function parseKmlBoundaries(source: string): ImportedBoundary[] {
  const placemarks = source.match(/<Placemark\b[\s\S]*?<\/Placemark>/gi) ?? [source];
  const boundaries: ImportedBoundary[] = [];
  placemarks.forEach((placemark, placemarkIndex) => {
    const label = decodeXml(placemark.match(/<name\b[^>]*>([\s\S]*?)<\/name>/i)?.[1]?.trim() || `Polígono ${placemarkIndex + 1}`);
    const properties: Record<string, string> = {};
    for (const match of placemark.matchAll(/<(?:Data\s+name|SimpleData\s+name)=["']([^"']+)["'][^>]*>(?:<value>)?([\s\S]*?)(?:<\/value>)?<\/(?:Data|SimpleData)>/gi)) {
      properties[decodeXml(match[1]).slice(0, 80)] = decodeXml(match[2].replace(/<[^>]+>/g, "").trim()).slice(0, 300);
    }
    const polygonBlocks = placemark.match(/<Polygon\b[\s\S]*?<\/Polygon>/gi) ?? [];
    const coordinateBlocks = polygonBlocks.length
      ? polygonBlocks.flatMap((polygon) => {
          const outer = polygon.match(/<outerBoundaryIs\b[\s\S]*?<coordinates\b[^>]*>[\s\S]*?<\/coordinates>[\s\S]*?<\/outerBoundaryIs>/i)?.[0];
          const coordinates = outer?.match(/<coordinates\b[^>]*>[\s\S]*?<\/coordinates>/i)?.[0];
          return coordinates ? [coordinates] : [];
        })
      : placemark.match(/<coordinates\b[^>]*>[\s\S]*?<\/coordinates>/gi) ?? [];
    coordinateBlocks.forEach((block, ringIndex) => {
      const content = block.replace(/^.*?>/, "").replace(/<\/coordinates>.*$/i, "");
      const points = normalizePolygon(content.trim().split(/\s+/).map((coordinate) => {
        const [lng, lat] = coordinate.split(",").map(Number);
        return { lat, lng };
      }));
      if (points.length >= 3) {
        boundaries.push({ id: `kml-${placemarkIndex}-${ringIndex}`, label, points, properties });
      }
    });
  });
  return boundaries.sort((a, b) => polygonAreaHa(b.points) - polygonAreaHa(a.points));
}

export function parseBoundaryFile(source: string, fileName: string) {
  if (/\.kml$/i.test(fileName) || /^\s*<\?xml|<kml\b/i.test(source)) {
    return parseKmlBoundaries(source);
  }
  return parseGeoJsonBoundaries(JSON.parse(source) as unknown);
}

export function boundaryAsGeoJson(points: GeoPoint[], properties: Record<string, string> = {}) {
  const normalized = normalizePolygon(points);
  const coordinates = normalized.map((point) => [point.lng, point.lat]);
  if (coordinates.length) coordinates.push([...coordinates[0]]);
  return JSON.stringify({
    type: "Feature",
    properties,
    geometry: { type: "Polygon", coordinates: [coordinates] },
  }, null, 2);
}

export function boundaryAsKml(points: GeoPoint[], name = "Talhão") {
  const normalized = normalizePolygon(points);
  const coordinates = [...normalized, ...(normalized.length ? [normalized[0]] : [])]
    .map((point) => `${point.lng.toFixed(7)},${point.lat.toFixed(7)},0`)
    .join(" ");
  const safeName = name.replace(/[<>&"']/g, "");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>${safeName}</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${coordinates}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>`;
}
