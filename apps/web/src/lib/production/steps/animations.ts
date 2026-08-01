import 'server-only';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { PlanAnimationBeat, PlanLevel } from '@cortex-trainings/shared';
import type { RunContext } from '../runner';
import { muxVoiceover, webmToMp4 } from '../ffmpeg';
import { voPath, type VoiceoverInfo } from './voiceovers';

/* Beat times come from the sentence timeline built during synthesis (exact), so cue matching only
   has to locate the cue within it — and then interpolate, because a segment is not always one
   sentence. The TTS chunker deliberately merges a sentence into its predecessor when that
   predecessor is short, so a stray fragment is never synthesized alone. That is right for audio
   and it means one segment can contain two cues. */

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

/**
 * Where in a segment the cue's words actually start, as a fraction of that segment.
 *
 * Returns the best-scoring window and its offset, so two cues inside one merged segment resolve to
 * different times instead of one of them going unresolved.
 */
function locateCue(cueWords: Set<string>, segmentText: string): { score: number; frac: number } {
  const words = normalize(segmentText);
  if (words.length === 0) return { score: 0, frac: 0 };
  // Slide a window the length of the cue across the segment; the best-matching window's start is
  // where the narration reaches this beat.
  const span = Math.max(1, Math.min(cueWords.size, words.length));
  let bestHits = 0;
  let bestStart = 0;
  for (let start = 0; start + 1 <= words.length; start++) {
    let hits = 0;
    for (let k = start; k < Math.min(start + span, words.length); k++) {
      if (cueWords.has(words[k])) hits++;
    }
    if (hits > bestHits) {
      bestHits = hits;
      bestStart = start;
    }
  }
  return { score: bestHits / Math.max(1, cueWords.size), frac: bestStart / words.length };
}

/**
 * Map each beat cue to a start time using the synthesis timeline; fall back to even spacing.
 *
 * Segments are searched *without* consuming them. An earlier version advanced past each matched
 * segment, which starved every later beat whose cue shared a segment with an earlier one — and the
 * chunker merges short sentences, so that was common. The symptom was a 40-second animation showing
 * one line for 30 seconds and then dumping four beats in the last five: beat 2 went unresolved, and
 * beats 3–5 cascaded behind it into the fallback. Beats are ordered, so a match is only accepted at
 * or after the previous beat's position, which keeps them in sequence without excluding a shared
 * segment.
 */
export function beatTimes(beats: PlanAnimationBeat[], vo: VoiceoverInfo): number[] {
  const times: number[] = [];
  // Position of the previous resolved beat, as (segmentIndex, fractionWithinSegment).
  let floorSeg = 0;
  let floorFrac = 0;
  for (const beat of beats) {
    const cueWords = new Set(normalize(beat.cue));
    let best = -1;
    let bestScore = 0;
    let bestFrac = 0;
    for (let i = floorSeg; i < vo.segments.length; i++) {
      const { score, frac } = locateCue(cueWords, vo.segments[i].text);
      // Never place a beat before the previous one inside the same segment.
      if (i === floorSeg && frac < floorFrac) continue;
      if (score > bestScore) {
        bestScore = score;
        best = i;
        bestFrac = frac;
      }
    }
    if (best >= 0 && bestScore >= 0.34) {
      const seg = vo.segments[best];
      const span = Math.max(0, seg.end - seg.start);
      times.push(seg.start + span * bestFrac);
      floorSeg = best;
      floorFrac = bestFrac;
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

const STAGE_W = 1920;
const STAGE_H = 1080;
const PAD_X = 120;
const PAD_Y = 96;
/** The orb sits top-right; the title must not run under it. */
const ORB_CLEARANCE = 240;
const TITLE_W = STAGE_W - PAD_X * 2 - ORB_CLEARANCE;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * Deterministic fit. Titles vary from a few words to a full clause (German
 * compounds especially), and beat counts from 3 to 8, so nothing here can be a
 * fixed pixel value — a too-long title used to clip off-canvas.
 */
function fitLayout(level: PlanLevel): {
  titleSize: number;
  beatSize: number;
  gap: number;
  dot: number;
} {
  // ~0.53em average advance for bold Inter-ish text; wrap to a second line if needed.
  const titleSize = clamp(Math.floor(TITLE_W / (level.title.length * 0.53)), 30, 64);
  const titleLines = level.title.length * titleSize * 0.53 > TITLE_W ? 2 : 1;
  const titleBlock = titleLines * titleSize * 1.2 + 56; // + rule and its margin

  const available = STAGE_H - PAD_Y * 2 - titleBlock;
  const n = Math.max(level.animationBeats.length, 1);
  let beatSize = 44;
  let gap = 42;
  const needed = () => n * beatSize * 1.35 + (n - 1) * gap;
  while (needed() > available && beatSize > 24) {
    beatSize -= 2;
    gap = Math.max(14, gap - 3);
  }
  return { titleSize, beatSize, gap, dot: Math.round(beatSize * 0.5) };
}

function sceneHtml(level: PlanLevel, times: number[], accent: string): string {
  const { titleSize, beatSize, gap, dot } = fitLayout(level);
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
  html,body { margin:0; width:${STAGE_W}px; height:${STAGE_H}px; background:#101014; overflow:hidden;
    font-family:system-ui,-apple-system,'Segoe UI',sans-serif; color:#f2f3f7; }
  /* Vertically centred so a short beat list doesn't leave the frame bottom-heavy. */
  .stage { box-sizing:border-box; width:${STAGE_W}px; height:${STAGE_H}px;
    padding:${PAD_Y}px ${PAD_X}px; position:relative;
    display:flex; flex-direction:column; justify-content:center; }
  .orb { position:absolute; top:84px; right:${PAD_X}px; width:96px; height:96px; border-radius:50%;
    background: radial-gradient(circle at 35% 35%, #ffffff -40%, ${accent} 60%);
    box-shadow: 0 0 60px ${accent}; animation: float 4s ease-in-out infinite; }
  @keyframes float { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-14px) } }
  /* Sized to fit and capped clear of the orb; wraps rather than clipping if it still overflows. */
  h1 { font-size:${titleSize}px; line-height:1.2; margin:0 0 24px; letter-spacing:-0.02em;
    max-width:${TITLE_W}px; text-wrap:balance; animation: enter 0.7s ease-out both; }
  .rule { flex:none; width:160px; height:6px; background:${accent}; border-radius:3px;
    margin-bottom:44px; animation: enter 0.7s ease-out both; animation-delay:0.2s; }
  ul { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:${gap}px; }
  .beat { display:flex; align-items:flex-start; gap:28px; font-size:${beatSize}px; line-height:1.35;
    opacity:0; animation: enter 0.6s ease-out both; }
  .dot { flex:none; width:${dot}px; height:${dot}px; border-radius:50%; background:${accent};
    box-shadow: 0 0 18px ${accent}; margin-top:${Math.round(beatSize * 0.42)}px; }
  .beat-text { max-width:${STAGE_W - PAD_X * 2 - 60}px; }
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
