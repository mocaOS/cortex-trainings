import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { env } from '@/lib/env';
import { getProductionState } from '@/lib/production/runner';

type Params = { params: Promise<{ id: string }> };

/** Download the finished offline training HTML. */
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/.test(id)) return new Response('bad id', { status: 400 });
  const state = await getProductionState(id);
  if (!state?.outputFile) return new Response('not produced yet', { status: 404 });
  const file = path.resolve(env.storagePath, 'projects', id, state.outputFile);
  try {
    const buf = await fs.readFile(file);
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `attachment; filename="training-${id.slice(0, 8)}.html"`,
      },
    });
  } catch {
    return new Response('file missing', { status: 404 });
  }
}
