import 'server-only';
import { promises as fs } from 'fs';
import path from 'path';
import type { PlanInteraction, ProductionPlan } from '@cortex-trainings/shared';
import type { RunContext } from '../runner';
import { compressForEmbed, compressImage, probeAudio, slimEmbedAudio } from '../ffmpeg';
import { voPath } from './voiceovers';
import { trainingHtml, type TrainingData, type TrainingLevel } from './template';

const EMBED_LIMIT = 5.5 * 1024 * 1024; // per-clip budget before downscaling
const AUDIO_BITRATE_LIMIT = 112_000; // above this, a speech-only track is wasting bytes

async function fileAsDataUrl(file: string, mime: string): Promise<string> {
  const buf = await fs.readFile(file);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

const exists = (file: string) => fs.access(file).then(() => true, () => false);

async function videoDataUrl(ctx: RunContext, file: string): Promise<string> {
  const embed = file.replace(/\.mp4$/, '_embed.mp4');
  let source = file;
  if (await exists(embed)) {
    source = embed;
  } else {
    const stat = await fs.stat(file);
    if (stat.size > EMBED_LIMIT) {
      ctx.log('assemble', `${path.basename(file)}: ${(stat.size / 1e6).toFixed(1)} MB → downscaling embed copy`);
      await compressForEmbed(file, embed);
      source = embed;
    } else {
      const audio = await probeAudio(file);
      if (audio && (audio.channels > 1 || audio.bitRate > AUDIO_BITRATE_LIMIT)) {
        ctx.log(
          'assemble',
          `${path.basename(file)}: ${audio.channels}ch ${(audio.bitRate / 1000).toFixed(0)} kbps audio → re-encoding to mono 96k`,
        );
        await slimEmbedAudio(file, embed);
        source = embed;
      }
    }
  }
  return fileAsDataUrl(source, 'video/mp4');
}

/** Level images generate at 1536px and ~200 KB; the training reads fine from a 1280px copy. */
async function imageDataUrl(file: string): Promise<string | null> {
  if (!(await exists(file))) return null;
  const embed = file.replace(/\.jpg$/, '_embed.jpg');
  if (!(await exists(embed))) await compressImage(file, embed, 1280);
  return fileAsDataUrl(embed, 'image/jpeg');
}

/**
 * WebVTT for a level's voiceover, from the transcription segments the pipeline already has.
 * The voiceover is muxed onto every final video at t=0 (see muxVoiceover / the HyperFrames
 * composition), so the segment times ARE the video times.
 */
function vttDataUrl(segments: { start: number; end: number; text: string }[]): string {
  const ts = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = (s % 60).toFixed(3).padStart(6, '0');
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${sec}`;
  };
  const cue = (text: string) =>
    text.replace(/-->/g, '→').replace(/</g, '&lt;').replace(/\s*\n\s*/g, ' ').trim();
  const body = segments
    .map((s) => `${ts(s.start)} --> ${ts(s.end)}\n${cue(s.text)}`)
    .join('\n\n');
  return `data:text/vtt;base64,${Buffer.from(`WEBVTT\n\n${body}\n`).toString('base64')}`;
}

function normalizeInteraction(interaction: PlanInteraction): PlanInteraction;
function normalizeInteraction(interaction: PlanInteraction | null): PlanInteraction | null;
function normalizeInteraction(interaction: PlanInteraction | null): PlanInteraction | null {
  // A level whose interaction duplicated the final check has none of its own.
  if (!interaction) return null;
  // Defensive: guarantee sane bounds so the runtime JS can trust the data.
  return {
    ...interaction,
    questions: interaction.questions.map((q) => ({
      ...q,
      correctIndex: Math.min(Math.max(q.correctIndex, 0), Math.max(0, q.options.length - 1)),
    })),
  };
}

export async function stepAssemble(ctx: RunContext): Promise<string> {
  const plan = ctx.plan! as ProductionPlan;
  const media = ctx.mediaDir;

  const levels: TrainingLevel[] = [];
  for (const level of plan.levels) {
    let video: string | null = null;
    let captions: string | null = null;
    if (level.medium === 'film') {
      video = await videoDataUrl(ctx, path.join(media, 'films', `level${level.index}_final.mp4`));
    } else if (level.medium === 'animation') {
      video = await videoDataUrl(ctx, path.join(media, 'anim', `level${level.index}_final.mp4`));
    }
    if (video) {
      const vo = await voPath(ctx, level.index);
      captions = vttDataUrl(vo.segments);
    }
    const image = await imageDataUrl(path.join(media, 'img', `level${level.index}.jpg`));
    levels.push({
      title: level.title,
      keyTakeaway: level.keyTakeaway,
      video,
      captions,
      image,
      interaction: normalizeInteraction(level.interaction),
    });
  }

  const hero = await imageDataUrl(path.join(media, 'ref.jpg'));

  const data: TrainingData = {
    id: ctx.projectId,
    title: plan.title,
    language: plan.language,
    accent: plan.accentColor,
    hero,
    levels,
    finalCheck: normalizeInteraction(plan.finalCheck),
    cheatSheet: plan.cheatSheet,
  };

  const html = trainingHtml(data);
  const out = path.join(ctx.dir, 'training.html');
  await fs.writeFile(out, html);
  const size = (await fs.stat(out)).size;
  ctx.log('assemble', `training.html written (${(size / 1e6).toFixed(1)} MB)`);
  if (size > 50 * 1024 * 1024) {
    ctx.log('assemble', 'WARNING: file exceeds the 50 MB budget — consider fewer/shorter film shots');
  }
  return 'training.html';
}
