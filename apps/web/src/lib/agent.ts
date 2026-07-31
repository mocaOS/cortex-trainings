import 'server-only';
import type { AgentMessage, Briefing, ToolCall } from '@cortex-trainings/shared';
import { getVenice } from './clients';
import { executeTool, toolDefinitions, type ToolContext } from './tools';

export type AgentEvent =
  | { type: 'status'; text: string }
  | { type: 'tool_call'; name: string; args: string }
  | { type: 'tool_result'; name: string; summary: string }
  | { type: 'assistant'; text: string }
  | { type: 'curriculum_saved'; version: number }
  | { type: 'log'; message: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

const MAX_ITERATIONS = 40;
/**
 * A full curriculum is ~30-40k characters of markdown inside a single tool-call
 * argument. The old 16k ceiling truncated that mid-JSON, so the arguments failed to
 * parse. claude-fable-5 allows up to 128k output tokens.
 */
const MAX_OUTPUT_TOKENS = Number(process.env.VENICE_MAX_OUTPUT_TOKENS ?? '64000');

function systemPrompt(briefing: Briefing): string {
  return `You are the curriculum author of "Cortex Trainings", a web application that produces
story-driven, interactive learning units as single offline HTML files. You are executing
PART 1 of the workflow: writing the curriculum document. Part 1 costs nothing — media
production (Part 2) only starts after the user's explicit approval, so the curriculum must
be complete enough that a reviewer can approve it as a standalone text document.

## Briefing
- Topic & learning objectives: ${briefing.topic}
- Audience & prior knowledge: ${briefing.audience}
- Content language (ALL learner-facing text): ${briefing.language}
- Desired duration: ${briefing.duration}
${briefing.material ? `- Existing material from the user (primary source — build on it, do not reinvent):\n${briefing.material}` : ''}

## Research strategy — do this FIRST
The connected Cortex knowledge base is the primary domain source. Research is cheap compared
to your own tokens: front-load context with a FAN-OUT of cortex_deep_research calls (issue
several tool calls in parallel in one turn — one per candidate level, learning objective, or
open question), and keep issuing gap-filling calls while writing. Use cortex_list_communities
to map the domain, cortex_search for quick lookups, cortex_get_document to read primary
sources. Record source document names and dates — the curriculum must cite them.

## Duration → structure (one level = 1 video/animation + 1 interaction)
- ~10–15 min → 3–4 levels, ~25–35 s voiceover per scene
- ~20–30 min → 5–6 levels, ~30–40 s
- ~30–45 min → 7–8 levels, ~35–45 s
Voiceover word count: ~2.5 words/second.

## Fixed defaults (state them in the fact sheet so the user can object)
16:9 videos, dark design with ONE fixed accent color: ${process.env.ACCENT_COLOR?.trim() || 'oklch(0.79 0.18 70.67)'} — never choose a different color. XP + level badges. Form of address: casual
for coaching/courses/trainings, formal for compliance and regulated industries. Guide
character: an abstract object (glowing orb, crystal, robot cube) — NEVER a human.

## Language rules
- All learner-facing text (voiceover scripts, on-screen text, quizzes, feedback) in ${briefing.language}.
- Image and video prompts ALWAYS in English, always ending with "no readable text, no captions".
- Note layout risks of the target language (e.g. long German compounds breaking titles).

## Media plan — exactly one medium per level
- FILM (cinematic AI video): story moments, emotion, people in situations. Expensive — 2–3 per training max.
- ANIMATION (HyperFrames): concepts, lists, models, rules, processes, numbers. Free — the default.
- IMAGE: context for interaction screens. Nearly free.

## Interaction toolbox — a DIFFERENT form per level (variety is the point)
Self-assessment slider · prediction game with probability bars · myth-or-fact flip cards ·
find-the-N-mistakes · drag & drop into categories · scenario quiz with 2 buttons · clickable
timeline · branching story (3 options, consequence feedback) · rapid fire with timer ·
sorting/ordering task · final check (8–10 mixed questions) at the end.

## curriculum.md structure (write in ${briefing.language}; this exact order)
1. Fact sheet — topic, audience, language, duration, form of address, guide character, state/date
2. Learning objectives — overarching plus one per level ("Learners can …")
3. Level overview table: Level | Learning objective | Key takeaway | Medium | Interaction
4. Per level: learning objective, key takeaway (ONE sentence), teaching text (the substance,
   prose, based on Cortex research), voiceover script (word count = target seconds × 2.5),
   media plan (FILM → Seedance-style English prompt + shot lengths; ANIMATION → beat plan;
   IMAGE → English prompt), interaction fully written out (questions, options, resolutions,
   feedback, XP)
5. Final check — all questions with correct answers and distractors
6. Summary / cheat sheet — all key takeaways
7. Sources & date — the Cortex documents used, mandatory
8. Production estimate — count FILM seconds (video ≈ $ per second dominates), images, voiceover
   scenes; note that exact video prices are quoted at production time

## Working style
- Cut ruthlessly: better 5 things that stick than 15 forgotten. Everything must be
  action-relevant for THIS audience.
- When the curriculum is complete, call save_curriculum with the FULL markdown.
- After saving, reply to the user (in the app language, ${briefing.language}) with a short
  summary: level structure, media plan totals, what to review before approving.
- On revision requests: apply them, save a new full version via save_curriculum, summarize
  the change. Never produce media — that is Part 2 and gated on approval.`;
}

export function briefingToFirstUserMessage(briefing: Briefing): string {
  return `Please research the Cortex knowledge base and write the complete curriculum for the training "${briefing.topic}". Start with a broad research fan-out before writing.`;
}

/**
 * Runs the tool loop against Venice until the model produces a final text
 * response, emitting progress events along the way.
 */
export async function* runAgent(
  briefing: Briefing,
  history: AgentMessage[],
  ctx: ToolContext,
): AsyncGenerator<AgentEvent> {
  const venice = getVenice();
  const messages: AgentMessage[] = [
    { role: 'system', content: systemPrompt(briefing) },
    ...history,
  ];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let result;
    try {
      result = await venice.chat(messages, { tools: toolDefinitions, maxTokens: MAX_OUTPUT_TOKENS });
    } catch (err) {
      yield { type: 'error', message: err instanceof Error ? err.message : String(err) };
      return;
    }
    if (result.finishReason === 'length') {
      yield {
        type: 'log',
        message: `Model output hit the ${MAX_OUTPUT_TOKENS}-token limit — the response was truncated.`,
      };
    }

    if (result.toolCalls.length > 0) {
      messages.push({ role: 'assistant', content: result.content, tool_calls: result.toolCalls });
      for (const call of result.toolCalls) {
        yield { type: 'tool_call', name: call.function.name, args: call.function.arguments.slice(0, 300) };
      }
      // Execute the batch in parallel — deep-research fan-out is the intended pattern.
      const results = await Promise.all(
        result.toolCalls.map(async (call: ToolCall) => {
          let args: Record<string, unknown>;
          try {
            args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
          } catch {
            // Truncated/invalid arguments must never reach a tool as undefined values —
            // tell the model so it can retry, e.g. with a shorter document.
            const hint =
              result.finishReason === 'length'
                ? 'Your response was cut off by the output limit before the arguments were complete. Retry with a more concise document.'
                : 'The arguments were not valid JSON. Retry with correctly escaped JSON.';
            return {
              call,
              output: `Tool error: could not parse arguments for ${call.function.name}. ${hint}`,
            };
          }
          try {
            return { call, output: await executeTool(call.function.name, args, ctx) };
          } catch (err) {
            return {
              call,
              output: `Tool error: ${err instanceof Error ? err.message : String(err)}`,
            };
          }
        }),
      );
      for (const { call, output } of results) {
        messages.push({ role: 'tool', tool_call_id: call.id, content: output });
        yield { type: 'tool_result', name: call.function.name, summary: output.slice(0, 300) };
      }
      continue;
    }

    if (result.content) {
      yield { type: 'assistant', text: result.content };
    }
    yield { type: 'done' };
    return;
  }

  yield { type: 'error', message: `Agent exceeded ${MAX_ITERATIONS} iterations without finishing.` };
}
