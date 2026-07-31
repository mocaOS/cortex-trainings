import 'server-only';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { PlanAnimationBeat, PlanLevel } from '@cortex-trainings/shared';
import type { RunContext } from '../runner';
import { muxVoiceover, webmToMp4 } from '../ffmpeg';
import { voPath, type VoiceoverInfo } from './voiceovers';

/* Beat times come from the sentence timeline built during synthesis (exact), so
   cue matching only has to pick the right sentence. */

/**
 * HyperFrames stand-in: a deterministic 1920×1080 HTML scene (dark, accent color,
 * guide orb, beats fading in at voiceover-derived times via CSS animation-delay),
 * recorded headlessly with Playwright and muxed with the voiceover.
 */

function normalize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Map each beat cue to a start time using the STT segments; fall back to even spacing. */
export function beatTimes(beats: PlanAnimationBeat[], vo: VoiceoverInfo): number[] {
  const times: number[] = [];
  let searchFrom = 0;
  for (const beat of beats) {
    const cueWords = new Set(normalize(beat.cue));
    let best = -1;
    let bestScore = 0;
    for (let i = searchFrom; i < vo.segments.length; i++) {
      const segWords = normalize(vo.segments[i].text);
      const overlap = segWords.filter((w) => cueWords.has(w)).length;
      const score = overlap / Math.max(1, cueWords.size);
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best >= 0 && bestScore >= 0.34) {
      times.push(vo.segments[best].start);
      searchFrom = best + 1;
    } else {
      times.push(-1); // resolve in the fallback pass
    }
  }
  // Fallback pass: distribute unresolved beats evenly between neighbours.
  const total = vo.duration;
  for (let i = 0; i < times.length; i++) {
    if (times[i] >= 0) continue;
    const prev = i > 0 ? times[i - 1] : 0.8;
    let nextKnown = total - 1.5;
    for (let j = i + 1; j < times.length; j++) {
      if (times[j] >= 0) {
        nextKnown = times[j];
        break;
      }
    }
    times[i] = prev + (nextKnown - prev) / 2;
  }
  // Enforce strictly increasing, clamped times.
  for (let i = 0; i < times.length; i++) {
    if (i > 0 && times[i] <= times[i - 1]) times[i] = times[i - 1] + 0.6;
    times[i] = Math.min(times[i], total - 0.5);
  }
  return times;
}

function sceneHtml(level: PlanLevel, times: number[], accent: string): string {
  const items = level.animationBeats
    .map(
      (beat, i) => `
      <li class="beat" style="animation-delay:${times[i].toFixed(2)}s">
        <span class="dot"></span>
        <span class="beat-text">${escapeHtml(beat.text)}</span>
      </li>`,
    )
    .join('\n');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  html,body { margin:0; width:1920px; height:1080px; background:#101014; overflow:hidden;
    font-family:system-ui,-apple-system,'Segoe UI',sans-serif; color:#f2f3f7; }
  .stage { box-sizing:border-box; width:1920px; height:1080px; padding:96px 120px; position:relative; }
  .orb { position:absolute; top:84px; right:120px; width:96px; height:96px; border-radius:50%;
    background: radial-gradient(circle at 35% 35%, #ffffff -40%, ${accent} 60%);
    box-shadow: 0 0 60px ${accent}; animation: float 4s ease-in-out infinite; }
  @keyframes float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-14px) } }
  h1 { font-size:64px; margin:0 0 24px; letter-spacing:-0.02em; white-space:nowrap;
    animation: enter 0.7s ease-out both; }
  .rule { width:160px; height:6px; background:${accent}; border-radius:3px; margin-bottom:56px;
    animation: enter 0.7s ease-out both; animation-delay:0.2s; }
  ul { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:42px; }
  .beat { display:flex; align-items:center; gap:28px; font-size:44px; line-height:1.3;
    opacity:0; animation: enter 0.6s ease-out both; }
  .dot { flex:none; width:22px; height:22px; border-radius:50%; background:${accent};
    box-shadow: 0 0 18px ${accent}; }
  @keyframes enter { from { opacity:0; transform: translateY(24px) } to { opacity:1; transform: translateY(0) } }
</style>
</head>
<body>
  <div class="stage">
    <div class="orb"></div>
    <h1>${escapeHtml(level.title)}</h1>
    <div class="rule"></div>
    <ul>
${items}
    </ul>
  </div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function recordScene(html: string, seconds: number, outMp4: string): Promise<void> {
  const { chromium } = await import('playwright');
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'scene-'));
  try {
    const page = path.join(tmp, 'scene.html');
    await fs.writeFile(page, html);
    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 },
        recordVideo: { dir: tmp, size: { width: 1920, height: 1080 } },
      });
      const tab = await context.newPage();
      await tab.goto(`file://${page}`);
      await tab.waitForTimeout(seconds * 1000);
      await context.close();
    } finally {
      await browser.close();
    }
    const files = await fs.readdir(tmp);
    const webm = files.find((f) => f.endsWith('.webm'));
    if (!webm) throw new Error('Playwright produced no recording');
    await webmToMp4(path.join(tmp, webm), outMp4);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

export async function stepAnimations(ctx: RunContext): Promise<void> {
  const plan = ctx.plan!;
  const levels = plan.levels.filter((l) => l.medium === 'animation' && l.animationBeats.length > 0);
  if (levels.length === 0) {
    ctx.setDetail('animations', 'no animation levels');
    return;
  }
  const dir = path.join(ctx.mediaDir, 'anim');
  await fs.mkdir(dir, { recursive: true });

  let done = 0;
  for (const level of levels) {
    const finalFile = path.join(dir, `level${level.index}_final.mp4`);
    try {
      await fs.access(finalFile);
      done++;
      continue;
    } catch {
      /* produce */
    }
    const vo = await voPath(ctx, level.index);
    const times = beatTimes(level.animationBeats, vo);
    ctx.log(
      'animations',
      `level ${level.index}: ${level.animationBeats.length} beats at [${times.map((t) => t.toFixed(1)).join(', ')}]s`,
    );
    const silent = path.join(dir, `level${level.index}_silent.mp4`);
    ctx.setDetail('animations', `level ${level.index}: recording ${Math.ceil(vo.duration + 1)}s scene`);
    await recordScene(sceneHtml(level, times, plan.accentColor), vo.duration + 1, silent);
    await muxVoiceover(silent, vo.file, finalFile);
    await fs.rm(silent, { force: true });
    done++;
    ctx.setDetail('animations', `${done}/${levels.length} done`);
    ctx.log('animations', `level ${level.index}: rendered + voiced`);
  }
}
