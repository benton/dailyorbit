# Newspaper Daily Rotation — Filling Out the Full Edition Every Day

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current Monday-only weekly content generation with a daily rotation
of columns so that every edition has the same full layout as the 2026-03-23 archetype.
Currently, non-Monday editions are missing 6 sections (Orbital Forecast, Company Spotlight,
Over the Horizon, Editorial Cartoon, Classifieds, and the dependent sections they gate).

**Prereqs:** All newspaper sessions 1-6 complete. The existing weekly generators are the
starting point — they become Monday's columns in the new rotation.

---

## Design Overview

### Layout Slots

The newspaper has a fixed grid layout with three variable content slots:

| Slot | Grid Class | Position | Length | Visual |
|------|-----------|----------|--------|--------|
| **A** | `grid-orbital` | Right sidebar, row 1 | 1-2 paragraphs | Text only |
| **B** | `grid-company` | Wide left, row 3 | 2-3 paragraphs | Portrait or illustration |
| **C** | `grid-editorial` | Right column, row 3 | 3-4 paragraphs + byline | Classifieds below |

### Daily-Fresh Sections (unchanged, generate every day)

- Daily Digest ("300 Miles Up") + Hero Image
- Fake Ad
- **Editorial Cartoon** (currently weekly — make daily)
- **Classifieds** (currently weekly — make daily)
- Yesterday's Filings (data-driven, not generated)
- Wide Band Transmissions (data-driven, not generated)
- House Ad (from pre-generated library)
- Masthead with weather + filing volume

### Weekly Rotation Grid

| Day | Slot A (sidebar) | Slot B (wide left + image) | Slot C (right editorial) |
|-----|-----------------|---------------------------|-------------------------|
| **Mon** | Orbital Forecast | Company Spotlight | Over the Horizon |
| **Tue** | The Docket | Filing in Focus | The Counsel's Brief |
| **Wed** | Spectrum Watch | The Applicant | Letters to the Editor |
| **Thu** | Competitive Intelligence | Technology Spotlight | Market Signals |
| **Fri** | The Docket | From the Archives | From the Press Gallery |

---

## Column Definitions

### Slot A Columns (short sidebar, data-driven)

#### Orbital Forecast (Monday) — EXISTING
- **Tagline:** *FCC Filings*
- **Content type:** `orbital_forecast`
- **Description:** Filing volume trends this week vs 90-day averages by subsystem.
- **Data sources:** Filing stats aggregation query.
- **Already built.** No changes needed.

#### The Docket (Tuesday, Friday)
- **Tagline:** *Daily Filing Activity*
- **Content type:** `the_docket`
- **Description:** Quick snapshot of yesterday's filing activity. How many filings received,
  by subsystem, notable applicants. Purely mechanical and data-driven.
- **Data sources:** Yesterday's filings grouped by subsystem + applicant.
- **Prompt style:** Brief, factual. "The Bureau received N filings yesterday..."

#### Spectrum Watch (Wednesday)
- **Tagline:** *Band Activity*
- **Content type:** `spectrum_watch`
- **Description:** Which frequency bands and subsystems are seeing action this week.
  Ka vs Ku vs C-band breakdown. Highlights shifts from the recent average.
- **Data sources:** Filing subsystem codes + any frequency-related filing data.
- **Prompt style:** Numbers-driven, short. Focus on which bands are hot.

#### Competitive Intelligence (Thursday)
- **Tagline:** *Who's Filing Where*
- **Content type:** `competitive_intel`
- **Description:** Companies filing in overlapping areas. "SpaceX and OneWeb both active
  in Ka-band STA requests this week." Highlights competitive tension.
- **Data sources:** This week's filings grouped by company + subsystem/type, looking for
  overlaps.
- **Prompt style:** Analytical, brief. Highlight the most interesting overlap.

### Slot B Columns (wide left with portrait/illustration)

