import 'server-only';
import { promises as fs } from 'fs';
import path from 'path';
import type { PlanInteraction, ProductionPlan } from '@cortex-trainings/shared';
import type { RunContext } from '../runner';
import { compressForEmbed } from '../ffmpeg';
import { trainingHtml, type TrainingData, type TrainingLevel } from './template';

const EMBED_LIMIT = 5.5 * 1024 * 1024; // per-clip budget before downscaling

async function fileAsDataUrl(file: string, mime: string): Promise<string> {
  const buf = await fs.readFile(file);
  return `data:${mime};base64,${buf.toString('base64')}`;
}

async function videoDataUrl(ctx: RunContext, file: string): Promise<string> {
  const stat = await fs.stat(file);
  let source = file;
  if (stat.size > EMBED_LIMIT) {
    const embed = file.replace(/\.mp4$/, '_embed.mp4');
    try {
      await fs.access(embed);
    } catch {
      ctx.log('assemble', `${path.basename(file)}: ${(stat.size / 1e6).toFixed(1)} MB → downscaling embed copy`);
      await compressForEmbed(file, embed);
    }
    source = embed;
  }
  return fileAsDataUrl(source, 'video/mp4');
}

function normalizeInteraction(interaction: PlanInteraction): PlanInteraction {
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
    let image: string | null = null;
    if (level.medium === 'film') {
      video = await videoDataUrl(ctx, path.join(media, 'films', `level${level.index}_final.mp4`));
    } else if (level.medium === 'animation') {
      video = await videoDataUrl(ctx, path.join(media, 'anim', `level${level.index}_final.mp4`));
    }
    try {
      image = await fileAsDataUrl(path.join(media, 'img', `level${level.index}.jpg`), 'image/jpeg');
    } catch {
      image = null;
    }
    levels.push({
      title: level.title,
      keyTakeaway: level.keyTakeaway,
      video,
      image,
      interaction: normalizeInteraction(level.interaction),
    });
  }

  let hero: string | null = null;
  try {
    hero = await fileAsDataUrl(path.join(media, 'ref.jpg'), 'image/jpeg');
  } catch {
    hero = null;
  }

  const data: TrainingData = {
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
