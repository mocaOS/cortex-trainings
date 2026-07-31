import 'server-only';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

const exec = promisify(execFile);

async function ff(args: string[]): Promise<void> {
  try {
    await exec('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], {
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    throw new Error(`ffmpeg ${args.slice(0, 4).join(' ')}… failed: ${(e.stderr || e.message || '').slice(0, 400)}`);
  }
}

export async function probeDuration(file: string): Promise<number> {
  const { stdout } = await exec('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file,
  ]);
  return parseFloat(stdout.trim());
}

export async function extractLastFrame(video: string, out: string): Promise<void> {
  await ff(['-sseof', '-0.15', '-i', video, '-frames:v', '1', '-q:v', '2', out]);
}

async function videoSize(file: string): Promise<{ width: number; height: number }> {
  const { stdout } = await exec('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0',
    file,
  ]);
  const [width, height] = stdout.trim().split(',').map(Number);
  if (!width || !height) {
    throw new Error(`ffprobe could not read the frame size of ${path.basename(file)}`);
  }
  return { width, height };
}

export interface CropRect {
  width: number;
  height: number;
  x: number;
  y: number;
}

/**
 * Finds padding a video model baked around the frame.
 *
 * MiniMax H3 returns a cinematic (~2:1) composition padded to its mandatory 16:9 with
 * near-white bars. Scaling that straight to 1920×1080 carries the bars into the training,
 * where they read as a rendering bug rather than a letterbox.
 *
 * A row counts as padding when it is **flat and clearly brighter than the picture**. Both halves
 * matter, and each was learned the hard way:
 *
 * - *Flat* is what separates a bar from content. Measured on real output, bar rows spread 7–19
 *   between their darkest and brightest pixel while picture rows in the same frame spread
 *   145–216. Grain guarantees content is never flat.
 * - *Brighter than the picture* is what stops it eating footage. An absolute brightness
 *   threshold does not work: one run's bars ran mean 203–255 (near-white) and the next run's ran
 *   157–177 (mid-grey), so any fixed floor either misses grey bars or risks bright content. And
 *   flatness alone is not enough either — in near-black footage a genuine edge column is flat
 *   too, and testing flatness by itself cropped 283px off a shot that had no padding at all.
 *   Requiring the band to be much brighter than the frame's own interior separates the two
 *   cleanly: a pale bar sits far above a dark picture, a dark edge column sits below it.
 *
 * Sampled across several frames because the padding is not constant within a clip — a bar
 * present at 4s can be gone by the one-third mark, so a single sample leaves a bar in the frames
 * it did not see. The boundary row is anti-aliased and reads as neither bar nor picture, so a
 * trailing inset swallows it; without that inset a visible hairline survives.
 *
 * Dark padding is still not detected, and that is a deliberate stopping point rather than an
 * oversight. Two attempts failed: a plain flatness test cropped 283px off a shot with no padding,
 * and a symmetry-gated version could not see a *nested* black pillarbox (grey bar outside, black
 * bars inside) because a full-height column spans the outer grey band and so fails any
 * flat-and-dark test. The cause of that nesting was a black-padded style reference, which
 * `fitTo16x9` now crops instead — fixing the source beat guessing at the symptom. Ordinary black
 * letterboxing is prevented downstream by scaling to fill.
 */
