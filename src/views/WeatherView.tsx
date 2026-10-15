import {
  Cloud,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Droplets,
  MapPin,
  RefreshCw,
  Sparkles,
  Sun,
  Thermometer,
  Wind,
} from 'lucide-react';
import type React from 'react';
import type { WeatherData } from '../services/weather';

export interface WeatherViewProps {
  weather: WeatherData;
  tempUnit: string;
  weatherLoading: boolean;
  onRefreshWeather: () => void;
  locationMode?: 'auto' | 'manual';
}

export function renderWeatherIcon(
  code: number,
  condition: string,
  sizeClass = 'w-7 h-7',
): React.ReactNode {
  const lower = condition.toLowerCase();
  if (code >= 95 || lower.includes('thunder')) {
    return (
      <CloudLightning
        className={`${sizeClass} text-[#f9e2af] drop-shadow-[0_0_8px_rgba(249,226,175,0.45)]`}
        strokeWidth={1.75}
      />
    );
  }
  if ((code >= 71 && code <= 86) || lower.includes('snow')) {
    return (
      <CloudSnow
        className={`${sizeClass} text-[#89dceb] drop-shadow-[0_0_8px_rgba(137,220,235,0.45)]`}
        strokeWidth={1.75}
      />
    );
  }
  if (
    (code >= 51 && code <= 67) ||
    (code >= 80 && code <= 82) ||
    lower.includes('rain') ||
    lower.includes('drizzle')
  ) {
    return (
      <CloudRain
        className={`${sizeClass} text-[#89b4fa] drop-shadow-[0_0_8px_rgba(137,180,250,0.45)]`}
        strokeWidth={1.75}
      />
    );
  }
  if (code === 1 || code === 2 || lower.includes('partly') || lower.includes('mostly')) {
    return (
      <CloudSun
        className={`${sizeClass} text-[#fab387] drop-shadow-[0_0_8px_rgba(250,179,135,0.45)]`}
        strokeWidth={1.75}
      />
    );
  }
  if (code === 3 || lower.includes('cloud') || lower.includes('overcast')) {
    return (
      <Cloud
        className={`${sizeClass} text-[#a6adc8] drop-shadow-[0_0_8px_rgba(166,173,200,0.4)]`}
        strokeWidth={1.75}
      />
    );
  }
  return (
    <Sun
      className={`${sizeClass} text-[#f9e2af] drop-shadow-[0_0_8px_rgba(249,226,175,0.45)]`}
      strokeWidth={1.75}
    />
  );
}

