import { NextRequest, NextResponse } from 'next/server';
import { provideProductionInput } from '@/lib/production/runner';

type Params = { params: Promise<{ id: string }> };

/**
 * Provide a pending human input:
 *   { key: "ref", value: <candidateIndex> }
 *   { key: "video", value: true }
 */
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const key = body?.key;
  if (key !== 'ref' && key !== 'video') {
    return NextResponse.json({ error: 'key must be "ref" or "video"' }, { status: 400 });
  }
  const ok = provideProductionInput(id, key, body.value);
  if (!ok) return NextResponse.json({ error: 'no pending input of that kind' }, { status: 409 });
  return NextResponse.json({ ok: true });
}
