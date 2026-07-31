import 'server-only';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { PlanLevel, VideoModelConstraints } from '@cortex-trainings/shared';
import type { RunContext } from '../runner';
import { getMedia, mediaModels } from '../media-client';
import { concatAndTrim, extractLastFrame, fitTo16x9, muxVoiceover } from '../ffmpeg';
import { voPath } from './voiceovers';

/**
 * How a shot is generated. The storyboard picks it, not the character:
 * - `chain`    — continues the previous scene, generated from its last frame.
 * - `character`— a cut that features the guide: reference-to-video with the character images.
 * - `styled`   — a cut with no guide, anchored to the uploaded *style* images so the aesthetic
 *                survives even though the character is absent.
 * - `plain`    — a cut with no guide and no style uploads: text-to-video, carrying the style
 *                block in the prompt as the pipeline always has.
 */
type ShotMode = 'chain' | 'character' | 'styled' | 'plain';

interface ShotJob {
  level: PlanLevel;
  shotIndex: number;
  prompt: string;
  duration: string; // clamped to the executing model's options
  model: string;
  /** Resolution the executing model accepts — Wan wants 1080p, MiniMax only 2K. */
  resolution: string;
  /**
   * Set only for models that offer a choice. MiniMax's reference-to-video *requires* it and
   * rejects the queue call without it; start-frame models list none, because the ratio comes
   * from the input frame.
   */
  aspectRatio?: string;
  mode: ShotMode;
  /** Continue the previous shot's scene from its last frame, rather than cut. */
  continues: boolean;
}

const secs = (d: string) => Number(d.replace('s', ''));

/**
 * Picks the resolution to request for a model. `VENICE_VIDEO_RESOLUTION` is a preference, not a
 * command: a model that does not offer it gets its own highest option instead, because the
 * alternative is a 400 at the quote step for a setting the operator cannot know per model.
 */
function resolutionFor(model: string, constraints: VideoModelConstraints, ctx: RunContext): string {
  const offered = constraints.resolutions;
  if (offered.length === 0) throw new Error(`${model}: the catalog lists no resolutions`);
  const wanted = mediaModels.videoResolution;
  if (wanted && offered.includes(wanted)) return wanted;
  const chosen = offered[0];
  if (wanted)
    ctx.log(
      'films',
      `${model} does not offer ${wanted} (only ${offered.join(', ')}) — requesting ${chosen}`,
    );
  return chosen;
}

/**
 * Trainings are 16:9 throughout, so take it when the model offers a choice. Models that list no
 * ratios take none: Wan ignores the field and start-frame models derive it from the input image.
 */
function aspectRatioFor(constraints: VideoModelConstraints): string | undefined {
  const offered = constraints.aspectRatios;
  if (offered.length === 0) return undefined;
  return offered.includes('16:9') ? '16:9' : offered[0];
}

/**
 * Builds the shot list for a film level.
 *
 * A shot that continues the previous scene is generated from its last frame
 * (image-to-video) so the cut is invisible. A shot that opens a new scene is generated from
 * references instead, so it cuts cleanly rather than morphing one setting into another.
 *
 * Which references depends on what the shot is *for*. A shot the storyboard marks
 * `featuresCharacter: false` gets no character references at all — otherwise the guide turns up
 * in establishing shots and concept imagery where it has no business being, and every film opens
 * on the same portrait. Such a shot still keeps the look: the uploaded style images anchor it
 * when they exist, and the style block travels in the prompt either way.
 *
 * Durations are then grown to cover the voiceover — every uncovered second becomes a frozen
 * last frame.
 */
