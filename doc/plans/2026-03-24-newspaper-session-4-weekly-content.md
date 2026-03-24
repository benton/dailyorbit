# Newspaper Session 4: Weekly Content — Editorials, Spotlights, Forecasts

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add all weekly content generators: "Over the Horizon" editorial, editorial cartoon, company spotlight, orbital forecast, and classifieds batch. Weekly stages run on Mondays only. After this session, the full newspaper content set is generated automatically.

**Prereqs:** Sessions 1-3 complete (foundation + image generation + fake ads).

---

## Task 1: Create Editorial Generator — "Over the Horizon"

**Files:**
- New: `packages/server/src/newspaper/generators/editorial.ts`
- New: `packages/server/src/newspaper/generators/editorial.test.ts`

**Persona rotation:** Three AI "editors" rotate on a 3-week cycle based on ISO week number:
- Week % 3 === 0: **Competitive dynamics** — "Who's gaining ground in the orbital commons?"
- Week % 3 === 1: **Regulatory trends** — "What is the FCC signaling?"
- Week % 3 === 2: **Technology angles** — "What does this mean for spectrum?"

Each persona has a distinct voice described in the system prompt. The editorial prompt keys (`newspaperEditorialSystemPrompt`, `newspaperEditorialUserPrompt`) allow admin override.

```typescript
const PERSONAS = [
  {
    name: 'The Strategist',
    angle: 'competitive dynamics',
    voice: 'analytical and sharp, focused on corporate maneuvering and market position',
  },
  {
    name: 'The Counsel',
    angle: 'regulatory trends',
    voice: 'measured and authoritative, focused on what FCC actions signal for the industry',
  },
  {
    name: 'The Engineer',
    angle: 'technology and spectrum',
    voice: 'technically curious, focused on what new filings mean for spectrum usage and satellite technology',
  },
] as const;

function getCurrentPersona(): typeof PERSONAS[number] {
  const weekNumber: number = getISOWeekNumber(new Date());
  return PERSONAS[weekNumber % 3];
}
```

**Generator function:**
1. Get current persona based on week number
2. Query recent filing trends + news summaries (last 7 days)
3. Build prompt with persona voice + data
4. Call inference with `newspaperEditorialSystemPrompt` or default
5. Return 3-4 paragraph editorial with byline

**Tests:** Verify persona rotation cycles correctly, prompt includes persona voice, byline appears.

---

## Task 2: Create Editorial Cartoon Generator

**Files:**
- New: `packages/server/src/newspaper/generators/editorial-cartoon.ts`
- New: `packages/server/src/newspaper/generators/editorial-cartoon.test.ts`

1. Read the just-generated editorial to get the theme
2. Use a short LLM call to generate a cartoon description (1-2 sentences)
3. Build image prompt with Punch-magazine style prefix (from style guide)
4. Call `generateImage()` at 512x512
5. Save to `data/newspaper/images/{date}/editorial-cartoon.webp`

```typescript
const CARTOON_STYLE: string =
  'Single-panel editorial cartoon, black ink crosshatch style, ' +
  'style of Punch magazine illustration circa 1900, satirical, ' +
  'with caption space below. ';
```

**Tests:** Mock image client, verify editorial dependency, verify style prefix in prompt.

---

## Task 3: Create Company Spotlight Generator

**Files:**
- New: `packages/server/src/newspaper/generators/company-spotlight.ts`
- New: `packages/server/src/newspaper/generators/company-spotlight.test.ts`

**Company selection:** Rotate through top-filing companies. Query `company` table ordered by recent filing count, skip companies spotlighted in the last 8 weeks (check `newspaper_article` where `content_type = 'company_spotlight'`).

**Generator:**
1. Select this week's company
2. Query: recent filings, pending applications, company description, aliases, parent hierarchy
3. Call LLM to generate a 2-3 paragraph profile
4. Include links to the company page: `[Company Name](/companies/{id})`

**Tests:** Verify company rotation skips recently spotlighted, profile includes links.

---

## Task 4: Create Orbital Forecast Generator

**Files:**
- New: `packages/server/src/newspaper/generators/orbital-forecast.ts`
- New: `packages/server/src/newspaper/generators/orbital-forecast.test.ts`

