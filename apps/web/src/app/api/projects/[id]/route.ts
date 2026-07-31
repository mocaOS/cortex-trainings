import { NextRequest, NextResponse } from 'next/server';
import { getChat, getCurriculum, getProject, updateProject } from '@/lib/store';

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const [curriculum, chat] = await Promise.all([getCurriculum(id), getChat(id)]);
  return NextResponse.json({ project, curriculum, chat });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await req.json();
  if (body.status !== 'approved') {
    return NextResponse.json({ error: 'only status=approved is supported' }, { status: 400 });
  }
  try {
    const project = await updateProject(id, { status: 'approved' });
    return NextResponse.json({ project });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'update failed' },
      { status: 400 },
    );
  }
}
