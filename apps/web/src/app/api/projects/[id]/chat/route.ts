import { NextRequest } from 'next/server';
import type { AgentMessage } from '@cortex-trainings/shared';
import { briefingToFirstUserMessage, runAgent, type AgentEvent } from '@/lib/agent';
import { appendChat, getChat, getProject, getRefs, updateProject } from '@/lib/store';

export const maxDuration = 3600;

type Params = { params: Promise<{ id: string }> };

/**
 * POST { message?: string } → SSE stream of AgentEvents.
 * Without a message, this is the initial "research & draft" run derived from the briefing.
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) return new Response('not found', { status: 404 });
  if (project.status === 'approved' || project.status === 'producing' || project.status === 'done') {
    return new Response('curriculum is approved — revisions are locked', { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  const userMessage: string = body?.message?.trim() || briefingToFirstUserMessage(project.briefing);
  await appendChat(id, { role: 'user', content: userMessage, createdAt: new Date().toISOString() });
  if (project.status === 'briefing') await updateProject(id, { status: 'researching' });

  const chat = await getChat(id);
  const history: AgentMessage[] = chat.map((m) => ({ role: m.role, content: m.content }));
  const refs = await getRefs(id);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: AgentEvent) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      try {
        const ctx = {
          projectId: id,
          collectionId: project.briefing.collectionId,
          onCurriculumSaved: (version: number) => send({ type: 'curriculum_saved', version }),
        };
        for await (const event of runAgent(project.briefing, history, ctx, refs)) {
          // runAgent yields errors instead of throwing, so the catch below never sees
          // them. Without this, a failed run still leaves no trace in the terminal —
          // which is exactly how two dead runs looked like clean 200s.
          if (event.type === 'error') {
            console.error(`[chat ${id}] agent error event:`, event.message);
          }
          send(event);
          if (event.type === 'assistant') {
            await appendChat(id, {
              role: 'assistant',
              content: event.text,
              createdAt: new Date().toISOString(),
            });
          }
        }
      } catch (err) {
        // Also log server-side: an error that only goes into the SSE stream is
        // invisible the moment the client disconnects, which is exactly when it
        // matters most. A 23-minute failed run left no trace in the terminal.
        console.error(`[chat ${id}] agent run failed:`, err);
        send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
