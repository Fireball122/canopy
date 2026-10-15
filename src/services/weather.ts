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
  /** True only when the current response came from the weather service. */
  isLive: boolean;
  /** Local timestamp for the response or failed refresh. */
  updatedAt: number;
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

function buildUnavailableWeather(
  locationName: string,
  unit: 'fahrenheit' | 'celsius' = 'celsius',
): WeatherData {
  const isFahrenheit = unit === 'fahrenheit';
  const unitSymbol: '°F' | '°C' = isFahrenheit ? '°F' : '°C';

  return {
    isLive: false,
    updatedAt: Date.now(),
    temp: 0,
    condition: 'Unavailable',
    code: -1,
    feelsLike: 0,
    humidity: 0,
    windSpeed: 0,
    high: 0,
    low: 0,
    locationName,
    unit,
    unitSymbol,
    hourly: [],
    daily: [],
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
      manualLatitude: typeof parsed.manualLatitude === 'number' ? parsed.manualLatitude : undefined,
      manualLongitude:
        typeof parsed.manualLongitude === 'number' ? parsed.manualLongitude : undefined,
      manualCityName: typeof parsed.manualCityName === 'string' ? parsed.manualCityName : undefined,
    };
  } catch {
    return {};
  }
}

async function resolveIpGeolocation(): Promise<CachedGeoLocation | null> {
  const now = Date.now();
  if (cachedIpGeo && now - cachedIpGeo.fetchedAt < 30 * 60 * 1000) {
    return cachedIpGeo;
  }

  // Check persistent storage for last known coordinates
  if (!cachedIpGeo && typeof window !== 'undefined') {
    try {
      const saved = window.localStorage.getItem('canopy_last_known_geo');
      if (saved) {
        cachedIpGeo = JSON.parse(saved) as CachedGeoLocation;
      }
    } catch {
      // Ignore storage errors
    }
  }

  // 1. Primary provider: ipapi.co
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
        try {
          window.localStorage.setItem('canopy_last_known_geo', JSON.stringify(cachedIpGeo));
        } catch {}
        return cachedIpGeo;
      }
    }
  } catch {
    // Primary provider failed, cascade to secondary
  } finally {
    globalThis.clearTimeout(timeoutId);
  }

  // 2. Secondary fallback provider: ipwho.is
  const fbController = new AbortController();
  const fbTimeoutId = globalThis.setTimeout(() => fbController.abort(), 3500);
  try {
    const fbRes = await fetch('https://ipwho.is/', {
      signal: fbController.signal,
      headers: { Accept: 'application/json' },
    });
    if (fbRes.ok) {
      const fbGeo = (await fbRes.json()) as {
        success?: boolean;
        latitude?: number;
        longitude?: number;
        city?: string;
        region_code?: string;
      };
      if (
        fbGeo.success !== false &&
        typeof fbGeo.latitude === 'number' &&
        Number.isFinite(fbGeo.latitude) &&
        typeof fbGeo.longitude === 'number' &&
        Number.isFinite(fbGeo.longitude)
      ) {
        const city = fbGeo.city?.trim() || 'Local Area';
        const region = fbGeo.region_code?.trim();
        const locationName = region ? `${city}, ${region}` : city;
        cachedIpGeo = {
          lat: fbGeo.latitude,
          lon: fbGeo.longitude,
          locationName,
          fetchedAt: now,
        };
        try {
          window.localStorage.setItem('canopy_last_known_geo', JSON.stringify(cachedIpGeo));
        } catch {}
        return cachedIpGeo;
      }
    }
  } catch {
    // Both network requests failed; use last known cached location
  } finally {
    globalThis.clearTimeout(fbTimeoutId);
  }

  return cachedIpGeo;
}

async function resolveManualCoordinates(
  cityName: string,
  fallbackLat?: number,
  fallbackLon?: number,
): Promise<{ lat: number; lon: number; label: string } | null> {
  const trimmed = cityName.trim();
  const hasFallbackCoordinates =
    typeof fallbackLat === 'number' &&
    Number.isFinite(fallbackLat) &&
    typeof fallbackLon === 'number' &&
    Number.isFinite(fallbackLon);

  if (!trimmed) {
    return hasFallbackCoordinates
      ? { lat: fallbackLat, lon: fallbackLon, label: 'Manual location' }
      : null;
  }

  const key = trimmed.toLowerCase();
  if (cachedManualGeo[key]) {
    return cachedManualGeo[key];
  }

  const isDefaultSf =
    typeof fallbackLat === 'number' &&
    typeof fallbackLon === 'number' &&
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
      trimmed,
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
      if (first && typeof first.latitude === 'number' && typeof first.longitude === 'number') {
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

  return typeof fallbackLat === 'number' && typeof fallbackLon === 'number'
    ? { lat: fallbackLat, lon: fallbackLon, label: trimmed }
    : null;
}

export async function fetchWeather(
  optionsOrLat?: WeatherFetchOptions | number,
  lonArg?: number,
  locationNameArg?: string,
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

  const unit: 'fahrenheit' | 'celsius' = options.unit === 'fahrenheit' ? 'fahrenheit' : 'celsius';
  const unitSymbol: '°F' | '°C' = unit === 'fahrenheit' ? '°F' : '°C';
  const locationMode = options.locationMode ?? 'auto';

  let lat = options.manualLatitude;
  let lon = options.manualLongitude;
  let locationName = options.manualCityName?.trim() || 'Manual location';

  if (locationMode === 'auto') {
    const geo = await resolveIpGeolocation();
    if (!geo) {
      return buildUnavailableWeather('Location unavailable', unit);
    }
    lat = geo.lat;
    lon = geo.lon;
    locationName = geo.locationName;
  } else if (options.manualCityName) {
    const resolved = await resolveManualCoordinates(options.manualCityName, lat, lon);
    if (!resolved) {
      return buildUnavailableWeather('Manual location needed', unit);
    }
    lat = resolved.lat;
    lon = resolved.lon;
    locationName = resolved.label;
  }

  if (typeof lat !== 'number' || typeof lon !== 'number') {
    return buildUnavailableWeather('Manual location needed', unit);
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
      return buildUnavailableWeather(locationName, unit);
    }

    const data = (await response.json()) as OpenMeteoResponse;
    if (!data.current) {
      return buildUnavailableWeather(locationName, unit);
    }

    const currentCode = Number(data.current.weather_code ?? 0);
    const currentTemp = Math.round(
      Number(data.current.temperature_2m ?? (unit === 'fahrenheit' ? 70 : 21)),
    );
    const feelsLike = Math.round(Number(data.current.apparent_temperature ?? currentTemp));
    const humidity = Math.round(Number(data.current.relative_humidity_2m ?? 40));
    const windSpeed = Math.round(Number(data.current.wind_speed_10m ?? 6));
    const uvIndex = Math.round(Number(data.current.uv_index ?? data.daily?.uv_index_max?.[0] ?? 4));

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

    const high = daily[0]?.tempMax ?? currentTemp;
    const low = daily[0]?.tempMin ?? currentTemp;

    return {
      isLive: true,
      updatedAt: Date.now(),
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
      hourly,
      daily,
    };
  } catch {
    return buildUnavailableWeather(locationName, unit);
  }
}
