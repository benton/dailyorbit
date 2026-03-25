import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { BedrockClientLike } from '../../inference/bedrock-client.ts';
import { getArticle } from '../repository.ts';
import type { GenerateOptions, GeneratorResult } from '../types.ts';
import { createImageUploader } from './upload-after-write.ts';

/** Style prefix for all hero image prompts — 19th century steel engraving. */
const ENGRAVING_STYLE_PREFIX: string =
  'Steel engraving illustration, black ink crosshatch on white background, ' +
  'style of 19th century newspaper illustration, fine parallel lines for shading, ' +
  'no color, high contrast. No text, no words, no letters, no writing in the image. ';

/** Negative prompt to steer away from photorealism and color. */
const ENGRAVING_NEGATIVE: string =
  'photograph, realistic, color, modern, blurry, low quality, text, watermark';

/** Extended options for the hero image generator — needs an image-capable client. */
export type HeroImageOptions = GenerateOptions & {
  imageClient: BedrockClientLike;
  /** Override base data directory (for testing). Defaults to 'data'. */
  _dataDir?: string;
};

/**
 * Generate a front-page steel engraving hero image from the daily digest.
 * Reads the already-generated daily digest article, extracts a scene hint,
 * and calls Bedrock image generation.
 */
export async function generateHeroImage(
  opts: HeroImageOptions,
): Promise<GeneratorResult> {
  const { conn, editionId, editionDate, config, imageClient, log, _dataDir } =
    opts;
  const dataDir: string = _dataDir ?? 'data';

  // 1. Get the daily digest to derive the scene
  const digest = await getArticle(conn, editionId, 'three-miles-up');
  if (digest == null || digest.status !== 'generated') {
    throw new Error('Daily digest must be generated before hero image');
  }

  // 2. Build image prompt — use first ~200 chars of digest body as scene hint
  const sceneHint: string = digest.body.slice(0, 200).replace(/[[\]()]/g, '');
  const imagePrompt: string =
    ENGRAVING_STYLE_PREFIX +
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
  const imageDir: string = join(dataDir, 'newspaper', 'images', editionDate);
  await mkdir(imageDir, { recursive: true });
  const imagePath: string = join(imageDir, 'hero.webp');
  await writeFile(imagePath, response.images[0]!);
  const upload = createImageUploader();
  await upload(imagePath);
  log('info', `Hero image saved to ${imagePath}`);

  return {
    headline: '',
    body: '',
    imagePath,
    imagePrompt,
    sourceData: { digestSlug: 'three-miles-up', modelId },
  };
}
