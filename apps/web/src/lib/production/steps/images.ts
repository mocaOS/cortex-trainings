import 'server-only';
import { promises as fs } from 'fs';
import path from 'path';
import type { RunContext } from '../runner';
import { getMedia, mediaModels } from '../media-client';

/** Interaction-screen images for levels that plan one. */
export async function stepImages(ctx: RunContext): Promise<void> {
  const plan = ctx.plan!;
  const media = getMedia();
  const levels = plan.levels.filter((l) => l.imagePrompt.trim() !== '');
  if (levels.length === 0) {
    ctx.setDetail('images', 'no images planned');
    return;
  }
  const dir = path.join(ctx.mediaDir, 'img');
  await fs.mkdir(dir, { recursive: true });

  let done = 0;
  await Promise.all(
    levels.map(async (level) => {
      const file = path.join(dir, `level${level.index}.jpg`);
      try {
        await fs.access(file);
      } catch {
        const [b64] = await media.imageGenerate({
          model: mediaModels.image,
          prompt: `${level.imagePrompt} ${plan.styleBlock} No readable text, no faces.`,
          aspectRatio: '16:9',
          resolution: '1K',
          quality: 'medium',
          format: 'jpeg',
        });
        if (!b64) throw new Error(`level ${level.index}: no image returned`);
        await fs.writeFile(file, Buffer.from(b64, 'base64'));
      }
      done++;
      ctx.setDetail('images', `${done}/${levels.length} done`);
      ctx.log('images', `level ${level.index}: image ready`);
    }),
  );
}
