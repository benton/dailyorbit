# Newspaper Session 3: Daily Content Expansion — Fake Ads

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add the fake advertisement generator to complete the daily content set. After this session, each day's edition includes: daily digest, hero image, and a tongue-in-cheek display ad.

**Prereqs:** Sessions 1-2 complete (foundation + image generation).

---

## Task 1: Create Fake Ad Generator

**Files:**
- New: `packages/server/src/newspaper/generators/fake-ad.ts`
- New: `packages/server/src/newspaper/generators/fake-ad.test.ts`

The generator produces a typographic ad styled after turn-of-the-century display advertising (see `doc/design/style-guide.md` section 9 and reference images `BombayChronicle.jpg`, `TheEcho.jpg`).

**Approach:**
1. Query 3-5 random companies from the `company` table
2. Query a few recent filing types (subsystem + app type) for flavor
3. Call LLM with a fun, constrained prompt to generate a single ad in structured markdown
4. The ad is primarily **text** (CSS-styled in the frontend) — no image generation needed for most ads

```typescript
export const DEFAULT_AD_SYSTEM_PROMPT: string = `You are a copywriter for "The Daily Orbit" newspaper, specializing in tongue-in-cheek display advertisements that parody turn-of-the-century newspaper ads. Your ads are affectionate, never mean-spirited. They reference real satellite industry concepts but in an absurdly formal Victorian advertising voice.

Output a single advertisement in this exact markdown format:

# [COMPANY OR PRODUCT NAME]
## [Tagline in quotes]

[2-3 lines of flowery ad copy]

*Est. [year] · [City]*`;

export const DEFAULT_AD_USER_PROMPT: string = `Generate one fake display advertisement for today's edition ({{editionDate}}).

Use one of these real companies for inspiration (pick one, or invent a plausible fictional company):
{{{companyNames}}}

Recent filing activity for flavor:
{{{recentFilingTypes}}}

The ad should reference satellite industry concepts (Ka-band, orbital slots, earth stations, spectrum coordination) in an absurdly formal way. Keep it to 5-6 lines max.`;
```

**Generator function:**
```typescript
export async function generateFakeAd(opts: GenerateOptions): Promise<GeneratorResult> {
  // 1. Query random companies + recent filing types
  // 2. Render prompt
  // 3. Call inference
  // 4. Return structured ad markdown
}
```

**Tests:**
- Mock inference returns a well-formatted ad
- Verify company names are passed to the prompt
- Verify output has headline + body structure

---

## Task 2: Add Ad Prompts to newspaper/prompts.ts

**Files:**
- Modify: `packages/server/src/newspaper/prompts.ts`

Add template variables and defaults for the fake ad content type:

```typescript
export const AD_VARIABLES: ReadonlyArray<TemplateVariable> = [
  { name: 'editionDate', description: 'Display-formatted date', source: 'edition', example: 'Monday, March 24, 2026' },
  { name: 'companyNames', description: 'List of real company names for inspiration', source: 'db query', example: '- Hughes Network Systems\n- SES S.A.' },
  { name: 'recentFilingTypes', description: 'Recent filing subsystem/type pairs', source: 'db query', example: '- SAT-LOA (Launch and Operate)\n- SES-MOD (Modification)' },
];
```

---

## Task 3: Register Pipeline Stage

**Files:**
- Modify: `packages/server/src/pipeline/registry.ts`

Add `newspaper.fake-ad` stage after `newspaper.hero-image`:

```typescript
{
  id: 'newspaper.fake-ad',
  group: 'newspaper',
  name: 'Fake Ad',
  description: 'Generate a tongue-in-cheek display advertisement',
  defaultConcurrency: 1,
  parallelizable: false,
  async run(ctx: PipelineContext): Promise<StageResult> {
    // Lazy imports, idempotency check (skip if ad already generated for today)
    // Call generateFakeAd, save via upsertArticle with slug 'fake-ad'
    // Return StageResult
  },
},
```

Add `'newspaper.fake-ad'` to the newspaper group's `stageIds`.

---

## Task 4: Add CLI Support for --type fake_ad

**Files:**
- Modify: `packages/server/src/cli/newspaper/index.ts`

Ensure `./daily-orbit newspaper generate --type fake_ad` runs only the fake ad generator (skip digest and hero image). The `--type` filter should already be wired from Session 1, but verify it routes to the new generator.

---

## Task 5: Extend API Response

**Files:**
- Verify: `packages/server/src/newspaper/routes.ts`

The edition API already returns all articles by edition. Verify that fake ads appear in the response with `content_type: 'fake_ad'` and proper ordering (`display_order` should be high, e.g., 90, so ads sort after editorial content).

---

## Verification

1. `make test` — all tests pass including new fake-ad generator tests
2. `./daily-orbit newspaper generate --type fake_ad` — generates a single ad
3. `./daily-orbit newspaper show --date $(date +%Y-%m-%d)` — shows digest + ad
4. `curl localhost:9000/api/newspaper/edition/latest | jq '.articles[] | select(.contentType == "fake_ad")'` — ad appears in API response
5. Run full newspaper pipeline from admin UI — all 4 stages complete (ensure-edition, daily-digest, hero-image, fake-ad)
