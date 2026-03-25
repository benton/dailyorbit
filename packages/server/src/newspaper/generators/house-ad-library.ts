import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import type { DuckDBConnection, DuckDBValue } from '@duckdb/node-api';
import type { InferenceService } from '../../inference/inference-service.ts';
import type { ConfigService } from '../../lib/config-service.ts';
import type { ImageGenerationRequest } from '../../inference/types.ts';
import {
  DEFAULT_HOUSE_AD_SYSTEM_PROMPT,
  DEFAULT_HOUSE_AD_USER_PROMPT,
} from '../prompts.ts';
import {
  getImageByPath,
  insertImage,
  insertHouseAd,
  countHouseAds,
} from '../repository.ts';
import { createImageUploader } from './upload-after-write.ts';

export type HouseAdEntry = {
  tagline: string;
  imagePrompt: string;
};

export type ImageClient = {
  generateImage(
    req: ImageGenerationRequest,
  ): Promise<{ images: Buffer[]; latencyMs: number }>;
};

const HOUSE_AD_NEGATIVE: string =
  'photograph, realistic, color, modern, blurry, low quality, text, watermark';

/**
 * Call the LLM to generate 30 tagline/image-prompt pairs.
 * Returns the parsed array; does NOT write to DB.
 */
export async function generateHouseAdCopy(
  inferenceService: InferenceService,
  config: ConfigService,
  count: number = 30,
): Promise<HouseAdEntry[]> {
  const modelId: string = config.get('newspaperCopyModel') as string;
  const systemPrompt: string =
    (config.get('newspaperHouseAdSystemPrompt') as string) ||
    DEFAULT_HOUSE_AD_SYSTEM_PROMPT.replace(/30/g, String(count));
  const userPrompt: string =
    (config.get('newspaperHouseAdUserPrompt') as string) ||
    DEFAULT_HOUSE_AD_USER_PROMPT.replace(/30/g, String(count));

  const response = await inferenceService.complete({
    modelId,
    messages: [{ role: 'user' as const, content: userPrompt }],
    params: { systemPrompt, maxTokens: 8192 },
  });

  return parseHouseAdResponse(response.content);
}

/**
 * Parse and validate the LLM JSON response into HouseAdEntry[].
 * Exported for testing.
 */
export function parseHouseAdResponse(content: string): HouseAdEntry[] {
  // Strip markdown fences if present
  const cleaned: string = content
    .replace(/^```(?:json)?\s*/m, '')
    .replace(/\s*```\s*$/m, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    // LLM output may be truncated — try to salvage complete entries.
    // Find the last complete object by looking for the last "},"  or "}" before "]"
    const lastComplete: number = cleaned.lastIndexOf('},');
    if (lastComplete === -1) {
      throw new Error(
        'Could not parse house ad JSON and no complete entries found to salvage',
      );
    }
    const repaired: string = cleaned.slice(0, lastComplete + 1) + ']';
    parsed = JSON.parse(repaired);
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Expected JSON array from house ad generation');
  }

  const entries: HouseAdEntry[] = [];
  for (const [i, item] of parsed.entries()) {
    if (
      typeof item !== 'object' ||
      item === null ||
      typeof item.tagline !== 'string' ||
      typeof item.imagePrompt !== 'string'
    ) {
      throw new Error(
        `Invalid house ad entry at index ${String(i)}: missing tagline or imagePrompt`,
      );
    }
    entries.push({
      tagline: item.tagline.trim(),
      imagePrompt: item.imagePrompt.trim(),
    });
  }

  return entries;
}

/**
 * Generate images for house ad entries, following the portrait-library pattern.
 * Skips entries already in the newspaper_image table.
 */
export async function generateHouseAdImages(
  entries: HouseAdEntry[],
  conn: DuckDBConnection,
  imageClient: ImageClient,
  config: ConfigService,
  log: (msg: string) => void,
  options?: {
    baseSeed?: number;
    dataDir?: string;
  },
): Promise<{ generated: number; skipped: number; failed: number }> {
  const modelId: string = config.get('newspaperImageModel') as string;
  const dataDir: string = options?.dataDir ?? 'data';
  const baseDir: string = join(
    dataDir,
    'newspaper',
    'images',
    'library',
    'house-ads',
  );
  await mkdir(baseDir, { recursive: true });

  const upload = createImageUploader();
  let generated: number = 0;
  let skipped: number = 0;
  let failed: number = 0;

  for (const [i, entry] of entries.entries()) {
    const imagePath: string = join(
      baseDir,
      `${String(i).padStart(3, '0')}.webp`,
    );

    const existing = await getImageByPath(conn, imagePath);
    if (existing) {
      skipped++;
      continue;
    }

    try {
      const response = await imageClient.generateImage({
        modelId,
        prompt: entry.imagePrompt,
        negativePrompt: HOUSE_AD_NEGATIVE,
        width: 320,
        height: 320,
        seed: options?.baseSeed != null ? options.baseSeed + i : i * 42,
      });
      await writeFile(imagePath, response.images[0]!);
      await upload(imagePath);
      await insertImage(conn, {
        imageType: 'house_ad',
        imagePath,
        prompt: entry.imagePrompt,
        tags: [
          'house_ad',
          entry.tagline.toLowerCase().replace(/\s+/g, '-').slice(0, 50),
        ],
        generatedBy: modelId,
      });
      generated++;
      log(`House ad ${String(i)}/${String(entries.length)} generated`);
    } catch (err) {
      failed++;
      log(`House ad ${String(i)} failed: ${(err as Error).message}`);
    }
  }

  return { generated, skipped, failed };
}

/**
 * Insert house ad entries into the house_ad table, skipping duplicates.
 * Pairs each entry with its generated image path.
 */
export async function insertHouseAdEntries(
  entries: HouseAdEntry[],
  conn: DuckDBConnection,
  generatedBy: string | null,
  log: (msg: string) => void,
  options?: { dataDir?: string },
): Promise<{ inserted: number; skipped: number }> {
  const dataDir: string = options?.dataDir ?? 'data';
  const baseDir: string = join(
    dataDir,
    'newspaper',
    'images',
    'library',
    'house-ads',
  );

  const existingCount: number = await countHouseAds(conn);
  let inserted: number = 0;
  let skipped: number = 0;

  for (const [i, entry] of entries.entries()) {
    // Skip if tagline already exists (idempotency)
    if (existingCount > 0) {
      const reader = await conn.runAndReadAll(
        `SELECT count(*)::INTEGER AS cnt FROM house_ad WHERE tagline = ?`,
        [entry.tagline] as DuckDBValue[],
      );
      const cnt: number = Number(reader.getRowObjectsJS()[0]!.cnt);
      if (cnt > 0) {
        skipped++;
        continue;
      }
    }

    const imagePath: string = join(
      baseDir,
      `${String(i).padStart(3, '0')}.webp`,
    );

    await insertHouseAd(conn, {
      tagline: entry.tagline,
      imagePath,
      imagePrompt: entry.imagePrompt,
      generatedBy,
    });
    inserted++;
    log(`House ad DB row ${String(i)} inserted`);
  }

  return { inserted, skipped };
}
