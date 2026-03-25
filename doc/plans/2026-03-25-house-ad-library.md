# House Ad Library — "Subscribe to The Daily Orbit"

**Date:** 2026-03-25
**Status:** Draft

---

## Overview

Add a rotating self-promotional ("house") ad for The Daily Orbit that appears on every edition,
positioned just below the Wide Band Transmissions / Company Spotlight section. The ad promotes
subscription features in the Victorian newspaper ad style. A library of ~30 ad variants is
pre-generated (tagline + image), then one is selected deterministically per edition.

### Ad Copy (fixed across all variants)

```
[AD IMAGE — 300×250 WebP, line drawing style]
[TAGLINE — varies per ad]

Subscribe to The Daily Orbit today!
‣ receive a daily, personalized edition by email
‣ search on concepts as well as keywords
‣ save custom searches
‣ receive email alerts based on saved searches
‣ NEW! Chat with the Editors
```

---

## Step 1 — Generate 30 tagline/image-description pairs via LLM

### 1a. Prompt design

Create a one-shot inference call that returns structured JSON. The prompt lives in
`packages/server/src/newspaper/prompts.ts` as `DEFAULT_HOUSE_AD_GENERATION_PROMPT`.

**System prompt:**

```
You are an ad copywriter for "The Daily Orbit," a newspaper covering the US satellite
communications regulatory landscape. Your readers are telecommunications attorneys and
business strategists whose main motivation is staying ahead of competitors in the
satellite licensing arena.

You write in the voice of a turn-of-the-20th-century advertising man — florid, earnest,
slightly grandiose. No modern slang, no emoji, no references to anything after 1920
(except satellite industry concepts, which you treat as though they have always existed).

Output ONLY a JSON array of 30 objects. Each object has:
- "tagline": a punchy 5-12 word ad tagline (a question, imperative, or exclamation)
- "imagePrompt": a 1-2 sentence description of a line drawing illustration to accompany
  the tagline. The description must be self-contained and ready to send to an image
  generator. Always end with: "Steel engraving style, black ink crosshatch on white
  background, style of 19th century newspaper illustration, no text, no words."

Triple bonus for combining satellite communications industry references with
turn-of-the-20th-century anachronisms. Be creative and funny.
```

**User prompt:**

```
Generate 30 tagline + image description pairs for house advertisements promoting
subscriptions to "The Daily Orbit" newspaper.

Themes to draw from:
- Satellite frequency bands: Ka-band, Ku-band, C-band, V-band, S-band
- FCC filings, orbital slots, spectrum coordination, interference disputes
- Satellite launches, ground stations, transponders, beamforming
- Legal strategy, competitive intelligence, regulatory maneuvering

Each tagline should make a reader smile and want to subscribe. Each image should depict
a scene that complements the tagline — think: Victorian gentlemen with telescopes,
boxing matches (Queensbury rules), newspaper boys, carrier pigeons with antennas,
gentlemen's clubs debating orbital mechanics, etc.

Output valid JSON only. No markdown fences, no commentary.
```

### 1b. Implementation

