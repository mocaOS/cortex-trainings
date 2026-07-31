/**
 * Venice media APIs: image, TTS, STT, async video.
 * Request shapes verified against docs.venice.ai/swagger.yaml (2026-07-31).
 */

export interface VeniceMediaOptions {
  apiKey: string;
  baseUrl?: string;
}

export interface ImageGenerateParams {
  model: string;
  prompt: string;
  /** e.g. "16:9" — used by aspect-ratio models like gpt-image-2 / nano-banana. */
  aspectRatio?: string;
  /** e.g. "1K" | "2K" | "4K" for resolution-tier models. */
  resolution?: string;
  quality?: 'low' | 'medium' | 'high';
  /** Pixel-model sizing (venice-sd35, qwen-image, …). */
  width?: number;
  height?: number;
  variants?: number;
  negativePrompt?: string;
  format?: 'jpeg' | 'png' | 'webp';
}

export interface TtsParams {
  model: string;
  input: string;
  voice: string;
  speed?: number;
  responseFormat?: 'mp3' | 'wav' | 'flac' | 'aac' | 'opus' | 'pcm';
  language?: string;
}

export interface SttSegment {
  start: number;
  end: number;
  text: string;
}

export interface SttResult {
  text: string;
  duration?: number;
  segments: SttSegment[];
}

export interface VideoQueueParams {
  model: string;
  prompt: string;
  duration: string; // "5s" | "10s" | "15s" — model-specific
  resolution?: string; // "1080p" | "720p"
  aspectRatio?: string;
  audio?: boolean;
  negativePrompt?: string;
  /** Start frame for image-to-video (URL or data URL). */
  imageUrl?: string;
  /** Character/style consistency references (URLs or data URLs, up to 9). */
  referenceImageUrls?: string[];
}

export class VeniceMedia {
  private apiKey: string;
  private baseUrl: string;

