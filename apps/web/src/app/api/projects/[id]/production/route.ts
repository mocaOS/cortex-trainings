import { NextRequest, NextResponse } from 'next/server';
import { getProject } from '@/lib/store';
import { getProductionState, startProduction } from '@/lib/production/runner';

export const maxDuration = 3600;

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const state = await getProductionState(id);
  return NextResponse.json({ state });
}

/** Start (or resume) the production pipeline. */
export async function POST(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (project.status !== 'approved' && project.status !== 'producing') {
    return NextResponse.json({ error: 'curriculum must be approved first' }, { status: 409 });
  }
  const state = await startProduction(id);
  return NextResponse.json({ state });
}
