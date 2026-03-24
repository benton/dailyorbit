# Newspaper Session 5: Asset Library — Portraits & Section Headers

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the one-time asset generation pipeline: a library of ~100 "(not) portrait" headshots and ~15 ornamental section header vignettes. Implement deterministic portrait assignment so the same person always gets the same fictional face. After this session, the newspaper has a complete static image library.

**Prereqs:** Sessions 1-2 complete (foundation + image generation). Sessions 3-4 are NOT required — the asset library is independent.

---

## Task 1: Create Portrait Library Generator

**Files:**
- New: `packages/server/src/newspaper/generators/portrait-library.ts`
- New: `packages/server/src/newspaper/generators/portrait-library.test.ts`

Batch-generates ~100 portraits in steel-engraving style, stored as WebP files and tracked in `newspaper_image`.

**Portrait categories:**
- ~60 "standard" — varied demographics, suits/professional attire
- ~20 "distinguished" — monocles, top hats, elaborate mustaches, pearl necklaces, medals
- ~20 "institutional" — not people: satellite dish, radio tower, FCC building, gavel, briefcase, globe

**Prompt templates:**

```typescript
const PORTRAIT_PROMPTS: ReadonlyArray<{ tags: string[]; prompt: string }> = [
  // Standard portraits — vary demographics
  { tags: ['standard', 'male', 'young'],
    prompt: 'young man in business suit, clean-shaven, short hair' },
  { tags: ['standard', 'female', 'middle-aged'],
    prompt: 'middle-aged woman in formal blouse, hair pinned up' },
  // Distinguished portraits
  { tags: ['distinguished', 'male'],
    prompt: 'elderly gentleman with enormous handlebar mustache, monocle, top hat' },
  // Institutional vignettes
  { tags: ['institutional', 'building'],
    prompt: 'neoclassical government building with columns and dome, labeled FCC' },
  { tags: ['institutional', 'satellite'],
    prompt: 'large parabolic satellite dish antenna pointed at the sky' },
  // ... ~100 total entries
];
```

Each prompt is prefixed with the standard engraving style from the style guide:
```typescript
const PORTRAIT_STYLE: string =
  'Steel engraving portrait bust, black ink crosshatch on white background, ' +
  'formal attire circa 1900, oval vignette frame. ' +
  'Style of Victorian newspaper portrait illustration. ';
```

**Generator function:**
```typescript
export async function generatePortraitLibrary(
  conn: DuckDBConnection,
  imageClient: BedrockClient,
  config: ConfigService,
  log: (msg: string) => void,
  options?: { startIndex?: number; limit?: number }
): Promise<{ generated: number; skipped: number; failed: number }> {
  const modelId: string = config.get('newspaperImageModel') as string;
  const baseDir: string = join('data', 'newspaper', 'images', 'library', 'portraits');
  await mkdir(baseDir, { recursive: true });

  let generated: number = 0;
  let skipped: number = 0;
  let failed: number = 0;

  for (const [i, entry] of PORTRAIT_PROMPTS.entries()) {
    if (options?.startIndex != null && i < options.startIndex) continue;
    if (options?.limit != null && generated >= options.limit) break;

    const imagePath: string = join(baseDir, `${String(i).padStart(3, '0')}.webp`);

    // Skip if already exists in DB
    const existing = await getImageByPath(conn, imagePath);
    if (existing) { skipped++; continue; }

    try {
      const fullPrompt: string = PORTRAIT_STYLE + entry.prompt;
      const response = await imageClient.generateImage({
        modelId,
        prompt: fullPrompt,
        negativePrompt: 'photograph, realistic, color, modern',
        width: 256,
        height: 320,
        seed: i * 42,  // deterministic for reproducibility
      });
      await writeFile(imagePath, response.images[0]);
      await insertImage(conn, {
        imageType: 'portrait',
        imagePath,
        prompt: fullPrompt,
        tags: entry.tags,
        generatedBy: modelId,
      });
      generated++;
      log(`Portrait ${i}/${PORTRAIT_PROMPTS.length} generated`);
    } catch (err) {
      failed++;
      log(`Portrait ${i} failed: ${(err as Error).message}`);
    }
  }

  return { generated, skipped, failed };
}
```

**Key design:** Uses `seed: i * 42` for reproducibility — regenerating the same index produces the same portrait. The `startIndex` and `limit` options allow resumable batch generation.

**Tests:** Mock image client, verify:
- Skips already-existing images (idempotent)
- Correctly constructs prompts with style prefix
- Writes files to correct paths
- Inserts DB records with tags

---

## Task 2: Create Section Header Generator

**Files:**
- New: `packages/server/src/newspaper/generators/section-headers.ts`
- New: `packages/server/src/newspaper/generators/section-headers.test.ts`

Generate ~15 ornamental section headers (see `doc/design/REgularColumnHeading.jpg`) for recurring newspaper columns.