async function shotJobs(ctx: RunContext, level: PlanLevel): Promise<ShotJob[]> {
  const media = getMedia();
  const hasStyleRefs = Boolean(ctx.refs.style);
  // A character-free cut is anchored on the style uploads when there are any; without them
  // there is nothing to reference, so it is generated from the prompt alone.
  const freeMode: ShotMode = hasStyleRefs ? 'styled' : 'plain';
  const modelFor = (mode: ShotMode) =>
    mode === 'chain'
      ? mediaModels.videoChain
      : mode === 'plain'
        ? mediaModels.videoText
        : mediaModels.videoReference;

  // Looked up once per role; the catalog itself is fetched once per process.
  const caps: Record<string, VideoModelConstraints> = {};
  for (const model of [mediaModels.videoChain, mediaModels.videoReference, modelFor(freeMode)]) {
    caps[model] ??= await media.videoModelConstraints(model);
  }
  const modeOf = (shot: PlanLevel['shots'][number], i: number): ShotMode => {
    if (i > 0 && shot.continuesPreviousScene === true) return 'chain';
    // Undefined means a plan from before the storyboard flag existed — keep the old behaviour.
    return shot.featuresCharacter === false ? freeMode : 'character';
  };
  const tiersFor = (mode: ShotMode) => caps[modelFor(mode)].durationsSec;

  const jobs: ShotJob[] = level.shots.map((shot, i) => {
    const mode = modeOf(shot, i);
    const model = modelFor(mode);
    const constraints = caps[model];
    const tiers = constraints.durationsSec;
    if (tiers.length === 0) throw new Error(`${model}: the catalog lists no durations`);
    const wanted = secs(shot.duration);
    // Largest offered duration that does not exceed the plan's ask; the shortest if all do.
    const fitting = tiers.filter((t) => t <= wanted);
    const allowed = fitting.length ? Math.max(...fitting) : tiers[0];
    return {
      level,
      shotIndex: i,
      prompt: shot.prompt,
      duration: `${allowed}s`,
      model,
      resolution: resolutionFor(model, constraints, ctx),
      aspectRatio: aspectRatioFor(constraints),
      mode,
      continues: mode === 'chain',
    };
  });

  const vo = await voPath(ctx, level.index);
  const total = () => jobs.reduce((sum, j) => sum + secs(j.duration), 0);
  // Grow the later shots (longest tier available) until the chain covers the narration.
  for (let i = jobs.length - 1; i >= 0 && vo.duration - total() > 2; i--) {
    const tiers = tiersFor(jobs[i].mode);
    for (const tier of tiers) {
      if (tier > secs(jobs[i].duration) && vo.duration - total() > 2) {
        jobs[i].duration = `${tier}s`;
      }
    }
  }
  const short = vo.duration - total();
  if (short > 2) {
    ctx.log(
      'films',
      `level ${level.index}: chain covers ${total()}s of a ${vo.duration.toFixed(1)}s voiceover — last frame will hold for ${short.toFixed(1)}s`,
    );
  }
  return jobs;
}

function filmLevels(ctx: RunContext): PlanLevel[] {
  return ctx.plan!.levels.filter((l) => l.medium === 'film' && l.shots.length > 0);
}

export async function quoteFilms(ctx: RunContext): Promise<{ totalUsd: number; shots: number }> {
  const media = getMedia();
  const perLevel = await Promise.all(filmLevels(ctx).map((l) => shotJobs(ctx, l)));
  const jobs = perLevel.flat();
  if (jobs.length === 0) return { totalUsd: 0, shots: 0 };
  let total = 0;
  for (const job of jobs) {
    const quote = await media.videoQuote({
      model: job.model,
      duration: job.duration,
      resolution: job.resolution,
      ...(job.aspectRatio ? { aspectRatio: job.aspectRatio } : {}),
    });
    total += quote;
    ctx.log('films', `quote: level ${job.level.index} shot ${job.shotIndex + 1} (${job.model}, ${job.duration}, ${job.resolution}) = $${quote.toFixed(2)}`);
  }
  return { totalUsd: total, shots: jobs.length };
}