**Data-driven analysis:**
1. Query filing volume stats: this week vs. 90-day average, by subsystem and company
2. Identify notable trends (>30% change vs. average)
3. Call LLM with the stats to generate a brief analytical piece
4. Format as 1-2 paragraphs with specific numbers

```typescript
export const DEFAULT_FORECAST_USER_PROMPT: string = `Write this week's "Orbital Forecast" column for the week of {{editionDate}}.

Filing volume this week vs. 90-day average:
{{{filingStats}}}

Notable company activity:
{{{companyActivity}}}

Write 1-2 paragraphs highlighting the most notable trends. Use specific numbers and percentages. Reference company names and filing types.`;
```

**Tests:** Verify stats are correctly formatted, LLM is called with trend data.

---

## Task 5: Create Classifieds Batch Generator

**Files:**
- New: `packages/server/src/newspaper/generators/classifieds.ts`
- New: `packages/server/src/newspaper/generators/classifieds.test.ts`

Generate 5-7 fake classified ads in a single LLM call. These rotate daily (one per day, with extras cached for the week).

```typescript
export const DEFAULT_CLASSIFIEDS_USER_PROMPT: string = `Generate 7 fake classified ads for "The Daily Orbit" newspaper, one for each day this week.

Use these real data points for inspiration:
Companies: {{{companyNames}}}
Filing types: {{{recentFilingTypes}}}
Frequency bands: Ka-band, Ku-band, C-band, V-band, S-band

Each ad should be 2-3 lines in this format:
**[CATEGORY]** — [Ad text]. Contact: [fictional contact].

Categories: FOR SALE, WANTED, SERVICES, POSITIONS AVAILABLE, LOST & FOUND

Be creative and humorous. Reference real satellite industry concepts in absurd ways.`;
```

Store all 7 as a single article body (markdown list), with a `display_order` based on day-of-week for frontend rotation.

**Tests:** Verify 7 ads generated, real company/filing data passed to prompt.

---

## Task 6: Add Monday-Only Guard to Weekly Stages

All 5 weekly stages share a common guard pattern:

```typescript
// At the top of each weekly stage's run() method:
const dayOfWeek: number = new Date().getDay();
if (dayOfWeek !== 1) { // 1 = Monday
  ctx.log('info', 'Weekly content — skipping (not Monday)');
  return { itemsProcessed: 0, itemsSkipped: 1, itemsFailed: 0, durationMs: 0 };
}
```

Consider extracting this into a helper: `isWeeklyGenerationDay()` in `newspaper/types.ts`.

---

## Task 7: Register All Weekly Pipeline Stages

**Files:**
- Modify: `packages/server/src/pipeline/registry.ts`

Add 5 stages to the `STAGES` array and their IDs to the newspaper group's `stageIds`:

```typescript
'newspaper.weekly-editorial',    // "Over the Horizon"
'newspaper.editorial-cartoon',   // Weekly cartoon
'newspaper.company-spotlight',   // Company profile
'newspaper.orbital-forecast',    // Trend analysis
'newspaper.classifieds',         // Classified ad batch
```

Final newspaper group `stageIds`:
```typescript
[
  'newspaper.ensure-edition',
  'newspaper.daily-digest',
  'newspaper.hero-image',
  'newspaper.fake-ad',
  'newspaper.weekly-editorial',
  'newspaper.editorial-cartoon',
  'newspaper.company-spotlight',
  'newspaper.orbital-forecast',
  'newspaper.classifieds',
]
```

---

## Task 8: Add Editorial Prompt Template Variables

**Files:**
- Modify: `packages/server/src/newspaper/prompts.ts`

Add variables and defaults for editorial, spotlight, forecast, and classifieds content types.

---

## Verification

1. `make test` — all tests pass (6 new generator test files)
2. On a Monday: `./daily-orbit newspaper generate` — all 9 stages run, weekly content generated
3. On a non-Monday: `./daily-orbit newspaper generate` — weekly stages skip gracefully (itemsSkipped: 1)
4. `./daily-orbit newspaper show --date $(date +%Y-%m-%d)` — displays all content types
5. `curl localhost:9000/api/newspaper/edition/latest | jq '.articles | length'` — returns 6+ articles on Monday, 3 on other days
6. Verify persona rotation: check editorial byline matches expected persona for current week number
7. Pipeline admin UI shows all 9 newspaper stages with correct status
