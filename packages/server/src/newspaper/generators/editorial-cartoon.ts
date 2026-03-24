import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { BedrockClientLike } from '../../inference/bedrock-client.ts';
import { renderPrompt } from '../../inference/prompts.ts';
import { getArticle } from '../repository.ts';
import type { GenerateOptions, GeneratorResult } from '../types.ts';

/** Style prefix for editorial cartoons — Punch magazine crosshatch style. */
const CARTOON_STYLE: string =
  'Single-panel editorial cartoon, black ink crosshatch style, ' +
  'style of Punch magazine illustration circa 1900, satirical, ' +
  'with caption space below. ';

/** Negative prompt to steer away from photorealism. */
const CARTOON_NEGATIVE: string =
  'photograph, realistic, color, modern, blurry, low quality, watermark, multiple panels';

/** Extended options for the editorial cartoon generator. */
export type EditorialCartoonOptions = GenerateOptions & {
  imageClient: BedrockClientLike;
  /** Override base data directory (for testing). */
  _dataDir?: string;
};

/**
 * Generate an editorial cartoon inspired by the weekly editorial.
 * 1. Read the editorial to get the theme
 * 2. Use a short LLM call to generate a cartoon description
 * 3. Build image prompt with Punch-magazine style prefix
 * 4. Call generateImage at 512x512
 * 5. Save to data/newspaper/images/{date}/editorial-cartoon.webp
 */
export async function generateEditorialCartoon(
  opts: EditorialCartoonOptions,
): Promise<GeneratorResult> {
  const {
    conn,
    editionId,
    editionDate,
    inferenceService,
    config,
    imageClient,
    log,
    _dataDir,
  } = opts;
  const dataDir: string = _dataDir ?? 'data';

  // 1. Read the editorial to get the theme
  const editorial = await getArticle(conn, editionId, 'over-the-horizon');
  if (editorial == null || editorial.status !== 'generated') {
    throw new Error('Editorial must be generated before editorial cartoon');
  }

  // 2. Generate a short cartoon description via LLM
  const modelId: string = config.get('newspaperCopyModel') as string;
  log('info', 'Generating cartoon description...');

  const descriptionPrompt: string = renderPrompt(
    `Based on this editorial, describe a single-panel satirical cartoon in 1-2 sentences. Focus on a visual metaphor or allegory. Do not include any text or dialogue — just describe the visual scene.\n\nEditorial excerpt:\n{{{editorialText}}}`,
    { editorialText: editorial.body.slice(0, 500) },
  );

  const descResponse = await inferenceService.complete({
    modelId,
    messages: [{ role: 'user' as const, content: descriptionPrompt }],
    params: {
      systemPrompt:
        'You are a political cartoonist. Describe visual scenes concisely.',
      maxTokens: 150,
    },
  });

  const cartoonDescription: string = descResponse.content.trim();

  // 3. Build image prompt with style prefix
  const imagePrompt: string = CARTOON_STYLE + cartoonDescription;

  // 4. Generate image at 512x512
  const imageModelId: string = config.get('newspaperImageModel') as string;
  log('info', `Generating editorial cartoon with ${imageModelId}...`);
  const imageResponse = await imageClient.generateImage({
    modelId: imageModelId,
    prompt: imagePrompt,
    negativePrompt: CARTOON_NEGATIVE,
    width: 512,
    height: 512,
  });

  // 5. Save to disk
  const imageDir: string = join(dataDir, 'newspaper', 'images', editionDate);
  await mkdir(imageDir, { recursive: true });
  const imagePath: string = join(imageDir, 'editorial-cartoon.webp');
  await writeFile(imagePath, imageResponse.images[0]!);
  log('info', `Editorial cartoon saved to ${imagePath}`);

  return {
    headline: '',
    body: cartoonDescription,
    imagePath,
    imagePrompt,
    sourceData: {
      editorialSlug: 'over-the-horizon',
      cartoonDescription,
      modelId,
      imageModelId,
    },
  };
}