#### Company Spotlight (Monday) — EXISTING
- **Tagline:** *(company name)*
- **Content type:** `company_spotlight`
- **Description:** Deep company profile with CEO portrait and recent filing activity.
- **Already built.** No changes needed.

#### Filing in Focus (Tuesday)
- **Tagline:** *A Closer Look*
- **Content type:** `filing_in_focus`
- **Description:** Deep dive on one interesting recent filing. What's being asked for,
  who's asking, regulatory context. Uses the applicant's company portrait.
- **Data sources:** Pick the most interesting recent filing (by type novelty, applicant
  prominence, or attachment count). Include filing summary + applicant info.
- **Selection heuristic:** Prefer filings with summaries, from known companies, with
  non-routine types (LOA, MOD, AMD over RWL, RPT).
- **Prompt style:** Informative, 2-3 paragraphs. "Yesterday, [Company] filed [type]
  requesting..."

#### The Applicant (Wednesday)
- **Tagline:** *Industry Profiles*
- **Content type:** `the_applicant`
- **Description:** Lighter company profile for smaller or less-known filers. Uses the
  company portrait from the library.
- **Data sources:** Company record + aliases + recent filings. Prefer companies that
  have NOT been spotlighted recently.
- **Selection heuristic:** Pick from companies with recent filing activity but low
  profile — fewer total filings, no recent spotlight.
- **Prompt style:** Curious, exploratory. "Who is [Company]? The [City]-based firm..."

#### Technology Spotlight (Thursday)
- **Tagline:** *Innovation Watch*
- **Content type:** `tech_spotlight`
- **Description:** Highlight a technology trend from recent news items — phased arrays,
  optical relays, D2D, new frequency bands, etc. Generated illustration.
- **Data sources:** Recent news items filtered for technology-related content.
- **Image:** Generated steel engraving illustration of the technology concept.
- **Prompt style:** Accessible, explanatory. Bridges technical and business audiences.

#### From the Archives (Friday)
- **Tagline:** *This Week in History*
- **Content type:** `from_the_archives`
- **Description:** Interesting filing or event from the same week in a prior year.
  "This week in 2024, Hughes Network Systems filed..." with historical context.
- **Data sources:** Filings from the same ISO week in prior years, preferring notable
  companies and interesting filing types.
- **Image:** Generated steel engraving illustration with a "vintage" feel.
- **Prompt style:** Nostalgic, reflective. Connect past to present.

### Slot C Columns (right editorial, longer form)

#### Over the Horizon (Monday) — EXISTING
- **Tagline:** *By the Editors*
- **Content type:** `editorial`
- **Description:** Rotating-persona editorial column with 3-week persona cycle.
- **Already built.** No changes needed.

#### The Counsel's Brief (Tuesday)
- **Tagline:** *Regulatory Analysis*
- **Content type:** `counsels_brief`
- **Description:** Focused legal/regulatory analysis. Examines a specific regulatory
  trend, filing pattern, or FCC action and explains its implications for practitioners.
- **Data sources:** Recent filings + news, filtered for regulatory/legal relevance.
- **Prompt style:** Authoritative, analytical. Written as a senior regulatory attorney.
  3-4 paragraphs. Byline: "— The Counsel"

#### Letters to the Editor (Wednesday)
- **Tagline:** *Our Readers Write*
- **Content type:** `letters_to_editor`
- **Description:** Fictional Victorian-voice reader letters reacting to recent editions.
  2-3 short letters with editor responses. Humorous and in-character.
- **Data sources:** Previous edition's daily digest + editorial content for "reactions."
- **Prompt style:** Florid Victorian correspondence. "Dear Sir, I must take exception
  to your characterization of..."
- **Future:** A chat UI checkbox "Share questions anonymously in Letters to the Editor"
  could feed real user questions into this column.

#### Market Signals (Thursday)
- **Tagline:** *Business & Strategy*
- **Content type:** `market_signals`
- **Description:** What regulatory filings and ownership events reveal about market
  direction. M&A activity, competitive positioning, strategic moves.
