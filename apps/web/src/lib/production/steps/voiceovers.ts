import 'server-only';
import { promises as fs } from 'fs';
import path from 'path';
import type { PlanPronunciation } from '@cortex-trainings/shared';
import type { RunContext } from '../runner';
import { getMedia, mediaModels } from '../media-client';
import { concatAudio, normalizeVoiceChunk, probeDuration } from '../ffmpeg';

/** Venice answers 500 when hit with too many concurrent TTS calls. */
const TTS_CONCURRENCY = Number(process.env.TTS_CONCURRENCY ?? '3');

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface VoiceSegment {
  start: number;
  end: number;
  text: string;
}

export interface VoiceoverInfo {
  file: string; // mp3 path
  duration: number;
  /** Sentence-level timeline — exact by construction, no transcription needed. */
  segments: VoiceSegment[];
}

export async function voPath(ctx: RunContext, levelIndex: number): Promise<VoiceoverInfo> {
  const dir = path.join(ctx.mediaDir, 'vo');
  return JSON.parse(
    await fs.readFile(path.join(dir, `level${levelIndex}.json`), 'utf8'),
  ) as VoiceoverInfo;
}

/**
 * Split into sentences for per-chunk synthesis. German abbreviations ("z. B.", "ca.",
 * "Nr.") would otherwise split mid-sentence, so short fragments are merged forward.
 */
