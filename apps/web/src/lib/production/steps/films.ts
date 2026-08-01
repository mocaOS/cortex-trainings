import 'server-only';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { PlanLevel, VideoModelConstraints } from '@cortex-trainings/shared';
import type { RunContext } from '../runner';
import { getMedia, mediaModels } from '../media-client';
import { concatAndTrim, extractLastFrame, muxVoiceover } from '../ffmpeg';
import { voPath } from './voiceovers';
import { ensureStartFrame, startFrameDataUrl } from './startframes';

/**
 * Where a shot's first frame comes from. Every shot is generated *from a frame* — the only
 * question is whose:
 * - `chain`        — the previous shot's last frame, unchanged, so a continuation has no cut.
 * - `startframe`   — a frame built for this shot by the image model (see `startframes.ts`).
 * - `continuation` — a frame built from the previous shot's last frame *plus* the references,
 *                    for a shot that continues the scene but whose cast changed.
 *
 * There is deliberately no longer a mode that hands reference images to the video model. Doing
 * that made it responsible for identity, aesthetic and composition all at once, and it lost all
 * three often enough to be the main reason films looked worse than the rest of a training.
 *
 * `continuation` exists because plain chaining is blind to the character. A shot marked
 * `featuresCharacter` that also continued its scene used to take the chain path and therefore
 * received no character conditioning at all: observed on a finished film, the guide was absent for
 * seven of ten seconds and then materialised from the prompt text alone, never having been shown
 * the upload. The shot after it — marked character-*free* — then chained off that final frame and
 * inherited the guide for its whole duration. The flag was effectively inverted for both.
 *
 * So the rule is: chain only when the guide's presence is unchanged between the two shots.
 * A shot that adds or drops the guide gets a frame built for it instead, which keeps the scene
 * continuous *and* gets the cast right, rather than trading one for the other.
 */
type ShotSource = 'chain' | 'startframe' | 'continuation';

