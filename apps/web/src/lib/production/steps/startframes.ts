import 'server-only';
import { promises as fs } from 'fs';
import path from 'path';
import type { PlanLevel } from '@cortex-trainings/shared';
import type { RunContext } from '../runner';
import { getMedia, mediaModels } from '../media-client';

/**
 * Start frames: the first frame of every shot that opens a scene, generated as an *image*
 * before any video is queued.
 *
 * Why this exists. Handing character and style uploads straight to reference-to-video made the
 * video model responsible for three jobs at once — hold the character's identity, adopt the
 * uploaded aesthetic, and compose the shot the storyboard describes. It did all three badly:
 * identity drifted (a character's eyepatch vanished between shots), framing bled out of the
 * references (every cut became a centred hero portrait), and style uploads — which are flat
 * artworks — were sometimes reproduced *as artworks*, complete with a mat and a drop shadow
 * around a pillarboxed canvas.
 *
 * An image-edit model does all three far better, and a wrong frame costs a fraction of a wrong
 * clip, so it can simply be regenerated. The video model then only has to animate a frame that
 * is already correct, which is the one thing it is genuinely good at.
 *
 * The frame also fixes the output geometry: `gpt-image-2-edit` returns an exact 16:9 (1536×864),
 * and a start-frame video model takes its aspect ratio from the frame it is given. The bars the
 * pipeline used to detect and crop are largely a symptom of letting the video model choose its
 * own canvas.
 */

/** Where a shot's start frame lives. Cached like every other artefact, so a resume is free. */
export function startFramePath(ctx: RunContext, levelIndex: number, shotIndex: number): string {
  return path.join(ctx.mediaDir, 'films', `level${levelIndex}_shot${shotIndex + 1}_start.jpg`);
}

async function toDataUrl(file: string): Promise<string> {
  const buf = await fs.readFile(file);
  const ext = path.extname(file).toLowerCase() === '.png' ? 'png' : 'jpeg';
  return `data:image/${ext};base64,${buf.toString('base64')}`;
}

/**
 * The character references for a frame that features the guide.
 *
 * The *uploaded* images are preferred over the generated anchor: they carry the real design at
 * full fidelity, and the edit model reproduces identity from them markedly better than from a
 * render of a render. Projects without uploads fall back to the anchor the user picked in the
 * refimage step, which is the only character definition they have.
 *
 * These are passed at their original aspect ratio on purpose. The 16:9 letterboxing that video
 * references need does not apply here — the edit model reads the input as content and is told
 * the output ratio explicitly.
 */
async function characterRefUrls(ctx: RunContext): Promise<string[]> {
  const entry = ctx.refs.character;
  if (entry) {
    return Promise.all(entry.files.map((rel) => toDataUrl(path.join(ctx.mediaDir, rel))));
  }
  return [await toDataUrl(path.join(ctx.mediaDir, 'ref.jpg'))];
}

/** The uploaded style references, if the project has any. */
async function styleRefUrls(ctx: RunContext): Promise<string[]> {
  const entry = ctx.refs.style;
  if (!entry) return [];
  return Promise.all(entry.files.map((rel) => toDataUrl(path.join(ctx.mediaDir, rel))));
}

const NO_TEXT = 'No readable text, no captions, no letters, no logos, no watermarks.';

/**
 * The composition clause is not decoration. Reference images are read as instructions about
 * *everything* unless the prompt scopes them, so each role is named explicitly, and the framings
 * that reference conditioning tends to fall into are ruled out by name — a centred hero portrait
 * because the anchor is one, and a framed picture because style uploads are artworks.
 */
const COMPOSITION =
  `COMPOSITION: a real film frame with depth and a clear foreground, midground and background — ` +
  `not a centred hero portrait, not a subject staring into the camera, not a symmetrical ` +
  `arrangement. Full-bleed edge to edge: no frame, no border, no mat, no letterbox or pillarbox ` +
  `bars, no vignette border, no drop shadow, nothing that reads as a picture of a picture. ` +
  NO_TEXT;

/**
 * Names a contiguous run of input images by position, e.g. "the 1st reference image" or
 * "reference images 2–4".
 *
 * Computed rather than written out, because the image roles shift: a continuation frame puts the
 * preceding frame in slot 1, which pushes the character and style images down by one. Hardcoded
 * "the first N" / "the last N" wording would then point the model at the wrong images — and a
 * prompt that confidently mislabels its inputs is worse than one that says nothing.
 */
function refRange(start: number, count: number): string {
  if (count === 1) return `the ${start}${ordinalSuffix(start)} reference image`;
  return `reference images ${start}–${start + count - 1}`;
}

function ordinalSuffix(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return 'th';
  return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
}

