import 'server-only';
import type { Briefing, ProductionPlan } from '@cortex-trainings/shared';
import { visualStylePrompt } from '@cortex-trainings/shared';
import { getVenice } from '../clients';
import { env } from '../env';

const INTERACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'title', 'instruction', 'questions', 'xp'],
  properties: {
    kind: {
      type: 'string',
      enum: ['quiz', 'myth_fact', 'sort_order', 'find_mistakes', 'slider', 'match_pairs', 'final_check'],
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
                required: ['prompt', 'duration', 'continuesPreviousScene'],
                properties: {
                  prompt: { type: 'string' },
                  duration: { type: 'string', enum: ['5s', '10s', '15s'] },
                  continuesPreviousScene: { type: 'boolean' },
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
- guideCharacter: precise ENGLISH visual description of the guide character (shape, material,
  facets, glow), suitable as an image-generation prompt fragment. Never a human.
  **Its color is fixed: state the accent color given below as the character's body, glow and
  inner light.** If the curriculum names a different color for the character, IGNORE it and use
  the accent color — the training carries exactly one chromatic color. Do not mention any other
  hue (no green, emerald, amber, red …) anywhere in this description.
- styleBlock: one shared ENGLISH style sentence for all image/video prompts. It MUST restate
  the visual style given below (verbatim in substance) and name the accent color as the single
  highlight color, ending with "no readable text, no captions, no speech, nobody talking".
  Do not substitute a different look, however well it might suit the topic.
- accentColor: echo the accent color given below verbatim. It is configuration, not a choice.
- Per level:
  - voiceover: the exact voiceover script from the curriculum (target language).
  - medium "film": fill shots[] with the English prompts; each shot duration is "5s", "10s" or "15s" — sum should be just above the voiceover length. Prepend nothing; include the styleBlock content yourself in each prompt. animationBeats stays [].
    Set continuesPreviousScene on every shot: true only when the shot stays in the SAME place with the SAME subject and the action simply carries on (a camera move, a closer angle, the next moment). Set it false for the first shot and for any cut to a different location, subject or time — a forest that becomes a showroom is a cut, not a continuation. Getting this wrong makes the video morph one setting into another inside a single clip.
  - medium "animation": fill animationBeats[] from the beat plan (short on-screen text + the voiceover words at which it appears, both in the target language). shots stays [].
  - medium "image": shots and animationBeats stay []; the level's visual is the imagePrompt.
  - imagePrompt: ENGLISH prompt for this level's interaction-screen image ("" if the curriculum plans none).
  - interaction: map the curriculum's interaction to the closest supported kind:
      quiz (multiple choice, one correct), myth_fact (statements: options=["Mythos","Fakt"] or target-language equivalents, correctIndex marks the truth), sort_order (options = items in CORRECT order, correctIndex=0; **strip any ordinal or temporal label that gives the order away** — "Day 1 — Start in the cloud" becomes "Start in the cloud", and drop leading numbering entirely, because a learner must reason about the sequence rather than read it off the labels), find_mistakes (one question per statement, options=["korrekt","Fehler"] equivalents, correctIndex marks it), slider (one question, options=[], correctIndex=0), match_pairs (see below).
    **Use match_pairs for any "drag & drop into categories", matching, or assignment exercise** — one question per ITEM, where text = the item, options = the FULL list of categories (identical in every question of that interaction), and correctIndex = that item's category. Do NOT flatten a matching exercise into a quiz: with one shared option list, independent multiple-choice questions become solvable by elimination and the exercise loses its point.
    Two quality rules for match_pairs: (a) never let an item name its own category — "Sales folders in Google Drive" paired with "Google Drive Sync" teaches nothing, so phrase each item by what it IS ("the sales team's shared folders"), not by where it lives; (b) put the overall resolution in the explanation of the FIRST question — only that one is shown, so do not rely on per-item copies.
    Keep all texts, options, resolutions and feedback in the target language, verbatim from the curriculum where possible.
- finalCheck: kind "final_check" with the curriculum's final-check questions (options + correctIndex + explanation from its answer key). If a final-check question merely repeats a level interaction's question, keep the curriculum's wording but prefer its more applied variants — never invent new subject matter, and never pad the list with copies of level questions.
- cheatSheet: the key takeaways (one string per level, target language).`;

export async function extractPlan(curriculum: string, briefing: Briefing): Promise<ProductionPlan> {
  const venice = getVenice();
  const plan = await venice.chatJson<ProductionPlan>(
    [
      { role: 'system', content: EXTRACTION_PROMPT },
      {
        role: 'user',
        content:
          `Accent color (the training's ONLY chromatic color, use it for the guide character ` +
          `and every style reference): ${env.accentColor}\n\n` +
          `Visual style for ALL film and image prompts, including the guide character:\n` +
          `${visualStylePrompt(briefing.visualStyle)}\n\n` +
          `Briefing: audience "${briefing.audience}", language "${briefing.language}", ` +
          `duration "${briefing.duration}".\n\nCurriculum:\n\n${curriculum}`,
      },
    ],
    PLAN_SCHEMA as unknown as { name: string; schema: Record<string, unknown> },
  );
  // The design accent is configuration, not model output.
  plan.accentColor = env.accentColor;
  // Belt and braces: if a topic-derived hue survived the prompt, restate the accent so the
  // image models still get an unambiguous instruction.
  if (!plan.guideCharacter.includes(env.accentColor)) {
    plan.guideCharacter = `${plan.guideCharacter.trim().replace(/\.$/, '')}. The character's body, glow and inner light are exactly the color ${env.accentColor} — no other hue.`;
  }
  // Deterministic backstop for ordering tasks: a leading "Day 1 —" / "Step 2:" / "3." makes the
  // sequence readable off the labels, so the exercise stops testing anything. Prompts ask for
  // this too; stripping here guarantees it.
  const ORDINAL_PREFIX =
    /^\s*(?:(?:day|tag|step|schritt|month|monat|week|woche|phase|year|jahr|stage|stufe)\s*\d+|\d+)\s*(?:[-—–:.)]|\bof\b)\s*/i;
  for (const level of plan.levels) {
    if (level.interaction.kind !== 'sort_order') continue;
    for (const question of level.interaction.questions) {
      question.options = question.options.map((option) => {
        const stripped = option.replace(ORDINAL_PREFIX, '').trim();
        // Only accept the strip if something substantive survives.
        return stripped.length > 8 ? stripped : option;
      });
    }
  }

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