```typescript
const SECTION_HEADERS: ReadonlyArray<{ name: string; prompt: string }> = [
  { name: 'three-miles-up',
    prompt: 'central vignette of a satellite orbiting Earth' },
  { name: 'the-wire',
    prompt: 'central vignette of a telegraph or radio transmitter' },
  { name: 'the-docket',
    prompt: 'central vignette of an open legal docket book with a gavel' },
  { name: 'over-the-horizon',
    prompt: 'central vignette of a horizon with radio waves arcing over it' },
  { name: 'company-spotlight',
    prompt: 'central vignette of a spotlight beam illuminating a corporate building' },
  { name: 'orbital-forecast',
    prompt: 'central vignette of orbital paths around a globe with a weather vane' },
  { name: 'the-classifieds',
    prompt: 'central vignette of stacked newspaper classified pages' },
  { name: 'market-ticker',
    prompt: 'central vignette of a stock ticker tape machine' },
  { name: 'washington-weather',
    prompt: 'central vignette of the US Capitol dome with clouds' },
  { name: 'satellite-weather',
    prompt: 'central vignette of the Sun with solar flare activity' },
  { name: 'on-this-day',
    prompt: 'central vignette of an open history book with a quill pen' },
  { name: 'ask-the-editor',
    prompt: 'central vignette of a mailbox overflowing with letters' },
  { name: 'editorial-cartoon',
    prompt: 'central vignette of an artist easel with a caricature sketch' },
  { name: 'letters-to-the-editor',
    prompt: 'central vignette of sealed letters with wax stamps' },
  { name: 'the-crossword',
    prompt: 'central vignette of a crossword puzzle grid' },
];

const HEADER_STYLE: string =
  'Ornamental banner with decorative border, black ink engraving style, ' +
  'flanked by scrollwork and floral ornaments. ' +
  'Style of 19th century newspaper column heading. Wide aspect ratio. ';
```

Images saved at `data/newspaper/images/library/headers/{name}.webp` at 800x200.

---

## Task 3: Implement Deterministic Portrait Assignment

**Files:**
- New: `packages/server/src/newspaper/portrait-assignment.ts`
- New: `packages/server/src/newspaper/portrait-assignment.test.ts`

Hash a person's name to a portrait index so they always get the same fictional "face":

```typescript
import { createHash } from 'node:crypto';

/**
 * Deterministically assign a portrait index to a person name.
 * The same name always maps to the same portrait.
 */
export function assignPortrait(name: string, librarySize: number): number {
  const hash: string = createHash('md5').update(name.toLowerCase().trim()).digest('hex');
  return parseInt(hash.slice(0, 8), 16) % librarySize;
}

/**
 * Get the portrait path for a given person name.
 * Returns null if the portrait library hasn't been generated.
 */
export async function getPortraitForPerson(
  conn: DuckDBConnection,
  personName: string,
): Promise<NewspaperImage | null> {
  const portraits = await listImagesByType(conn, 'portrait');
  if (portraits.length === 0) return null;
  const index: number = assignPortrait(personName, portraits.length);
  return portraits[index];
}
```

**Tests:**
- Same name always returns same index (deterministic)
- Different names distribute across the range
- Case-insensitive ("John DOE" === "john doe")
- Handles empty library gracefully

---

## Task 4: Add Repository Methods for newspaper_image

**Files:**
- Modify: `packages/server/src/newspaper/repository.ts`
- Modify: `packages/server/src/newspaper/repository.test.ts`

```typescript
insertImage(conn, image: Omit<NewspaperImage, 'id' | 'createdAt'>): Promise<NewspaperImage>
getImageByPath(conn, imagePath: string): Promise<NewspaperImage | null>
listImagesByType(conn, imageType: string): Promise<NewspaperImage[]>
countImagesByType(conn, imageType: string): Promise<number>
```

---

## Task 5: Add CLI Command

**Files:**
- Modify: `packages/server/src/cli/newspaper/index.ts`

Add `generate-library` subcommand:

```
./daily-orbit newspaper generate-library [--type portraits|headers|all] [--start 0] [--limit 10]
```

Default: `--type all`. The `--start` and `--limit` flags allow generating in batches (useful for testing or if the API rate-limits).

---

## Task 6: Add Portrait API Route

**Files:**
- Modify: `packages/server/src/newspaper/routes.ts`

```typescript
// GET /api/newspaper/library/portraits           — list all portraits
// GET /api/newspaper/library/portraits/:name     — get portrait for a person name
// GET /api/newspaper/library/section-headers      — list all section headers
// GET /api/newspaper/library/section-headers/:name — get specific header
```

The `/portraits/:name` endpoint uses `getPortraitForPerson()` to do the deterministic lookup and returns the image path + metadata.

---

## Verification

1. `make test` — all tests pass
2. `./daily-orbit newspaper generate-library --type portraits --limit 5` — generates 5 portraits, files exist on disk
3. `./daily-orbit newspaper generate-library --type headers` — generates all 15 headers
4. Rerun `generate-library` — skips already-generated images (idempotent)
5. `curl localhost:9000/api/newspaper/library/portraits/Jessica%20Rosenworcel` — returns a deterministic portrait
6. Same URL called again returns the same portrait (deterministic)
7. `curl localhost:9000/api/newspaper/library/section-headers` — lists all headers with paths
8. Total generation cost for full library: ~100 portraits + 15 headers = ~$1 total
