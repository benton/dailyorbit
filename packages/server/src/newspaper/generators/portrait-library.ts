import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { DuckDBConnection } from '@duckdb/node-api';
import type { ConfigService } from '../../lib/config-service.ts';
import type { ImageGenerationRequest } from '../../inference/types.ts';
import { getImageByPath, insertImage } from '../repository.ts';
import { createImageUploader } from './upload-after-write.ts';

// ── Style constants ────────────────────────────────────────────────

export const PORTRAIT_STYLE: string =
  'Steel engraving portrait bust, black ink crosshatch on white background, ' +
  'formal attire circa 1900, oval vignette frame. ' +
  'Style of Victorian newspaper portrait illustration. ' +
  'No text, no words, no letters, no writing in the image. ';

export const PORTRAIT_NEGATIVE: string =
  'photograph, realistic, color, modern, blurry, low quality, text, watermark';

// ── Portrait prompt library ────────────────────────────────────────

export type PortraitEntry = {
  tags: string[];
  prompt: string;
};

export const PORTRAIT_PROMPTS: ReadonlyArray<PortraitEntry> = [
  // ── Standard portraits (~60) ──────────────────────────────────
  // Male, young
  {
    tags: ['standard', 'male', 'young'],
    prompt: 'young man in business suit, clean-shaven, short hair',
  },
  {
    tags: ['standard', 'male', 'young'],
    prompt: 'young man with spectacles, neat side-parted hair, bow tie',
  },
  {
    tags: ['standard', 'male', 'young'],
    prompt: 'young man of East Asian descent, suit and tie, serious expression',
  },
  {
    tags: ['standard', 'male', 'young'],
    prompt:
      'young man with close-cropped hair, high collar shirt, confident look',
  },
  {
    tags: ['standard', 'male', 'young'],
    prompt: 'young man of South Asian descent, formal jacket, trimmed beard',
  },
  {
    tags: ['standard', 'male', 'young'],
    prompt: 'young man with wavy hair, cravat, thoughtful expression',
  },
  {
    tags: ['standard', 'male', 'young'],
    prompt:
      'young African American man, three-piece suit, determined expression',
  },
  {
    tags: ['standard', 'male', 'young'],
    prompt: 'young man of Middle Eastern descent, neat mustache, wing collar',
  },
  // Male, middle-aged
  {
    tags: ['standard', 'male', 'middle-aged'],
    prompt: 'middle-aged man in double-breasted suit, receding hairline',
  },
  {
    tags: ['standard', 'male', 'middle-aged'],
    prompt: 'middle-aged man with full beard, pince-nez glasses, vest',
  },
  {
    tags: ['standard', 'male', 'middle-aged'],
    prompt: 'middle-aged man of African descent, formal coat, trimmed goatee',
  },
  {
    tags: ['standard', 'male', 'middle-aged'],
    prompt:
      'middle-aged man with salt-and-pepper hair, striped tie, square jaw',
  },
  {
    tags: ['standard', 'male', 'middle-aged'],
    prompt:
      'middle-aged man of Hispanic descent, suit jacket, neatly combed hair',
  },
  {
    tags: ['standard', 'male', 'middle-aged'],
    prompt:
      'middle-aged man with thick eyebrows, tweed jacket, earnest expression',
  },
  {
    tags: ['standard', 'male', 'middle-aged'],
    prompt: 'middle-aged Asian man, round spectacles, Mandarin collar jacket',
  },
  {
    tags: ['standard', 'male', 'middle-aged'],
    prompt: 'middle-aged man with bushy sideburns, morning coat, stern gaze',
  },
  {
    tags: ['standard', 'male', 'middle-aged'],
    prompt: 'middle-aged man, bald crown, wire-rim glasses, polka-dot bow tie',
  },
  {
    tags: ['standard', 'male', 'middle-aged'],
    prompt:
      'middle-aged man of Native American descent, suit, strong cheekbones',
  },
  // Male, elderly
  {
    tags: ['standard', 'male', 'elderly'],
    prompt: 'elderly gentleman with white hair, frock coat, dignified bearing',
  },
  {
    tags: ['standard', 'male', 'elderly'],
    prompt:
      'elderly man with spectacles perched on nose, wool suit, kind expression',
  },
  {
    tags: ['standard', 'male', 'elderly'],
    prompt:
      'elderly man with white beard, formal evening wear, distinguished bearing',
  },
  {
    tags: ['standard', 'male', 'elderly'],
    prompt:
      'elderly Asian gentleman, thin mustache, silk cravat, wise expression',
  },
  {
    tags: ['standard', 'male', 'elderly'],
    prompt: 'elderly man with mutton chops, waistcoat and watch chain',
  },
  // Female, young
  {
    tags: ['standard', 'female', 'young'],
    prompt: 'young woman in high-necked blouse, hair pinned up, cameo brooch',
  },
  {
    tags: ['standard', 'female', 'young'],
    prompt:
      'young woman with spectacles, tailored jacket, intelligent expression',
  },
  {
    tags: ['standard', 'female', 'young'],
    prompt: 'young woman of East Asian descent, silk blouse, hair in bun',
  },
  {
    tags: ['standard', 'female', 'young'],
    prompt: 'young woman with curly hair, lace collar, bright eyes',
  },
  {
    tags: ['standard', 'female', 'young'],
    prompt: 'young African American woman, formal dress, pearl earrings',
  },
  {
    tags: ['standard', 'female', 'young'],
    prompt:
      'young woman of South Asian descent, embroidered shawl, serene expression',
  },
  {
    tags: ['standard', 'female', 'young'],
    prompt: 'young woman with braided hair, high collar, determined look',
  },
  {
    tags: ['standard', 'female', 'young'],
    prompt: 'young woman of Hispanic descent, ruffled blouse, warm smile',
  },
  // Female, middle-aged
  {
    tags: ['standard', 'female', 'middle-aged'],
    prompt:
      'middle-aged woman in formal blouse, hair pinned up, reading glasses',
  },
  {
    tags: ['standard', 'female', 'middle-aged'],
    prompt: 'middle-aged woman with pearl necklace, tailored suit jacket',
  },
  {
    tags: ['standard', 'female', 'middle-aged'],
    prompt:
      'middle-aged woman of African descent, elegant hat, determined expression',
  },
  {
    tags: ['standard', 'female', 'middle-aged'],
    prompt: 'middle-aged Asian woman, high-necked silk blouse, jade brooch',
  },
  {
    tags: ['standard', 'female', 'middle-aged'],
    prompt:
      'middle-aged woman with upswept hair, lorgnette, fur-trimmed collar',
  },
  {
    tags: ['standard', 'female', 'middle-aged'],
    prompt:
      'middle-aged woman of Hispanic descent, lace mantilla, dignified bearing',
  },
  {
    tags: ['standard', 'female', 'middle-aged'],
    prompt: 'middle-aged woman, wire-rim spectacles, academic robe over blouse',
  },
  {
    tags: ['standard', 'female', 'middle-aged'],
    prompt:
      'middle-aged woman with streak of gray, cameo at throat, sharp gaze',
  },
  {
    tags: ['standard', 'female', 'middle-aged'],
    prompt:
      'middle-aged woman of Middle Eastern descent, silk headscarf, formal jacket',
  },
  // Female, elderly
  {
    tags: ['standard', 'female', 'elderly'],
    prompt: 'elderly woman with silver hair in chignon, lace collar, kind eyes',
  },
  {
    tags: ['standard', 'female', 'elderly'],
    prompt:
      'elderly woman with spectacles on chain, shawl over shoulders, wise expression',
  },
  {
    tags: ['standard', 'female', 'elderly'],
    prompt:
      'elderly African American woman, formal hat, pearl brooch, regal bearing',
  },
  {
    tags: ['standard', 'female', 'elderly'],
    prompt: 'elderly Asian woman, silver hair, high-necked dress, serene look',
  },
  {
    tags: ['standard', 'female', 'elderly'],
    prompt: 'elderly woman with white curls, velvet dress, opera-length gloves',
  },
  // Non-binary / additional variety
  {
    tags: ['standard', 'neutral', 'young'],
    prompt: 'young person with androgynous features, bow tie, vest, short hair',
  },
  {
    tags: ['standard', 'neutral', 'middle-aged'],
    prompt: 'middle-aged person in formal attire, swept-back hair, ascot tie',
  },
  {
    tags: ['standard', 'male', 'young'],
    prompt: 'young man with round face, Norfolk jacket, eager expression',
  },
  {
    tags: ['standard', 'female', 'young'],
    prompt: 'young woman in riding habit, hair under small hat, resolute look',
  },
  {
    tags: ['standard', 'male', 'middle-aged'],
    prompt: 'middle-aged man with large mustache, military-style collar, sash',
  },
  {
    tags: ['standard', 'female', 'middle-aged'],
    prompt: 'middle-aged woman in Gibson Girl blouse, pompadour hairstyle',
  },
  {
    tags: ['standard', 'male', 'elderly'],
    prompt: 'elderly man with long white beard, homburg hat, overcoat',
  },
  {
    tags: ['standard', 'female', 'elderly'],
    prompt:
      'elderly woman in widow weeds, black bonnet, stern but fair expression',
  },
  {
    tags: ['standard', 'male', 'young'],
    prompt: 'young man of Pacific Islander descent, formal suit, lei pin',
  },
  {
    tags: ['standard', 'female', 'young'],
    prompt: 'young woman with freckles, straw boater hat, striped blouse',
  },
  {
    tags: ['standard', 'male', 'middle-aged'],
    prompt: 'middle-aged man with prominent nose, silk top hat, opera cloak',
  },
  {
    tags: ['standard', 'female', 'middle-aged'],
    prompt:
      'middle-aged woman with monocle, high lace collar, imperious expression',
  },
  {
    tags: ['standard', 'male', 'young'],
    prompt:
      'young man of Eastern European descent, fur-collared coat, earnest face',
  },
  {
    tags: ['standard', 'female', 'young'],
    prompt:
      'young woman in nurse uniform cap, white collar, compassionate expression',
  },

  // ── Distinguished portraits (~20) ────────────────────────────
  {
    tags: ['distinguished', 'male'],
    prompt:
      'elderly gentleman with enormous handlebar mustache, monocle, top hat',
  },
  {
    tags: ['distinguished', 'male'],
    prompt: 'man with extravagant mutton chops, medals on chest, epaulettes',
  },
  {
    tags: ['distinguished', 'male'],
    prompt: 'gentleman with waxed mustache, opera cape, ivory-handled cane',
  },
  {
    tags: ['distinguished', 'male'],
    prompt: 'man in judicial wig and robes, stern expression, gavel in hand',
  },
  {
    tags: ['distinguished', 'male'],
    prompt: 'admiral in full dress uniform, bicorne hat, gold braid',
  },
  {
    tags: ['distinguished', 'female'],
    prompt: 'woman in elaborate hat with feathers, pearl necklace, fur stole',
  },
  {
    tags: ['distinguished', 'female'],
    prompt: 'woman with tiara, evening gown, long gloves, diamond brooch',
  },
  {
    tags: ['distinguished', 'female'],
    prompt:
      'woman in academic doctoral robes, mortarboard, commanding presence',
  },
  {
    tags: ['distinguished', 'male'],
    prompt: 'man with enormous white beard, pince-nez, stack of law books',
  },
  {
    tags: ['distinguished', 'male'],
    prompt: 'man in ambassadorial sash, decorations, silk top hat',
  },
  {
    tags: ['distinguished', 'female'],
    prompt: 'woman in suffragette sash, determined jaw, wide-brimmed hat',
  },
  {
    tags: ['distinguished', 'male'],
    prompt: 'man with pointed goatee, astrologer robes, celestial globe',
  },
  {
    tags: ['distinguished', 'female'],
    prompt: 'woman with lorgnette, elaborate updo, ostrich feather fan',
  },
  {
    tags: ['distinguished', 'male'],
    prompt:
      'man in aviator goggles pushed up on forehead, leather flight jacket, scarf',
  },
  {
    tags: ['distinguished', 'male'],
    prompt:
      'man with enormous sideburns, checkered waistcoat, pocket watch chain',
  },
  {
    tags: ['distinguished', 'female'],
    prompt: 'woman in riding habit, top hat, crop under arm, confident stance',
  },
  {
    tags: ['distinguished', 'male'],
    prompt: 'rotund gentleman with walrus mustache, bowler hat, cigar',
  },
  {
    tags: ['distinguished', 'female'],
    prompt:
      'woman scientist with safety goggles around neck, lab coat, test tubes',
  },
  {
    tags: ['distinguished', 'male'],
    prompt: 'man in naval captain uniform, telescope under arm, weathered face',
  },
  {
    tags: ['distinguished', 'female'],
    prompt: 'woman in explorer khakis, pith helmet, compass and map',
  },

  // ── Institutional vignettes (~20) ─────────────────────────────
  {
    tags: ['institutional', 'building'],
    prompt:
      'neoclassical government building with columns and dome, labeled FCC',
  },
  {
    tags: ['institutional', 'satellite'],
    prompt: 'large parabolic satellite dish antenna pointed at the sky',
  },
  {
    tags: ['institutional', 'tower'],
    prompt: 'tall radio transmission tower with antenna arrays, lightning rods',
  },
  {
    tags: ['institutional', 'gavel'],
    prompt: 'wooden gavel on a sound block, scales of justice behind',
  },
  {
    tags: ['institutional', 'briefcase'],
    prompt:
      'leather briefcase with brass latches, legal documents spilling out',
  },
  {
    tags: ['institutional', 'globe'],
    prompt:
      'ornate desktop globe showing orbital paths and satellite positions',
  },
  {
    tags: ['institutional', 'capitol'],
    prompt: 'United States Capitol building dome, flags flying',
  },
  {
    tags: ['institutional', 'courthouse'],
    prompt: 'federal courthouse with grand staircase and pillars',
  },
  {
    tags: ['institutional', 'rocket'],
    prompt: 'rocket launch vehicle on pad with satellite payload fairing',
  },
  {
    tags: ['institutional', 'telescope'],
    prompt: 'large astronomical observatory telescope dome, night sky',
  },
  {
    tags: ['institutional', 'ship'],
    prompt: 'cable-laying ship at sea with submarine cable spool on deck',
  },
  {
    tags: ['institutional', 'typewriter'],
    prompt: 'vintage typewriter with legal brief emerging from platen',
  },
  {
    tags: ['institutional', 'seal'],
    prompt: 'official government seal with eagle, shield, and laurel branches',
  },
  {
    tags: ['institutional', 'microphone'],
    prompt: 'vintage broadcast microphone with call letters on stand',
  },
  {
    tags: ['institutional', 'ledger'],
    prompt: 'open financial ledger with columns of figures, fountain pen',
  },
  {
    tags: ['institutional', 'antenna'],
    prompt: 'phased array antenna panel with geometric pattern of elements',
  },
  {
    tags: ['institutional', 'spectrum'],
    prompt: 'radio frequency spectrum chart with wavelength markings',
  },
  {
    tags: ['institutional', 'orbit'],
    prompt:
      'diagram of geostationary orbit ring around Earth with satellite constellation',
  },
  {
    tags: ['institutional', 'contract'],
    prompt: 'formal contract document with wax seal, ribbon, and quill pen',
  },
  {
    tags: ['institutional', 'printing-press'],
    prompt:
      'vintage newspaper printing press with large rollers and type blocks',
  },
];

