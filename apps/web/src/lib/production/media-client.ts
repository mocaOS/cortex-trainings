import 'server-only';
import { VeniceMedia } from '@cortex-trainings/shared';
import { env } from '../env';

let media: VeniceMedia | null = null;

export function getMedia(): VeniceMedia {
  media ??= new VeniceMedia({ apiKey: env.veniceApiKey, baseUrl: env.veniceBaseUrl });
  return media;
}

export const mediaModels = {
  image: process.env.VENICE_IMAGE_MODEL ?? 'gpt-image-2',
  /**
   * Builds every generated still: the guide-character anchor, each shot's start frame and the
   * interaction-screen images, all through `/image/multi-edit` when the project has reference
   * uploads.
   *
   * This model decides how a training looks, and it is the cheap half of the pipeline — a frame
   * costs a few percent of the shot it seeds, and a bad frame can simply be regenerated where a
   * bad clip cannot. Pick the strongest option, not the cheapest. Not every edit model fits:
   * `luma-uni-1-max-edit` accepts a single input image, `grok-imagine-quality-edit` and
   * `qwen-image-2-pro-edit` cap at three, and `wan-2-7-pro-edit` and `gpt-image-1-5-edit` reject
   * `aspect_ratio: "16:9"` outright — this flow needs four-plus inputs at 16:9.
   */
  imageEdit: process.env.VENICE_IMAGE_EDIT_MODEL ?? 'gpt-image-2-edit',
  /**
   * The one video model films use. Every shot is generated from a start frame — a continuation
   * from the previous clip's last frame, everything else from a frame built by the image model —
   * so there is no longer a reference-to-video or text-to-video role to configure.
   *
   * `VENICE_VIDEO_MODEL` still selects the *family*: its `-reference-to-video` or
   * `-text-to-video` suffix is swapped for `-image-to-video`, because one film must not mix
   * families (a Wan clip beside a MiniMax clip differs in resolution, frame rate and grade, and
   * the cut is visible). `VENICE_VIDEO_CHAIN_MODEL` overrides the result outright.
   */
  get videoChain(): string {
    const explicit = process.env.VENICE_VIDEO_CHAIN_MODEL;
    if (explicit) return explicit;
    const configured = process.env.VENICE_VIDEO_MODEL;
    if (configured) return configured.replace(/-(?:reference|text)-to-video$/, '-image-to-video');
    return 'wan-2-7-image-to-video';
  },
  stt: process.env.VENICE_STT_MODEL ?? 'openai/whisper-large-v3',
  ttsFor(language: string): { model: string; voice: string } {
    const lang = language.toLowerCase().slice(0, 2);
    if (lang === 'de') {
      return {
        model: process.env.VENICE_TTS_MODEL_DE ?? 'tts-gradium-v1',
        voice: process.env.VENICE_TTS_VOICE_DE ?? 'Maximilian',
      };
    }
    return {
      model: process.env.VENICE_TTS_MODEL_EN ?? 'tts-elevenlabs-turbo-v2-5',
      voice: process.env.VENICE_TTS_VOICE_EN ?? 'Rachel',
    };
  },
  /**
   * Applied via ffmpeg atempo, not Venice's `speed` param — tts-gradium-v1 ignores
   * `speed` entirely (verified: 1.0/1.15/1.4 all return the same duration).
   */
  ttsTempo: Number(process.env.TTS_TEMPO ?? '1.15'),
  /**
   * A *preference*, not a default: video models disagree on what they accept (Wan 2.7 offers
   * 1080p/720p, MiniMax H3 only 2K), so the films step resolves it against the model's live
   * catalog entry and falls back to what that model offers. Leave unset to always take the
   * model's own best option.
   */
  videoResolution: process.env.VENICE_VIDEO_RESOLUTION,
};
