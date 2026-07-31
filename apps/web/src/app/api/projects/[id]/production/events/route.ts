import { NextRequest } from 'next/server';
import { getProductionState, subscribeProduction } from '@/lib/production/runner';

export const maxDuration = 3600;

type Params = { params: Promise<{ id: string }> };

/** SSE stream of production events (state snapshots + log lines). */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      const state = await getProductionState(id);
      if (state) send({ type: 'state', state });

      const unsubscribe = subscribeProduction(id, (event) => {
        try {
          send(event);
        } catch {
          /* stream closed */
        }
      });

      const ping = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          clearInterval(ping);
        }
      }, 15000);

      _req.signal.addEventListener('abort', () => {
        clearInterval(ping);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
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
