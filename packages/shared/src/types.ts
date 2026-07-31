export type ProjectStatus = 'briefing' | 'researching' | 'draft' | 'approved' | 'producing' | 'done';

/** Headline form of a topic: first `words` words, ellipsized if truncated. */
export function shortTitle(topic: string, words = 4): string {
  const parts = topic.trim().split(/\s+/);
  const head = parts.slice(0, words).join(' ').replace(/[.,;:–-]+$/, '');
  return parts.length > words ? `${head} …` : head;
}

/**
 * Visual style of all generated imagery. The value is an English prompt fragment shared by
 * the curriculum author and the plan extractor, so films, images and the guide character
 * all land in the same visual world. Animations are CSS-rendered and unaffected.
 */
export const VISUAL_STYLES = {
  '3d':
    'high-end 3D render look, physically based materials, glossy and matte surfaces, soft ' +
    'studio lighting with crisp specular highlights, subtle depth of field, polished CGI',
  realistic:
    'photorealistic cinematic footage look, shot on a full-frame camera, shallow depth of ' +
    'field, naturalistic lighting, fine film grain, restrained color grading',
  anime:
    'modern anime look, clean cel shading, confident line art, flat vibrant colors with soft ' +
    'gradient skies, expressive composition, Japanese animation aesthetic',
  comic:
    'bold comic-book illustration look, strong ink outlines, halftone and cross-hatch shading, ' +
    'flat graphic color fields, dynamic dramatic angles, printed-page feel',
} as const;

export type VisualStyle = keyof typeof VISUAL_STYLES;

export const DEFAULT_VISUAL_STYLE: VisualStyle = 'realistic';

export function visualStylePrompt(style: string | undefined): string {
  return VISUAL_STYLES[(style as VisualStyle) ?? DEFAULT_VISUAL_STYLE] ?? VISUAL_STYLES[DEFAULT_VISUAL_STYLE];
}

export interface Briefing {
  topic: string;
  audience: string;
  /** Target language of the training content (BCP-47-ish short code, e.g. "de", "en"). */
  language: string;
  /** Desired duration, e.g. "~20 min". Drives the level count. */
  duration: string;
  /** Visual style of all generated imagery. Defaults to `realistic`. */
  visualStyle?: VisualStyle;
  /** Optional existing material / bullet points from the user. */
  material?: string;
  /** Optional Cortex collection to scope research to. */
  collectionId?: string;
}

/** The two kinds of optional user-uploaded reference images. */
export type RefKind = 'character' | 'style';

export const MAX_REF_IMAGES = 3;

/** Vision analysis of one kind of uploaded reference images (persisted in refs.json). */
export interface RefAnalysis {
  /** Media-relative paths of the uploaded images, e.g. "refs/character-0.jpg" (1–3). */
  files: string[];
  /** English prompt-ready description extracted by the vision model. */
  description: string;
  analyzedAt: string;
}

/**
 * Optional reference images a user attaches to a project. `character` fixes the guide
 * character's identity (it keeps its own colors — the accent-color rule yields to it);
 * `style` fixes the aesthetic of every generated image and film, replacing the preset
 * visual style. Both are extracted into English descriptions once, at upload time.
 */
export interface ProjectRefs {
  character?: RefAnalysis;
  style?: RefAnalysis;
}

export interface CurriculumVersion {
  version: number;
  createdAt: string;
  /** Full curriculum.md content. */
  markdown: string;
}

export interface Project {
  id: string;
  title: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  briefing: Briefing;
  /** Latest curriculum version number, 0 = none yet. */
  curriculumVersion: number;
  approvedAt?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

/** Cortex API shapes (subset the app consumes). */
export interface CortexCollection {
  id: string;
  name: string;
  description?: string;
  document_count?: number;
  entity_count?: number;
}

export interface CortexCommunity {
  id: string;
  name: string;
  description?: string;
  summary?: string;
  document_count?: number;
  entity_count?: number;
  top_entities?: string[];
}

export interface CortexSearchResult {
  document_id: string;
  chunk_id?: string;
  content: string;
  score?: number;
  metadata?: { filename?: string; chunk_index?: number };
}

export interface CortexAskResult {
  answer: string;
  sources: Array<{ document_id?: string; filename?: string; content?: string }>;
}

export interface CortexDocumentContent {
  id: string;
  filename: string;
  full_content?: string;
  chunks?: Array<{ id: string; content: string; chunk_index: number }>;
}
