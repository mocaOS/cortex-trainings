import 'server-only';
import { promises as fs } from 'fs';
import path from 'path';
import type { RunContext } from '../runner';
import { getMedia, mediaModels } from '../media-client';

const NO_TEXT = 'No readable text, no captions, no letters, no logos, no watermarks. No faces.';

/**
 * Interaction screens are generated independently but land next to each other in one training, so
 * left to themselves they converge: conditioned on the same style upload, the first run returned
 * five images that were all a vast symmetrical hall shot dead-on. Matching the aesthetic is the
 * point; repeating one composition five times is not, and it costs the levels their distinctness.
 * The films' frame prompt already rules this out — the interaction images need it too.
 */
const VARY_COMPOSITION =
  `COMPOSITION: choose a distinctive framing for this specific subject — vary the camera height, ` +
  `distance and angle, and prefer an off-centre or asymmetric arrangement with a clear focal point. ` +
  `Do not default to a centred, symmetrical, head-on view of a large interior.`;

/**
 * Interaction-screen images for levels that plan one.
 *
 * When the project has uploaded style references these are built with `/image/multi-edit` against
 * those images rather than with the style block as text. The style block is a written description
 * of an aesthetic, and a written description of an aesthetic is a lossy way to hit one — it left
 * the interaction screens sitting in a slightly different world than the films, which are
 * conditioned on the uploads themselves. Same reference images, same look.
 */
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

  const styleEntry = ctx.refs.style;
  const styleUrls = styleEntry
    ? await Promise.all(
        styleEntry.files.map(async (rel) => {
          const buf = await fs.readFile(path.join(ctx.mediaDir, rel));
          const ext = path.extname(rel).toLowerCase() === '.png' ? 'png' : 'jpeg';
          return `data:image/${ext};base64,${buf.toString('base64')}`;
        }),
      )
    : [];
  if (styleUrls.length > 0) {
    ctx.log(
      'images',
      `conditioning on ${styleUrls.length} uploaded style image(s) (${mediaModels.imageEdit})`,
    );
  }

  let done = 0;
  await Promise.all(
    levels.map(async (level) => {
      const file = path.join(dir, `level${level.index}.jpg`);
      try {
        await fs.access(file);
      } catch {
        if (styleUrls.length > 0) {
          const prompt =
            `${level.imagePrompt}\n\n` +
            `AESTHETIC: take the palette, colour grading, lighting character, texture, line ` +
            `quality and atmosphere from the reference image(s). Do NOT reproduce their subjects, ` +
            `objects, characters, buildings or composition — only their look. ${plan.styleBlock}\n\n` +
            `${VARY_COMPOSITION}\n\n` +
            `Full-bleed 16:9, edge to edge: no frame, no border, no mat, no letterbox or pillarbox ` +
            `bars, nothing that reads as a picture of a picture. ${NO_TEXT}`;
          const buf = await media.imageMultiEdit({
            model: mediaModels.imageEdit,
            prompt,
            images: styleUrls,
            aspectRatio: '16:9',
            resolution: '1K',
            quality: 'high',
            outputFormat: 'jpeg',
          });
          await fs.writeFile(file, buf);
        } else {
          const [b64] = await media.imageGenerate({
            model: mediaModels.image,
            prompt: `${level.imagePrompt} ${plan.styleBlock}\n\n${VARY_COMPOSITION}\n\n${NO_TEXT}`,
            aspectRatio: '16:9',
            resolution: '1K',
            quality: 'high',
            format: 'jpeg',
          });
          if (!b64) throw new Error(`level ${level.index}: no image returned`);
          await fs.writeFile(file, Buffer.from(b64, 'base64'));
        }
      }
      done++;
      ctx.setDetail('images', `${done}/${levels.length} done`);
      ctx.log('images', `level ${level.index}: image ready`);
    }),
  );
}
