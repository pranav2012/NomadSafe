export interface ForecastStep {
  t: number;
  temp: number | null;
  feels: number | null;
  uv: number | null;
  cloud: number | null;
  sym1: string | null;
  sym6: string | null;
  max6: number | null;
  min6: number | null;
  rain1: number | null;
  rain6: number | null;
}

export interface DailyForecast {
  date: string;
  weatherCode: number;
  tempMax: number;
  tempMin: number | null;
  feelsLike: number | null;
  uvIndex: number | null;
  precipMm: number | null;
}

export interface CurrentWeather {
  temperature: number;
  weatherCode: number;
  isDay: boolean;
}

export interface HourWeather extends CurrentWeather {
  t: number;
}

/** What the server stores and sends per place: ~2–3 KB, so cache reads stay cheap at any user count. */
export interface PlaceSummary {
  days: DailyForecast[];
  hours: HourWeather[];
}

interface MetTimeseries {
  time?: string;
  data?: {
    instant?: { details?: Record<string, number | undefined> };
    next_1_hours?: { summary?: { symbol_code?: string }; details?: Record<string, number | undefined> };
    next_6_hours?: { summary?: { symbol_code?: string }; details?: Record<string, number | undefined> };
  };
}

const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : null);

/** Trims a Locationforecast "complete" response to the fields the app uses. */
export function parseMetSteps(json: unknown): ForecastStep[] {
  const series = (json as { properties?: { timeseries?: MetTimeseries[] } })?.properties?.timeseries ?? [];
  return series.flatMap((entry) => {
    const t = entry.time ? Date.parse(entry.time) : NaN;
    if (!Number.isFinite(t)) return [];
    const now = entry.data?.instant?.details ?? {};
    const h1 = entry.data?.next_1_hours;
    const h6 = entry.data?.next_6_hours;
    return [
      {
        t,
        temp: num(now.air_temperature),
        feels: num(now.apparent_air_temperature),
        uv: num(now.ultraviolet_index_clear_sky),
        cloud: num(now.cloud_area_fraction),
        sym1: h1?.summary?.symbol_code ?? null,
        sym6: h6?.summary?.symbol_code ?? null,
        max6: num(h6?.details?.air_temperature_max),
        min6: num(h6?.details?.air_temperature_min),
        rain1: num(h1?.details?.precipitation_amount),
        rain6: num(h6?.details?.precipitation_amount),
      },
    ];
  });
}

/** MET symbol code (e.g. "lightrainshowers_day") as the WMO weather code the app's icons use; higher is more severe. */
export function symbolToWmo(symbol: string | null): number | null {
  if (!symbol) return null;
  const s = symbol.replace(/_(day|night|polartwilight)$/, "");
  if (s.includes("thunder")) return 95;
  if (s === "clearsky") return 0;
  if (s === "fair") return 1;
  if (s === "partlycloudy") return 2;
  if (s === "cloudy") return 3;
  if (s === "fog") return 45;
  const showers = s.endsWith("showers");
  const heavy = s.startsWith("heavy");
  const light = s.startsWith("light");
  if (s.includes("snow")) return showers ? (heavy ? 86 : 85) : heavy ? 75 : light ? 71 : 73;
  if (s.includes("sleet")) return showers ? 81 : 67;
  if (s.includes("rain")) return showers ? (heavy ? 82 : light ? 80 : 81) : heavy ? 65 : light ? 61 : 63;
  return null;
}

/** The next ~24 hourly steps from an hour ago, so the phone can show current conditions without asking again. */
export function hourlyOutlook(steps: ForecastStep[], now: number): HourWeather[] {
  return steps
    .filter((step) => step.t >= now - 3_600_000 && step.sym1 != null && step.temp != null)
    .slice(0, 24)
    .flatMap((step) => {
      const code = symbolToWmo(step.sym1);
      return code == null ? [] : [{ t: step.t, temperature: Math.round(step.temp!), weatherCode: code, isDay: !/_(night|polartwilight)$/.test(step.sym1!) }];
    });
}

/** Cloud cover (0..1) and whether a thunderstorm is forecast for the coming hour, for the globe's cloud grid. */
export function cloudCell(steps: ForecastStep[], now: number) {
  const started = steps.filter((step) => step.t <= now);
  const step = started[started.length - 1] ?? steps[0];
  if (!step || step.cloud == null) return null;
  return { cover: Math.min(1, Math.max(0, step.cloud / 100)), storm: symbolToWmo(step.sym1 ?? step.sym6) === 95 };
}

/**
 * Daily summaries in the destination's local days, using the solar offset (longitude / 15 h) since MET
 * answers in UTC. The 6-hourly tail adds each window's max/min and rain; the icon is the most severe daytime symbol.
 */
export function dailyForecast(steps: ForecastStep[], longitude: number): DailyForecast[] {
  const offsetMs = Math.round(longitude / 15) * 3_600_000;
  const days = new Map<string, { temps: number[]; feels: number[]; uv: number[]; rain: number; rainSeen: boolean; dayCodes: number[]; codes: number[] }>();
  for (const step of steps) {
    const local = new Date(step.t + offsetMs);
    const date = local.toISOString().slice(0, 10);
    const day = days.get(date) ?? { temps: [], feels: [], uv: [], rain: 0, rainSeen: false, dayCodes: [], codes: [] };
    days.set(date, day);
    const hourly = step.sym1 != null || step.rain1 != null;
    if (step.temp != null) day.temps.push(step.temp);
    if (!hourly && step.max6 != null) day.temps.push(step.max6);
    if (!hourly && step.min6 != null) day.temps.push(step.min6);
    if (step.feels != null) day.feels.push(step.feels);
    if (step.uv != null) day.uv.push(step.uv);
    const rain = hourly ? step.rain1 : step.rain6;
    if (rain != null) {
      day.rain += rain;
      day.rainSeen = true;
    }
    const code = symbolToWmo(hourly ? step.sym1 : step.sym6);
    if (code != null) {
      day.codes.push(code);
      const hour = local.getUTCHours();
      if (hour >= 6 && hour < 18) day.dayCodes.push(code);
    }
  }
  const result: DailyForecast[] = [];
  for (const [date, day] of days) {
    const codes = day.dayCodes.length ? day.dayCodes : day.codes;
    if (!day.temps.length || !codes.length) continue;
    result.push({
      date,
      weatherCode: Math.max(...codes),
      tempMax: Math.round(Math.max(...day.temps)),
      tempMin: day.temps.length > 1 ? Math.round(Math.min(...day.temps)) : null,
      feelsLike: day.feels.length ? Math.round(Math.max(...day.feels)) : null,
      uvIndex: day.uv.length ? Math.round(Math.max(...day.uv)) : null,
      precipMm: day.rainSeen ? Math.round(day.rain * 10) / 10 : null,
    });
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
}

/** Coordinates rounded to 0.1° (~11 km): the cache key, and all the precision MET Norway is sent. */
export function weatherCell(latitude: number, longitude: number) {
  const lat = Math.round(Math.max(-90, Math.min(90, latitude)) * 10) / 10;
  const lng = Math.round((((longitude + 540) % 360) - 180) * 10) / 10;
  return { lat, lng, key: `${lat.toFixed(1)},${lng.toFixed(1)}` };
}