// ── Generator function ─────────────────────────────────────────────

export type ImageClient = {
  generateImage(
    req: ImageGenerationRequest,
  ): Promise<{ images: Buffer[]; latencyMs: number }>;
};

export async function generatePortraitLibrary(
  conn: DuckDBConnection,
  imageClient: ImageClient,
  config: ConfigService,
  log: (msg: string) => void,
  options?: {
    startIndex?: number;
    limit?: number;
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
    'portraits',
  );
  await mkdir(baseDir, { recursive: true });

  const upload = createImageUploader();
  let generated: number = 0;
  let skipped: number = 0;
  let failed: number = 0;

  for (const [i, entry] of PORTRAIT_PROMPTS.entries()) {
    if (options?.startIndex != null && i < options.startIndex) continue;
    if (options?.limit != null && generated + failed >= options.limit) break;

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
      const fullPrompt: string = PORTRAIT_STYLE + entry.prompt;
      const response = await imageClient.generateImage({
        modelId,
        prompt: fullPrompt,
        negativePrompt: PORTRAIT_NEGATIVE,
        width: 320,
        height: 400,
        seed: options?.baseSeed != null ? options.baseSeed + i : i * 42,
      });
      await writeFile(imagePath, response.images[0]!);
      await upload(imagePath);
      await insertImage(conn, {
        imageType: 'portrait',
        imagePath,
        prompt: fullPrompt,
        tags: entry.tags,
        generatedBy: modelId,
      });
      generated++;
      log(`Portrait ${String(i)}/${String(PORTRAIT_PROMPTS.length)} generated`);
    } catch (err) {
      failed++;
      log(`Portrait ${String(i)} failed: ${(err as Error).message}`);
    }
  }

  return { generated, skipped, failed };
}
