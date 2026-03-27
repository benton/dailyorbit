import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DuckDBConnection } from '@duckdb/node-api';
import type { ConfigService } from '../../lib/config-service.ts';
import { getImageByPath, insertImage } from '../repository.ts';
import type { ImageClient } from './portrait-library.ts';
import { createImageUploader } from './upload-after-write.ts';

// ── Style constants ────────────────────────────────────────────────

export const HEADER_STYLE: string =
  'Ornamental banner with decorative border, black ink engraving style, ' +
  'flanked by scrollwork and floral ornaments. ' +
  'Style of 19th century newspaper column heading. Wide aspect ratio. ' +
  'No text, no words, no letters, no writing in the image. ';

export const HEADER_NEGATIVE: string =
  'photograph, realistic, color, modern, blurry, low quality, text, watermark';

// ── Section header definitions ─────────────────────────────────────

export type SectionHeaderEntry = {
  name: string;
  prompt: string;
};

export const SECTION_HEADERS: ReadonlyArray<SectionHeaderEntry> = [
  {
    name: 'three-miles-up',
    prompt: 'central vignette of a satellite orbiting Earth',
  },
  {
    name: 'the-wire',
    prompt: 'central vignette of a telegraph or radio transmitter',
  },
  {
    name: 'the-docket',
    prompt: 'central vignette of an open legal docket book with a gavel',
  },
  {
    name: 'over-the-horizon',
    prompt: 'central vignette of a horizon with radio waves arcing over it',
  },
  {
    name: 'company-spotlight',
    prompt:
      'central vignette of a spotlight beam illuminating a corporate building',
  },
  {
    name: 'orbital-forecast',
    prompt:
      'central vignette of orbital paths around a globe with a weather vane',
  },
  {
    name: 'the-classifieds',
    prompt: 'central vignette of stacked newspaper classified pages',
  },
  {
    name: 'market-ticker',
    prompt: 'central vignette of a stock ticker tape machine',
  },
  {
    name: 'washington-weather',
    prompt: 'central vignette of the US Capitol dome with clouds',
  },
  {
    name: 'satellite-weather',
    prompt: 'central vignette of the Sun with solar flare activity',
  },
  {
    name: 'on-this-day',
    prompt: 'central vignette of an open history book with a quill pen',
  },
  {
    name: 'ask-the-editor',
    prompt: 'central vignette of a mailbox overflowing with letters',
  },
  {
    name: 'editorial-cartoon',
    prompt: 'central vignette of an artist easel with a caricature sketch',
  },
  {
    name: 'letters-to-the-editor',
    prompt: 'central vignette of sealed letters with wax stamps',
  },
  {
    name: 'the-crossword',
    prompt: 'central vignette of a crossword puzzle grid',
  },
  {
    name: 'spectrum-watch',
    prompt: 'central vignette of radio spectrum waves across frequency bands',
  },
  {
    name: 'competitive-intel',
    prompt: 'central vignette of two chess pieces facing each other',
  },
  {
    name: 'filing-in-focus',
    prompt: 'central vignette of a magnifying glass over a document',
  },
  {
    name: 'the-applicant',
    prompt: 'central vignette of a portrait frame with a silhouette',
  },
  {
    name: 'tech-spotlight',
    prompt: 'central vignette of a mechanical gear with lightning',
  },
  {
    name: 'counsels-brief',
    prompt: "central vignette of a judge's gavel with legal scales",
  },
  {
    name: 'press-gallery',
    prompt: 'central vignette of a press gallery with notebooks and pencils',
  },
];

// ── Generator function ─────────────────────────────────────────────

export async function generateSectionHeaders(
  conn: DuckDBConnection,
  imageClient: ImageClient,
  config: ConfigService,
  log: (msg: string) => void,
  options?: { baseSeed?: number; dataDir?: string },
): Promise<{ generated: number; skipped: number; failed: number }> {
  const modelId: string = config.get('newspaperImageModel') as string;
  const dataDir: string = options?.dataDir ?? 'data';
  const baseDir: string = join(
    dataDir,
    'newspaper',
    'images',
    'library',
    'headers',
  );
  await mkdir(baseDir, { recursive: true });

  const upload = createImageUploader();
  let generated: number = 0;
  let skipped: number = 0;
  let failed: number = 0;

  for (const [i, entry] of SECTION_HEADERS.entries()) {
    const imagePath: string = join(baseDir, `${entry.name}.webp`);

    const existing = await getImageByPath(conn, imagePath);
    if (existing) {
      skipped++;
      continue;
    }

    try {
      const fullPrompt: string = HEADER_STYLE + entry.prompt;
      const response = await imageClient.generateImage({
        modelId,
        prompt: fullPrompt,
        negativePrompt: HEADER_NEGATIVE,
        width: 1024,
        height: 320,
        seed:
          options?.baseSeed != null ? options.baseSeed + i : (i + 1000) * 42,
      });
      await writeFile(imagePath, response.images[0]!);
      await upload(imagePath);
      await insertImage(conn, {
        imageType: 'section_header',
        imagePath,
        prompt: fullPrompt,
        tags: [entry.name],
        generatedBy: modelId,
      });
      generated++;
      log(
        `Header "${entry.name}" generated (${String(i + 1)}/${String(SECTION_HEADERS.length)})`,
      );
    } catch (err) {
      failed++;
      log(`Header "${entry.name}" failed: ${(err as Error).message}`);
    }
  }

  return { generated, skipped, failed };
}
