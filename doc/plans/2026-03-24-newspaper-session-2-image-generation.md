# Newspaper Session 2: Image Generation — Hero Engraving

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Bedrock image generation capability (Nova Canvas) to the inference layer, then build the hero image generator that creates a daily front-page engraving from the daily digest summary. After this session, the newspaper pipeline produces both a text article and a hero image.

**Prereqs:** Session 1 complete (newspaper submodule, schema, repository, daily-digest generator, pipeline stages).

---

## Task 1: Add Image Generation Types

**Files:**
- Modify: `packages/server/src/inference/types.ts`

Add after existing types:

```typescript
export type ImageGenerationRequest = {
  readonly modelId: string;
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly width?: number;    // default 1024
  readonly height?: number;   // default 768
  readonly numberOfImages?: number; // default 1
  readonly cfgScale?: number; // default 8
  readonly seed?: number;     // for reproducibility
};

export type ImageGenerationResponse = {
  readonly images: Buffer[];  // PNG/WebP image data
  readonly latencyMs: number;
};
```

---

## Task 2: Add generateImage() to BedrockClient

**Files:**
- Modify: `packages/server/src/inference/bedrock-client.ts`
- New: `packages/server/src/inference/bedrock-client-image.test.ts`

Add method to `BedrockClient` class. Uses `InvokeModelCommand` (same as existing `embed()` method — not the Converse API).

```typescript
async generateImage(req: ImageGenerationRequest): Promise<ImageGenerationResponse> {
  const body: string = JSON.stringify({
    taskType: 'TEXT_IMAGE',
    textToImageParams: {
      text: req.prompt,
      negativeText: req.negativePrompt ?? 'photograph, realistic, color, modern, blurry',
    },
    imageGenerationConfig: {
      numberOfImages: req.numberOfImages ?? 1,
      width: req.width ?? 1024,
      height: req.height ?? 768,
      cfgScale: req.cfgScale ?? 8,
      ...(req.seed != null ? { seed: req.seed } : {}),
    },
  });

  const start: number = performance.now();
  const command = new InvokeModelCommand({
    modelId: req.modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: new TextEncoder().encode(body),
  });

  const response = await this.client.send(command);
  const latencyMs: number = Math.round(performance.now() - start);
  const parsed = JSON.parse(new TextDecoder().decode(response.body)) as { images: string[] };

  return {
    images: parsed.images.map((b64: string) => Buffer.from(b64, 'base64')),
    latencyMs,
  };
}
```

**Note:** The Nova Canvas request format may differ slightly from Titan Image Generator. Check the [Bedrock docs](https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-titan-image.html) for Nova Canvas vs Titan request schemas. The `taskType` and param names may need adjustment. Build a quick test script in `scripts/` to validate the request format against the live API before committing.

**Update `BedrockClientLike` interface** (if it exists as a type) to include `generateImage`.

**Tests:** Unit test with mocked AWS SDK client verifying:
- Correct `InvokeModelCommand` body is constructed
- Response base64 is decoded to Buffer
- Latency is measured

---

## Task 3: Update InstrumentedBedrockClient

**Files:**
- Modify: `packages/server/src/inference/instrumented-client.ts`
- Modify: `packages/server/src/inference/instrumented-client.test.ts`

Add `generateImage` wrapper that logs with `operation: 'generate_image'`:

```typescript
async generateImage(req: ImageGenerationRequest): Promise<ImageGenerationResponse> {
  const start: number = performance.now();
  const response = await this.backend.generateImage(req);
  const latencyMs: number = Math.round(performance.now() - start);

  // Log — image generation uses per-image pricing, not per-token
  void logInference(this.conn, {
    modelId: req.modelId,
    operation: 'generate_image',
    caller: this.caller,
    inputTokens: 0,
    outputTokens: req.numberOfImages ?? 1,  // track image count in outputTokens
    latencyMs,
    userId: this.userId,
  }).catch(() => {});

  return response;
}
```

---

## Task 4: Update Pricing Table

**Files:**
- Modify: `packages/server/src/inference/pricing.ts`

Add Nova Canvas entry. Image generation uses per-image pricing, not per-token. Since the log tracks `outputTokens` as image count, we can use `outputPer1k` as cost-per-1000-images:

```typescript
'amazon.nova-canvas-v1:0': {
  inputPer1k: 0,
  outputPer1k: 8.0,  // $0.008 per image × 1000 = $8.00 per 1k images
},
```

Also add Titan Image Generator as fallback:
```typescript
'amazon.titan-image-generator-v2:0': {
  inputPer1k: 0,
  outputPer1k: 8.0,
},
```

---

## Task 5: Create Hero Image Generator