- New file: `packages/server/src/newspaper/generators/house-ad-library.ts`
- Function: `generateHouseAdCopy(inferenceService, config) → HouseAdEntry[]`
- Parses JSON response, validates array of `{ tagline: string, imagePrompt: string }`
- Returns the parsed array (does NOT write to DB — that's step 3)
- Model: `newspaperCopyModel` (same as other copy generation)

---

## Step 2 — Generate 30 images from descriptions

### 2a. Image specs

| Property         | Value                                      |
| ---------------- | ------------------------------------------ |
| Dimensions       | 300 × 250 px (standard newspaper ad block) |
| Format           | WebP                                       |
| Style            | Steel engraving / crosshatch line drawing  |
| Model            | Stable Diffusion 3.5 Large (preferred) or `newspaperImageModel` config |
| Negative prompt  | `photograph, realistic, color, modern, blurry, low quality, text, watermark` |
| Seed             | `baseSeed + index` for reproducibility     |

### 2b. Storage

Images saved to: `data/newspaper/images/library/house-ads/{index:03d}.webp`

Each image registered in `newspaper_image` table with:
- `image_type`: `'house_ad'`
- `tags`: `['house_ad', tagline slug]`

### 2c. Implementation

- Function: `generateHouseAdImages(entries, conn, imageClient, config, log, options?)`
- Same pattern as `generatePortraitLibrary()`: iterate entries, skip if already in DB,
  generate image, write file, insert DB row
- Returns `{ generated, skipped, failed }` counts

---

## Step 3 — Store taglines in the database

### 3a. New table: `house_ad`

```sql
CREATE TABLE IF NOT EXISTS house_ad (
    id              INTEGER PRIMARY KEY DEFAULT nextval('house_ad_seq'),
    tagline         VARCHAR NOT NULL,
    image_path      VARCHAR NOT NULL,
    image_prompt    VARCHAR NOT NULL,
    generated_by    VARCHAR,
    created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE SEQUENCE IF NOT EXISTS house_ad_seq START 1;
```

Add schema creation to `ensureNewspaperTables()` in `packages/server/src/newspaper/schema.ts`.

### 3b. Repository functions

Add to `packages/server/src/newspaper/repository.ts`:

- `insertHouseAd(conn, { tagline, imagePath, imagePrompt, generatedBy })`
- `getHouseAdForDate(conn, editionDate) → HouseAd | null`
  - Selection: `SELECT * FROM house_ad ORDER BY id LIMIT 1 OFFSET (extract(doy FROM ?::DATE) % (SELECT count(*) FROM house_ad))`
  - Deterministic: same date always picks the same ad, rotates through all ads over the year
- `countHouseAds(conn) → number`
- `listHouseAds(conn) → HouseAd[]`

---

## Step 4 — CLI command

### 4a. Add to `generate-library` subcommand

Extend the existing `./daily-orbit newspaper generate-library` command to support
`--type house-ads` (and include in `--type all`).

Flow:
1. Call `generateHouseAdCopy()` to get 30 tagline/imagePrompt pairs
2. Call `generateHouseAdImages()` to generate images for each
3. Insert rows into `house_ad` table for each successful pair
4. Report counts

### 4b. Idempotency

- Skip taglines that already exist in `house_ad` (match on exact tagline string)
- Skip images that already exist in `newspaper_image` (match on path)
- Safe to re-run: only generates missing entries

---

## Step 5 — API endpoint

Add to `packages/server/src/newspaper/routes.ts`:

- `GET /api/newspaper/house-ad/:date` → returns `{ tagline, imageUrl, features }` for the
  deterministic ad of the day
- The `features` array is the fixed bullet list (hardcoded server-side)
- Falls back to a default tagline ("All the Frequencies Fit to Print") if no house ads
  exist in DB

---

## Step 6 — Frontend component

### 6a. New component: `HouseAd.tsx`

File: `packages/web/src/newspaper/sections/HouseAd.tsx`

Props: `{ editionDate: string }`

Fetches `/api/newspaper/house-ad/{date}` on mount. Renders:

```
┌─────────────────────────────────┐
│  ╔═══════════════════════════╗  │
│  ║      [AD IMAGE]          ║  │
│  ╚═══════════════════════════╝  │
│                                 │
│  "Getting pummelled by the      │
│   competition?"                 │
│                                 │
│  Subscribe to The Daily Orbit   │
│  today!                         │
│                                 │
│  ‣ daily personalized edition   │
│  ‣ concept + keyword search     │
│  ‣ saved custom searches        │
│  ‣ email alerts                 │
│  ‣ NEW! Chat with the Editors   │
│                                 │
│  ══ AN ADVERTISEMENT ══         │
└─────────────────────────────────┘
```

Styling:
- Ornamental double border (`border-style: double`, 3px, `#5c4a32`)
- Font: Josefin Slab for body, Libre Baskerville Italic for tagline
- Background: `#faf7f0` (Aged White)
- "AN ADVERTISEMENT" label in small caps at bottom (per Victorian newspaper convention)
- Max width: matches the grid column it occupies

### 6b. Layout integration

In `NewspaperView.tsx`, add the `HouseAd` component after the Row 3 section
(Company Spotlight / Wide Band Transmissions + Editorial). This places it
"just below Wide Band Transmissions" as requested.

Add a new CSS grid row:

```
Row 4: house-ad (spans full width or 2 center columns)
```

On narrow/mobile layout: full-width, between the editorial and market ticker sections.

---

## Step 7 — Tests

### Unit tests

- `house-ad-library.test.ts`: test JSON parsing, validation of LLM response,
  handling of malformed JSON
- `repository.test.ts`: test `getHouseAdForDate` deterministic selection —
  same date always returns same ad, different dates rotate

### Integration test

- Extend existing newspaper generation integration test to include `--type house-ads`

---

## File Summary

| File | Action |
|------|--------|
| `packages/server/src/newspaper/prompts.ts` | Add house ad generation prompts |
| `packages/server/src/newspaper/generators/house-ad-library.ts` | New — copy + image generation |
| `packages/server/src/newspaper/schema.ts` | Add `house_ad` table |
| `packages/server/src/newspaper/repository.ts` | Add house ad CRUD + date selection |
| `packages/server/src/newspaper/routes.ts` | Add `GET /api/newspaper/house-ad/:date` |
| `packages/server/src/newspaper/types.ts` | Add `HouseAd` type |
| `packages/server/src/cli/newspaper/index.ts` | Extend `generate-library` with `--type house-ads` |
| `packages/web/src/newspaper/sections/HouseAd.tsx` | New — frontend component |
| `packages/web/src/newspaper/newspaper.css` | Add `.grid-house-ad` styles |
| `packages/web/src/newspaper/NewspaperView.tsx` | Add HouseAd to layout grid |
| `packages/server/src/newspaper/generators/house-ad-library.test.ts` | New — unit tests |

---

## Decisions

1. **Image model:** Use the default `newspaperImageModel` config — no separate config key.
2. **Subscription link:** Decorative for now — anchor with `href="#"` and `onClick={e => e.preventDefault()}`.
3. **Admin UI:** CLI-only for v1. No admin page management.
