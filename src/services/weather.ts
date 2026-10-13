export interface HourlyForecastItem {
  time: string;
  temp: number;
  condition: string;
  code: number;
}

export interface DailyForecastItem {
  day: string;
  tempMax: number;
  tempMin: number;
  condition: string;
  code: number;
}

export interface WeatherData {
  temp: number;
  condition: string;
  code: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  uvIndex?: number;
  high: number;
  low: number;
  locationName: string;
  unit: 'fahrenheit' | 'celsius';
  unitSymbol: '°F' | '°C';
  hourly: HourlyForecastItem[];
  daily: DailyForecastItem[];
}

export interface WeatherFetchOptions {
  unit?: 'fahrenheit' | 'celsius';
  locationMode?: 'auto' | 'manual';
  manualLatitude?: number;
  manualLongitude?: number;
  manualCityName?: string;
}

interface IpApiResponse {
  latitude?: number;
  longitude?: number;
  city?: string;
  region_code?: string;
  country_name?: string;
}

interface CachedGeoLocation {
  lat: number;
  lon: number;
  locationName: string;
  fetchedAt: number;
}

let cachedIpGeo: CachedGeoLocation | null = null;
const cachedManualGeo: Record<string, { lat: number; lon: number; label: string }> = {};

export function mapWmoCodeToCondition(code: number): string {
  if (code === 0) return 'Clear';
  if (code >= 1 && code <= 3) return 'Partly Cloudy';
  if (code >= 45 && code <= 48) return 'Foggy';
  if (code >= 51 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Showers';
  if (code >= 85 && code <= 86) return 'Snow';
  if (code >= 95 && code <= 99) return 'Thunderstorm';
  return 'Clear';
}

function formatHourLabel(isoTime: string, index: number): string {
  if (index === 0) return 'Now';
  const parsed = new Date(isoTime);
  if (Number.isNaN(parsed.getTime())) {
    return isoTime.slice(11, 16) || `${index}h`;
  }
  const hours = parsed.getHours();
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12} ${suffix}`;
}

function formatDayLabel(isoDate: string, index: number): string {
  if (index === 0) return 'Today';
  const parsed = new Date(`${isoDate}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return isoDate;
  }
  return parsed.toLocaleDateString('en-US', { weekday: 'short' });
}

function buildFallbackWeather(
  locationName: string,
  unit: 'fahrenheit' | 'celsius' = 'celsius'
): WeatherData {
  const isFahrenheit = unit === 'fahrenheit';
  const unitSymbol: '°F' | '°C' = isFahrenheit ? '°F' : '°C';
  const baseTemp = isFahrenheit ? 68 : 20;
  const now = new Date();

  const hourly: HourlyForecastItem[] = Array.from({ length: 8 }, (_, idx) => {
    const future = new Date(now.getTime() + idx * 3600 * 1000);
    const curve = Math.round(Math.sin((idx / 8) * Math.PI) * (isFahrenheit ? 5 : 3));
    const code = idx === 3 || idx === 4 ? 2 : 0;
    return {
      time: formatHourLabel(future.toISOString(), idx),
      temp: baseTemp + curve,
      condition: mapWmoCodeToCondition(code),
      code,
    };
  });

  const dayNames = ['Today', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const daily: DailyForecastItem[] = Array.from({ length: 7 }, (_, idx) => {
    const code = idx === 2 ? 61 : idx % 2 === 1 ? 2 : 0;
    return {
      day: dayNames[idx],
      tempMax: (isFahrenheit ? 74 : 23) - (idx % 3) * (isFahrenheit ? 2 : 1),
      tempMin: (isFahrenheit ? 51 : 11) + (idx % 2) * (isFahrenheit ? 2 : 1),
      condition: mapWmoCodeToCondition(code),
      code,
    };
  });

  return {
    temp: isFahrenheit ? 71 : 22,
    condition: 'Clear',
    code: 0,
    feelsLike: isFahrenheit ? 70 : 21,
    humidity: 36,
    windSpeed: 8,
    uvIndex: 4,
    high: isFahrenheit ? 75 : 24,
    low: isFahrenheit ? 52 : 11,
    locationName,
    unit,
    unitSymbol,
    hourly,
    daily,
  };
}

interface OpenMeteoResponse {
  current?: {
    temperature_2m?: number;
    relative_humidity_2m?: number;
    apparent_temperature?: number;
    wind_speed_10m?: number;
    weather_code?: number;
    uv_index?: number;
  };
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    weather_code?: number[];
  };
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    uv_index_max?: number[];
  };
}