**Files:**
- New: `packages/server/src/newspaper/generators/hero-image.ts`
- New: `packages/server/src/newspaper/generators/hero-image.test.ts`

The hero image generator:
1. Reads the already-generated daily digest article from the edition
2. Extracts a scene description from the digest text (either via a short LLM call or simple heuristic)
3. Builds an image prompt with the steel-engraving style prefix from the style guide
4. Calls `generateImage()` via the Bedrock client
5. Saves the image to disk at `data/newspaper/images/{date}/hero.webp`
6. Returns the path

```typescript
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const ENGRAVING_STYLE_PREFIX: string =
  'Steel engraving illustration, black ink crosshatch on white background, ' +
  'style of 19th century newspaper illustration, fine parallel lines for shading, ' +
  'no color, high contrast. ';

const ENGRAVING_NEGATIVE: string =
  'photograph, realistic, color, modern, blurry, low quality, text, watermark';

export async function generateHeroImage(
  opts: GenerateOptions & { imageClient: BedrockClient }
): Promise<GeneratorResult> {
  const { conn, editionId, editionDate, config, imageClient, log } = opts;

  // 1. Get the daily digest to derive the scene
  const digest = await getArticle(conn, editionId, 'three-miles-up');
  if (!digest || digest.status !== 'generated') {
    throw new Error('Daily digest must be generated before hero image');
  }

  // 2. Build image prompt — use first ~200 chars of digest as scene hint
  const sceneHint: string = digest.body.slice(0, 200).replace(/[[\]()]/g, '');
  const imagePrompt: string = ENGRAVING_STYLE_PREFIX +
    `Scene depicting: ${sceneHint}. Satellite dishes, radio towers, government buildings.`;

  // 3. Generate image
  const modelId: string = config.get('newspaperImageModel') as string;
  log('info', `Generating hero engraving with ${modelId}...`);
  const response = await imageClient.generateImage({
    modelId,
    prompt: imagePrompt,
    negativePrompt: ENGRAVING_NEGATIVE,
    width: 1024,
    height: 768,
  });

  // 4. Save to disk
  const imageDir: string = join('data', 'newspaper', 'images', editionDate);
  await mkdir(imageDir, { recursive: true });
  const imagePath: string = join(imageDir, 'hero.webp');
  await writeFile(imagePath, response.images[0]);
  log('info', `Hero image saved to ${imagePath}`);

  return {
    headline: '',
    body: '',
    imagePath,
    imagePrompt,
    sourceData: { digestSlug: 'three-miles-up', modelId },
  };
}
```

**Tests:** Mock the image client to return a small buffer. Verify:
- Digest must exist before hero image (error case)
- Image prompt includes style prefix
- File is written to correct path

---

## Task 6: Register Hero Image Pipeline Stage

**Files:**
- Modify: `packages/server/src/pipeline/registry.ts`

Add `newspaper.hero-image` stage after `newspaper.daily-digest`:

```typescript
{
  id: 'newspaper.hero-image',
  group: 'newspaper',
  name: 'Hero Image',
  description: 'Generate front-page steel engraving from daily digest',
  defaultConcurrency: 1,
  parallelizable: false,
  async run(ctx: PipelineContext): Promise<StageResult> {
    // ... lazy imports, idempotency check, call generateHeroImage, save result
  },
},
```

Add `'newspaper.hero-image'` to the newspaper group's `stageIds` array.

---

## Task 7: Add Static Image Serving Route

**Files:**
- Modify: `packages/server/src/newspaper/routes.ts`

Add a static file route for generated images:

```typescript
// GET /api/newspaper/images/* — serve generated images from data/newspaper/images/
```

Use Hono's `serveStatic` or a manual file-read handler. Ensure the route validates the path to prevent directory traversal.

---

## Task 8: Create Test Script for Live API Validation

**Files:**
- New: `packages/server/scripts/test-nova-canvas.ts`

A quick throwaway script to validate the Nova Canvas request format against the live Bedrock API. Run it once to confirm the request schema, then delete or `.gitignore` it.

```typescript
#!/usr/bin/env node --no-warnings --experimental-specifier-resolution=node --loader ts-node/esm
// Test Nova Canvas image generation against live Bedrock API
```

---

## Verification

1. `make test` — all new and existing tests pass
2. `./daily-orbit newspaper generate` — generates daily digest AND hero image
3. `ls data/newspaper/images/$(date +%Y-%m-%d)/hero.webp` — image file exists
4. `curl localhost:9000/api/newspaper/images/$(date +%Y-%m-%d)/hero.webp -o /tmp/hero.webp && open /tmp/hero.webp` — image renders correctly
5. Admin pipeline UI shows 3 newspaper stages: ensure-edition, daily-digest, hero-image
6. Inference cost log shows `generate_image` operation entries
