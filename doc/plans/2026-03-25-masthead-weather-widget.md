# Masthead Right: Today's Weather Widget

## Overview

A small weather ornament in the left wing of the Masthead. On Mondays and Wednesdays, it displays the actual weather forecast for Washington, D.C. On other days, it shows a playful joke: "Weather in Orbit [random orbital location from DB] — None."

## Design Decisions

### Weather Data Source: Open-Meteo (free, no API key)

[Open-Meteo](https://open-meteo.com/) provides a free, open-source weather API with no API key required. It supports geocoding and forecasts.

**Endpoint:** `https://api.open-meteo.com/v1/forecast?latitude=38.9072&longitude=-77.0369&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=America/New_York`

Returns current temperature and WMO weather code (which maps to conditions like "Clear", "Partly Cloudy", "Rain", etc.).

**Server-side fetch** — the API call happens on the server to avoid CORS issues and to cache the result. The newspaper API endpoint returns the weather data alongside the edition.

### Orbital Joke Source: `space_station.orbit_location`

On non-Monday/Wednesday days, the server picks a random active satellite orbit location:

```sql
SELECT us_name, orbit_location
FROM space_station
WHERE orbit_location IS NOT NULL
  AND inactive_date IS NULL
ORDER BY random()
LIMIT 1
```

Returns something like `{ name: "SATMEX-5", location: "116.8°W" }`, displayed as:

> **Weather in Orbit**
> 116.8°W (SATMEX-5)
> Forecast: None.

### API Design: Single New Endpoint

**New endpoint:** `GET /api/stats/masthead-weather?date={editionDate}`

Server logic:
1. Parse the date, determine day of week
2. If Monday or Wednesday → fetch Open-Meteo, return `{ type: 'real', temp: 42, condition: 'Partly Cloudy', unit: '°F' }`
3. Otherwise → query random orbit location, return `{ type: 'orbital', name: 'SATMEX-5', location: '116.8°W' }`

Cache the Open-Meteo response for 1 hour (simple in-memory TTL) to avoid repeated calls during page reloads.

## Component Design

### `MastheadWeather.tsx`

**Real weather (Mon/Wed):**
```
+----------------------------------+
|                                  |
|   TODAY'S WEATHER                |
|   Washington, D.C.              |
|                                  |
|        ☁ 42°F                   |
|     Partly Cloudy               |
|                                  |
+----------------------------------+
```

**Orbital joke (other days):**
```
+----------------------------------+
|                                  |
|   WEATHER IN ORBIT              |
|   116.8°W                       |
|   (SATMEX-5)                    |
|                                  |
|   Forecast: None.               |
|                                  |
+----------------------------------+
```

**Props:**
- `editionDate: string`

**Behavior:**
- Fetches `/api/stats/masthead-weather?date={editionDate}` on mount
- Renders based on `type` field in response
- Graceful fallback: if fetch fails, show orbital joke with hardcoded "GEO 0°" as location

**Weather Symbols (text-based, no icon fonts):**
Map WMO weather codes to simple text symbols that work in the newspaper font:
- Clear → `☀`
- Cloudy → `☁`
- Rain → `☂`
- Snow → `❄`
- Fog → `〰`
- Thunderstorm → `⚡`

These Unicode characters render well in serif fonts and feel period-appropriate.

### Styling

- Identical outer dimensions/padding to the right filing histogram widget
- Container: `padding: 15%`, `border: 1px solid var(--np-sepia-light)`, `opacity: 0.75`
- Temperature: `font-family: var(--np-font-headline)`, `font-size: 20px`
- Labels: `font-family: var(--np-font-body)`, `font-size: 10px`, small-caps
- Weather symbol: `font-size: 24px`, `color: var(--np-sepia-dark)`

## Files to Create/Modify

| File | Action |
|------|--------|
| `packages/server/src/stats/repository.ts` | Add `getRandomOrbitLocation()` |
| `packages/server/src/stats/routes.ts` | Add `GET /api/stats/masthead-weather` |
| `packages/web/src/newspaper/MastheadWeather.tsx` | New component |
| `packages/web/src/newspaper/Masthead.tsx` | Already modified for 3-column layout |
| `packages/web/src/newspaper/newspaper.css` | Already modified for widget styles |

## WMO Weather Code Mapping (subset)

| Code | Condition |
|------|-----------|
| 0 | Clear sky |
| 1-3 | Partly cloudy |
| 45, 48 | Fog |
| 51-57 | Drizzle |
| 61-67 | Rain |
| 71-77 | Snow |
| 80-82 | Rain showers |
| 95-99 | Thunderstorm |
