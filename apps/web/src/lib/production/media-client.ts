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
  /** First shot: character-consistent reference-to-video. */
  videoReference: process.env.VENICE_VIDEO_MODEL ?? 'wan-2-7-reference-to-video',
  /** Follow-up shots: start-frame chaining. */
  videoChain: process.env.VENICE_VIDEO_CHAIN_MODEL ?? 'wan-2-7-image-to-video',
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
