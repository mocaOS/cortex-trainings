import 'server-only';
import { promises as fs } from 'fs';
import path from 'path';
import type { ProductionPlan } from '@cortex-trainings/shared';

/**
 * Guards against a revision silently invalidating produced media.
 *
 * A revision asked to touch "only the interactions" once rewrote every voiceover script and
 * renamed every level while reporting that nothing had changed. Trusting that report would
 * have shipped a training whose narration contradicted its own curriculum. So the app compares
 * the new curriculum against the plan the media was actually built from, and never takes the
 * author's word for it.
 */
export interface Drift {
  /** Levels whose narration changed — their audio (and any film cut to it) is now wrong. */
  voiceovers: number[];
  /** Levels whose on-screen title changed — animations show the old one. */
  titles: number[];
  /** Levels whose film prompts changed — the existing footage no longer matches. */
  shots: number[];
}

export function isDirty(drift: Drift): boolean {
  return drift.voiceovers.length > 0 || drift.titles.length > 0 || drift.shots.length > 0;
}

export function describeDrift(drift: Drift): string {
  const parts: string[] = [];
  if (drift.voiceovers.length) parts.push(`voiceover changed on level ${drift.voiceovers.join(', ')}`);
  if (drift.titles.length) parts.push(`title changed on level ${drift.titles.join(', ')}`);
  if (drift.shots.length) parts.push(`film prompts changed on level ${drift.shots.join(', ')}`);
  return parts.join('; ');
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Compare a curriculum against the plan produced from an earlier version. Returns null when
 * there is nothing to compare (no plan yet), so a first run is never blocked.
 */
export async function detectDrift(projectDir: string, curriculum: string): Promise<Drift | null> {
  const planFile = path.join(projectDir, 'plan.json');
  let plan: ProductionPlan;
  try {
    plan = JSON.parse(await fs.readFile(planFile, 'utf8')) as ProductionPlan;
  } catch {
    return null;
  }

  const drift: Drift = { voiceovers: [], titles: [], shots: [] };
  for (const level of plan.levels) {
    // The produced narration is verbatim in the curriculum when unchanged, so a substring
    // test is enough and avoids re-running extraction just to compare.
    if (level.voiceover?.trim() && !norm(curriculum).includes(norm(level.voiceover))) {
      drift.voiceovers.push(level.index);
    }
    if (level.title?.trim() && !norm(curriculum).includes(norm(level.title))) {
      drift.titles.push(level.index);
    }
    for (const shot of level.shots ?? []) {
      // Prompts get a style block appended, so compare the distinctive opening clause.
      const head = norm(shot.prompt).split(/[,.]/).slice(0, 2).join(',');
      if (head.length > 25 && !norm(curriculum).includes(head)) {
        if (!drift.shots.includes(level.index)) drift.shots.push(level.index);
        break;
      }
    }
  }
  return drift;
}

/** Media that a given drift invalidates, as paths relative to the project's media dir. */
export function staleMedia(drift: Drift): string[] {
  const stale = new Set<string>();
  for (const level of drift.voiceovers) {
    stale.add(`vo/level${level}.mp3`);
    stale.add(`vo/level${level}.json`);
    stale.add(`films/level${level}_final.mp4`);
    stale.add(`anim/level${level}_final.mp4`);
  }
  for (const level of drift.titles) stale.add(`anim/level${level}_final.mp4`);
  for (const level of drift.shots) stale.add(`films/level${level}_final.mp4`);
  return [...stale];
}
