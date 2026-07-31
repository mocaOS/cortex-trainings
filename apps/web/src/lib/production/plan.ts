import 'server-only';
import type { Briefing, ProductionPlan } from '@cortex-trainings/shared';
import { getVenice } from '../clients';
import { env } from '../env';

const INTERACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'title', 'instruction', 'questions', 'xp'],
  properties: {
    kind: {
      type: 'string',
      enum: ['quiz', 'myth_fact', 'sort_order', 'find_mistakes', 'slider', 'final_check'],
    },
    title: { type: 'string' },
    instruction: { type: 'string' },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'options', 'correctIndex', 'explanation'],
        properties: {
          text: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          correctIndex: { type: 'integer' },
          explanation: { type: 'string' },
        },
      },
    },
    xp: { type: 'integer' },
  },
} as const;

const PLAN_SCHEMA = {
  name: 'production_plan',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'title',
      'language',
      'guideCharacter',
      'styleBlock',
      'accentColor',
      'levels',
      'finalCheck',
      'cheatSheet',
    ],
    properties: {
      title: { type: 'string' },
      language: { type: 'string' },
      guideCharacter: { type: 'string' },
      styleBlock: { type: 'string' },
      accentColor: { type: 'string' },
      levels: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'index',
            'title',
            'keyTakeaway',
            'learningObjective',
            'voiceover',
            'medium',
            'shots',
            'animationBeats',
            'imagePrompt',
            'interaction',
          ],
          properties: {
            index: { type: 'integer' },
            title: { type: 'string' },
            keyTakeaway: { type: 'string' },
            learningObjective: { type: 'string' },
            voiceover: { type: 'string' },
            medium: { type: 'string', enum: ['film', 'animation', 'image'] },
            shots: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['prompt', 'duration'],
                properties: {
                  prompt: { type: 'string' },
                  duration: { type: 'string', enum: ['5s', '10s', '15s'] },
                },
              },
            },
            animationBeats: {
              type: 'array',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['text', 'cue'],
                properties: {
                  text: { type: 'string' },
                  cue: { type: 'string' },
                },
              },
            },
            imagePrompt: { type: 'string' },
            interaction: INTERACTION_SCHEMA,
          },
        },
      },
      finalCheck: INTERACTION_SCHEMA,
      cheatSheet: { type: 'array', items: { type: 'string' } },
    },
  },
} as const;

const EXTRACTION_PROMPT = `You convert an approved training curriculum (markdown) into a machine-readable production plan. Extract faithfully — do NOT invent new content, do NOT rephrase learner-facing text. The curriculum is the binding source.

Rules:
- language: the curriculum's target language code (e.g. "de", "en").
- guideCharacter: precise ENGLISH visual description of the guide character (colors, shape, material, glow), suitable as an image-generation prompt fragment. Never a human.
- styleBlock: one shared ENGLISH style sentence for all image/video prompts (look, lighting, mood) ending with "no readable text, no captions, no speech, nobody talking".
- accentColor: a CSS hex color fitting the training's design (from the curriculum if stated, otherwise pick one matching the topic's tone).
- Per level:
  - voiceover: the exact voiceover script from the curriculum (target language).
  - medium "film": fill shots[] with the English prompts; each shot duration is "5s", "10s" or "15s" — sum should be just above the voiceover length. Prepend nothing; include the styleBlock content yourself in each prompt. animationBeats stays [].
  - medium "animation": fill animationBeats[] from the beat plan (short on-screen text + the voiceover words at which it appears, both in the target language). shots stays [].
  - medium "image": shots and animationBeats stay []; the level's visual is the imagePrompt.
  - imagePrompt: ENGLISH prompt for this level's interaction-screen image ("" if the curriculum plans none).
  - interaction: map the curriculum's interaction to the closest supported kind:
      quiz (multiple choice), myth_fact (statements: options=["Mythos","Fakt"] or target-language equivalents, correctIndex marks the truth), sort_order (options = items in CORRECT order, correctIndex=0), find_mistakes (one question per statement, options=["korrekt","Fehler"] equivalents, correctIndex marks it), slider (one question, options=[], correctIndex=0).
    Keep all texts, options, resolutions and feedback in the target language, verbatim from the curriculum where possible.
- finalCheck: kind "final_check" with all final-check questions (options + correctIndex + explanation from the curriculum's answers).
- cheatSheet: the key takeaways (one string per level, target language).`;

export async function extractPlan(curriculum: string, briefing: Briefing): Promise<ProductionPlan> {
  const venice = getVenice();
  const plan = await venice.chatJson<ProductionPlan>(
    [
      { role: 'system', content: EXTRACTION_PROMPT },
      {
        role: 'user',
        content: `Briefing: audience "${briefing.audience}", language "${briefing.language}", duration "${briefing.duration}".\n\nCurriculum:\n\n${curriculum}`,
      },
    ],
    PLAN_SCHEMA as unknown as { name: string; schema: Record<string, unknown> },
  );
  // The design accent is configuration, not model output.
  plan.accentColor = env.accentColor;
  // Minimal sanity checks — fail loudly rather than produce a broken training.
  if (!plan.levels?.length) throw new Error('Plan extraction produced no levels');
  for (const level of plan.levels) {
    if (level.medium === 'film' && level.shots.length === 0)
      throw new Error(`Level ${level.index}: film without shots`);
    if (level.medium === 'animation' && level.animationBeats.length === 0)
      throw new Error(`Level ${level.index}: animation without beats`);
    if (!level.voiceover?.trim()) throw new Error(`Level ${level.index}: empty voiceover`);
  }
  return plan;
}
