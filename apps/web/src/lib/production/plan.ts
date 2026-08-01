import 'server-only';
import type { Briefing, PlanInteraction, ProductionPlan, ProjectRefs } from '@cortex-trainings/shared';
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
      'pronunciations',
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
                required: ['prompt', 'duration', 'continuesPreviousScene', 'featuresCharacter'],
                properties: {
                  prompt: { type: 'string' },
                  duration: { type: 'string', enum: ['5s', '10s', '15s'] },
                  continuesPreviousScene: { type: 'boolean' },
                  featuresCharacter: { type: 'boolean' },
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
      pronunciations: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['written', 'spoken'],
          properties: {
            written: { type: 'string' },
            spoken: { type: 'string' },
          },
        },
      },
    },
  },
} as const;

function extractionPrompt(refs: ProjectRefs): string {
  const characterRule = refs.character
    ? `- guideCharacter: the user uploaded reference images of the guide character; their analyzed
  description is given below. Restate that description (verbatim in substance) as
  guideCharacter. The character keeps ITS OWN colors exactly as described — do NOT recolor it
  to the accent color, do NOT replace it with an abstract object, and ignore any conflicting
  character description in the curriculum.`
    : `- guideCharacter: precise ENGLISH visual description of the guide character (shape, material,
  facets, glow), suitable as an image-generation prompt fragment. Never a human.
  **Its color is fixed: state the accent color given below as the character's body, glow and
  inner light.** If the curriculum names a different color for the character, IGNORE it and use
  the accent color — the training carries exactly one chromatic color. Do not mention any other
  hue (no green, emerald, amber, red …) anywhere in this description.`;
  const styleRule = refs.style
    ? `- styleBlock: one shared ENGLISH style sentence for all image/video prompts. It MUST restate
  the aesthetic given below — extracted from the user's style reference images — verbatim in
  substance, ending with "no readable text, no captions, no speech, nobody talking". Do not
  substitute a different look and do not inject colors the aesthetic does not name.`
    : `- styleBlock: one shared ENGLISH style sentence for all image/video prompts. It MUST restate
  the visual style given below (verbatim in substance) and name the accent color as the single
  highlight color, ending with "no readable text, no captions, no speech, nobody talking".
  Do not substitute a different look, however well it might suit the topic.`;

  return `You convert an approved training curriculum (markdown) into a machine-readable production plan. Extract faithfully — do NOT invent new content, do NOT rephrase learner-facing text. The curriculum is the binding source.

Rules:
- language: the curriculum's target language code (e.g. "de", "en").
${characterRule}
${styleRule}
- accentColor: echo the accent color given below verbatim. It is configuration, not a choice.
- Per level:
  - voiceover: the exact voiceover script from the curriculum (target language).
  - medium "film": fill shots[] with the English prompts; each shot duration is "5s", "10s" or "15s" — sum should be just above the voiceover length. Prepend nothing; include the styleBlock content yourself in each prompt. animationBeats stays [].
    Set continuesPreviousScene on every shot: true only when the shot stays in the SAME place with the SAME subject and the action simply carries on (a camera move, a closer angle, the next moment). Set it false for the first shot and for any cut to a different location, subject or time — a forest that becomes a showroom is a cut, not a continuation. Getting this wrong makes the video morph one setting into another inside a single clip.
    **Never mark more than two shots in a row as continuations.** A continuation is generated from the previous clip's last frame, so it inherits that frame's drift and gets no composition of its own; a long chain hands one generated frame control of a whole film and every step after it compounds the error. If three consecutive shots would continue, make the third a cut — find the genuine change of angle, place or moment in the narration and put it there.
    Set featuresCharacter on every shot — **the storyboard decides this, not the character**. Two hard rules, then the judgement call:
      1. **The FIRST shot of every film MUST have featuresCharacter: false.** Establish the place, the situation or the stakes before any character appears. No exceptions unless the curriculum's own text puts the guide on screen in the opening second.
      2. **At least half of a film's shots MUST have featuresCharacter: false** — in a 4-shot film that is at least 2, in a 3-shot film at least 2, in a 6-shot film at least 3. Count them before you answer.
    Beyond that: true only where the guide genuinely serves the shot (acting, reacting, giving human scale); false for establishing shots, close details of objects, environments, processes and abstract concept imagery. A guide in every shot reads as a mascot parade and flattens the storytelling, and the shots that do carry it are stronger for the contrast. A character-free shot is NOT a lesser shot: it carries the same styleBlock, so it stays in exactly the same visual world.
    In a character-free shot's prompt, do not mention the guide character at all — no hooded figure, no silhouette, no lone wanderer, not even distant or out of focus. Describe the world, the objects, the light and the camera. Describe the world, the objects, the light and the camera.
  - medium "animation": fill animationBeats[] from the beat plan (short on-screen text + the voiceover words at which it appears, both in the target language). shots stays [].
  - medium "image": shots and animationBeats stay []; the level's visual is the imagePrompt.
  - imagePrompt: ENGLISH prompt for this level's interaction-screen image ("" if the curriculum plans none).
  - interaction: map the curriculum's interaction to the closest supported kind:
      quiz (multiple choice, one correct), myth_fact (statements: options=["Mythos","Fakt"] or target-language equivalents, correctIndex marks the truth), sort_order (options = items in CORRECT order, correctIndex=0; **strip any ordinal or temporal label that gives the order away** — "Day 1 — Start in the cloud" becomes "Start in the cloud", and drop leading numbering entirely, because a learner must reason about the sequence rather than read it off the labels), find_mistakes (one question per statement, options=["korrekt","Fehler"] equivalents, correctIndex marks it), slider (one question, options=[], correctIndex=0), match_pairs (see below).
    **Use match_pairs for any "drag & drop into categories", matching, or assignment exercise** — one question per ITEM, where text = the item, options = the FULL list of categories (identical in every question of that interaction), and correctIndex = that item's category. Do NOT flatten a matching exercise into a quiz: with one shared option list, independent multiple-choice questions become solvable by elimination and the exercise loses its point.
    Two quality rules for match_pairs: (a) never let an item name its own category — "Sales folders in Google Drive" paired with "Google Drive Sync" teaches nothing, so phrase each item by what it IS ("the sales team's shared folders"), not by where it lives; (b) put the overall resolution in the explanation of the FIRST question — only that one is shown, so do not rely on per-item copies.
    Keep all texts, options, resolutions and feedback in the target language, verbatim from the curriculum where possible.
- finalCheck: kind "final_check" with the curriculum's final-check questions (options + correctIndex + explanation from its answer key). If a final-check question merely repeats a level interaction's question, keep the curriculum's wording but prefer its more applied variants — never invent new subject matter, and never pad the list with copies of level questions.
  **The final check lives ONLY in finalCheck.** Curricula often present it as the last level's
  interaction ("Level 6 interaction — final check"). That is a presentation detail: reproduce
  those questions in finalCheck, and give that level its OWN distinct interaction of a different
  kind, taken from whatever exercise material the curriculum offers for it. Never emit the same
  questions as both a level interaction and finalCheck — the training renders both screens, so
  the learner would answer the identical set twice in a row. If the curriculum genuinely leaves
  that level no exercise of its own, emit its interaction with an empty questions array rather
  than copying the final check.
- Option counts: a "quiz" question needs at least 3 options, and every distractor must be one a
  real learner might believe. Two-option quizzes are a coin flip — if the curriculum wrote a
  scenario with two buttons, add the plausible third reading it omitted rather than shipping a
  50/50 guess. Only the inherently binary forms (myth_fact, find_mistakes) carry exactly two.
- **Every level needs a check the learner can get wrong.** "slider" is self-assessment with no
  correct answer, so it must never be a level's only interaction — least of all the first level's,
  which is where comprehension is established. If the curriculum offers a level nothing but a
  self-assessment, convert its material into the closest graded kind (quiz, myth_fact,
  find_mistakes, sort_order or match_pairs) using that level's own content. A slider is worth
  keeping as a change of pace only where a level's graded check lives elsewhere.
- cheatSheet: the key takeaways (one string per level, target language).
- pronunciations: respellings for terms a text-to-speech engine would read out wrong. The voiceover
  text is SPOKEN, never displayed, so the written spelling must stay canonical everywhere while the
  spoken form is fixed here. List every term in the voiceover scripts that a TTS engine would
  mangle:
    - names containing digits or leetspeak ("DeCC0s" is said "Decos", not "dee-see-see-zero-ess")
    - unusual internal capitalisation, invented product names, non-obvious foreign words
    - acronyms meant to be said as a word rather than spelled out
  **Check the briefing for the answer first** — a user who writes 'Art DeCC0s (pronounced art
  decos)' has told you exactly what to emit, and that parenthetical is an instruction to you, not
  learner-facing copy.
  \`written\` must appear in the voiceover text EXACTLY as written there, because it is matched
  literally. Emit the longest form as its own entry when a term has several ("DeCC0s" and "DeCC0"
  both, not just the stem).
  **Do not "fix" a term that is already pronounced correctly by spelling it out.** In "CC0 — no
  copyright", CC0 is the licence and "see-see-zero" is right; only the brand name built on top of
  it is wrong. Adding a rule for CC0 would break the sentence that explains it.
  Emit [] when nothing needs it, which is the common case.`;
}

