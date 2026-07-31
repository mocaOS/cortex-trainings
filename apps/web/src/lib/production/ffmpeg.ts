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

/** Concat clips (re-encoded to uniform params) and trim to `seconds`. */
export async function concatAndTrim(clips: string[], seconds: number, out: string): Promise<void> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'concat-'));
  try {
    const normalized: string[] = [];
    for (let i = 0; i < clips.length; i++) {
      const n = path.join(tmp, `n${i}.mp4`);
      await ff([
        '-i', clips[i],
        '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=25',
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
