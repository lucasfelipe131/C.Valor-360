import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HourlyForecast = {
  time?: string[];
  temperature_2m?: number[];
  relative_humidity_2m?: number[];
  apparent_temperature?: number[];
  precipitation_probability?: number[];
  precipitation?: number[];
  rain?: number[];
  weather_code?: number[];
  cloud_cover?: number[];
  visibility?: number[];
  wind_speed_10m?: number[];
  wind_direction_10m?: number[];
  wind_gusts_10m?: number[];
  soil_temperature_0cm?: number[];
  soil_moisture_0_to_1cm?: number[];
  shortwave_radiation?: number[];
  et0_fao_evapotranspiration?: number[];
  vapour_pressure_deficit?: number[];
};

type DailyForecast = {
  time?: string[];
  weather_code?: number[];
  temperature_2m_max?: number[];
  temperature_2m_min?: number[];
  apparent_temperature_max?: number[];
  apparent_temperature_min?: number[];
  sunrise?: string[];
  sunset?: string[];
  uv_index_max?: number[];
  precipitation_probability_max?: number[];
  precipitation_sum?: number[];
  rain_sum?: number[];
  precipitation_hours?: number[];
  et0_fao_evapotranspiration?: number[];
  wind_speed_10m_max?: number[];
  wind_gusts_10m_max?: number[];
  wind_direction_10m_dominant?: number[];
};

type ForecastData = {
  latitude?: number;
  longitude?: number;
  elevation?: number;
  timezone?: string;
  timezone_abbreviation?: string;
  current?: {
    time?: string;
    temperature_2m?: number;
    relative_humidity_2m?: number;
    apparent_temperature?: number;
    is_day?: number;
    precipitation?: number;
    rain?: number;
    weather_code?: number;
    cloud_cover?: number;
    surface_pressure?: number;
    wind_speed_10m?: number;
    wind_direction_10m?: number;
    wind_gusts_10m?: number;
  };
  hourly?: HourlyForecast;
  daily?: DailyForecast;
};

type ApplicationStatus = "favorable" | "attention" | "avoid";