  constructor(opts: VeniceMediaOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? 'https://api.venice.ai/api/v1').replace(/\/$/, '');
  }

  private headers(json = true): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    };
  }

  private async fail(res: Response, what: string): Promise<never> {
    const body = await res.text().catch(() => '');
    if (res.status === 402) {
      throw new Error(`Venice ${what}: insufficient balance (HTTP 402).`);
    }
    throw new Error(`Venice ${what} → ${res.status}: ${body.slice(0, 500)}`);
  }

  /**
   * Retries transient failures. Venice answers 500 under concurrent load, and 429
   * carries Retry-After; both are worth waiting out rather than failing a whole run.
   */
  private async withRetry(
    what: string,
    attempt: (n: number) => Promise<Response>,
    tries = 4,
  ): Promise<Response> {
    let lastStatus = 0;
    for (let n = 0; n < tries; n++) {
      const res = await attempt(n);
      if (res.ok) return res;
      lastStatus = res.status;
      const transient = res.status === 429 || res.status >= 500;
      if (!transient || n === tries - 1) return res;
      const retryAfter = Number(res.headers.get('Retry-After') ?? '0');
      const backoff = retryAfter > 0 ? retryAfter * 1000 : Math.min(2000 * 2 ** n, 20000);
      await new Promise((r) => setTimeout(r, backoff));
    }
    throw new Error(`Venice ${what}: exhausted retries (last status ${lastStatus})`);
  }

  /** Returns base64-encoded images (one per variant). */
  async imageGenerate(params: ImageGenerateParams): Promise<string[]> {
    const body: Record<string, unknown> = {
      model: params.model,
      prompt: params.prompt,
      format: params.format ?? 'jpeg',
      safe_mode: false,
      hide_watermark: true,
    };
    if (params.aspectRatio) body.aspect_ratio = params.aspectRatio;
    if (params.resolution) body.resolution = params.resolution;
    if (params.quality) body.quality = params.quality;
    if (params.width) body.width = params.width;
    if (params.height) body.height = params.height;
    if (params.variants) body.variants = params.variants;
    if (params.negativePrompt) body.negative_prompt = params.negativePrompt;

    const res = await fetch(`${this.baseUrl}/image/generate`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) await this.fail(res, 'image/generate');
    const json = (await res.json()) as any;
    return json.images ?? [];
  }

  /** Returns raw audio bytes. */
  async tts(params: TtsParams): Promise<Buffer> {
    const body = JSON.stringify({
      model: params.model,
      input: params.input,
      voice: params.voice,
      speed: params.speed ?? 1,
      response_format: params.responseFormat ?? 'mp3',
      ...(params.language ? { language: params.language } : {}),
      streaming: false,
    });
    const res = await this.withRetry('audio/speech', () =>
      fetch(`${this.baseUrl}/audio/speech`, { method: 'POST', headers: this.headers(), body }),
    );
    if (!res.ok) await this.fail(res, 'audio/speech');
    return Buffer.from(await res.arrayBuffer());
  }

  /** Transcribe with segment timestamps. */
  async stt(params: {
    model: string;
    audio: Buffer;
    filename: string;
    language?: string;
  }): Promise<SttResult> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(params.audio)]), params.filename);
    form.append('model', params.model);
    form.append('response_format', 'json');
    form.append('timestamps', 'true');
    if (params.language) form.append('language', params.language);

    const res = await fetch(`${this.baseUrl}/audio/transcriptions`, {
      method: 'POST',
      headers: this.headers(false),
      body: form,
    });
    if (!res.ok) await this.fail(res, 'audio/transcriptions');
    const json = (await res.json()) as any;

    // Timestamp shape is model-dependent — normalize segments/words defensively.
    const segments: SttSegment[] = [];
    const ts = json.timestamps ?? {};
    const rawSegments = ts.segment ?? ts.segments ?? json.segments ?? [];
    for (const s of rawSegments) {
      segments.push({ start: Number(s.start ?? 0), end: Number(s.end ?? 0), text: String(s.text ?? '') });
    }
    if (segments.length === 0) {
      const words = ts.word ?? ts.words ?? json.words ?? [];
      // Group words into ~sentence segments when only word timestamps exist.
      let cur: { start: number; end: number; text: string } | null = null;
      for (const w of words) {
        const word = String(w.word ?? w.text ?? '');
        if (!cur) cur = { start: Number(w.start ?? 0), end: Number(w.end ?? 0), text: word };
        else {
          cur.text += (word.startsWith("'") ? '' : ' ') + word;
          cur.end = Number(w.end ?? cur.end);
        }
        if (/[.!?]$/.test(word)) {
          segments.push(cur);
          cur = null;
        }
      }
      if (cur) segments.push(cur);
    }
    return { text: json.text ?? '', duration: json.duration, segments };
  }

  async videoQuote(params: {
    model: string;
    duration: string;
    resolution?: string;
    aspectRatio?: string;
    audio?: boolean;
  }): Promise<number> {
    const res = await fetch(`${this.baseUrl}/video/quote`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        model: params.model,
        duration: params.duration,
        ...(params.resolution ? { resolution: params.resolution } : {}),
        ...(params.aspectRatio ? { aspect_ratio: params.aspectRatio } : {}),
        ...(params.audio !== undefined ? { audio: params.audio } : {}),
      }),
    });
    if (!res.ok) await this.fail(res, 'video/quote');
    const json = (await res.json()) as any;
    return Number(json.quote);
  }

  async videoQueue(params: VideoQueueParams): Promise<{ queueId: string; downloadUrl?: string }> {
    const body: Record<string, unknown> = {
      model: params.model,
      prompt: params.prompt,
      duration: params.duration,
      ...(params.audio !== undefined ? { audio: params.audio } : {}),
    };
    if (params.resolution) body.resolution = params.resolution;
    if (params.aspectRatio) body.aspect_ratio = params.aspectRatio;
    if (params.negativePrompt) body.negative_prompt = params.negativePrompt;
    if (params.imageUrl) body.image_url = params.imageUrl;
    if (params.referenceImageUrls?.length) body.reference_image_urls = params.referenceImageUrls;

    const res = await fetch(`${this.baseUrl}/video/queue`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    if (!res.ok) await this.fail(res, 'video/queue');
    const json = (await res.json()) as any;
    return { queueId: json.queue_id, downloadUrl: json.download_url };
  }

  /**
   * Polls /video/retrieve until the video is ready, then returns the MP4 bytes.
   * The endpoint answers JSON {status: PROCESSING} or the video itself.
   */
  async videoAwait(params: {
    model: string;
    queueId: string;
    onProgress?: (msg: string) => void;
    pollIntervalMs?: number;
    timeoutMs?: number;
  }): Promise<Buffer> {
    const started = Date.now();
    const timeout = params.timeoutMs ?? 30 * 60 * 1000;
    const interval = params.pollIntervalMs ?? 10000;
    for (;;) {
      if (Date.now() - started > timeout) {
        throw new Error(`Venice video ${params.queueId}: timed out after ${timeout / 1000}s`);
      }
      const res = await fetch(`${this.baseUrl}/video/retrieve`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ model: params.model, queue_id: params.queueId }),
      });
      if (!res.ok) await this.fail(res, 'video/retrieve');
      const ctype = res.headers.get('content-type') ?? '';
      if (ctype.includes('application/json')) {
        const json = (await res.json()) as any;
        if (json.status === 'PROCESSING') {
          const eta = json.average_execution_time
            ? ` (~${Math.round(json.average_execution_time / 1000)}s typical)`
            : '';
          params.onProgress?.(
            `processing ${Math.round((json.execution_duration ?? 0) / 1000)}s${eta}`,
          );
          await new Promise((r) => setTimeout(r, interval));
          continue;
        }
        if (json.status === 'COMPLETED' && json.download_url) {
          const dl = await fetch(json.download_url);
          if (!dl.ok) await this.fail(dl, 'video download');
          return Buffer.from(await dl.arrayBuffer());
        }
        throw new Error(`Venice video/retrieve: unexpected response ${JSON.stringify(json).slice(0, 300)}`);
      }
      // Binary response = the finished video.
      return Buffer.from(await res.arrayBuffer());
    }
  }

  async videoComplete(model: string, queueId: string): Promise<void> {
    await fetch(`${this.baseUrl}/video/complete`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model, queue_id: queueId }),
    }).catch(() => {});
  }
}