function framePrompt(opts: {
  shotPrompt: string;
  styleBlock: string;
  /** The plan's own description of the guide — it may well not be a figure. */
  guideCharacter: string;
  characterCount: number;
  styleCount: number;
  /** True when input image 1 is the previous clip's last frame. */
  continues: boolean;
}): string {
  const { shotPrompt, styleBlock, guideCharacter, characterCount, styleCount, continues } = opts;
  const lines: string[] = [];
  // Slot 1 is the continuity frame when there is one; everything else shifts down.
  let slot = 1;
  if (continues) {
    lines.push(
      `The 1st reference image is the LAST FRAME of the immediately preceding shot. Continue that ` +
        `exact scene: same location, same set and architecture, same camera position and lens, same ` +
        `lighting and grade, so the two read as one continuous scene rather than a cut. Render the ` +
        `next moment of it as a cinematic 16:9 frame.`,
    );
    slot = 2;
  } else {
    lines.push(`Render the OPENING FRAME of a cinematic 16:9 film shot.`);
  }

  const characterSlot = slot;
  slot += characterCount;
  const styleSlot = slot;

  if (characterCount > 0) {
    // The guide is whatever the plan says it is — an orb, an object, a creature, a mannequin. An
    // earlier version enumerated humanoid features ("same face, same hair, same clothing, any
    // eyepatch"), which was really a description of one project's character. Against an abstract
    // guide that reads as an instruction to draw a person: a training whose guide is a floating
    // orb got a caped human figure kneeling beside it, faithfully rendered, never asked for.
    lines.push(
      `SUBJECT: the guide from ${refRange(characterSlot, characterCount)}. What the guide is: ` +
        `${guideCharacter}\n` +
        `Reproduce it exactly as the reference shows it — unmistakably the same design, the same ` +
        `proportions, colours, materials, surface and markings, with any glow or asymmetric detail ` +
        `on the same side. Do not restyle it, do not substitute something else for it, and do not ` +
        `give it features it does not have. It appears in this frame exactly as the shot describes: ` +
        `${shotPrompt}`,
    );
    // The frame contains what the shot names and nothing else. Stated separately because the
    // reference itself is the thing most likely to invite an extra figure into the scene.
    lines.push(
      `Add NO people, human figures, faces, hands or bystanders, and no second character of any ` +
        `kind. The guide above and whatever the shot description explicitly names are the only ` +
        `subjects in the frame.`,
    );
  } else {
    lines.push(`SUBJECT: ${shotPrompt}`);
    lines.push(`No people and no characters appear in this frame at all.`);
  }

  if (styleCount > 0) {
    // Style uploads bleed their subjects as readily as identity references bleed their framing.
    lines.push(
      `AESTHETIC: take the palette, colour grading, lighting character, texture, line quality and ` +
        `atmosphere from ${refRange(styleSlot, styleCount)}. Do NOT reproduce their subjects, ` +
        `objects, characters, buildings or composition — only their look. ${styleBlock}`,
    );
  } else {
    lines.push(`AESTHETIC: ${styleBlock}`);
  }

  lines.push(COMPOSITION);
  return lines.join('\n\n');
}

/**
 * Generates (or reuses) the start frame for one shot and returns its file path.
 *
 * A shot that features the guide is conditioned on the character images plus the style uploads;
 * a shot without the guide gets the style uploads only, because passing the character to a frame
 * written without one simply puts it back in. With no uploads at all for a character-free shot
 * there is nothing to condition on, so it is generated from the prompt and the style block.
 *
 * `continueFrom` is the previous clip's last frame, passed when a shot continues the scene but
 * cannot simply be chained — see the `continuation` case in `films.ts`. It becomes the base image,
 * which is what multi-edit treats the first entry as, so the scene carries over while the
 * character and style references still get their say.
 */
export async function ensureStartFrame(
  ctx: RunContext,
  level: PlanLevel,
  shotIndex: number,
  shotPrompt: string,
  featuresCharacter: boolean,
  opts: { continueFrom?: string } = {},
): Promise<string> {
  const file = startFramePath(ctx, level.index, shotIndex);
  const label = `level ${level.index} shot ${shotIndex + 1}`;
  try {
    await fs.access(file);
    ctx.log('films', `${label}: start frame cached`);
    return file;
  } catch {
    /* not generated yet */
  }

  await fs.mkdir(path.dirname(file), { recursive: true });
  const media = getMedia();
  const styleBlock = ctx.plan!.styleBlock;

  const characterUrls = featuresCharacter ? await characterRefUrls(ctx) : [];
  const styleUrls = await styleRefUrls(ctx);
  const continues = Boolean(opts.continueFrom);
  const images = [
    ...(opts.continueFrom ? [opts.continueFrom] : []),
    ...characterUrls,
    ...styleUrls,
  ];
  const prompt = framePrompt({
    shotPrompt,
    styleBlock,
    guideCharacter: ctx.plan!.guideCharacter,
    characterCount: characterUrls.length,
    styleCount: styleUrls.length,
    continues,
  });

  if (images.length > 0) {
    ctx.log(
      'films',
      `${label}: building ${continues ? 'continuation' : 'start'} frame (${mediaModels.imageEdit}, ` +
        `${continues ? 'previous frame + ' : ''}${characterUrls.length} character + ${styleUrls.length} style reference(s))`,
    );
    const buf = await media.imageMultiEdit({
      model: mediaModels.imageEdit,
      prompt,
      images,
      aspectRatio: '16:9',
      resolution: '1K',
      quality: 'high',
      outputFormat: 'jpeg',
    });
    await fs.writeFile(file, buf);
  } else {
    ctx.log('films', `${label}: building start frame (${mediaModels.image}, no reference uploads)`);
    const [b64] = await media.imageGenerate({
      model: mediaModels.image,
      prompt,
      aspectRatio: '16:9',
      resolution: '1K',
      quality: 'high',
      format: 'jpeg',
    });
    if (!b64) throw new Error(`${label}: the image model returned no start frame`);
    await fs.writeFile(file, Buffer.from(b64, 'base64'));
  }

  const { size } = await fs.stat(file);
  ctx.log('films', `${label}: start frame ready (${(size / 1024).toFixed(0)} KB)`);
  return file;
}

/** The start frame as a data URL, for handing to a start-frame video model. */
export async function startFrameDataUrl(file: string): Promise<string> {
  return toDataUrl(file);
}
