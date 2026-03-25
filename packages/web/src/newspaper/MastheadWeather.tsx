import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.ts';

type MastheadWeatherProps = {
  editionDate: string;
};

type RealWeather = {
  condition: string;
  symbol: string;
  temp: number;
  type: 'real';
  unit: string;
};

type OrbitalWeather = {
  location: string;
  name: string;
  type: 'orbital';
};

type WeatherData = RealWeather | OrbitalWeather;

export default function MastheadWeather({ editionDate }: MastheadWeatherProps) {
  const [data, setData] = useState<WeatherData | null>(null);

  useEffect(() => {
    apiFetch<WeatherData>(`/api/stats/masthead-weather?date=${editionDate}`)
      .then((result: WeatherData) => {
        setData(result);
      })
      .catch(() => {
        setData({ location: '0°', name: 'GEO', type: 'orbital' });
      });
  }, [editionDate]);

  if (!data) {
    return (
      <div className="masthead-widget masthead-weather">
        <span className="masthead-widget-label">Weather</span>
        <span className="masthead-widget-note">Loading&hellip;</span>
      </div>
    );
  }

  if (data.type === 'real') {
    return (
      <div className="masthead-widget masthead-weather">
        <span className="masthead-widget-label">Today&rsquo;s Weather</span>
        <span className="masthead-widget-note">Washington, D.C.</span>
        <span className="weather-symbol">{data.symbol}</span>
        <span className="weather-temp">
          {data.temp}
          {data.unit}
        </span>
        <span className="masthead-widget-note">{data.condition}</span>
      </div>
    );
  }

  return (
    <div className="masthead-widget masthead-weather">
      <span className="masthead-widget-label">Weather in Orbit</span>
      <span className="weather-location">{data.location}</span>
      <span className="masthead-widget-note">({data.name})</span>
      <span className="weather-forecast">Forecast: None.</span>
    </div>
  );
}