function numeric(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rounded(value: number, digits = 1) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function sum(values: Array<number | undefined>) {
  return rounded(values.reduce<number>((total, value) => total + (Number(value) || 0), 0));
}

async function reverseGeocode(latitude: number, longitude: number) {
  const response = await fetch(
    `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${latitude.toFixed(5)}&longitude=${longitude.toFixed(5)}&localityLanguage=pt`,
    { next: { revalidate: 86400 }, signal: AbortSignal.timeout(7000) },
  );
  if (!response.ok) throw new Error("Não foi possível confirmar a cidade.");
  const data = await response.json() as {
    city?: string;
    locality?: string;
    principalSubdivision?: string;
    countryName?: string;
  };
  return {
    city: data.city || data.locality || "Localização atual",
    region: data.principalSubdivision || "",
    country: data.countryName || "Brasil",
  };
}

async function openMeteo(latitude: number, longitude: number): Promise<ForecastData> {
  const params = new URLSearchParams({
    latitude: latitude.toFixed(5),
    longitude: longitude.toFixed(5),
    current: [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "is_day",
      "precipitation",
      "rain",
      "weather_code",
      "cloud_cover",
      "surface_pressure",
      "wind_speed_10m",
      "wind_direction_10m",
      "wind_gusts_10m",
    ].join(","),
    hourly: [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "precipitation_probability",
      "precipitation",
      "rain",
      "weather_code",
      "cloud_cover",
      "visibility",
      "wind_speed_10m",
      "wind_direction_10m",
      "wind_gusts_10m",
      "soil_temperature_0cm",
      "soil_moisture_0_to_1cm",
      "shortwave_radiation",
      "et0_fao_evapotranspiration",
      "vapour_pressure_deficit",
    ].join(","),
    daily: [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "apparent_temperature_max",
      "apparent_temperature_min",
      "sunrise",
      "sunset",
      "uv_index_max",
      "precipitation_probability_max",
      "precipitation_sum",
      "rain_sum",
      "precipitation_hours",
      "et0_fao_evapotranspiration",
      "wind_speed_10m_max",
      "wind_gusts_10m_max",
      "wind_direction_10m_dominant",
    ].join(","),
    timezone: "auto",
    past_days: "1",
    forecast_days: "7",
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params.toString()}`, {
    next: { revalidate: 900 },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`Serviço meteorológico indisponível (${response.status}).`);
  return response.json() as Promise<ForecastData>;
}

function filterDaily(daily: DailyForecast | undefined, firstDate: string): DailyForecast {
  if (!daily?.time?.length) return daily ?? {};
  const firstIndex = Math.max(0, daily.time.findIndex((date) => date >= firstDate));
  const result: DailyForecast = {};
  for (const [key, values] of Object.entries(daily)) {
    result[key as keyof DailyForecast] = values?.slice(firstIndex) as never;
  }
  return result;
}

function hourlyIndexes(hourly: HourlyForecast | undefined, start: string, end: string) {
  return (hourly?.time ?? [])
    .map((time, index) => ({ time, index }))
    .filter(({ time }) => time >= start && time < end);
}

function isFavorableApplicationHour(hourly: HourlyForecast, index: number) {
  const wind = hourly.wind_speed_10m?.[index] ?? 999;
  const gust = hourly.wind_gusts_10m?.[index] ?? 999;
  const humidity = hourly.relative_humidity_2m?.[index] ?? 0;
  const temperature = hourly.temperature_2m?.[index] ?? 999;
  const rainChance = hourly.precipitation_probability?.[index] ?? 100;
  const precipitation = hourly.precipitation?.[index] ?? 99;
  return wind >= 3 && wind <= 15 && gust <= 25 && humidity >= 55 && temperature <= 30 && rainChance <= 20 && precipitation <= 0.1;
}

function applicationAssessment(forecast: ForecastData, next24: Array<{ time: string; index: number }>) {
  const current = forecast.current ?? {};
  const reasons: string[] = [];
  if ((current.wind_speed_10m ?? 0) < 3) reasons.push("vento abaixo de 3 km/h");
  if ((current.wind_speed_10m ?? 0) > 15) reasons.push("vento acima de 15 km/h");
  if ((current.wind_gusts_10m ?? 0) > 25) reasons.push("rajadas acima de 25 km/h");
  if ((current.relative_humidity_2m ?? 100) < 55) reasons.push("umidade abaixo de 55%");
  if ((current.temperature_2m ?? 0) > 30) reasons.push("temperatura acima de 30 °C");
  if ((current.precipitation ?? 0) > 0) reasons.push("precipitação no momento");
  const rainSoon = next24.slice(0, 3).some(({ index }) =>
    (forecast.hourly?.precipitation_probability?.[index] ?? 0) > 20
    || (forecast.hourly?.precipitation?.[index] ?? 0) > 0.1,
  );
  if (rainSoon && (current.precipitation ?? 0) <= 0) reasons.push("chuva provável nas próximas 3h");

  const currentStatus: ApplicationStatus = reasons.some((reason) =>
    reason.includes("precipitação")
    || reason.includes("chuva provável")
    || reason.includes("rajadas")
    || reason.includes("vento acima"),
  )
    ? "avoid"
    : reasons.length
      ? "attention"
      : "favorable";

  let bestWindow: { start: string; end: string; hours: number } | null = null;
  let windowStart = -1;
  next24.forEach(({ index }, position) => {
    const favorable = isFavorableApplicationHour(forecast.hourly ?? {}, index);
    if (favorable && windowStart < 0) windowStart = position;
    const closes = windowStart >= 0 && (!favorable || position === next24.length - 1);
    if (!closes) return;
    const windowEnd = favorable && position === next24.length - 1 ? position : position - 1;
    const hours = windowEnd - windowStart + 1;
    if (hours >= 2 && (!bestWindow || hours > bestWindow.hours)) {
      bestWindow = {
        start: next24[windowStart].time,
        end: next24[windowEnd].time,
        hours,
      };
    }
    windowStart = -1;
  });

  return {
    status: currentStatus,
    reasons,
    best_window: bestWindow,
    criteria: "Indicador: vento 3–15 km/h, rajadas até 25 km/h, UR ≥55%, temperatura ≤30 °C e chuva ≤20%.",
  };
}

function deriveAgronomicData(forecast: ForecastData) {
  const now = forecast.current?.time ?? new Date().toISOString().slice(0, 16);
  const nowDate = new Date(now);
  const last24Start = new Date(nowDate.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
  const next24End = new Date(nowDate.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 16);
  const next48End = new Date(nowDate.getTime() + 48 * 60 * 60 * 1000).toISOString().slice(0, 16);
  const last24 = hourlyIndexes(forecast.hourly, last24Start, now);
  const next24 = hourlyIndexes(forecast.hourly, now, next24End);
  const next48 = hourlyIndexes(forecast.hourly, now, next48End);
  const rainfall = forecast.hourly?.precipitation ?? [];
  const nextRain = next48.find(({ index }) =>
    (forecast.hourly?.precipitation_probability?.[index] ?? 0) >= 40 && (rainfall[index] ?? 0) > 0.1,
  );
  const todayRain = forecast.daily?.precipitation_sum?.[0] ?? 0;
  const todayEt0 = forecast.daily?.et0_fao_evapotranspiration?.[0] ?? 0;
  const alerts: Array<{ level: "attention" | "high"; label: string }> = [];
  if ((forecast.daily?.temperature_2m_min?.[0] ?? 99) <= 3) alerts.push({ level: "high", label: "Risco de frio/geada: mínima prevista próxima ou abaixo de 3 °C." });
  if ((forecast.daily?.temperature_2m_max?.[0] ?? 0) >= 32) alerts.push({ level: "attention", label: "Estresse térmico: máxima prevista a partir de 32 °C." });
  if (todayRain >= 30) alerts.push({ level: "high", label: "Chuva volumosa: acumulado diário previsto a partir de 30 mm." });
  if ((forecast.daily?.wind_gusts_10m_max?.[0] ?? 0) >= 40) alerts.push({ level: "attention", label: "Rajadas fortes previstas, com impacto em operações de campo." });
  if ((forecast.daily?.uv_index_max?.[0] ?? 0) >= 8) alerts.push({ level: "attention", label: "Índice UV muito alto; reforce a proteção da equipe em campo." });

  return {
    rain_last_24h: sum(last24.map(({ index }) => rainfall[index])),
    rain_next_24h: sum(next24.map(({ index }) => rainfall[index])),
    water_balance_today: rounded(todayRain - todayEt0),
    next_rain: nextRain ? {
      time: nextRain.time,
      probability: forecast.hourly?.precipitation_probability?.[nextRain.index] ?? 0,
      amount: rainfall[nextRain.index] ?? 0,
    } : null,
    application: applicationAssessment(forecast, next24),
    alerts,
  };
}

export async function GET(request: NextRequest) {
  const latitude = numeric(request.nextUrl.searchParams.get("latitude"));
  const longitude = numeric(request.nextUrl.searchParams.get("longitude"));
  if (latitude === null || longitude === null || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return NextResponse.json({ error: "Coordenadas inválidas." }, { status: 400 });
  }

  try {
    const [forecast, placeResult] = await Promise.all([
      openMeteo(latitude, longitude),
      reverseGeocode(latitude, longitude).catch(() => ({ city: "Localização atual", region: "", country: "Brasil" })),
    ]);
    const currentDate = forecast.current?.time?.slice(0, 10) ?? new Date().toISOString().slice(0, 10);
    const normalized = { ...forecast, daily: filterDaily(forecast.daily, currentDate) };
    return NextResponse.json({
      ...normalized,
      ...placeResult,
      source: "open-meteo",
      sourceUrl: "https://open-meteo.com/",
      sourceNote: "Modelo meteorológico para a coordenada atual; 1–3 dias têm maior confiança e 4–7 dias indicam tendência.",
      updatedAt: new Date().toISOString(),
      agronomic: deriveAgronomicData(normalized),
    }, { headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=1800" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Previsão indisponível." },
      { status: 502 },
    );
  }
}