function readStoredWeatherPrefs(): WeatherFetchOptions {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem('canopy_user_settings');
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      unit: parsed.temperatureUnit === 'fahrenheit' ? 'fahrenheit' : 'celsius',
      locationMode: parsed.weatherLocationMode === 'manual' ? 'manual' : 'auto',
      manualLatitude:
        typeof parsed.manualLatitude === 'number' ? parsed.manualLatitude : undefined,
      manualLongitude:
        typeof parsed.manualLongitude === 'number' ? parsed.manualLongitude : undefined,
      manualCityName:
        typeof parsed.manualCityName === 'string' ? parsed.manualCityName : undefined,
    };
  } catch {
    return {};
  }
}

async function resolveIpGeolocation(): Promise<CachedGeoLocation> {
  const now = Date.now();
  if (cachedIpGeo && now - cachedIpGeo.fetchedAt < 30 * 60 * 1000) {
    return cachedIpGeo;
  }

  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), 3500);

  try {
    const res = await fetch('https://ipapi.co/json/', {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const geo = (await res.json()) as IpApiResponse;
      if (
        typeof geo.latitude === 'number' &&
        Number.isFinite(geo.latitude) &&
        typeof geo.longitude === 'number' &&
        Number.isFinite(geo.longitude)
      ) {
        const city = geo.city?.trim() || 'Local Area';
        const region = geo.region_code?.trim();
        const locationName = region ? `${city}, ${region}` : city;
        cachedIpGeo = {
          lat: geo.latitude,
          lon: geo.longitude,
          locationName,
          fetchedAt: now,
        };
        return cachedIpGeo;
      }
    }
  } catch {
    // Fall back to default coordinates on timeout or network error
  } finally {
    globalThis.clearTimeout(timeoutId);
  }

  return (
    cachedIpGeo ?? {
      lat: 37.7749,
      lon: -122.4194,
      locationName: 'San Francisco, CA',
      fetchedAt: now,
    }
  );
}

