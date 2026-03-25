# Masthead Left: Last Week's Filing Volume Histogram

## Overview

A small, monochrome histogram in the right wing of the Masthead showing filing counts for each weekday (M-T-W-T-F) of the **previous calendar week**. Styled to blend with the 1930s newspaper aesthetic — sepia bars on parchment, subtle and low-contrast.

## Design Decisions

### Charting Library: Custom CSS Bars (not Cosmograph)

Cosmograph is a GPU-accelerated graph/network library designed for large interactive datasets. It's overkill for 5 static bars, and its dark-background rendering style conflicts with the newspaper aesthetic. A simple custom implementation is more appropriate here: five `<div>` elements with proportional heights, labeled M-T-W-T-F. The AGENTS.md rule about Cosmograph/Mosaic applies to data visualizations — this is a decorative masthead ornament.

### Data Source: New API Endpoint

**New endpoint:** `GET /api/stats/weekly-filing-volume?week=previous`

Returns an array of 5 objects: `{ day: 'Mon'|'Tue'|..., date: string, count: number }`.

**Query:**
```sql
SELECT
  date_filed::DATE AS filing_date,
  count(*)::INTEGER AS filing_count
FROM filing
WHERE date_filed::DATE >= $1 AND date_filed::DATE <= $2
GROUP BY 1
ORDER BY 1
```

Where `$1` is previous Monday and `$2` is previous Friday (computed server-side from the edition date).

**Repository function:** `getWeeklyFilingVolume(mondayDate: string, fridayDate: string)` in `packages/server/src/stats/repository.ts`.

## Component Design

### `MastheadFilingVolume.tsx`

```
+----------------------------------+
|                                  |  <- ~15% top padding
|   LAST WEEK'S FILINGS           |  <- small-caps label
|                                  |
|   ██                             |
|   ██  ██                         |  <- proportional bars
|   ██  ██      ██  ██             |     (sepia fill)
|   ██  ██  ██  ██  ██             |
|   M   T   W   T   F             |  <- day labels
|   --- total: 47 ---             |  <- optional total
|                                  |  <- ~15% bottom padding
+----------------------------------+
```

**Props:**
- `editionDate: string` — Used to compute "previous calendar week"

**Behavior:**
- Fetches `/api/stats/weekly-filing-volume?before={editionDate}` on mount
- Computes max count, renders bars as percentage of max height
- If data unavailable or all zero, shows a placeholder ("No filings recorded")

**Styling:**
- Container: `padding: 15%`, `border: 1px solid var(--np-sepia-light)`, `opacity: 0.75`
- Bars: `background: var(--np-sepia-medium)`, max-height ~80px
- Labels: `font-family: var(--np-font-body)`, `font-size: 10px`, `color: var(--np-sepia-medium)`
- Header: small-caps, `font-size: 11px`, `color: var(--np-sepia-dark)`
- Mirrors the left-side weather widget in outer dimensions

## Integration

The Masthead component layout changes from a single centered column to a 3-column layout:

```
[Weather Widget]  [Title / Emblem / Dateline]  [Filing Histogram]
```

Using CSS grid on `.masthead`: `grid-template-columns: 1fr auto 1fr`, with the center column retaining all existing content. Left and right columns use `align-self: center`.

On mobile (`<=900px`), both side widgets are hidden (`display: none`).

## Files to Create/Modify

| File | Action |
|------|--------|
| `packages/server/src/stats/repository.ts` | Add `getWeeklyFilingVolume()` |
| `packages/server/src/stats/routes.ts` | Add `GET /api/stats/weekly-filing-volume` |
| `packages/web/src/newspaper/MastheadFilingVolume.tsx` | New component |
| `packages/web/src/newspaper/Masthead.tsx` | Integrate left/right wings |
| `packages/web/src/newspaper/newspaper.css` | Masthead grid + widget styles |
