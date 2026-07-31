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
}

const CHAIN_TIERS = [5, 10, 15];
const REFERENCE_TIERS = [5, 10]; // reference-to-video supports 5s/10s only

const secs = (d: string) => Number(d.replace('s', ''));

/**
 * Shot 1 of a sequence uses reference-to-video (character consistency, 5s/10s only);
 * follow-up shots chain via image-to-video from the previous last frame (5s/10s/15s).
 * The chain is then stretched to cover the voiceover — every second short of it would
 * otherwise become a frozen last frame.
 */
async function shotJobs(ctx: RunContext, level: PlanLevel): Promise<ShotJob[]> {
  const jobs: ShotJob[] = level.shots.map((shot, i) => {
    const first = i === 0;
    const tiers = first ? REFERENCE_TIERS : CHAIN_TIERS;
    const wanted = secs(shot.duration);
    const allowed = tiers.includes(wanted) ? wanted : Math.max(...tiers.filter((t) => t <= wanted)) || tiers[0];
    return {
      level,
      shotIndex: i,
      prompt: shot.prompt,
      duration: `${allowed}s`,
      model: first ? mediaModels.videoReference : mediaModels.videoChain,
    };
  });

  const vo = await voPath(ctx, level.index);
  const total = () => jobs.reduce((sum, j) => sum + secs(j.duration), 0);
  // Grow the later shots (longest tier available) until the chain covers the narration.
  for (let i = jobs.length - 1; i >= 0 && vo.duration - total() > 2; i--) {
    const tiers = i === 0 ? REFERENCE_TIERS : CHAIN_TIERS;
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
      try {
        await fs.access(clipFile);
        ctx.log('films', `level ${level.index} shot ${job.shotIndex + 1}: cached`);
      } catch {
        const isFirst = job.shotIndex === 0;
        const prompt = isFirst
          ? job.prompt
          : `SHOT: continuing seamlessly from the start frame — ${job.prompt}`;
        ctx.log('films', `level ${level.index} shot ${job.shotIndex + 1}: queueing (${job.model}, ${job.duration})`);
        const { queueId } = await media.videoQueue({
          model: job.model,
          prompt,
          duration: job.duration,
          resolution: mediaModels.videoResolution,
          ...(isFirst
            ? { referenceImageUrls: [refUrl] }
            : { imageUrl: lastFrameUrl ?? refUrl }),
          negativePrompt: 'readable text, captions, subtitles, letters, logos, watermarks, speech',
        });
        const video = await media.videoAwait({
          model: job.model,
          queueId,
          onProgress: (msg) =>
            ctx.setDetail('films', `level ${level.index} shot ${job.shotIndex + 1}: ${msg}`),
        });
        await fs.writeFile(clipFile, video);
        await media.videoComplete(job.model, queueId);
        ctx.log('films', `level ${level.index} shot ${job.shotIndex + 1}: done (${(video.length / 1e6).toFixed(1)} MB)`);
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