export async function detectPadding(file: string): Promise<CropRect | null> {
  const { width, height } = await videoSize(file);
  const duration = await probeDuration(file);
  const FLAT = 28; // bars measured 7–19; picture rows in the same frames, 145–216
  const OVER = 60; // how far above the picture's own brightness a bar must sit
  const INSET = 6; // swallow the anti-aliased blend row at the boundary
  const MAX = 0.2; // never crop more than 20% off a side

  // The padding is not constant within a clip — a bar can be present early and gone later.
  // Several samples, taking the widest band seen on each side, so the crop is stable for the
  // whole clip instead of leaving a bar visible in the frames that were not sampled.
  const samples = [0.15, 0.35, 0.55, 0.75, 0.95].map((f) => Math.max(0.2, duration * f));
  let top = 0;
  let bottom = 0;
  let left = 0;
  let right = 0;
  let measured = false;

  for (const at of samples) {
    // One frame as raw 8-bit grayscale: width*height bytes, no decoding library needed.
    const { stdout } = await exec(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-ss', at.toFixed(2), '-i', file,
       '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
      { maxBuffer: 128 * 1024 * 1024, encoding: 'buffer' },
    );
    const gray = stdout as unknown as Buffer;
    if (gray.length < width * height) continue;
    measured = true;

    /** mean and min-max spread of a line of pixels. */
    const line = (count: number, at: (i: number) => number) => {
      let min = 255;
      let max = 0;
      let sum = 0;
      for (let i = 0; i < count; i++) {
        const v = gray[at(i)];
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v;
      }
      return { mean: sum / count, spread: max - min };
    };
    const row = (y: number) => line(width, (x) => y * width + x);
    const col = (x: number) => line(height, (y) => y * width + x);

    // The picture's own brightness, from the middle of the frame — the reference a band has to
    // stand out against. Sampled at three heights so one unusual row cannot skew it.
    const interior = Math.min(
      row(Math.floor(height * 0.35)).mean,
      row(Math.floor(height * 0.5)).mean,
      row(Math.floor(height * 0.65)).mean,
    );
    const isPadding = ({ mean, spread }: { mean: number; spread: number }) =>
      spread <= FLAT && mean >= interior + OVER;

    const scan = (limit: number, get: (k: number) => { mean: number; spread: number }) => {
      let k = 0;
      while (k < limit && isPadding(get(k))) k++;
      return k > 0 ? Math.min(limit, k + INSET) : 0;
    };
    const vLimit = Math.floor(height * MAX);
    const hLimit = Math.floor(width * MAX);
    top = Math.max(top, scan(vLimit, (k) => row(k)));
    bottom = Math.max(bottom, scan(vLimit, (k) => row(height - 1 - k)));
    left = Math.max(left, scan(hLimit, (k) => col(k)));
    right = Math.max(right, scan(hLimit, (k) => col(width - 1 - k)));
  }

  if (!measured) return null;
  if (top + bottom + left + right === 0) return null;
  // Keep dimensions even — yuv420p requires it.
  const even = (n: number) => n - (n % 2);
  const w = even(width - left - right);
  const h = even(height - top - bottom);
  if (w < width * 0.5 || h < height * 0.5) return null; // implausible: leave it alone
  return { width: w, height: h, x: left, y: top };
}

/**
 * Concat clips (re-encoded to uniform params) and trim to `seconds`.
 *
 * Model-baked padding is cropped per clip before scaling — it varies per shot (and propagates
 * into a chained shot through its start frame), so it cannot be a constant. `onNote` reports
 * what was cropped; silent geometry changes are hard to debug later.
 *
 * The result is then scaled to *fill* 1920×1080 rather than fitted-and-padded. Fitting a
 * de-padded ~2:1 clip into 16:9 re-letterboxes it with black bars — trading the model's white
 * bars for our own black ones, which is what happened the first time. Filling costs ~11% off
 * the sides of a wide composition and guarantees an edge-to-edge frame.
 */
