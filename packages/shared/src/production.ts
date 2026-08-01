/** Structured production plan extracted from curriculum.md, and runner state. */

export type MediumKind = 'film' | 'animation' | 'image';

export type InteractionKind =
  | 'quiz' // multiple choice, one correct
  | 'myth_fact' // flip cards, each statement myth or fact
  | 'sort_order' // bring items into the right order
  | 'find_mistakes' // click the wrong statements among correct ones
  | 'slider' // self-assessment, no wrong answer
  | 'match_pairs' // assign each item to its category (drag & drop / tap to assign)
  | 'final_check'; // 8–10 mixed questions

export interface PlanInteraction {
  kind: InteractionKind;
  title: string;
  /** Instruction shown to the learner, in the target language. */
  instruction: string;
  /**
   * quiz/final_check: questions with options, correctIndex, explanation.
   * myth_fact: statements with isFact + explanation.
   * sort_order: items in CORRECT order + explanation.
   * find_mistakes: statements with isMistake + explanation.
   * slider: single question, no correct answer.
   */
  questions: Array<{
    text: string;
    options: string[];
    correctIndex: number;
    explanation: string;
  }>;
  xp: number;
}

export interface PlanShot {
  /** English Seedance-style prompt incl. style block, no readable text. */
  prompt: string;
  /** "5s" | "10s" | "15s" — chained shots sum just above the voiceover length. */
  duration: string;
  /**
   * True when this shot continues the previous one's scene (same place, continuing action),
   * so it can be generated from its last frame. False for a cut to a new location — chaining
   * across a scene change forces the model to morph one setting into another mid-clip.
   */
  continuesPreviousScene?: boolean;
  /**
   * Whether the guide character appears in this shot. False keeps the character out entirely:
   * the shot is generated without character references, so establishing shots, details and
   * concept imagery are free of it. The story decides — a character in every single shot reads
   * as a mascot parade and costs the storyboard its flexibility, while the shared style block
   * keeps a character-free shot in the same visual world.
   */
  featuresCharacter?: boolean;
}

export interface PlanAnimationBeat {
  /** On-screen text of this beat (target language), short. */
  text: string;
  /** Voiceover cue: the words at which this beat appears. */
  cue: string;
}

export interface PlanLevel {
  index: number;
  title: string;
  keyTakeaway: string;
  learningObjective: string;
  voiceover: string;
  medium: MediumKind;
  /** film: the shot chain. */
  shots: PlanShot[];
  /** animation: title + beats. */
  animationBeats: PlanAnimationBeat[];
  /** image (or film/animation context screen): English prompt. */
  imagePrompt: string;
  /**
   * null when this level has no interaction of its own — the case when the curriculum used the
   * final check as the last level's exercise. Plan extraction strips such a duplicate so the
   * learner is not asked the same questions twice; the training then goes straight from this
   * level's media screen to the final check.
   */
  interaction: PlanInteraction | null;
}

/**
 * A term whose written form the TTS engine would mispronounce, and how to spell it so it is *said*
 * correctly. Applied to voiceover text on its way to TTS and nowhere else — the written spelling
 * stays canonical everywhere a learner can read it.
 */
export interface PlanPronunciation {
  /** The term exactly as it appears in the voiceover text, e.g. "DeCC0s". */
  written: string;
  /** A respelling that sounds right when read aloud, e.g. "Decos". */
  spoken: string;
}

export interface ProductionPlan {
  title: string;
  language: string;
  /** Precise English visual description of the abstract guide character. */
  guideCharacter: string;
  /** Shared English style block appended to every image/video prompt. */
  styleBlock: string;
  accentColor: string;
  levels: PlanLevel[];
  finalCheck: PlanInteraction;
  /** Key takeaways for the summary screen / cheat sheet. */
  cheatSheet: string[];
  /**
   * Respellings for terms TTS gets wrong. Optional: plans extracted before this existed have none,
   * and most trainings need none.
   */
  pronunciations?: PlanPronunciation[];
}

export type StepId =
  | 'plan'
  | 'refimage'
  | 'voiceovers'
  | 'films'
  | 'animations'
  | 'images'
  | 'assemble'
  | 'qa';

export type StepStatus = 'pending' | 'running' | 'waiting_input' | 'completed' | 'failed';

export interface StepState {
  id: StepId;
  status: StepStatus;
  /** Human-readable progress detail. */
  detail?: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

export interface ProductionState {
  projectId: string;
  status: 'idle' | 'running' | 'waiting_input' | 'failed' | 'done';
  steps: StepState[];
  /** Base64 candidates for the reference image pick (data URLs), cleared after the pick. */
  refCandidates?: string[];
  chosenRef?: number;
  /** How many candidates were generated — they stay on disk for later review. */
  refCandidateCount?: number;
  /** Quoted total video cost in USD, set before films run. */
  videoQuoteUsd?: number;
  videoConfirmed?: boolean;
  /** Relative path of the final HTML inside the project dir. */
  outputFile?: string;
  /** Result of the automated click-through of the produced file. */
  qa?: { passed: boolean; summary: string; notCovered: string };
  updatedAt: string;
}

export const STEP_ORDER: StepId[] = [
  'plan',
  'refimage',
  'voiceovers',
  'films',
  'animations',
  'images',
  'assemble',
  'qa',
];