export function splitSentences(text: string): string[] {
  // Only split on . ! ? — a colon introduces enumerations ("Erstens:", "Wert:") that
  // must stay attached, and abbreviations keep their following clause.
  const rough = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(/(?<=[.!?])\s+(?=[A-ZÄÖÜ„"'(])/);
  const out: string[] = [];
  for (const part of rough) {
    const prev = out[out.length - 1];
    const prevTooShort = prev !== undefined && prev.length < 45;
    const prevIsAbbrev =
      prev !== undefined && /\b(z|ca|bzw|Nr|Abs|evtl|ggf|inkl|max|min|u|vgl|Bsp)\.\s*$/i.test(prev);
    // A stray fragment ("Von dir.") synthesized alone sounds wrong — attach it.
    const partTooShort = part.trim().length < 25;
    if (prev !== undefined && (prevTooShort || prevIsAbbrev || partTooShort)) {
      out[out.length - 1] = `${prev} ${part}`;
    } else {
      out.push(part);
    }
  }
  return out.filter((s) => s.trim().length > 0);
}

/**
 * Rewrites terms TTS would mispronounce into a respelling that sounds right.
 *
 * Applied to the TTS input only. Voiceover text is never displayed — the learner reads the
 * curriculum, the titles and the interactions, none of which come through here — so respelling for
 * the ear costs nothing on screen, and the written form stays canonical. Fixing it upstream instead
 * would put "Art Decos" into the curriculum, which is simply the wrong spelling of the thing.
 *
 * Longest `written` first, because these terms nest: a collection called "DeCC0s" is built on the
 * "CC0" licence, and "CC0" genuinely *is* said "see-see-zero". Replacing the short form first would
 * corrupt the long one.
 */
function applyPronunciations(text: string, rules: PlanPronunciation[]): string {
  return [...rules]
    .filter((r) => r.written.trim() !== '' && r.spoken.trim() !== '')
    .sort((a, b) => b.written.length - a.written.length)
    .reduce(
      (acc, r) => acc.split(r.written).join(r.spoken),
      text,
    );
}

/**
 * Terms that *look* like TTS will mangle them but have no respelling rule.
 *
 * The pronunciation map is only as good as the extractor's recall, and a miss is silent — the audio
 * synthesizes fine, QA passes, and you find out by listening. This does not guess a respelling; it
 * refuses to be quiet about a term nobody decided on. Three shapes catch most of it:
 * letters mixed with digits (`DeCC0s`, `v2Ray`), internal capitals past the first letter
 * (`ComfyUI`, `ElizaOS`), and all-caps runs long enough to be a coined name rather than an
 * everyday initialism.
 *
 * Deliberately not flagged: 2–3 letter all-caps (`API`, `ETH`, `DNA`, `CC0` is caught by the digit
 * rule instead), because spelling those out is usually correct and flagging them would bury the
 * real misses in noise.
 */
function suspiciousTerms(text: string, rules: PlanPronunciation[]): string[] {
  const covered = rules.map((r) => r.written);
  const hits = new Set<string>();
  for (const raw of text.split(/\s+/)) {
    const token = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
    if (token.length < 3) continue;
    const hasDigitAndLetter = /\p{L}/u.test(token) && /\p{N}/u.test(token);
    const innerCaps = /^\p{Lu}?\p{Ll}+\p{Lu}/u.test(token);
    const capsRun = /^\p{Lu}{4,}$/u.test(token);
    if (!hasDigitAndLetter && !innerCaps && !capsRun) continue;
    // Covered if any rule's written form appears in the token (or the token in it).
    if (covered.some((w) => token.includes(w) || w.includes(token))) continue;
    hits.add(token);
  }
  return [...hits];
}

/**
 * One TTS call per sentence, each sped up via ffmpeg (Venice's `speed` is a no-op on
 * some models) and re-encoded small. Concatenating them yields an exact sentence
 * timeline, which drives the animation beats — no flaky transcription round-trip.
 */
export async function stepVoiceovers(ctx: RunContext): Promise<void> {
  const plan = ctx.plan!;
  const media = getMedia();
  const dir = path.join(ctx.mediaDir, 'vo');
  await fs.mkdir(dir, { recursive: true });
  const tts = mediaModels.ttsFor(plan.language);

  // One flat job list so the concurrency cap applies across all levels, and every
  // chunk is cached on disk — a retry after a Venice hiccup re-synthesizes only the gaps.
  const rules = plan.pronunciations ?? [];
  if (rules.length > 0) {
    ctx.log(
      'voiceovers',
      `respelling for TTS: ${rules.map((r) => `${r.written}→${r.spoken}`).join(', ')}`,
    );
  }
  // Loud about a possible miss, rather than letting it surface in the finished audio.
  const unruled = suspiciousTerms(
    plan.levels.map((l) => l.voiceover).join(' '),
    rules,
  );
  if (unruled.length > 0) {
    ctx.log(
      'voiceovers',
      `NOTE: no pronunciation rule for ${unruled.length} term(s) TTS may mangle — ` +
        `${unruled.slice(0, 12).join(', ')}${unruled.length > 12 ? ', …' : ''}. ` +
        `Listen to these, and add them to plan.json "pronunciations" if they come out wrong.`,
    );
  }

  const jobs: Array<{ levelIndex: number; sentenceIndex: number; text: string }> = [];
  const perLevel = new Map<number, string[]>();
  for (const level of plan.levels) {
    const meta = path.join(dir, `level${level.index}.json`);
    if (await fs.access(meta).then(() => true).catch(() => false)) continue;
    // Split first, respell second: sentence splitting keys off punctuation and abbreviations, and
    // a respelling can drop the period that a split depends on.
    const sentences = splitSentences(level.voiceover);
    perLevel.set(level.index, sentences);
    ctx.log(
      'voiceovers',
      `level ${level.index}: ${sentences.length} sentences (${tts.model}/${tts.voice}, atempo ${mediaModels.ttsTempo})`,
    );
    sentences.forEach((text, i) =>
      jobs.push({
        levelIndex: level.index,
        sentenceIndex: i,
        text: applyPronunciations(text, rules),
      }),
    );
  }
  if (jobs.length === 0) {
    ctx.setDetail('voiceovers', 'all cached');
    return;
  }

  const chunkDir = path.join(dir, 'chunks');
  await fs.mkdir(chunkDir, { recursive: true });
  let synthesized = 0;

  const durations = await mapPool(jobs, TTS_CONCURRENCY, async (job) => {
    const norm = path.join(chunkDir, `l${job.levelIndex}-s${job.sentenceIndex}.mp3`);
    if (await fs.access(norm).then(() => true).catch(() => false)) {
      return probeDuration(norm);
    }
    const raw = `${norm}.raw`;
    const audio = await media.tts({ model: tts.model, input: job.text, voice: tts.voice });
    await fs.writeFile(raw, audio);
    const duration = await normalizeVoiceChunk(raw, norm, { tempo: mediaModels.ttsTempo });
    await fs.rm(raw, { force: true });
    synthesized++;
    ctx.setDetail('voiceovers', `${synthesized}/${jobs.length} sentences`);
    return duration;
  });

  for (const [levelIndex, sentences] of perLevel) {
    const files: string[] = [];
    const segments: VoiceSegment[] = [];
    let cursor = 0;
    sentences.forEach((text, i) => {
      const jobIdx = jobs.findIndex(
        (j) => j.levelIndex === levelIndex && j.sentenceIndex === i,
      );
      const duration = durations[jobIdx];
      segments.push({ start: cursor, end: cursor + duration, text });
      cursor += duration;
      files.push(path.join(chunkDir, `l${levelIndex}-s${i}.mp3`));
    });

    const target = path.join(dir, `level${levelIndex}.mp3`);
    const duration = await concatAudio(files, target);
    const info: VoiceoverInfo = { file: target, duration, segments };
    await fs.writeFile(path.join(dir, `level${levelIndex}.json`), JSON.stringify(info, null, 2));
    const size = (await fs.stat(target)).size;
    ctx.log(
      'voiceovers',
      `level ${levelIndex}: ${duration.toFixed(1)}s, ${segments.length} segments, ${(size / 1e6).toFixed(2)} MB`,
    );
  }
}
