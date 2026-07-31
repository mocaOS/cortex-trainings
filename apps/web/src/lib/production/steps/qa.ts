import 'server-only';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import type { RunContext } from '../runner';
import { env } from '../../env';

/**
 * The skill's Phase 10, automated: click through the produced training and fail the run
 * if it is broken. Two shipped bugs — a dead continue button and a stuck sorting task —
 * reached a finished file because this was a thing a human remembered to do.
 *
 * `scripts/qa-training.mjs` is the single implementation; this spawns it rather than
 * duplicating the walk, so the CLI and the pipeline can never disagree.
 */
async function findScript(): Promise<string> {
  let dir = process.cwd();
  for (let up = 0; up < 5; up++) {
    const candidate = path.join(dir, 'scripts', 'qa-training.mjs');
    if (await fs.access(candidate).then(() => true).catch(() => false)) return candidate;
    dir = path.dirname(dir);
  }
  throw new Error('scripts/qa-training.mjs not found — cannot verify the produced training');
}

export async function stepQa(ctx: RunContext): Promise<{
  passed: boolean;
  summary: string;
  notCovered: string;
}> {
  const script = await findScript();
  const repoRoot = path.dirname(path.dirname(script));
  const storage = path.resolve(env.storagePath);

  const output = await new Promise<{ code: number; text: string }>((resolve) => {
    const child = spawn(
      process.execPath,
      [script, ctx.projectId, '--storage', storage],
      { cwd: repoRoot, env: process.env },
    );
    let text = '';
    child.stdout.on('data', (d) => {
      text += String(d);
    });
    child.stderr.on('data', (d) => {
      text += String(d);
    });
    child.on('close', (code) => resolve({ code: code ?? 1, text }));
    child.on('error', (err) => resolve({ code: 1, text: String(err) }));
  });

  // Surface the walk in the production log — the screens visited are the useful part.
  for (const line of output.text.split('\n')) {
    const trimmed = line.trimEnd();
    if (trimmed && !trimmed.startsWith('training:')) ctx.log('qa', trimmed);
  }

  const passed = /verdict:\s+PASS/.test(output.text) && output.code === 0;
  const pick = (label: string) => {
    const m = output.text.match(new RegExp(`^${label}:\\s*(.+)$`, 'm'));
    return m ? m[1].trim() : '';
  };
  const summary = [
    pick('videos') && `videos ${pick('videos')}`,
    pick('xp') && `${pick('xp')} XP`,
    pick('cheat sheet') && `cheat sheet ${pick('cheat sheet')}`,
    pick('console') && `console ${pick('console')}`,
  ]
    .filter(Boolean)
    .join(' · ');
  const notCovered = (output.text.match(/not covered:\s*([\s\S]*?)\n\s*\n/) ?? [])[1]
    ?.replace(/\s+/g, ' ')
    .trim() ?? '';

  ctx.setDetail('qa', passed ? summary || 'passed' : 'FAILED — see log');
  if (!passed) {
    const reason =
      output.text
        .split('\n')
        .filter((l) => /stuck on screen|error|FAILED|no continue button/i.test(l))
        .slice(0, 3)
        .join(' | ') || 'see the log above';
    throw new Error(`The produced training did not pass the click-through: ${reason}`);
  }
  return { passed, summary, notCovered };
}
