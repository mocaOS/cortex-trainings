export type ProjectStatus = 'briefing' | 'researching' | 'draft' | 'approved' | 'producing' | 'done';

/** Headline form of a topic: first `words` words, ellipsized if truncated. */
export function shortTitle(topic: string, words = 4): string {
  const parts = topic.trim().split(/\s+/);
  const head = parts.slice(0, words).join(' ').replace(/[.,;:–-]+$/, '');
  return parts.length > words ? `${head} …` : head;
}

export interface Briefing {
  topic: string;
  audience: string;
  /** Target language of the training content (BCP-47-ish short code, e.g. "de", "en"). */
  language: string;
  /** Desired duration, e.g. "~20 min". Drives the level count. */
  duration: string;
  /** Optional existing material / bullet points from the user. */
  material?: string;
  /** Optional Cortex collection to scope research to. */
  collectionId?: string;
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