interface ShotJob {
  level: PlanLevel;
  shotIndex: number;
  prompt: string;
  duration: string; // clamped to the executing model's options
  model: string;
  /** Resolution the executing model accepts — Wan wants 1080p, MiniMax only 2K. */
  resolution: string;
  /**
   * Set only for models that offer a choice. Start-frame models generally list none, because the
   * ratio comes from the input frame — which is now true of every shot.
   */
  aspectRatio?: string;
  source: ShotSource;
  /** Whether the guide appears, which decides what the start frame is conditioned on. */
  featuresCharacter: boolean;
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
 * Trainings are 16:9 throughout, so take it when the model offers a choice. A start-frame model
 * normally lists none and derives the ratio from its input frame, which is exactly why the start
 * frames are generated at an exact 16:9.
 */
function aspectRatioFor(constraints: VideoModelConstraints): string | undefined {
  const offered = constraints.aspectRatios;
  if (offered.length === 0) return undefined;
  return offered.includes('16:9') ? '16:9' : offered[0];
}

/**
 * Builds the shot list for a film level.
 *
 * Every shot runs on the start-frame (image-to-video) model, so there is one model per film and
 * one set of duration tiers — the resolution, frame rate and grade cannot drift between cuts the
 * way they did when a film mixed reference-to-video, text-to-video and image-to-video.
 *
 * Durations are then grown to cover the voiceover — every uncovered second becomes a frozen
 * last frame.
 */
async function shotJobs(ctx: RunContext, level: PlanLevel): Promise<ShotJob[]> {
  const media = getMedia();
  const model = mediaModels.videoChain;
  const constraints = await media.videoModelConstraints(model);
  const tiers = constraints.durationsSec;
  if (tiers.length === 0) throw new Error(`${model}: the catalog lists no durations`);
  const resolution = resolutionFor(model, constraints, ctx);
  const aspectRatio = aspectRatioFor(constraints);

  // Undefined means a plan from before the storyboard flag existed — keep the old default.
  const guideIn = (i: number) => level.shots[i].featuresCharacter !== false;

  const jobs: ShotJob[] = level.shots.map((shot, i) => {
    const wanted = secs(shot.duration);
    // Largest offered duration that does not exceed the plan's ask; the shortest if all do.
    const fitting = tiers.filter((t) => t <= wanted);
    const allowed = fitting.length ? Math.max(...fitting) : tiers[0];
    const continues = i > 0 && shot.continuesPreviousScene === true;
    const source: ShotSource = !continues
      ? 'startframe'
      : guideIn(i) === guideIn(i - 1)
        ? 'chain'
        : 'continuation';
    return {
      level,
      shotIndex: i,
      prompt: shot.prompt,
      duration: `${allowed}s`,
      model,
      resolution,
      aspectRatio,
      source,
      featuresCharacter: guideIn(i),
    };
  });

  const vo = await voPath(ctx, level.index);
  const total = () => jobs.reduce((sum, j) => sum + secs(j.duration), 0);
  // Grow the later shots (longest tier available) until the chain covers the narration.
  for (let i = jobs.length - 1; i >= 0 && vo.duration - total() > 2; i--) {
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

/** How many reference images a shot's frame will be built from, without loading them. */
function frameInputCount(ctx: RunContext, job: ShotJob): number {
  const styleCount = ctx.refs.style?.files.length ?? 0;
  // A continuation frame also carries the previous clip's last frame as its base.
  const base = job.source === 'continuation' ? 1 : 0;
  if (!job.featuresCharacter) return base + styleCount;
  // Uploads when present, otherwise the single anchor picked in the refimage step.
  const characterCount = ctx.refs.character?.files.length ?? 1;
  return base + characterCount + styleCount;
}

/** Shots whose frame the image model has to build — everything except a plain chain. */
const needsFrame = (job: ShotJob) => job.source !== 'chain';

export async function quoteFilms(
  ctx: RunContext,
): Promise<{ totalUsd: number; shots: number; framesUsd: number; frames: number }> {
  const media = getMedia();
  // Say so rather than letting a set-but-ignored knob imply it still does something.
  if (process.env.VENICE_VIDEO_TEXT_MODEL) {
    ctx.log(
      'films',
      'note: VENICE_VIDEO_TEXT_MODEL is set but no longer used — every shot is now generated from a start frame. Remove it from .env.',
    );
  }
  const perLevel = await Promise.all(filmLevels(ctx).map((l) => shotJobs(ctx, l)));
  const jobs = perLevel.flat();
  if (jobs.length === 0) return { totalUsd: 0, shots: 0, framesUsd: 0, frames: 0 };

  let video = 0;
  for (const job of jobs) {
    const quote = await media.videoQuote({
      model: job.model,
      duration: job.duration,
      resolution: job.resolution,
      ...(job.aspectRatio ? { aspectRatio: job.aspectRatio } : {}),
    });
    video += quote;
    ctx.log(
      'films',
      `quote: level ${job.level.index} shot ${job.shotIndex + 1} (${job.model}, ${job.duration}, ${job.resolution}) = $${quote.toFixed(2)}`,
    );
  }

  // Start frames are a real line item — at high quality they are a few percent of a shot, but
  // ten of them are not nothing, and the whole point of this gate is that nothing is a surprise.
  const frameJobs = jobs.filter(needsFrame);
  let framesUsd = 0;
  let priced = 0;
  for (const job of frameJobs) {
    const inputs = frameInputCount(ctx, job);
    const model = inputs > 0 ? mediaModels.imageEdit : mediaModels.image;
    const price = await media.imagePrice(model, {
      resolution: '1K',
      quality: 'high',
      inputImages: inputs,
    });
    if (price === null) continue;
    framesUsd += price;
    priced++;
  }
  if (priced < frameJobs.length) {
    ctx.log(
      'films',
      `note: ${frameJobs.length - priced} of ${frameJobs.length} start frames are not priced in the catalog — the frame total below is a floor, not a ceiling`,
    );
  }
  ctx.log(
    'films',
    `quote: ${frameJobs.length} start frame(s) ≈ $${framesUsd.toFixed(2)} + ${jobs.length} shot(s) $${video.toFixed(2)}`,
  );

  return {
    totalUsd: video + framesUsd,
    shots: jobs.length,
    framesUsd,
    frames: frameJobs.length,
  };
}

async function toDataUrl(file: string): Promise<string> {
  const buf = await fs.readFile(file);
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

const SOURCE_LABEL: Record<ShotSource, string> = {
  chain: 'continues scene',
  startframe: 'new scene, from generated start frame',
  continuation: 'continues scene, cast changed — from generated continuation frame',
};

/**
 * Still worth sending even though the start frame settles composition: a start-frame model can
 * and does recompose. Measured across finished projects, image-to-video sometimes invented bars
 * from a clean frame and sometimes healed bars in a dirty one — the frame is a strong steer, not
 * a lock, so the framings we never want stay named here too.
 */
const NEGATIVE_PROMPT =
  'readable text, captions, subtitles, letters, logos, watermarks, speech, ' +
  'centered hero portrait, posed character portrait, character staring into the camera, ' +
  'letterbox bars, pillarbox bars, white border, framed picture, vignette border';

/**
 * The prompt sent to the video model.
 *
 * Both cases start from a frame that is already correct, so the prompt's job is only to describe
 * motion and to forbid redesign. This is much narrower than what these prompts used to carry —
 * identity, aesthetic and composition were all argued for in text, and largely ignored.
 */
function shotPrompt(job: ShotJob): string {
  if (job.source === 'chain') {
    return `SHOT: continuing seamlessly from the start frame — ${job.prompt}`;
  }
  const opening =
    job.source === 'continuation'
      ? `SHOT: continuing the same scene, animate the provided first frame — ${job.prompt}`
      : `SHOT: animate the provided first frame — ${job.prompt}`;
  return (
    `${opening}\n\n` +
    `Keep the first frame's composition, character design, palette, grading and framing exactly ` +
    `as given. Add motion only: camera movement, the described action, atmospheric drift. Do not ` +
    `redesign the scene, do not change the character, do not cut to another shot.`
  );
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
  const media = getMedia();
  const levels = filmLevels(ctx);
  if (levels.length === 0) {
    ctx.setDetail('films', 'no film levels');
    return;
  }
  const dir = path.join(ctx.mediaDir, 'films');
  await fs.mkdir(dir, { recursive: true });

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

    // Frames for shots that open a scene are built before any video is queued: they are cheap and
    // fast relative to video, cached on disk, and building them up front means a run that dies
    // during video has already paid for the expensive-to-get-right part exactly once. They are
    // also inspectable in `media/films/*_start.jpg` while the clips are still rendering.
    //
    // Continuation frames cannot join this pass — their base image is the previous clip's last
    // frame, which does not exist yet. They are built inside the loop below instead.
    const frames = new Map<number, string>();
    const upFront = jobs.filter((j) => j.source === 'startframe');
    let built = 0;
    for (const job of upFront) {
      ctx.setDetail('films', `level ${level.index}: start frame ${++built}/${upFront.length}`);
      frames.set(
        job.shotIndex,
        await ensureStartFrame(ctx, level, job.shotIndex, job.prompt, job.featuresCharacter),
      );
    }

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
          // Three ways in, and no path that starts on nothing:
          //  - chain: the previous clip's last frame, unchanged.
          //  - continuation: a frame built now, from that last frame plus the references.
          //  - startframe: the frame built up front.
          // A continuation with no predecessor frame is not reachable (it requires i > 0), but if
          // it ever were, falling back to a fresh frame beats throwing away a paid-for level.
          let startFrame: string;
          if (job.source === 'chain' && lastFrameUrl) {
            startFrame = lastFrameUrl;
          } else {
            const cached = frames.get(job.shotIndex);
            const file =
              cached ??
              (await ensureStartFrame(
                ctx,
                level,
                job.shotIndex,
                job.prompt,
                job.featuresCharacter,
                job.source === 'continuation' && lastFrameUrl
                  ? { continueFrom: lastFrameUrl }
                  : {},
              ));
            frames.set(job.shotIndex, file);
            startFrame = await startFrameDataUrl(file);
          }
          ctx.log(
            'films',
            `${label}: queueing (${job.model}, ${job.duration}, ${job.resolution}, ${SOURCE_LABEL[job.source]})`,
          );
          const queued = await media.videoQueue({
            model: job.model,
            prompt: shotPrompt(job),
            duration: job.duration,
            resolution: job.resolution,
            ...(job.aspectRatio ? { aspectRatio: job.aspectRatio } : {}),
            imageUrl: startFrame,
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
