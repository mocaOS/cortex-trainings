import 'server-only';
import type { ContentPart, RefKind } from '@cortex-trainings/shared';
import { getVisionVenice } from './clients';

/**
 * Turns uploaded reference images into English prompt fragments, once, at upload time.
 * Everything downstream (curriculum agent, plan extraction, image/video prompts) consumes
 * the extracted text — the raw images are only re-read where a model accepts image input
 * directly (reference image generation, reference-to-video).
 */

const ANALYSIS_SCHEMA = {
  name: 'ref_analysis',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['description'],
    properties: { description: { type: 'string' } },
  },
};

const CHARACTER_PROMPT = `You are given 1–3 reference images of the SAME character. Write one precise ENGLISH description of it, usable verbatim as an image/video-generation prompt fragment, so a model that never saw the images reproduces THIS character recognizably.

Cover, in flowing prose (no headings, no lists): what it is (creature, person, mascot, object), overall shape and proportions, exact colors by name (body, details, glow if any), materials and surface textures, clothing/accessories and their colors, facial features or markings, and any distinguishing detail that makes it identifiable. Describe only what is constant across the images — ignore backgrounds, poses and lighting. Do not mention the images ("in the image", "as shown"), do not address the reader, present tense, one paragraph, under 130 words.`;

const STYLE_PROMPT = `You are given 1–3 reference images that define a visual aesthetic. Write one ENGLISH style description, usable verbatim as a shared style block in image/video-generation prompts, so every generated visual lands in THIS look.

Cover, in flowing prose (no headings, no lists): the medium or render technique (e.g. watercolor, cel-shaded anime, gritty 35mm film, clean 3D render), color palette and grading, lighting character, texture and line quality, composition tendencies, level of detail, and mood. Describe only the aesthetic — NEVER the subjects, objects or scenes depicted, because this text will be applied to entirely different content. Do not mention the images, do not address the reader, present tense, one paragraph, under 110 words.`;

/** Extracts a prompt-ready English description from reference images (data URLs). */
export async function analyzeRefImages(kind: RefKind, dataUrls: string[]): Promise<string> {
  // Without images the vision model happily writes a polite non-answer — refuse instead.
  if (dataUrls.length === 0) throw new Error(`no ${kind} reference images to analyze`);
  const venice = getVisionVenice();
  const content: ContentPart[] = [
    { type: 'text', text: kind === 'character' ? CHARACTER_PROMPT : STYLE_PROMPT },
    ...dataUrls.map((url): ContentPart => ({ type: 'image_url', image_url: { url } })),
  ];
  const { description } = await venice.chatJson<{ description: string }>(
    [{ role: 'user', content }],
    ANALYSIS_SCHEMA,
    { maxTokens: 2048 },
  );
  if (!description?.trim()) throw new Error(`Vision analysis returned an empty ${kind} description`);
  return description.trim();
}
