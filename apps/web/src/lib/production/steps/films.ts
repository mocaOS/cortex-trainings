import 'server-only';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { PlanLevel } from '@cortex-trainings/shared';
import type { RunContext } from '../runner';
import { getMedia, mediaModels } from '../media-client';
import { concatAndTrim, extractLastFrame, muxVoiceover } from '../ffmpeg';
import { voPath } from './voiceovers';

interface ShotJob {
  level: PlanLevel;
  shotIndex: number;
  prompt: string;
  duration: string; // clamped to the executing model's options
  model: string;
  /** Continue the previous shot's scene from its last frame, rather than cut. */
  continues: boolean;
}

const CHAIN_TIERS = [5, 10, 15];
const REFERENCE_TIERS = [5, 10]; // reference-to-video supports 5s/10s only

const secs = (d: string) => Number(d.replace('s', ''));

/**
 * Builds the shot list for a film level.
 *
 * A shot that continues the previous scene is generated from its last frame
 * (image-to-video, 5/10/15s) so the cut is invisible. A shot that opens a new scene uses
 * reference-to-video with the guide-character image (5/10s only) so it cuts cleanly instead
 * of morphing one setting into another.
 *
 * Durations are then grown to cover the voiceover — every uncovered second becomes a frozen
 * last frame.
 */
async function shotJobs(ctx: RunContext, level: PlanLevel): Promise<ShotJob[]> {
  const jobs: ShotJob[] = level.shots.map((shot, i) => {
    // Chain from the previous frame only within one scene. Across a cut, generate from the
    // guide-character reference instead — feeding a forest frame to a showroom prompt makes
    // the clip morph between settings rather than cutting cleanly.
    const continues = i > 0 && shot.continuesPreviousScene === true;
    const tiers = continues ? CHAIN_TIERS : REFERENCE_TIERS;
    const wanted = secs(shot.duration);
    const allowed = tiers.includes(wanted) ? wanted : Math.max(...tiers.filter((t) => t <= wanted)) || tiers[0];
    return {
      level,
      shotIndex: i,
      prompt: shot.prompt,
      duration: `${allowed}s`,
      model: continues ? mediaModels.videoChain : mediaModels.videoReference,
      continues,
    };
  });

  const vo = await voPath(ctx, level.index);
  const total = () => jobs.reduce((sum, j) => sum + secs(j.duration), 0);
  // Grow the later shots (longest tier available) until the chain covers the narration.
  for (let i = jobs.length - 1; i >= 0 && vo.duration - total() > 2; i--) {
    const tiers = jobs[i].continues ? CHAIN_TIERS : REFERENCE_TIERS;
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
      resolution: mediaModels.videoResolution,
    });
    total += quote;
    ctx.log('films', `quote: level ${job.level.index} shot ${job.shotIndex + 1} (${job.model}, ${job.duration}) = $${quote.toFixed(2)}`);
  }
  return { totalUsd: total, shots: jobs.length };
}

async function toDataUrl(file: string): Promise<string> {
  const buf = await fs.readFile(file);
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
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
          const prompt = job.continues
            ? `SHOT: continuing seamlessly from the start frame — ${job.prompt}`
            : job.prompt;
          ctx.log(
            'films',
            `${label}: queueing (${job.model}, ${job.duration}, ${job.continues ? 'continues scene' : 'new scene'})`,
          );
          const queued = await media.videoQueue({
            model: job.model,
            prompt,
            duration: job.duration,
            resolution: mediaModels.videoResolution,
            ...(job.continues && lastFrameUrl
              ? { imageUrl: lastFrameUrl }
              : { referenceImageUrls: [refUrl] }),
            negativePrompt: 'readable text, captions, subtitles, letters, logos, watermarks, speech',
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
    await concatAndTrim(clips, vo.duration + 1, silent);
    await muxVoiceover(silent, vo.file, finalFile);
    await fs.rm(silent, { force: true });
    ctx.log('films', `level ${level.index}: sequence assembled (${jobs.length} shots, ${(vo.duration + 1).toFixed(1)}s)`);
  }
}