export const WeatherView: React.FC<WeatherViewProps> = ({
  weather,
  tempUnit,
  weatherLoading,
  onRefreshWeather,
  locationMode = 'auto',
}) => {
  const uvValue = typeof weather.uvIndex === 'number' ? weather.uvIndex : 3;
  const uvRiskLabel =
    uvValue <= 2 ? 'Low' : uvValue <= 5 ? 'Moderate' : uvValue <= 7 ? 'High' : 'Very High';

  if (!weather.isLive) {
    return (
      <div className="w-full h-full bento-card p-6 flex flex-col items-center justify-center text-center">
        <div
          className="p-3 rounded-2xl"
          style={{
            background: 'var(--theme-track)',
            border: '1px solid var(--theme-border)',
          }}
        >
          <CloudSun className="w-8 h-8" style={{ color: 'var(--theme-accent)' }} />
        </div>
        <h2 className="mt-3 text-base font-semibold" style={{ color: 'var(--theme-text-primary)' }}>
          Weather data is unavailable
        </h2>
        <p className="mt-1 max-w-sm text-[11px]" style={{ color: 'var(--theme-text-secondary)' }}>
          Canopy could not get a current forecast. Check your connection or location settings, then
          refresh.
        </p>
        <button
          type="button"
          data-tauri-drag-region="false"
          onClick={onRefreshWeather}
          className="mt-4 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all pointer-events-auto cursor-pointer"
          style={{ background: 'var(--theme-accent)', color: '#11111b' }}
        >
          {weatherLoading ? 'Refreshing…' : 'Retry weather'}
        </button>
      </div>
    );
  }

  return (
    <div className="w-full h-full grid grid-cols-12 gap-2.5">
      {/* Left 5 Cols: Cohesive, Well-Proportioned Atmospheric Bento Card */}
      <div className="col-span-5 flex flex-col h-full">
        <div className="bento-card flex-1 p-3.5 flex flex-col justify-between relative overflow-hidden">
          {/* Top Header: Location & Refresh */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <span
                className="text-[10px] font-mono uppercase tracking-widest flex items-center gap-1"
                style={{ color: 'var(--theme-accent)' }}
              >
                <MapPin className="w-3 h-3 shrink-0" />
                <span className="truncate">{weather.locationName}</span>
              </span>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span
                  className="text-4xl font-bold tracking-tight tabular-nums leading-none"
                  style={{ color: 'var(--theme-text-primary)' }}
                >
                  {weather.temp}
                  {tempUnit}
                </span>
                <span
                  className="px-2 py-0.5 rounded-full text-[11px] font-semibold"
                  style={{
                    background: 'var(--theme-track)',
                    color: 'var(--theme-accent)',
                    border: '1px solid var(--theme-border)',
                  }}
                >
                  {weather.condition}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                data-tauri-drag-region="false"
                onClick={onRefreshWeather}
                className="p-1.5 rounded-xl transition-all pointer-events-auto cursor-pointer"
                style={{
                  background: 'var(--theme-track)',
                  color: 'var(--theme-text-primary)',
                  border: '1px solid var(--theme-border)',
                }}
                title="Refresh Open-Meteo Telemetry"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${weatherLoading ? 'animate-spin' : ''}`} />
              </button>
              <div
                className="p-2 rounded-2xl"
                style={{
                  background: 'var(--theme-track)',
                  border: '1px solid var(--theme-border)',
                }}
              >
                {renderWeatherIcon(weather.code, weather.condition, 'w-7 h-7')}
              </div>
            </div>
          </div>

          {/* Daily Range Progress Strip */}
          <div
            className="my-2 px-3 py-2 rounded-xl flex items-center justify-between gap-2.5"
            style={{
              background: 'var(--theme-track)',
              border: '1px solid var(--theme-border)',
            }}
          >
            <span
              className="text-[11px] font-mono tabular-nums"
              style={{ color: 'var(--theme-text-secondary)' }}
            >
              Low{' '}
              <strong className="text-[#89b4fa]">
                {weather.low}
                {tempUnit}
              </strong>
            </span>
            <div
              className="flex-1 h-1.5 rounded-full overflow-hidden"
              style={{ background: 'var(--theme-border)' }}
            >
              <div
                className="h-full rounded-full w-3/4 mx-auto"
                style={{ backgroundColor: 'var(--theme-accent)' }}
              />
            </div>
            <span
              className="text-[11px] font-mono tabular-nums"
              style={{ color: 'var(--theme-text-secondary)' }}
            >
              High{' '}
              <strong className="text-[#fab387]">
                {weather.high}
                {tempUnit}
              </strong>
            </span>
          </div>

          {/* 2x2 Atmospheric Telemetry Grid: Feels Like, Humidity, Wind Speed, UV Index */}
          <div className="grid grid-cols-2 gap-2">
            <div className="canopy-pill p-2.5 flex flex-col justify-between">
              <span
                className="text-[9px] font-mono uppercase tracking-wider flex items-center gap-1"
                style={{ color: 'var(--theme-text-secondary)' }}
              >
                <Thermometer className="w-3 h-3 text-[#fab387]" /> Feels Like
              </span>
              <div className="mt-1 flex items-baseline justify-between">
                <span
                  className="text-base font-bold tabular-nums"
                  style={{ color: 'var(--theme-text-primary)' }}
                >
                  {weather.feelsLike}
                  {tempUnit}
                </span>
                <span
                  className="text-[9px] font-mono"
                  style={{ color: 'var(--theme-text-secondary)' }}
                >
                  {Math.abs(weather.feelsLike - weather.temp) <= 2 ? 'Similar' : 'Wind chill'}
                </span>
              </div>
            </div>

            <div className="canopy-pill p-2.5 flex flex-col justify-between">
              <span
                className="text-[9px] font-mono uppercase tracking-wider flex items-center gap-1"
                style={{ color: 'var(--theme-text-secondary)' }}
              >
                <Droplets className="w-3 h-3 text-[#89dceb]" /> Humidity
              </span>
              <div className="mt-1 flex items-baseline justify-between">
                <span
                  className="text-base font-bold tabular-nums"
                  style={{ color: 'var(--theme-text-primary)' }}
                >
                  {weather.humidity}%
                </span>
                <span
                  className="text-[9px] font-mono"
                  style={{ color: 'var(--theme-text-secondary)' }}
                >
                  {weather.humidity < 35 ? 'Dry' : weather.humidity <= 65 ? 'Comfort' : 'Humid'}
                </span>
              </div>
            </div>

            <div className="canopy-pill p-2.5 flex flex-col justify-between">
              <span
                className="text-[9px] font-mono uppercase tracking-wider flex items-center gap-1"
                style={{ color: 'var(--theme-text-secondary)' }}
              >
                <Wind className="w-3 h-3 text-[#a6e3a1]" /> Wind Speed
              </span>
              <div className="mt-1 flex items-baseline justify-between">
                <span
                  className="text-base font-bold tabular-nums"
                  style={{ color: 'var(--theme-text-primary)' }}
                >
                  {weather.windSpeed} <span className="text-[10px] font-normal">mph</span>
                </span>
                <span
                  className="text-[9px] font-mono"
                  style={{ color: 'var(--theme-text-secondary)' }}
                >
                  {weather.windSpeed < 12 ? 'Calm' : 'Breezy'}
                </span>
              </div>
            </div>

            <div className="canopy-pill p-2.5 flex flex-col justify-between">
              <span
                className="text-[9px] font-mono uppercase tracking-wider flex items-center gap-1"
                style={{ color: 'var(--theme-text-secondary)' }}
              >
                <Sparkles className="w-3 h-3 text-[#f9e2af]" /> UV Index
              </span>
              <div className="mt-1 flex items-baseline justify-between">
                <span
                  className="text-base font-bold tabular-nums"
                  style={{ color: 'var(--theme-text-primary)' }}
                >
                  {uvValue}
                </span>
                <span
                  className="px-1.5 py-0.5 rounded text-[9px] font-mono"
                  style={{
                    background: 'var(--theme-track)',
                    color: 'var(--theme-accent)',
                  }}
                >
                  {uvRiskLabel}
                </span>
              </div>
            </div>
          </div>

          {/* Cohesive Footer Summary Bar */}
          <div
            className="pt-2 mt-1 flex items-center justify-between text-[10px] font-mono"
            style={{
              borderTop: '1px solid var(--theme-border)',
              color: 'var(--theme-text-secondary)',
            }}
          >
            <span>
              Source: {locationMode === 'auto' ? 'Auto IP + Open-Meteo' : 'Manual Coords'}
            </span>
            <span style={{ color: 'var(--theme-accent)' }}>Unit: {tempUnit}</span>
          </div>
        </div>
      </div>

      {/* Right 7 Cols: Hourly Forecast Cards + 5-Day Extended Outlook */}
      <div className="col-span-7 flex flex-col gap-2.5 h-full">
        <div className="bento-card p-3.5">
          <span
            className="text-[10px] font-mono uppercase tracking-widest block mb-2"
            style={{ color: 'var(--theme-text-secondary)' }}
          >
            Hourly Forecast
          </span>
          <div className="grid grid-cols-6 gap-2">
            {weather.hourly.slice(0, 6).map((item, idx) => (
              <div
                key={idx}
                className="canopy-pill p-2 flex flex-col items-center justify-between gap-1.5"
              >
                <span
                  className="text-[10px] font-mono"
                  style={{ color: 'var(--theme-text-secondary)' }}
                >
                  {item.time}
                </span>
                {renderWeatherIcon(item.code, item.condition, 'w-5 h-5')}
                <span
                  className="text-xs font-bold tabular-nums"
                  style={{ color: 'var(--theme-text-primary)' }}
                >
                  {item.temp}°
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="bento-card flex-1 p-3.5 flex flex-col justify-between overflow-hidden">
          <span
            className="text-[10px] font-mono uppercase tracking-widest"
            style={{ color: 'var(--theme-text-secondary)' }}
          >
            Extended Outlook
          </span>
          <div className="space-y-1.5 my-auto">
            {weather.daily.slice(0, 5).map((day, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between px-3 py-1.5 rounded-xl"
                style={{
                  background: 'var(--theme-track)',
                  border: '1px solid var(--theme-border)',
                }}
              >
                <span
                  className="w-16 text-xs font-semibold"
                  style={{ color: 'var(--theme-text-primary)' }}
                >
                  {day.day}
                </span>
                <div className="flex items-center gap-2 w-32">
                  {renderWeatherIcon(day.code, day.condition, 'w-4 h-4')}
                  <span
                    className="text-[11px] truncate"
                    style={{ color: 'var(--theme-text-secondary)' }}
                  >
                    {day.condition}
                  </span>
                </div>
                <div className="flex items-center gap-2 w-36">
                  <span
                    className="text-[11px] font-mono tabular-nums w-8 text-right"
                    style={{ color: 'var(--theme-text-secondary)' }}
                  >
                    {day.tempMin}°
                  </span>
                  <div
                    className="flex-1 h-1.5 rounded-full overflow-hidden"
                    style={{ background: 'var(--theme-border)' }}
                  >
                    <div
                      className="h-full rounded-full w-4/5 mx-auto"
                      style={{ backgroundColor: 'var(--theme-accent)' }}
                    />
                  </div>
                  <span
                    className="text-[11px] font-mono tabular-nums font-semibold w-8"
                    style={{ color: 'var(--theme-text-primary)' }}
                  >
                    {day.tempMax}°
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
