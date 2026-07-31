import { NextRequest, NextResponse } from 'next/server';
import type { Briefing, VisualStyle } from '@cortex-trainings/shared';
import { DEFAULT_VISUAL_STYLE, VISUAL_STYLES } from '@cortex-trainings/shared';
import { createProject, listProjects } from '@/lib/store';

export async function GET() {
  return NextResponse.json({ projects: await listProjects() });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { topic, audience, language, duration, visualStyle, material, collectionId } = body ?? {};
  if (!topic || !audience || !language || !duration) {
    return NextResponse.json(
      { error: 'topic, audience, language and duration are required' },
      { status: 400 },
    );
  }
  const style: VisualStyle =
    visualStyle && visualStyle in VISUAL_STYLES ? (visualStyle as VisualStyle) : DEFAULT_VISUAL_STYLE;
  const briefing: Briefing = {
    topic,
    audience,
    language,
    duration,
    visualStyle: style,
    material,
    collectionId,
  };
  const project = await createProject(briefing);
  return NextResponse.json({ project }, { status: 201 });
}