- **Data sources:** Ownership events + filings + news items with company attribution.
- **Prompt style:** Business-analyst voice. "This week's transfer-of-control filings
  suggest..." 3-4 paragraphs. Byline: "— The Strategist"

#### From the Press Gallery (Friday)
- **Tagline:** *The Week in Review*
- **Content type:** `press_gallery`
- **Description:** Synthesis and commentary on the week's news coverage. Which stories
  mattered, what the coverage reveals, what to watch next week.
- **Data sources:** All news items from the current week.
- **Prompt style:** Media-critic voice. Wraps up the week. 3-4 paragraphs.
  Byline: "— The Editor-in-Chief"

---

## Per-Column Configuration

Every column gets three admin-overridable config keys:

```
newspaper{ColumnName}SystemPrompt  — system prompt override
newspaper{ColumnName}UserPrompt    — user prompt override
newspaper{ColumnName}ModelId       — model selection override
```

All are optional. When unset, the hardcoded defaults from `prompts.ts` are used.
The Admin AI Settings page already supports this pattern.

Full list of new config keys (existing columns already have theirs):

| Column | System Prompt Key | User Prompt Key | Model Key |
|--------|------------------|-----------------|-----------|
| The Docket | `newspaperDocketSystemPrompt` | `newspaperDocketUserPrompt` | `newspaperDocketModelId` |
| Spectrum Watch | `newspaperSpectrumWatchSystemPrompt` | `newspaperSpectrumWatchUserPrompt` | `newspaperSpectrumWatchModelId` |
| Competitive Intelligence | `newspaperCompetitiveIntelSystemPrompt` | `newspaperCompetitiveIntelUserPrompt` | `newspaperCompetitiveIntelModelId` |
| Filing in Focus | `newspaperFilingInFocusSystemPrompt` | `newspaperFilingInFocusUserPrompt` | `newspaperFilingInFocusModelId` |
| The Applicant | `newspaperApplicantSystemPrompt` | `newspaperApplicantUserPrompt` | `newspaperApplicantModelId` |
| Technology Spotlight | `newspaperTechSpotlightSystemPrompt` | `newspaperTechSpotlightUserPrompt` | `newspaperTechSpotlightModelId` |
| From the Archives | `newspaperArchivesSystemPrompt` | `newspaperArchivesUserPrompt` | `newspaperArchivesModelId` |
| The Counsel's Brief | `newspaperCounselsBriefSystemPrompt` | `newspaperCounselsBriefUserPrompt` | `newspaperCounselsBriefModelId` |
| Letters to the Editor | `newspaperLettersSystemPrompt` | `newspaperLettersUserPrompt` | `newspaperLettersModelId` |
| Market Signals | `newspaperMarketSignalsSystemPrompt` | `newspaperMarketSignalsUserPrompt` | `newspaperMarketSignalsModelId` |
| From the Press Gallery | `newspaperPressGallerySystemPrompt` | `newspaperPressGalleryUserPrompt` | `newspaperPressGalleryModelId` |

---

## Implementation Architecture

### Rotation Dispatch

Replace the current `isWeeklyGenerationDay()` gate in each pipeline stage with a
**day-of-week dispatch** mechanism.

