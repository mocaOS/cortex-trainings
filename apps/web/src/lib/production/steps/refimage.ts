import 'server-only';
import { promises as fs } from 'fs';
import path from 'path';
import type { RunContext } from '../runner';
import { getMedia, mediaModels } from '../media-client';

/** Generate 2 candidates of the guide character — the consistency anchor for all videos. */
export async function stepRefImage(ctx: RunContext): Promise<string[]> {
  const plan = ctx.plan!;
  const media = getMedia();
  ctx.log('refimage', `generating 2 candidates (${mediaModels.image})`);
  const prompt =
    `${plan.guideCharacter}. Hero shot on a dark background, centered, cinematic lighting. ` +
    `${plan.styleBlock} Absolutely no readable text, no captions, no letters, no logos.`;
  const images = await media.imageGenerate({
    model: mediaModels.image,
    prompt,
    aspectRatio: '16:9',
    resolution: '1K',
    quality: 'high',
    variants: 2,
    format: 'jpeg',
  });
  if (images.length === 0) throw new Error('no reference image candidates returned');

  // Keep the candidates on disk so the pick stays reviewable after the run.
  const candDir = path.join(ctx.mediaDir, 'ref-candidates');
  await fs.mkdir(candDir, { recursive: true });
  await Promise.all(
    images.map((b64, i) => fs.writeFile(path.join(candDir, `${i}.jpg`), Buffer.from(b64, 'base64'))),
  );

  ctx.log('refimage', `${images.length} candidates ready — waiting for your pick`);
  return images.map((b64) => `data:image/jpeg;base64,${b64}`);
}

export async function applyRefChoice(
  ctx: RunContext,
  candidates: string[],
  choice: number,
): Promise<void> {
  const chosen = candidates[choice] ?? candidates[0];
  const b64 = chosen.replace(/^data:image\/\w+;base64,/, '');
  await fs.writeFile(path.join(ctx.mediaDir, 'ref.jpg'), Buffer.from(b64, 'base64'));
  ctx.log('refimage', `candidate ${choice + 1} saved as reference`);
}