async function toDataUrl(file: string): Promise<string> {
  const buf = await fs.readFile(file);
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

/**
 * The uploaded character references, fitted to the 16:9 the video models generate at.
 * Cached on disk so a resumed run does not redo the conversion.
 */
async function fittedCharacterRefs(ctx: RunContext): Promise<string[]> {
  const entry = ctx.refs.character;
  if (!entry) return [];
  const dir = path.join(ctx.mediaDir, 'refs', 'video');
  await fs.mkdir(dir, { recursive: true });
  const urls: string[] = [];
  for (const [i, rel] of entry.files.entries()) {
    const out = path.join(dir, `character-${i}-16x9.jpg`);
    try {
      await fs.access(out);
    } catch {
      await fitTo16x9(path.join(ctx.mediaDir, rel), out, 'pad');
    }
    urls.push(await toDataUrl(out));
  }
  return urls;
}

/** The uploaded style references, fitted to 16:9 for the same reason as the character ones. */
async function fittedStyleRefs(ctx: RunContext): Promise<string[]> {
  const entry = ctx.refs.style;
  if (!entry) return [];
  const dir = path.join(ctx.mediaDir, 'refs', 'video');
  await fs.mkdir(dir, { recursive: true });
  const urls: string[] = [];
  for (const [i, rel] of entry.files.entries()) {
    const out = path.join(dir, `style-${i}-16x9.jpg`);
    try {
      await fs.access(out);
    } catch {
      // Cropped, not padded: a near-square style upload padded to 16:9 is mostly black, and the
      // model read that black as part of the aesthetic and produced grey bars of its own.
      await fitTo16x9(path.join(ctx.mediaDir, rel), out, 'crop');
    }
    urls.push(await toDataUrl(out));
  }
  return urls;
}

const MODE_LABEL: Record<ShotMode, string> = {
  chain: 'continues scene',
  character: 'new scene, with guide',
  styled: 'new scene, no guide — style-anchored',
  plain: 'new scene, no guide',
};

/**
 * A hero portrait is never wanted as a *shot*: the reference image is deliberately a centered
 * hero framing of the character, and reference-to-video happily copies that composition into
 * every clip — which is why films kept opening on the same portrait of the guide.
 */
const NEGATIVE_PROMPT =
  'readable text, captions, subtitles, letters, logos, watermarks, speech, ' +
  'centered hero portrait, posed character portrait, character staring into the camera, ' +
  'letterbox bars, pillarbox bars, white border, framed picture, vignette border';

/**
 * The prompt actually sent for a shot.
 *
 * The mode-specific preamble exists because reference images are read as instructions about
 * *everything* unless told otherwise: identity references bleed their framing, and style
 * references bleed their subjects. Saying which one to take from them is what keeps a shot's own
 * described composition intact.
 */
function shotPrompt(job: ShotJob, styleBlock: string): string {
  switch (job.mode) {
    case 'chain':
      return `SHOT: continuing seamlessly from the start frame — ${job.prompt}`;
    case 'character':
      return (
        `SHOT: ${job.prompt}\n\n` +
        `The reference images define ONLY the character's identity and design — face, build, ` +
        `clothing, colours, markings. Take NOTHING else from them: not the framing, not the ` +
        `camera distance, not the pose, not the background. Follow this shot's own described ` +
        `composition and camera exactly. Do not render a centered hero portrait unless this ` +
        `shot asks for one.`
      );
    case 'styled':
      return (
        `SHOT: ${job.prompt}\n\n` +
        `The reference images define ONLY the visual style — palette, grading, lighting, ` +
        `texture, atmosphere. Do NOT reproduce their subjects, objects, characters, buildings ` +
        `or composition. No people or characters appear in this shot at all; render the scene ` +
        `exactly as described above, in that style.`
      );
    case 'plain':
      return `SHOT: ${job.prompt}\n\nSTYLE: ${styleBlock}\n\nNo people or characters appear in this shot.`;
  }
}

/**
 * A queued generation is already paid for, so the queue id is written to disk before
 * polling starts. If the process dies mid-generation, a resume re-polls that job
 * instead of queueing (and paying for) a second one. Venice download URLs expire
 * after ~24h, so an older ticket is worthless and gets discarded.
 */
interface QueueTicket {
  model: string;
  queueId: string;
  requestedAt: string;
}

const TICKET_MAX_AGE_MS = 20 * 60 * 60 * 1000;

async function readTicket(file: string): Promise<QueueTicket | null> {
  try {
    const ticket = JSON.parse(await fs.readFile(file, 'utf8')) as QueueTicket;
    const age = Date.now() - Date.parse(ticket.requestedAt);
    if (!ticket.queueId || !Number.isFinite(age) || age > TICKET_MAX_AGE_MS) return null;
    return ticket;
  } catch {
    return null;
  }
}

export async function stepFilms(ctx: RunContext): Promise<void> {
  const plan = ctx.plan!;
  const media = getMedia();
  const levels = filmLevels(ctx);
  if (levels.length === 0) {
    ctx.setDetail('films', 'no film levels');
    return;
  }
  const dir = path.join(ctx.mediaDir, 'films');
  await fs.mkdir(dir, { recursive: true });
  const refUrl = await toDataUrl(path.join(ctx.mediaDir, 'ref.jpg'));
  // The chosen anchor leads; the user's uploaded character images ride along as extra
  // consistency references (the reference-to-video models accept up to 9). They are
  // letterboxed to 16:9 first — an off-ratio reference makes the model reconcile the
  // mismatch by baking padding into every frame it generates.
  const characterUrls = ctx.refs.character
    ? await fittedCharacterRefs(ctx)
    : [];
  const characterRefs = [refUrl, ...characterUrls].slice(0, 9);
  // Style uploads keep a character-free shot in the same visual world. Same 16:9 treatment,
  // same reason.
  const styleRefs = ctx.refs.style ? await fittedStyleRefs(ctx) : [];
  if (characterUrls.length > 0) {
    ctx.log(
      'films',
      `passing ${characterUrls.length} uploaded character image(s) as extra video references (letterboxed to 16:9)`,
    );
  }
  if (styleRefs.length > 0) {
    ctx.log('films', `${styleRefs.length} style image(s) available to anchor character-free shots`);
  }

  for (const level of levels) {
    const finalFile = path.join(dir, `level${level.index}_final.mp4`);
    try {
      await fs.access(finalFile);
      ctx.log('films', `level ${level.index}: already produced — skipping`);
      continue;
    } catch {
      /* not yet produced */
    }

    const vo = await voPath(ctx, level.index);
    const jobs = await shotJobs(ctx, level);
    const clips: string[] = [];
    let lastFrameUrl: string | null = null;

    for (const job of jobs) {
      const clipFile = path.join(dir, `level${level.index}_shot${job.shotIndex + 1}.mp4`);
      const ticketFile = `${clipFile}.queue.json`;
      const label = `level ${level.index} shot ${job.shotIndex + 1}`;
      try {
        await fs.access(clipFile);
        ctx.log('films', `${label}: cached`);
      } catch {
        let queueId: string;
        let model = job.model;

        const ticket = await readTicket(ticketFile);
        if (ticket) {
          queueId = ticket.queueId;
          model = ticket.model;
          ctx.log('films', `${label}: resuming queued job ${queueId} — not paying twice`);
        } else {
          const prompt = shotPrompt(job, plan.styleBlock);
          // References are only sent where they belong: a character-free shot must not receive
          // the character images, or the guide walks back into a shot written without it.
          const refs =
            job.mode === 'character' ? characterRefs : job.mode === 'styled' ? styleRefs : [];
          ctx.log(
            'films',
            `${label}: queueing (${job.model}, ${job.duration}, ${job.resolution}, ${MODE_LABEL[job.mode]})`,
          );
          const queued = await media.videoQueue({
            model: job.model,
            prompt,
            duration: job.duration,
            resolution: job.resolution,
            ...(job.aspectRatio ? { aspectRatio: job.aspectRatio } : {}),
            ...(job.continues && lastFrameUrl
              ? { imageUrl: lastFrameUrl }
              : refs.length
                ? { referenceImageUrls: refs }
                : {}),
            negativePrompt: NEGATIVE_PROMPT,
          });
          queueId = queued.queueId;
          // Persist before the first poll — the job is billable from here on.
          await fs.writeFile(
            ticketFile,
            JSON.stringify(
              { model: job.model, queueId, requestedAt: new Date().toISOString() } satisfies QueueTicket,
              null,
              2,
            ),
          );
        }

        const video = await media.videoAwait({
          model,
          queueId,
          onProgress: (msg) => ctx.setDetail('films', `${label}: ${msg}`),
        });
        await fs.writeFile(clipFile, video);
        await media.videoComplete(model, queueId);
        await fs.rm(ticketFile, { force: true });
        ctx.log('films', `${label}: done (${(video.length / 1e6).toFixed(1)} MB)`);
      }
      clips.push(clipFile);
      const frame = path.join(os.tmpdir(), `lastframe-${ctx.projectId}-${level.index}-${job.shotIndex}.jpg`);
      await extractLastFrame(clipFile, frame);
      lastFrameUrl = await toDataUrl(frame);
      await fs.rm(frame, { force: true });
    }

    // Trim the chain to voiceover + 1s and lay the voiceover under it.
    const silent = path.join(dir, `level${level.index}_silent.mp4`);
    await concatAndTrim(clips, vo.duration + 1, silent, (note) => ctx.log('films', note));
    await muxVoiceover(silent, vo.file, finalFile);
    await fs.rm(silent, { force: true });
    ctx.log('films', `level ${level.index}: sequence assembled (${jobs.length} shots, ${(vo.duration + 1).toFixed(1)}s)`);
  }
}