export async function concatAndTrim(
  clips: string[],
  seconds: number,
  out: string,
  onNote: (message: string) => void = () => {},
): Promise<void> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'concat-'));
  try {
    const normalized: string[] = [];
    for (let i = 0; i < clips.length; i++) {
      const n = path.join(tmp, `n${i}.mp4`);
      const pad = await detectPadding(clips[i]);
      if (pad) {
        onNote(
          `${path.basename(clips[i])}: cropping baked-in padding to ${pad.width}×${pad.height} at +${pad.x},+${pad.y}`,
        );
      }
      const filters = [
        ...(pad ? [`crop=${pad.width}:${pad.height}:${pad.x}:${pad.y}`] : []),
        // Fill, never fit — see the note above on trading white bars for black ones.
        'scale=1920:1080:force_original_aspect_ratio=increase',
        'crop=1920:1080',
        'fps=25',
      ];
      await ff([
        '-i', clips[i],
        '-vf', filters.join(','),
        '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '21', '-pix_fmt', 'yuv420p',
        n,
      ]);
      normalized.push(n);
    }
    const list = path.join(tmp, 'list.txt');
    await fs.writeFile(list, normalized.map((f) => `file '${f}'`).join('\n'));
    await ff([
      '-f', 'concat', '-safe', '0', '-i', list,
      '-t', seconds.toFixed(2),
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      out,
    ]);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

/**
 * Mux voiceover onto a (silent) video: video padded/frozen to audio+tail,
 * audio padded with silence to the same length.
 */
export async function muxVoiceover(
  video: string,
  audio: string,
  out: string,
  opts?: { tailSeconds?: number },
): Promise<void> {
  const tail = opts?.tailSeconds ?? 1;
  const audioLen = await probeDuration(audio);
  const videoLen = await probeDuration(video);
  const target = Math.max(audioLen + tail, videoLen);
  await ff([
    '-i', video,
    '-i', audio,
    '-filter_complex',
    `[0:v]tpad=stop_mode=clone:stop_duration=${Math.max(0, target - videoLen).toFixed(2)}[v];[1:a]apad[a]`,
    '-map', '[v]', '-map', '[a]',
    '-t', target.toFixed(2),
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k', '-ac', '1',
    '-movflags', '+faststart',
    out,
  ]);
}

export async function webmToMp4(webm: string, out: string): Promise<void> {
  await ff([
    '-i', webm,
    '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=25',
    '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '21', '-pix_fmt', 'yuv420p',
    out,
  ]);
}

/** Downscale an embedded copy if the master is too large. */
export async function compressForEmbed(video: string, out: string): Promise<void> {
  await ff([
    '-i', video,
    '-vf', 'scale=1280:-2',
    '-c:v', 'libx264', '-preset', 'fast', '-crf', '27', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k', '-ac', '1',
    '-movflags', '+faststart',
    out,
  ]);
}

/**
 * Speed up a TTS chunk (pitch-neutral atempo — Venice's `speed` param is ignored by
 * some TTS models), pad it with a short pause, and re-encode to a sane bitrate.
 * Venice returns ~768 kbps MP3s; 128 kbps mono is plenty for speech and keeps the
 * embedded HTML small.
 */
export async function normalizeVoiceChunk(
  input: string,
  out: string,
  opts?: { tempo?: number; padSeconds?: number },
): Promise<number> {
  const tempo = opts?.tempo ?? 1.15;
  const pad = opts?.padSeconds ?? 0.12;
  const filters = [`atempo=${tempo}`];
  if (pad > 0) filters.push(`apad=pad_dur=${pad}`);
  await ff(['-i', input, '-af', filters.join(','), '-b:a', '128k', '-ac', '1', '-ar', '44100', out]);
  return probeDuration(out);
}

/**
 * Concatenate audio chunks in one decode/encode pass. Stream-copy concat of MP3s
 * leaves non-monotonic timestamps, so the filter graph is used instead.
 * Returns the exact duration of the result.
 */
export async function concatAudio(chunks: string[], out: string): Promise<number> {
  const inputs = chunks.flatMap((f) => ['-i', f]);
  const graph = `${chunks.map((_, i) => `[${i}:a]`).join('')}concat=n=${chunks.length}:v=0:a=1[a]`;
  await ff([
    ...inputs,
    '-filter_complex', graph,
    '-map', '[a]',
    '-b:a', '128k', '-ac', '1', '-ar', '44100',
    out,
  ]);
  return probeDuration(out);
}

export async function compressImage(input: string, out: string, width = 1024): Promise<void> {
  await ff(['-i', input, '-vf', `scale=${width}:-2`, '-q:v', '4', out]);
}

/**
 * Fits an image to the 16:9 a video model generates at.
 *
 * Reference images handed to a 16:9 model should already be 16:9: an off-ratio upload makes the
 * model reconcile the mismatch itself, and it does that by baking padding into every frame it
 * generates. Letterboxing the references to 16:9 removed that entirely on a measured run — 7 of
 * 8 shots padded before, 0 of 10 after.
 *
 * `mode` decides how, and it matters:
 * - `'pad'` for a **character** reference — a crop would cut the character the reference exists
 *   to define, so the whole image is kept on a black canvas.
 * - `'crop'` for a **style** reference — a near-square style upload padded to 16:9 is mostly
 *   black, and the model read that as part of the aesthetic and produced grey bars of its own. A
 *   style reference only has to convey palette, light and texture, and any representative region
 *   of it does that, so cropping is free of downside here.
 */
export async function fitTo16x9(
  input: string,
  out: string,
  mode: 'pad' | 'crop' = 'pad',
  width = 1280,
): Promise<void> {
  const height = Math.round(width / (16 / 9));
  const filter =
    mode === 'pad'
      ? `scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
        `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`
      : `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`;
  await ff(['-i', input, '-vf', filter, '-q:v', '3', out]);
}