```typescript
// newspaper/rotation.ts
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export type SlotSchedule = {
  contentType: NewspaperContentType;
  days: DayOfWeek[];  // 0=Sun, 1=Mon, ..., 5=Fri, 6=Sat
};

export const SLOT_A_SCHEDULE: SlotSchedule[] = [
  { contentType: 'orbital_forecast', days: [1] },      // Monday
  { contentType: 'the_docket', days: [2, 5] },          // Tuesday, Friday
  { contentType: 'spectrum_watch', days: [3] },          // Wednesday
  { contentType: 'competitive_intel', days: [4] },       // Thursday
];

export const SLOT_B_SCHEDULE: SlotSchedule[] = [
  { contentType: 'company_spotlight', days: [1] },       // Monday
  { contentType: 'filing_in_focus', days: [2] },         // Tuesday
  { contentType: 'the_applicant', days: [3] },           // Wednesday
  { contentType: 'tech_spotlight', days: [4] },          // Thursday
  { contentType: 'from_the_archives', days: [5] },       // Friday
];

export const SLOT_C_SCHEDULE: SlotSchedule[] = [
  { contentType: 'editorial', days: [1] },               // Monday
  { contentType: 'counsels_brief', days: [2] },          // Tuesday
  { contentType: 'letters_to_editor', days: [3] },       // Wednesday
  { contentType: 'market_signals', days: [4] },          // Thursday
  { contentType: 'press_gallery', days: [5] },           // Friday
];
```

### Pipeline Changes

The existing pipeline stages for weekly content (`newspaper.weekly-editorial`,
`newspaper.editorial-cartoon`, etc.) will be refactored:

1. **Remove `isWeeklyGenerationDay()` checks** from editorial cartoon and classifieds
   (they become daily).
2. **Replace individual weekly stage registrations** for slots A/B/C with three
   **slot dispatcher stages**: `newspaper.slot-a`, `newspaper.slot-b`, `newspaper.slot-c`.
   Each dispatcher reads the day of week, looks up the schedule, and calls the
   appropriate generator.
3. **Keep existing generators** (editorial, company spotlight, orbital forecast) as-is —
   they just get called by the dispatcher instead of directly by the pipeline.
4. **Add new generators** for the 11 new content types, following the same pattern as
   existing generators.

### Frontend Changes

The `NewspaperView.tsx` component currently looks up articles by hardcoded content type.
It needs to:

1. **Look up Slot A** by checking for any of the Slot A content types.
2. **Look up Slot B** by checking for any of the Slot B content types.
3. **Look up Slot C** by checking for any of the Slot C content types.
4. **Render the appropriate component** based on which content type is found.

Each new content type gets its own React component in `packages/web/src/newspaper/sections/`.

### Content Type Expansion

The `NewspaperContentType` union in `types.ts` grows from 8 to 19 values:

```typescript
export type NewspaperContentType =
  // Daily (every day)
  | 'daily_digest'
  | 'hero_image'
  | 'fake_ad'
  | 'editorial_cartoon'
  | 'classifieds'
  // Slot A rotation
  | 'orbital_forecast'
  | 'the_docket'
  | 'spectrum_watch'
  | 'competitive_intel'
  // Slot B rotation
  | 'company_spotlight'
  | 'filing_in_focus'
  | 'the_applicant'
  | 'tech_spotlight'
  | 'from_the_archives'
  // Slot C rotation
  | 'editorial'
  | 'counsels_brief'
  | 'letters_to_editor'
  | 'market_signals'
  | 'press_gallery';
```

---

## Section Header Images

Each new column needs a section header image in the library. The `section-headers`
generator already supports adding new headers — just add the section names to the
generation list. New headers needed:

- The Docket
- Spectrum Watch
- Competitive Intelligence
- Filing in Focus
- The Applicant
- Technology Spotlight
- From the Archives
- The Counsel's Brief
- Letters to the Editor
- Market Signals
- From the Press Gallery

---

## Weekend Editions

This design covers Monday-Friday. Weekend editions (if ever generated) would need
their own schedule or could reuse Friday's layout. For now, the pipeline only runs
on weekdays (the nightly cron skips Sat/Sun).

---

## Testing Strategy

- **Unit tests** for each new generator: mock the DB queries, verify prompt assembly
  and output parsing.
- **Unit tests** for the rotation dispatcher: verify correct content type selection
  for each day of week.
- **Integration test:** Generate a full week of editions (Mon-Fri) and verify each
  has exactly the expected content types.
- **Existing tests** for the current generators remain unchanged.
