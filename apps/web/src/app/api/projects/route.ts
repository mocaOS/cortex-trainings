import { NextRequest, NextResponse } from 'next/server';
import type { Briefing } from '@cortex-trainings/shared';
import { createProject, listProjects } from '@/lib/store';

export async function GET() {
  return NextResponse.json({ projects: await listProjects() });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { topic, audience, language, duration, material, collectionId } = body ?? {};
  if (!topic || !audience || !language || !duration) {
    return NextResponse.json(
      { error: 'topic, audience, language and duration are required' },
      { status: 400 },
    );
  }
  const briefing: Briefing = { topic, audience, language, duration, material, collectionId };
  const project = await createProject(briefing);
  return NextResponse.json({ project }, { status: 201 });
}
