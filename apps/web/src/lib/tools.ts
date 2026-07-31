import 'server-only';
import type { ToolDefinition } from '@cortex-trainings/shared';
import { promises as fs } from 'fs';
import path from 'path';
import { getCortex } from './clients';
import { saveCurriculum } from './store';
import { env } from './env';
import { describeDrift, detectDrift, isDirty, staleMedia } from './production/drift';

export interface ToolContext {
  projectId: string;
  collectionId?: string;
  /** Set by the save_curriculum executor so the route can notify the client. */
  onCurriculumSaved?: (version: number) => void;
  /** Fired when a revision invalidated already-produced media. */
  onMediaInvalidated?: (drift: string, files: string[]) => void;
}

export const toolDefinitions: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'cortex_deep_research',
      description:
        'Run a deep agentic research query against the Cortex knowledge base (GraphRAG). ' +
        'Returns a synthesized answer with sources. Cheap — use liberally and in parallel: ' +
        'one call per level, learning objective, or open question. Takes 15–30s per call.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'A focused research question.' },
        },
        required: ['question'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cortex_search',
      description:
        'Fast hybrid retrieval (vector + keyword + graph) over the Cortex knowledge base. ' +
        'Returns raw text chunks with source filenames. Use for quick fact lookups and to find documents.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          top_k: { type: 'number', description: '1–20, default 8' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cortex_list_communities',
      description:
        'List topic clusters (communities) in the Cortex knowledge base, each with an LLM summary. ' +
        'Useful to map the domain and find related themes for level structure.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Optional semantic filter.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cortex_get_document',
      description:
        'Fetch the full markdown content of one Cortex document by id (primary-source reading). ' +
        'Document ids come from cortex_search results.',
      parameters: {
        type: 'object',
        properties: {
          document_id: { type: 'string' },
        },
        required: ['document_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_curriculum',
      description:
        'Save the complete curriculum.md for this training project. Call this exactly once per ' +
        'draft/revision with the FULL markdown document (never a fragment). Saving creates a new version.',
      parameters: {
        type: 'object',
        properties: {
          markdown: { type: 'string', description: 'The complete curriculum.md content.' },
        },
        required: ['markdown'],
      },
    },
  },
];

const MAX_TOOL_RESULT_CHARS = 24000;

function clip(s: string): string {
  return s.length > MAX_TOOL_RESULT_CHARS
    ? s.slice(0, MAX_TOOL_RESULT_CHARS) + `\n…[truncated at ${MAX_TOOL_RESULT_CHARS} chars]`
    : s;
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  const cortex = getCortex();
  switch (name) {
    case 'cortex_deep_research': {
      const result = await cortex.deepResearch(String(args.question), {
        collectionId: ctx.collectionId,
      });
      const sources = result.sources
        .map((s) => `- ${s.filename ?? s.document_id ?? 'unknown source'}`)
        .join('\n');
      return clip(`${result.answer}\n\nSources:\n${sources || '- (none reported)'}`);
    }
    case 'cortex_search': {
      const topK = Math.min(Math.max(Number(args.top_k ?? 8), 1), 20);
      const results = await cortex.search(String(args.query), topK, ctx.collectionId);
      return clip(
        JSON.stringify(
          results.map((r) => ({
            document_id: r.document_id,
            filename: r.metadata?.filename,
            score: r.score,
            content: r.content,
          })),
          null,
          1,
        ),
      );
    }
    case 'cortex_list_communities': {
      const communities = await cortex.communities(
        args.search ? String(args.search) : undefined,
      );
      return clip(
        JSON.stringify(
          communities.map((c) => ({
            id: c.id,
            name: c.name,
            description: c.description,
            documents: c.document_count,
          })),
          null,
          1,
        ),
      );
    }
    case 'cortex_get_document': {
      const doc = await cortex.documentContent(String(args.document_id));
      const content = doc.full_content ?? doc.chunks?.map((c) => c.content).join('\n\n') ?? '';
      return clip(`# ${doc.filename}\n\n${content}`);
    }
    case 'save_curriculum': {
      // A real curriculum is thousands of characters; anything tiny means the
      // argument was lost or truncated, and must not overwrite a good version.
      const markdown = typeof args.markdown === 'string' ? args.markdown : '';
      if (markdown.trim().length < 800) {
        return (
          `Tool error: refused to save — the markdown was empty or too short ` +
          `(${markdown.trim().length} chars). Send the COMPLETE curriculum document.`
        );
      }
      // If media was already produced from an earlier version, a change to narration, a
      // title or a film prompt makes that media wrong. Detect it and delete exactly what
      // is now stale, rather than believing a claim that nothing important changed.
      const projectDir = path.resolve(env.storagePath, 'projects', ctx.projectId);
      const drift = await detectDrift(projectDir, markdown);
      const entry = await saveCurriculum(ctx.projectId, markdown);
      ctx.onCurriculumSaved?.(entry.version);

      if (drift && isDirty(drift)) {
        const stale = staleMedia(drift);
        await Promise.all(
          stale.map((rel) => fs.rm(path.join(projectDir, 'media', rel), { force: true })),
        );
        ctx.onMediaInvalidated?.(describeDrift(drift), stale);
        return (
          `Curriculum saved as version ${entry.version}. ` +
          `NOTE: this revision changed content that media was already produced from ` +
          `(${describeDrift(drift)}), so ${stale.length} produced file(s) were discarded and ` +
          `will be regenerated — video regeneration costs money. Tell the user which levels ` +
          `are affected and why.`
        );
      }
      return `Curriculum saved as version ${entry.version}.`;
    }
    default:
      return `Unknown tool: ${name}`;
  }
}