export async function extractPlan(
  curriculum: string,
  briefing: Briefing,
  refs: ProjectRefs = {},
  /** Reports plan-quality observations that are worth seeing but must not fail the step. */
  onNote: (message: string) => void = () => {},
): Promise<ProductionPlan> {
  const venice = getVenice();
  const accentScope = refs.character
    ? `Accent color (the training's ONLY chromatic color for UI, animations and highlights — ` +
      `the user-supplied guide character keeps its own colors): ${env.accentColor}\n\n`
    : `Accent color (the training's ONLY chromatic color, use it for the guide character ` +
      `and every style reference): ${env.accentColor}\n\n`;
  const styleSource = refs.style
    ? `Visual aesthetic for ALL film and image prompts (extracted from the user's uploaded ` +
      `style reference images — binding):\n${refs.style.description}\n\n`
    : `Visual style for ALL film and image prompts, including the guide character:\n` +
      `${visualStylePrompt(briefing.visualStyle)}\n\n`;
  const characterSource = refs.character
    ? `Guide character (analyzed from the user's uploaded reference images — binding):\n` +
      `${refs.character.description}\n\n`
    : '';
  const plan = await venice.chatJson<ProductionPlan>(
    [
      { role: 'system', content: extractionPrompt(refs) },
      {
        role: 'user',
        content:
          accentScope +
          styleSource +
          characterSource +
          `Briefing: audience "${briefing.audience}", language "${briefing.language}", ` +
          `duration "${briefing.duration}".\n\nCurriculum:\n\n${curriculum}`,
      },
    ],
    PLAN_SCHEMA as unknown as { name: string; schema: Record<string, unknown> },
  );
  // The design accent is configuration, not model output.
  plan.accentColor = env.accentColor;
  // Belt and braces: if a topic-derived hue survived the prompt, restate the accent so the
  // image models still get an unambiguous instruction. A user-supplied character is exempt —
  // it keeps its own colors by design.
  if (!refs.character && !plan.guideCharacter.includes(env.accentColor)) {
    plan.guideCharacter = `${plan.guideCharacter.trim().replace(/\.$/, '')}. The character's body, glow and inner light are exactly the color ${env.accentColor} — no other hue.`;
  }
  // Deterministic backstop for ordering tasks: a leading "Day 1 —" / "Step 2:" / "3." makes the
  // sequence readable off the labels, so the exercise stops testing anything. Prompts ask for
  // this too; stripping here guarantees it.
  const ORDINAL_PREFIX =
    /^\s*(?:(?:day|tag|step|schritt|month|monat|week|woche|phase|year|jahr|stage|stufe)\s*\d+|\d+)\s*(?:[-—–:.)]|\bof\b)\s*/i;
  for (const level of plan.levels) {
    if (level.interaction?.kind !== 'sort_order') continue;
    for (const question of level.interaction.questions) {
      question.options = question.options.map((option) => {
        const stripped = option.replace(ORDINAL_PREFIX, '').trim();
        // Only accept the strip if something substantive survives.
        return stripped.length > 8 ? stripped : option;
      });
    }
  }

  // Deterministic backstop for the film opening. Conditioning the first shot on the character
  // reference makes every film open on the same hero portrait of the guide, which is what the
  // reference image happens to be. The prompt asks for a character-free opening; a measured run
  // still opened on the character, so enforce it here.
  //
  // The flag is only flipped when the prompt does not actually describe the guide: generating a
  // shot without character references while its prompt still asks for the character would invent
  // a different one, which is worse than the problem being fixed. When the prompt does describe
  // it, say so instead of silently doing nothing.
  const CHARACTER_WORDS =
    /\b(guide|character|mascot|figure|wanderer|hooded|silhouette|orb|crystal|cube|prism|protagonist|he |she |his |her )/i;
  for (const level of plan.levels) {
    const first = level.shots[0];
    if (!first || first.featuresCharacter === false) continue;
    if (CHARACTER_WORDS.test(first.prompt)) {
      onNote(
        `level ${level.index}: the opening shot is written around the guide character — it will open on it. ` +
          `An establishing shot without the guide reads better.`,
      );
      continue;
    }
    first.featuresCharacter = false;
    onNote(`level ${level.index}: opening shot set to character-free — it establishes the scene`);
  }

  // Deterministic backstop for the duplicated final check. Curricula routinely present the final
  // check as the last level's interaction, and the template renders level interactions AND the
  // final check as separate screens — so a copy means answering the identical set twice in a row.
  // The prompt forbids it; stripping here guarantees it.
  const fingerprint = (i: PlanInteraction) =>
    i.questions.map((q) => q.text.trim()).join(' ');
  const finalPrint = fingerprint(plan.finalCheck);
  for (const level of plan.levels) {
    if (!level.interaction) continue;
    const empty = level.interaction.questions.length === 0;
    const duplicate = plan.finalCheck.questions.length > 0 && fingerprint(level.interaction) === finalPrint;
    if (empty || duplicate) {
      level.interaction = null;
      onNote(
        `level ${level.index}: ${duplicate ? 'interaction duplicated the final check' : 'empty interaction'} — dropped, the level now leads straight into the final check`,
      );
    }
  }

  // Quality notes — visible, but not worth failing a paid production run over.
  const kinds = new Map<string, number[]>();
  for (const level of plan.levels) {
    if (!level.interaction) continue;
    kinds.set(level.interaction.kind, [
      ...(kinds.get(level.interaction.kind) ?? []),
      level.index,
    ]);
    const thin =
      level.interaction.kind === 'quiz'
        ? level.interaction.questions.filter((q) => q.options.length < 3).length
        : 0;
    if (thin > 0)
      onNote(
        `level ${level.index}: ${thin} quiz question(s) with fewer than 3 options — a 50/50 guess`,
      );
  }
  for (const [kind, levels] of kinds) {
    if (levels.length > 1)
      onNote(`interaction "${kind}" repeats on levels ${levels.join(', ')} — variety is the point`);
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