async function resolveManualCoordinates(
  cityName: string,
  fallbackLat: number,
  fallbackLon: number
): Promise<{ lat: number; lon: number; label: string }> {
  const trimmed = cityName.trim();
  if (!trimmed) {
    return { lat: fallbackLat, lon: fallbackLon, label: 'San Francisco' };
  }

  const key = trimmed.toLowerCase();
  if (cachedManualGeo[key]) {
    return cachedManualGeo[key];
  }

  const isDefaultSf =
    (key === 'san francisco' || key === 'san francisco, ca') &&
    Math.abs(fallbackLat - 37.7749) < 0.01 &&
    Math.abs(fallbackLon - -122.4194) < 0.01;
  if (isDefaultSf) {
    return { lat: fallbackLat, lon: fallbackLon, label: trimmed };
  }

  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), 3000);
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
      trimmed
    )}&count=1&language=en&format=json`;
    const res = await fetch(url, { signal: controller.signal });
    if (res.ok) {
      const data = (await res.json()) as {
        results?: Array<{
          name?: string;
          admin1?: string;
          country_code?: string;
          latitude?: number;
          longitude?: number;
        }>;
      };
      const first = data.results?.[0];
      if (
        first &&
        typeof first.latitude === 'number' &&
        typeof first.longitude === 'number'
      ) {
        const resolvedLabel = first.admin1
          ? `${first.name || trimmed}, ${first.admin1}`
          : first.name || trimmed;
        const entry = {
          lat: first.latitude,
          lon: first.longitude,
          label: resolvedLabel,
        };
        cachedManualGeo[key] = entry;
        return entry;
      }
    }
  } catch {
    // Ignore geocoding error and use provided fallback coordinates
  } finally {
    globalThis.clearTimeout(timeoutId);
  }

  return { lat: fallbackLat, lon: fallbackLon, label: trimmed };
}

export async function fetchWeather(
  optionsOrLat?: WeatherFetchOptions | number,
  lonArg?: number,
  locationNameArg?: string
): Promise<WeatherData> {
  const stored = readStoredWeatherPrefs();

  let options: WeatherFetchOptions;
  if (typeof optionsOrLat === 'number') {
    options = {
      unit: stored.unit ?? 'celsius',
      locationMode: 'manual',
      manualLatitude: optionsOrLat,
      manualLongitude: typeof lonArg === 'number' ? lonArg : -104.9903,
      manualCityName: locationNameArg || 'Denver, CO',
    };
  } else {
    options = {
      ...stored,
      ...optionsOrLat,
    };
  }

  const unit: 'fahrenheit' | 'celsius' =
    options.unit === 'fahrenheit' ? 'fahrenheit' : 'celsius';
  const unitSymbol: '°F' | '°C' = unit === 'fahrenheit' ? '°F' : '°C';
  const locationMode = options.locationMode ?? 'auto';

  let lat = options.manualLatitude ?? 37.7749;
  let lon = options.manualLongitude ?? -122.4194;
  let locationName = options.manualCityName?.trim() || 'San Francisco';

  if (locationMode === 'auto') {
    const geo = await resolveIpGeolocation();
    lat = geo.lat;
    lon = geo.lon;
    locationName = geo.locationName;
  } else if (options.manualCityName) {
    const resolved = await resolveManualCoordinates(options.manualCityName, lat, lon);
    lat = resolved.lat;
    lon = resolved.lon;
    locationName = resolved.label;
  }

  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,weather_code,uv_index` +
    `&hourly=temperature_2m,weather_code` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,uv_index_max` +
    `&temperature_unit=${unit === 'fahrenheit' ? 'fahrenheit' : 'celsius'}` +
    `&wind_speed_unit=mph&timezone=auto`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return buildFallbackWeather(locationName, unit);
    }

    const data = (await response.json()) as OpenMeteoResponse;
    if (!data.current) {
      return buildFallbackWeather(locationName, unit);
    }

    const currentCode = Number(data.current.weather_code ?? 0);
    const currentTemp = Math.round(
      Number(data.current.temperature_2m ?? (unit === 'fahrenheit' ? 70 : 21))
    );
    const feelsLike = Math.round(Number(data.current.apparent_temperature ?? currentTemp));
    const humidity = Math.round(Number(data.current.relative_humidity_2m ?? 40));
    const windSpeed = Math.round(Number(data.current.wind_speed_10m ?? 6));
    const uvIndex = Math.round(
      Number(data.current.uv_index ?? data.daily?.uv_index_max?.[0] ?? 4)
    );

    const hourlyTimes = data.hourly?.time ?? [];
    const hourlyTemps = data.hourly?.temperature_2m ?? [];
    const hourlyCodes = data.hourly?.weather_code ?? [];

    const nowMs = Date.now();
    let startIdx = hourlyTimes.findIndex((iso) => {
      const ms = new Date(iso).getTime();
      return !Number.isNaN(ms) && ms >= nowMs - 45 * 60 * 1000;
    });
    if (startIdx < 0) startIdx = 0;

    const hourly: HourlyForecastItem[] = hourlyTimes
      .slice(startIdx, startIdx + 8)
      .map((iso, idx) => {
        const actualIdx = startIdx + idx;
        const code = Number(hourlyCodes[actualIdx] ?? currentCode);
        return {
          time: formatHourLabel(iso, idx),
          temp: Math.round(Number(hourlyTemps[actualIdx] ?? currentTemp)),
          condition: mapWmoCodeToCondition(code),
          code,
        };
      });

    const dailyDates = data.daily?.time ?? [];
    const dailyCodes = data.daily?.weather_code ?? [];
    const dailyMax = data.daily?.temperature_2m_max ?? [];
    const dailyMin = data.daily?.temperature_2m_min ?? [];

    const daily: DailyForecastItem[] = dailyDates.slice(0, 7).map((isoDate, idx) => {
      const code = Number(dailyCodes[idx] ?? currentCode);
      return {
        day: formatDayLabel(isoDate, idx),
        tempMax: Math.round(Number(dailyMax[idx] ?? currentTemp + 4)),
        tempMin: Math.round(Number(dailyMin[idx] ?? currentTemp - 8)),
        condition: mapWmoCodeToCondition(code),
        code,
      };
    });

    const fallback = buildFallbackWeather(locationName, unit);
    const high = daily[0]?.tempMax ?? currentTemp + 4;
    const low = daily[0]?.tempMin ?? currentTemp - 8;

    return {
      temp: currentTemp,
      condition: mapWmoCodeToCondition(currentCode),
      code: currentCode,
      feelsLike,
      humidity,
      windSpeed,
      uvIndex,
      high,
      low,
      locationName,
      unit,
      unitSymbol,
      hourly: hourly.length > 0 ? hourly : fallback.hourly,
      daily: daily.length > 0 ? daily : fallback.daily,
    };
  } catch {
    return buildFallbackWeather(locationName, unit);
  }
}
